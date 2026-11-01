# 讀書：自用 TXT 閱讀器（網頁版）

在 iPhone 上「加入主畫面」之後，用起來跟一般 App 一樣，而且：

- 不需要 Mac、不需要 Apple ID，**沒有 7 天期限**。
- 書、閱讀進度、匯入的字型，**都只存在你的手機上**，不會上傳到任何地方。
- 第一次打開之後就不用網路，飛航模式也能讀。

---

## 一、放到 GitHub Pages（只要做一次，約 5 分鐘）

建議用電腦做，比較好拖檔案。

1. 登入 [github.com](https://github.com)，點右上角 **＋ → New repository**。
2. **Repository name** 填 `reader`（可以自己取，會變成網址的一部分）。
   選 **Public**，按 **Create repository**。
   > 免費帳號的 GitHub Pages 只能用公開的 repository。別人看得到的只有這個 App 的程式碼，你的書不會在上面。
3. 在新 repository 的頁面，點 **uploading an existing file** 這個連結。
4. 把這個資料夾**裡面的所有檔案**（`index.html`、`app.js`、`s2t.js`、`sw.js`、`manifest.webmanifest`、三個 `icon-*.png`、`OpenCC-LICENSE.txt`、`README.md`）一起拖進去。
   要拖的是「檔案」，不是外面那層資料夾。拖完按下面的 **Commit changes**。
5. 點上方的 **Settings**，左邊選 **Pages**。
   **Source** 選 **Deploy from a branch**，**Branch** 選 **main**、資料夾選 **/ (root)**，按 **Save**。
6. 等 1～2 分鐘，重新整理這一頁，上面會出現
   **Your site is live at `https://你的帳號.github.io/reader/`**，這就是 App 的網址。

## 二、安裝到 iPhone

1. 用 iPhone 的 **Safari** 打開上面的網址（要用 Safari，其他瀏覽器不行）。
2. 點下方的 **分享** 按鈕 →（往下滑）**加入主畫面** → **加入**。
3. **從主畫面的「讀書」圖示打開一次**（這次要有網路），之後就能離線使用了。

> ⚠️ Safari 和主畫面 App 的資料是**分開存的**。請從主畫面的圖示打開，再在裡面匯入書。
> ⚠️ 把主畫面的「讀書」圖示刪掉，裡面的書和進度會一起不見。

## 三、怎麼放書進去

書架右上角 **＋** → 從「檔案」選 TXT 檔（可以一次選很多本）。
TXT 可以先存在 iPhone 的「檔案」App、iCloud 雲碟，或用 AirDrop 從電腦傳過來。

會自動判斷 UTF-8／Big5／GBK 編碼，也會自動切章節（第X章、第X卷、序章、終章、番外……）。

## 閱讀時的操作

| 直排（預設） | 橫排 |
|---|---|
| 點**左側**＝下一頁，點**右側**＝上一頁 | 點**右側**＝下一頁，點**左側**＝上一頁 |
| 手指**往右滑**＝下一頁 | 往左滑或往上滑＝下一頁 |

- 點**畫面中間**叫出選單：返回書架、章節滑桿、目錄、排版、直橫排切換、夜間模式。
- 書架上**長按書本**：從頭開始讀、重新命名、刪除。
- 關掉 App 再打開，會直接回到上次讀的那一頁。

## 排版設定

字級、行距、字距、邊距、六種背景、直排／橫排、字型（可匯入 .ttf／.otf，例如「源樣明體」）、
簡體轉繁體（台灣用字）、引號改成「」、直排時把短英數字轉成全形、隱藏空行、翻頁動畫、閱讀時螢幕不自動鎖定。

## 以後要更新版本

把新的檔案用 GitHub 的 **Add file → Upload files** 上傳、覆蓋舊檔。
iPhone 連著網路打開 App 一次，關掉再開，就是新版。書和進度都會保留。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | 畫面和樣式 |
| `app.js` | 主程式：書架、編碼判斷、切章、直排排版引擎、設定 |
| `s2t.js` | 簡轉繁字典（取自 [OpenCC](https://github.com/BYVoid/OpenCC)，Apache-2.0，授權見 `OpenCC-LICENSE.txt`） |
| `sw.js` | 離線快取 |
| `manifest.webmanifest`、`icon-*.png` | 主畫面圖示和名稱 |
