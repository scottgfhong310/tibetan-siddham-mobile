#!/usr/bin/env node
/**
 * verify.js — tibetan-siddham-mobile 的契約檢查。
 *
 *   node scripts/verify.js             跑全部檢查（任何一條 FAIL ⇒ exit 1）
 *   node scripts/verify.js --selftest  反向驗證：在記憶體裡把世界改壞，每一種改壞都必須被抓到
 *
 * 檢查的是「這支 app 為什麼存在」的那幾個性質（輸出在上、輸入貼底、鍵盤不收、不放大），
 * 記號列的每一鍵與轉換器對不對得上，以及複製件與上游逐位元組相同。
 * 形制照 bonji-mobile 的 scripts/verify.js（條號重新編過——那邊 CBETA 字形的幾條這裡沒有，另多了藏文才有的幾條）。
 * ⚠️ 上游 repo 不在旁邊時，複製件那條回 SKIP——**SKIP 不是 PASS**，結尾會分開數。
 * ⚠️ 本檔不寫任何反斜線-u 的跳脫：寫檔工具會把它們換成實體字元（家族 CHANGELOG v2.146）。碼位一律用 String.fromCodePoint(0x…)。
 */
'use strict';

// 轉換模組是 ESM 而 package.json 沒有 type:module（app.js 是 CommonJS）
// ⇒ Node 會印一次 MODULE_TYPELESS_PACKAGE_JSON 警告。那是預期的，不讓它淹掉報表。
process.removeAllListeners('warning');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const zlib = require('zlib');
const { fileURLToPath, pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const NAME = 'tibetan-siddham-mobile';
const APP = path.join(REPO, 'public', 'apps', NAME);
const FAMILY = path.resolve(REPO, '..', 'nodeapp-webapp-family');
const UPSTREAM = path.resolve(REPO, '..', 'tibetan-siddham', 'public', 'apps', 'tibetan-siddham');
const FONT_TIBETAN = 'fonts/NotoSerifTibetan-Regular.ttf';
const FONT_SIDDHAM = 'fonts/NotoSansSiddham-Regular.woff2';

const read = (p) => fs.readFileSync(p, 'utf8');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const C = String.fromCodePoint;
const cps = (s) => Array.from(s, (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ') || '(空)';

/* ---------- 世界：所有檢查只讀這個物件，selftest 改的也是它 ---------- */
let ConverterClass = null;
async function loadConverter() {
  if (ConverterClass) return ConverterClass;
  // 藏文核心以 fetch(import.meta.url 的相對路徑) 讀 TSV；Node 的 fetch 不吃 file:// ⇒ 掛一個只讀本機檔的替身
  globalThis.fetch = async (u) => {
    const text = fs.readFileSync(fileURLToPath(String(u).split('?')[0]), 'utf8');
    return { ok: true, status: 200, text: async () => text };
  };
  const mod = await import(pathToFileURL(path.join(APP, 'tibetan-siddham-converter.js')));
  await new mod.TibetanSiddhamConverter().ready();   // 對照表是模組層共用的：載一次，之後每一個實例都能轉
  ConverterClass = mod.TibetanSiddhamConverter;
  return ConverterClass;
}

async function loadWorld() {
  const w = {
    html: read(path.join(APP, 'index.html')),
    css: read(path.join(APP, NAME + '.css')),
    js: read(path.join(APP, NAME + '.js')),
    libSrc: read(path.join(APP, NAME + '-lib.js')),
    assist: JSON.parse(read(path.join(APP, 'data', 'assist.json'))),
    tsv: read(path.join(APP, 'data', 'tibetan.tsv')),
    // Artifacts 版才有的檔：紀錄清單的同步、建置、備份
    remote: read(path.join(REPO, 'artifact', 'src', 'remote-db.js')),
    build: read(path.join(REPO, 'artifact', 'build.py')),
    backup: read(path.join(REPO, 'scripts', 'backup-artifact.sh')),
    fontTibetan: fs.readFileSync(path.join(APP, FONT_TIBETAN)),
    fontSiddham: fs.readFileSync(path.join(APP, FONT_SIDDHAM)),
    locales: {}
  };
  for (const code of ['zh-Hant', 'en', 'ja']) w.locales[code] = loadLocale(path.join(APP, 'locales', code + '.js'));
  w.Lib = loadLib(w.libSrc);
  w.Converter = await loadConverter();
  // 「哪些記法是記號（接在帶母音的音節之後）」取自規則表，不取自記號列的資料
  w.signs = new Set(w.tsv.split(/\r?\n/).filter((l) => l.startsWith('sign\t')).map((l) => l.split('\t')[1]));
  return w;
}

function loadLocale(file) {
  let dict = null;
  vm.runInNewContext(read(file), { I18n: { register: (c, d) => { dict = d; } } });
  return dict;
}

function loadLib(src) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.TibetanSiddhamMobileLib;
}

// 去掉註解的原始碼（CSS／JS 的區塊註解；JS 另去掉整行的 // 註解）
const noBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const jsCode = (s) => noBlockComments(s).replace(/^\s*\/\/.*$/gm, '');

/* ---------- 檢查 ---------- */
const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });
const SKIP = Symbol('skip');

// ① 轉換向量。期望值是**照 Unicode 碼位表逐字寫死的**（不取自轉換器的輸出）：
//    藏文字母 ཨ 0F68／ཀ 0F40／མ 0F58／ས 0F66／ད 0F51／ཧ 0F67，下加字 ྡ 0FA1／ྷ 0FB7／ྲ 0FB2，
//    母音與記號 ཱ 0F71／ི 0F72／ུ 0F74／ོ 0F7C／ཾ 0F7E／ཿ 0F7F／ྃ 0F83，標點 ་ 0F0B／། 0F0D／༎ 0F0E／༄ 0F04，
//    借用的悉曇記號 115C1，全形空格 3000。拉丁是 IAST（預設選項）。
const KA = C(0x0F40), MA = C(0x0F58), TSHEG = C(0x0F0B), SHAD = C(0x0F0D);
const VECTORS = [
  ['o;m', C(0x0F68, 0x0F7C, 0x0F7E), 'o' + C(0x1E43)],
  ['siddha;m', C(0x0F66, 0x0F72, 0x0F51, 0x0FA1, 0x0FB7, 0x0F7E), 'siddha' + C(0x1E43)],
  ['hrii.h', C(0x0F67, 0x0FB2, 0x0F71, 0x0F72, 0x0F7F), 'hr' + C(0x012B, 0x1E25)],
  ['huu~m', C(0x0F67, 0x0F71, 0x0F74, 0x0F83), 'h' + C(0x016B) + 'm' + C(0x0310)],
  ['ka ma', KA + MA, 'ka ma'],                                  // 一個空格：音節邊界，不輸出
  ['ka  ma', KA + TSHEG + MA, 'ka ma'],                         // 兩個空格：tsheg
  ['ka   ma', KA + C(0x3000) + MA, 'ka ma'],                    // 三個空格：全形空格
  ['ka|', KA + SHAD, 'ka|'],
  ['ka||', KA + C(0x0F0E), 'ka||'],
  ['ka~', KA + C(0x115C1), 'ka'],                               // ~ 在藏文欄借用悉曇記號；拉丁忽略
  ['~~ka', C(0x0F04) + KA, 'ka'],
  ['ka|  ma', KA + SHAD + ' ' + MA, 'ka| ma']                   // 標點後的 tsheg → 一個空格
];
check('① 轉換向量（藏文與拉丁；期望值照碼位表寫死）', (w) => {
  const c = new w.Converter();
  const bad = [];
  for (const [i, tib, lat] of VECTORS) {
    const r = c.convert(i);
    if (r.tibetan !== tib) bad.push(JSON.stringify(i) + ' 藏文 ' + cps(r.tibetan) + '（應為 ' + cps(tib) + '）');
    if (r.latin !== lat) bad.push(JSON.stringify(i) + ' 拉丁 ' + JSON.stringify(r.latin) + '（應為 ' + JSON.stringify(lat) + '）');
  }
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ② 記號列的每一鍵都在說一句話：「按這一鍵，藏文欄會出現鍵上的那個字」。那句話的兩半來自兩個地方——
//    字形與記法是 data/assist.json 寫的（經 lib 的 keysFromAssist），轉出什麼是防腐層算的 ⇒ 把記法真的餵給防腐層逐鍵比，
//    ISO 15919 與 Kyoto-Harvard 兩種輸入法各一次（兩者同字，記號列才只要一套）。
//    每一類在什麼前後文裡驗（同 tibetan-siddham 的 verify.js）：母音／子音直接比；元音符號接在 k 之後（記號接在 ka 之後）；
//    下加輔音接在 m 之後（m 不與任何字母併成別的記法）；標點夾在兩個音節之間。
function expectation(id, ins, char, signs) {
  switch (id) {
    case 'vowel':
    case 'consonant': return [ins, char];
    case 'vowel_sign': return [(signs.has(ins) ? 'ka' : 'k') + ins, KA + char];
    case 'subjoined': return ['m' + ins + 'a', MA + char];
    case 'punct': return ['ka' + ins + 'ka', KA + char + KA];
    default: return null;
  }
}
const carrierOf = (assist, id) => { const c = (assist.categories || []).find((x) => x.id === id); return (c && typeof c.carrier === 'string') ? c.carrier : ''; };
check('② 記號列每一鍵：記法餵給防腐層，藏文輸出＝鍵上的字形（ISO／KH）', (w) => {
  const bad = [];
  let n = 0;
  for (const id of w.Lib.KEYSET_IDS) {
    const keys = w.Lib.keysFromAssist(w.assist, id);
    if (!keys.length) { bad.push(id + ' 0 個鍵'); continue; }
    const carrier = carrierOf(w.assist, id);
    for (const k of keys) {
      if (!k.ins || k.variant) continue;                  // 沒有記法的格、與「鍵上的字形不是它轉出來的字」的固定形，由 ③ 管
      if (carrier && !k.glyph.startsWith(carrier)) { bad.push(id + ':' + k.label + ' 的字形沒有載體'); continue; }
      const ex = expectation(id, k.ins, k.glyph.slice(carrier.length), w.signs);
      if (!ex) { bad.push(id + '：不認得的類別，沒有驗證方式'); break; }
      for (const m of ['ISO15919', 'KH']) {
        n++;
        const got = new w.Converter({ inputMethod: m }).convert(ex[0]).tibetan;
        if (got !== ex[1]) bad.push(id + ':' + JSON.stringify(k.ins) + '（' + m + '）得到 ' + cps(got) + '，鍵上是 ' + cps(ex[1]));
      }
    }
  }
  if (n < 200) bad.push('只驗到 ' + n + ' 次（五組 × 兩種輸入法應有 200 次以上）——空的比對不算通過');
  return bad.length ? 'FAIL: ' + bad.slice(0, 8).join('；') : true;
});

// ③ 下加輔音裡的三個固定形插入它們所屬的那個音的記法〔owner 2026-10-12：ྻ（U+0FBB）＝y、ྼ（U+0FBC）＝r、ྺ（U+0FBA）＝v〕。
//    期望值寫死在這裡（取自 owner 的指示，不取自 assist.json 的 alt）。資料裡這三格沒有 code——轉換器打不出固定形——
//    所以 (a) lib 以 alt 當記法並標 variant；(b) 那個記法是真的記法：轉出來的是**同一個音的一般下加形**（兩種輸入法）；
//    (c) 轉換器仍然打不出固定形本身（哪天打得出來了，variant 這個標記與 ② 的豁免就該拿掉）；
//    (d) variant 只有這三格；(e) 真的沒有記法的格（現在 0 格）：lib 回空的 ins、控制器只出提示不插入、鍵畫淡。
const FIXED_FORMS = [[0x0FBB, 'y', 0x0FB1], [0x0FBC, 'r', 0x0FB2], [0x0FBA, 'v', 0x0FAD]];   // [固定形, 記法, 一般的下加形]
check('③ 三個固定形插入 y／r／v（owner 指定）；真的沒有記法的格不插入', (w) => {
  const bad = [];
  const carrier = carrierOf(w.assist, 'subjoined');
  const keys = w.Lib.keysFromAssist(w.assist, 'subjoined');
  for (const [fixed, ins, plain] of FIXED_FORMS) {
    const k = keys.find((x) => x.glyph === carrier + C(fixed));
    if (!k) { bad.push(cps(C(fixed)) + ' 不在下加輔音裡'); continue; }
    if (k.ins !== ins || k.label !== ins) bad.push(cps(C(fixed)) + ' 插入 ' + JSON.stringify(k.ins) + '（應為 ' + ins + '）');
    if (!k.variant) bad.push(cps(C(fixed)) + ' 沒有標成 variant（② 會拿它的字形去比轉換結果）');
    for (const m of ['ISO15919', 'KH']) {
      const got = new w.Converter({ inputMethod: m }).convert('m' + ins + 'a').tibetan;
      if (got !== MA + C(plain)) bad.push(ins + '（' + m + '）轉出 ' + cps(got) + '（應為 ' + cps(MA + C(plain)) + '）');
      if (got === MA + C(fixed)) bad.push(ins + ' 其實打得出固定形——variant 的前提不成立了');
    }
  }
  for (const id of w.Lib.KEYSET_IDS) {
    for (const k of w.Lib.keysFromAssist(w.assist, id)) {
      if (k.variant && !(id === 'subjoined' && FIXED_FORMS.some(([f]) => k.glyph === carrier + C(f)))) bad.push(id + ':' + k.label + ' 被標成 variant');
      if (!k.ins) bad.push(id + ' 有沒有記法的格（' + cps(k.glyph) + '）');
    }
  }
  // 真的沒有記法的格：lib 不替它編記法
  const none = w.Lib.keysFromAssist({ categories: [{ id: 'subjoined', carrier: carrier, entries: [{ code: '', char: C(0x0FBB) }] }] }, 'subjoined')[0];
  if (!none || none.ins !== '' || none.variant) bad.push('沒有 code 也沒有 alt 的格被編了記法');
  if (!/var ins = b\.getAttribute\('data-ins'\);\s*if \(!ins\) \{[\s\S]{0,260}?return;\s*\}\s*insert\(ins\);/.test(w.js)) bad.push('控制器沒有先擋掉空的記法');
  if (!/'key' \+ \(k\.ins \? '' : ' key-noinput'\)/.test(w.js) || !/\.key-noinput\s*\{/.test(w.css)) bad.push('沒有記法的鍵看起來與可以插入的一樣');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ④ insertAt：取代選取範圍、游標落在插入文字之後、索引夾回範圍
check('④ insertAt', (w) => {
  const t = [
    [['abc', 1, 1, 'X'], 'aXbc', 2],
    [['abc', 0, 3, 'Z'], 'Z', 1],
    [['abc', 3, 3, ';m'], 'abc;m', 5],
    [['abc', 2, 1, '-'], 'a-c', 2],
    [['abc', 99, 99, '.h'], 'abc.h', 5],
    [['ka', 2, 2, '  '], 'ka  ', 4],                       // tsheg 鍵插入的是兩個空格，一個都不能少
    [['', undefined, undefined, 'aa'], 'aa', 2]
  ];
  const bad = t.filter(([a, v, c]) => { const r = w.Lib.insertAt(...a); return r.value !== v || r.caret !== c; });
  return bad.length ? 'FAIL: ' + JSON.stringify(bad.map((b) => b[0])) : true;
});

// ⑤ shellBox：有 visualViewport 時貼齊它（含 iOS 的 offsetTop）；沒有時退回 innerHeight；量不到回 null
check('⑤ shellBox', (w) => {
  const L = w.Lib;
  const ok =
    eq(L.shellBox({ vvHeight: 430.4, vvTop: 312.6, innerHeight: 812 }), { top: 313, height: 430 }) &&
    eq(L.shellBox({ vvHeight: NaN, vvTop: NaN, innerHeight: 700 }), { top: 0, height: 700 }) &&
    eq(L.shellBox({ vvHeight: 0, vvTop: 50, innerHeight: 640 }), { top: 0, height: 640 }) &&
    L.shellBox({}) === null;
  return ok || 'FAIL';
});

// ⑥ keyboardOpen：網址列收合（約 50–80px）不算鍵盤；少 120px 以上才算
check('⑥ keyboardOpen 門檻', (w) => {
  const k = w.Lib.keyboardOpen;
  const ok = !k(812, 732) && !k(812, 693) && k(812, 692) && k(812, 430) && !k(0, 430) && !k(812, NaN);
  return ok || 'FAIL';
});

// ⑦ 從 localStorage 讀回來的選項／草稿不可信：白名單以外一律退回預設
check('⑦ normalizeOptions／normalizeDraft', (w) => {
  const L = w.Lib;
  const d = L.DEFAULT_OPTIONS;
  const ok =
    eq(L.normalizeOptions({ inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false }),
      { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false }) &&
    eq(L.normalizeOptions({ inputMethod: 'x', transliteration: 3, ignoreSpacesAndHyphens: 'yes' }), d) &&
    eq(L.normalizeOptions(null), d) &&
    eq(L.normalizeDraft({ input: 5, options: 'bad' }), { input: '', options: d }) &&
    eq(L.normalizeDraft({ input: 'o;m' }), { input: 'o;m', options: d });
  return ok || 'FAIL';
});

// ⑧ 版型：輸出在上、記號列、輸入貼底（DOM 順序）——這支 app 存在的理由
check('⑧ DOM 順序：輸出 → 記號列 → 輸入', (w) => {
  const a = w.html.indexOf('id="out-pane"'), b = w.html.indexOf('id="keybar"'), c = w.html.indexOf('id="tsm-input"');
  return (a > 0 && a < b && b < c) || 'FAIL: out-pane / keybar / tsm-input 的順序不對';
});

// ⑨ 整頁不捲、外殼跟著可見範圍：body overflow hidden、.shell 讀 --shell-top／--shell-h、控制器寫它們
check('⑨ 外殼貼齊可見範圍', (w) => {
  const miss = [];
  if (!/html,\s*body\s*\{[^}]*overflow:\s*hidden/.test(w.css)) miss.push('html,body overflow:hidden');
  if (!/\.shell\s*\{[^}]*top:\s*var\(--shell-top/.test(w.css)) miss.push('.shell top');
  if (!/\.shell\s*\{[^}]*height:\s*var\(--shell-h/.test(w.css)) miss.push('.shell height');
  if (!/setProperty\('--shell-top'/.test(w.js) || !/setProperty\('--shell-h'/.test(w.js)) miss.push('controller setProperty');
  if (!/visualViewport\.addEventListener\('resize'/.test(w.js)) miss.push('visualViewport resize');
  if (!/interactive-widget=resizes-content/.test(w.html)) miss.push('viewport interactive-widget');
  return miss.length ? 'FAIL: ' + miss.join(', ') : true;
});

// ⑩ 不放大：會聚焦的控制項字級 ≥ 16px（iOS 小於 16 會放大整頁；取 20 給 Artifacts 版）
check('⑩ 控制項字級 ≥ 16px', (w) => {
  const m = w.css.match(/--ctl-font:\s*(\d+)px/);
  if (!m) return 'FAIL: 找不到 --ctl-font';
  if (+m[1] < 16) return 'FAIL: --ctl-font ' + m[1] + 'px';
  const inputUses = /\.tsm-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css);
  const selectUses = /select\.browser-default\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css);
  return (inputUses && selectUses) || 'FAIL: 輸入框或 select 沒用 --ctl-font';
});

// ⑪ 按記號鍵／清除鈕／切換鈕不可以讓輸入框失焦（mousedown 的預設動作就是搬焦點）
check('⑪ 記號列／清除鈕／切換鈕擋掉 mousedown', (w) => {
  const kb = /\$keybar\.addEventListener\('mousedown',[\s\S]{0,120}preventDefault\(\)/.test(w.js);
  const cl = /clearBtn\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js);
  const ks = /keysetBtn\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js);
  return (kb && cl && ks) || 'FAIL: ' + (!kb ? '記號列 ' : '') + (!cl ? '清除鈕 ' : '') + (!ks ? '切換鈕' : '');
});

// ⑫ 觸控裝置用原生 select、不用 .materialize-textarea（兩者在手機上各有一個安靜的壞法）
check('⑫ 原生 select／不用 materialize-textarea', (w) => {
  const selects = w.html.match(/<select[^>]*>/g) || [];
  const allNative = selects.length > 0 && selects.every((s) => /browser-default/.test(s));
  const noFormSelect = !/FormSelect/.test(w.js);
  const noMzTextarea = !/materialize-textarea/.test(w.html);
  return (allNative && noFormSelect && noMzTextarea) || 'FAIL';
});

// ⑬ 手機輸入框不要自動大寫／自動校正（會把記法改壞；KH 的大小寫有意義）
check('⑬ 輸入框關掉自動大寫／校正', (w) => {
  const tag = (w.html.match(/<textarea[^>]*id="tsm-input"[^>]*>/) || [''])[0];
  const need = ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'];
  const miss = need.filter((a) => tag.indexOf(a) < 0);
  return miss.length ? 'FAIL: ' + miss.join(' ') : true;
});

// ⑭ i18n：三語 key 集合相同；HTML 與控制器用到的 key 都有定義
check('⑭ i18n key 齊全', (w) => {
  const sets = Object.values(w.locales).map((d) => Object.keys(d).sort().join('|'));
  if (new Set(sets).size !== 1) return 'FAIL: 三語 key 集合不同';
  const dict = w.locales['zh-Hant'];
  const used = new Set();
  for (const m of w.html.matchAll(/data-i18n(?:-html|-title|-placeholder|-doctitle)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of w.js.matchAll(/I18n\.t\('([^']+)'\s*[,)]/g)) used.add(m[1]);   // 只收完整字面值；'keyset.' + x 這種前綴另列於下
  // 紀錄清單那一段的 key 是經 recToast／arm／recButton 的參數傳進 I18n.t 的 ⇒ 上面那條只認 I18n.t('…') 的規則看不到它們
  for (const m of w.js.matchAll(/'((?:rec|toast|out|keybar)\.[A-Za-z.]+)'/g)) used.add(m[1]);
  used.add('tool.more');   // side-tool.js 動態產生 #setting-more 時掛的（DESIGN_GUIDELINES §6）
  for (const id of w.Lib.KEYSET_IDS) used.add('keyset.' + id);   // I18n.t('keyset.' + state.keyset)
  const miss = [...used].filter((k) => !(k in dict));
  return miss.length ? 'FAIL: 未定義 ' + miss.join(', ') : true;
});

// ⑮ 共用文案逐字照 DESIGN_GUIDELINES §6 的正典表
check('⑮ 共用文案照 §6 正典', (w) => {
  const canon = {
    'tool.lang': ['語言', 'Language', '言語'],
    'tool.mode': ['切換 light / dark', 'Toggle light / dark', 'ライト / ダーク切替'],
    'tool.more': ['更多工具', 'More tools', 'その他のツール'],
    'toast.lang': ['已切換為 {name}', 'Switched to {name}', '{name} に切り替えました'],
    'toast.copied': ['已複製', 'Copied', 'コピーしました']
  };
  const codes = ['zh-Hant', 'en', 'ja'];
  const bad = [];
  for (const [k, v] of Object.entries(canon)) codes.forEach((c, i) => { if (w.locales[c][k] !== v[i]) bad.push(c + ':' + k); });
  return bad.length ? 'FAIL: ' + bad.join(' ') : true;
});

// ⑯ 字型：repo 裡只有 Noto Serif Tibetan 與 Noto Sans Siddham（皆 OFL）；CSS 沒有任何 local()
//    （iOS 的網頁讀不到使用者自己裝的字型，寫了也只是在桌機上碰巧命中——看起來正常，手機上是另一回事）
check('⑯ 字型只有兩支 Noto、沒有 local()', (w) => {
  const exts = new Set(['.ttf', '.otf', '.ttc', '.dfont', '.woff', '.woff2', '.eot']);
  const fonts = walk(REPO).filter((p) => exts.has(path.extname(p).toLowerCase()))
    .map((p) => path.relative(REPO, p)).filter((p) => !p.startsWith('node_modules') && !p.startsWith('artifact/dist')).sort();
  const want = ['public/apps/' + NAME + '/' + FONT_SIDDHAM, 'public/apps/' + NAME + '/' + FONT_TIBETAN].sort();
  const ok = eq(fonts, want);
  const noLocal = !/local\(/.test(noBlockComments(w.css));
  return (ok && noLocal) || 'FAIL: ' + fonts.join(', ') + (noLocal ? '' : '（CSS 有 local()）');
});

// ⑰ 原始碼沒有 NUL 位元組（會讓 grep 靜默跳過、git 當 binary）
check('⑰ 原始碼無 NUL', () => {
  const bad = walk(path.join(REPO, 'public')).concat(walk(path.join(REPO, 'scripts')), walk(path.join(REPO, 'artifact')))
    .filter((p) => /\.(js|html|css|py|sh|json|tsv)$/.test(p) && !p.includes('artifact/dist'))
    .filter((p) => fs.readFileSync(p).includes(0));
  return bad.length ? 'FAIL: ' + bad.map((p) => path.relative(REPO, p)).join(', ') : true;
});

// ⑱ 複製件與權威版逐位元組相同（上游不在旁邊 ⇒ SKIP）
const COPIES_FAMILY = ['side-tool.css', 'side-tool.js', 'i18n.js', 'materialize-dark.css'];
const COPIES_UPSTREAM = ['tibetan-siddham-converter.js', 'tibetan-core.js', 'data/tibetan.tsv', 'data/assist.json',
  'vendor/bonji-input/siddham.js', 'vendor/bonji-input/LICENSE', 'vendor/bonji-input/SOURCE.md',
  FONT_TIBETAN, 'fonts/NotoSerifTibetan-OFL.txt', FONT_SIDDHAM, 'fonts/NotoSansSiddham-OFL.txt'];
check('⑱ 複製件 md5（家族共用件＋tibetan-siddham 的轉換核心）', () => {
  if (!fs.existsSync(FAMILY) || !fs.existsSync(UPSTREAM)) return SKIP;
  const pairs = [...COPIES_FAMILY.map((f) => [path.join(FAMILY, f), f]), ...COPIES_UPSTREAM.map((f) => [path.join(UPSTREAM, f), f])];
  const bad = pairs.filter(([src, f]) => !fs.existsSync(src) || md5(src) !== md5(path.join(APP, f))).map((p) => p[1]);
  return bad.length ? 'FAIL: ' + bad.join(', ') : true;
});

// ⑲ 防腐層紀律：控制器與 lib 都不直接 import 藏文核心或 vendored 引擎
check('⑲ 不直接 import 引擎或藏文核心', (w) => {
  const re = /vendor\/bonji-input|tibetan-core/;
  const bad = re.test(jsCode(w.js)) || re.test(jsCode(w.libSrc));
  return !bad || 'FAIL';
});

// ⑳ 上緣安全區由外殼墊、不由頁首墊〔bonji-mobile，owner 2026-10-08：Claude App 裡標題被遮約 75%〕：
//    頁首是 height:48px ＋ border-box，墊在它身上會被吃進那 48px（標題只往下移一半）。
check('⑳ 安全區墊在外殼上', (w) => {
  const shell = /\.shell\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top/.test(w.css);
  // ⚠️ 錨在行首：檔案裡第一個 `.topbar {` 是 `body.kb-open .topbar { display:none }`，不錨的話這條會去看那一條而永遠綠
  const topbar = (w.css.match(/^\.topbar\s*\{[^}]*\}/m) || [''])[0];
  if (!topbar) return 'FAIL: 找不到 .topbar 規則';
  const toast = /#toast-container\s*\{[^}]*top:[^;]*safe-area-inset-top/.test(w.css);
  return (shell && !/safe-area-inset-top/.test(topbar) && toast) || 'FAIL: ' + (!shell ? '外殼沒墊 ' : '') + (/safe-area-inset-top/.test(topbar) ? '頁首又墊了 ' : '') + (!toast ? 'toast 沒讓開' : '');
});

// ㉑ 記號列切換鈕在清除鈕的右邊，且兩者都在輸入列裡（輸入 → 清除 → 切換）
check('㉑ 切換鈕在清除鈕右邊', (w) => {
  const bar = (w.html.match(/<div class="in-bar">[\s\S]*?<\/div>/) || [''])[0];
  const a = bar.indexOf('id="tsm-input"'), b = bar.indexOf('id="clear-input"'), c = bar.indexOf('id="keyset-toggle"');
  return (a >= 0 && a < b && b < c) || 'FAIL: in-bar 內的順序不是 輸入 → 清除 → 切換';
});

// ㉒ Claude App 裡鍵盤彈出時頁面被往上推、iframe 不縮〔bonji-mobile，owner 2026-10-08 截圖〕：
//    (a) 藏文與拉丁轉寫左右並排、2:1 寫進 flex-basis；(b) 文字靠底（margin-top:auto，不是 justify-content:flex-end）；
//    (c) 輸入框有焦點時外殼不墊底部安全區（高度判斷在那裡看不到鍵盤）。
check('㉒ 並排 2:1／文字靠底／聚焦不墊底', (w) => {
  const miss = [];
  if (!/\.out-pane\s*\{[^}]*flex-direction:\s*row/.test(w.css)) miss.push('out-pane 不是 row');
  if (!/\.out-block-tibetan\s*\{[^}]*flex:\s*0 0 calc\(\(100% - 8px\) \* 2 \/ 3\)/.test(w.css)) miss.push('藏文不是 2/3 basis');
  if (!/^\.out-text\s*\{[^}]*margin-top:\s*auto/m.test(w.css)) miss.push('文字沒靠底');
  if (/justify-content:\s*flex-end/.test((w.css.match(/^\.out-value\s*\{[^}]*\}/m) || [''])[0])) miss.push('用了 flex-end（溢出的上半截會捲不上去）');
  if (!/\.shell:has\(#tsm-input:focus\)\s*\{[^}]*padding-bottom:\s*0/.test(w.css)) miss.push('聚焦時仍墊底部安全區');
  const to = w.html.match(/class="out-value"><div id="out-tibetan" class="out-text/);
  const lo = w.html.match(/class="out-value"><div id="out-latin" class="out-text/);
  if (!to || !lo) miss.push('輸出文字不在 .out-value 裡的 .out-text');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉓ 複製鈕在欄位底部：Claude App 裡鍵盤開著時欄位頂端被 App 標題列蓋住（㉒ 同一個成因），放頂端就按不到。
//    每一欄都要「捲動框在前、含複製鈕的 .out-foot 在後」。
const outBlock = (html, k) => (html.match(new RegExp('<div class="out-block out-block-' + k + '">[\\s\\S]*?\\n      </div>')) || [''])[0];
check('㉓ 複製鈕在欄位底部', (w) => {
  const bad = [];
  for (const k of ['tibetan', 'latin']) {
    const blk = outBlock(w.html, k);
    const v = blk.indexOf('id="out-' + k + '"'), f = blk.indexOf('class="out-foot"'), c = blk.indexOf('data-copy="' + k + '"');
    if (!(v >= 0 && v < f && f < c)) bad.push(k);
  }
  return bad.length ? 'FAIL: ' + bad.join('、') + ' 的複製鈕不在捲動框之後的 .out-foot 裡' : true;
});

// ㉔ 記號列五組的順序：母音 → 子音 → 下加輔音 → 元音符號 → 標點〔owner 2026-10-12 指定：「將下加輔音的位置放到元音的前面（兩個位置對調）」；
//    在那之前照 data/assist.json 的類別順序，元音符號在下加輔音前面〕。切換鈕依 KEYSET_IDS 的順序循環、預設是第一組 ⇒ 順序本身就是規格。
//    ⚠️ 順序不再等於資料的順序（桌機版面板仍是 元音符號 → 下加輔音）；**類別的集合**仍要與 assist.json 相同——那邊多一類或少一類而這裡沒跟上，這一條會紅。
//    每一組的鍵數＝資料那一類的格數（不去重、不漏）；總數 108 是上游文件寫的數字（期望值不取自 lib）。
check('㉔ 記號列五組依序：母音 → 子音 → 下加輔音 → 元音符號 → 標點（類別＝assist.json 的五類）', (w) => {
  const ids = w.Lib.KEYSET_IDS.join(',');
  if (ids !== 'vowel,consonant,subjoined,vowel_sign,punct') return 'FAIL: KEYSET_IDS = ' + ids;
  const cats = (w.assist.categories || []).map((c) => c.id).sort().join(',');
  if (cats !== w.Lib.KEYSET_IDS.slice().sort().join(',')) return 'FAIL: assist.json 的類別是 ' + cats + '（與記號列收的五類不同）';
  const counts = w.Lib.KEYSET_IDS.map((id) => w.Lib.keysFromAssist(w.assist, id).length);
  if (counts.join(',') !== '16,34,37,16,5') return 'FAIL: 各組鍵數 ' + counts.join(',') + '（應為 16,34,37,16,5 ＝ 108）';
  // 鍵數相同的兩組（母音與元音符號都是 16）對調了，上面那一行看不出來 ⇒ 另外確認第 3 組真的是下加輔音（有那三個固定形）、第 4 組的字形帶載體
  if (w.Lib.keysFromAssist(w.assist, w.Lib.KEYSET_IDS[2]).filter((k) => k.variant).length !== 3) return 'FAIL: 第 3 組不是下加輔音';
  if (!w.Lib.keysFromAssist(w.assist, w.Lib.KEYSET_IDS[3]).every((k) => k.glyph.startsWith(C(0x25CC)))) return 'FAIL: 第 4 組不是元音符號';
  const tsheg = w.Lib.keysFromAssist(w.assist, 'punct')[0];
  if (!tsheg || tsheg.ins !== '  ' || tsheg.glyph !== TSHEG || !tsheg.label.trim()) return 'FAIL: 標點組第一鍵不是 tsheg（兩個空格、鍵上有看得見的標示）';
  if (w.Lib.keysFromAssist(w.assist, 'nope').length || w.Lib.keysFromAssist(null, 'vowel').length) return 'FAIL: 不認得的組或讀不到資料時沒有回空陣列';
  if (w.Lib.normalizeKeyset('nope') !== 'vowel') return 'FAIL: 認不得的值沒有退回母音';
  return true;
});

// ㉕ **不處理悉曇**〔owner 2026-10-12：藏文梵字的組字與悉曇的組字並不是一一對應，並排反而造成混淆〕。
//    畫面沒有悉曇欄、控制器不讀防腐層回的悉曇、JSON 輸出沒有悉曇、文案沒有悉曇那一欄的標籤。
//    （防腐層是 tibetan-siddham 的複製件，照樣會算悉曇——那是它的事；本 app 只是不用。）
check('㉕ 不處理悉曇：畫面、控制器、JSON 輸出都沒有', (w) => {
  const miss = [];
  if (/out-siddham|siddham-text|data-copy="siddham"/.test(w.html)) miss.push('index.html 有悉曇欄');
  if (/\.siddham\b/.test(jsCode(w.js))) miss.push('控制器讀了 .siddham');
  if (/siddham-text|out-block-siddham/.test(noBlockComments(w.css))) miss.push('CSS 有悉曇欄的樣式');
  const exp = w.Lib.buildExport([w.Lib.makeRecord('t', 'ka', null, 'S')], (i, o) => { const r = new w.Converter(o).convert(i); return r; }, 'T');
  const keys = exp.records[0].output ? Object.keys(exp.records[0].output).join(',') : '（無）';
  if (keys !== 'tibetan,latin,codepoints') miss.push('JSON 輸出的 output 欄位是 ' + keys);
  for (const [code, d] of Object.entries(w.locales)) if ('out.siddham' in d) miss.push(code + ' 有 out.siddham');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉖ 藏文核心要先載對照表（data/tibetan.tsv），比 bonji-mobile 多這一步：
//    (a) 載好之前 convert() 不轉、清單不算（否則是一整排「轉換失敗」）；(b) 載不到要在畫面上講——
//    空著的輸出欄與「這段記法轉不出任何字」長得一樣；(c) 載好（或確定載不到）之後補轉一次。
check('㉖ 對照表載好才轉；載不到要講', (w) => {
  const miss = [];
  const conv = fnBody(w.js, 'convert');
  if (!/if \(!state\.ready\) \{[\s\S]*?return;\s*\}/.test(conv)) miss.push('convert() 在對照表載好之前照轉');
  if (!/state\.tableFailed \? I18n\.t\('out\.tableFail'/.test(conv)) miss.push('載不到時輸出欄不講');
  if (!/if \(!state\.ready && !state\.tableFailed\) \{[\s\S]*?I18n\.t\('rec\.loading'\)[\s\S]*?return;\s*\}/.test(fnBody(w.js, 'renderRecords'))) miss.push('清單在對照表載好之前就現算');
  if (!/converter\.ready\(\)\.then\(function \(\) \{\s*state\.ready = true;\s*\}, function \(e\) \{[\s\S]*?state\.tableFailed = [\s\S]*?\}\)\.then\(function \(\) \{\s*convert\(\);\s*renderRecords\(\);/.test(w.js)) miss.push('init 沒有等 ready()、或載好後沒有補轉');
  if (!/^\.out-text\.out-error\s*\{/m.test(w.css)) miss.push('沒有 .out-error 的樣式（原因會被畫成藏文字級）');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉗ 鍵上的藏文字形放得進鍵裡。藏文的上方符號與下加字都比悉曇高（墨水：基線上最多 1.11em、基線下最多 0.77em，2026-10-12 逐格量），
//    bonji-mobile 的 46px 鍵、行高 1.1 在這裡會把上方符號裁掉（實測）。⇒ 字號與鍵高都用 px（Materialize 會改根字級），
//    字形框（字號 × 行高）至少 1.9em，而且 字形框 ＋ 記法那一行（13px）≤ 鍵高。
check('㉗ 鍵上的藏文字形放得進鍵裡', (w) => {
  const g = (w.css.match(/^\.key-glyph\s*\{[^}]*\}/m) || [''])[0];
  const fs = g.match(/font-size:\s*([\d.]+)(px|rem|em)/), lh = g.match(/line-height:\s*([\d.]+)\s*;/);
  const key = (w.css.match(/^\.keybar \.key\s*\{[^}]*\}/m) || [''])[0].match(/[^-]height:\s*([\d.]+)(px|rem|em)/);
  if (!fs || !lh || !key) return 'FAIL: 找不到 .key-glyph 的字號／行高或 .keybar .key 的高度';
  if (fs[2] !== 'px' || key[2] !== 'px') return 'FAIL: 要用 px（' + fs[2] + '／' + key[2] + '）';
  if (+lh[1] < 1.9) return 'FAIL: 字形框只有 ' + lh[1] + 'em（上方符號或下加字會被裁掉）';
  const box = +fs[1] * +lh[1];
  if (box + 13 > +key[1]) return 'FAIL: 字形框 ' + box + 'px ＋ 記法 13px 超過鍵高 ' + key[1] + 'px';
  if (!/\.keybar\s*\{[^}]*overflow-y:\s*hidden/.test(w.css)) return 'FAIL: 記號列可以上下捲（藏文字形的內容區比行盒高）';
  return true;
});

// ㉘ 紀錄清單：**標題可以重複、可以留空**〔bonji-mobile，owner 2026-10-11：一部咒語分好幾段記，每一段掛同一個標題〕。
//    標題不是鍵 ⇒ 加入不查重、不覆寫；同名各段靠順序分開（輸出的 part＝同一個標題裡第幾段，seq＝整份清單第幾筆）。
check('㉘ 紀錄：標題可以重複、可以留空，part 依標題分段', (w) => {
  const L = w.Lib, o = L.DEFAULT_OPTIONS;
  const mk = (t, i) => L.makeRecord(t, i, o, 'S');
  const bad = [];
  const recs = [mk('百字明', 'o;m'), mk('  百字明 ', 'va jra'), mk('', 'huu~m'), mk('六字大明咒', 'ma .ni'), mk('百字明', 'sa tva'), mk('__proto__', 'a'), mk('__proto__', 'aa')];
  if (recs.some((r) => !r)) return 'FAIL: 有標題／空標題的紀錄建不出來';
  let items = [];
  for (const r of recs) {
    const before = items;
    items = L.addRecord(items, r);
    if (items === before || before.length !== items.length - 1) bad.push('addRecord 改了傳進來的陣列，或沒有多一筆');
  }
  if (items.length !== 7) bad.push('同名的被併掉了：' + items.length + ' 筆（應為 7）');
  if (recs[1].title !== '百字明') bad.push('標題前後的空白沒去掉');
  if (mk('x', '   ') !== null || mk('x', 5) !== null) bad.push('空的輸入也記成一筆');
  const exp = L.buildExport(items, () => ({ tibetan: 't', latin: 'l', codepoints: 'c' }), 'T');
  const got = exp.records.map((r) => r.seq + ':' + r.title + ':' + r.part).join(' ');
  const want = '1:百字明:1 2:百字明:2 3::1 4:六字大明咒:1 5:百字明:3 6:__proto__:1 7:__proto__:2';
  if (got !== want) bad.push('seq／part = ' + got);
  if (exp.count !== 7 || exp.app !== NAME || exp.exportedAt !== 'T') bad.push('信封欄位不對');
  // 取代：位置不變（分段的順序就是資料）、其他筆不動；刪除：只少那一筆。兩者都不改傳進來的陣列。
  const rep = L.replaceRecord(items, 1, mk('百字明', 'NEW'));
  if (rep.length !== 7 || rep[1].input !== 'NEW' || rep[0] !== items[0] || rep[2] !== items[2] || items[1].input !== 'va jra') bad.push('replaceRecord 沒有就地取代');
  if (!eq(L.replaceRecord(items, 9, mk('x', 'y')), items)) bad.push('replaceRecord 超出範圍時動了清單');
  const rem = L.removeRecord(items, 1);
  if (rem.length !== 6 || rem[1] !== items[2] || items.length !== 7) bad.push('removeRecord');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ㉙ JSON 輸出：藏文／拉丁／碼位不落地，輸出當下**每一筆用它自己的選項**現算。
//    期望值寫死在這裡（同一段 `siddha;m`：IAST 是 ṃ、ISO 15919 是 ṁ；藏文見 ① 的碼位）——不取自 buildExport 自己的計算。
//    轉不出來的那一筆 `output: null` ＋ `error`：不整份失敗，也不安靜地少一筆。
//    控制器的 convertWith 與這裡的 conv 是同一個形狀：碼位取**藏文那一欄**的。
check('㉙ JSON 輸出：每筆用自己的選項現算；轉不出來的那一筆不消失', (w) => {
  const L = w.Lib;
  const conv = (input, options) => { const r = new w.Converter(options).convert(input); return { tibetan: r.tibetan, latin: r.latin, codepoints: r.codepoints.tibetan }; };
  const iast = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  const iso = { inputMethod: 'ISO15919', transliteration: 'ISO15919', ignoreSpacesAndHyphens: true };
  const items = [L.makeRecord('t', 'siddha;m', iast, 'A'), L.makeRecord('t', 'siddha;m', iso, 'B')];
  const bad = [];
  const [r1, r2] = L.buildExport(items, conv, 'T').records;
  const lat = (r) => (r && r.output ? r.output.latin : '（無）');
  if (lat(r1) !== 'siddha' + C(0x1E43)) bad.push('第 1 筆（IAST）latin = ' + lat(r1));
  if (lat(r2) !== 'siddha' + C(0x1E41)) bad.push('第 2 筆（ISO 15919）latin = ' + lat(r2));
  if (r1 && r1.output && (r1.output.tibetan !== C(0x0F66, 0x0F72, 0x0F51, 0x0FA1, 0x0FB7, 0x0F7E) || r1.output.codepoints !== 'U+0F66 U+0F72 U+0F51 U+0FA1 U+0FB7 U+0F7E')) bad.push('tibetan／codepoints');
  if (!r1 || r1.input !== 'siddha;m' || r1.savedAt !== 'A') bad.push('input／savedAt 沒有原樣帶出');
  const keys = r1 ? Object.keys(r1).join(',') : '';
  if (keys !== 'seq,part,title,type,source,options,input,output,savedAt') bad.push('一筆的欄位變了：' + keys);
  const exp2 = L.buildExport(items, (i, o) => { if (o.transliteration === 'ISO15919') throw new Error('boom'); return conv(i, o); }, 'T');
  if (exp2.count !== 2 || exp2.records.length !== 2 || !exp2.records[0].output || exp2.records[1].output !== null || exp2.records[1].error !== 'boom') bad.push('轉不出來的那一筆沒有留下 output:null ＋ error');
  // 控制器餵給 buildExport 的那支：每一筆各自一個轉換器（不是畫面上那一個——它帶的是「現在」的選項）
  if (!/function convertWith\(input, options\) \{\s*var r = new TibetanSiddhamConverter\(options\)\.convert\(input\);\s*return \{ tibetan: r\.tibetan, latin: r\.latin, codepoints: r\.codepoints\.tibetan \};/.test(w.js)) bad.push('控制器的 convertWith 沒有用那一筆自己的選項，或欄位不是 藏文／拉丁／藏文碼位');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ㉚ 從 localStorage 讀回來的紀錄清單不可信：不是陣列當成空的、壞掉的那幾筆丟掉、選項走白名單、多出來的鍵不留
check('㉚ normalizeStore', (w) => {
  const L = w.Lib, d = L.DEFAULT_OPTIONS;
  const kh = { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false };
  const s = L.normalizeStore({ title: '  a  b ', items: [
    { title: 5, input: 'o;m', options: { inputMethod: 'x' }, savedAt: 7 }, { title: 't', input: '  ' }, 'junk', null,
    { title: 't', input: 'hrii.h', options: kh, savedAt: 'S', extra: 1 }] });
  const ok = s.title === 'a b' && s.items.length === 2 &&
    eq(s.items[0], { title: '', type: [], source: '', input: 'o;m', options: d, savedAt: '', id: '', order: 0 }) &&
    eq(s.items[1], { title: 't', type: [], source: '', input: 'hrii.h', options: kh, savedAt: 'S', id: '', order: 0 }) &&
    // 類型（第 ㊴ 條）：一律是字串陣列——字串以「、」或逗號拆開（舊的單一字串讀成一個）、陣列裡不是字串的丟掉、不重複；其他型別當成空的
    eq(L.normalizeStore({ items: [{ input: 'a', type: ' 五輪 、五佛，五輪 ' }, { input: 'b', type: 5 }, { input: 'c', type: ['真言', ' 種子  字 ', '', 3, '真言'] }, { input: 'd', type: '五輪' }, { input: 'e' }] }).items.map((i) => i.type), [['五輪', '五佛'], [], ['真言', '種子 字'], ['五輪'], []]) &&
    // 來源（第 ㊳ 條）：字串才收、換行統一、去頭尾空白；不是字串當成空的
    eq(L.normalizeStore({ items: [{ input: 'a', source: '  T20\r\np.107a \n' }, { input: 'b', source: 5 }, { input: 'c', source: { x: 1 } }] }).items.map((i) => i.source), ['T20\np.107a', '', '']) &&
    // id／order：合格的留著（它們是那一筆的身分與位置），不合格的清掉（id 會被拿去當文件路徑）
    eq(L.normalizeStore({ items: [{ input: 'a', id: 'r1_x-9', order: 7 }, { input: 'b', id: 'a/b', order: 'x' }] }).items.map((i) => i.id + ':' + i.order), ['r1_x-9:7', ':0']) &&
    eq(L.normalizeStore(null), { title: '', items: [] }) && eq(L.normalizeStore({ items: 'x' }), { title: '', items: [] });
  return ok || 'FAIL';
});

// ㉛ 紀錄功能在手機上的幾個坑（都是 bonji-mobile 踩出來的）：
//    (a) 藏文欄底下的加入鈕擋 mousedown——打一段、加一筆、接著打，鍵盤不該收（同 ⑪）；它要在藏文欄的 .out-foot 裡（鍵盤開著時頁首按不到）
//    (b) 標題欄字級走 --ctl-font（同 ⑩）；(c) 不用 confirm／alert／prompt——Artifacts 的 iframe 裡直接回 false，「先問再做」會變成永遠不做
//    (d) 面板內 標題 → 清單 → JSON：iOS 鍵盤彈出時 bottom-sheet 的下半截被蓋住，上緣不會；底列固定（modal-fixed-footer）
//    (e) 標題欄有焦點時鍵盤也開著，那時的高度不可以當成「沒有鍵盤」的基準
check('㉛ 紀錄面板在手機上：加入不收鍵盤／不放大／不用 confirm／標題欄在最上面', (w) => {
  const miss = [];
  if (!/quick\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('加入鈕沒擋 mousedown');
  const tblk = outBlock(w.html, 'tibetan');
  const f = tblk.indexOf('class="out-foot"'), q = tblk.indexOf('id="rec-add-quick"');
  if (!(f >= 0 && f < q)) miss.push('加入鈕不在藏文欄的 .out-foot 裡');
  if (!/input\[type="text"\]\.rec-title\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('標題欄沒用 --ctl-font');
  // 標題欄旁的清除鈕：同樣擋 mousedown（焦點維持原狀）；它不可以包在 <label> 裡——label 的預設動作會把焦點送進標題欄、鍵盤跳出來
  if (!/titleClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('標題的清除鈕沒擋 mousedown');
  const ci = w.html.indexOf('id="rec-title-clear"');
  if (ci < 0) miss.push('標題欄旁沒有清除鈕');
  else if (w.html.lastIndexOf('<label', ci) > w.html.lastIndexOf('</label>', ci)) miss.push('清除鈕包在 <label> 裡');
  if (/(^|[^.\w$])(confirm|alert|prompt)\s*\(|window\.(confirm|alert|prompt)\s*\(/m.test(jsCode(w.js))) miss.push('用了 confirm／alert／prompt');
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), l = sheet.indexOf('id="rec-list"'), j = sheet.indexOf('id="rec-json"');
  if (!(t > 0 && t < l && l < j)) miss.push('面板內的順序不是 標題 → 清單 → JSON');
  if (!/modal-fixed-footer/.test((sheet.match(/<div id="records-modal"[^>]*>/) || [''])[0])) miss.push('不是 modal-fixed-footer');
  // 面板裡會叫出鍵盤的欄位：標題欄，以及編輯表單的標題與記法（第 ㊲ 條）
  if (!/if \(!focused && !typingInSheet\(\)\) state\.baseline = box\.height;/.test(w.js)) miss.push('標題欄有焦點時仍更新鍵盤基準');
  const tis = fnBody(w.js, 'typingInSheet');
  if (!['$recTitle', '$recType', '$recSource', '$editTitle', '$editType', '$editSource', '$editInput'].every((v) => tis.indexOf('a === ' + v) > 0)) miss.push('typingInSheet 少算了會叫出鍵盤的欄位');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉜ 清單存在 localStorage——那是方便不是備份，而且可能存不住（iOS 上的 Artifacts 版寫得進讀不回）：
//    每次存完讀回來比對，對不上就在面板上講出來。下載檔名照家族慣例 yyyyMMddHHmmss、圖示照 §5.6（file_download）。
check('㉜ 清單存不住要講出來；下載檔名與圖示', (w) => {
  const miss = [];
  if (!/localStorage\.setItem\(REC_KEY, text\); ok = localStorage\.getItem\(REC_KEY\) === text;/.test(w.js)) miss.push('存完沒有讀回來比對');
  if (!/getElementById\('rec-storage-note'\)\.hidden = ok && !state\.storageLost;/.test(w.js)) miss.push('存不住時面板上不講');
  if (!/id="rec-storage-note"[^>]*data-i18n="rec\.storageFail"/.test(w.html)) miss.push('面板上沒有那一行');
  const name = w.Lib.exportFilename(new Date(2026, 9, 12, 9, 5, 7));
  if (name !== NAME + '-20261012090507.json') miss.push('檔名 ' + name);
  if (!/id="rec-download"[^>]*>\s*<i class="material-icons left">file_download<\/i>/.test(w.html)) miss.push('下載鈕的圖不是 file_download');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉝ **改標題不可以碰清單；動清單之前先看儲存區**〔bonji-mobile 2026-10-11 實際弄丟過 owner 的紀錄〕。
//    那邊的第一版把標題與清單存在同一格、每次整格重寫：一個記憶裡的清單比儲存區舊的畫面（另一個分頁、另一個還開著的畫面後來記了幾筆），
//    只要改標題、按清除、甚至關掉面板，就把那幾筆蓋掉。⇒ (a) 兩格分開存；(b) 改標題的三條路上沒有任何一行寫清單；
//    (c) 寫清單的每一條路都先 syncItems()；(d) 「讀不到」不可以當成「被清空了」（storeDrift 的 lost）。
function fnBody(src, name) { return (src.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}')) || [''])[0]; }
check('㉝ 改標題不碰清單；動清單前先看儲存區', (w) => {
  const miss = [];
  const d = w.Lib.storeDrift;
  if (!(d(null, null) === 'same' && d('a', 'a') === 'same' && d('a', 'b') === 'changed' && d(null, 'b') === 'changed' && d('a', null) === 'lost' && d('a', undefined) === 'lost')) miss.push('storeDrift 的判定不對');
  const k1 = (w.js.match(/var REC_KEY = '([^']+)'/) || [])[1], k2 = (w.js.match(/var REC_TITLE_KEY = '([^']+)'/) || [])[1];
  if (!k1 || !k2 || k1 === k2) miss.push('標題與清單不是分兩格存（' + k1 + '／' + k2 + '）');
  // 改標題的路：clearTitle、saveTitle、標題欄的 input、面板關閉——都不可以出現 saveItems 或 REC_KEY
  const titlePaths = {
    clearTitle: fnBody(w.js, 'clearTitle'),
    saveTitle: fnBody(w.js, 'saveTitle'),
    '標題欄 input': (w.js.match(/\$recTitle\.addEventListener\('input', function \(\) \{[\s\S]*?\n    \}\);/) || [''])[0],
    '面板關閉': (w.js.match(/M\.Modal\.init\(\$recModal, \{[\s\S]*?\n    \}\);/) || [''])[0],
    // 來源欄（第 ㊳ 條）與標題欄同一條規矩
    clearSource: fnBody(w.js, 'clearSource'),
    saveSource: fnBody(w.js, 'saveSource'),
    '來源欄 input': (w.js.match(/\$recSource\.addEventListener\('input', function \(\) \{[\s\S]*?\n    \}\);/) || [''])[0],
    // 類型欄（第 ㊴ 條）：打字、點快選鈕、清除都走 setPanelType
    setPanelType: fnBody(w.js, 'setPanelType'),
    clearType: fnBody(w.js, 'clearType'),
    saveType: fnBody(w.js, 'saveType')
  };
  for (const [name, body] of Object.entries(titlePaths)) {
    if (!body) miss.push('找不到 ' + name);
    else if (/saveItems\(|REC_KEY\b/.test(body)) miss.push(name + ' 寫到清單了');
  }
  if (!/JSON\.stringify\(\{ items: state\.rec\.items \}\)/.test(fnBody(w.js, 'saveItems'))) miss.push('saveItems 寫的不是只有 items');
  // 寫清單的路：加入（先同步再接上去）、recAction（別處改過就停下來）
  const add = fnBody(w.js, 'addCurrent');
  if (!(add.indexOf('syncItems()') > 0 && add.indexOf('syncItems()') < add.indexOf('Lib.addRecord('))) miss.push('加入之前沒有先看儲存區');
  const act = fnBody(w.js, 'recAction');
  if (!/^\s*function recAction\(act, i\) \{\s*(\/\/[^\n]*\n\s*)*if \(syncItems\(\) === 'changed'\) \{[\s\S]*?return;\s*\}/.test(act.replace(/^\n/, ''))) miss.push('取代／刪除／清除之前沒有先看儲存區');
  const callers = [...w.js.matchAll(/\n  function (\w+)\([^)]*\) \{[\s\S]*?\n  \}/g)].filter((m) => /saveItems\(\)/.test(m[0]) && m[1] !== 'saveItems').map((m) => m[1]).sort().join(',');
  if (callers !== 'addCurrent,recAction,saveEdit') miss.push('會寫清單的函式變了：' + callers);
  // 編輯存回（第 ㊲ 條）是第三條會寫清單的路：一樣先看儲存區，別處改過就停下來
  const se = fnBody(w.js, 'saveEdit');
  if (!/^\s*function saveEdit\(\) \{\s*var ed = state\.edit;\s*if \(!ed\) return;\s*(\/\/[^\n]*\n\s*)*if \(syncItems\(\) === 'changed'\) \{[\s\S]*?return;\s*\}/.test(se.replace(/^\n/, ''))) miss.push('編輯存回之前沒有先看儲存區');
  if (!/addEventListener\('storage'/.test(w.js)) miss.push('沒有聽 storage 事件');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉞ Artifacts 版的清單住在 artifact 的資料庫裡〔bonji-mobile，owner 2026-10-11 實測：iPhone 的 Claude App 把 artifact 關掉重開，localStorage 就讀不回來〕。
//    (a) **一筆一份文件**——加入／取代只 set 自己那一份、刪除只 delete 自己那一份；沒有「整份清單」那種文件（整份寫回去就是 ㉝ 那個坑）
//    (b) 畫面上的清單＝資料庫送來的 ⊕ 這個畫面還沒被確認的寫入（mergeRemote），依 order 排、同值依 id
//    (c) 資料庫作主之後不再寫這支瀏覽器的清單那一格（留著的話，別台刪掉的紀錄日後會從這裡被送回去）
//    (d) id／order 不進 JSON 輸出；build.py 真的把那支同步帶進去，而且宣告的規則是 owner 才讀寫
check('㉞ Artifacts 版：清單存資料庫、一筆一份文件', (w) => {
  const L = w.Lib, miss = [];
  const r = (id, order, input) => ({ id, order, input: input || id, title: '', options: L.DEFAULT_OPTIONS, savedAt: '' });
  const remote = [r('b', 20), r('a', 10), r('c', 30)];
  const ids = (xs) => xs.map((x) => x.id + (x.input !== x.id ? '=' + x.input : '')).join(' ');
  if (ids(L.mergeRemote(remote, {}, {})) !== 'a b c') miss.push('沒依 order 排');
  if (ids(L.mergeRemote(remote, { d: r('d', 15), b: r('b', 20, 'NEW') }, { c: true })) !== 'a d b=NEW') miss.push('待確認的寫入沒併進去：' + ids(L.mergeRemote(remote, { d: r('d', 15), b: r('b', 20, 'NEW') }, { c: true })));
  if (ids(L.mergeRemote([r('y', 5), r('x', 5)], {}, {})) !== 'x y') miss.push('order 相同時沒依 id 排（兩台裝置會看到不同順序）');
  if (ids(L.mergeRemote(remote, { c: r('c', 30, 'Z') }, { c: true })) !== 'a b') miss.push('已刪除的又被待確認的寫入帶回來');
  if (remote.map((x) => x.id).join('') !== 'bac') miss.push('mergeRemote 改了傳進來的陣列');
  if (L.nextOrder([r('a', 10), r('b', 99)], 50) !== 100 || L.nextOrder([], 50) !== 50 || L.nextOrder([r('a', 10)], 50) !== 50) miss.push('nextOrder');
  const rec = L.makeRecord('t', 'o;m', null, 'S', 'rabc', 42);
  if (!rec || rec.id !== 'rabc' || rec.order !== 42) miss.push('makeRecord 沒帶 id／order');
  const out = L.buildExport([rec], () => ({ tibetan: 't', latin: 'l', codepoints: 'c' }), 'T').records[0];
  if ('id' in out || 'order' in out) miss.push('id／order 漏進 JSON 輸出');
  // 同步那一支：只對 records/<id> 與 state/title 做 set／delete
  const src = w.remote.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/.*$/gm, '');
  if (!/db\.collection\(COL\)\.doc\(rec\.id\)\.set\(\{/.test(src)) miss.push('put 不是寫 records/<id> 那一份');
  if (!/db\.collection\(COL\)\.doc\(id\)\.delete\(\)/.test(src)) miss.push('remove 不是刪 records/<id> 那一份');
  const sets = [...src.matchAll(/\.set\(/g)].length;
  if (sets !== 4) miss.push('同步那一支有 ' + sets + ' 處 set（應為 4：一筆紀錄、標題欄、來源欄、類型欄）');
  // 來源（第 ㊳ 條）是那一筆自己的欄位：寫進去、讀回來都要帶著——漏了其中一邊，來源會在同步之後安靜地變成空的
  // 類型（第 ㊴ 條）同理
  if (!/\.set\(\{\s*title: rec\.title, type: rec\.type \|\| \[\], source: rec\.source \|\| '', input:/.test(src)) miss.push('put 沒有把類型與來源寫進那一筆的文件');
  if (!/return \{ id: doc\.id, title: x\.title, type: x\.type, source: x\.source, input:/.test(src)) miss.push('讀回來的清單沒帶類型或來源');
  if (/items\s*:/.test(src)) miss.push('同步那一支出現整份清單的寫法（items:）');
  if (!/fromCache/.test(src)) miss.push('沒有分辨「還不是完整版本」的清單');
  if (!/window\.TibetanSiddhamMobileRemote = \{/.test(src) || !/window\.TibetanSiddhamMobileRemote\b/.test(w.js)) miss.push('同步那一支與控制器的接點名稱對不上');
  // 控制器：資料庫作主時不碰這支瀏覽器的清單那一格
  if (!/function saveItems\(\) \{\s*if \(remoteOn\(\)\) return;/.test(w.js)) miss.push('資料庫作主時仍寫 localStorage 的清單');
  if (!/function syncItems\(\) \{\s*if \(remoteOn\(\)\) return 'same';/.test(w.js)) miss.push('資料庫作主時仍拿 localStorage 蓋掉清單');
  if (!/Lib\.normalizeStore\(\{ items: list \}\)/.test(w.js)) miss.push('資料庫來的清單沒走白名單');
  // 建置：帶進 dist、在控制器之前載入、宣告 owner 才讀寫
  if (!/shutil\.copy2\(HERE \/ 'src' \/ 'remote-db\.js'/.test(w.build)) miss.push('build.py 沒帶 remote-db.js');
  if (!/\('index\.html', CONTROLLER_TAG, REMOTE_TAG \+ CONTROLLER_TAG\)/.test(w.build)) miss.push('build.py 沒在控制器之前載入它');
  if (!/"db": \{"rules": \[\{"path": "", "read": "owner", "write": "owner"\}\]\}/.test(w.build)) miss.push('宣告的規則不是 owner 才讀寫');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉟ 備份腳本（scripts/backup-artifact.sh）——**在暫存資料夾裡真的跑**，不是看它的字面：
//    (a) 空的清單是合法的，但不寫新檔、不輪替（連續空的清單不可以把最後一份有內容的備份擠掉）
//    (b) 磁碟上的檔數 ≠ 呼叫端報的筆數 ⇒ exit 1、既有備份不動（取回不完整，或混進上一次留下的檔）
//    (c) 不合格的文件 ⇒ exit 1、隔離、既有備份不動；(d) 內容與上一份相同 ⇒ 不另存；(e) 用完把取回來的檔清掉
check('㉟ 備份腳本：空的不輪替／檔數要對得上／壞的不覆蓋好的', (w) => {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsm-backup-'));
  try {
    // 腳本以它自己的位置找 lib ⇒ 在暫存區擺出同樣的相對位置（lib 用世界裡那一份，selftest 改得到）
    const sdir = path.join(tmp, 'repo', 'scripts'), ldir = path.join(tmp, 'repo', 'public', 'apps', NAME);
    fs.mkdirSync(sdir, { recursive: true }); fs.mkdirSync(ldir, { recursive: true });
    const script = path.join(sdir, 'backup-artifact.sh');
    fs.writeFileSync(script, w.backup, { mode: 0o755 });
    fs.writeFileSync(path.join(ldir, NAME + '-lib.js'), w.libSrc);
    const root = path.join(tmp, 'root'), pull = path.join(tmp, 'pull'), rec = path.join(pull, 'records');
    fs.mkdirSync(rec, { recursive: true });
    const env = Object.assign({}, process.env, { TSM_BACKUP_ROOT: root, TSM_BACKUP_CLOUD: '-', TSM_BACKUP_NOTIFY: '0' });
    const put = (id, input, order) => fs.writeFileSync(path.join(rec, id + '.json'), JSON.stringify({ title: 't', input, options: {}, savedAt: 'S', order }));
    const run = (n) => spawnSync('sh', [script, pull, String(n)], { env, encoding: 'utf8' }).status;
    const backups = () => (fs.existsSync(root) ? fs.readdirSync(root).filter((f) => new RegExp('^' + NAME + '-artifact-.*\\.json$').test(f)).sort() : []);
    const newest = () => JSON.parse(fs.readFileSync(path.join(root, backups().slice(-1)[0]), 'utf8'));
    const bad = [];
    if (run(0) !== 0 || backups().length !== 0) bad.push('空的清單寫出了備份檔，或沒有 exit 0');
    put('r2', 'va jra', 20); put('r1', 'o;m', 10);
    if (run(2) !== 0 || backups().length !== 1) bad.push('兩筆的清單沒有備份成功');
    else if (newest().records.map((r) => r.id + ':' + r.input).join(' ') !== 'r1:o;m r2:va jra' || newest().app !== NAME) bad.push('備份檔的內容或順序不對');
    if (fs.readdirSync(rec).length !== 0) bad.push('取回來的檔沒有清掉（下一次會混進來）');
    // ⚠️ 不能只數檔案：檔名只到秒，同一秒內另存會蓋掉同名的那一份、數量不變 ⇒ 比檔案裡的 pulledAt（毫秒）
    const before = backups().length === 1 ? newest().pulledAt : '';
    put('r2', 'va jra', 20); put('r1', 'o;m', 10);
    if (run(2) !== 0 || backups().length !== 1 || newest().pulledAt !== before) bad.push('內容相同卻另存了一份');
    put('r1', 'o;m', 10);
    if (run(2) !== 1 || backups().length !== 1) bad.push('檔數對不上卻沒有失敗');
    put('r1', 'o;m', 10); fs.writeFileSync(path.join(rec, 'bad.json'), JSON.stringify({ title: 'x', order: 5 }));
    if (run(2) !== 1 || backups().length !== 1 || newest().count !== 2) bad.push('不合格的文件沒有被擋下，或動到了既有備份');
    if (run(0) !== 0 || backups().length !== 1 || newest().count !== 2) bad.push('之後空的清單動到了既有備份');
    // 來源（第 ㊳ 條）也是內容：只改了來源要另存一份，而且備份檔裡帶著那一欄；舊備份沒有這一欄不算「改過」（上面「內容相同」那一步已經驗到）
    const stamp = backups().length ? newest().pulledAt : '';
    fs.writeFileSync(path.join(rec, 'r2.json'), JSON.stringify({ title: 't', source: '大正藏 T20', input: 'va jra', options: {}, savedAt: 'S', order: 20 })); put('r1', 'o;m', 10);   // ⚠️ 記法要與上面那一份逐字相同——差的只能是來源（第一版照抄 bonji-mobile 的記法，於是「記法也變了」，備份不比來源的注入照樣過）
    if (run(2) !== 0 || newest().pulledAt === stamp || (newest().records.find((r) => r.id === 'r2') || {}).source !== '大正藏 T20') bad.push('只改了來源沒有另存，或備份檔沒帶來源');
    // 類型（第 ㊴ 條）同理：這一次差的只有類型（記法與來源都與上一份逐字相同）
    const stamp2 = backups().length ? newest().pulledAt : '';
    fs.writeFileSync(path.join(rec, 'r2.json'), JSON.stringify({ title: 't', type: ['真言', '種子字'], source: '大正藏 T20', input: 'va jra', options: {}, savedAt: 'S', order: 20 })); put('r1', 'o;m', 10);
    if (run(2) !== 0 || newest().pulledAt === stamp2 || !eq((newest().records.find((r) => r.id === 'r2') || {}).type, ['真言', '種子字'])) bad.push('只改了類型沒有另存，或備份檔沒帶類型');
    // 上一份備份可能是舊版腳本寫的——那時類型是單一字串。把剛才那一份改寫成那個形狀，再取回同樣的內容：
    // 那是同一個狀態，不可以因為形狀不同就判成「修改」（否則升級後第一次整份都是修改——owner 的 26 筆就是這個情況）。
    // ⚠️ 要改的是「上一份備份檔」那一側：取回來的文件不管是字串還是陣列，進 normalizeStore 之後都是陣列，改文件那一側測不到東西
    //    （第一版就是改文件那一側，「備份拿原樣的類型去比」的注入照樣過——selftest 抓到的）
    const last = path.join(root, backups().slice(-1)[0]);
    const old = JSON.parse(fs.readFileSync(last, 'utf8'));
    old.records.forEach((r) => { r.type = (Array.isArray(r.type) ? r.type : []).join('、'); });
    if (old.records.find((r) => r.id === 'r2').type !== '真言、種子字') bad.push('測試的前提不成立：上一份備份裡 r2 的類型不是預期的那兩個');
    fs.writeFileSync(last, JSON.stringify(old, null, 2) + '\n');
    fs.writeFileSync(path.join(rec, 'r2.json'), JSON.stringify({ title: 't', type: ['真言', '種子字'], source: '大正藏 T20', input: 'va jra', options: {}, savedAt: 'S', order: 20 })); put('r1', 'o;m', 10);
    if (run(2) !== 0 || newest().pulledAt !== old.pulledAt || backups().slice(-1)[0] !== path.basename(last)) bad.push('類型只是形狀不同（上一份是字串、這一份是陣列）卻另存了一份');
    return bad.length ? 'FAIL: ' + bad.join('、') : true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ㊱ 記號列上每一顆鍵的字形（含載體點圈），**隨附的那兩支字型都要畫得出來**——直接讀字型檔的 cmap，不看畫面。
//    ⚠️ 這件事在 Mac 上用眼睛看不出來：系統自己有藏文與悉曇字型，隨附的那支缺字時畫面上照樣有字（系統後備接走）；
//       手機上的後備是另一套（或沒有），缺的那一格會是另一種字形或豆腐（bonji-mobile 加「符號」組時量像素量不出來，才改成讀字型）。
//    藏文字形要在 Noto Serif Tibetan 裡（不可以靠悉曇那支接）；唯一借用的 U+115C1 要在 Noto Sans Siddham 裡。
function cmapOf(buf) {
  if (buf.toString('latin1', 0, 4) === 'wOF2') {
    const numTables = buf.readUInt16BE(12);
    let p = 48;
    const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = buf[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v >>> 0; } throw new Error('UIntBase128 讀不出來'); };
    const tables = [];
    for (let i = 0; i < numTables; i++) {
      const flags = buf[p++], idx = flags & 0x3f, ver = flags >> 6;
      if (idx === 63) p += 4;                       // 不在已知清單裡的 tag：後面跟 4 個位元組
      const orig = b128();
      // glyf(10)／loca(11) 的 transform 版本 0＝有轉換；其餘的表非 0 才有 ⇒ 有轉換的多一個 transformLength
      const transformed = (idx === 10 || idx === 11) ? ver === 0 : ver !== 0;
      tables.push({ idx, len: transformed ? b128() : orig });
    }
    const data = zlib.brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)));
    let off = 0;
    for (const t of tables) { if (t.idx === 0) return data.subarray(off, off + t.len); off += t.len; }   // 0 ＝ cmap
    throw new Error('woff2 裡沒有 cmap');
  }
  const n = buf.readUInt16BE(4);                    // sfnt（TTF）：表目錄從第 12 個位元組起，每筆 16 個位元組
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (buf.toString('latin1', r, r + 4) === 'cmap') { const o = buf.readUInt32BE(r + 8); return buf.subarray(o, o + buf.readUInt32BE(r + 12)); }
  }
  throw new Error('字型裡沒有 cmap');
}
function coverage(buf) {
  const cmap = cmapOf(buf);
  const set = new Set();
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const so = cmap.readUInt32BE(4 + i * 8 + 4), fmt = cmap.readUInt16BE(so);
    if (fmt === 12) {
      for (let g = 0, ng = cmap.readUInt32BE(so + 12); g < ng; g++) {
        const a = cmap.readUInt32BE(so + 16 + g * 12), b = cmap.readUInt32BE(so + 20 + g * 12), gid = cmap.readUInt32BE(so + 24 + g * 12);
        for (let c = a; c <= b; c++) if (gid + (c - a) !== 0) set.add(c);
      }
    } else if (fmt === 4) {
      const segX2 = cmap.readUInt16BE(so + 6), endO = so + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = cmap.readUInt16BE(endO + s), start = cmap.readUInt16BE(startO + s), delta = cmap.readInt16BE(deltaO + s), ro = cmap.readUInt16BE(rangeO + s);
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xFFFF;
          else { const g = cmap.readUInt16BE(rangeO + s + ro + (c - start) * 2); gid = g === 0 ? 0 : (g + delta) & 0xFFFF; }
          if (gid !== 0) set.add(c);
        }
      }
    }
  }
  if (!set.size) throw new Error('cmap 讀不出任何碼位');
  return set;
}
const BORROWED = [0x115C1];   // 藏文欄借用的悉曇記號（~ 與 --）
check('㊱ 隨附的字型畫得出記號列上每一個字形', (w) => {
  const tib = coverage(w.fontTibetan), sid = coverage(w.fontSiddham);
  // 對照組：讀法壞掉時（全部回 true／全部回 false）這幾行會先紅
  if (!tib.has(0x0F40) || !tib.has(0x25CC)) return 'FAIL: 對照組——藏文字型裡應該有 U+0F40（ka）與 U+25CC（點圈）';
  if (tib.has(0x5B57) || tib.has(0x115C1)) return 'FAIL: 對照組——藏文字型裡不該有 U+5B57（漢字）或 U+115C1（悉曇記號）';
  if (!sid.has(0x115C1) || sid.has(0x0F40)) return 'FAIL: 對照組——悉曇字型應該有 U+115C1、不該有 U+0F40';
  const miss = [];
  let n = 0;
  for (const id of w.Lib.KEYSET_IDS) {
    for (const k of w.Lib.keysFromAssist(w.assist, id)) {
      n++;
      for (const ch of k.glyph) {
        const cp = ch.codePointAt(0);
        const ok = BORROWED.includes(cp) ? sid.has(cp) : tib.has(cp);
        if (!ok) miss.push(id + ':' + k.label + ' U+' + cp.toString(16).toUpperCase());
      }
    }
  }
  if (n < 100) return 'FAIL: 只檢查到 ' + n + ' 顆鍵（應有 100 顆以上）';
  // 輸出欄也會畫到的幾個不在記號列上的字：① 的向量（去掉全形空格與一般空白——那不需要字形）
  for (const [, t] of VECTORS) for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp === 0x3000 || cp === 0x20) continue;
    if (!(BORROWED.includes(cp) ? sid.has(cp) : tib.has(cp))) miss.push('向量 U+' + cp.toString(16).toUpperCase());
  }
  return miss.length ? 'FAIL: 字型缺 ' + miss.join('、') : true;
});

// ㊲ 編輯某一筆〔owner 2026-10-13：清單上每一筆多一顆 ✎，在面板裡改那一筆的標題／記法／選項〕。
//    (a) 改的是那一筆自己：id 與 order 沿用（身分與位置）；沒有更動 ⇒ 回原來那個物件（不寫入、savedAt 不變）；記法清空 ⇒ null（那是「刪除」的事）
//    (b) 存回時認 id 不認序號（表單開著的期間別處可能刪掉前面幾筆）；只寫那一筆——主畫面的輸入框、標題欄、畫面上的選項一個都不碰
//    (c) 編輯中唯一的出口是 儲存／取消：點面板外不關、「完成」收起來（按它會被讀成「存好了」）；有還沒存的更動時，取消要再按一次
//    (d) 表單在面板最上面、儲存／取消在表單第一列（鍵盤開著時下半截與底列被蓋住）；記法欄不自動大寫／校正、字級走 --ctl-font
//    期望值寫死在這裡，不取自 editRecord 自己的計算。
check('㊲ 編輯某一筆：只改那一筆、認 id、出口只有儲存／取消', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.editRecord !== 'function' || typeof L.indexOfId !== 'function') return 'FAIL: lib 沒有 editRecord／indexOfId';
  const kh = { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false };
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  const o = { title: '大悲咒', input: 'na mo', options: dflt, savedAt: 'OLD', id: 'r7', order: 42 };
  const snap = JSON.stringify(o);
  if (L.editRecord(o, '大悲咒', 'na mo', dflt, 'NEW') !== o) miss.push('沒有更動時沒有回原來那一筆（會白寫一次、savedAt 變成今天）');
  if (L.editRecord(o, '  大悲咒 ', 'na mo', { inputMethod: 'x' }, 'NEW') !== o) miss.push('只差在正規化會抹掉的地方也被當成更動');
  const e1 = L.editRecord(o, '心經咒', 'ga te', kh, 'NEW');
  if (!eq(e1, { title: '心經咒', type: [], source: '', input: 'ga te', options: kh, savedAt: 'NEW', id: 'r7', order: 42 })) miss.push('改過的那一筆 = ' + JSON.stringify(e1));
  const e2 = L.editRecord(o, '大悲咒', 'na mo', kh, 'NEW');
  if (!e2 || e2 === o || e2.options.inputMethod !== 'KH' || e2.id !== 'r7') miss.push('只改選項不算更動');
  const e3 = L.editRecord(o, '', 'na mo', dflt, 'NEW');
  if (!e3 || e3 === o || e3.title !== '') miss.push('把標題改成空的不算更動');
  const e4 = L.editRecord(o, '大悲咒', 'na mo ', dflt, 'NEW');
  if (!e4 || e4 === o || e4.input !== 'na mo ') miss.push('記法只差一個空格不算更動（空格是記法）');
  if (L.editRecord(o, 't', '   ', kh, 'NEW') !== null || L.editRecord(o, 't', '', kh, 'NEW') !== null) miss.push('記法清空也存得回去');
  if (L.editRecord(null, 't', 'a', kh, 'NEW') !== null) miss.push('沒有原來那一筆也編得出東西');
  if (JSON.stringify(o) !== snap) miss.push('editRecord 改了傳進來的那一筆');
  const list = [{ id: 'a' }, { id: 'b' }, null, { id: 'c' }];
  if (!(L.indexOfId(list, 'c') === 3 && L.indexOfId(list, 'a') === 0 && L.indexOfId(list, 'zz') === -1 && L.indexOfId(list, '') === -1 && L.indexOfId(null, 'a') === -1)) miss.push('indexOfId');

  const start = fnBody(w.js, 'startEdit'), save = fnBody(w.js, 'saveEdit'), end = fnBody(w.js, 'endEdit'), cancel = fnBody(w.js, 'cancelEdit');
  if (!start || !save || !end || !cancel) return 'FAIL: 找不到 startEdit／saveEdit／endEdit／cancelEdit' + (miss.length ? '；' + miss.join('、') : '');
  const MAIN = /\$input\b|\$recTitle\b|\$recSource\b|\$recType\b|\$inputMethod\b|\$translit\b|\$ignoreSpaces\b|state\.rec\.(title|source|type)|saveTitle|pushTitle|saveSource|pushSource|saveType|pushType|setPanelType|saveDraft|onInput\(/;
  if (MAIN.test(start)) miss.push('開始編輯時動了主畫面（輸入框／標題欄／選項）');
  if (MAIN.test(save)) miss.push('存回時動了主畫面（輸入框／標題欄／選項）');
  const iSync = save.indexOf("syncItems() === 'changed'"), iFind = save.indexOf('Lib.indexOfId(state.rec.items, ed.id)'), iRep = save.indexOf('Lib.replaceRecord(state.rec.items, i, rec)');
  if (!(iSync > 0 && iSync < iFind && iFind < iRep)) miss.push('存回不是「先看儲存區 → 以 id 找那一筆 → 就地取代」');
  if (!/if \(i < 0\) \{[^\n]*return; \}/.test(save)) miss.push('那一筆已經不在時仍然存回去（等於把別處刪掉的加回來）');
  if (!/if \(rec === ed\.orig\) \{[\s\S]*?return;\s*\}\s*state\.rec\.items = /.test(save)) miss.push('沒有更動也寫入');
  if ((save.match(/pushPut\(rec\)/g) || []).length !== 1 || /pushDel\(/.test(save)) miss.push('存回不是只寫那一筆');
  if (!/options\.dismissible = false;/.test(start) || !/options\.dismissible = true;/.test(end)) miss.push('編輯中點面板外面會關掉（或離開編輯後關不掉）');
  if (!/if \(editDraft\(''\) !== ed\.orig && !isArmed\('editCancel', i\)\) \{ arm\('editCancel', i, 'rec\.toast\.confirmDiscard'\); return; \}/.test(cancel)) miss.push('有還沒存的更動時，取消不必再按一次');
  if (!/recButton\('edit', i, 'edit', 'rec\.edit', false\)/.test(w.js)) miss.push('清單上沒有編輯鈕');
  if (!/if \(act === 'edit'\) \{ startEdit\(it\); return; \}/.test(w.js)) miss.push('編輯鈕沒有接到 startEdit');
  if (!/onCloseStart: function \(\) \{[^\n]*endEdit\(\);/.test(w.js)) miss.push('面板關掉時沒有離開編輯');

  if (!/\.records-sheet\.is-editing \.modal-footer > :not\(\.rec-edit-only\) \{ display: none; \}/.test(w.css)) miss.push('編輯中「完成」與輸出鈕仍看得到');
  if (!/\.records-sheet\.is-editing \.modal-content > :not\(\.rec-edit\) \{ display: none; \}/.test(w.css)) miss.push('編輯中清單沒有收起');
  if (!/textarea\.rec-edit-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('記法欄沒用 --ctl-font');

  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const pe = sheet.indexOf('id="rec-edit"'), ph = sheet.indexOf('class="rec-heading rec-edit-head"'), pt = sheet.indexOf('id="rec-edit-title"'), pl = sheet.indexOf('id="rec-title"');
  if (!(pe > 0 && pe < ph && ph < pt && pt < pl)) miss.push('表單不在面板最上面');
  const head = ph > 0 && pt > ph ? sheet.slice(ph, pt) : '';
  if (!(head.indexOf('data-edit="save"') > 0 && head.indexOf('data-edit="cancel"') > 0)) miss.push('儲存／取消不在表單第一列');
  const foot = sheet.slice(sheet.indexOf('class="modal-footer"'));
  if (!(/class="btn-flat rec-edit-only"[^>]*data-edit="cancel"/.test(foot) && /class="btn-flat rec-edit-only rec-edit-ok"[^>]*data-edit="save"/.test(foot))) miss.push('底列沒有編輯用的 取消／儲存');
  const ta = (sheet.match(/<textarea id="rec-edit-input"[^>]*>/) || [''])[0];
  const lack = ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => ta.indexOf(a) < 0);
  if (lack.length) miss.push('記法欄少了 ' + lack.join(' '));
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㊳ 來源欄〔owner 2026-10-13：「增加一個 field，用 textarea 紀錄資料的來源」〕。
//    (a) 每一筆各自一份 `source`（多行的自由文字、可以是空的）；JSON 輸出帶這一欄；舊紀錄沒有這一欄＝空字串，不是壞資料
//    (b) 面板上標題欄底下有一格〔owner 選的〕：加入／取代時帶入它現在的值；載回某一筆時跟著那一筆回來
//    (c) 存法照標題欄：自己一格、只在自己被改時寫（碰不到清單——那一半在儲存區那一條）；清除來源不動標題、不動清單
//    (d) 編輯表單裡也有一格；沒給來源（undefined）＝沿用原來的，給了空字串才是清掉
//    (e) 手機：清除鈕擋 mousedown、不包在 label 裡；兩格 textarea 字級走 --ctl-font、不自動大寫／校正；面板內 標題 → 來源 → 清單
check('㊳ 來源欄：每一筆各自一份、加入時帶入、自己一格存', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.normalizeSource !== 'function') return 'FAIL: lib 沒有 normalizeSource';
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  if (L.normalizeSource('  大正藏 T20\r\n  p.107a\r\n') !== '大正藏 T20\n  p.107a' || L.normalizeSource(null) !== '' || L.normalizeSource(7) !== '' || L.normalizeSource(undefined) !== '') miss.push('normalizeSource');
  const r1 = L.makeRecord('t', 'na mo', dflt, 'S', 'r1', 5, ' T20 No.1060 \n');
  if (!r1 || r1.source !== 'T20 No.1060') miss.push('makeRecord 沒帶來源：' + JSON.stringify(r1 && r1.source));
  const r0 = L.makeRecord('t', 'na mo', dflt, 'S', 'r0', 4);
  if (!r0 || r0.source !== '') miss.push('沒給來源時不是空字串');
  if (L.makeRecord('t', '  ', dflt, 'S', 'rx', 1, '有來源') !== null) miss.push('只有來源、沒有記法也記成一筆');
  const exp = L.buildExport([r1, { title: 'old', input: 'a', options: dflt, savedAt: 'S' }], () => ({ siddham: 's', tibetan: 't', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T');
  if (exp.records[0].source !== 'T20 No.1060') miss.push('JSON 輸出沒帶來源');
  if (exp.records[1].source !== '') miss.push('舊紀錄（沒有這一欄）輸出的來源不是空字串：' + JSON.stringify(exp.records[1].source));
  // 編輯：沒給＝沿用；給空字串＝清掉；只改來源也是更動
  const e0 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW');
  if (e0 !== r1) miss.push('沒給來源時被當成更動（應沿用原來的）');
  const e1 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW', 'T20 No.1060\np.107a');
  if (!e1 || e1 === r1 || e1.source !== 'T20 No.1060\np.107a' || e1.id !== 'r1' || e1.order !== 5) miss.push('只改來源不算更動，或身分變了');
  const e2 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW', '');
  if (!e2 || e2 === r1 || e2.source !== '') miss.push('清掉來源不算更動');
  if (L.editRecord(r1, 't', 'na mo', dflt, 'NEW', '  T20 No.1060 ') !== r1) miss.push('只差頭尾空白也被當成更動');
  if (L.editRecord(r0, 't', 'na mo', dflt, 'NEW', '') !== r0) miss.push('空的改成空的被當成更動');

  // 控制器：加入／取代帶入面板上那一格；載回跟著那一筆；自己一格
  if (!/keep \? keep\.id : newId\(\), keep \? keep\.order : 0, \$recSource\.value, /.test(fnBody(w.js, 'currentRecord'))) miss.push('加入時沒有帶入來源欄的值');
  const act = fnBody(w.js, 'recAction');
  if (!/\$recSource\.value = it\.source;[^\n]*\n\s*state\.rec\.source = it\.source;/.test(act)) miss.push('載回某一筆時來源沒有跟著回來');
  const k = ['REC_KEY', 'REC_TITLE_KEY', 'REC_SOURCE_KEY'].map((n) => (w.js.match(new RegExp("var " + n + " = '([^']+)'")) || [])[1]);
  if (k.some((x) => !x) || new Set(k).size !== 3) miss.push('清單／標題／來源不是三格分開存（' + k.join('／') + '）');
  const cs = fnBody(w.js, 'clearSource'), ss = fnBody(w.js, 'saveSource');
  if (!cs || !ss) return 'FAIL: 找不到 clearSource／saveSource' + (miss.length ? '；' + miss.join('、') : '');
  if (/\$recTitle\b|state\.rec\.title|saveTitle|pushTitle|state\.rec\.items/.test(cs)) miss.push('清除來源動到了標題或清單');
  if (!/localStorage\.setItem\(REC_SOURCE_KEY, state\.rec\.source\)/.test(ss)) miss.push('saveSource 寫的不是來源那一格');
  if (!/Lib\.editRecord\(state\.edit\.orig, \$editTitle\.value, \$editInput\.value, readEditOptions\(\), savedAt, \$editSource\.value, /.test(w.js)) miss.push('編輯表單沒有把來源交給 editRecord');
  if (!/\$editSource\.value = it\.source;/.test(fnBody(w.js, 'startEdit'))) miss.push('開始編輯時沒有帶出那一筆的來源');
  if (!/if \(r\.source\) main\.appendChild\(node\('span', 'rec-src'/.test(w.js)) miss.push('清單上看不到來源');
  if (!/setSource\(state\.rec\.source\)/.test(fnBody(w.js, 'pushSource'))) miss.push('來源欄的值沒有同步');
  if (!/sourceClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('來源的清除鈕沒擋 mousedown');

  // 畫面
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), so = sheet.indexOf('id="rec-source"'), l = sheet.indexOf('id="rec-list"');
  if (!(t > 0 && t < so && so < l)) miss.push('面板內的順序不是 標題 → 來源 → 清單');
  const ci = sheet.indexOf('id="rec-source-clear"');
  if (ci < 0) miss.push('來源欄旁沒有清除鈕');
  else if (sheet.lastIndexOf('<label', ci) > sheet.lastIndexOf('</label>', ci)) miss.push('來源的清除鈕包在 <label> 裡');
  for (const id of ['rec-source', 'rec-edit-source']) {
    const ta = (sheet.match(new RegExp('<textarea id="' + id + '"[^>]*>')) || [''])[0];
    if (!ta) { miss.push('找不到 #' + id); continue; }
    const lack = ['class="rec-source-input"', 'autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => ta.indexOf(a) < 0);
    if (lack.length) miss.push('#' + id + ' 少了 ' + lack.join(' '));
  }
  const es = sheet.indexOf('id="rec-edit-source"'), ee = sheet.indexOf('id="rec-edit"'), tt = sheet.indexOf('id="rec-title"');
  if (!(ee > 0 && ee < es && es < tt)) miss.push('編輯表單裡沒有來源欄');
  if (!/textarea\.rec-source-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('來源欄沒用 --ctl-font');
  if (!/textarea\.rec-source-input\s*\{[^}]*min-height:\s*46px/.test(w.css)) miss.push('來源欄沒有 min-height（面板沒開時量到 0 會塌掉）');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㊴ 類型欄〔owner 2026-10-13：「再增加一個 field，用來紀錄資料的類型，例如：真言 / 種子字 / ...」；同日：「可以支援多個，類似 Tags」〕。
//    (a) 每一筆各自一份 `type`：**字串陣列**（可以有好幾個、可以是空的），**自由文字**〔owner 選的；另一案是固定選單〕；JSON 輸出也是陣列〔owner 選的〕
//        字串以「、，,；;」或換行拆開——欄位裡打的字、以及第一版存成單一字串的舊紀錄（'五輪' 讀成 ['五輪']）；每一個單行化、不重複、不含空的
//    (b) 快選鈕上的詞＝清單裡用過的類型（依第一次出現的順序），不重複；**沒有預設的詞**〔owner 2026-10-13 拿掉：他實際記的 26 筆沒有一筆用到「真言」「種子字」〕
//        ——清單裡沒有類型時是空的。快選鈕是**複選**的：點一下加上、再點一下拿掉（toggleType）。期望值寫死在這裡
//    (c) 面板上標題欄底下有一格（欄位裡的字，以「、」相連）：加入／取代時帶入；載回時跟著那一筆回來；自己一格存（碰不到清單——那一半在儲存區那一條）
//    (d) 編輯表單裡也有一格＋一排快選鈕；那一排只動表單，不可以去改面板上那一格（那會在按儲存之前就把面板的值換掉）
//    (e) 手機：快選鈕與清除鈕擋 mousedown；清除鈕不包在 label 裡；面板內 標題 → 類型 → 來源 → 清單
check('㊴ 類型欄：自由文字＋快選鈕、加入時帶入、自己一格存', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.normalizeTypes !== 'function' || typeof L.typeChoices !== 'function' || typeof L.typesText !== 'function' || typeof L.toggleType !== 'function') return 'FAIL: lib 沒有 normalizeTypes／typesText／toggleType／typeChoices';
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  const nt = (v) => JSON.stringify(L.normalizeTypes(v));
  if (nt(' 五輪 、五佛，五毒,五智；四大  壇城;五輪\n五路財神 ') !== '["五輪","五佛","五毒","五智","四大 壇城","五路財神"]') miss.push('字串沒有照分隔符拆開：' + nt(' 五輪 、五佛，五毒,五智；四大  壇城;五輪\n五路財神 '));
  if (nt('五輪') !== '["五輪"]') miss.push('舊的單一字串沒有讀成一個類型');
  if (nt(['五輪', ' 五佛 ', '', 5, null, '五輪', '五毒、五智']) !== '["五輪","五佛","五毒","五智"]') miss.push('陣列沒有正規化：' + nt(['五輪', ' 五佛 ', '', 5, null, '五輪', '五毒、五智']));
  if (nt(null) !== '[]' || nt(3) !== '[]' || nt('') !== '[]' || nt(' 、， ') !== '[]' || nt({ a: 1 }) !== '[]') miss.push('不是類型的東西沒有變成空陣列');
  if (L.typesText(['五輪', '五佛']) !== '五輪、五佛' || L.typesText('五輪 , 五佛；五毒') !== '五輪、五佛、五毒' || L.typesText(null) !== '') miss.push('typesText');
  if (nt(L.typesText(['五輪', '四大 壇城', '五佛'])) !== '["五輪","四大 壇城","五佛"]') miss.push('接起來的字拆回去不是同一份');
  const base = ['五輪', '五佛'], snapB = JSON.stringify(base);
  if (JSON.stringify(L.toggleType(base, '五佛')) !== '["五輪"]' || JSON.stringify(L.toggleType(base, ' 五毒 ')) !== '["五輪","五佛","五毒"]' || JSON.stringify(L.toggleType('五輪、五佛', '五輪')) !== '["五佛"]' || JSON.stringify(L.toggleType(base, '')) !== snapB) miss.push('toggleType（有就拿掉、沒有就加在最後）');
  if (JSON.stringify(base) !== snapB) miss.push('toggleType 改了傳進來的陣列');
  const used = [{ type: ['陀羅尼', '真言'] }, { type: ' 真言 ' }, { type: '' }, { type: '種子字、陀羅尼' }, null, { type: ['心咒'] }, {}, { type: 7 }];
  const snap = JSON.stringify(used);
  const ch = L.typeChoices(used).join('|');
  if (ch !== '陀羅尼|真言|種子字|心咒') miss.push('快選鈕的詞 = ' + ch + '（應為 陀羅尼|真言|種子字|心咒）');
  if (L.typeChoices(null).length !== 0 || L.typeChoices([]).length !== 0 || L.typeChoices([{ type: '' }, {}, { type: [] }]).length !== 0) miss.push('清單裡沒有類型時快選鈕不是空的（預設的詞被放回來了？）');
  if ('TYPE_PRESETS' in L) miss.push('lib 又有 TYPE_PRESETS（預設的詞已經拿掉）');
  if (JSON.stringify(used) !== snap) miss.push('typeChoices 改了傳進來的清單');
  const r1 = L.makeRecord('t', 'hrii.h', dflt, 'S', 'r1', 5, 'T18', '  種子字 、 五佛 ');
  if (!r1 || JSON.stringify(r1.type) !== '["種子字","五佛"]' || r1.source !== 'T18') miss.push('makeRecord 沒帶類型：' + JSON.stringify(r1 && [r1.type, r1.source]));
  const r0 = L.makeRecord('t', 'hrii.h', dflt, 'S', 'r0', 4);
  if (!r0 || JSON.stringify(r0.type) !== '[]') miss.push('沒給類型時不是空陣列');
  const exp = L.buildExport([r1, { title: 'old', input: 'a', options: dflt, savedAt: 'S' }, { title: 'v1', input: 'b', options: dflt, savedAt: 'S', type: '五輪' }], () => ({ siddham: 's', tibetan: 't', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T');
  if (JSON.stringify(exp.records[0].type) !== '["種子字","五佛"]') miss.push('JSON 輸出的類型不是陣列：' + JSON.stringify(exp.records[0].type));
  if (JSON.stringify(exp.records[1].type) !== '[]') miss.push('舊紀錄（沒有這一欄）輸出的類型不是空陣列：' + JSON.stringify(exp.records[1].type));
  if (JSON.stringify(exp.records[2].type) !== '["五輪"]') miss.push('第一版的單一字串輸出時沒有變成一個元素的陣列：' + JSON.stringify(exp.records[2].type));
  if (L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW') !== r1) miss.push('沒給類型時被當成更動（應沿用原來的）');
  const e1 = L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', undefined, '真言');
  if (!e1 || e1 === r1 || JSON.stringify(e1.type) !== '["真言"]' || e1.source !== 'T18' || e1.id !== 'r1' || e1.order !== 5) miss.push('只改類型不算更動，或來源／身分跟著變了');
  const e2 = L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', undefined, '');
  if (!e2 || e2 === r1 || JSON.stringify(e2.type) !== '[]') miss.push('清掉類型不算更動');
  const e3 = L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', undefined, '種子字、五佛、五毒');
  if (!e3 || e3 === r1 || JSON.stringify(e3.type) !== '["種子字","五佛","五毒"]') miss.push('多加一個類型不算更動');
  if (L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', 'T18', ' 種子字 ，五佛 ') !== r1) miss.push('只差分隔符與空白也被當成更動');
  const legacy = { title: 't', input: 'a', options: dflt, savedAt: 'S', id: 'rL', order: 1, source: '', type: '五輪' };
  if (L.editRecord(legacy, 't', 'a', dflt, 'NEW', '', '五輪') !== legacy) miss.push('第一版的單一字串，沒改也被當成更動（一開表單按儲存就白寫一次）');

  // 控制器
  if (!/keep \? keep\.order : 0, \$recSource\.value, \$recType\.value\);/.test(fnBody(w.js, 'currentRecord'))) miss.push('加入時沒有帶入類型欄的值');
  if (!/\$recType\.value = Lib\.typesText\(it\.type\);[^\n]*\n\s*state\.rec\.type = \$recType\.value;/.test(fnBody(w.js, 'recAction'))) miss.push('載回某一筆時類型沒有跟著回來（或直接把陣列塞進欄位——會變成逗號相連）');
  const k = ['REC_KEY', 'REC_TITLE_KEY', 'REC_SOURCE_KEY', 'REC_TYPE_KEY'].map((n) => (w.js.match(new RegExp("var " + n + " = '([^']+)'")) || [])[1]);
  if (k.some((x) => !x) || new Set(k).size !== 4) miss.push('清單／標題／來源／類型不是四格分開存（' + k.join('／') + '）');
  const sp = fnBody(w.js, 'setPanelType'), ct = fnBody(w.js, 'clearType'), st = fnBody(w.js, 'saveType'), rc = fnBody(w.js, 'renderTypeChips');
  if (!sp || !ct || !st || !rc) return 'FAIL: 找不到 setPanelType／clearType／saveType／renderTypeChips' + (miss.length ? '；' + miss.join('、') : '');
  if (/\$recTitle\b|\$recSource\b|state\.rec\.(title|source|items)|saveTitle|saveSource/.test(sp + ct)) miss.push('改類型欄動到了標題、來源或清單');
  if (!/state\.rec\.type = Lib\.typesText\(v\);/.test(sp)) miss.push('面板上記的不是欄位裡的字（typesText）');
  if (!/localStorage\.setItem\(REC_TYPE_KEY, state\.rec\.type\)/.test(st)) miss.push('saveType 寫的不是類型那一格');
  if (!/Lib\.typeChoices\(state\.rec\.items\)/.test(rc)) miss.push('快選鈕的詞不是由 lib 給的');
  if (!/cur\.indexOf\(t\) >= 0 \? ' active' : ''/.test(rc)) miss.push('快選鈕亮不亮不是看「那一格有沒有這個類型」（複選）');
  if (!/readEditOptions\(\), savedAt, \$editSource\.value, \$editType\.value\)/.test(w.js)) miss.push('編輯表單沒有把類型交給 editRecord');
  if (!/\$editType\.value = Lib\.typesText\(it\.type\);/.test(fnBody(w.js, 'startEdit'))) miss.push('開始編輯時沒有帶出那一筆的類型');
  if (!/r\.type\.forEach\(function \(t\) \{ head\.appendChild\(node\('span', 'rec-type', t\)\); \}\);/.test(w.js)) miss.push('清單上不是一個類型一顆');
  if (!/setType\(state\.rec\.type\)/.test(fnBody(w.js, 'pushType'))) miss.push('類型欄的值沒有同步');
  if (!/addEventListener\('mousedown', function \(e\) \{\s*if \(e\.target\.closest\('\.rec-chip'\)\) e\.preventDefault\(\);/.test(w.js)) miss.push('快選鈕沒擋 mousedown');
  if (!/typeClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('類型的清除鈕沒擋 mousedown');
  if (!/var v = Lib\.typesText\(Lib\.toggleType\(\(edit \? \$editType : \$recType\)\.value, c\.getAttribute\('data-type'\)\)\);\s*if \(edit\) \{ \$editType\.value = v; renderTypeChips\(\); \}\s*else \{ \$recType\.value = v; setPanelType\(v\); \}/.test(w.js)) miss.push('快選鈕不是「在它自己那一格加上／拿掉」（或編輯表單那一排去動了面板上那一格）');

  // 畫面
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), ty = sheet.indexOf('id="rec-type"'), so = sheet.indexOf('id="rec-source"'), l = sheet.indexOf('id="rec-list"');
  if (!(t > 0 && t < ty && ty < so && so < l)) miss.push('面板內的順序不是 標題 → 類型 → 來源 → 清單');
  const ci = sheet.indexOf('id="rec-type-clear"');
  if (ci < 0) miss.push('類型欄旁沒有清除鈕');
  else if (sheet.lastIndexOf('<label', ci) > sheet.lastIndexOf('</label>', ci)) miss.push('類型的清除鈕包在 <label> 裡');
  for (const id of ['rec-type', 'rec-edit-type']) {
    const tag = (sheet.match(new RegExp('<input type="text" id="' + id + '"[^>]*>')) || [''])[0];
    if (!tag) { miss.push('找不到 #' + id); continue; }
    const lack = ['class="rec-title"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => tag.indexOf(a) < 0);
    if (lack.length) miss.push('#' + id + ' 少了 ' + lack.join(' ') + '（rec-title＝字級走 --ctl-font）');
    if (sheet.indexOf('<div class="rec-chips" data-for="' + id + '"></div>') < sheet.indexOf('id="' + id + '"')) miss.push('#' + id + ' 底下沒有快選鈕那一排');
  }
  const ee = sheet.indexOf('id="rec-edit"'), et = sheet.indexOf('id="rec-edit-type"');
  if (!(ee > 0 && ee < et && et < t)) miss.push('編輯表單裡沒有類型欄');
  if (!/\.rec-chips:empty \{ display: none; \}/.test(w.css)) miss.push('空的那一排快選鈕沒有收起來');
  if (!/\.rec-head \{ flex-wrap: wrap;/.test(w.css)) miss.push('標題那一行不會折行（好幾個類型時會擠掉標題）');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

/* ---------- 工具 ---------- */
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : walk(p);
    return [p];
  });
}

async function run(world, quiet) {
  const res = [];
  for (const c of CHECKS) {
    let r;
    try { r = await c.fn(world); } catch (e) { r = 'FAIL: ' + e.message; }
    res.push({ name: c.name, r });
    if (!quiet) console.log((r === true ? 'PASS' : r === SKIP ? 'SKIP' : 'FAIL') + '  ' + c.name + (typeof r === 'string' ? '  — ' + r : ''));
  }
  return res;
}

/* ---------- 反向驗證：每一種改壞都必須讓指定的那一條 FAIL ---------- */
const catOf = (w, id) => w.assist.categories.find((c) => c.id === id);
const entry = (w, id, code) => catOf(w, id).entries.find((e) => e.code === code);
const wrapConvert = (w, fn) => { const K = w.Converter; w.Converter = class extends K { convert(i) { return fn(super.convert(i), i, this.options); } }; };
const MUTANTS = [
  ['①', '拉丁轉寫被改', (w) => wrapConvert(w, (r) => Object.assign({}, r, { latin: r.latin.toUpperCase() }))],
  ['①', '兩個空格不再是 tsheg', (w) => wrapConvert(w, (r) => Object.assign({}, r, { tibetan: r.tibetan.split(TSHEG).join('') }))],
  ['①', '三個空格沒有變成全形空格', (w) => wrapConvert(w, (r) => Object.assign({}, r, { tibetan: r.tibetan.split(C(0x3000)).join(TSHEG) }))],
  ['②', '子音 ka 的字形換成 kha', (w) => { entry(w, 'consonant', 'ka').char = C(0x0F41); }],
  ['②', '母音 ii 的記法改成 i', (w) => { entry(w, 'vowel', 'ii').code = 'i'; }],
  ['②', '下加輔音 y 的字形換成固定形', (w) => { entry(w, 'subjoined', 'y').char = C(0x0FBB); }],
  ['②', '標點 | 的字形換成 nyis shad', (w) => { entry(w, 'punct', '|').char = C(0x0F0E); }],
  ['②', '轉換器整個壞掉（藏文一律回空字串）', (w) => wrapConvert(w, (r) => Object.assign({}, r, { tibetan: '' }))],
  ['②', 'lib 把記法轉成大寫（KH 下大小寫有意義）', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => Object.assign({}, k, { ins: k.ins.toUpperCase() })); }],
  ['②', 'lib 沒有加載體', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => Object.assign({}, k, { glyph: k.glyph.replace(C(0x25CC), '') })); }],
  ['②', '每一格都沒有記法（空的比對）', (w) => { for (const c of w.assist.categories) for (const e of c.entries) { e.alt = e.alt || 'x'; e.code = ''; } }],
  ['③', '固定形又變回不可插入（lib 不用 alt）', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => (k.variant ? Object.assign({}, k, { ins: '', label: C(0x00B7), variant: false }) : k)); }],
  ['③', '固定形的記法對調（ྻ 插入 r）', (w) => { for (const e of catOf(w, 'subjoined').entries) { if (e.char === C(0x0FBB)) e.alt = 'r'; } }],
  ['③', '固定形沒有標 variant', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => Object.assign({}, k, { variant: false })); }],
  ['③', '把一般的 y 也變成只有 alt 的格（多一個 variant）', (w) => { const e = entry(w, 'subjoined', 'y'); e.alt = 'y'; e.code = ''; }],
  ['③', 'lib 替真的沒有記法的格編了一個記法', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => (k.ins ? k : Object.assign({}, k, { ins: 'y' }))); }],
  ['③', '控制器把空的記法也插進去', (w) => { w.js = w.js.replace("      if (!ins) {   // 沒有記法的格", "      if (false) {   // 沒有記法的格"); }],
  ['③', '沒有記法的鍵看起來與一般的鍵一樣', (w) => { w.js = w.js.replace("'key' + (k.ins ? '' : ' key-noinput')", "'key'"); }],
  ['④', 'insertAt 游標算錯', (w) => { const f = w.Lib.insertAt; w.Lib.insertAt = (...a) => { const r = f(...a); return { value: r.value, caret: r.caret - 1 }; }; }],
  ['④', 'insertAt 把插入的字去頭尾空白（tsheg 鍵變成插入空字串）', (w) => { const f = w.Lib.insertAt; w.Lib.insertAt = (v, s, e, t) => f(v, s, e, String(t).trim()); }],
  ['⑤', 'shellBox 忽略 offsetTop', (w) => { const f = w.Lib.shellBox; w.Lib.shellBox = (m) => { const r = f(m); return r && { top: 0, height: r.height }; }; }],
  ['⑥', '網址列收合被當成鍵盤', (w) => { w.Lib.keyboardOpen = (b, h) => b - h >= 60; }],
  ['⑦', '讀回的選項不驗證', (w) => { w.Lib.normalizeOptions = (o) => Object.assign({}, w.Lib.DEFAULT_OPTIONS, o || {}); }],
  ['⑧', '輸入搬到輸出上面', (w) => { w.html = w.html.replace('id="out-pane"', 'id="__tmp__"').replace('id="tsm-input"', 'id="out-pane"').replace('id="__tmp__"', 'id="tsm-input"'); }],
  ['⑨', '整頁又可以捲', (w) => { w.css = w.css.replace(/(html,\s*body\s*\{[^}]*)overflow:\s*hidden/, '$1overflow: auto'); }],
  ['⑩', '字級降到 14px', (w) => { w.css = w.css.replace(/--ctl-font:\s*\d+px/, '--ctl-font: 14px'); }],
  ['⑪', '記號列不擋 mousedown', (w) => { w.js = w.js.replace("$keybar.addEventListener('mousedown'", "$keybar.addEventListener('pointerup'"); }],
  ['⑪', '切換鈕不擋 mousedown', (w) => { w.js = w.js.replace("keysetBtn.addEventListener('mousedown'", "keysetBtn.addEventListener('pointerup'"); }],
  ['⑫', '改回 Materialize 自製下拉', (w) => { w.js += '\nM.FormSelect.init(document.querySelectorAll("select"));'; }],
  ['⑬', '輸入框允許自動大寫', (w) => { w.html = w.html.replace('autocapitalize="off"', 'autocapitalize="sentences"'); }],
  ['⑭', '少一語的 key', (w) => { delete w.locales.ja['toast.inputCleared']; }],
  ['⑭', 'HTML 用了未定義的 key', (w) => { w.html = w.html.replace('data-i18n="opt.done"', 'data-i18n="opt.finish"'); }],
  ['⑭', '少了 keyset.subjoined 的文案', (w) => { delete w.locales['zh-Hant']['keyset.subjoined']; delete w.locales.en['keyset.subjoined']; delete w.locales.ja['keyset.subjoined']; }],
  ['⑭', '少了「對照表載不到」的文案', (w) => { delete w.locales['zh-Hant']['out.tableFail']; delete w.locales.en['out.tableFail']; delete w.locales.ja['out.tableFail']; }],
  ['⑭', '紀錄的 toast 用了未定義的 key', (w) => { w.js = w.js.replace("recToast('rec.toast.replaced'", "recToast('rec.toast.replacedX'"); }],
  ['⑮', '共用文案漂掉', (w) => { w.locales.en['tool.lang'] = 'Switch language'; }],
  ['⑯', 'CSS 多了一條 local()', (w) => { w.css += "\n@font-face { font-family: 'X'; src: local('Jomolhari'); }"; }],
  ['⑲', '控制器直接 import 藏文核心', (w) => { w.js = 'import { ascii2tibetan } from "./tibetan-core.js";\n' + w.js; }],
  ['⑲', '控制器直接 import 引擎', (w) => { w.js = 'import { ascii2siddham } from "./vendor/bonji-input/siddham.js";\n' + w.js; }],
  ['⑳', '安全區改回墊在頁首', (w) => { w.css = w.css.replace(/(\.topbar\s*\{[^}]*?)padding: 0 4px 0 16px;/, '$1padding: env(safe-area-inset-top, 0px) 4px 0 16px;'); }],
  ['㉑', '切換鈕跑到清除鈕左邊', (w) => { w.html = w.html.replace('id="clear-input"', 'id="__c__"').replace('id="keyset-toggle"', 'id="clear-input"').replace('id="__c__"', 'id="keyset-toggle"'); }],
  ['㉒', '改回上下排', (w) => { w.css = w.css.replace(/(\.out-pane\s*\{[^}]*flex-direction:\s*)row/, '$1column'); }],
  ['㉒', '比例寫成 grow 2:1', (w) => { w.css = w.css.replace('flex: 0 0 calc((100% - 8px) * 2 / 3)', 'flex: 2 1 0'); }],
  ['㉒', '文字不靠底', (w) => { w.css = w.css.replace(/(^\.out-text\s*\{[^}]*?)margin-top:\s*auto;/m, '$1'); }],
  ['㉒', '聚焦時仍墊底部安全區', (w) => { w.css = w.css.replace('.shell:has(#tsm-input:focus) { padding-bottom: 0; }', ''); }],
  ['㉓', '拉丁欄的複製列搬回頂端', (w) => { w.html = w.html.replace(/(<div class="out-block out-block-latin">\n)(        <div class="out-value">.*\n)((?:.*\n){6})/, '$1$3$2'); }],
  ['㉔', '下加輔音排到子音前面', (w) => { w.Lib.KEYSET_IDS.splice(0, 5, 'vowel', 'subjoined', 'consonant', 'vowel_sign', 'punct'); }],
  ['㉔', '改回資料的順序（元音符號在下加輔音前面，2026-10-12 之前）', (w) => { w.Lib.KEYSET_IDS.splice(0, 5, 'vowel', 'consonant', 'vowel_sign', 'subjoined', 'punct'); }],
  ['㉔', '母音與元音符號對調（兩組都是 16 鍵，只數鍵數看不出來）', (w) => { w.Lib.KEYSET_IDS.splice(0, 5, 'vowel_sign', 'consonant', 'subjoined', 'vowel', 'punct'); }],
  ['㉔', 'assist.json 少了一類而記號列還收著', (w) => { w.assist.categories = w.assist.categories.filter((c) => c.id !== 'punct'); w.Lib.KEYSET_IDS.pop(); w.Lib.KEYSET_IDS.push('punct'); }],
  ['㉔', '標點組被拿掉', (w) => { w.Lib.KEYSET_IDS.pop(); }],
  ['㉔', 'assist.json 多了一類而記號列沒有', (w) => { w.assist.categories.push({ id: 'extra', entries: [{ code: 'x', char: 'x' }] }); }],
  ['㉔', '子音組被去重後少一格', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => (id === 'consonant' ? f(a, id).slice(1) : f(a, id)); }],
  ['㉔', '三個固定形被濾掉（下加輔音剩 34 格）', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).filter((k) => !k.variant); }],
  ['㉔', 'tsheg 鍵的兩個空格被收成一個', (w) => { const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id).map((k) => (k.ins === '  ' ? Object.assign({}, k, { ins: ' ' }) : k)); }],
  ['㉕', '加回悉曇欄', (w) => { w.html = w.html.replace('<div class="out-block out-block-latin">', '<div class="out-block"><div class="out-value"><div id="out-siddham" class="out-text"></div></div></div>\n      <div class="out-block out-block-latin">'); }],
  ['㉕', '控制器把悉曇也放進輸出', (w) => { w.js = w.js.replace('    out.latin.textContent = r.latin;\n    renderRecCurrent();\n    // 游標在結尾', '    out.latin.textContent = r.latin + r.siddham;\n    renderRecCurrent();\n    // 游標在結尾'); }],
  ['㉕', 'JSON 輸出多了悉曇', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r) => { if (r.output) r.output.siddham = 'x'; }); return e; }; }],
  ['㉖', '對照表還沒載好就轉', (w) => { w.js = w.js.replace('    if (!state.ready) {\n      // 對照表還沒載好', '    if (false) {\n      // 對照表還沒載好'); }],
  ['㉖', '載不到時輸出欄留白', (w) => { w.js = w.js.replace("state.tableFailed ? I18n.t('out.tableFail', { m: state.tableFailed }) : ''", "''"); }],
  ['㉖', '載好之後沒有補轉', (w) => { w.js = w.js.replace('    }).then(function () {\n      convert();\n      renderRecords();\n    });', '    });'); }],
  ['㉖', '清單不等對照表', (w) => { w.js = w.js.replace('    if (!state.ready && !state.tableFailed) {\n      list.textContent', '    if (false) {\n      list.textContent'); }],
  ['㉗', '字形框改回行高 1.25（上方符號被裁掉）', (w) => { w.css = w.css.replace(/(^\.key-glyph\s*\{[^}]*?line-height:\s*)2;/m, '$11.25;'); }],
  ['㉗', '鍵高改回 46px', (w) => { w.css = w.css.replace(/(^\.keybar \.key\s*\{[^}]*?[^-]height:\s*)54px/m, '$146px'); }],
  ['㉗', '字號改用 rem', (w) => { w.css = w.css.replace(/(^\.key-glyph\s*\{[^}]*?font-size:\s*)18px/m, '$11.3rem'); }],
  ['㉘', '標題被當成鍵（同名的覆寫前一筆）', (w) => { w.Lib.addRecord = (items, rec) => { const i = items.findIndex((x) => x.title === rec.title); return i >= 0 ? items.map((x, k) => (k === i ? rec : x)) : items.concat([rec]); }; }],
  ['㉘', '空標題不給加', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s) => (String(t || '').trim() ? f(t, i, o, s) : null); }],
  ['㉘', 'part 不分標題（等於 seq）', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { r.part = r.seq; }); return e; }; }],
  ['㉘', '取代把那一筆搬到最後', (w) => { w.Lib.replaceRecord = (items, i, rec) => items.filter((_, k) => k !== i).concat([rec]); }],
  ['㉙', '每一筆都用第一筆的選項', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => f(items, (i) => c(i, items[0].options), t); }],
  ['㉙', '轉不出來的那一筆被安靜地丟掉', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records = e.records.filter((r) => r.output); e.count = e.records.length; return e; }; }],
  ['㉙', '控制器共用畫面上那個轉換器', (w) => { w.js = w.js.replace('var r = new TibetanSiddhamConverter(options).convert(input);', 'var r = converter.convert(input);'); }],
  ['㉙', '碼位改成拉丁那一欄的', (w) => { w.js = w.js.replace('codepoints: r.codepoints.tibetan };', 'codepoints: r.codepoints.latin };'); }],
  ['㉚', '讀回的清單不驗證', (w) => { w.Lib.normalizeStore = (s) => s || { title: '', items: [] }; }],
  ['㉚', '讀回的 id 不驗證（會被拿去當文件路徑）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && r.id) o.items[i].id = r.id; }); return o; }; }],
  ['㉛', '加入鈕不擋 mousedown', (w) => { w.js = w.js.replace("quick.addEventListener('mousedown'", "quick.addEventListener('pointerup'"); }],
  ['㉛', '加入鈕搬到頁首', (w) => { const m = w.html.match(/          <a href="#!" id="rec-add-quick"[\s\S]*?<\/a>\n/); w.html = w.html.replace(m[0], '').replace('<a href="#!" id="open-options"', m[0] + '<a href="#!" id="open-options"'); }],
  ['㉛', '標題的清除鈕不擋 mousedown', (w) => { w.js = w.js.replace("titleClear.addEventListener('mousedown'", "titleClear.addEventListener('pointerup'"); }],
  ['㉛', '清除鈕包回 <label> 裡', (w) => { w.html = w.html.replace('<div class="rec-title-row">', '<label class="rec-title-row">').replace(/(id="rec-title-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㉛', '標題欄字級寫死 16px', (w) => { w.css = w.css.replace(/(input\[type="text"\]\.rec-title\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㉛', '刪除改用 confirm()', (w) => { w.js = w.js.replace("if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmRemove', { n: n }); return; }", "if (!confirm('delete?')) return;"); }],
  ['㉛', 'JSON 排到標題欄上面', (w) => { w.html = w.html.replace('id="rec-title"', 'id="__t__"').replace('id="rec-json"', 'id="rec-title"').replace('id="__t__"', 'id="rec-json"'); }],
  ['㉛', '標題欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' && !typingInSheet()) state.baseline', ') state.baseline'); }],
  ['㉛', '編輯表單的記法欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $editInput;', ';'); }],
  ['㉜', '存完不讀回比對', (w) => { w.js = w.js.replace('ok = localStorage.getItem(REC_KEY) === text;', 'ok = true;'); }],
  ['㉜', '下載檔名不補零', (w) => { w.Lib.exportFilename = (d) => NAME + '-' + d.getFullYear() + (d.getMonth() + 1) + d.getDate() + d.getHours() + d.getMinutes() + d.getSeconds() + '.json'; }],
  ['㉝', '清除標題又去寫清單', (w) => { w.js = w.js.replace("    state.rec.title = '';\n    saveTitle();", "    state.rec.title = '';\n    saveItems();\n    saveTitle();"); }],
  ['㉝', '關掉面板時整份重寫', (w) => { w.js = w.js.replace('disarm(); saveTitle(); }   //', 'disarm(); saveItems(); saveTitle(); }   //'); }],
  ['㉝', '標題與清單又存回同一格', (w) => { w.js = w.js.replace("var REC_TITLE_KEY = '" + NAME + "-rec-title'", "var REC_TITLE_KEY = '" + NAME + "-records'"); }],
  ['㉝', '清單裡又帶著標題整格寫', (w) => { w.js = w.js.replace('JSON.stringify({ items: state.rec.items })', 'JSON.stringify(state.rec)'); }],
  ['㉝', '加入之前不看儲存區', (w) => { w.js = w.js.replace('    syncItems();   // 別的畫面記過新的', '    // 別的畫面記過新的'); }],
  ['㉝', '刪除／取代不管別處改過', (w) => { w.js = w.js.replace("if (syncItems() === 'changed') {\n      disarm();\n      renderRecords();\n      recToast", "if (false) {\n      disarm();\n      renderRecords();\n      recToast"); }],
  ['㉝', '讀不到被當成清單被清空', (w) => { w.Lib.storeDrift = (a, b) => (a === b ? 'same' : 'changed'); }],
  ['㉞', '刪除被待確認的寫入帶回來', (w) => { const f = w.Lib.mergeRemote; w.Lib.mergeRemote = (re, put, del) => f(re, put, {}).filter((x) => !(del || {})[x.id] || (put || {})[x.id]); }],
  ['㉞', '清單不排序（照資料庫給的順序）', (w) => { w.Lib.mergeRemote = (re, put, del) => re.filter((x) => !del[x.id]).map((x) => put[x.id] || x).concat(Object.keys(put).filter((id) => !re.some((x) => x.id === id) && !del[id]).map((id) => put[id])); }],
  ['㉞', 'id 漏進 JSON 輸出', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r, i) => { r.id = items[i].id; }); return e; }; }],
  ['㉞', '同步改成整份清單寫一份文件', (w) => { w.remote = w.remote.replace("return db.collection(COL).doc(rec.id).set({", "return db.doc('state/list').set({ items: [rec] }); db.collection(COL).doc(rec.id).set({"); }],
  ['㉞', '資料庫作主時又寫回 localStorage', (w) => { w.js = w.js.replace("    if (remoteOn()) return;   // 同上", "    // 同上"); }],
  ['㉞', '規則放寬成任何看得到的人都能讀', (w) => { w.build = w.build.replace('"read": "owner"', '"read": "view"'); }],
  ['㉞', '同步那一支掛的名字與控制器等的不一樣', (w) => { w.remote = w.remote.replace('window.TibetanSiddhamMobileRemote = { start: start', 'window.BonjiMobileRemote = { start: start'); }],   // 換程式那一行；檔頭註解裡也有同一段字
  ['㉟', '空的清單也寫一份（七天後把有內容的擠掉）', (w) => { w.backup = w.backup.replace('if [ "$FOUND" = "0" ]; then', 'if [ "$FOUND" = "never" ]; then'); }],
  ['㉟', '不對帳檔數', (w) => { w.backup = w.backup.replace('if [ "$FOUND" != "$EXPECT" ]; then', 'if [ "$FOUND" = "never" ]; then'); }],
  ['㉟', '驗證沒過照樣寫出', (w) => { w.backup = w.backup.replace('if (items.length !== raw.length) throw', 'if (false) throw'); }],
  ['㉟', '內容相同也另存一份', (w) => { w.backup = w.backup.replace('same = !bits.length;', 'same = false;'); }],
  ['㉟', '用完不清取回來的檔', (w) => { w.backup = w.backup.replace(/\ncleanup_pull\n\n# ─+ ④/, '\n\n# ④'); }],
  ['㉟', '備份腳本去載 bonji-mobile 的 lib', (w) => { w.backup = w.backup.replace('const L = sb.TibetanSiddhamMobileLib;', 'const L = sb.BonjiMobileLib;'); }],
  ['㊱', '標點組多一格字型沒有的字', (w) => { catOf(w, 'punct').entries.push({ code: 'zz', char: C(0x11600) }); const f = w.Lib.keysFromAssist; w.Lib.keysFromAssist = (a, id) => f(a, id); }],
  ['㊱', '藏文字型換成悉曇那一支', (w) => { w.fontTibetan = w.fontSiddham; }],
  ['㊱', '悉曇字型換成藏文那一支（𑗁 畫不出來）', (w) => { w.fontSiddham = w.fontTibetan; }],
  ['㊱', '字型檔壞掉（表目錄被清空）', (w) => { w.fontTibetan = Buffer.from(w.fontTibetan); w.fontTibetan.fill(0, 12, 12 + 16 * w.fontTibetan.readUInt16BE(4)); }],
  ['㉝', '編輯存回之前不看儲存區', (w) => { w.js = w.js.replace("    // 清單在別的畫面被改過 ⇒ 先換成最新的，這一下不執行（表單與裡面打的字都留著）\n    if (syncItems() === 'changed') {", "    if (false) {"); }],
  ['㊲', '沒有更動也回一筆新的（白寫一次）', (w) => { const mk = w.Lib.makeRecord; w.Lib.editRecord = (o, t, i, op, s) => (o ? mk(t, i, op, s, o.id, o.order) : null); }],
  ['㊲', '編輯後換了一個 id（變成另一筆）', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, ...a) => { const r = f(o, ...a); return r && r !== o ? Object.assign({}, r, { id: 'rnew' }) : r; }; }],
  ['㊲', '編輯後被排到最後（order 換新）', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, ...a) => { const r = f(o, ...a); return r && r !== o ? Object.assign({}, r, { order: 999999 }) : r; }; }],
  ['㊲', '記法清空也存回去', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => f(o, t, i, op, s) || (o ? Object.assign({}, o, { input: '', savedAt: s }) : null); }],
  ['㊲', '只改選項被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => { const r = f(o, t, i, op, s); return r && o && r.title === o.title && r.input === o.input ? o : r; }; }],
  ['㊲', 'editRecord 就地改原來那一筆', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => { const r = f(o, t, i, op, s); if (r && r !== o) { Object.assign(o, r); return Object.assign({}, r); } return r; }; }],
  ['㊲', '存回時認序號不認 id', (w) => { w.js = w.js.replace("    var i = Lib.indexOfId(state.rec.items, ed.id);\n    // 那一筆已經在別處被刪掉", "    var i = ed.index;\n    // 那一筆已經在別處被刪掉"); }],
  ['㊲', '那一筆在別處被刪了照樣存回去', (w) => { w.js = w.js.replace("    if (i < 0) { recToast('rec.toast.editGone', null, 'orange', 6000); return; }", "    if (i < 0) i = state.rec.items.length;"); }],
  ['㊲', '存回時順手改了標題欄', (w) => { w.js = w.js.replace("    saveItems();\n    pushPut(rec);\n    endEdit();", "    state.rec.title = rec.title;\n    saveItems();\n    saveTitle();\n    pushPut(rec);\n    endEdit();"); }],
  ['㊲', '開始編輯時把那一筆載進主輸入框', (w) => { w.js = w.js.replace("    $editInput.value = it.input;\n", "    $editInput.value = it.input;\n    $input.value = it.input;\n"); }],
  ['㊲', '沒有更動也寫入', (w) => { w.js = w.js.replace("    if (rec === ed.orig) {   // 沒有更動", "    if (false) {   // 沒有更動"); }],
  ['㊲', '編輯中點面板外面會關掉', (w) => { w.js = w.js.replace("M.Modal.getInstance($recModal).options.dismissible = false;", "M.Modal.getInstance($recModal).options.dismissible = true;"); }],
  ['㊲', '有還沒存的更動也直接取消', (w) => { w.js = w.js.replace("if (editDraft('') !== ed.orig && !isArmed('editCancel', i)) {", "if (false) {"); }],
  ['㊲', '面板關掉後仍停在編輯', (w) => { w.js = w.js.replace("$recTitle.blur(); endEdit(); disarm();", "$recTitle.blur(); disarm();"); }],
  ['㊲', '編輯中「完成」仍看得到', (w) => { w.css = w.css.replace(".records-sheet.is-editing .modal-footer > :not(.rec-edit-only) { display: none; }\n", ""); }],
  ['㊲', '表單排到 JSON 的位置（面板底部）', (w) => { w.html = w.html.replace('id="rec-edit"', 'id="__e__"').replace('id="rec-json"', 'id="rec-edit"').replace('id="__e__"', 'id="rec-json"'); }],
  ['㊲', '儲存／取消只剩底列那一對', (w) => { w.html = w.html.replace(/          <span class="rec-edit-acts">[\s\S]*?<\/span>\n/, ''); }],
  ['㊲', '記法欄開著自動校正', (w) => { w.html = w.html.replace(/(<textarea id="rec-edit-input"[^>]*?)autocorrect="off" /, '$1'); }],
  ['㊲', '記法欄字級寫死 16px', (w) => { w.css = w.css.replace(/(textarea\.rec-edit-input\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㊲', '清單上沒有編輯鈕', (w) => { w.js = w.js.replace("      li.appendChild(recButton('edit', i, 'edit', 'rec.edit', false));\n", ''); }],
  ['⑭', '編輯的文案少一語', (w) => { delete w.locales.ja['rec.toast.confirmDiscard']; }],
  ['㊳', '來源被丟掉（makeRecord 不收）', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s, id, ord) => f(t, i, o, s, id, ord); }],
  ['㊳', '來源的換行被壓成一行', (w) => { const f = w.Lib.normalizeSource; w.Lib.normalizeSource = (s) => f(s).replace(/\s+/g, ' '); }],
  ['㊳', 'JSON 輸出不帶來源', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { delete r.source; }); return e; }; }],
  ['㊳', '舊紀錄的來源輸出成 undefined', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r, i) => { r.source = items[i].source; }); return e; }; }],
  ['㊳', '編輯時沒給來源就清掉它', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src) => f(o, t, i, op, s, src === undefined ? '' : src); }],
  ['㊳', '只改來源被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src) => { const r = f(o, t, i, op, s, src); return r && o && r !== o && r.title === o.title && r.input === o.input && JSON.stringify(r.options) === JSON.stringify(o.options) ? o : r; }; }],
  ['㊳', '加入時不帶來源欄的值', (w) => { w.js = w.js.replace('keep ? keep.order : 0, $recSource.value, ', 'keep ? keep.order : 0, undefined, '); }],
  ['㊳', '載回時來源沒有跟著回來', (w) => { w.js = w.js.replace("      $recSource.value = it.source;   // 來源跟著那一筆回來（之後按取代，來源才不會被面板上別的值換掉）\n      state.rec.source = it.source;\n", ''); }],
  ['㊳', '來源與標題存在同一格', (w) => { w.js = w.js.replace("-rec-source';   // 來源欄現在的值", "-rec-title';   // 來源欄現在的值"); }],
  ['㊳', '清除來源順手清了標題', (w) => { w.js = w.js.replace("    state.rec.source = '';\n    grow($recSource);", "    state.rec.source = '';\n    state.rec.title = '';\n    grow($recSource);"); }],
  ['㊳', '編輯表單不把來源交出去', (w) => { w.js = w.js.replace('readEditOptions(), savedAt, $editSource.value, ', 'readEditOptions(), savedAt, undefined, '); }],
  ['㊳', '開始編輯時來源欄留著上一筆的', (w) => { w.js = w.js.replace("    $editSource.value = it.source;\n", ''); }],
  ['㊳', '清單上不顯示來源', (w) => { w.js = w.js.replace("      if (r.source) main.appendChild(node('span', 'rec-src'", "      if (false) main.appendChild(node('span', 'rec-src'"); }],
  ['㊳', '來源的清除鈕不擋 mousedown', (w) => { w.js = w.js.replace("sourceClear.addEventListener('mousedown'", "sourceClear.addEventListener('pointerup'"); }],
  ['㊳', '來源欄排到清單下面', (w) => { w.html = w.html.replace('id="rec-source"', 'id="__s__"').replace('id="rec-json"', 'id="rec-source"').replace('id="__s__"', 'id="rec-json"'); }],
  ['㊳', '來源的清除鈕包進 <label>', (w) => { w.html = w.html.replace('<div class="rec-title-row rec-source-row">', '<label class="rec-title-row rec-source-row">').replace(/(id="rec-source-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㊳', '來源欄開著自動校正', (w) => { w.html = w.html.replace(/(<textarea id="rec-source"[\s\S]*?)autocorrect="off" /, '$1'); }],
  ['㊳', '來源欄字級寫死 16px', (w) => { w.css = w.css.replace(/(textarea\.rec-source-input\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㊳', '編輯表單沒有來源欄', (w) => { w.html = w.html.replace(/        <div class="opt-field">\n          <label class="opt-label" for="rec-edit-source"[\s\S]*?<\/div>\n/, ''); }],
  ['㉝', '打來源時整份清單重寫', (w) => { w.js = w.js.replace("      grow($recSource);\n      saveSourceSoon();", "      grow($recSource);\n      saveItems();\n      saveSourceSoon();"); }],
  ['㉝', '清除來源又去寫清單', (w) => { w.js = w.js.replace("    grow($recSource);\n    saveSource();\n    pushSource();\n    setIconDone(trigger);", "    grow($recSource);\n    saveItems();\n    saveSource();\n    pushSource();\n    setIconDone(trigger);"); }],
  ['㉞', '同步寫入時漏了來源', (w) => { w.remote = w.remote.replace("source: rec.source || '', input:", 'input:'); }],
  ['㉞', '同步讀回時漏了來源', (w) => { w.remote = w.remote.replace('source: x.source, input:', 'input:'); }],
  ['㉟', '備份不比來源（只改來源被當成沒變）', (w) => { w.backup = w.backup.replace('r.source || "", r.input, r.options, r.order])', 'r.input, r.options, r.order])'); }],
  ['㉛', '來源欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $recSource', ''); }],
  ['㉚', '讀回的來源不驗證（不是字串也收）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && 'source' in r) o.items[i].source = r.source; }); return o; }; }],
  ['⑭', '來源的文案少一語', (w) => { delete w.locales.en['rec.sourceLine']; }],
  ['㊴', '類型被丟掉（makeRecord 不收）', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s, id, ord, src) => f(t, i, o, s, id, ord, src); }],
  ['㊴', '類型又存成字串（不是陣列）', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (...a) => { const r = f(...a); if (r) r.type = r.type.join('、'); return r; }; }],
  ['㊴', '字串不拆開（「五輪、五佛」當成一個類型）', (w) => { const f = w.Lib.normalizeTypes; w.Lib.normalizeTypes = (v) => (typeof v === 'string' ? (v.trim() ? [v.trim()] : []) : f(v)); }],
  ['㊴', '類型不去重', (w) => { w.Lib.normalizeTypes = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[、，,；;\n]+/) : []).filter((x) => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean); }],
  ['㊴', '陣列裡不是字串的也收', (w) => { const f = w.Lib.normalizeTypes; w.Lib.normalizeTypes = (v) => (Array.isArray(v) ? f(v.map((x) => String(x == null ? '' : x))) : f(v)); }],
  ['㊴', '欄位裡以逗號相連（拆回去對，但畫面上不是「、」）', (w) => { w.Lib.typesText = (v) => w.Lib.normalizeTypes(v).join(','); }],
  ['㊴', '快選鈕只會加、不會拿掉', (w) => { w.Lib.toggleType = (v, t) => w.Lib.normalizeTypes(w.Lib.normalizeTypes(v).concat([t])); }],
  ['㊴', '快選鈕變成單選（點一顆就換掉整格）', (w) => { w.Lib.toggleType = (v, t) => w.Lib.normalizeTypes(t); }],
  ['㊴', '用過的類型不照第一次出現的順序（改成排序）', (w) => { const f = w.Lib.typeChoices; w.Lib.typeChoices = (items) => f(items).slice().sort(); }],
  ['㊴', '快選鈕的詞重複', (w) => { w.Lib.typeChoices = (items) => [].concat(...(items || []).filter(Boolean).map((x) => w.Lib.normalizeTypes(x.type))); }],
  ['㊴', '預設的詞被放回來', (w) => { const f = w.Lib.typeChoices; w.Lib.typeChoices = (items) => ['真言', '種子字'].concat(f(items).filter((t) => t !== '真言' && t !== '種子字')); }],
  ['㊴', '空的那一排快選鈕不收起來', (w) => { w.css = w.css.replace('.rec-chips:empty { display: none; }\n', ''); }],
  ['㊴', '標題那一行不折行', (w) => { w.css = w.css.replace('.rec-head { flex-wrap: wrap; row-gap: 3px; }\n', ''); }],
  ['㊴', 'JSON 輸出不帶類型', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { delete r.type; }); return e; }; }],
  ['㊴', 'JSON 輸出的類型接成字串', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { r.type = r.type.join('、'); }); return e; }; }],
  ['㊴', '第一版的單一字串原樣輸出（不變成陣列）', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r, i) => { if (typeof items[i].type === 'string') r.type = items[i].type; }); return e; }; }],
  ['㊴', '編輯時沒給類型就清掉它', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src, ty) => f(o, t, i, op, s, src, ty === undefined ? '' : ty); }],
  ['㊴', '只改類型被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src, ty) => { const r = f(o, t, i, op, s, src, ty); return r && o && r !== o && r.title === o.title && r.input === o.input && r.source === o.source && JSON.stringify(r.options) === JSON.stringify(o.options) ? o : r; }; }],
  ['㊴', '第一版的單一字串一開表單就被當成更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src, ty) => { const r = f(o, t, i, op, s, src, ty); return r === o && o && typeof o.type === 'string' ? Object.assign({}, o, { type: w.Lib.normalizeTypes(o.type), savedAt: s }) : r; }; }],
  ['㊴', '加入時不帶類型欄的值', (w) => { w.js = w.js.replace('$recSource.value, $recType.value);', '$recSource.value);'); }],
  ['㊴', '載回時把陣列直接塞進欄位', (w) => { w.js = w.js.replace("      $recType.value = Lib.typesText(it.type);   // 類型同上（好幾個時以「、」相連）\n", "      $recType.value = it.type;\n"); }],
  ['㊴', '類型與來源存在同一格', (w) => { w.js = w.js.replace("-rec-type';   // 類型欄現在的值", "-rec-source';   // 類型欄現在的值"); }],
  ['㊴', '編輯表單的快選鈕改到面板上那一格', (w) => { w.js = w.js.replace("if (edit) { $editType.value = v; renderTypeChips(); }", "if (edit) { $recType.value = v; setPanelType(v); }"); }],
  ['㊴', '快選鈕點了就整格換掉（控制器不走 toggleType）', (w) => { w.js = w.js.replace("var v = Lib.typesText(Lib.toggleType((edit ? $editType : $recType).value, c.getAttribute('data-type')));", "var v = c.getAttribute('data-type');"); }],
  ['㊴', '快選鈕只亮完全相同的那一格（單選的亮法）', (w) => { w.js = w.js.replace("(cur.indexOf(t) >= 0 ? ' active' : '')", "(cur.join('、') === t ? ' active' : '')"); }],
  ['㊴', '快選鈕不擋 mousedown', (w) => { w.js = w.js.replace("      if (e.target.closest('.rec-chip')) e.preventDefault();\n", ''); }],
  ['㊴', '編輯表單不把類型交出去', (w) => { w.js = w.js.replace('savedAt, $editSource.value, $editType.value);', 'savedAt, $editSource.value);'); }],
  ['㊴', '開始編輯時類型欄留著上一筆的', (w) => { w.js = w.js.replace("    $editType.value = Lib.typesText(it.type);\n", ''); }],
  ['㊴', '清單上不顯示類型', (w) => { w.js = w.js.replace("      r.type.forEach(function (t) { head.appendChild(node('span', 'rec-type', t)); });   // 一個類型一顆\n", ''); }],
  ['㊴', '快選鈕的詞寫死在控制器', (w) => { w.js = w.js.replace('var choices = Lib.typeChoices(state.rec.items);', "var choices = ['真言', '種子字'];"); }],
  ['㊴', '類型欄排到來源下面', (w) => { w.html = w.html.replace('id="rec-type"', 'id="__t__"').replace('id="rec-source"', 'id="rec-type"').replace('id="__t__"', 'id="rec-source"'); }],
  ['㊴', '類型的清除鈕包進 <label>', (w) => { w.html = w.html.replace('<div class="rec-title-row rec-type-row">', '<label class="rec-title-row rec-type-row">').replace(/(id="rec-type-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㊴', '面板上沒有快選鈕那一排', (w) => { w.html = w.html.replace('        <div class="rec-chips" data-for="rec-type"></div>\n', ''); }],
  ['㊴', '編輯表單沒有類型欄', (w) => { w.html = w.html.replace(/        <div class="opt-field">\n          <label class="opt-label" for="rec-edit-type"[\s\S]*?<\/div>\n        <\/div>\n/, ''); }],
  ['㊴', '類型欄不走 --ctl-font（拿掉 rec-title）', (w) => { w.html = w.html.replace('<input type="text" id="rec-edit-type" class="rec-title"', '<input type="text" id="rec-edit-type" class="rec-type-input"'); }],
  ['㉝', '點快選鈕時整份清單重寫', (w) => { w.js = w.js.replace("    state.rec.type = Lib.typesText(v);\n", "    state.rec.type = Lib.typesText(v);\n    saveItems();\n"); }],
  ['㉞', '同步寫入時漏了類型', (w) => { w.remote = w.remote.replace("type: rec.type || [], source:", 'source:'); }],
  ['㉞', '同步寫入時類型接成字串', (w) => { w.remote = w.remote.replace("type: rec.type || [], source:", "type: rec.type || '', source:"); }],
  ['㉞', '同步讀回時漏了類型', (w) => { w.remote = w.remote.replace('type: x.type, source:', 'source:'); }],
  ['㉟', '備份不比類型（只改類型被當成沒變）', (w) => { w.backup = w.backup.replace('[r.title, L.normalizeTypes(r.type), r.source', '[r.title, r.source'); }],
  ['㉟', '備份拿原樣的類型去比（字串與陣列被當成不同）', (w) => { w.backup = w.backup.replace('[r.title, L.normalizeTypes(r.type), r.source', '[r.title, r.type || "", r.source'); }],
  ['㉛', '類型欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $recType', ''); }],
  ['㉚', '讀回的類型不驗證（原樣收）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && 'type' in r) o.items[i].type = r.type; }); return o; }; }],
  ['⑭', '類型的文案少一語', (w) => { delete w.locales.ja['rec.typeLabel']; }]
];

async function selftest() {
  let missed = 0;
  for (const [id, desc, mutate] of MUTANTS) {
    const w = await loadWorld();
    mutate(w);
    const res = await run(w, true);
    const hit = res.find((r) => r.name.startsWith(id));
    const caught = hit && typeof hit.r === 'string' && hit.r.startsWith('FAIL');
    if (!caught) missed++;
    console.log((caught ? 'CAUGHT ' : 'MISSED ') + id + '  ' + desc);
  }
  // 對照組：沒改壞的世界必須全綠（否則上面的 CAUGHT 可能只是它本來就紅）
  const base = await run(await loadWorld(), true);
  const baseRed = base.filter((r) => typeof r.r === 'string');
  console.log(baseRed.length ? 'BASELINE RED: ' + baseRed.map((r) => r.name).join(', ') : 'baseline 全綠');
  console.log(`\n${MUTANTS.length - missed}/${MUTANTS.length} 個注入被抓到`);
  process.exit(missed || baseRed.length ? 1 : 0);
}

(async () => {
  if (process.argv.includes('--selftest')) return selftest();
  const res = await run(await loadWorld(), false);
  const fail = res.filter((r) => typeof r.r === 'string').length;
  const skip = res.filter((r) => r.r === SKIP).length;
  console.log(`\n${res.length - fail - skip} PASS ／ ${fail} FAIL ／ ${skip} SKIP（共 ${res.length} 條）`);
  process.exit(fail ? 1 : 0);
})();
