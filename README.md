# ZipCheckForWindows

zip ファイルが Windows 11 のエクスプローラー（右クリック →「すべて展開」）で展開できるかを判定する Web アプリです。展開できない場合は、zip の作成者向けと受け取った人向けに、それぞれの直し方を表示します。

## 使い方

`index.html` をブラウザで開き、zip ファイルをドロップします。サーバーもインストールも不要です。zip はブラウザの中で調べるだけで、どこにも送信しません。読むのは zip 末尾のファイル一覧（セントラルディレクトリ）だけなので、大きな zip でもすぐに結果が出ます。

- **zip を置くフォルダ**: 入力すると、展開先 `<フォルダ>\<zip 名>\` のパスが 260 文字を超えないかも判定します（ブラウザからはファイルの場所がわからないため、手で入力します）。
- **Windows の言語**: UTF-8 フラグのないファイル名をエクスプローラーがどの文字コードで読むかを選びます。既定は日本語（CP932）です。「ワールドワイド言語サポートで Unicode UTF-8 を使用」（ベータ）を有効にした PC 向けに UTF-8 も選べます。

## 判定する内容と根拠

| 重大度 | 内容 | 根拠 |
| --- | --- | --- |
| 展開不可（zip 全体が無効） | zip 内のパス（エントリ名）が、記録された文字コードで 260 バイト以上。「圧縮 (zip 形式) フォルダーは無効です」となり何も展開できない。Windows 11 の全バージョンが対象で、LongPathsEnabled でも回避できない | [Microsoft サポートの解説（窓の杜）](https://forest.watch.impress.co.jp/docs/news/2119996.html)、[Box サポート](https://support.box.com/hc/en-us/articles/43374437409043) |
| 展開できない | フォルダ名・ファイル名が 256 文字以上（NTFS の上限は 255 文字） | [Microsoft Learn](https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation) |
| 展開できない | AES 暗号化（ZipCrypto のみ対応）、PKWARE Strong Encryption | [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/3828684) |
| 展開できない | Deflate / Deflate64 / 無圧縮 以外の圧縮方式（LZMA、BZip2 など） | [Total Commander フォーラムでの検証](https://ghisler.ch/board/viewtopic.php?p=442286) |
| 展開できない | Windows で使えない名前（`: ? * \| < > "`、CON や NUL などの予約名、末尾のドット・空白） | [Microsoft Learn](https://learn.microsoft.com/windows/win32/fileio/naming-a-file) |
| 展開できない | ZIP64 の終端レコードなしで 65,535 件を超えるファイル（一部しか認識されない） | [Git の修正](https://git.lorimer.id.au/gitweb.git/diff/88329ca8091b16f4bb01e3ea546c8c5e1a5016ec) |
| 展開できない | 展開先のパスが 260 文字以上（エラー 0x80010135） | [winhelponline](https://www.winhelponline.com/blog/error-0x80010135-path-too-long-when-extracting-zip-file/) |
| 注意 | 大文字・小文字だけが違う名前（Windows では同じ名前になり、片方しか残らない） | Windows のファイルシステムの仕様 |
| 注意 | UTF-8 フラグも Unicode Path 拡張フィールド（0x7075）もない非 ASCII 名（OEM コードページで読まれて文字化け）。拡張子の「.」が消える場合も警告する | [Qiita](https://qiita.com/ko1nksm/items/0cce942c5a77574e68b7)、[ZIP64 / UTF-8 対応状況の調査](https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf)、実機検証 |
| 注意 | UTF-8 としても Shift_JIS としても読めない名前（ほかの言語の文字コード。文字化けする） | 実機検証 |
| 注意 | Shift_JIS としては読めるが、中国語（GBK / Big5）・韓国語（EUC-KR）らしい名前（日本語版 Windows でもエラーにならず、半角カナ混じりの名前で展開される） | 実機検証 |
| 注意 | UTF-8 フラグがあるのに UTF-8 として正しくない名前（「�」に化ける。Shift_JIS の 0x5C が「\」になって意図しないフォルダができる） | [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)、実機検証 |
| 注意 | フラグなしの Shift_JIS 名など、選択した言語の Windows では読めるが、ほかの言語の Windows や「ワールドワイド言語サポートで Unicode UTF-8 を使用」（ベータ）を有効にした Windows では化ける名前 | [ZIP64 / UTF-8 対応状況の調査](https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf) |
| 注意 | Mac 由来の NFD 形式の名前（濁点・半濁点が分離して見える） | [BandiNamer](https://jp.bandisoft.com/bandinamer/)、[mac2win-zip](https://github.com/Wordbe/mac2win-zip) |
| 注意 | 絵文字など BMP 外の文字を含む名前（「無効」になる報告あり） | [Johnny.Decimal サポート](https://business.johnnydecimal.com/support/knowledge-base/error-windows-zip) |
| 注意 | 展開後のサイズが 1.5 GB 以上（「データ エラー」「0x80004005」「0x8000FFFF」で失敗する報告あり） | [Dell サポート](https://www.dell.com/support/kbdoc/ja-jp/000334778)、[Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/12196710) |
| 参考 | ZipCrypto のパスワード付き（展開できる） | |

このほか、zip でないファイル（拡張子だけ .zip の RAR や 7z）、分割 zip、壊れた zip も見分けます。ZIP64 形式の zip はエクスプローラーで展開できるため、問題として扱いません。

「注意」の項目は、公式な資料ではなく報告ベースのものです。

## ファイル名の文字化けについての実機検証（Windows 11 25H2、OEM コードページ 932）

ファイル名のバイト列・UTF-8 フラグ・拡張フィールドを変えたテスト用 zip を作り、エクスプローラーと同じ zip エンジン（Shell.Application / zipfldr）で展開した結果です。アプリが予測する「エクスプローラーでの表示」は、29 件すべてで実際に展開されたファイル名とコードポイント単位で一致しました。

| zip の中身 | エクスプローラーの結果 |
| --- | --- |
| Shift_JIS、フラグなし | 正しく展開（日本語版 Windows の場合） |
| UTF-8、フラグなし | 文字化け（CP932 として読まれる） |
| UTF-8、フラグあり | 正しく展開 |
| フラグなし＋Unicode Path 拡張フィールド（0x7075） | **拡張フィールドの名前で展開**。CRC が元の名前と合わなくても使われる |
| フラグあり、中身は Shift_JIS | 読めない部分が「�」(U+FFFD) になる。0x5C を含む文字（ソ・表・能など）は「\」になり、フォルダが分かれる |
| セントラルディレクトリとローカルヘッダーで名前が違う | セントラルディレクトリの名前を使う |
| GBK / EUC-KR / Big5、フラグなし | 化けた名前で展開（エラーにならない） |
| Mac の NFD 形式（濁点の分離）、フラグあり | 分離したまま展開（NFC に直されない） |

- CP932 で未定義の 2 バイトの並びは「・」(U+30FB) になり、**2 バイト目が ASCII でも一緒に消える**。`报告最终版.pdf`（GBK）は `ｱｨｸ贐靑ﾕｰ・pdf` となり、拡張子の「.」が消えた。ブラウザの TextDecoder はこの点が Windows と違うため、`zipcheckforwindows.js` の `decodeCp932Win` で Windows の動作を再現している（1 バイト・2 バイトの全 32,896 通りで `MultiByteToWideChar(932)` と一致することを確認）。
- フォルダ区切りの「/」も同じ理由で消える。UTF-8・フラグなしの `テスト/`、`テスト/ガ.txt`、`資料/報告.txt` は、`繝・せ繝・`（**0 バイトのファイル**）、`繝・せ繝・繧ｬ.txt`（フォルダの外）、`雉・侭\蝣ｱ蜻・txt`（拡張子が消える）として展開された。
- Windows 自身が作る zip: エクスプローラーの「送る → 圧縮 (zip 形式) フォルダー」は Shift_JIS・フラグなしで記録した。PowerShell 5.1 の `Compress-Archive` は UTF-8・フラグありで記録したが、サブフォルダの区切りを仕様（「/」）に反して「\」で記録した。
- [Xceed の資料](https://xceed.com/documentation/xceed-filesystem-for-net/Handling%20Unicode%20characters.html)によると、Windows 7 のエクスプローラーは Unicode Path 拡張フィールドを読まず、Windows 8 で読むようになった。25H2 で読むことは上の検証で確認した。
- 中国語・韓国語の判定は、日本語の名前を誤って警告しないことを優先している。半角カナだけで読める名前（`회의록.txt` など）は見逃すことがある。
- 「ワールドワイド言語サポートで Unicode UTF-8 を使用」（ベータ）を有効にした場合と、23H2 以降の「圧縮先 → ZIP ファイル」で作った zip の中身は検証していない。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | 画面とスタイル |
| `zipcheckforwindows.js` | zip の解析と判定（DOM に依存しないので Node.js でも動く） |
| `favicon.svg` | ファビコン |
| `app.js` | 画面の処理（ドラッグ＆ドロップ、結果と直し方の表示） |
