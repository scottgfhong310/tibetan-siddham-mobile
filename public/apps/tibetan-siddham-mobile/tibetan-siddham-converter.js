// SPDX-License-Identifier: MIT
// 藏文梵字 + 悉曇 轉換的「防腐層」(anti-corruption layer)。
//
// 這是本 App 的唯一轉換介面：把兩個下層引擎包成單一對外 class。
//   - vendored 悉曇引擎  ./vendor/bonji-input/siddham.js（Copyright (c) 2021 Ryusei Yamaguchi, MIT；勿改邏輯）
//   - 本專案藏文核心      ./tibetan-core.js（initTibetan + ascii2tibetan，純規則、不碰 DOM）
//
// App 其餘程式（tibetan-siddham.js 控制器）只 import 本檔，
// 不得直接 import vendor/bonji-input/siddham.js 或 tibetan-core.js。
//
// 純邏輯、不碰 DOM。比 bonji 的 SiddhamConverter 多一步 async 載表：
// 藏文核心需先 fetch ./data/tibetan.tsv（故 convert() 前要先 await ready()）。

import { ascii2latin, ascii2siddham, ascii2symbol, latin2ascii } from "./vendor/bonji-input/siddham.js"
import { ascii2tibetan, initTibetan } from "./tibetan-core.js"

/**
 * @typedef {Object} TibetanSiddhamOptions
 * @property {"ISO15919" | "KH"}   inputMethod            輸入羅馬轉寫法
 * @property {"ISO15919" | "IAST"} transliteration        拉丁轉寫輸出法
 * @property {boolean}             ignoreSpacesAndHyphens  忽略可見空格與連字號
 */

/**
 * @typedef {Object} TibetanSiddhamResult
 * @property {string} input       輸入文字（原樣回傳）
 * @property {string} tibetan     藏文梵字（主要輸出）
 * @property {string} siddham     悉曇文字
 * @property {string} latin       拉丁轉寫
 * @property {{ tibetan: string, siddham: string, latin: string }} codepoints  各輸出對應的 Unicode 碼位
 */

export class TibetanSiddhamConverter {
    /** @type {TibetanSiddhamOptions} */
    static defaultOptions = {
        inputMethod: "ISO15919",
        transliteration: "IAST",
        ignoreSpacesAndHyphens: true,
    }

    // 字元對照表用：把藏文側的 token 正規化成 Siddham 引擎認得的同音 ascii（見 siddhamForToken）。
    static SIDDHAM_TOKEN_ALIAS = {
        // vocalic ṛ/ḷ：點記法 → 逗號記法
        "r.": ",r", "rr.": ",rr", "l.": ",l", "ll.": ",ll",
        // 大寫逆舌音別名 → 小寫全形（同音）
        "T": ".ta", "Th": ".tha", "D": ".da", "Dh": ".dha", "N": ".na", "Sh": ".sa",
    }

    // 引擎的符號記法（vendored 引擎 ascii2symbol 的表；`|` 與 `||` 另有標點政策，不在這裡）。
    // 引擎在管線最前面就把它們換成悉曇記號，之後三條轉換都原樣留著 ⇒ 由本層依文字分流（DESIGN §5）：
    //   悉曇：保留（那本來就是悉曇的記號）
    //   拉丁：還原成輸入的記法（`--` 還是 `--`、`2` 還是 `2`）
    //   藏文：只有 `--` 留成 U+115C1（與 `~` 同一個字，藏文欄本來就借用它），其餘還原成字面
    // ⚠️ 這張清單是引擎那張表的鍵的第二份。引擎多了一個記法而這裡沒跟上的話，那個記號會照舊穿進
    //    拉丁欄與藏文欄——scripts/verify.js 直接讀引擎原始碼的表逐一去驗，漏了會紅。
    static ENGINE_SYMBOL_TOKENS = [
        "--", ",,", "..", "*", "2", "@", "=",
        "*0", "*1", "*2", "*3", "*4", "*5", "*6", "*7",
        "o2", "o2x", "ox2", "ox3", "ox4", "oxx",
    ]

    /** @type {Map<string, string> | null} 悉曇記號 → 輸入的記法（第一次用到時向引擎問出來） */
    static _symbolTokens = null

    /** @returns {Map<string, string>} */
    static symbolTokens() {
        if (!TibetanSiddhamConverter._symbolTokens) {
            const map = new Map()
            for (const token of TibetanSiddhamConverter.ENGINE_SYMBOL_TOKENS) {
                // 問引擎「這個記法會變成什麼」，不在這裡再寫一份碼位。
                // 引擎不認得的記法（例如換回沒有那 14 項的上游）會留下 ASCII ⇒ 不是單一記號，跳過。
                const out = Array.from(ascii2symbol(token))
                if (out.length === 1 && /** @type {number} */ (out[0].codePointAt(0)) > 0x7F) map.set(out[0], token)
            }
            TibetanSiddhamConverter._symbolTokens = map
        }
        return TibetanSiddhamConverter._symbolTokens
    }

    /**
     * 把引擎留下的悉曇記號還原成輸入的記法；`keep` 裡的記號原樣留著。
     * @param {string} text @param {string} [keep] @returns {string}
     */
    static restoreSymbols(text, keep = "") {
        const map = TibetanSiddhamConverter.symbolTokens()
        return Array.from(text, ch => (map.has(ch) && !keep.includes(ch)) ? map.get(ch) : ch).join("")
    }

    /** @param {Partial<TibetanSiddhamOptions>} [options] */
    constructor(options = {}) {
        /** @type {TibetanSiddhamOptions} */
        this.options = { ...TibetanSiddhamConverter.defaultOptions, ...options }
        /** @type {Promise<void> | null} */
        this._ready = null
    }

    /** @param {Partial<TibetanSiddhamOptions>} patch @returns {this} */
    setOptions(patch) {
        this.options = { ...this.options, ...patch }
        return this
    }

    /**
     * 載入藏文對照表（idempotent）。convert() 前必須先 await。
     * @returns {Promise<void>}
     */
    ready() {
        if (!this._ready) this._ready = initTibetan()
        return this._ready
    }

    /**
     * 把輸入羅馬轉寫一次轉成「藏文梵字 + 悉曇 + 拉丁 + 碼位」。
     * 須先 await ready()（否則藏文核心未載表會丟錯）。
     *
     * 管線（沿用孵化器原型的驗證路徑）：
     *   原文 → ascii2symbol → latin2ascii(inputMethod) → 共用 ascii
     *   ascii → ascii2tibetan / ascii2siddham / ascii2latin
     *
     * @param {string} input
     * @returns {TibetanSiddhamResult}
     */
    convert(input) {
        const { inputMethod, transliteration, ignoreSpacesAndHyphens } = this.options
        const ascii = latin2ascii(ascii2symbol(String(input ?? "")), { inputMethod })

        // 標點（跨文字政策集中在此 ACL；藏文為主、悉曇僅對照）：
        //   | → 𑗅(U+115C5)、|| → 𑗉(U+115C9)：引擎 ascii2symbol 先轉成的 Siddham 標點。
        //   ~ / ~~ 不被引擎轉換，以字面殘留輸出（~m / ~n 是既有 token、已先被吃掉，不受影響）。
        //
        //   藏文：| → ། shad、|| → ༎ nyis shad、~ → 𑗁 siddhaṃ 符、~~ → ༄ yig mgo；
        //         任一標點後若接 tsheg(來自雙空格) → 改成一個普通空格(慣例接空格、非 tsheg)。
        //   悉曇：忽略 | / || / ~ / ~~（不輸出標點）。
        //   拉丁：| / || 還原（IAST daṇḍa 記法）、~ / ~~ 忽略。
        //
        // 引擎的其他符號記法（-- ,, .. * 2 @ = *0–*7 o2…）：見 ENGINE_SYMBOL_TOKENS 的說明。
        //   藏文只留 -- → U+115C1，其餘還原成字面；悉曇保留；拉丁全部還原。
        //
        // 三個半形空格 → 一個全形空格 U+3000（藏文與悉曇；不論「忽略空格」開關；DESIGN §5.3）：
        //   先依「三個空格」把 ascii 切段，各段各自轉，段與段之間補 U+3000。由左而右每三個一組，
        //   剩下的一個或兩個留在後一段的開頭、照原本的規則（兩個 → tsheg、一個 → 音節邊界）。
        //   切段再轉（而不是轉完再換）是因為兩個引擎都把空格吃掉或改寫了，轉完就認不出原本是幾個；
        //   各段獨立也讓它自然成為邊界（n␣␣␣a 的悉曇是 n＋virama、a 是獨立母音）。
        //   藏文：全形空格後面不接 tsheg（同「標點後不接 tsheg」）。拉丁：不動（照舊收斂成一個空格）。
        const SID_BAR = "\u{115C5}"        // 來自 |
        const SID_DBL = "\u{115C9}"        // 來自 ||
        const SIDDHAM_SIGN = "\u{115C1}"   // 𑗁（~ 對應）
        const YIG_MGO = "༄"           // ༄（~~ 對應）
        const WIDE_SPACE = "\u3000"       // 全形空格（三個半形空格對應）
        const pieces = ascii.split("   ")

        const tibetan = TibetanSiddhamConverter.restoreSymbols(
            pieces.map(piece => ascii2tibetan(piece, { ignoreSpacesAndHyphens })).join(WIDE_SPACE), SIDDHAM_SIGN)
            .split(SID_DBL).join("༎")
            .split(SID_BAR).join("།")
            .split("~~").join(YIG_MGO)        // ~~ → ༄（先處理雙）
            .split("~").join(SIDDHAM_SIGN)    // ~  → 𑗁
            .replace(/([།༎༄\u{115C1}])་/gu, "$1 ")   // 標點後的 tsheg → 一個空格
            .replace(/\u3000་+/g, WIDE_SPACE)        // 全形空格後的 tsheg → 不輸出
        const siddham = pieces.map(piece => ascii2siddham(piece, { ignoreSpacesAndHyphens })).join(WIDE_SPACE)
            .split(SID_DBL).join("")          // 悉曇忽略 ||
            .split(SID_BAR).join("")          // 悉曇忽略 |
            .split("~").join("")              // 悉曇忽略 ~ / ~~
        // 拉丁轉寫：| / ||（IAST daṇḍa 記法）；~ / ~~ 忽略；再把連續空格收斂成一個
        const latin = TibetanSiddhamConverter.restoreSymbols(ascii2latin(ascii, { transliteration }))
            .split(SID_DBL).join("||")
            .split(SID_BAR).join("|")
            .split("~").join("")
            .replace(/[^\S\n]{2,}/g, " ")

        return {
            input,
            tibetan,
            siddham,
            latin,
            codepoints: {
                tibetan: TibetanSiddhamConverter.toCodepoints(tibetan),
                siddham: TibetanSiddhamConverter.toCodepoints(siddham),
                latin: TibetanSiddhamConverter.toCodepoints(latin),
            },
        }
    }

    /**
     * 給「對照」檢視用（DESIGN §14）：把輸入依空白切成一格一格，每一格各自轉換。
     *
     * 一格＝輸入裡一段不含空白的記法；start／end 是它在**原始輸入**裡的位置
     * （不是 ascii 裡的——ascii2symbol／latin2ascii 會改變長度，ā → aa），控制器拿它去選取輸入框。
     * 各格各自轉得出與整段相同的結果，是因為藏文核心本來就以空白切塊、一塊一塊轉，
     * 空白只決定塊與塊之間接什麼（一個＝直接相接、兩個＝tsheg、三個＝全形空格）；
     * scripts/verify.js 第 ⑫ 條拿整段的 convert() 去對，不信這段話。
     * 只給藏文與拉丁：悉曇引擎會跨過單一空格組成連字，一格一格轉出來的不是整段的那個樣子。
     *
     * @param {string} input
     * @returns {Array<{ text: string, start: number, end: number, gap: string, tibetan: string, latin: string }>}
     *   gap：這一格前面的空白原文（第一格是行首的空白，可能是空字串）——怎麼畫由控制器決定
     */
    segments(input) {
        const text = String(input ?? "")
        const out = []
        let last = 0
        for (const m of text.matchAll(/\S+/g)) {
            const start = /** @type {number} */ (m.index)
            const r = this.convert(m[0])
            out.push({ text: m[0], start, end: start + m[0].length, gap: text.slice(last, start), tibetan: r.tibetan, latin: r.latin.trim() })
            last = start + m[0].length
        }
        return out
    }

    /**
     * 給「字元對照表」用：把單一 ascii token 對到 Siddham 字形（參考用途，非整串轉換）。
     * 維持邊界紀律：vendored 悉曇引擎只在本檔被 import，外部不直接碰。
     *
     * 先把「藏文側的記法」正規化成 Siddham 引擎認得的同音 ascii，再轉：
     *  - vocalic ṛ/ḷ 的點記法（r. / rr. / l. / ll.）→ Siddham 逗號記法（,r …），
     *    否則點會漏成字面 "."。
     *  - 大寫逆舌音別名（T/Th/D/Dh/N/Sh）→ Siddham 小寫全形（.ta …），補同音對應，
     *    與同欄的 .ta/.da/… 顯示一致。
     *
     * 仍無對應者（_uu、.x、.q、^h、空白、hyphen…）：引擎會殘留 ASCII，視為「無對應」回傳 ""。
     *
     * @param {string} token
     * @returns {string}
     */
    static siddhamForToken(token) {
        const t = TibetanSiddhamConverter.SIDDHAM_TOKEN_ALIAS[token] ?? token
        const s = ascii2siddham(t, { ignoreSpacesAndHyphens: true })
        if (!s || /[\x00-\x7F]/.test(s)) return ""
        return s
    }

    /** 文字 → 「U+XXXX …」碼位字串（逐行）。 @param {string} text @returns {string} */
    static toCodepoints(text) {
        return text.split("\n")
            .map(line =>
                Array.from(line)
                    .map(ch =>
                        `U+${/** @type {number} */ (ch.codePointAt(0))
                            .toString(16)
                            .toUpperCase()
                            .padStart(4, "0")}`
                    )
                    .join(" ")
            )
            .join("\n")
    }
}
