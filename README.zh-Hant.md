# tibetan-siddham-mobile — 藏文梵字・手機版

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

把 **ASCII / IAST 羅馬轉寫**即時轉成**藏文梵字（Tibetan-script Sanskrit）**與**拉丁轉寫**的手機優先 WebApp。
**輸入貼著鍵盤、輸出在上**——打字的同時就看得到結果，不必捲動畫面。

是 [tibetan-siddham](https://github.com/scottgfhong310/tibetan-siddham) 的手機版：轉換核心相同（該專案的藏文規則表，經防腐層 `TibetanSiddhamConverter` 使用），版面與功能為手機重新取捨；形制照 [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile)。
本 app 屬於 **nodeapp WebApp 家族**；共同規範在 <https://github.com/scottgfhong310/nodeapp-webapp-family>。

## 功能

- **單一畫面、整頁不捲**：藏文與拉丁轉寫**左右並排（寬 2:1）**、各自捲動，文字靠底貼著輸入列；正在往後打時自動捲到最新的字。
- **只輸出藏文與拉丁**：不輸出悉曇——藏文梵字的組字與悉曇的組字並不是一一對應，並排反而造成混淆。要悉曇請用 [bonji-mobile](https://github.com/scottgfhong310/bonji-mobile)。
- **跟著鍵盤**：鍵盤彈出時畫面縮到鍵盤上緣（iOS 以 `visualViewport`、Android 以 `interactive-widget=resizes-content`），頁首自動收起把高度讓給輸出。
- **記號列（母音 → 子音 → 下加輔音 → 元音符號 → 標點）**：輸入框右側一顆鈕依序切換五組，共 108 鍵；鍵上畫**藏文字形**、底下印記法，一鍵插入，按鍵不會讓鍵盤收起。鍵位與 tibetan-siddham 的輔助輸入面板是同一份資料。
  子音鍵帶隱含 a（`ka`）；要接母音請用下加輔音那一組（`k`＋`i`＝ཀི）。
- **標點**：忽略空格時，兩個空格＝分隔點 `་`（tsheg）；三個空格＝一個全形空格；`|`＝`།`、`||`＝`༎`、`~`＝`𑗁`、`~~`＝`༄`。完整的標點政策見 tibetan-siddham 的 DESIGN §5。
- **選項**（右上角 `tune`）：輸入法（ISO 15919 / Kyoto-Harvard）、拉丁轉寫（ISO 15919 / IAST）、忽略空格與連字號。
- **紀錄清單・JSON 輸出**（右上角 `{}`）：把目前的輸入加上**標題**記成一筆，再把整份清單輸出成 JSON（複製或下載）。**標題可以留空、可以重複**——一部咒語分好幾段記，每一段用同一個標題，輸出的 `part` 就是第幾段。打字時按藏文欄底部的加入鈕就能記一筆，鍵盤不會收起來。清單存在你的瀏覽器裡（不是備份）；Claude Artifacts 版則存在 artifact 的資料庫裡，關掉重開、換裝置都還在。
- 輸出各有複製鈕；範例 chips；輸入與選項自動存成草稿（只存在你的瀏覽器）。
- 內嵌 **Noto Serif Tibetan** 與 **Noto Sans Siddham**（皆 SIL OFL；後者只為藏文欄借用的 `𑗁`）；三語介面（`zh-Hant` / `en` / `ja`）；light / dark 主題。
- **零後端**：伺服器只送靜態檔。另有 [Claude Artifacts 版](https://claude.ai/artifact/9jxT8XXBY9wF2wyt67qXv7)（private）。

與 tibetan-siddham 不同的地方（不帶悉曇輸出、碼位欄、輔助輸入面板、對照表頁、存到伺服器的匯出檔）與理由見 [`DESIGN.md`](./DESIGN.md) §5。

## 執行

```bash
npm install
npm start                 # → http://localhost:3000/apps/tibetan-siddham-mobile/
npm run verify            # 契約檢查
```

## 記法（部分）

| 輸入 | 藏文 | 拉丁 |
|---|---|---|
| `o;m` | ཨོཾ | oṃ |
| `o;m  aa.h  huu~m` | ཨོཾ་ཨཱཿ་ཧཱུྃ | oṃ āḥ hūm̐ |
| `siddha;m` | སིདྡྷཾ | siddhaṃ |
| `hrii.h` | ཧྲཱིཿ | hrīḥ |
| `na ma.h |` | ནམཿ། | na maḥ | |

完整對照見 tibetan-siddham 的字元對照表。

## JSON 輸出的結構

```jsonc
{
  "app": "tibetan-siddham-mobile",
  "exportedAt": "2026-10-12T03:14:54.598Z",   // 按下複製／下載的那一刻
  "count": 2,
  "records": [
    {
      "seq": 1,                // 在整份清單裡第幾筆
      "part": 1,               // 同一個標題裡第幾段（標題重複時靠它分段）
      "title": "百字明",        // 可以是空字串、可以重複
      "options": { "inputMethod": "ISO15919", "transliteration": "IAST", "ignoreSpacesAndHyphens": true },
      "input": "o;m  aa.h  huu~m",             // 原樣（打了什麼就是什麼）
      "output": {              // 輸出當下現算；轉不出來時是 null，並多一個 "error"
        "tibetan": "ཨོཾ་ཨཱཿ་ཧཱུྃ",
        "latin": "oṃ āḥ hūm̐",
        "codepoints": "U+0F68 U+0F7C U+0F7E U+0F0B …"   // 藏文那一欄的碼位
      },
      "savedAt": "2026-10-12T03:14:54.598Z"    // 這一筆記下（或被取代）的時間
    },
    { "seq": 2, "part": 2, "title": "百字明", "…": "…" }
  ]
}
```

與 tibetan-siddham 的匯出檔不同的地方：一份是**一整份清單**（不是一筆）；`output` **沒有 `siddham`**；沒有 `sourceFile`。

## 授權

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)。內含 tibetan-siddham 的轉換核心（MIT，同作者）、**bonji-input** 引擎（MIT，© 2021 Ryusei Yamaguchi），以及 **Noto Serif Tibetan** 與 **Noto Sans Siddham**（SIL OFL 1.1，見 `fonts/*-OFL.txt`）。
