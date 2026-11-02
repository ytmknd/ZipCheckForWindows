(function () {
  'use strict';
  const { analyzeBlob, OEM_CODEPAGES } = window.ZipCheckForWindows;
  const STORE = 'zipcheckforwindows.';

  const $ = (id) => document.getElementById(id);
  const drop = $('drop');
  const picker = $('picker');
  const folderInput = $('folder');
  const oemSelect = $('oem');
  const results = $('results');

  let currentFiles = [];

  for (const [cp, { name }] of Object.entries(OEM_CODEPAGES)) {
    const opt = document.createElement('option');
    opt.value = cp;
    opt.textContent = name;
    oemSelect.appendChild(opt);
  }
  oemSelect.value = '932';

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
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
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
    if (items.length > LIMIT) ul.append(el('li', null, `ほか ${items.length - LIMIT} 件`));
    return el('details', items.length <= 5 ? { open: '' } : null, el('summary', null, `該当するファイル・フォルダ（${items.length} 件）`), ul);
  }

  function fixBlock(sender, receiver) {
    const box = el('div', { class: 'fix' });
    if (sender) box.append(el('div', null, el('h4', null, '🛠 zip を作り直す（作成者向け）'), el('ol', { html: sender.map((s) => `<li>${s}</li>`).join('') })));
    if (receiver) box.append(el('div', null, el('h4', null, '📥 このまま展開する（受け取った人向け）'), el('ul', { html: receiver.map((s) => `<li>${s}</li>`).join('') })));
    return box;
  }

  /** 根拠となる資料へのリンク。sources: [[label, url]] */
  function sourceLinks(sources) {
    if (!sources || !sources.length) return null;
    return el('p', { class: 'src', html: '根拠: ' + sources.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('、') });
  }

  const SEV_LABEL = { fatal: '展開不可（zip 全体が無効）', bad: '展開できない', warn: '注意', info: '参考' };
  function issueCard(sev, title, why, list, fix, sources) {
    return el('section', { class: `card issue sev-${sev}` },
      el('h3', null, el('span', { class: 'badge' }, SEV_LABEL[sev]), title),
      el('p', { class: 'why', html: why }),
      list, fix, sourceLinks(sources));
  }

  const ALT_TOOLS = '<a href="https://www.7-zip.org/" target="_blank" rel="noopener">7-Zip</a> など、エクスプローラー以外の展開ソフトを使う';
  const psExpand = (zipName, stem) =>
    `PowerShell で展開する（Microsoft が案内している回避策）: <code>Expand-Archive -LiteralPath "${esc(zipName)}" -DestinationPath "C:\\tmp\\${esc(stem)}"</code>`;

  const SRC = {
    msBytes: ['Microsoft サポートの解説（窓の杜）', 'https://forest.watch.impress.co.jp/docs/news/2119996.html'],
    box: ['Box サポート', 'https://support.box.com/hc/en-us/articles/43374437409043'],
    pathTooLong: ['エラー 0x80010135 の解説', 'https://www.winhelponline.com/blog/error-0x80010135-path-too-long-when-extracting-zip-file/'],
    ntfs: ['Microsoft Learn: ファイル名の上限', 'https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation'],
    naming: ['Microsoft Learn: ファイル名の規則', 'https://learn.microsoft.com/windows/win32/fileio/naming-a-file'],
    aesQa: ['Microsoft Q&A', 'https://learn.microsoft.com/en-us/answers/a/3828684'],
    lzma: ['Total Commander フォーラムでの検証', 'https://ghisler.ch/board/viewtopic.php?p=442286'],
    zipReport: ['ZIP64 / UTF-8 対応状況の調査（Prusa Research）', 'https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf'],
    dell: ['Dell サポート', 'https://www.dell.com/support/kbdoc/ja-jp/000334778'],
    qaLarge: ['Microsoft Q&A（24H2 で 0x8000FFFF）', 'https://learn.microsoft.com/en-us/answers/a/12196710'],
    emoji: ['Johnny.Decimal サポート', 'https://business.johnnydecimal.com/support/knowledge-base/error-windows-zip'],
    count: ['Git の修正（ZIP64 終端レコード）', 'https://git.lorimer.id.au/gitweb.git/diff/88329ca8091b16f4bb01e3ea546c8c5e1a5016ec'],
    rar7z: ['Windows 11 の RAR / 7z 対応', 'https://pureinfotech.com/window-11-extract-rar-7zip-archival-formats/'],
    nfd: ['BandiNamer（Mac のファイル名を Windows 向けに変換）', 'https://jp.bandisoft.com/bandinamer/'],
    qiitaFlag: ['Mac 作成の ZIP が Windows で文字化けする原因は UTF-8 フラグ（Qiita）', 'https://qiita.com/ko1nksm/items/0cce942c5a77574e68b7'],
    appnote: ['PKWARE APPNOTE（ZIP 仕様、ビット 11 と付録 D）', 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT'],
  };

  /** 文字化けした名前の一覧の注記（エクスプローラーでの表示と、拡張子が壊れる場合の警告）。 */
  const garbleNote = (x) => [
    x.explorerView != null ? `エクスプローラーでの表示: <b>${esc(x.explorerView)}</b>` : null,
    x.extLost ? '⚠ 拡張子が壊れるため、展開後にファイルを開けなくなります' : null,
    x.dirBecomesFile ? '⚠ このフォルダは 0 バイトのファイルとして作られます'
      : x.sepLost ? '⚠ フォルダの区切り「/」が消え、本来と違うフォルダに展開されます' : null,
    x.candidates && x.candidates.length ? x.candidates.map((c) => `${esc(c.langName)} として読むと: ${esc(c.name)}`).join('<br>') : null,
  ].filter(Boolean).join('<br>') || null;

  const PS_COMPRESS = 'フォルダを含まない場合は、PowerShell の <code>Compress-Archive -Path "ファイル" -DestinationPath "送る.zip"</code> でも作れます（ファイル名を UTF-8 で記録し、UTF-8 フラグも付きます。Windows 11 25H2 で確認）。' +
    'ただし Windows 標準の PowerShell 5.1 は、サブフォルダの区切りを「\\」で記録するため（zip の仕様では「/」）、フォルダを含む zip は Mac などで正しく展開できません';

  // ---------- 描画 ----------
  async function render() {
    results.replaceChildren();
    for (const file of currentFiles) {
      const section = el('div', null, el('div', { class: 'card' }, `${file.name} を調べています…`));
      results.append(section);
      try {
        const r = await analyzeBlob(file, { zipName: file.name, folder: folderInput.value, oemCodePage: Number(oemSelect.value) });
        section.replaceChildren(...renderResult(file, r));
      } catch (err) {
        section.replaceChildren(el('div', { class: 'card error' }, `${file.name}: 読み込めませんでした（${err.message}）`));
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
      const msgs = {
        notzip: r.isRar ? '中身は RAR 形式です（拡張子だけ .zip になっています）。エクスプローラーは拡張子で形式を判断するため、zip として開けません。'
          : r.is7z ? '中身は 7z 形式です（拡張子だけ .zip になっています）。エクスプローラーは拡張子で形式を判断するため、zip として開けません。'
          : 'zip ファイルとして読めません。zip ではないか、ダウンロードが途中で切れて壊れています。',
        split: '分割 zip（.z01, .z02 … と組になったもの）の一部です。エクスプローラーは分割 zip を展開できません。',
        corrupt: 'zip のファイル一覧（セントラルディレクトリ）が壊れています。ダウンロードが途中で切れた可能性があります。',
      };
      out.push(verdict('v-bad', '⛔', 'エクスプローラーでは展開できません', esc(msgs[r.fatalError] || msgs.corrupt)));
      const sender = r.fatalError === 'split'
        ? ['分割せずに 1 つの zip として作り直す', 'サイズ制限がある場合は、zip を複数の独立した zip に分けて作る']
        : r.isRar || r.is7z ? ['zip 形式で圧縮し直す（拡張子だけ変えても zip にはなりません）', `または正しい拡張子（.${r.isRar ? 'rar' : '7z'}）で送る`]
        : ['元のファイルから zip を作り直して、もう一度送る'];
      const receiver = r.fatalError === 'split'
        ? ['すべての分割ファイル（.z01, .z02 … と .zip）を同じフォルダに置き、7-Zip などで .zip を開く']
        : r.isRar || r.is7z ? [`拡張子を <code>.${r.isRar ? 'rar' : '7z'}</code> に変える。Windows 11 23H2 以降はエクスプローラーで RAR / 7z も展開できます（パスワード付きを除く）`, ALT_TOOLS]
        : ['もう一度ダウンロードし直す（ファイルサイズが元と同じか確認）', '送り主に送り直してもらう'];
      out.push(el('div', { class: 'card' }, fixBlock(sender, receiver), r.isRar || r.is7z ? sourceLinks([SRC.rar7z]) : null));
      return out;
    }

    const i = r.issues;
    const stem = file.name.replace(/\.zip$/i, '');
    const folder = folderInput.value.trim().replace(/[\\/]+$/, '');
    const cards = [];
    let level = 0; // 0: ok, 1: warn, 2: bad, 3: fatal
    const raise = (n) => { level = Math.max(level, n); };

    // --- 致命的: zip 全体が無効 ---
    if (i.tooManyBytes.length) {
      raise(3);
      const maxBytes = Math.max(...i.tooManyBytes.map((x) => x.bytes));
      const isUtf8 = i.tooManyBytes.some((x) => x.encoding === 'utf-8');
      cards.push(issueCard('fatal', 'zip 内のパスが長すぎる（260 バイト以上）',
        `zip の中のパス（フォルダ名＋ファイル名）が 1 つでも <b>260 バイト以上</b>あると、エクスプローラーは zip 全体を無効と判断し、` +
        `「圧縮 (zip 形式) フォルダーは無効です」と表示して<b>1 つも展開できません</b>。文字数ではなく、zip 内に記録された文字コードでのバイト数で決まります` +
        `（UTF-8 の日本語は 1 文字 3 バイト、約 86 文字が上限）。展開先のフォルダとは関係がなく、LongPathsEnabled の設定でも回避できません。` +
        `最長は <b>${maxBytes} バイト</b>で、<b>${maxBytes - 259} バイト以上</b>短くする必要があります。`,
        fileList(i.tooManyBytes.sort((a, b) => b.bytes - a.bytes).map((x) => {
          const over = x.bytes - 259;
          return {
            html: highlightParts(x.name, (seg) => seg.length >= 20),
            note: `${x.bytes} バイト（${x.encoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS'}）→ あと ${over} バイト（日本語なら約 ${Math.ceil(over / (x.encoding === 'utf-8' ? 3 : 2))} 文字）短く`,
          };
        })),
        fixBlock([
          'フォルダ名・ファイル名を短くして、どのパスも <b>259 バイト以下</b>にする（一覧の黄色の部分が長い名前です）',
          'フォルダの階層を浅くする（深い入れ子のフォルダをまとめる）',
          isUtf8 ? '日本語の長い名前を英数字に置き換えると、バイト数を大きく減らせます' : null,
        ].filter(Boolean), [psExpand(file.name, stem), ALT_TOOLS]),
        [SRC.msBytes, SRC.box]));
    }

    // --- 展開できない ---
    if (i.tooLongPart.length) {
      raise(2);
      cards.push(issueCard('bad', 'フォルダ名・ファイル名が長すぎる（256 文字以上）',
        'Windows のフォルダ名・ファイル名は <b>255 文字まで</b>です。それより長い名前のファイルは作れないため、展開できません。',
        fileList(i.tooLongPart.map((x) => ({
          html: highlightParts(x.name, (seg) => seg === x.part),
          note: `${x.length} 文字 → ${x.length - 255} 文字以上短く`,
        }))),
        fixBlock(['黄色の名前を <b>255 文字以下</b>（できれば数十文字）に短くして zip を作り直す'], [ALT_TOOLS + '（展開時に名前を変更できるもの）']),
        [SRC.ntfs]));
    }
    if (i.strongEnc.length) {
      raise(2);
      cards.push(issueCard('bad', 'PKWARE Strong Encryption で暗号化されている',
        'この暗号化方式は、エクスプローラーも多くの展開ソフトも対応していません。',
        fileList(i.strongEnc.map((x) => ({ html: esc(x.name) }))),
        fixBlock(['暗号化なし、または ZipCrypto（従来の zip 暗号化）で作り直す'], ['PKWARE 製のソフト（SecureZIP など）で展開する'])));
    }
    if (i.aes.length) {
      raise(2);
      cards.push(issueCard('bad', 'AES で暗号化されている',
        'エクスプローラーが展開できるパスワード付き zip は、従来の ZipCrypto 暗号化だけです。<b>AES で暗号化された zip は、ファイル一覧は見えても展開できません</b>（7-Zip の「AES-256」などで作った zip）。',
        fileList(i.aes.map((x) => ({ html: esc(x.name) }))),
        fixBlock([
          '7-Zip の場合: 「暗号化方式」を <b>ZipCrypto</b> にして作り直す',
          'または暗号化せずに zip にし、別の安全な方法で渡す',
          '注意: ZipCrypto は AES より弱い暗号です。機密性が高い場合は、受け取る側に 7-Zip などを使ってもらう方が安全です',
        ], [`${ALT_TOOLS}（パスワードを入力して展開）`]),
        [SRC.aesQa]));
    }
    if (i.unsupportedMethod.length) {
      raise(2);
      const methods = [...new Set(i.unsupportedMethod.map((x) => x.methodName))].join('、');
      cards.push(issueCard('bad', `エクスプローラーが対応していない圧縮方式（${esc(methods)}）`,
        'エクスプローラーが展開できる圧縮方式は <b>Deflate</b>（標準の zip 圧縮）、<b>Deflate64</b>、無圧縮だけです。LZMA や BZip2 などで圧縮されたファイルは「圧縮方式がサポートされていない」として展開できません。',
        fileList(i.unsupportedMethod.map((x) => ({ html: esc(x.name), note: x.methodName }))),
        fixBlock([
          '圧縮方式を <b>Deflate</b> にして作り直す（7-Zip の場合: 書庫形式 zip、圧縮方式 Deflate）',
          'またはエクスプローラーの「圧縮先 → ZIP ファイル」で作る',
        ], [ALT_TOOLS]),
        [SRC.lzma]));
    }
    if (i.invalidName.length) {
      raise(2);
      cards.push(issueCard('bad', 'Windows で使えない名前がある',
        'Windows では <code>: ? * | &lt; &gt; "</code> などの文字、<code>CON</code> <code>NUL</code> <code>COM1</code> などの予約名、末尾のドット・空白をファイル名に使えません。Mac や Linux で作った zip によくあり、エクスプローラーでは<b>エラーになって展開が止まります</b>。',
        fileList(i.invalidName.map((x) => ({
          html: x.parts.map((p) => highlightInvalidChars(p.part)).join(' ／ ') + (x.parts.length === 1 && x.parts[0].part === x.name ? '' : `<span class="note">${esc(x.name)}</span>`),
          note: x.parts.map((p) => `${esc(p.reason)} → 例: <code>${esc(p.fixed)}</code>`).join('<br>'),
        }))),
        fixBlock([
          '黄色の文字を取り除くか、別の文字（全角の <code>：？＊｜＜＞”</code> や <code>_</code>）に置き換えて名前を変更する',
          '予約名（CON, PRN, AUX, NUL, COM1〜9, LPT1〜9）は、前に文字を付けるなど別の名前にする',
          '名前の末尾のドット・空白を削除する',
          'その後 zip を作り直す',
        ], [`${ALT_TOOLS}（使えない文字を自動で置き換えて展開できるもの）`]),
        [SRC.naming]));
    }
    if (i.tooManyEntries.length) {
      raise(2);
      cards.push(issueCard('bad', `ファイル数が 65,535 を超えている（${i.tooManyEntries[0].count.toLocaleString()} 件）`,
        '通常の zip の件数欄は 65,535 件までです。それを超えるのに ZIP64 形式の終端レコードがないため、エクスプローラーでは<b>一部のファイルしか見えず、展開もされません</b>。',
        null,
        fixBlock(['ZIP64 に対応したソフト（7-Zip、エクスプローラーの「圧縮先 → ZIP ファイル」など）で作り直す', 'または複数の zip に分ける'], [ALT_TOOLS]),
        [SRC.count]));
    }
    if (i.longPath.length) {
      raise(2);
      const maxFull = Math.max(...i.longPath.map((x) => x.length));
      const maxFolder = 257 - stem.length - r.maxRelLen;
      cards.push(issueCard('bad', '展開先のパスが長すぎる（260 文字以上）',
        `エクスプローラーは <code>${esc(r.explorerDest)}\\</code> に展開します。展開後のパスが <b>260 文字以上</b>になるファイルは「エラー 0x80010135: パスが長すぎます」となり展開されません（最長 ${maxFull} 文字）。LongPathsEnabled の設定をしても、エクスプローラーには効きません。`,
        fileList(i.longPath.sort((a, b) => b.length - a.length).map((x) => ({ html: esc(x.name), note: `展開後 ${x.length} 文字 → ${x.length - 259} 文字以上短く` }))),
        fixBlock([
          'フォルダ名・ファイル名を短くする、フォルダの階層を浅くする',
          `zip のファイル名（${stem.length} 文字）を短くする（展開先のフォルダ名になります）`,
        ], [
          maxFolder >= 3
            ? `zip を <code>C:\\tmp</code> など<b>短いパスのフォルダ</b>に移してから展開する（フォルダのパスを <b>${maxFolder} 文字以内</b>に。今は ${folder.length} 文字）`
            : 'zip 内のパスが長すぎるため、フォルダを移すだけでは解決しません。zip を作り直してもらうか、別の展開ソフトを使ってください',
          '「すべて展開」の展開先を短いパスに変更する',
          'zip のファイル名を短く変更してから展開する',
          ALT_TOOLS,
        ]),
        [SRC.pathTooLong]));
    }

    // --- 注意 ---
    if (i.caseCollision.length) {
      raise(1);
      cards.push(issueCard('warn', '大文字・小文字だけが違う同じ名前がある',
        'Windows は名前の大文字・小文字を区別しないため、<code>Readme.txt</code> と <code>README.txt</code> のような名前は同じファイルとして扱われます。展開時に上書きの確認が出て、<b>どちらか一方しか残りません</b>。Linux や Mac で作った zip で起こります。',
        fileList(i.caseCollision.map((x) => ({ html: esc(x.name), note: x.duplicate ? '同じ名前が zip 内に 2 回入っています' : `${esc(x.other)} と衝突` }))),
        fixBlock(['どちらかの名前を変える（大文字・小文字以外の違いを付ける）か、別のフォルダに分けて zip を作り直す'], ['上書きの確認で「ファイルを置き換えずにスキップする」を選ぶと、先に展開した方が残ります', ALT_TOOLS + '（自動で名前を変えて両方残せるもの）'])));
    }
    if (i.garbled.length) {
      raise(1);
      const encName = r.encoding === 'shift_jis' ? 'Shift_JIS' : 'UTF-8';
      cards.push(issueCard('warn', 'ファイル名が文字化けする',
        `ファイル名が <b>${encName}</b> で記録されていますが、UTF-8 フラグも Unicode 名の拡張フィールドもありません。エクスプローラーはフラグのない名前を ${esc(OEM_CODEPAGES[r.oemCodePage]?.name || 'OEM コードページ')} として読むため、<b>名前が文字化け</b>します。` +
        (r.oemCodePage === 932 ? 'Shift_JIS で読めないバイトの並びは「・」になり、<b>直後の 1 文字（「.」「_」「/」など）も一緒に消えることがあります</b>。拡張子の「.」が消えると展開したファイルを開けなくなり、フォルダの区切り「/」が消えるとフォルダが 0 バイトのファイルになったり、中身が別の場所に展開されたりします。' : '') +
        'Mac の「圧縮」や古いツールで作った zip によくあります。',
        fileList(i.garbled.map((x) => ({ html: esc(x.name), note: garbleNote(x) }))),
        fixBlock([
          'ファイル名を UTF-8 で記録し、<b>UTF-8 フラグを付けて</b>作り直す。文字コードが UTF-8 でも、フラグがないとエクスプローラーは UTF-8 として読みません',
          PS_COMPRESS,
          '7-Zip の場合: 「パラメータ」に <code>cu=on</code> を指定する（ファイル名を UTF-8 で記録し、フラグを付けます）',
          'Mac の場合: macOS 標準の「圧縮」は UTF-8 フラグを付けません。ファイル名を英数字にしてから圧縮するか、UTF-8 フラグを付けられる圧縮ソフト（Keka など）を使う',
        ], [`${ALT_TOOLS}（文字コードを指定・自動判定できるもの）`]),
        [SRC.qiitaFlag, SRC.appnote, SRC.zipReport]));
    }
    if (i.undecodable.length) {
      raise(1);
      cards.push(issueCard('warn', 'ファイル名の文字コードがわからない（文字化けします）',
        'UTF-8 フラグのないファイル名が、UTF-8 としても Shift_JIS としても正しく読めません。ほかの言語の Windows や古いツールで作られた zip と考えられ、<b>エクスプローラーでは名前が文字化け</b>します（化けた名前に使えない文字が含まれると、展開に失敗することもあります）。',
        fileList(i.undecodable.map((x) => ({ html: esc(x.name), note: garbleNote(x) }))),
        fixBlock([
          '作成した PC の言語・ソフトを確認し、ファイル名を UTF-8 で記録し UTF-8 フラグを付ける設定で作り直す（7-Zip なら「パラメータ」に <code>cu=on</code>）',
          PS_COMPRESS,
          'ファイル名を英数字だけにしてから圧縮する',
        ], [`${ALT_TOOLS}（文字コードを指定して展開できるもの）`]),
        [SRC.appnote]));
    }
    if (i.foreign.length) {
      raise(1);
      const langs = [...new Set(i.foreign.flatMap((x) => x.candidates.map((c) => c.langName)))];
      cards.push(issueCard('warn', 'ファイル名が中国語・韓国語の文字コードで記録されている（文字化けします）',
        `UTF-8 フラグのないファイル名が、${langs.length ? `<b>${esc(langs.join('・'))}</b> など` : '中国語・韓国語など'}、日本語以外の文字コードで記録されているようです。` +
        `Shift_JIS としても読めてしまうため、<b>日本語版 Windows のエクスプローラーでもエラーにならず、半角カナと漢字が混ざった別の名前で展開されます</b>。` +
        '中国語版・韓国語版の Windows や、その地域の圧縮ソフトで作った zip で起こります。',
        fileList(i.foreign.map((x) => ({ html: esc(x.name), note: garbleNote({ ...x, explorerView: r.oemCodePage === 932 ? null : x.explorerView }) }))),
        fixBlock([
          'ファイル名を UTF-8 で記録し、UTF-8 フラグを付けて作り直す（7-Zip なら「パラメータ」に <code>cu=on</code>）',
          PS_COMPRESS,
          'ファイル名を英数字だけにしてから圧縮する',
        ], [`${ALT_TOOLS}（文字コードを指定して展開できるもの。7-Zip ならコマンドラインの <code>-mcp=936</code>（中国語）や <code>-mcp=949</code>（韓国語））`]),
        [SRC.appnote]));
    }
    if (i.badUtf8Flag.length) {
      raise(1);
      const folders = i.badUtf8Flag.some((x) => x.extraFolders);
      const sjis = i.badUtf8Flag.some((x) => x.sjisName != null);
      cards.push(issueCard('warn', 'UTF-8 フラグが付いているのに、ファイル名が UTF-8 ではない',
        'zip には「ファイル名は UTF-8」という印（UTF-8 フラグ）が付いていますが、実際の名前は UTF-8 として正しくありません' +
        (sjis ? '（<b>Shift_JIS</b> で記録されています）' : '') + '。作成したソフトの不具合です。エクスプローラーはフラグを信じて UTF-8 として読むため、読めない部分が <b>「�」</b> に置き換わって文字化けします。' +
        (folders ? 'さらに、Shift_JIS の「表」「ソ」「能」などに含まれるバイト 0x5C が <b>フォルダの区切り「\\」として扱われ、意図しないフォルダが作られます</b>。' : ''),
        fileList(i.badUtf8Flag.map((x) => ({
          html: esc(x.name),
          note: [`エクスプローラーでの表示: <b>${esc(x.explorerView)}</b>`,
            x.sjisName != null ? `本来の名前（Shift_JIS）: ${esc(x.sjisName)}` : null,
            x.extraFolders ? '⚠ 「\\」の位置でフォルダが分かれて展開されます' : null].filter(Boolean).join('<br>'),
        }))),
        fixBlock([
          '別の圧縮ソフトで作り直す（ファイル名を UTF-8 で記録し UTF-8 フラグを付けるもの）',
          PS_COMPRESS,
          '作成に使ったソフトを最新版にする',
        ], [`${ALT_TOOLS}（文字コードを Shift_JIS に指定して展開できるもの）`]),
        [SRC.appnote]));
    }
    if (i.localeDependent.length) {
      raise(1);
      const encName = i.localeDependent[0].encoding === 'shift_jis' ? 'Shift_JIS' : i.localeDependent[0].encoding === 'utf-8' ? 'UTF-8' : esc(i.localeDependent[0].encoding);
      cards.push(issueCard('warn', '受け取る PC によってはファイル名が文字化けする',
        `ファイル名が <b>${encName}</b> で記録されていて、UTF-8 フラグがありません。選択中の言語（${esc(OEM_CODEPAGES[r.oemCodePage]?.name || '')}）の Windows では正しく表示されますが、` +
        (r.oemCodePage === 932
          ? '<b>英語版などほかの言語の Windows、「ワールドワイド言語サポートで Unicode UTF-8 を使用」（ベータ）を有効にした Windows、Mac</b> では文字化けします。'
          : '<b>日本語版など、ほかの言語の Windows</b> では文字化けします。') +
        '日本語版 Windows のエクスプローラーの「送る → 圧縮 (zip 形式) フォルダー」（Shift_JIS で記録し、フラグを付けません。Windows 11 25H2 で確認）や古い圧縮ソフトで作った zip が、この状態になります。',
        fileList(i.localeDependent.map((x) => ({ html: esc(x.name) }))),
        fixBlock([
          PS_COMPRESS,
          '7-Zip で作る場合は「パラメータ」に <code>cu=on</code> を指定する（ファイル名を UTF-8 で記録し、フラグを付けます）',
          '送り先の環境がわからない場合は、ファイル名を英数字にしておく',
        ], ['日本語版 Windows（UTF-8 ベータ設定なし）のエクスプローラーなら、そのまま展開できます', `${ALT_TOOLS}（文字コードを指定して展開できるもの）`]),
        [SRC.zipReport]));
    }
    if (i.nfd.length) {
      raise(1);
      cards.push(issueCard('warn', '濁点・半濁点が分離した名前になる（Mac で作った zip）',
        'Mac はファイル名の「が」「パ」などを「か＋゛」「ハ＋゜」のように分解した形（NFD）で記録することがあります。Windows ではこのまま展開されるため、<b>「か゛」のように濁点が分離して見えたり、検索や並べ替えでほかのファイルと一致しなかったり</b>します。',
        fileList(i.nfd.map((x) => ({ html: highlightCombining(x.name), note: `正しい形: ${esc(x.nfc)}` }))),
        fixBlock([
          'Mac で、ファイル名を NFC 形式に変換してから圧縮する（Bandizip for Mac や BandiNamer などの変換機能を使う）',
          '濁点・半濁点を含む名前を英数字に変えてから圧縮する',
        ], ['展開後に名前を付け直す', 'BandiNamer（Windows 版）などで、ファイル名を NFC 形式にまとめて変換する']),
        [SRC.nfd]));
    }
    if (i.emoji.length) {
      raise(1);
      cards.push(issueCard('warn', '絵文字などを含む名前がある',
        `絵文字など一部の文字（${esc([...new Set(i.emoji.map((x) => x.chars).join(''))].slice(0, 10).join(' '))}）を含むファイル名があると、エクスプローラーで「zip が無効です」となって開けないという報告があります。UTF-8 では 1 文字 4 バイトになるため、260 バイトの制限にも達しやすくなります。`,
        fileList(i.emoji.map((x) => ({ html: highlightAstral(x.name) }))),
        fixBlock(['黄色の文字を名前から取り除いて zip を作り直す'], [ALT_TOOLS]),
        [SRC.emoji]));
    }
    if (i.largeArchive.length) {
      raise(1);
      const x = i.largeArchive[0];
      cards.push(issueCard('warn', `サイズが大きい（展開後 ${fmtSize(x.total)}）`,
        '数 GB の zip をエクスプローラーで展開すると、途中で「データ エラー」「エラー 0x80004005」「エラー 0x8000FFFF: 致命的なエラー」となって失敗するという報告があります（Windows 11 24H2 では 1.5 GB を超えたあたりから失敗するという報告もあります）。',
        null,
        fixBlock(['複数の zip に分けて作る'], [psExpand(file.name, stem), ALT_TOOLS]),
        [SRC.dell, SRC.qaLarge]));
    }

    // --- 参考 ---
    if (i.zipCrypto.length) {
      cards.push(issueCard('info', 'パスワード付き（ZipCrypto）',
        'エクスプローラーで展開できます。展開時にパスワードを聞かれます。ただし日本語などを含むパスワードは、作成したソフトによっては通らないことがあります。',
        fileList(i.zipCrypto.map((x) => ({ html: esc(x.name) }))), null));
    }

    // --- 総合判定 ---
    let head;
    if (r.entries.length === 0) {
      head = verdict('v-warn', '⚠', '空の zip です', 'この zip にはファイルが 1 つも入っていません。');
    } else if (level === 3) {
      head = verdict('v-bad', '⛔', 'エクスプローラーでは展開できません（zip 全体が無効になります）', '「圧縮 (zip 形式) フォルダーは無効です」と表示され、何も展開されません。下の <b>🛠 zip を作り直す</b> の手順で直してください。');
    } else if (level === 2) {
      head = verdict('v-bad', '⛔', 'エクスプローラーでは一部またはすべて展開できません', '下の問題を直すと展開できるようになります。');
    } else if (level === 1) {
      head = verdict('v-warn', '⚠', '展開できる可能性はありますが、問題があります', '下の注意点と直し方を確認してください。');
    } else {
      head = verdict('v-ok', '✅', 'エクスプローラーで展開できます', 'エクスプローラーで展開できなくなる問題は見つかりませんでした。');
    }
    out.push(head);

    if (!folder && !i.longPath.length && level < 3 && r.entries.length) {
      const maxFolder = 257 - stem.length - r.maxRelLen;
      cards.push(el('div', { class: 'card' },
        el('p', { style: 'margin:0', html:
          '💡 展開先のパスの長さは判定していません。上の「zip を置くフォルダ」を入力すると判定します。' +
          (maxFolder >= 3
            ? `目安: zip を置くフォルダのパスが <b>${maxFolder} 文字以内</b>なら問題ありません。`
            : 'この zip は中のパスが長いため、どのフォルダに置いても 260 文字を超えます。') })));
    }

    const dirs = r.entries.filter((e) => /[\/\\]$/.test(e.name)).length;
    out.push(el('div', { class: 'meta', html: [
      `ファイル数 <b>${(r.entries.length - dirs).toLocaleString()}</b>`,
      dirs ? `フォルダ <b>${dirs.toLocaleString()}</b>` : null,
      `サイズ <b>${fmtSize(r.size)}</b>（展開後 ${fmtSize(r.totalUncompressed)}）`,
      `ファイル名の文字コード <b>${i.badUtf8Flag.length ? 'UTF-8 フラグあり（中身は UTF-8 ではない）' : r.encoding === null ? 'UTF-8（フラグあり）' : r.encoding === 'shift_jis' ? 'Shift_JIS（フラグなし）' : r.entries.some((e) => e.nameBytes.some((b) => b >= 0x80)) ? 'UTF-8（一部フラグなし）' : 'ASCII'}</b>`,
      r.zip64 ? '<b>ZIP64</b>' : null,
      r.explorerDest ? `展開先 <b>${esc(r.explorerDest)}\\</b>` : null,
      r.truncated ? '<span class="error">ファイル一覧の一部が読めませんでした（破損の可能性）</span>' : null,
    ].filter(Boolean).map((s) => `<span>${s}</span>`).join('') }));

    out.push(...cards);
    return out;
  }
})();
