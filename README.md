# ZipCheckForWindows

A web app that checks whether a zip file can be extracted with Windows 11 File Explorer (right-click → "Extract All"). If it cannot, the app shows how to fix it, both for the person who created the zip and for the person who received it.

**Try it: https://ytmknd.github.io/ZipCheckForWindows/**

## Usage

Open the page above (or `index.html` locally) in a browser and drop zip files onto it. No server or installation is required. The zip is only inspected inside the browser and is never uploaded. Only the file list at the end of the zip (the central directory) is read, so results appear instantly even for large zips.

- **Folder where the zip is placed**: If you enter it, the app also checks whether the destination paths `<folder>\<zip name>\...` exceed 260 characters (browsers cannot see where a file is stored, so it has to be typed in).
- **Windows language (OEM code page)**: Selects the code page Explorer uses to read file names that lack the UTF-8 flag. The default follows the browser language (Japanese → CP932, Korean → CP949, Chinese → CP936 / CP950, otherwise CP437). UTF-8 is also available for PCs with "Beta: Use Unicode UTF-8 for worldwide language support" enabled.

### Language

Messages are shown in Japanese when the browser's preferred language is Japanese, and in English otherwise. The language is determined from `navigator.languages[0]`.

## What is checked, and sources

| Severity | Check | Source |
| --- | --- | --- |
| Cannot extract (whole zip invalid) | A path (entry name) in the zip is 260 bytes or longer in its stored encoding. Explorer shows "The Compressed (zipped) Folder is invalid" and extracts nothing. Affects all Windows 11 versions; LongPathsEnabled does not help | [Microsoft Support explanation (Mado no Mori, Japanese)](https://forest.watch.impress.co.jp/docs/news/2119996.html), [Box Support](https://support.box.com/hc/en-us/articles/43374437409043) |
| Cannot extract | A folder or file name is 256 characters or longer (the NTFS limit is 255) | [Microsoft Learn](https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation) |
| Cannot extract | AES encryption (only ZipCrypto is supported), PKWARE Strong Encryption | [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/3828684) |
| Cannot extract | Compression methods other than Deflate / Deflate64 / Stored (LZMA, BZip2, etc.) | [Test on the Total Commander forum](https://ghisler.ch/board/viewtopic.php?p=442286) |
| Cannot extract | Names not allowed on Windows (`: ? * \| < > "`, reserved names such as CON and NUL, trailing dots and spaces) | [Microsoft Learn](https://learn.microsoft.com/windows/win32/fileio/naming-a-file) |
| Cannot extract | More than 65,535 entries without a ZIP64 end record (only some are recognized) | [Git fix](https://git.lorimer.id.au/gitweb.git/diff/88329ca8091b16f4bb01e3ea546c8c5e1a5016ec) |
| Cannot extract | Destination path of 260 characters or more (error 0x80010135) | [winhelponline](https://www.winhelponline.com/blog/error-0x80010135-path-too-long-when-extracting-zip-file/) |
| Warning | Names that differ only in letter case (they collide on Windows and only one is kept) | Behavior of the Windows file system |
| Warning | Non-ASCII names with neither the UTF-8 flag nor a Unicode Path extra field (0x7075); they are read with the OEM code page and garbled. Also warns when the "." of an extension or a "/" folder separator is lost | [Qiita (Japanese)](https://qiita.com/ko1nksm/items/0cce942c5a77574e68b7), [ZIP64 / UTF-8 support report](https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf), verified on a real machine |
| Warning | Names that are valid neither as UTF-8 nor as Shift_JIS (another language's encoding; garbled) | Verified on a real machine |
| Warning | Names that are valid Shift_JIS but look like Chinese (GBK / Big5) or Korean (EUC-KR); even Japanese Windows extracts them without error under names mixing half-width katakana | Verified on a real machine |
| Warning | Names with the UTF-8 flag set that are not valid UTF-8 (garbled into "�"; byte 0x5C in Shift_JIS becomes "\" and creates unintended folders) | [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), verified on a real machine |
| Warning | Names such as unflagged Shift_JIS that read correctly on Windows in the selected language but are garbled on Windows in other languages or with "Beta: Use Unicode UTF-8 for worldwide language support" enabled | [ZIP64 / UTF-8 support report](https://github.com/3MFConsortium/spec_core/files/6516560/ZIP.Report.pdf) |
| Warning | Names in NFD form from macOS (accents and Japanese voiced sound marks appear detached) | [BandiNamer](https://www.bandisoft.com/bandinamer/), [mac2win-zip](https://github.com/Wordbe/mac2win-zip) |
| Warning | Names containing characters outside the BMP, such as emoji (reported to make the zip "invalid") | [Johnny.Decimal Support](https://business.johnnydecimal.com/support/knowledge-base/error-windows-zip) |
| Warning | Extracted size of 1.5 GB or more (reported failures with "Data error", "0x80004005", "0x8000FFFF") | [Dell Support](https://www.dell.com/support/kbdoc/en-us/000334778), [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/12196710) |
| Info | Password-protected with ZipCrypto (can be extracted) | |

The app also detects files that are not zips (RAR or 7z with a .zip extension), split zips, and corrupted zips. ZIP64 zips can be extracted by Explorer, so they are not treated as a problem.

Items marked "Warning" are based on reports rather than official documentation.

## Real-machine verification of garbled file names (Windows 11 25H2, OEM code page 932)

Test zips were built with varying name bytes, UTF-8 flags, and extra fields, then extracted with the same zip engine as Explorer (Shell.Application / zipfldr). For all 29 cases, the "Shown in Explorer as" name predicted by the app matched the actually extracted file name, code point for code point.

| Zip contents | Result in Explorer |
| --- | --- |
| Shift_JIS, no flag | Extracted correctly (on Japanese Windows) |
| UTF-8, no flag | Garbled (read as CP932) |
| UTF-8, flag set | Extracted correctly |
| No flag + Unicode Path extra field (0x7075) | **Extracted using the name in the extra field**, even if its CRC does not match the original name |
| Flag set, but the name is Shift_JIS | Unreadable parts become "�" (U+FFFD). Characters containing byte 0x5C (ソ, 表, 能, etc.) become "\" and split the path into folders |
| Different names in the central directory and the local header | The central directory name is used |
| GBK / EUC-KR / Big5, no flag | Extracted under garbled names (no error) |
| macOS NFD form (detached marks), flag set | Extracted as is (not normalized to NFC) |

- In CP932, an undefined two-byte sequence becomes "・" (U+30FB), and **the second byte is consumed even if it is ASCII**. `报告最终版.pdf` (GBK) became `ｱｨｸ贐靑ﾕｰ・pdf`, losing the "." of its extension. The browser's TextDecoder behaves differently here, so `decodeCp932Win` in `zipcheckforwindows.js` reproduces the Windows behavior (it matches `MultiByteToWideChar(932)` for all 32,896 one- and two-byte sequences).
- The "/" folder separator is lost for the same reason. The UTF-8, unflagged entries `テスト/`, `テスト/ガ.txt`, and `資料/報告.txt` were extracted as `繝・せ繝・` (**a 0-byte file**), `繝・せ繝・繧ｬ.txt` (outside the folder), and `雉・侭\蝣ｱ蜻・txt` (extension lost).
- Zips created by Windows itself: Explorer's "Send to → Compressed (zipped) folder" stored names in Shift_JIS without the flag. PowerShell 5.1 `Compress-Archive` stored names in UTF-8 with the flag, but stored subfolder separators as "\", contrary to the specification ("/").
- According to [Xceed's documentation](https://xceed.com/documentation/xceed-filesystem-for-net/Handling%20Unicode%20characters.html), Explorer on Windows 7 ignores the Unicode Path extra field, and Windows 8 started reading it. The verification above confirms that 25H2 reads it.
- The Chinese / Korean detection prioritizes never warning about genuine Japanese names, so names that read as half-width katakana only (such as `회의록.txt`) may be missed.
- Not verified: PCs with "Beta: Use Unicode UTF-8 for worldwide language support" enabled, and the contents of zips created with "Compress to → ZIP File" on 23H2 and later. The "Shown in Explorer as" preview for OEM code pages other than 932 uses the browser's TextDecoder and has not been checked against Windows.

## Files

| File | Contents |
| --- | --- |
| `index.html` | Page layout and styles |
| `zipcheckforwindows.js` | Zip parsing and checks (no DOM dependency, so it also runs in Node.js) |
| `app.js` | UI logic (drag and drop, rendering results and fixes, Japanese / English messages) |
| `favicon.svg` | Favicon |
