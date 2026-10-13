# tibetan-siddham-mobile — Session context

手機優先的藏文梵字轉換器：ASCII / IAST 羅馬轉寫即時轉成**藏文梵字（Tibetan-script Sanskrit）與拉丁轉寫**，**輸入貼著鍵盤、輸出在上，打字的同時就看得到結果、不必捲動**。
[`tibetan-siddham`](https://github.com/scottgfhong310/tibetan-siddham) 的手機版；**public、零後端**。⭐ **不處理悉曇**（owner 2026-10-12，見 DESIGN §2.1）。

本 app 屬於 **nodeapp WebApp 家族**；共同規範與流程在
<https://github.com/scottgfhong310/nodeapp-webapp-family>（`DESIGN_GUIDELINES.md` 規範、`WORKFLOW.md` 流程）。**改動前請先讀那兩份。**
**「為什麼長這樣」一律在 [`DESIGN.md`](./DESIGN.md)**。版型、鍵盤、紀錄清單與 Artifacts 資料庫是照 [`bonji-mobile`](https://github.com/scottgfhong310/bonji-mobile) 移植的——
那些規矩的來龍去脈（每一條對應一次真機實測或一次事故）在 **`bonji-mobile/DESIGN.md`**，改之前去讀。

## 執行 / 驗證

```bash
npm install && npm start                 # → http://localhost:3000/apps/tibetan-siddham-mobile/
npm run verify                           # 39 條契約檢查
node scripts/verify.js --selftest        # 203 個反向注入，全部必須被抓到
python3 artifact/build.py                # Artifacts 版 → artifact/dist/ ＋ artifact/dist.files.json（都不進版控）
```

## 結構

```
app.js                                   # 只有 static ＋ / → 302 ＋ JSON 404（無 API）
scripts/verify.js                        # 契約檢查 ＋ --selftest
scripts/backup-artifact.sh               # Artifacts 資料庫的紀錄清單 → 本機＋iCloud（每日排程與發佈前都走它；見檔頭）
artifact/{build.py, vendor/materialize.min.css}   # Artifacts 版建置（差異全在 PATCHES）
artifact/src/remote-db.js                # ⚠️ 只有 Artifacts 版有：紀錄清單存 artifact 的資料庫（一筆一份文件）
public/apps/tibetan-siddham-mobile/
├─ index.html · tibetan-siddham-mobile.css · tibetan-siddham-mobile.js   # 結構 / 樣式 / 控制器（ESM）
├─ tibetan-siddham-mobile-lib.js         # 純核心（IIFE → window.TibetanSiddhamMobileLib，不碰 DOM）：記號列／可見範圍／草稿／紀錄清單與 JSON 輸出
├─ tibetan-siddham-converter.js          # ⚠️ tibetan-siddham 的複製件（防腐層；唯一的轉換介面）
├─ tibetan-core.js · data/tibetan.tsv    # ⚠️ tibetan-siddham 的複製件（藏文規則核心＋規則表；執行時 fetch）
├─ vendor/bonji-input/                   # ⚠️ tibetan-siddham 的複製件（MIT 引擎；**不是 bonji 那一份**，多 14 個符號記法）
├─ data/assist.json                      # ⚠️ tibetan-siddham 的複製件：記號列五組 108 鍵
├─ fonts/{NotoSerifTibetan-Regular.ttf, NotoSansSiddham-Regular.woff2, *-OFL.txt}   # ⚠️ 複製件；只有這兩支（OFL）
├─ side-tool.css · side-tool.js · materialize-dark.css · i18n.js   # 家族共用件複製件
└─ locales/{zh-Hant,en,ja}.js
```

## 最容易做錯的幾件事

1. **不要把悉曇加回來**〔owner 2026-10-12：藏文梵字的組字與悉曇的組字不是一一對應，並排反而混淆〕：畫面、紀錄清單、JSON 輸出都沒有悉曇（第 ㉕ 條）。
   防腐層照樣會算悉曇（它是複製件）——**不要為了「用不到」去改它**。Noto Sans Siddham 留著只為藏文欄借用的 `𑗁`（`~`／`--`）。
2. **轉換核心改 `tibetan-siddham` 不改這裡**：防腐層、藏文核心、規則表、引擎、`assist.json`、兩支字型都是它的 byte-identical 複製件（第 ⑱ 條）。
   ⚠️ 引擎**從 tibetan-siddham 抄，不是從 bonji**（兩份不同）。
3. **對照表載好才能轉**：`converter.ready()` 回來之前 `convert()` 不轉、清單顯示「載入中」；**載不到要在畫面上講**（第 ㉖ 條）。不要拿掉 `state.ready` 的判斷。
4. **輸出在上、輸入在下的 DOM 順序不可以對調**（第 ⑧ 條）；**不要把外殼改回 `100vh`／整頁捲動**（第 ⑨ 條）。
5. **記號列／清除鈕／切換鈕／加入鈕的 `mousedown` 要 `preventDefault`**，否則每按一下鍵盤就收起來（第 ⑪、㉛ 條）。**不要擋 `touchstart`**。
6. **會聚焦的控制項字級不可小於 16px**（iOS 放大整頁）；現值 20px 是為了 Artifacts 版（第 ⑩ 條）。
7. **記號列的鍵不要寫死**：由 `data/assist.json` 推出。lib 只寫死 `KEYSET_IDS`（收哪幾類、順序；第 ㉔ 條）。記法照資料原樣插入——**tsheg 鍵是兩個空格，一個都不能少**。
   ⭐ **順序是 owner 指定的**〔2026-10-12〕：母音 → 子音 → **下加輔音 → 元音符號** → 標點——**不是** `assist.json`（桌機版面板）的順序，不要「對齊資料」改回去。
   ⭐ **三個固定形插入 `y`／`r`／`v`**〔owner 2026-10-12：ྻ＝y、ྼ＝r、ྺ＝v〕：資料裡它們沒有 `code`，lib 用 `alt` 當記法並標 `variant`（轉出來的是一般的下加形，不是鍵上的固定形）。
   桌機版面板照舊不可插入，`assist.json` 沒有動——不要為了「對齊」改回去（第 ③ 條）。
8. **鍵高 54px、字形 18px × 行高 2、輸出欄行高 2.1 都是量出來的**（DESIGN §6.1、§7）：藏文的上方符號與疊字比悉曇高，照 bonji-mobile 的數字會被裁掉。改字級要重量（第 ㉗ 條）。
9. **上緣安全區墊在 `.shell` 上，不要墊在 `.topbar`**（第 ⑳ 條）；底部安全區以**焦點**判斷（第 ㉒ 條）。
10. **不要加 `local()` 字型**：iOS 的網頁讀不到使用者自己裝的字型（第 ⑯ 條）。**記號列上的每一個字，隨附的字型都要有**（第 ㊱ 條讀 cmap）。
11. **紀錄清單的標題不是鍵**：可以重複、可以留空——不要加查重、覆寫或合併（第 ㉘ 條）。清單只存 input 與選項，輸出現算（第 ㉙ 條）。
12. ⚠️⚠️ **改標題的路上不可以有任何一行寫清單**（bonji-mobile 2026-10-11 實際弄丟過 owner 的紀錄）：兩格分開存；會寫清單的只有 `addCurrent`／`recAction`／`saveEdit`，而且都先 `syncItems()`。
    **不要加「整份存檔」那種函式**（第 ㉝ 條）。
13. ⚠️⚠️ **Artifacts 版的清單住在 artifact 的資料庫裡**（`records/<id>` 一筆一份文件、`state/title`）。**不要改成整份清單一份文件**（第 ㉞ 條）。
14. **不要用 `confirm()`／`alert()`**：Artifacts 的 iframe 裡直接回 false。會毀掉東西的動作一律「再按一次」（第 ㉛ 條）。
15. **`downloadText()` 的函式本體是 `artifact/build.py` 的補丁錨點**——改它，那邊的 `DOWNLOAD_OLD` 要一起改（沒改會建置失敗，不會安靜地漏掉）。
16. **編輯某一筆（清單上的 ✎）在面板裡做，不經過主畫面**〔owner 2026-10-13〕：`startEdit`／`saveEdit` 不可以碰輸入框、標題欄、畫面上的選項；
    存回認 `id` 不認序號；編輯中唯一的出口是 儲存／取消（點面板外不關、「完成」收起來）；沒有更動不寫入、記法清空不給存。第 ㊲ 條（DESIGN §8、bm §10.5）。
17. **每一筆有 `type`（類型——**字串陣列，可以有好幾個，像 tags**；第一版是單一字串，讀進來當成一個，**不要寫遷移**）與 `source`（來源，多行；⚠️ **畫面上的標籤是「出處參考」**，欄位名、key、id 仍是 source——不要為了對齊去改名）兩欄，都可以是空的**〔owner 2026-10-13〕：面板上標題欄底下那兩格的值在加入／取代時帶入；編輯表單裡可各自改。
    類型是**自由文字＋複選的快選鈕**（快選鈕只有清單裡用過的類型；**沒有預設的詞——owner 拿掉了，不要加回來**）——不要改成固定選單；欄位裡以「、」相連，把陣列塞進欄位要過 `typesText()`；編輯表單裡那一排快選鈕只動表單那一格。
    ⚠️ 新增一個紀錄欄位要動**四個地方**，漏一個都不會報錯：lib 的 `makeRecord`（白名單）、`buildExport`、`artifact/src/remote-db.js` 的寫入與讀回各一處、
    `scripts/backup-artifact.sh` 的 `body()`。兩格的值各自一格存，規矩同第 12 條。舊紀錄沒有這兩欄＝空字串。第 ㊳㊴ 條（DESIGN §8、bm §10.6、§10.7）。
18. **原始碼不要寫 `\uXXXX` 跳脫**：寫檔工具會把它換成實體字元。碼位用 `String.fromCodePoint(0x…)`（`verify.js` 全檔如此）。

## 複製件登記

| 檔案 | 權威版 |
|---|---|
| `side-tool.css`／`side-tool.js`／`materialize-dark.css`／`i18n.js` | 家族 repo 根（`nodeapp-webapp-family`） |
| `tibetan-siddham-converter.js`／`tibetan-core.js`／`data/tibetan.tsv`／`data/assist.json`／`vendor/bonji-input/*`／`fonts/*` | `tibetan-siddham/public/apps/tibetan-siddham/` |
| `artifact/vendor/materialize.min.css` | 與 `bonji-mobile/artifact/vendor/` 那份相同（cdnjs Materialize 1.0.0） |

**改就改權威版再同步；不要在本 repo 就地改。** `verify.js` 第 ⑱ 條每次比 md5（上游不在旁邊時 SKIP，SKIP 不是 PASS）。
⚠️ **`tibetan-siddham` 改了轉換、規則表或 `assist.json` 之後，要複製過來並在這裡跑 `npm run verify`**——那邊沒有東西會提醒。

## Claude Artifacts 版

<https://claude.ai/artifact/9jxT8XXBY9wF2wyt67qXv7>（private）。**改了前端要更新**，順序固定（同 bonji-mobile）：

1. ⚠️ **先備份資料庫裡的清單**——兩個動作，與每日排程走同一支腳本：
   `ArtifactData` `list` `records`（`query: {limit: 1000}`、`out_dir: /Users/Shared/nodeapp-db-backup/tibetan-siddham-mobile-artifact/.pull`），記下它回報的筆數 N；
   再跑 `TSM_BACKUP_CLOUD=- scripts/backup-artifact.sh /Users/Shared/nodeapp-db-backup/tibetan-siddham-mobile-artifact/.pull N`
   （`TSM_BACKUP_CLOUD=-`＝這次不寫 iCloud：那邊的檔只有排程覆寫得了）。**exit 不是 0 就不要發佈。**
2. 重跑 `build.py`。它會寫出 `artifact/dist.files.json`——發佈時 `files` 參數的內容。
   ⚠️ **`data/tibetan.tsv` 與 `vendor/bonji-input/LICENSE` 要明講 `text/plain`**（Artifacts 不認 `.tsv`，漏了整次發佈會被退回）；那份 JSON 已經寫好。
3. 以 Artifact 工具重新發佈：`file_path`＝`artifact/dist/index.html`、`root`＝`artifact/dist`、`files`＝上面那份、`url`＝上面的網址（別的對話要先 `read` 一次）。
   `capabilities` 不帶＝沿用上一版；**要改就整組重給**（沒重給的會被撤掉）。
4. 發佈後再 `list` 一次 `records`，筆數要與第 1 步相同——**更新不該動到資料**。

**每日排程**：`~/.claude/scheduled-tasks/tibetan-siddham-mobile-artifact-backup`（每天 21:20 前後；桌面 app 開著才跑，沒開就下次啟動補跑）。
它只做兩件事——取回 `records`、呼叫 `scripts/backup-artifact.sh`。備份落在 `/Users/Shared/nodeapp-db-backup/tibetan-siddham-mobile-artifact/`
（repo 之外——本 repo 是 public，owner 記的內容不進版控）。**判斷成敗看 `backup.log` 最後一段與 `LAST-SUCCESS.txt`**；
⚠️ 排程被停用時的症狀是「什麼都沒發生」，與「一切正常」在磁碟上長得一樣。

現在宣告的是 `downloads`（JSON 下載；沙盒會擋掉 `<a download>`）＋ `db`（紀錄清單；規則 `read`／`write` 都是 `owner`）。

## 尚未在真機上驗的（DESIGN §3.1、§9.1）

iPhone／Android 上的鍵盤跟隨、記號列的藏文字形在手機上的樣子、清單在 Claude App 裡關掉重開還在——這幾項還沒有 owner 的回報。
（Artifacts 頁面有在跑、清單寫得進資料庫：2026-10-12 發佈第 2 版前，資料庫裡已有 owner 記的 6 筆。）
這些在 bonji-mobile 上確認過的是**那一支**；這一支換了字型、鍵高與資料，要 owner 另外看一次。
