/*
 * ZipCheckForWindows - zip ファイルが Windows 11 のエクスプローラー（zipfldr.dll）で展開できるかを判定する。
 * DOM に依存しないため Node.js でも動く（テスト用）。
 */
(function (root) {
  'use strict';

  const RESERVED = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);
  const INVALID_CHAR_MAP = { '<': '＜', '>': '＞', ':': '：', '"': '”', '|': '｜', '?': '？', '*': '＊' };

  // 表示用の文言は lang ('ja' | 'en') で切り替える。判定そのものは言語に依存しない
  const L = (lang, ja, en) => (lang === 'en' ? en : ja);

  const METHOD_NAMES = {
    1: 'Shrink', 6: 'Implode', 8: 'Deflate', 9: 'Deflate64',
    12: 'BZip2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 96: 'JPEG', 97: 'WavPack', 98: 'PPMd',
  };
  function methodName(m, lang = 'ja') {
    if (m === 0) return L(lang, 'Stored（無圧縮）', 'Stored (no compression)');
    if (m === 99) return L(lang, 'AES 暗号化', 'AES encryption');
    return METHOD_NAMES[m] || L(lang, `方式 ${m}`, `method ${m}`);
  }

  /** 空・"."・".." を除いてパスを分割する。 */
  function splitPath(name) {
    return name.split(/[\/\\]/).filter((s) => s.length > 0 && s !== '.' && s !== '..');
  }

  /**
   * Windows で使えない文字・名前を置き換える（修正例の表示用）。
   * 日本語では全角の同じ形の文字に、英語では「_」に置き換える（判定には日本語版を使う）。
   */
  function sanitizeName(name, lang = 'ja') {
    let s = '';
    for (const c of name) {
      if (INVALID_CHAR_MAP[c]) s += lang === 'en' ? '_' : INVALID_CHAR_MAP[c];
      else if (c.charCodeAt(0) < 0x20) s += '_';
      else s += c;
    }
    s = s.replace(/[ .]+$/, '');
    if (s.length === 0) s = '_';
    if (RESERVED.has(s.split('.')[0].toUpperCase())) s = '_' + s;
    return s;
  }

  /** 名前のどこが Windows で問題になるかを説明する。 */
  function describeInvalid(part, lang = 'ja') {
    const reasons = [];
    const chars = new Set();
    for (const c of part) {
      if (INVALID_CHAR_MAP[c]) chars.add(c);
      else if (c.charCodeAt(0) < 0x20) chars.add(L(lang, '制御文字 ', 'control character ') + `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    const quote = (c) => L(lang, `「${c}」`, `"${c}"`);
    if (chars.size) reasons.push(L(lang, '使えない文字 ', 'invalid characters ') + [...chars].map((c) => c.length === 1 ? quote(c) : c).join(' '));
    if (/[ .]$/.test(part)) reasons.push(L(lang, '末尾がドットまたは空白', 'ends with a dot or space'));
    if (RESERVED.has(part.replace(/[ .]+$/, '').split('.')[0].toUpperCase())) reasons.push(L(lang, '予約名', 'reserved name ') + quote(part.split('.')[0]));
    return reasons.join(L(lang, '、', '; '));
  }

  const utf8Strict = new TextDecoder('utf-8', { fatal: true });
  const utf8Loose = new TextDecoder('utf-8');
  const decoders = {};
  function decoderFor(label, fatal) {
    const key = label + (fatal ? ':fatal' : '');
    if (!decoders[key]) decoders[key] = new TextDecoder(label, fatal ? { fatal: true } : undefined);
    return decoders[key];
  }
  /** その文字コードとして正しいバイト列か。 */
  function isValidIn(bytes, label) {
    try { decoderFor(label, true).decode(bytes); return true; } catch (_) { return false; }
  }

  const u16 = (b, p) => b[p] | (b[p + 1] << 8);
  const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  const u64 = (b, p) => u32(b, p) + u32(b, p + 4) * 0x100000000;

  /**
   * zip の末尾（最大 64KB + 22 バイト）から EOCD（と ZIP64 EOCD）を探し、
   * セントラルディレクトリの位置を返す。
   * @param tail 末尾のバイト列, tailOffset ファイル内での tail の開始位置
   * @param readAt (offset, length) => Promise<Uint8Array>（ZIP64 レコードの読み込み用）
   */
  async function locateCentralDirectory(fileSize, tail, tailOffset, readAt) {
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) return { error: 'notzip' };

    const info = {
      disk: u16(tail, eocd + 4),
      cdDisk: u16(tail, eocd + 6),
      entriesTotal: u16(tail, eocd + 10),
      cdSize: u32(tail, eocd + 12),
      cdOffset: u32(tail, eocd + 16),
      zip64: false,
    };

    // ZIP64 EOCD locator は EOCD の直前 20 バイト
    if (eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
      const loc = eocd - 20;
      const z64Offset = u64(tail, loc + 8);
      const totalDisks = u32(tail, loc + 16);
      const rec = await readAt(z64Offset, 56);
      if (rec.length >= 56 && u32(rec, 0) === 0x06064b50) {
        info.zip64 = true;
        info.disk = u32(rec, 16);
        info.cdDisk = u32(rec, 20);
        info.entriesTotal = u64(rec, 32);
        info.cdSize = u64(rec, 40);
        info.cdOffset = u64(rec, 48);
      }
      if (totalDisks > 1) info.disk = Math.max(info.disk, totalDisks - 1);
    }

    if (info.disk !== 0 || info.cdDisk !== 0) return { error: 'split', info };
    if (info.cdOffset + info.cdSize > fileSize) {
      // 先頭に別データ（自己解凍形式など）が付いている場合のずれを補正してみる
      const shift = (tailOffset + eocd) - (info.cdOffset + info.cdSize);
      if (shift > 0 && info.cdOffset + shift + info.cdSize <= fileSize) info.cdOffset += shift;
      else return { error: 'corrupt', info };
    }
    return { info };
  }

  /** セントラルディレクトリから各エントリの生情報を読む。 */
  function parseCentralDirectory(data) {
    const entries = [];
    let p = 0;
    let truncated = false;
    while (p + 46 <= data.length && u32(data, p) === 0x02014b50) {
      const flags = u16(data, p + 8);
      const method = u16(data, p + 10);
      const nameLen = u16(data, p + 28);
      const extraLen = u16(data, p + 30);
      const commentLen = u16(data, p + 32);
      let compSize = u32(data, p + 20);
      let uncompSize = u32(data, p + 24);
      if (p + 46 + nameLen > data.length) { truncated = true; break; }
      const nameBytes = data.subarray(p + 46, p + 46 + nameLen);
      const extra = data.subarray(p + 46 + nameLen, Math.min(data.length, p + 46 + nameLen + extraLen));
      // ZIP64 拡張フィールド (0x0001): 32 ビットに収まらない値だけが、元のサイズ → 圧縮後サイズの順に入る
      const z64 = findExtra(extra, 0x0001);
      if (z64) {
        let q = 0;
        if (uncompSize === 0xFFFFFFFF && q + 8 <= z64.length) { uncompSize = u64(z64, q); q += 8; }
        if (compSize === 0xFFFFFFFF && q + 8 <= z64.length) { compSize = u64(z64, q); q += 8; }
      }
      entries.push({ nameBytes, flags, method, extra, compSize, uncompSize });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (p < data.length && !truncated && entries.length === 0) truncated = true;
    return { entries, truncated };
  }

  /** 拡張フィールドから指定 ID のデータ部分を探す。 */
  function findExtra(extra, wantedId) {
    let p = 0;
    while (p + 4 <= extra.length) {
      const id = u16(extra, p);
      const size = u16(extra, p + 2);
      if (p + 4 + size > extra.length) return null;
      if (id === wantedId) return extra.subarray(p + 4, p + 4 + size);
      p += 4 + size;
    }
    return null;
  }

  /** UTF-8 フラグのないエントリ名の文字コードを推定する（厳密に UTF-8 として読めれば UTF-8、だめなら Shift_JIS）。 */
  function detectEncoding(entries) {
    const unflagged = entries.filter((e) => !(e.flags & 0x800));
    if (unflagged.length === 0) return null; // 全て UTF-8 フラグ付き
    if (unflagged.every((e) => e.nameBytes.every((b) => b < 0x80))) return 'utf-8';
    try {
      for (const e of unflagged) utf8Strict.decode(e.nameBytes);
      return 'utf-8';
    } catch (_) {
      return 'shift_jis';
    }
  }

  /**
   * Windows（MultiByteToWideChar, CP932）と同じ結果になるように Shift_JIS のバイト列を読む。
   * TextDecoder（WHATWG）との違い: 未定義の 2 バイト文字は「・」(U+30FB) になり、2 バイト目が ASCII でも一緒に消費される。
   * 実機検証（Windows 11 25H2）では、このせいで「.pdf」の「.」が消えて拡張子が壊れた。
   * 1 バイト・2 バイトの全 32,896 通りで MultiByteToWideChar(932) と一致することを確認済み。
   */
  function decodeCp932Win(bytes) {
    const sj = decoderFor('shift_jis', true);
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; }
      else if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
        // 末尾の先頭バイト、または次が NUL のときは「・」にして 1 バイトだけ進む
        if (i + 1 >= bytes.length || bytes[i + 1] === 0) { out += '・'; i++; continue; }
        try { out += sj.decode(bytes.subarray(i, i + 2)); } catch (_) { out += '・'; }
        i += 2;
      } else if (b >= 0xA1 && b <= 0xDF) { out += String.fromCharCode(0xFF61 + b - 0xA1); i++; }
      else { out += CP932_SINGLE[b]; i++; }
    }
    return out;
  }
  const CP932_SINGLE = { 0x80: '\u0080', 0xA0: '\uF8F0', 0xFD: '\uF8F1', 0xFE: '\uF8F2', 0xFF: '\uF8F3' };

  /** UTF-8 フラグのない名前を、エクスプローラーが OEM コードページで読んだときの表示。 */
  function oemView(bytes, oemCodePage) {
    if (oemCodePage === 932) return decodeCp932Win(bytes);
    const oem = OEM_CODEPAGES[oemCodePage];
    if (!oem || !oem.label) return null;
    try { return decoderFor(oem.label).decode(bytes); } catch (_) { return null; }
  }

  /**
   * Shift_JIS として正しく読めるが、実際は中国語（GBK / Big5）・韓国語（EUC-KR）らしい名前か。
   * 日本語の名前は、全角記号・かな・第 1 水準漢字の先頭バイト 0x81〜0x9F をほぼ必ず含む。
   * 中国語・韓国語の名前を Shift_JIS で読むと、0x81〜0x9F がなく、半角カナと 0xE0 以上（第 2 水準漢字など）が混ざる。
   * 半角カナだけの名前（ﾃﾞｰﾀ.csv など）は日本語でもありうるので対象外にする。
   */
  function looksForeign(bytes) {
    let low = 0, high = 0, kana = 0;
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b >= 0x81 && b <= 0x9F) { low++; i += 2; }
      else if (b >= 0xE0 && b <= 0xFC) { high++; i += 2; }
      else { if (b >= 0xA1 && b <= 0xDF) kana++; i++; }
    }
    return low === 0 && high > 0 && kana > 0;
  }

  /** ほかの言語の文字コードで読んだ候補（それらしく読めたものだけ）。 */
  function foreignCandidates(bytes, lang = 'ja') {
    const nonAscii = (s) => [...s].filter((c) => c.codePointAt(0) >= 0x80);
    const out = [];
    const hangul = (c) => c >= '가' && c <= '힣';
    const cjk = (c) => c >= '一' && c <= '鿿';
    const tries = [
      ['euc-kr', L(lang, '韓国語 (EUC-KR)', 'Korean (EUC-KR)'), hangul],
      ['gbk', L(lang, '簡体字中国語 (GBK)', 'Simplified Chinese (GBK)'), cjk],
      ['big5', L(lang, '繁体字中国語 (Big5)', 'Traditional Chinese (Big5)'), cjk],
    ];
    for (const [label, langName, plausible] of tries) {
      if (!isValidIn(bytes, label)) continue;
      const s = decoderFor(label).decode(bytes);
      const chars = nonAscii(s);
      if (chars.length && chars.every(plausible)) out.push({ label, langName, name: s });
    }
    return out;
  }

  /** パス区切り（/ と \）の数。 */
  const countSeparators = (s) => (s.match(/[\/\\]/g) || []).length;

  /** 名前の拡張子（.pdf など）。なければ null。 */
  const extOf = (s) => { const m = /(\.[A-Za-z0-9]{1,8})$/.exec(s); return m ? m[1] : null; };

  /**
   * Info-ZIP Unicode Path 拡張フィールド (0x7075) があれば UTF-8 名を返す。
   * 実機検証（Windows 11 25H2）: エクスプローラーはこのフィールドの名前を使い、CRC（元の名前との一致）は確かめない。
   * また名前はセントラルディレクトリのものを使い、ローカルヘッダーの名前は見ない。
   */
  function unicodePathExtra(extra) {
    const d = findExtra(extra, 0x7075);
    if (!d || d.length < 5 || d[0] !== 1) return null;
    try { return utf8Strict.decode(d.subarray(5)); } catch (_) { return null; }
  }

  const OEM_CODEPAGES = {
    932: { label: 'shift_jis', name: '日本語 (CP932 / Shift_JIS)', nameEn: 'Japanese (CP932 / Shift_JIS)' },
    437: { label: null, name: '英語 (CP437)', nameEn: 'English (CP437)' },
    936: { label: 'gbk', name: '簡体字中国語 (CP936 / GBK)', nameEn: 'Simplified Chinese (CP936 / GBK)' },
    949: { label: 'euc-kr', name: '韓国語 (CP949)', nameEn: 'Korean (CP949)' },
    950: { label: 'big5', name: '繁体字中国語 (CP950 / Big5)', nameEn: 'Traditional Chinese (CP950 / Big5)' },
    65001: { label: 'utf-8', name: 'UTF-8（ベータ: ワールドワイド言語サポート）', nameEn: 'UTF-8 (Beta: worldwide language support)' },
  };
  /** コードページの表示名。 */
  const oemName = (cp, lang = 'ja') => { const o = OEM_CODEPAGES[cp]; return o ? (lang === 'en' ? o.nameEn : o.name) : ''; };
  const ENCODING_CODEPAGE = { 'utf-8': 65001, shift_jis: 932, gbk: 936, 'euc-kr': 949, big5: 950 };

  /**
   * 解析本体。
   * @param cd セントラルディレクトリのバイト列
   * @param opts { zipName, folder, oemCodePage, lang }（lang: 表示用の文言の言語 'ja' | 'en'）
   */
  function diagnose(cd, opts) {
    const zipName = opts.zipName || 'archive.zip';
    const stem = zipName.replace(/\.zip$/i, '');
    const folder = (opts.folder || '').trim().replace(/[\\\/]+$/, '');
    const oemCodePage = opts.oemCodePage || 932;
    const lang = opts.lang === 'en' ? 'en' : 'ja';
    const explorerDest = folder ? `${folder}\\${stem}` : null;

    const { entries, truncated } = parseCentralDirectory(cd);
    const encoding = detectEncoding(entries);

    const issues = {
      tooManyBytes: [], tooLongPart: [], aes: [], strongEnc: [], unsupportedMethod: [],
      invalidName: [], caseCollision: [], longPath: [], tooManyEntries: [],
      garbled: [], undecodable: [], foreign: [], badUtf8Flag: [], localeDependent: [], nfd: [], emoji: [], largeArchive: [], zipCrypto: [],
    };
    let maxRelLen = 0;
    let totalUncompressed = 0;
    const seen = new Map(); // 大文字・小文字を区別しないパス → 最初の名前

    for (const e of entries) {
      const utf8Flag = (e.flags & 0x800) !== 0;
      const enc = utf8Flag ? 'utf-8' : (encoding || 'utf-8');
      // UTF-8 フラグがなくても Info-ZIP Unicode Path 拡張フィールドがあれば、Explorer はそちらの名前を使う
      const unicodeName = utf8Flag ? null : unicodePathExtra(e.extra);
      const name = unicodeName ?? (enc === 'utf-8' ? utf8Loose.decode(e.nameBytes) : decoderFor(enc).decode(e.nameBytes));
      e.name = name;
      const parts = splitPath(name);
      const isDir = /[\/\\]$/.test(name);
      const winRel = name.replace(/\//g, '\\').replace(/\\+$/, '');
      if (winRel.length > maxRelLen) maxRelLen = winRel.length;
      if (!isDir) totalUncompressed += e.uncompSize;

      // zipfldr.dll はエントリ名（zip 内の相対パス）が記録されたバイト数で 260 バイト以上だと、zip 全体を「無効」とする
      if (e.nameBytes.length >= 260) issues.tooManyBytes.push({ name, bytes: e.nameBytes.length, encoding: unicodeName ? 'utf-8' : enc });
      // NTFS のファイル名・フォルダ名は 255 文字まで
      const longPart = parts.find((part) => part.length > 255);
      if (longPart !== undefined) issues.tooLongPart.push({ name, part: longPart, length: longPart.length });

      if (e.flags & 0x40) issues.strongEnc.push({ name });
      else if (e.method === 99) issues.aes.push({ name });
      else if (e.flags & 0x1) issues.zipCrypto.push({ name });
      if (e.method !== 99 && ![0, 8, 9].includes(e.method)) issues.unsupportedMethod.push({ name, method: e.method, methodName: methodName(e.method, lang) });

      // --- 文字化け ---
      // UTF-8 フラグがあるのに UTF-8 として正しくない名前（作成ソフトの不具合）。エクスプローラーは UTF-8 として読み、
      // 読めない部分を「�」(U+FFFD) にする。Shift_JIS の 2 バイト目の 0x5C は「\」として残り、意図しないフォルダができる（実機検証）
      if (utf8Flag && !isValidIn(e.nameBytes, 'utf-8')) {
        const sjisName = isValidIn(e.nameBytes, 'shift_jis') ? decoderFor('shift_jis').decode(e.nameBytes) : null;
        issues.badUtf8Flag.push({
          name, explorerView: name, sjisName,
          extraFolders: sjisName != null && countSeparators(name) > countSeparators(sjisName),
        });
      }
      let misread = utf8Flag && !isValidIn(e.nameBytes, 'utf-8'); // 名前を正しく読めていない（NFD 判定などの対象外）
      // UTF-8 フラグも Unicode Path 拡張フィールドもない非 ASCII 名は、Explorer が OEM コードページで読む
      if (!utf8Flag && !unicodeName && e.nameBytes.some((b) => b >= 0x80)) {
        const explorerView = oemView(e.nameBytes, oemCodePage);
        const ext = extOf(name);
        const extLost = explorerView != null && ext != null && !explorerView.endsWith(ext);
        // 「/」も直前のバイトと一緒に消えることがある（実機検証: 「テスト/」フォルダが 0 バイトのファイルになり、中身はフォルダの外に出た）
        const sepLost = explorerView != null && countSeparators(explorerView) < countSeparators(name);
        const dirBecomesFile = sepLost && isDir && !/[\/\\]$/.test(explorerView);
        if (!isValidIn(e.nameBytes, enc)) {
          // UTF-8 としても推定した文字コードとしても読めない（ほかの言語の文字コードなど）
          issues.undecodable.push({ name, explorerView, extLost, sepLost, dirBecomesFile, candidates: foreignCandidates(e.nameBytes, lang) });
          misread = true;
        } else if (enc === 'shift_jis' && looksForeign(e.nameBytes)) {
          // Shift_JIS としては読めるが、中国語・韓国語の文字コードらしい（日本語版 Windows でも化ける）
          issues.foreign.push({ name, explorerView, extLost, sepLost, dirBecomesFile, candidates: foreignCandidates(e.nameBytes, lang) });
          misread = true;
        } else if (ENCODING_CODEPAGE[enc] !== oemCodePage) {
          issues.garbled.push({ name, explorerView, extLost, sepLost, dirBecomesFile });
        } else {
          // この PC では正しく表示されるが、OEM コードページが違う PC（他言語の Windows、UTF-8 ベータ設定、Mac など）では化ける
          issues.localeDependent.push({ name, encoding: enc });
        }
      }
      // Mac は濁点・半濁点などを分解した形（NFD）で名前を記録することがあり、Windows では「か゛」のように分離して見える
      if (!misread && name !== name.normalize('NFC')) issues.nfd.push({ name, nfc: name.normalize('NFC') });

      if (/[\u{10000}-\u{10FFFF}]/u.test(name)) issues.emoji.push({ name, chars: [...new Set(name.match(/[\u{10000}-\u{10FFFF}]/gu))].join('') });

      const bad = parts.filter((part) => sanitizeName(part) !== part);
      if (bad.length) issues.invalidName.push({ name, parts: bad.map((part) => ({ part, reason: describeInvalid(part, lang), fixed: sanitizeName(part, lang) })) });

      // Windows のファイルシステムは大文字・小文字を区別しない。フォルダの重複（a/ と a/x の a）は除外
      if (parts.length) {
        const key = parts.join('\\').toLowerCase();
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, { name, isDir });
        else if (!(prev.isDir && isDir) && prev.name !== name) issues.caseCollision.push({ name, other: prev.name });
        else if (!(prev.isDir && isDir) && prev.name === name) issues.caseCollision.push({ name, other: prev.name, duplicate: true });
      }

      if (explorerDest) {
        const full = `${explorerDest}\\${winRel}`;
        if (full.length >= 260) issues.longPath.push({ name, length: full.length });
      }
    }

    // ZIP64 の終端レコードがないのに 65,535 件を超えると、件数欄があふれて一部しか認識されない
    if (entries.length > 65535 && !opts.zip64) issues.tooManyEntries.push({ count: entries.length });
    const LARGE = 1.5 * 1024 * 1024 * 1024;
    if (totalUncompressed >= LARGE || (opts.fileSize || 0) >= LARGE) issues.largeArchive.push({ total: totalUncompressed, size: opts.fileSize || 0 });

    return { entries, truncated, encoding, explorerDest, maxRelLen, totalUncompressed, issues, oemCodePage };
  }

  /**
   * File (Blob) を受け取って解析する。ブラウザでは File、Node では Blob 互換オブジェクト。
   */
  async function analyzeBlob(blob, opts) {
    const size = blob.size;
    const readAt = async (offset, length) => new Uint8Array(await blob.slice(offset, Math.min(size, offset + length)).arrayBuffer());
    const head = await readAt(0, 4);
    const tailLen = Math.min(size, 22 + 65535);
    const tailOffset = size - tailLen;
    const tail = await readAt(tailOffset, tailLen);

    const result = { size, zipName: opts.zipName, fatalError: null };
    if (size < 22) { result.fatalError = 'notzip'; return result; }
    const loc = await locateCentralDirectory(size, tail, tailOffset, readAt);
    if (loc.error) {
      result.fatalError = loc.error;
      result.isRar = head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21;
      result.is7z = head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf;
      result.isSplitPart = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x07 && head[3] === 0x08;
      return result;
    }
    if (loc.info.cdSize > 512 * 1024 * 1024) { result.fatalError = 'corrupt'; return result; }
    const cd = await readAt(loc.info.cdOffset, loc.info.cdSize);
    Object.assign(result, diagnose(cd, { ...opts, zip64: loc.info.zip64, fileSize: size }), { zip64: loc.info.zip64, entriesTotal: loc.info.entriesTotal });
    if (result.entries.length === 0 && loc.info.entriesTotal > 0) result.fatalError = 'corrupt';
    return result;
  }

  const api = { analyzeBlob, diagnose, decodeCp932Win, looksForeign, sanitizeName, splitPath, describeInvalid, methodName, OEM_CODEPAGES, oemName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZipCheckForWindows = api;
})(typeof self !== 'undefined' ? self : this);
