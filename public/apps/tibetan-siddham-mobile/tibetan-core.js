/**
 * tibetan.js
 * bonji-input ASCII -> Tibetan spelling for Sanskrit.
 * Call initTibetan() once (loads ./data/tibetan.tsv) before ascii2tibetan().
 */

// tibetan.flex.vowelalias.js

const U = {
  TSHEG: "\u0F0B",    // ་
  A: "\u0F68",        // ཨ (vowel carrier)
  HALANTA: "\u0F84",  // ྄
};

// Independent forms for vocalic ṛ/ḷ when NOT stacked on a consonant.
// User requirement: ,r -> རྀ (0F62 0F80), ,rr -> རཱྀ (0F62 0F81), ,l -> ལྀ (0F63 0F80), ,ll -> ལཱྀ (0F63 0F81)
const INDEPENDENT_VOWEL = new Map([
  [",r",  "\u0F62\u0F80"], ["r.",  "\u0F62\u0F80"],
  [",rr", "\u0F62\u0F81"], ["rr.", "\u0F62\u0F81"],
  [",l",  "\u0F63\u0F80"], ["l.",  "\u0F63\u0F80"],
  [",ll", "\u0F63\u0F81"], ["ll.", "\u0F63\u0F81"],
]);

function isSubjoinedChar(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  // Subjoined consonants are mostly U+0F90..U+0FBC plus U+0FB4 (subjoined SHA) etc.
  return (cp >= 0x0F90 && cp <= 0x0FBC) || cp === 0x0FB4;
}

let _vocab = null;

function toSubjoined(baseChar) {
  const cp = baseChar.codePointAt(0);
  return String.fromCodePoint(cp + 0x50);
}

function splitPreserveWhitespace(input) {
  return input.split(/(\s+)/);
}

function sortKeysByLengthDesc(keys) {
  return Array.from(keys).sort((a, b) => b.length - a.length);
}

function tokenizeChunk(s, vocab) {
  const { vowel, cons, sign } = vocab;
  const consKeys = sortKeysByLengthDesc(cons.keys());
  const vowelKeys = sortKeysByLengthDesc(vowel.keys());
  const signKeys = sortKeysByLengthDesc(sign.keys());

  const out = [];
  let i = 0;

  while (i < s.length) {
    let matched = false;

    for (const k of signKeys) {
      if (k && s.startsWith(k, i)) {
        out.push({ t: "sign", v: k });
        i += k.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (const k of consKeys) {
      if (k && s.startsWith(k, i)) {
        out.push({ t: "cons", v: k });
        i += k.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (const k of vowelKeys) {
      if (k && s.startsWith(k, i)) {
        out.push({ t: "vowel", v: k });
        i += k.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    out.push({ t: "raw", v: s[i] });
    i += 1;
  }

  return out;
}

function renderChunk(s, vocab) {
  const toks = tokenizeChunk(s, vocab);
  const { vowel, cons, sign } = vocab;

  const consTokens = [];
  let vowelToken = null;
  const signs = [];

  function buildSyllable() {
    if (consTokens.length === 0 && vowelToken === null && signs.length === 0) return "";

    let out = "";

    if (consTokens.length === 0) {
      // Pure vowel (or sign-only) syllable.
      // Special-case vocalic ṛ/ḷ: standalone should be རྀ/རཱྀ/ལྀ/ལཱྀ (not carrier ཨ + ྲྀ/ཷ/ླྀ/ཹ).
      const indep = vowelToken ? INDEPENDENT_VOWEL.get(vowelToken) : null;
      if (indep) {
        out += indep;
      } else {
        out += U.A; // vowel carrier
        if (vowelToken && vowelToken !== "a") out += (vowel.get(vowelToken) ?? "");
      }
    } else {
      const first = cons.get(consTokens[0]) ?? "";
      out += first;

      for (let i = 1; i < consTokens.length; i++) {
        const base = cons.get(consTokens[i]) ?? "";
        if (!base) continue;
        // Allow "already-subjoined" tokens (e.g., c -> ྩ) to pass through without re-subjoining.
        out += isSubjoinedChar(base) ? base : toSubjoined(base);
      }

      if (vowelToken && vowelToken !== "a") {
        out += (vowel.get(vowelToken) ?? "");
      } else if (!vowelToken) {
        // If last consonant token ends with 'a' (e.g., ca/cha/;na/.ta), treat it as implicit 'a' and do NOT add halanta.
        const lastTk = consTokens[consTokens.length - 1] ?? "";
        const implicitA = typeof lastTk === "string" && lastTk.endsWith("a");
        if (!implicitA) out += U.HALANTA;
      }
    }

    out += signs.join("");

    // reset accumulators
    consTokens.length = 0;
    vowelToken = null;
    signs.length = 0;

    return out;
  }

  let out = "";

  for (const tk of toks) {
    if (tk.t === "raw") {
      // preserve raw position: flush syllable before emitting raw
      out += buildSyllable();
      out += tk.v;
      continue;
    }

    if (tk.t === "sign") {
      signs.push(sign.get(tk.v) ?? "");
      continue;
    }

    if (tk.t === "cons") {
      // if a vowel already started, treat this as a new syllable boundary
      if (vowelToken !== null) out += buildSyllable();
      consTokens.push(tk.v);
      continue;
    }

    if (tk.t === "vowel") {
      // second vowel => new syllable boundary
      if (vowelToken !== null) out += buildSyllable();
      vowelToken = tk.v;
      continue;
    }
  }

  out += buildSyllable();
  return out.normalize("NFC");
}

/**
 * Load tibetan mapping table.
 */
export async function initTibetan() {
  const candidates = [
    new URL("./data/tibetan.tsv", import.meta.url),
    new URL("./tibetan.tsv", import.meta.url),
  ];
  let res = null;
  let lastErr = null;
  for (const u of candidates) {
    try {
      const r = await fetch(u);
      if (r.ok) { res = r; break; }
      lastErr = new Error(`HTTP ${r.status} while loading ${u}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res) throw new Error("Failed to load tibetan.tsv (tried ./data/tibetan.tsv and ./tibetan.tsv). " + (lastErr ? String(lastErr) : ""));
  if (!res.ok) throw new Error("Failed to load ./data/tibetan.tsv: " + res.status);
  const text = await res.text();

  const vowel = new Map();
  const cons = new Map();
  const sign = new Map();
  const punct = new Map();

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const kind = parts[0].trim();
    const token = parts[1];
    const out = parts[2];

    if (kind === "vowel") {
      vowel.set(token, out);
      // IAST/ISO15919 compatibility: siddham.js normalizes ṛ/ḷ as ",r" ",l" etc
      // Allow those tokens for Tibetan, too.
      const alias = (token === "r.") ? ",r"
                 : (token === "rr.") ? ",rr"
                 : (token === "l.") ? ",l"
                 : (token === "ll.") ? ",ll"
                 : null;
      if (alias) vowel.set(alias, out);
    }
    else if (kind === "cons") cons.set(token, out);
    else if (kind === "sign") sign.set(token, out);
    else if (kind === "punct") punct.set(token, out);
  }

  _vocab = { vowel, cons, sign, punct };
}

/**
 * ASCII -> Tibetan (sync after initTibetan()).
 */
export function ascii2tibetan(text, opts = {}) {
  if (!_vocab) throw new Error("tibetan.js not initialized. Call initTibetan() before ascii2tibetan().");

  const ignoreSpacesAndHyphens = !!opts.ignoreSpacesAndHyphens;
  const spaceToTsheg = opts.spaceToTsheg !== false;

  const parts = splitPreserveWhitespace(text);
  let out = "";
  // \u5ffd\u7565\u7a7a\u683c\u6a21\u5f0f\u4e0b\uff0c\u9023\u7e8c \u22652 \u500b\u7a7a\u683c = \u4e00\u500b\u300c\u986f\u5f0f tsheg\u300d(U+0F0B)\uff1a
  // \u5148\u8a18\u6210 pending\uff0c\u7b49\u4e0b\u4e00\u500b\u6709\u5167\u5bb9\u7684 chunk \u51fa\u73fe\u6642\u624d\u88dc\u4e0a\uff1bout \u70ba\u7a7a(\u958b\u982d)\u6642\u4e0d\u88dc\u3001
  // \u7d50\u5c3e\u7684 pending \u76f4\u63a5\u4e1f\u68c4 \u2014\u2014 \u9054\u6210\u300c\u9996\u5c3e\u4e0d\u8f38\u51fa tsheg\u300d\u3002\u55ae\u4e00\u7a7a\u683c\u4ecd\u5ffd\u7565(\u4f46\u4ecd\u662f chunk \u908a\u754c)\u3002
  let pendingTsheg = false;

  for (const p of parts) {
    if (!p) continue;

    if (/^\s+$/.test(p)) {
      if (ignoreSpacesAndHyphens) {
        const newlines = p.replace(/[^\n]/g, "");
        if (newlines) {
          // \u63db\u884c\uff1a\u4fdd\u7559\u63db\u884c\uff0c\u4e26\u53d6\u6d88 pending(\u63db\u884c\u672c\u8eab\u662f\u66f4\u5f37\u7684\u5206\u9694)
          out += newlines;
          pendingTsheg = false;
        } else if ((p.match(/[^\S\n]/g) || []).length >= 2) {
          pendingTsheg = true;   // \u22652 \u500b\u7a7a\u683c \u2192 \u4e00\u500b tsheg(\u5ef6\u5f8c\u8f38\u51fa)
        }
        // \u55ae\u4e00\u7a7a\u683c\uff1a\u5ffd\u7565
      } else {
        if (p.includes("\n")) out += p;
        else out += spaceToTsheg ? U.TSHEG : " ";
      }
      continue;
    }

    // normalize hyphen variants away (treat as optional)
    const chunk = p.replace(/[-\u2010\u2011\u2012\u2013]/g, "");
    const rendered = renderChunk(chunk, _vocab);
    if (rendered) {
      if (pendingTsheg && out.length > 0) out += U.TSHEG;   // \u53ea\u5728\u5167\u5bb9\u4e4b\u9593\u88dc tsheg
      pendingTsheg = false;
      out += rendered;
    }
  }

  return out;
}
