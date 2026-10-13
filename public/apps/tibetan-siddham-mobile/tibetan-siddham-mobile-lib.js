/**
 * tibetan-siddham-mobile-lib.js — 純核心（IIFE → window.TibetanSiddhamMobileLib）。**不碰 DOM**、零依賴。
 *
 * 藏文轉換本身不在這裡：唯一的轉換介面是 ./tibetan-siddham-converter.js（ESM 防腐層，
 * tibetan-siddham 的 byte-identical 複製件）。本檔放的是**這支 app 自己的、離開畫面仍成立**的邏輯：
 *
 *   KEYSET_IDS                 記號列的五組（切換順序）：'vowel'（母音）→ 'consonant'（子音）→ 'subjoined'（下加輔音）
 *                              → 'vowel_sign'（元音符號）→ 'punct'（標點）
 *   keysFromAssist(assist, id) → [{ ins, glyph, label, variant }] —— 由 tibetan-siddham 的 data/assist.json 推出該組的鍵
 *   normalizeKeyset(id)        → 白名單版本（從 localStorage 讀回來的不可信）
 *   insertAt(value, s, e, t)   → { value, caret } —— 把 t 插在選取範圍 [s, e) 上
 *   shellBox(m)                → { top, height } —— 外殼該貼齊的可見範圍（鍵盤彈出後）
 *   keyboardOpen(base, h)      → boolean —— 可見高度比基準少到「一定是鍵盤」了沒
 *   normalizeOptions(o)        → 三個選項的白名單版本（從 localStorage 讀回來的不可信）
 *   normalizeDraft(d)          → { input, options } —— 草稿同上
 *   normalizeTitle(t)          → 標題的單行版本（**可以是空的、可以重複**）
 *   normalizeType(t)           → 類型的單行版本（**自由文字、可以是空的**）
 *   TYPE_PRESETS／typeChoices(items) → 快選鈕上的詞：預設的（真言、種子字）＋清單裡用過的，不重複
 *   normalizeSource(s)         → 來源的版本：換行統一成 \n、去頭尾空白（**多行、可以是空的**）
 *   makeRecord(t, i, o, iso, id, order, source, type) → 一筆紀錄 `{ title, type, source, input, options, savedAt, id, order }`；input 是空的回 null
 *   normalizeStore(s)          → { title, items } —— 紀錄清單（從 localStorage 讀回來的不可信）
 *   storeDrift(last, now)      → 'same' | 'changed' | 'lost' —— 儲存區裡的清單與這個畫面上次看到的比起來怎麼了
 *   nextOrder(items, now)      → 新的一筆的排序值（一定排在現有每一筆之後）
 *   mergeRemote(remote, put, del) → 遠端清單 ⊕ 這個畫面還沒被確認的寫入，依 order 排（Artifacts 版的同步用）
 *   addRecord／replaceRecord／removeRecord(items, …) → 新陣列（不改輸入）
 *   indexOfId(items, id)       → 那一筆現在在第幾格（找不到 -1）
 *   editRecord(orig, t, i, o, iso, source, type) → 編輯後的那一筆（id／order 沿用）；沒有更動回 orig 本身、input 清空回 null；source／type 沒給＝沿用原來的
 *   buildExport(items, convert, iso) → JSON 輸出的那個物件（輸出是匯出當下**算出來的**，不落地）
 *   exportFilename(date)       → `tibetan-siddham-mobile-yyyyMMddHHmmss.json`
 *
 * 資料格式：assist `{ categories: [{ id, carrier?, entries: [{ code, char, label?, note? }] }] }`（tibetan-siddham 的輔助輸入面板那一份）；
 *           草稿 `{ input: string, options: { inputMethod, transliteration, ignoreSpacesAndHyphens } }`；
 *           紀錄清單 `{ items: [{ title, type, source, input, options, savedAt, id, order }] }`（標題欄的值另存一格，見控制器）；
 *           `id`＝這一筆的身分（Artifacts 版一筆一份文件，文件名就是它）、`order`＝排序值；兩者都**不進 JSON 輸出**。
 *           JSON 輸出 `{ app, exportedAt, count, records: [{ seq, part, title, type, source, options, input, output, savedAt }] }`，
 *           `output` ＝ `{ tibetan, latin, codepoints }`（**沒有悉曇**，見下面 buildExport 的說明）。
 * 後端 API：無（零後端，DATABASE_GUIDELINES §0 的第 0 層）。
 */
(function (root) {
  'use strict';

  /* ---------- 記號列 ----------
   * 手機鍵盤上 `;` `.` `|` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用
   * ⇒ 做成一鍵插入，分五組切換（輸入框右側那顆鈕，依 KEYSET_IDS 的順序循環）：
   *   母音 vowel          —— 獨立元音（`a` `aa` `i` … `a;m` `a.h`）
   *   子音 consonant      —— 全形、**帶隱含 a**（`ka` `kha` … `k.sa`）
   *   元音符號 vowel_sign —— 接在子音後面的母音記號與點畫（`aa` `i` … `;m` `.h`）
   *   下加輔音 subjoined  —— **不帶 a**（`k` `kh` … `k.s`）；音節開頭的那一個照樣畫成全形
   *   標點 punct          —— tsheg（兩個空格）、`|` shad、`||` nyis shad、`~` 𑗁、`~~` yig mgo
   * ⭐ **順序是 owner 指定的**〔2026-10-12：「將下加輔音的位置放到元音的前面（兩個位置對調）」〕：
   *    母音 → 子音 → **下加輔音 → 元音符號** → 標點。打一個音節的手順是「不帶 a 的輔音（下加輔音那一組）→ 母音記號與點畫」，
   *    所以下加輔音排在元音符號前面——與 bonji-mobile 把「接續」排在「體文」前面是同一個道理。
   *    ⚠️ 這**不是** data/assist.json 的類別順序（那邊、也就是 tibetan-siddham 桌機版面板，是 元音符號 → 下加輔音）；
   *    下面各組的說明照資料的順序列，切換順序以 KEYSET_IDS 為準。
   * ⚠️ **鍵不寫死在這裡**：每一格的記法與字形在 tibetan-siddham 的 data/assist.json，本 app 那一份是它的
   *    byte-identical 複製件。寫死一份就是第二份真相，那邊改了這裡不會知道。
   *    這裡寫死的只有「收哪幾類、依什麼順序」——assist.json 多一類或少一類而這裡沒跟上時，verify.js 第 ㉔ 條會紅。
   * ⚠️ **子音鍵帶隱含 a**：`ka` 之後再按元音符號 `i` 是 `kai`（ཀཻ），不是 ཀི。要接母音用下加輔音那一組（`k` ＋ `i`）
   *    ——與 tibetan-siddham／bonji 同一個慣例，本 app 不替使用者改寫前一個字。
   * ⚠️ **記法照資料原樣插入、不轉小寫**（bonji-mobile 轉小寫是因為它的來源有一格大寫 `S`）：assist.json 的每一格
   *    在 ISO 15919 與 Kyoto-Harvard 兩種輸入法下是否同字，由 verify.js 第 ③ 條逐一驗——記號列因此只要一套。
   * 類別上的 `carrier`（點圈 ◌）：元音符號與下加輔音是組合字元，單獨畫會浮空 ⇒ 字形前面加載體。
   *    「哪一類要加」寫在資料裡，這裡不判斷碼位範圍（同 tibetan-siddham 的 assist.js）。
   * ⭐ **下加輔音裡的三個固定形插入它們所屬的那個音的記法**〔owner 2026-10-12：ྻ（U+0FBB）＝`y`、ྼ（U+0FBC）＝`r`、ྺ（U+0FBA）＝`v`〕。
   *    資料裡這三格的 `code` 是空的（轉換器打不出固定形；tibetan-siddham 桌機版面板因此標成不可插入），而 `alt` 寫著它是哪個音的異體
   *    ⇒ **沒有 `code` 的格用 `alt` 當記法**，並標 `variant: true`。這是本 app 的決定，資料（複製件）沒有動。
   *    ⚠️ `variant` 的鍵：按下去插入的記法轉出來的是**一般的下加形**（`y` → ྱ），不是鍵上畫的固定形——鍵上的字形是用來認的。
   *    **不去重**：同一個記法因此有兩顆鍵（ྱ 與 ྻ 都是 `y`），同 bonji-mobile 的上／下接續（一個字形一顆鍵）。
   * 既沒有 `code` 也沒有 `alt` 的格（現在 0 格）：`ins` 是空字串，鍵照樣在，按下去只出提示、不插入任何東西。 */
  var KEYSET_IDS = ['vowel', 'consonant', 'subjoined', 'vowel_sign', 'punct'];

  function keysFromAssist(assist, id) {
    var cats = assist && assist.categories;
    if (!Array.isArray(cats) || KEYSET_IDS.indexOf(id) < 0) return [];
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i] && cats[i].id === id) { cat = cats[i]; break; }
    if (!cat || !Array.isArray(cat.entries)) return [];
    var carrier = typeof cat.carrier === 'string' ? cat.carrier : '';
    var out = [];
    cat.entries.forEach(function (e) {
      if (!e || typeof e.code !== 'string' || typeof e.char !== 'string') return;
      // 沒有 code 的格（固定形）用 alt 當記法〔owner 2026-10-12〕；variant＝鍵上的字形不是這個記法轉出來的那個字
      var variant = !e.code && typeof e.alt === 'string' && !!e.alt;
      var ins = variant ? e.alt : e.code;
      // label：鍵上印的字。兩個空格看不見 ⇒ 資料給它一個可見的標示（␣␣）；沒有記法的格印一個中點
      var label = typeof e.label === 'string' && e.label ? e.label : (ins || '·');
      out.push({ ins: ins, glyph: carrier + e.char, label: label, variant: variant });
    });
    return out;
  }

  function normalizeKeyset(id) {
    return KEYSET_IDS.indexOf(id) >= 0 ? id : KEYSET_IDS[0];
  }

  /* ---------- 插入 ----------
   * 取代選取範圍（沒有選取時 s === e，即插在游標處）。超出範圍的索引夾回 [0, len]，
   * s > e 時對調——呼叫端讀 selectionStart/End 本來就保證 s ≤ e，這是防守。 */
  function insertAt(value, s, e, text) {
    value = String(value == null ? '' : value);
    text = String(text == null ? '' : text);
    var n = value.length;
    s = clamp(toInt(s, n), 0, n);
    e = clamp(toInt(e, s), 0, n);
    if (s > e) { var t = s; s = e; e = t; }
    return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
  }

  /* ---------- 可見範圍 ----------
   * m = { vvHeight, vvTop, innerHeight }（visualViewport 的高度與 offsetTop、window.innerHeight）。
   * - 有 visualViewport：外殼貼齊它（iOS Safari 鍵盤彈出時**不縮** layout viewport，
   *   還會把頁面往上推 vvTop——只看 innerHeight 的話，下半截正好被鍵盤蓋住）。
   * - 沒有：退回 innerHeight、top 0。
   * 高度取整數並至少 1：0 或負值會讓整個外殼消失，比「高度不準」糟得多。 */
  function shellBox(m) {
    m = m || {};
    var h = num(m.vvHeight);
    var top = num(m.vvTop);
    if (!(h > 0)) { h = num(m.innerHeight); top = 0; }
    if (!(h > 0)) return null;
    return { top: Math.max(0, Math.round(top || 0)), height: Math.max(1, Math.round(h)) };
  }

  // 「鍵盤開著」＝可見高度比沒有鍵盤時的基準少了一大截。
  // 門檻 120px：網址列收合／展開只差約 50–80px，不可以被當成鍵盤。
  var KEYBOARD_MIN = 120;
  function keyboardOpen(baseline, height) {
    baseline = num(baseline); height = num(height);
    if (!(baseline > 0) || !(height > 0)) return false;
    return baseline - height >= KEYBOARD_MIN;
  }

  /* ---------- 選項與草稿（從 localStorage 讀回來的，一律當成不可信） ---------- */
  var DEFAULT_OPTIONS = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  var ALLOWED = { inputMethod: ['ISO15919', 'KH'], transliteration: ['ISO15919', 'IAST'] };

  function normalizeOptions(o) {
    o = (o && typeof o === 'object') ? o : {};
    return {
      inputMethod: ALLOWED.inputMethod.indexOf(o.inputMethod) >= 0 ? o.inputMethod : DEFAULT_OPTIONS.inputMethod,
      transliteration: ALLOWED.transliteration.indexOf(o.transliteration) >= 0 ? o.transliteration : DEFAULT_OPTIONS.transliteration,
      ignoreSpacesAndHyphens: typeof o.ignoreSpacesAndHyphens === 'boolean'
        ? o.ignoreSpacesAndHyphens : DEFAULT_OPTIONS.ignoreSpacesAndHyphens
    };
  }

  function normalizeDraft(d) {
    d = (d && typeof d === 'object') ? d : {};
    return { input: typeof d.input === 'string' ? d.input : '', options: normalizeOptions(d.options) };
  }

  /* ---------- 紀錄清單與 JSON 輸出 ----------
   * 一筆紀錄＝「標題＋當時的輸入＋當時的三個選項」；清單依加入的順序排。
   * ⭐ **標題可以重複、也可以是空的**〔bonji-mobile，owner 2026-10-11〕：一部咒語分好幾段記，每一段都掛同一個標題
   *    ⇒ 標題**不是鍵**。加入時不查重、不覆寫、不合併；分得開同名各段的是順序（輸出的 `part`）。
   * ⭐ **輸出不落地**：清單只存 input 與 options，藏文／拉丁／碼位在列清單與輸出 JSON 的當下由轉換器算出來
   *    ——存一份的話，轉換核心（tibetan-siddham 的複製件）改版之後清單裡會留著舊結果，而畫面上看不出來。
   * `input` 是**原樣**（打了什麼就是什麼，載回輸入框時逐字相同）。 */
  function normalizeTitle(t) {
    return typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
  }

  /* 類型〔owner 2026-10-13〕：這一筆是什麼——「真言／種子字／…」。**自由文字**〔owner 選的；另一案是固定選單〕：
   * 詞彙由使用的人用出來，不必先定清單、之後加新的類型不必改程式。單行，正規化同標題；空的是合法的（舊紀錄都沒有這一欄）。
   * 快選鈕上的詞＝預設的 ＋ 清單裡已經用過的（依第一次出現的順序）——打過一次的類型下一次用點的，不必再打，也比較不會打出兩種寫法。
   * ⚠️ 預設的詞是**資料的值**（會原樣存進紀錄與 JSON），不是介面文案——不跟著語言切換。 */
  function normalizeType(t) { return normalizeTitle(t); }
  var TYPE_PRESETS = ['真言', '種子字'];
  function typeChoices(items) {
    var seen = {}, out = [];
    function add(t) {
      t = normalizeType(t);
      if (!t || seen['t:' + t]) return;
      seen['t:' + t] = true;
      out.push(t);
    }
    TYPE_PRESETS.forEach(add);
    (Array.isArray(items) ? items : []).forEach(function (it) { if (it) add(it.type); });
    return out;
  }

  /* 來源〔owner 2026-10-13〕：這一筆資料出自哪裡（經號、頁碼、網址…），多行的自由文字。
   * 換行統一成 \n、去掉頭尾空白；不是字串當成空的。**空的是合法的**（舊紀錄都沒有這一欄）——三值語意裡它一律落在 ''。 */
  function normalizeSource(s) {
    return typeof s === 'string' ? s.replace(/\r\n?/g, '\n').trim() : '';
  }

  // input 全是空白＝沒有東西可記 ⇒ null（呼叫端據此講「沒有可加入的內容」，不加一筆空的）
  // savedAt＝這一筆內容記下的那一刻（ISO 字串，由呼叫端給）；取代一筆時是取代的那一刻，不是它最初加入的時間
  // id／order：沒給或不合格時是 ''／0（由控制器在加入的那一刻補上）。id 只收文件路徑容得下的字元。
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function makeRecord(title, input, options, savedAt, id, order, source, type) {
    if (typeof input !== 'string' || !input.trim()) return null;
    return {
      title: normalizeTitle(title),
      type: normalizeType(type),
      source: normalizeSource(source),
      input: input,
      options: normalizeOptions(options),
      savedAt: typeof savedAt === 'string' ? savedAt : '',
      id: typeof id === 'string' && ID_RE.test(id) ? id : '',
      order: typeof order === 'number' && isFinite(order) ? order : 0
    };
  }

  // 讀回來的清單：不是陣列當成空的；壞掉的那幾筆丟掉、其餘留著（一筆壞掉不該賠上整份）
  function normalizeStore(s) {
    s = (s && typeof s === 'object') ? s : {};
    var items = [];
    (Array.isArray(s.items) ? s.items : []).forEach(function (r) {
      var rec = r && typeof r === 'object' ? makeRecord(r.title, r.input, r.options, r.savedAt, r.id, r.order, r.source, r.type) : null;
      if (rec) items.push(rec);
    });
    return { title: normalizeTitle(s.title), items: items };
  }

  /* 儲存區裡的清單（原始字串）與「這個畫面上次讀到／寫下的那一份」比：
   *   same    —— 沒人動過，照記憶裡的做
   *   changed —— 別的畫面（另一個分頁、另一個還開著的畫面）改過 ⇒ **以儲存區為準**，不可以拿記憶裡那份舊的蓋回去
   *   lost    —— 我們寫過、現在讀不到（儲存區不可靠）⇒ 留著記憶裡的，不可以當成「清單被清空了」
   * ⚠️〔bonji-mobile 2026-10-11 實際發生〕第一版把標題與清單存在同一格、每次整格重寫——一個比較舊的畫面只要改一下標題
   *    （或只是關掉面板），就把別處後來記的紀錄全部蓋掉。 */
  function storeDrift(lastRaw, nowRaw) {
    if (nowRaw === lastRaw) return 'same';
    if (typeof nowRaw !== 'string') return 'lost';
    return 'changed';
  }

  // 新的一筆排在現有每一筆之後：取「現在」與「目前最大的 order ＋ 1」較大的那個（兩台裝置的時鐘不必一致）
  function nextOrder(items, now) {
    var max = 0;
    (Array.isArray(items) ? items : []).forEach(function (it) { if (it && it.order > max) max = it.order; });
    return Math.max(typeof now === 'number' && isFinite(now) ? now : 0, max + 1);
  }

  /* Artifacts 版：清單住在 artifact 的資料庫裡，**一筆一份文件**（不是一整份清單一份文件——那就是 家族 CHANGELOG v2.181 的整格重寫）。
   * 畫面上的清單＝遠端送來的那一份 ⊕ 這個畫面已經送出、還沒被確認的寫入：
   *   put —— { id: rec }：加入／取代，遠端還沒有（或還是舊的）也先照新的顯示
   *   del —— { id: true }：刪除，遠端還有也先不顯示
   * 依 order 排，同值時依 id（兩台裝置看到的順序才會一樣）。不改傳進來的東西。 */
  function mergeRemote(remote, put, del) {
    put = put || {}; del = del || {};
    var byId = {}, ids = [];
    (Array.isArray(remote) ? remote : []).forEach(function (it) {
      if (!it || !it.id || del[it.id] || byId[it.id]) return;
      byId[it.id] = it; ids.push(it.id);
    });
    Object.keys(put).forEach(function (id) {
      if (del[id] || !put[id]) return;
      if (!byId[id]) ids.push(id);
      byId[id] = put[id];
    });
    return ids.map(function (id) { return byId[id]; }).sort(function (a, b) {
      return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function addRecord(items, rec) {
    return rec ? items.concat([rec]) : items.slice();
  }

  // 取代第 i 筆（位置不變——分段的順序就是資料）；i 不在範圍內就原樣回一份
  function replaceRecord(items, i, rec) {
    var out = items.slice();
    if (rec && i >= 0 && i < out.length && Math.floor(i) === i) out[i] = rec;
    return out;
  }

  function removeRecord(items, i) {
    return items.filter(function (_, k) { return k !== i; });
  }

  // 以 id 找那一筆現在在第幾格（找不到回 -1）。編輯表單開著的期間清單可能被別處換過——序號不可靠，id 才是那一筆
  function indexOfId(items, id) {
    var list = Array.isArray(items) ? items : [];
    if (typeof id !== 'string' || !id) return -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i;
    return -1;
  }

  /* 編輯某一筆〔owner 2026-10-13〕：改的是那一筆**自己的**標題／輸入／選項；身分（id）與位置（order）沿用。
   *   沒有任何更動 ⇒ 回**原來那個物件**（呼叫端據此不寫入——沒改的那一筆，savedAt 不該變成今天）
   *   輸入被清空   ⇒ null（一筆紀錄不可以沒有內容；要拿掉它是「刪除」那顆鈕的事，不是編輯的副作用）
   * 不改傳進來的東西。 */
  function editRecord(orig, title, input, options, savedAt, source, type) {
    if (!orig || typeof orig !== 'object') return null;
    // source／type 沒給（undefined）＝這次不改它，沿用原來的；給了 '' 才是清掉
    var rec = makeRecord(title, input, options, savedAt, orig.id, orig.order,
      source === undefined ? orig.source : source, type === undefined ? orig.type : type);
    if (!rec) return null;
    var same = rec.title === orig.title && rec.input === orig.input &&
      rec.source === normalizeSource(orig.source) && rec.type === normalizeType(orig.type) &&
      JSON.stringify(rec.options) === JSON.stringify(normalizeOptions(orig.options));
    return same ? orig : rec;
  }

  /* convert(input, options) → { tibetan, latin, codepoints }（控制器包 TibetanSiddhamConverter；lib 不 import 它）。
   * seq＝在整份清單裡第幾筆；part＝**同一個標題**裡第幾段（標題重複時靠它分段）。
   * ⭐ **輸出沒有悉曇**〔owner 2026-10-12〕：藏文梵字的組字與悉曇的組字並不是一一對應，並排反而造成混淆
   *    ⇒ 本 app 整支不處理悉曇（畫面與 JSON 都沒有）。要悉曇用 bonji-mobile。
   *    `codepoints` 是**藏文那一欄**的碼位（同 tibetan-siddham 畫面上的「Unicode 碼位」）。
   * ⚠️ 某一筆轉換丟例外：那一筆 `output: null` 並帶 `error`——不整份失敗，也不安靜地少一筆。 */
  function buildExport(items, convert, exportedAt) {
    var seen = {};
    var records = (Array.isArray(items) ? items : []).map(function (it, i) {
      var key = 't:' + it.title;
      seen[key] = (seen[key] || 0) + 1;
      var rec = {
        seq: i + 1,
        part: seen[key],
        title: it.title,
        type: normalizeType(it.type),
        source: normalizeSource(it.source),
        options: it.options,
        input: it.input,
        output: null,
        savedAt: it.savedAt
      };
      try {
        var r = convert(it.input, it.options);
        rec.output = { tibetan: r.tibetan, latin: r.latin, codepoints: r.codepoints };
      } catch (e) {
        rec.error = String((e && e.message) || e);
      }
      return rec;
    });
    return { app: 'tibetan-siddham-mobile', exportedAt: exportedAt, count: records.length, records: records };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // 下載檔名：家族慣例的 yyyyMMddHHmmss（本地時間）
  function exportFilename(d) {
    return 'tibetan-siddham-mobile-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.json';
  }

  /* ---------- 小工具 ---------- */
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : NaN; }
  function toInt(x, dflt) { return typeof x === 'number' && isFinite(x) ? Math.floor(x) : dflt; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  root.TibetanSiddhamMobileLib = {
    KEYSET_IDS: KEYSET_IDS,
    KEYBOARD_MIN: KEYBOARD_MIN,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    keysFromAssist: keysFromAssist,
    normalizeKeyset: normalizeKeyset,
    insertAt: insertAt,
    shellBox: shellBox,
    keyboardOpen: keyboardOpen,
    normalizeOptions: normalizeOptions,
    normalizeDraft: normalizeDraft,
    normalizeTitle: normalizeTitle,
    normalizeSource: normalizeSource,
    normalizeType: normalizeType,
    TYPE_PRESETS: TYPE_PRESETS,
    typeChoices: typeChoices,
    makeRecord: makeRecord,
    normalizeStore: normalizeStore,
    storeDrift: storeDrift,
    nextOrder: nextOrder,
    mergeRemote: mergeRemote,
    addRecord: addRecord,
    replaceRecord: replaceRecord,
    removeRecord: removeRecord,
    indexOfId: indexOfId,
    editRecord: editRecord,
    buildExport: buildExport,
    exportFilename: exportFilename
  };
})(typeof window !== 'undefined' ? window : globalThis);
