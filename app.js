(function () {
  'use strict';
  const { analyzeBlob, OEM_CODEPAGES, oemName } = window.ZipCheckForWindows;
  const STORE = 'zipcheckforwindows.';

  // ---------- 言語 ----------
  // ブラウザの第一言語が日本語なら日本語、それ以外は英語で表示する
  const BROWSER_LANG = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
  const LANG = BROWSER_LANG.startsWith('ja') ? 'ja' : 'en';
  /** 日本語と英語の文言から、表示する方を選ぶ。 */
  const t = (ja, en) => (LANG === 'ja' ? ja : en);
  const LIST_SEP = t('、', ', ');

  /** ブラウザの言語に合う OEM コードページ（保存済みの設定がないときの既定値）。 */
  function defaultOem() {
    if (BROWSER_LANG.startsWith('ja')) return '932';
    if (BROWSER_LANG.startsWith('ko')) return '949';
    if (/^zh-(tw|hk|mo)|^zh-hant/.test(BROWSER_LANG)) return '950';
    if (BROWSER_LANG.startsWith('zh')) return '936';
    return '437';
  }

  /** index.html の固定テキスト（日本語は HTML に直接書いてある）。 */
  const STATIC_EN = {
    description: 'Checks whether a zip file can be extracted with Windows File Explorer and explains how to fix it.',
    lead: 'Checks whether a zip file can be extracted with Windows 11 File Explorer (right-click → "Extract All"). If it cannot, shows how to fix it. Files are only inspected in your browser and are never uploaded.',
    dropAria: 'Choose zip files',
    dropTitle: 'Drop zip files here',
    dropSub: 'or click to choose files (multiple allowed)',
    folderLabel: 'Folder where the zip is placed (extracted)',
    folderPlaceholder: 'e.g. C:\\Users\\alex\\Downloads',
    folderHint: 'Explorer extracts to "this folder\\zip name\\". Enter it to also check whether the extracted paths are too long. Browsers cannot see where a file is stored, so please type it in.',
    oemLabel: 'Windows language (OEM code page)',
    oemHint: 'File names without the UTF-8 flag are read with this code page.',
  };
  if (LANG === 'en') {
    document.documentElement.lang = 'en';
    for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = STATIC_EN[e.dataset.i18n];
    for (const e of document.querySelectorAll('[data-i18n-placeholder]')) e.placeholder = STATIC_EN[e.dataset.i18nPlaceholder];
    for (const e of document.querySelectorAll('[data-i18n-aria-label]')) e.setAttribute('aria-label', STATIC_EN[e.dataset.i18nAriaLabel]);
    for (const e of document.querySelectorAll('[data-i18n-content]')) e.setAttribute('content', STATIC_EN[e.dataset.i18nContent]);
  }

  const $ = (id) => document.getElementById(id);
  const drop = $('drop');
  const picker = $('picker');
  const folderInput = $('folder');
  const oemSelect = $('oem');
  const results = $('results');

  let currentFiles = [];

  for (const cp of Object.keys(OEM_CODEPAGES)) {
    const opt = document.createElement('option');
    opt.value = cp;
    opt.textContent = oemName(cp, LANG);
    oemSelect.appendChild(opt);
  }
  oemSelect.value = defaultOem();

  try {
    const saved = localStorage.getItem(STORE + 'folder');
    if (saved) folderInput.value = saved;
    const savedOem = localStorage.getItem(STORE + 'oem');
    if (savedOem && OEM_CODEPAGES[savedOem]) oemSelect.value = savedOem;
  } catch (_) { /* ストレージが使えなくても動く */ }

  // ---------- 入力 ----------
  drop.addEventListener('click', () => picker.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
  picker.addEventListener('change', () => { setFiles([...picker.files]); picker.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); setFiles([...e.dataTransfer.files]); });
  // ウィンドウのどこにドロップしても受け付ける
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.target !== drop && !drop.contains(e.target)) setFiles([...e.dataTransfer.files]); });

  let debounce;
  folderInput.addEventListener('input', () => {
    try { localStorage.setItem(STORE + 'folder', folderInput.value); } catch (_) { /* noop */ }
    clearTimeout(debounce);
    debounce = setTimeout(render, 250);
  });
  oemSelect.addEventListener('change', () => {
    try { localStorage.setItem(STORE + 'oem', oemSelect.value); } catch (_) { /* noop */ }
    render();
  });

  function setFiles(files) {
    if (!files.length) return;
    currentFiles = files;
    render();
  }

  // ---------- 表示用ヘルパー ----------
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
  const num = (n) => n.toLocaleString(LANG === 'ja' ? 'ja-JP' : 'en-US');
  /** 英語の単数・複数。 */
  const plural = (n, one, many) => (n === 1 ? one : many);

  /** パスの中の、指定した部分（フォルダ名・ファイル名）を強調した HTML を返す。 */
  function highlightParts(name, predicate) {
    return name.split(/([\/\\])/).map((seg) => (seg !== '/' && seg !== '\\' && seg && predicate(seg)) ? `<mark>${esc(seg)}</mark>` : esc(seg)).join('');
  }
  /** Windows で使えない文字を強調する。 */
  function highlightInvalidChars(part) {
    let h = '';
    for (const c of part) h += /[<>:"|?*]/.test(c) || c.charCodeAt(0) < 0x20 ? `<mark>${c.charCodeAt(0) < 0x20 ? '␀' : esc(c)}</mark>` : esc(c);
    return h.replace(/((?:[ .])+)$/, '<mark>$1</mark>');
  }
  /** 絵文字など（BMP 外の文字）を強調する。 */
  function highlightAstral(name) {
    return [...name].map((c) => c.codePointAt(0) > 0xFFFF ? `<mark>${esc(c)}</mark>` : esc(c)).join('');
  }
  /** 分解された濁点・半濁点など（結合文字）を、直前の文字ごと強調する。 */
  function highlightCombining(name) {
    return esc(name).replace(/.\p{M}+/gu, (m) => `<mark>${m}</mark>`);
  }

  /** ファイル一覧（多いときは折りたたむ）。items: [{html, note}] */
  function fileList(items) {
    const LIMIT = 300;
    const ul = el('ul', { class: 'files' });
    for (const it of items.slice(0, LIMIT)) {
      ul.append(el('li', null, el('span', { class: 'path', html: it.html }), it.note ? el('span', { class: 'note', html: it.note }) : null));
    }
    if (items.length > LIMIT) ul.append(el('li', null, t(`ほか ${num(items.length - LIMIT)} 件`, `and ${num(items.length - LIMIT)} more`)));
    return el('details', items.length <= 5 ? { open: '' } : null,
      el('summary', null, t(`該当するファイル・フォルダ（${num(items.length)} 件）`, `Affected files and folders (${num(items.length)})`)), ul);
  }

  function fixBlock(sender, receiver) {
    const box = el('div', { class: 'fix' });
    if (sender) box.append(el('div', null, el('h4', null, t('🛠 zip を作り直す（作成者向け）', '🛠 Re-create the zip (for the sender)')), el('ol', { html: sender.map((s) => `<li>${s}</li>`).join('') })));
    if (receiver) box.append(el('div', null, el('h4', null, t('📥 このまま展開する（受け取った人向け）', '📥 Extract it as is (for the recipient)')), el('ul', { html: receiver.map((s) => `<li>${s}</li>`).join('') })));
    return box;
  }

  /** 根拠となる資料へのリンク。sources: [[label, url]] */
  function sourceLinks(sources) {
    if (!sources || !sources.length) return null;
    return el('p', { class: 'src', html: t('根拠: ', 'Sources: ') + sources.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join(LIST_SEP) });
  }

  const SEV_LABEL = {
    fatal: t('展開不可（zip 全体が無効）', 'Cannot extract (whole zip invalid)'),
    bad: t('展開できない', 'Cannot extract'),
    warn: t('注意', 'Warning'),
    info: t('参考', 'Info'),
  };
  function issueCard(sev, title, why, list, fix, sources) {
    return el('section', { class: `card issue sev-${sev}` },
      el('h3', null, el('span', { class: 'badge' }, SEV_LABEL[sev]), title),
      el('p', { class: 'why', html: why }),
      list, fix, sourceLinks(sources));
  }

  const SEVEN_ZIP = '<a href="https://www.7-zip.org/" target="_blank" rel="noopener">7-Zip</a>';
  const ALT_TOOLS = t(`${SEVEN_ZIP} など、エクスプローラー以外の展開ソフトを使う`, `Use an extraction tool other than Explorer, such as ${SEVEN_ZIP}`);
  /** ALT_TOOLS に補足を付ける。 */
  const altTools = (jaNote, enNote) => ALT_TOOLS + t(`（${jaNote}）`, ` (${enNote})`);
  const psExpand = (zipName, stem) => t('PowerShell で展開する（Microsoft が案内している回避策）', 'Extract with PowerShell (a workaround suggested by Microsoft)') +
    `: <code>Expand-Archive -LiteralPath "${esc(zipName)}" -DestinationPath "C:\\tmp\\${esc(stem)}"</code>`;

  const SRC = {
    msBytes: [t('Microsoft サポートの解説（窓の杜）', 'Microsoft Support explanation (Mado no Mori, Japanese)'), 'https://forest.watch.impress.co.jp/docs/news/2119996.html'],
    box: [t('Box サポート', 'Box Support'), 'https://support.box.com/hc/en-us/articles/43374437409043'],
    pathTooLong: [t('エラー 0x80010135 の解説', 'About error 0x80010135'), 'https://www.winhelponline.com/blog/error-0x80010135-path-too-long-when-extracting-zip-file/'],
    ntfs: [t('Microsoft Learn: ファイル名の上限', 'Microsoft Learn: Maximum path length limitation'), 'https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation'],
    naming: [t('Microsoft Learn: ファイル名の規則', 'Microsoft Learn: Naming files, paths, and namespaces'), 'https://learn.microsoft.com/windows/win32/fileio/naming-a-file'],
    aesQa: ['Microsoft Q&A', 'https://learn.microsoft.com/en-us/answers/a/3828684'],
    lzma: [t('Total Commander フォーラムでの検証', 'Test on the Total Commander forum'), 'https://ghisler.ch/board/viewtopic.php?p=442286'],
    zipReport: [t('ZIP64 / UTF-8 対応状況の調査（Prusa Research）', 'ZIP64 / UTF-8 support report (Prusa Research)'), 'https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf'],
    dell: [t('Dell サポート', 'Dell Support'), t('https://www.dell.com/support/kbdoc/ja-jp/000334778', 'https://www.dell.com/support/kbdoc/en-us/000334778')],
    qaLarge: [t('Microsoft Q&A（24H2 で 0x8000FFFF）', 'Microsoft Q&A (0x8000FFFF on 24H2)'), 'https://learn.microsoft.com/en-us/answers/a/12196710'],
    emoji: [t('Johnny.Decimal サポート', 'Johnny.Decimal Support'), 'https://business.johnnydecimal.com/support/knowledge-base/error-windows-zip'],
    count: [t('Git の修正（ZIP64 終端レコード）', 'Git fix (ZIP64 end records)'), 'https://git.lorimer.id.au/gitweb.git/diff/88329ca8091b16f4bb01e3ea546c8c5e1a5016ec'],
    rar7z: [t('Windows 11 の RAR / 7z 対応', 'RAR / 7z support in Windows 11'), 'https://pureinfotech.com/window-11-extract-rar-7zip-archival-formats/'],
    nfd: [t('BandiNamer（Mac のファイル名を Windows 向けに変換）', 'BandiNamer (converts Mac file names for Windows)'), t('https://jp.bandisoft.com/bandinamer/', 'https://www.bandisoft.com/bandinamer/')],
    qiitaFlag: [t('Mac 作成の ZIP が Windows で文字化けする原因は UTF-8 フラグ（Qiita）', 'Mac-made ZIPs are garbled on Windows because of the UTF-8 flag (Qiita, Japanese)'), 'https://qiita.com/ko1nksm/items/0cce942c5a77574e68b7'],
    appnote: [t('PKWARE APPNOTE（ZIP 仕様、ビット 11 と付録 D）', 'PKWARE APPNOTE (ZIP specification, bit 11 and Appendix D)'), 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT'],
  };

  /** 文字化けした名前の一覧の注記（エクスプローラーでの表示と、拡張子・フォルダが壊れる場合の警告）。 */
  const garbleNote = (x) => [
    x.explorerView != null ? t('エクスプローラーでの表示: ', 'Shown in Explorer as: ') + `<b>${esc(x.explorerView)}</b>` : null,
    x.extLost ? t('⚠ 拡張子が壊れるため、展開後にファイルを開けなくなります', '⚠ The file extension is destroyed, so the extracted file will not open') : null,
    x.dirBecomesFile ? t('⚠ このフォルダは 0 バイトのファイルとして作られます', '⚠ This folder is created as a 0-byte file')
      : x.sepLost ? t('⚠ フォルダの区切り「/」が消え、本来と違うフォルダに展開されます', '⚠ The folder separator "/" is lost, so the file is extracted into the wrong folder') : null,
    x.candidates && x.candidates.length ? x.candidates.map((c) => t(`${esc(c.langName)} として読むと: `, `Read as ${esc(c.langName)}: `) + esc(c.name)).join('<br>') : null,
  ].filter(Boolean).join('<br>') || null;

  const PS_COMPRESS = t(
    'フォルダを含まない場合は、PowerShell の <code>Compress-Archive -Path "ファイル" -DestinationPath "送る.zip"</code> でも作れます（ファイル名を UTF-8 で記録し、UTF-8 フラグも付きます。Windows 11 25H2 で確認）。' +
    'ただし Windows 標準の PowerShell 5.1 は、サブフォルダの区切りを「\\」で記録するため（zip の仕様では「/」）、フォルダを含む zip は Mac などで正しく展開できません',
    'If there are no folders, PowerShell <code>Compress-Archive -Path "file" -DestinationPath "send.zip"</code> also works (it stores names in UTF-8 and sets the UTF-8 flag; verified on Windows 11 25H2). ' +
    'However, the built-in PowerShell 5.1 stores subfolder separators as "\\" (the zip specification requires "/"), so zips containing folders do not extract correctly on macOS and elsewhere');
  const SEVEN_ZIP_CU = t(
    '7-Zip の場合: 「パラメータ」に <code>cu=on</code> を指定する（ファイル名を UTF-8 で記録し、フラグを付けます）',
    '7-Zip: enter <code>cu=on</code> in "Parameters" (stores names in UTF-8 and sets the flag)');
  const ASCII_NAMES = t('ファイル名を英数字だけにしてから圧縮する', 'Rename the files to use only ASCII letters and digits before compressing');
  const encLabel = (enc) => enc === 'shift_jis' ? 'Shift_JIS' : enc === 'utf-8' ? 'UTF-8' : enc;

  // ---------- 描画 ----------
  async function render() {
    results.replaceChildren();
    for (const file of currentFiles) {
      const section = el('div', null, el('div', { class: 'card' }, t(`${file.name} を調べています…`, `Checking ${file.name}…`)));
      results.append(section);
      try {
        const r = await analyzeBlob(file, { zipName: file.name, folder: folderInput.value, oemCodePage: Number(oemSelect.value), lang: LANG });
        section.replaceChildren(...renderResult(file, r));
      } catch (err) {
        section.replaceChildren(el('div', { class: 'card error' }, t(`${file.name}: 読み込めませんでした（${err.message}）`, `${file.name}: could not be read (${err.message})`)));
      }
    }
  }

  function verdict(cls, icon, title, text) {
    return el('div', { class: `verdict ${cls}` }, el('div', { class: 'icon', 'aria-hidden': 'true' }, icon),
      el('div', null, el('h2', null, title), el('p', { html: text })));
  }

  function renderResult(file, r) {
    const out = [el('h2', { class: 'zipname' }, `📦 ${file.name}`)];

    if (r.fatalError) {
      const fmt = r.isRar ? 'RAR' : '7z';
      const ext = r.isRar ? 'rar' : '7z';
      const msgs = {
        notzip: r.isRar || r.is7z
          ? t(`中身は ${fmt} 形式です（拡張子だけ .zip になっています）。エクスプローラーは拡張子で形式を判断するため、zip として開けません。`,
            `This is actually a ${fmt} archive (only the extension is .zip). Explorer decides the format by the extension, so it cannot open it as a zip.`)
          : t('zip ファイルとして読めません。zip ではないか、ダウンロードが途中で切れて壊れています。',
            'This cannot be read as a zip file. It is not a zip, or it was corrupted by an incomplete download.'),
        split: t('分割 zip（.z01, .z02 … と組になったもの）の一部です。エクスプローラーは分割 zip を展開できません。',
          'This is part of a split zip (paired with .z01, .z02, …). Explorer cannot extract split zips.'),
        corrupt: t('zip のファイル一覧（セントラルディレクトリ）が壊れています。ダウンロードが途中で切れた可能性があります。',
          'The zip file list (central directory) is corrupted. The download may have been cut off.'),
      };
      out.push(verdict('v-bad', '⛔', t('エクスプローラーでは展開できません', 'Explorer cannot extract this file'), esc(msgs[r.fatalError] || msgs.corrupt)));
      const sender = r.fatalError === 'split'
        ? [t('分割せずに 1 つの zip として作り直す', 'Re-create it as a single zip without splitting'),
          t('サイズ制限がある場合は、zip を複数の独立した zip に分けて作る', 'If there is a size limit, create several independent zips instead')]
        : r.isRar || r.is7z
          ? [t('zip 形式で圧縮し直す（拡張子だけ変えても zip にはなりません）', 'Compress it again in zip format (renaming the extension does not make it a zip)'),
            t(`または正しい拡張子（.${ext}）で送る`, `Or send it with the correct extension (.${ext})`)]
          : [t('元のファイルから zip を作り直して、もう一度送る', 'Re-create the zip from the original files and send it again')];
      const receiver = r.fatalError === 'split'
        ? [t('すべての分割ファイル（.z01, .z02 … と .zip）を同じフォルダに置き、7-Zip などで .zip を開く', 'Put all parts (.z01, .z02, … and .zip) in the same folder and open the .zip with 7-Zip or similar')]
        : r.isRar || r.is7z
          ? [t(`拡張子を <code>.${ext}</code> に変える。Windows 11 23H2 以降はエクスプローラーで RAR / 7z も展開できます（パスワード付きを除く）`,
            `Change the extension to <code>.${ext}</code>. On Windows 11 23H2 or later, Explorer can also extract RAR / 7z (except password-protected ones)`), ALT_TOOLS]
          : [t('もう一度ダウンロードし直す（ファイルサイズが元と同じか確認）', 'Download it again (check that the file size matches the original)'),
            t('送り主に送り直してもらう', 'Ask the sender to send it again')];
      out.push(el('div', { class: 'card' }, fixBlock(sender, receiver), r.isRar || r.is7z ? sourceLinks([SRC.rar7z]) : null));
      return out;
    }

    const i = r.issues;
    const stem = file.name.replace(/\.zip$/i, '');
    const folder = folderInput.value.trim().replace(/[\\/]+$/, '');
    const oemLabel = esc(oemName(r.oemCodePage, LANG) || t('OEM コードページ', 'the OEM code page'));
    const cards = [];
    let level = 0; // 0: ok, 1: warn, 2: bad, 3: fatal
    const raise = (n) => { level = Math.max(level, n); };

    // --- 致命的: zip 全体が無効 ---
    if (i.tooManyBytes.length) {
      raise(3);
      const maxBytes = Math.max(...i.tooManyBytes.map((x) => x.bytes));
      const isUtf8 = i.tooManyBytes.some((x) => x.encoding === 'utf-8');
      cards.push(issueCard('fatal', t('zip 内のパスが長すぎる（260 バイト以上）', 'A path inside the zip is too long (260 bytes or more)'),
        t(`zip の中のパス（フォルダ名＋ファイル名）が 1 つでも <b>260 バイト以上</b>あると、エクスプローラーは zip 全体を無効と判断し、` +
          `「圧縮 (zip 形式) フォルダーは無効です」と表示して<b>1 つも展開できません</b>。文字数ではなく、zip 内に記録された文字コードでのバイト数で決まります` +
          `（UTF-8 の日本語は 1 文字 3 バイト、約 86 文字が上限）。展開先のフォルダとは関係がなく、LongPathsEnabled の設定でも回避できません。` +
          `最長は <b>${maxBytes} バイト</b>で、<b>${maxBytes - 259} バイト以上</b>短くする必要があります。`,
          `If even one path inside the zip (folders + file name) is <b>260 bytes or longer</b>, Explorer treats the whole zip as invalid, ` +
          `shows "The Compressed (zipped) Folder is invalid", and <b>extracts nothing</b>. The limit is in bytes as stored in the zip, not in characters ` +
          `(in UTF-8, a CJK character takes 3 bytes, so about 86 characters is the limit). It does not depend on the destination folder, and the LongPathsEnabled setting does not help. ` +
          `The longest path is <b>${maxBytes} bytes</b>; it must be shortened by <b>at least ${maxBytes - 259} bytes</b>.`),
        fileList(i.tooManyBytes.sort((a, b) => b.bytes - a.bytes).map((x) => {
          const over = x.bytes - 259;
          const encName = x.encoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS';
          const chars = Math.ceil(over / (x.encoding === 'utf-8' ? 3 : 2));
          return {
            html: highlightParts(x.name, (seg) => seg.length >= 20),
            note: t(`${x.bytes} バイト（${encName}）→ あと ${over} バイト（日本語なら約 ${chars} 文字）短く`,
              `${x.bytes} bytes (${encName}) → shorten by ${over} bytes (about ${chars} CJK characters)`),
          };
        })),
        fixBlock([
          t('フォルダ名・ファイル名を短くして、どのパスも <b>259 バイト以下</b>にする（一覧の黄色の部分が長い名前です）',
            'Shorten folder and file names so that every path is <b>259 bytes or less</b> (long names are highlighted in yellow)'),
          t('フォルダの階層を浅くする（深い入れ子のフォルダをまとめる）', 'Make the folder hierarchy shallower (merge deeply nested folders)'),
          isUtf8 ? t('日本語の長い名前を英数字に置き換えると、バイト数を大きく減らせます', 'Replacing long non-ASCII (e.g. CJK) names with ASCII letters greatly reduces the byte count') : null,
        ].filter(Boolean), [psExpand(file.name, stem), ALT_TOOLS]),
        [SRC.msBytes, SRC.box]));
    }

    // --- 展開できない ---
    if (i.tooLongPart.length) {
      raise(2);
      cards.push(issueCard('bad', t('フォルダ名・ファイル名が長すぎる（256 文字以上）', 'A folder or file name is too long (256 characters or more)'),
        t('Windows のフォルダ名・ファイル名は <b>255 文字まで</b>です。それより長い名前のファイルは作れないため、展開できません。',
          'Windows folder and file names are limited to <b>255 characters</b>. Files with longer names cannot be created, so they cannot be extracted.'),
        fileList(i.tooLongPart.map((x) => ({
          html: highlightParts(x.name, (seg) => seg === x.part),
          note: t(`${x.length} 文字 → ${x.length - 255} 文字以上短く`, `${x.length} characters → shorten by at least ${x.length - 255}`),
        }))),
        fixBlock([t('黄色の名前を <b>255 文字以下</b>（できれば数十文字）に短くして zip を作り直す', 'Shorten the highlighted names to <b>255 characters or less</b> (ideally a few dozen) and re-create the zip')],
          [altTools('展開時に名前を変更できるもの', 'one that can rename files while extracting')]),
        [SRC.ntfs]));
    }
    if (i.strongEnc.length) {
      raise(2);
      cards.push(issueCard('bad', t('PKWARE Strong Encryption で暗号化されている', 'Encrypted with PKWARE Strong Encryption'),
        t('この暗号化方式は、エクスプローラーも多くの展開ソフトも対応していません。', 'Neither Explorer nor most extraction tools support this encryption method.'),
        fileList(i.strongEnc.map((x) => ({ html: esc(x.name) }))),
        fixBlock([t('暗号化なし、または ZipCrypto（従来の zip 暗号化）で作り直す', 'Re-create it without encryption, or with ZipCrypto (traditional zip encryption)')],
          [t('PKWARE 製のソフト（SecureZIP など）で展開する', 'Extract it with PKWARE software (such as SecureZIP)')])));
    }
    if (i.aes.length) {
      raise(2);
      cards.push(issueCard('bad', t('AES で暗号化されている', 'Encrypted with AES'),
        t('エクスプローラーが展開できるパスワード付き zip は、従来の ZipCrypto 暗号化だけです。<b>AES で暗号化された zip は、ファイル一覧は見えても展開できません</b>（7-Zip の「AES-256」などで作った zip）。',
          'Explorer can only extract password-protected zips that use traditional ZipCrypto encryption. <b>AES-encrypted zips show their file list but cannot be extracted</b> (e.g. zips made with "AES-256" in 7-Zip).'),
        fileList(i.aes.map((x) => ({ html: esc(x.name) }))),
        fixBlock([
          t('7-Zip の場合: 「暗号化方式」を <b>ZipCrypto</b> にして作り直す', '7-Zip: set "Encryption method" to <b>ZipCrypto</b> and re-create it'),
          t('または暗号化せずに zip にし、別の安全な方法で渡す', 'Or create the zip without encryption and deliver it by another secure method'),
          t('注意: ZipCrypto は AES より弱い暗号です。機密性が高い場合は、受け取る側に 7-Zip などを使ってもらう方が安全です',
            'Note: ZipCrypto is much weaker than AES. For sensitive data, it is safer to have the recipient use 7-Zip or similar'),
        ], [altTools('パスワードを入力して展開', 'enter the password to extract')]),
        [SRC.aesQa]));
    }
    if (i.unsupportedMethod.length) {
      raise(2);
      const methods = [...new Set(i.unsupportedMethod.map((x) => x.methodName))].join(LIST_SEP);
      cards.push(issueCard('bad', t(`エクスプローラーが対応していない圧縮方式（${esc(methods)}）`, `Compression method not supported by Explorer (${esc(methods)})`),
        t('エクスプローラーが展開できる圧縮方式は <b>Deflate</b>（標準の zip 圧縮）、<b>Deflate64</b>、無圧縮だけです。LZMA や BZip2 などで圧縮されたファイルは「圧縮方式がサポートされていない」として展開できません。',
          'Explorer can only extract <b>Deflate</b> (standard zip compression), <b>Deflate64</b>, and uncompressed (Stored) entries. Files compressed with LZMA, BZip2, etc. fail with an "unsupported compression method" error.'),
        fileList(i.unsupportedMethod.map((x) => ({ html: esc(x.name), note: esc(x.methodName) }))),
        fixBlock([
          t('圧縮方式を <b>Deflate</b> にして作り直す（7-Zip の場合: 書庫形式 zip、圧縮方式 Deflate）', 'Re-create it with the <b>Deflate</b> method (7-Zip: archive format zip, compression method Deflate)'),
          t('またはエクスプローラーの「圧縮先 → ZIP ファイル」で作る', 'Or create it with Explorer\'s "Compress to → ZIP File"'),
        ], [ALT_TOOLS]),
        [SRC.lzma]));
    }
    if (i.invalidName.length) {
      raise(2);
      cards.push(issueCard('bad', t('Windows で使えない名前がある', 'Some names are not allowed on Windows'),
        t('Windows では <code>: ? * | &lt; &gt; "</code> などの文字、<code>CON</code> <code>NUL</code> <code>COM1</code> などの予約名、末尾のドット・空白をファイル名に使えません。Mac や Linux で作った zip によくあり、エクスプローラーでは<b>エラーになって展開が止まります</b>。',
          'Windows does not allow characters such as <code>: ? * | &lt; &gt; "</code>, reserved names such as <code>CON</code> <code>NUL</code> <code>COM1</code>, or trailing dots and spaces in file names. This is common in zips made on macOS or Linux, and Explorer <b>stops with an error</b>.'),
        fileList(i.invalidName.map((x) => ({
          html: x.parts.map((p) => highlightInvalidChars(p.part)).join(' ／ ') + (x.parts.length === 1 && x.parts[0].part === x.name ? '' : `<span class="note">${esc(x.name)}</span>`),
          note: x.parts.map((p) => `${esc(p.reason)} → ${t('例: ', 'e.g. ')}<code>${esc(p.fixed)}</code>`).join('<br>'),
        }))),
        fixBlock([
          t('黄色の文字を取り除くか、別の文字（全角の <code>：？＊｜＜＞”</code> や <code>_</code>）に置き換えて名前を変更する',
            'Remove the highlighted characters or replace them with others (such as <code>_</code> or <code>-</code>)'),
          t('予約名（CON, PRN, AUX, NUL, COM1〜9, LPT1〜9）は、前に文字を付けるなど別の名前にする', 'Rename reserved names (CON, PRN, AUX, NUL, COM1–9, LPT1–9), e.g. by adding a prefix'),
          t('名前の末尾のドット・空白を削除する', 'Remove trailing dots and spaces from names'),
          t('その後 zip を作り直す', 'Then re-create the zip'),
        ], [altTools('使えない文字を自動で置き換えて展開できるもの', 'one that automatically replaces invalid characters')]),
        [SRC.naming]));
    }
    if (i.tooManyEntries.length) {
      raise(2);
      const count = num(i.tooManyEntries[0].count);
      cards.push(issueCard('bad', t(`ファイル数が 65,535 を超えている（${count} 件）`, `More than 65,535 entries (${count})`),
        t('通常の zip の件数欄は 65,535 件までです。それを超えるのに ZIP64 形式の終端レコードがないため、エクスプローラーでは<b>一部のファイルしか見えず、展開もされません</b>。',
          'The entry count field of a standard zip holds at most 65,535. This zip exceeds that without a ZIP64 end record, so Explorer <b>sees and extracts only some of the files</b>.'),
        null,
        fixBlock([t('ZIP64 に対応したソフト（7-Zip、エクスプローラーの「圧縮先 → ZIP ファイル」など）で作り直す', 'Re-create it with a ZIP64-capable tool (7-Zip, Explorer\'s "Compress to → ZIP File", etc.)'),
          t('または複数の zip に分ける', 'Or split it into several zips')], [ALT_TOOLS]),
        [SRC.count]));
    }
    if (i.longPath.length) {
      raise(2);
      const maxFull = Math.max(...i.longPath.map((x) => x.length));
      const maxFolder = 257 - stem.length - r.maxRelLen;
      cards.push(issueCard('bad', t('展開先のパスが長すぎる（260 文字以上）', 'Destination paths are too long (260 characters or more)'),
        t(`エクスプローラーは <code>${esc(r.explorerDest)}\\</code> に展開します。展開後のパスが <b>260 文字以上</b>になるファイルは「エラー 0x80010135: パスが長すぎます」となり展開されません（最長 ${maxFull} 文字）。LongPathsEnabled の設定をしても、エクスプローラーには効きません。`,
          `Explorer extracts to <code>${esc(r.explorerDest)}\\</code>. Files whose extracted path is <b>260 characters or longer</b> fail with "Error 0x80010135: Path too long" and are not extracted (longest: ${maxFull} characters). The LongPathsEnabled setting does not apply to Explorer.`),
        fileList(i.longPath.sort((a, b) => b.length - a.length).map((x) => ({
          html: esc(x.name),
          note: t(`展開後 ${x.length} 文字 → ${x.length - 259} 文字以上短く`, `${x.length} characters after extraction → shorten by at least ${x.length - 259}`),
        }))),
        fixBlock([
          t('フォルダ名・ファイル名を短くする、フォルダの階層を浅くする', 'Shorten folder and file names, or make the hierarchy shallower'),
          t(`zip のファイル名（${stem.length} 文字）を短くする（展開先のフォルダ名になります）`, `Shorten the zip file name (${stem.length} characters); it becomes the destination folder name`),
        ], [
          maxFolder >= 3
            ? t(`zip を <code>C:\\tmp</code> など<b>短いパスのフォルダ</b>に移してから展開する（フォルダのパスを <b>${maxFolder} 文字以内</b>に。今は ${folder.length} 文字）`,
              `Move the zip to a <b>folder with a short path</b> such as <code>C:\\tmp</code> before extracting (keep the folder path within <b>${maxFolder} characters</b>; currently ${folder.length})`)
            : t('zip 内のパスが長すぎるため、フォルダを移すだけでは解決しません。zip を作り直してもらうか、別の展開ソフトを使ってください',
              'The paths inside the zip are too long to fix by moving it. Ask for a re-created zip, or use another extraction tool'),
          t('「すべて展開」の展開先を短いパスに変更する', 'Change the destination in "Extract All" to a short path'),
          t('zip のファイル名を短く変更してから展開する', 'Rename the zip to a shorter name before extracting'),
          ALT_TOOLS,
        ]),
        [SRC.pathTooLong]));
    }

    // --- 注意 ---
    if (i.caseCollision.length) {
      raise(1);
      cards.push(issueCard('warn', t('大文字・小文字だけが違う同じ名前がある', 'Names that differ only in letter case'),
        t('Windows は名前の大文字・小文字を区別しないため、<code>Readme.txt</code> と <code>README.txt</code> のような名前は同じファイルとして扱われます。展開時に上書きの確認が出て、<b>どちらか一方しか残りません</b>。Linux や Mac で作った zip で起こります。',
          'Windows does not distinguish letter case in names, so <code>Readme.txt</code> and <code>README.txt</code> are treated as the same file. Explorer asks whether to overwrite, and <b>only one of them is kept</b>. This happens with zips made on Linux or macOS.'),
        fileList(i.caseCollision.map((x) => ({
          html: esc(x.name),
          note: x.duplicate ? t('同じ名前が zip 内に 2 回入っています', 'The same name appears twice in the zip') : t(`${esc(x.other)} と衝突`, `Conflicts with ${esc(x.other)}`),
        }))),
        fixBlock([t('どちらかの名前を変える（大文字・小文字以外の違いを付ける）か、別のフォルダに分けて zip を作り直す', 'Rename one of them (make them differ by more than case) or put them in separate folders, then re-create the zip')],
          [t('上書きの確認で「ファイルを置き換えずにスキップする」を選ぶと、先に展開した方が残ります', 'Choosing "Skip these files" when asked to replace keeps the one extracted first'),
            altTools('自動で名前を変えて両方残せるもの', 'one that can auto-rename to keep both')])));
    }
    if (i.garbled.length) {
      raise(1);
      const encName = r.encoding === 'shift_jis' ? 'Shift_JIS' : 'UTF-8';
      cards.push(issueCard('warn', t('ファイル名が文字化けする', 'File names will be garbled'),
        t(`ファイル名が <b>${encName}</b> で記録されていますが、UTF-8 フラグも Unicode 名の拡張フィールドもありません。エクスプローラーはフラグのない名前を ${oemLabel} として読むため、<b>名前が文字化け</b>します。`,
          `File names are stored in <b>${encName}</b>, but there is neither the UTF-8 flag nor a Unicode Path extra field. Explorer reads unflagged names as ${oemLabel}, so <b>the names become garbled</b>. `) +
        (r.oemCodePage === 932
          ? t('Shift_JIS で読めないバイトの並びは「・」になり、<b>直後の 1 文字（「.」「_」「/」など）も一緒に消えることがあります</b>。拡張子の「.」が消えると展開したファイルを開けなくなり、フォルダの区切り「/」が消えるとフォルダが 0 バイトのファイルになったり、中身が別の場所に展開されたりします。',
            'Byte sequences that are invalid in Shift_JIS become "・", and <b>the next character (such as ".", "_", or "/") may be swallowed with them</b>. If the "." of an extension is lost, the extracted file will not open; if a "/" folder separator is lost, a folder may become a 0-byte file or its contents may land in the wrong place. ')
          : '') +
        t('Mac の「圧縮」や古いツールで作った zip によくあります。', 'This is common in zips made with macOS "Compress" or older tools.'),
        fileList(i.garbled.map((x) => ({ html: esc(x.name), note: garbleNote(x) }))),
        fixBlock([
          t('ファイル名を UTF-8 で記録し、<b>UTF-8 フラグを付けて</b>作り直す。文字コードが UTF-8 でも、フラグがないとエクスプローラーは UTF-8 として読みません',
            'Re-create it with names stored in UTF-8 <b>and the UTF-8 flag set</b>. Even if names are UTF-8, Explorer does not read them as UTF-8 without the flag'),
          PS_COMPRESS,
          SEVEN_ZIP_CU,
          t('Mac の場合: macOS 標準の「圧縮」は UTF-8 フラグを付けません。ファイル名を英数字にしてから圧縮するか、UTF-8 フラグを付けられる圧縮ソフト（Keka など）を使う',
            'macOS: the built-in "Compress" does not set the UTF-8 flag. Rename files to ASCII before compressing, or use an archiver that can set the UTF-8 flag (such as Keka)'),
        ], [altTools('文字コードを指定・自動判定できるもの', 'one that can specify or auto-detect the encoding')]),
        [SRC.qiitaFlag, SRC.appnote, SRC.zipReport]));
    }
    if (i.undecodable.length) {
      raise(1);
      cards.push(issueCard('warn', t('ファイル名の文字コードがわからない（文字化けします）', 'Unknown file name encoding (names will be garbled)'),
        t('UTF-8 フラグのないファイル名が、UTF-8 としても Shift_JIS としても正しく読めません。ほかの言語の Windows や古いツールで作られた zip と考えられ、<b>エクスプローラーでは名前が文字化け</b>します（化けた名前に使えない文字が含まれると、展開に失敗することもあります）。',
          'File names without the UTF-8 flag cannot be read correctly as either UTF-8 or Shift_JIS. The zip was probably made on Windows in another language or with an old tool, and <b>Explorer will show garbled names</b> (extraction may fail if the garbled names contain invalid characters).'),
        fileList(i.undecodable.map((x) => ({ html: esc(x.name), note: garbleNote(x) }))),
        fixBlock([
          t('作成した PC の言語・ソフトを確認し、ファイル名を UTF-8 で記録し UTF-8 フラグを付ける設定で作り直す（7-Zip なら「パラメータ」に <code>cu=on</code>）',
            'Check the language and software of the PC that made it, and re-create it with names stored in UTF-8 and the UTF-8 flag set (7-Zip: <code>cu=on</code> in "Parameters")'),
          PS_COMPRESS,
          ASCII_NAMES,
        ], [altTools('文字コードを指定して展開できるもの', 'one that lets you specify the encoding')]),
        [SRC.appnote]));
    }
    if (i.foreign.length) {
      raise(1);
      const langs = [...new Set(i.foreign.flatMap((x) => x.candidates.map((c) => c.langName)))];
      cards.push(issueCard('warn', t('ファイル名が中国語・韓国語の文字コードで記録されている（文字化けします）', 'File names are stored in a Chinese or Korean encoding (names will be garbled)'),
        t(`UTF-8 フラグのないファイル名が、${langs.length ? `<b>${esc(langs.join('・'))}</b> など` : '中国語・韓国語など'}、日本語以外の文字コードで記録されているようです。` +
          'Shift_JIS としても読めてしまうため、<b>日本語版 Windows のエクスプローラーでもエラーにならず、半角カナと漢字が混ざった別の名前で展開されます</b>。' +
          '中国語版・韓国語版の Windows や、その地域の圧縮ソフトで作った zip で起こります。',
          `File names without the UTF-8 flag appear to be stored in a non-Japanese encoding such as ${langs.length ? `<b>${esc(langs.join(' / '))}</b>` : 'Chinese or Korean'}. ` +
          'Because the bytes also happen to be valid Shift_JIS, <b>Explorer on Japanese Windows shows no error but extracts them under different names mixing half-width katakana and kanji</b>. ' +
          'This happens with zips made on Chinese or Korean Windows or with archivers from those regions.'),
        fileList(i.foreign.map((x) => ({ html: esc(x.name), note: garbleNote({ ...x, explorerView: r.oemCodePage === 932 ? null : x.explorerView }) }))),
        fixBlock([
          t('ファイル名を UTF-8 で記録し、UTF-8 フラグを付けて作り直す（7-Zip なら「パラメータ」に <code>cu=on</code>）', 'Re-create it with names stored in UTF-8 and the UTF-8 flag set (7-Zip: <code>cu=on</code> in "Parameters")'),
          PS_COMPRESS,
          ASCII_NAMES,
        ], [altTools('文字コードを指定して展開できるもの。7-Zip ならコマンドラインの <code>-mcp=936</code>（中国語）や <code>-mcp=949</code>（韓国語）',
          'one that lets you specify the encoding; with 7-Zip, use <code>-mcp=936</code> (Chinese) or <code>-mcp=949</code> (Korean) on the command line')]),
        [SRC.appnote]));
    }
    if (i.badUtf8Flag.length) {
      raise(1);
      const folders = i.badUtf8Flag.some((x) => x.extraFolders);
      const sjis = i.badUtf8Flag.some((x) => x.sjisName != null);
      cards.push(issueCard('warn', t('UTF-8 フラグが付いているのに、ファイル名が UTF-8 ではない', 'The UTF-8 flag is set, but file names are not UTF-8'),
        t('zip には「ファイル名は UTF-8」という印（UTF-8 フラグ）が付いていますが、実際の名前は UTF-8 として正しくありません', 'The zip says "names are UTF-8" (the UTF-8 flag), but the actual names are not valid UTF-8') +
        (sjis ? t('（<b>Shift_JIS</b> で記録されています）', ' (they are stored in <b>Shift_JIS</b>)') : '') +
        t('。作成したソフトの不具合です。エクスプローラーはフラグを信じて UTF-8 として読むため、読めない部分が <b>「�」</b> に置き換わって文字化けします。',
          '. This is a bug in the software that created it. Explorer trusts the flag and reads the names as UTF-8, so unreadable parts are replaced with <b>"�"</b>. ') +
        (folders ? t('さらに、Shift_JIS の「表」「ソ」「能」などに含まれるバイト 0x5C が <b>フォルダの区切り「\\」として扱われ、意図しないフォルダが作られます</b>。',
          'In addition, byte 0x5C contained in Shift_JIS characters such as 表, ソ, and 能 is <b>treated as the folder separator "\\", creating unintended folders</b>.') : ''),
        fileList(i.badUtf8Flag.map((x) => ({
          html: esc(x.name),
          note: [t('エクスプローラーでの表示: ', 'Shown in Explorer as: ') + `<b>${esc(x.explorerView)}</b>`,
            x.sjisName != null ? t('本来の名前（Shift_JIS）: ', 'Intended name (Shift_JIS): ') + esc(x.sjisName) : null,
            x.extraFolders ? t('⚠ 「\\」の位置でフォルダが分かれて展開されます', '⚠ The path is split into folders at each "\\"') : null].filter(Boolean).join('<br>'),
        }))),
        fixBlock([
          t('別の圧縮ソフトで作り直す（ファイル名を UTF-8 で記録し UTF-8 フラグを付けるもの）', 'Re-create it with another archiver (one that stores names in UTF-8 and sets the UTF-8 flag)'),
          PS_COMPRESS,
          t('作成に使ったソフトを最新版にする', 'Update the software used to create it'),
        ], [altTools('文字コードを Shift_JIS に指定して展開できるもの', 'one that lets you choose Shift_JIS as the encoding')]),
        [SRC.appnote]));
    }
    if (i.localeDependent.length) {
      raise(1);
      const encName = esc(encLabel(i.localeDependent[0].encoding));
      cards.push(issueCard('warn', t('受け取る PC によってはファイル名が文字化けする', 'File names may be garbled on some PCs'),
        t(`ファイル名が <b>${encName}</b> で記録されていて、UTF-8 フラグがありません。選択中の言語（${oemLabel}）の Windows では正しく表示されますが、`,
          `File names are stored in <b>${encName}</b> without the UTF-8 flag. They display correctly on Windows in the selected language (${oemLabel}), but `) +
        (r.oemCodePage === 932
          ? t('<b>英語版などほかの言語の Windows、「ワールドワイド言語サポートで Unicode UTF-8 を使用」（ベータ）を有効にした Windows、Mac</b> では文字化けします。',
            '<b>they are garbled on Windows in other languages (such as English), on Windows with "Beta: Use Unicode UTF-8 for worldwide language support" enabled, and on macOS</b>. ')
          : t('<b>日本語版など、ほかの言語の Windows</b> では文字化けします。', '<b>they are garbled on Windows in other languages</b>. ')) +
        t('日本語版 Windows のエクスプローラーの「送る → 圧縮 (zip 形式) フォルダー」（Shift_JIS で記録し、フラグを付けません。Windows 11 25H2 で確認）や古い圧縮ソフトで作った zip が、この状態になります。',
          'Zips made with "Send to → Compressed (zipped) folder" on Japanese Windows (which stores Shift_JIS without the flag; verified on Windows 11 25H2) or with older archivers end up like this.'),
        fileList(i.localeDependent.map((x) => ({ html: esc(x.name) }))),
        fixBlock([
          PS_COMPRESS,
          t('7-Zip で作る場合は「パラメータ」に <code>cu=on</code> を指定する（ファイル名を UTF-8 で記録し、フラグを付けます）', 'With 7-Zip, enter <code>cu=on</code> in "Parameters" (stores names in UTF-8 and sets the flag)'),
          t('送り先の環境がわからない場合は、ファイル名を英数字にしておく', 'If you do not know the recipient\'s environment, use ASCII-only file names'),
        ], [r.oemCodePage === 932
          ? t('日本語版 Windows（UTF-8 ベータ設定なし）のエクスプローラーなら、そのまま展開できます', 'Explorer on Japanese Windows (without the UTF-8 beta setting) can extract it as is')
          : t(`${oemLabel} の Windows のエクスプローラーなら、そのまま展開できます`, `Explorer on Windows using ${oemLabel} can extract it as is`),
        altTools('文字コードを指定して展開できるもの', 'one that lets you specify the encoding')]),
        [SRC.zipReport]));
    }
    if (i.nfd.length) {
      raise(1);
      cards.push(issueCard('warn', t('濁点・半濁点が分離した名前になる（Mac で作った zip）', 'Names in decomposed form (zip made on a Mac)'),
        t('Mac はファイル名の「が」「パ」などを「か＋゛」「ハ＋゜」のように分解した形（NFD）で記録することがあります。Windows ではこのまま展開されるため、<b>「か゛」のように濁点が分離して見えたり、検索や並べ替えでほかのファイルと一致しなかったり</b>します。',
          'macOS may store names in decomposed form (NFD), e.g. "é" as "e" + a combining accent, or Japanese "が" as "か" + "゛". Windows extracts them as is, so <b>accents and marks may look detached, and names may not match other files in search or sorting</b>.'),
        fileList(i.nfd.map((x) => ({ html: highlightCombining(x.name), note: t('正しい形: ', 'Composed form: ') + esc(x.nfc) }))),
        fixBlock([
          t('Mac で、ファイル名を NFC 形式に変換してから圧縮する（Bandizip for Mac や BandiNamer などの変換機能を使う）', 'On the Mac, convert names to NFC before compressing (using the conversion feature of Bandizip for Mac, BandiNamer, etc.)'),
          t('濁点・半濁点を含む名前を英数字に変えてから圧縮する', 'Rename such files to ASCII before compressing'),
        ], [t('展開後に名前を付け直す', 'Rename the files after extracting'),
          t('BandiNamer（Windows 版）などで、ファイル名を NFC 形式にまとめて変換する', 'Batch-convert names to NFC with BandiNamer (Windows version) or similar')]),
        [SRC.nfd]));
    }
    if (i.emoji.length) {
      raise(1);
      const chars = esc([...new Set(i.emoji.map((x) => x.chars).join(''))].slice(0, 10).join(' '));
      cards.push(issueCard('warn', t('絵文字などを含む名前がある', 'Names containing emoji or similar characters'),
        t(`絵文字など一部の文字（${chars}）を含むファイル名があると、エクスプローラーで「zip が無効です」となって開けないという報告があります。UTF-8 では 1 文字 4 バイトになるため、260 バイトの制限にも達しやすくなります。`,
          `There are reports that Explorer says the zip is invalid and cannot open it when file names contain emoji or similar characters (${chars}). They take 4 bytes each in UTF-8, so the 260-byte limit is also reached sooner.`),
        fileList(i.emoji.map((x) => ({ html: highlightAstral(x.name) }))),
        fixBlock([t('黄色の文字を名前から取り除いて zip を作り直す', 'Remove the highlighted characters from the names and re-create the zip')], [ALT_TOOLS]),
        [SRC.emoji]));
    }
    if (i.largeArchive.length) {
      raise(1);
      const x = i.largeArchive[0];
      cards.push(issueCard('warn', t(`サイズが大きい（展開後 ${fmtSize(x.total)}）`, `Large archive (${fmtSize(x.total)} when extracted)`),
        t('数 GB の zip をエクスプローラーで展開すると、途中で「データ エラー」「エラー 0x80004005」「エラー 0x8000FFFF: 致命的なエラー」となって失敗するという報告があります（Windows 11 24H2 では 1.5 GB を超えたあたりから失敗するという報告もあります）。',
          'There are reports that extracting multi-GB zips with Explorer fails partway with "Data error", "Error 0x80004005", or "Error 0x8000FFFF: Catastrophic failure" (on Windows 11 24H2, failures have been reported above about 1.5 GB).'),
        null,
        fixBlock([t('複数の zip に分けて作る', 'Split it into several zips')], [psExpand(file.name, stem), ALT_TOOLS]),
        [SRC.dell, SRC.qaLarge]));
    }

    // --- 参考 ---
    if (i.zipCrypto.length) {
      cards.push(issueCard('info', t('パスワード付き（ZipCrypto）', 'Password-protected (ZipCrypto)'),
        t('エクスプローラーで展開できます。展開時にパスワードを聞かれます。ただし日本語などを含むパスワードは、作成したソフトによっては通らないことがあります。',
          'Explorer can extract it and will ask for the password. However, passwords containing non-ASCII characters may not work, depending on the software that created the zip.'),
        fileList(i.zipCrypto.map((x) => ({ html: esc(x.name) }))), null));
    }

    // --- 総合判定 ---
    let head;
    if (r.entries.length === 0) {
      head = verdict('v-warn', '⚠', t('空の zip です', 'The zip is empty'), t('この zip にはファイルが 1 つも入っていません。', 'This zip contains no files.'));
    } else if (level === 3) {
      head = verdict('v-bad', '⛔', t('エクスプローラーでは展開できません（zip 全体が無効になります）', 'Explorer cannot extract this zip (the whole zip is invalid)'),
        t('「圧縮 (zip 形式) フォルダーは無効です」と表示され、何も展開されません。下の <b>🛠 zip を作り直す</b> の手順で直してください。',
          'Explorer shows "The Compressed (zipped) Folder is invalid" and extracts nothing. Fix it with the steps under <b>🛠 Re-create the zip</b> below.'));
    } else if (level === 2) {
      head = verdict('v-bad', '⛔', t('エクスプローラーでは一部またはすべて展開できません', 'Explorer cannot extract some or all files'), t('下の問題を直すと展開できるようになります。', 'Fixing the problems below will make it extractable.'));
    } else if (level === 1) {
      head = verdict('v-warn', '⚠', t('展開できる可能性はありますが、問題があります', 'It may extract, but there are problems'), t('下の注意点と直し方を確認してください。', 'Check the warnings and fixes below.'));
    } else {
      head = verdict('v-ok', '✅', t('エクスプローラーで展開できます', 'Explorer can extract this zip'), t('エクスプローラーで展開できなくなる問題は見つかりませんでした。', 'No problems that would prevent extraction with Explorer were found.'));
    }
    out.push(head);

    if (!folder && !i.longPath.length && level < 3 && r.entries.length) {
      const maxFolder = 257 - stem.length - r.maxRelLen;
      cards.push(el('div', { class: 'card' },
        el('p', { style: 'margin:0', html:
          t('💡 展開先のパスの長さは判定していません。上の「zip を置くフォルダ」を入力すると判定します。',
            '💡 Destination path length was not checked. Enter the "Folder where the zip is placed" above to check it. ') +
          (maxFolder >= 3
            ? t(`目安: zip を置くフォルダのパスが <b>${maxFolder} 文字以内</b>なら問題ありません。`, `As a guide, a folder path of <b>${maxFolder} characters or less</b> is fine.`)
            : t('この zip は中のパスが長いため、どのフォルダに置いても 260 文字を超えます。', 'The paths in this zip are so long that they exceed 260 characters in any folder.')) })));
    }

    const dirs = r.entries.filter((e) => /[\/\\]$/.test(e.name)).length;
    const files = r.entries.length - dirs;
    const encText = i.badUtf8Flag.length ? t('UTF-8 フラグあり（中身は UTF-8 ではない）', 'UTF-8 flag set (but not actually UTF-8)')
      : r.encoding === null ? t('UTF-8（フラグあり）', 'UTF-8 (flagged)')
        : r.encoding === 'shift_jis' ? t('Shift_JIS（フラグなし）', 'Shift_JIS (no flag)')
          : r.entries.some((e) => e.nameBytes.some((b) => b >= 0x80)) ? t('UTF-8（一部フラグなし）', 'UTF-8 (some without flag)') : 'ASCII';
    out.push(el('div', { class: 'meta', html: [
      t(`ファイル数 <b>${num(files)}</b>`, `<b>${num(files)}</b> ${plural(files, 'file', 'files')}`),
      dirs ? t(`フォルダ <b>${num(dirs)}</b>`, `<b>${num(dirs)}</b> ${plural(dirs, 'folder', 'folders')}`) : null,
      t(`サイズ <b>${fmtSize(r.size)}</b>（展開後 ${fmtSize(r.totalUncompressed)}）`, `Size <b>${fmtSize(r.size)}</b> (${fmtSize(r.totalUncompressed)} extracted)`),
      t('ファイル名の文字コード ', 'Name encoding ') + `<b>${encText}</b>`,
      r.zip64 ? '<b>ZIP64</b>' : null,
      r.explorerDest ? t('展開先 ', 'Destination ') + `<b>${esc(r.explorerDest)}\\</b>` : null,
      r.truncated ? `<span class="error">${t('ファイル一覧の一部が読めませんでした（破損の可能性）', 'Part of the file list could not be read (possibly corrupted)')}</span>` : null,
    ].filter(Boolean).map((s) => `<span>${s}</span>`).join('') }));

    out.push(...cards);
    return out;
  }
})();
