# Vendored: bonji-input Siddham engine

- Source:        https://github.com/mandel59/bonji-input
- Upstream base: 0a7eadd75ee475902879245ace39379bca820d36 (`public/siddham.js`)
- License:       MIT (see ./LICENSE)
- Files taken:
  - siddham.js            (悉曇引擎；**上游 ＋ 14 個符號記法**，見下)

> 本檔取自 nodeapp WebApp 家族的孵化器原型 `InProgress/public/apps/tibetan/lib/siddham.js`。

## ⚠️ 這一份不是原樣的上游

〔2026-10-11 逐位元組實查；本檔先前寫「原樣不改」「與 `bonji` 是同一支引擎」，兩句都不精確〕

- **上游**：`mandel59/bonji-input` 的 HEAD 就是 `0a7eadd`（2023-01-13 之後沒有新 commit）。
- **`bonji` app 所 vendored 的那一份**與上游**逐位元組相同**（11,187 bytes）。
- **本檔**（11,514 bytes）＝上游 ＋ `ascii_symbol` 表裡的 **14 個項目**，其餘逐行相同。
  那 14 項是原型階段加的（原型檔的修改時間 2026-02-18），隨抽取一起帶進本 app：

  | 記法 | 碼位 | 記法 | 碼位 |
  |---|---|---|---|
  | `*0` | U+115D7 | `*7` | U+115D6 |
  | `*1` | U+115CA | `o2` | U+115CF |
  | `*2` | U+115CB | `o2x` | U+115D0 |
  | `*3` | U+115CC | `ox2` | U+115D1 |
  | `*4` | U+115CD | `ox3` | U+115D2 |
  | `*5` | U+115CE | `ox4` | U+115D3 |
  | `*6` | U+115D5 | `oxx` | U+115D4 |

  （原型的虛擬鍵盤把前 8 個歸在「星號」、後 6 個歸在「圈號」。）

**行為上的差別**：上游把 `*1` 轉成 `U+115C4` ＋ 字面的 `1`、把 `o2` 轉成字面的 `o` ＋ `U+115C6`；
本檔把它們各轉成上表那**一個**碼位。這些記號不經過防腐層的標點政策，
**藏文／悉曇／拉丁三欄都會原樣出現**（實測）。

## 維護

- **升級引擎時不可整檔換成上游**——那 14 項會安靜地消失，而一般的梵字輸入完全看不出差別。
  要升級就取上游新版、把上表 14 項重新併進 `ascii_symbol`，並更新本檔的 Upstream base。
- **別的 app 要借用悉曇引擎，請從 `bonji` 抄，不要從這裡抄**——那一份才是原樣的上游
  （家族 `SHARED_LIBRARY_GUIDELINES.md` §4 登記的權威版也是它）。
- 除上述 14 項之外，**不要再改這支引擎的邏輯**；跨文字的政策一律寫在防腐層。

> 僅取悉曇（ASCII/IAST → Siddhaṁ / Latin）部分；本 app 的天城體（Devanāgarī）輸入
> **未** vendored（第一階段不做），故 `devanagari.js` / `devanagari.tsv` 刻意不在此目錄。

本 app 其餘程式**只 import `../../tibetan-siddham-converter.js`**（防腐層），
不得直接 import 本目錄下的 `siddham.js`，亦不得直接 import `tibetan-core.js`。
