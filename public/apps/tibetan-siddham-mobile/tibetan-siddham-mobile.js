/**
 * tibetan-siddham-mobile — 頁面控制器（glue）。ESM module：天然 defer，執行時 DOM 與所有
 * classic 依賴（jQuery / Materialize / I18n + locales / SideTool / TibetanSiddhamMobileLib）皆已就緒。
 *
 * 唯一的轉換介面是 ./tibetan-siddham-converter.js（TibetanSiddhamConverter 防腐層，tibetan-siddham 的複製件）；
 * 本檔不得直接 import tibetan-core.js 或 vendor/bonji-input/siddham.js。
 * ⚠️ 比 bonji-mobile 多一步：藏文核心要先載對照表（data/tibetan.tsv）⇒ `converter.ready()` 完成之前不轉（state.ready）。
 * ⭐ **只用藏文與拉丁兩種輸出**〔owner 2026-10-12〕：防腐層照樣回悉曇那一欄，本檔不讀它——
 *    藏文梵字的組字與悉曇的組字並不是一一對應，並排反而造成混淆。
 *
 * 碰 DOM 的行為：外殼貼齊可見範圍（fitShell）、即時轉換、記號列、輸入框長高、
 * 選項（bottom-sheet）、複製、主題、語言、工具列開關、草稿保存、紀錄清單與 JSON 輸出。
 */

import { TibetanSiddhamConverter } from "./tibetan-siddham-converter.js";

(function () {
  'use strict';

  var Lib = window.TibetanSiddhamMobileLib;
  var THEME_KEY = 'tibetan-siddham-mobile-theme';
  var TOOLS_KEY = 'tibetan-siddham-mobile-tools';   // 'on' | 'off'；手機上預設 off（側鍵會壓在輸出右緣）
  var DRAFT_KEY = 'tibetan-siddham-mobile-draft';   // { input, options }（TibetanSiddhamMobileLib.normalizeDraft）
  var KEYSET_KEY = 'tibetan-siddham-mobile-keyset'; // KEYSET_IDS 之一（lib）：記號列現在是哪一組
  var REC_KEY = 'tibetan-siddham-mobile-records';   // { items }（TibetanSiddhamMobileLib.normalizeStore）：紀錄清單——**只在增刪改某一筆時寫**
  var REC_TITLE_KEY = 'tibetan-siddham-mobile-rec-title';   // 標題欄現在的值——改標題只寫這一格，碰不到清單
  var REC_SOURCE_KEY = 'tibetan-siddham-mobile-rec-source';   // 來源欄現在的值——同一條規矩：自己一格，碰不到清單
  var REC_TYPE_KEY = 'tibetan-siddham-mobile-rec-type';   // 類型欄現在的值——同上

  var converter = new TibetanSiddhamConverter();
  var setIconDone = window.SideTool.setIconDone;
  var root = document.documentElement;

  var $input = document.getElementById('tsm-input');
  var $keybar = document.getElementById('keybar');
  var $inputMethod = document.getElementById('opt-input-method');
  var $translit = document.getElementById('opt-translit');
  var $ignoreSpaces = document.getElementById('opt-ignore-spaces');
  var $recModal = document.getElementById('records-modal');
  var $recTitle = document.getElementById('rec-title');
  var $recSource = document.getElementById('rec-source');
  var $recType = document.getElementById('rec-type');
  // 編輯某一筆的表單（紀錄面板裡；見「編輯某一筆」那一段）
  var $editTitle = document.getElementById('rec-edit-title');
  var $editInput = document.getElementById('rec-edit-input');
  var $editSource = document.getElementById('rec-edit-source');
  var $editType = document.getElementById('rec-edit-type');
  var $editMethod = document.getElementById('rec-edit-input-method');
  var $editTranslit = document.getElementById('rec-edit-translit');
  var $editIgnore = document.getElementById('rec-edit-ignore-spaces');
  var out = {
    tibetan: document.getElementById('out-tibetan'),
    latin: document.getElementById('out-latin')
  };

  // ready＝藏文對照表載好了（之前不轉）；tableFailed＝載不到時的原因（字串；畫面上要講）
  var state = { theme: 'dark', baseline: 0, saveTimer: 0, keyset: 'vowel', assist: null, assistFailed: false, ready: false, tableFailed: '',
    rec: { title: '', type: '', source: '', items: [] }, recRaw: null, recSaveTimer: 0, recSourceTimer: 0, recTypeTimer: 0, storageOk: true, storageLost: false, storageWarned: false, armed: null, armTimer: 0,
    edit: null,   // 正在編輯的那一筆：{ id, orig, scroll }（沒有在編輯時是 null）
    // 同步（只有 Artifacts 版有，見「同步」那一段）：on＝清單已改由資料庫作主；last＝資料庫送來的那一份；
    // put／del＝這個畫面送出、還沒被確認的寫入；local＝連上之前就在這支瀏覽器裡的（等第一份完整清單到了再決定送不送）
    remote: { started: false, on: false, ready: false, down: '', unsynced: false, migrated: false, last: [], put: {}, del: {}, local: {}, titleTimer: 0, titleSent: null, sourceTimer: 0, sourceSent: null, typeTimer: 0, typeSent: null } };

  /* ---------- 外殼：貼齊可見範圍 ----------
   * iOS Safari 鍵盤彈出時不縮 layout viewport、而且會把頁面往上推；只有 visualViewport
   * 知道「現在真正看得到的是哪一塊」。外殼是 position:fixed，top／height 跟著它走
   * ⇒ 輸入永遠貼在鍵盤上緣、輸出吃掉剩下的高度，整頁不必捲。
   * Android Chrome 有 interactive-widget=resizes-content，兩個 viewport 一起縮，同一套算式也成立。 */
  function fitShell() {
    var vv = window.visualViewport;
    var box = Lib.shellBox({
      vvHeight: vv ? vv.height : NaN,
      vvTop: vv ? vv.offsetTop : NaN,
      innerHeight: window.innerHeight
    });
    if (!box) return;
    root.style.setProperty('--shell-top', box.top + 'px');
    root.style.setProperty('--shell-h', box.height + 'px');
    // 輸入框最多長到外殼的 30%：再高的話輸出會被擠到看不見，那正是這支 app 要避免的
    root.style.setProperty('--input-max', Math.max(46, Math.round(box.height * 0.3)) + 'px');

    // 「鍵盤開著」的基準＝輸入框沒有焦點時量到的高度（那時不可能有鍵盤）
    // ⚠️ 紀錄面板裡的欄位（標題欄、編輯表單的標題與記法）有焦點時鍵盤同樣開著——那時量到的高度不可以拿來當基準
    var focused = document.activeElement === $input;
    if (!focused && !typingInSheet()) state.baseline = box.height;
    document.body.classList.toggle('kb-open', focused && Lib.keyboardOpen(state.baseline, box.height));
    autosize();
  }

  function typingInSheet() {
    var a = document.activeElement;
    return a === $recTitle || a === $recType || a === $recSource || a === $editTitle || a === $editType || a === $editSource || a === $editInput;
  }

  /* ---------- 輸入框長高 ---------- */
  function autosize() {
    // ⚠️ height:auto 會把 scrollTop 歸零：長到上限之後，游標明明在結尾，
    //    畫面卻停在第一行、看不到正在打的字（實測）⇒ 量完要把捲動位置放回去。
    var prev = $input.scrollTop;
    $input.style.height = 'auto';
    // border-box ⇒ 內容高 ＋ 上下框線各 1px
    $input.style.height = ($input.scrollHeight + 2) + 'px';
    $input.scrollTop = $input.selectionEnd === $input.value.length ? $input.scrollHeight : prev;
  }

  /* ---------- 轉換 ---------- */
  function readOptions() {
    return {
      inputMethod: $inputMethod.value,
      transliteration: $translit.value,
      ignoreSpacesAndHyphens: $ignoreSpaces.checked
    };
  }

  function convert() {
    converter.setOptions(readOptions());
    var input = $input.value;
    document.body.classList.toggle('is-empty', !input);
    out.tibetan.classList.remove('out-error');
    if (!input) {
      out.tibetan.textContent = '';
      out.latin.textContent = '';
      renderRecCurrent();
      return;
    }
    if (!state.ready) {
      // 對照表還沒載好：等 init 裡的 ready() 回來再轉一次。載不到的話就把原因寫在藏文欄——
      // 空著的輸出欄與「這段記法轉不出任何字」長得一樣。
      out.latin.textContent = '';
      out.tibetan.textContent = state.tableFailed ? I18n.t('out.tableFail', { m: state.tableFailed }) : '';
      out.tibetan.classList.toggle('out-error', !!state.tableFailed);
      renderRecCurrent();
      return;
    }
    var r;
    try {
      r = converter.convert(input);
    } catch (e) {
      console.error('TibetanSiddhamConverter.convert 失敗：', e);
      M.toast({ html: _esc(I18n.t('toast.convertFail', { m: String(e.message || e) })), classes: 'red' });
      return;
    }
    out.tibetan.textContent = r.tibetan;
    out.latin.textContent = r.latin;
    renderRecCurrent();
    // 游標在結尾（＝正在往後打）時，兩塊輸出都捲到底，剛打的字才看得到（捲的是外層 .out-value）
    if ($input.selectionEnd === input.length) {
      [out.tibetan, out.latin].forEach(function (el) { var box = el.parentNode; box.scrollTop = box.scrollHeight; });
    }
  }

  function onInput() {
    autosize();
    convert();
    saveDraftSoon();
  }

  /* ---------- 記號列（母音 → 子音 → 下加輔音 → 元音符號 → 標點） ----------
   * 鍵由 data/assist.json 推出（tibetan-siddham 輔助輸入面板那一份的複製件；每一格的記法與藏文字形都在資料裡）。
   * 讀不到就在記號列上講出來——空著的記號列與「這支 app 沒有這個功能」長得一樣。 */
  function getJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function loadAssist() {
    return getJson('./data/assist.json')
      .then(function (d) { state.assist = d; })
      .catch(function (e) {
        console.error('assist.json 讀取失敗：', e);
        state.assistFailed = true;
      });
  }

  function renderKeybar() {
    $keybar.textContent = '';
    var keys = Lib.keysFromAssist(state.assist, state.keyset);
    if (!keys.length) {
      if (!state.assist && !state.assistFailed) return;   // 還在讀
      var note = document.createElement('span');
      note.className = 'keybar-note';
      note.textContent = I18n.t('keybar.loadFail');
      $keybar.appendChild(note);
      return;
    }
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      // 沒有記法的格（資料裡既沒有 code 也沒有 alt；現在 0 格——三個固定形自 2026-10-12 起插入 y／r／v，見 lib）：按下去只出提示（bindKeybar）
      b.className = 'key' + (k.ins ? '' : ' key-noinput');
      b.setAttribute('data-ins', k.ins);
      b.setAttribute('aria-label', k.ins ? k.label : I18n.t('keybar.noinput'));
      var g = document.createElement('span');
      g.className = 'key-glyph';
      g.textContent = k.glyph;
      b.appendChild(g);
      var s = document.createElement('span');
      s.className = 'key-ins';
      s.textContent = k.label;
      b.appendChild(s);
      $keybar.appendChild(b);
    });
    $keybar.scrollLeft = 0;
  }

  // 鈕上的字＝記號列現在是哪一組
  function renderKeysetToggle() {
    var btn = document.getElementById('keyset-toggle');
    btn.textContent = I18n.t('keyset.' + state.keyset);
    btn.setAttribute('data-keyset', state.keyset);
  }

  function setKeyset(id) {
    state.keyset = Lib.normalizeKeyset(id);
    try { localStorage.setItem(KEYSET_KEY, state.keyset); } catch (e) {}
    renderKeysetToggle();
    renderKeybar();
  }

  function toggleKeyset() {
    var ids = Lib.KEYSET_IDS;
    setKeyset(ids[(ids.indexOf(state.keyset) + 1) % ids.length]);
  }

  function bindKeybar() {
    // ⚠️ 按鍵不可以把焦點從輸入框搶走——失焦＝鍵盤收起，打一個記號就要重新點輸入框。
    //    mousedown（觸控時是 touchend 之後補發的相容事件）的預設動作就是搬焦點 ⇒ 擋掉它。
    //    不擋 touchstart：那會連記號列的橫向捲動一起擋掉。
    $keybar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.key')) e.preventDefault();
    });
    $keybar.addEventListener('click', function (e) {
      var b = e.target.closest('.key');
      if (!b) return;
      e.preventDefault();
      var ins = b.getAttribute('data-ins');
      if (!ins) {   // 沒有記法的格：不插入任何東西
        M.toast({ html: _esc(I18n.t('keybar.noinput')), classes: 'grey', displayLength: 1800 });
        return;
      }
      insert(ins);
    });
  }

  function insert(text) {
    var r = Lib.insertAt($input.value, $input.selectionStart, $input.selectionEnd, text);
    $input.value = r.value;
    // 先聚焦再放游標：聚焦會把選取範圍重設到別處（iOS）
    if (document.activeElement !== $input) $input.focus();
    try { $input.setSelectionRange(r.caret, r.caret); } catch (e) {}
    onInput();
  }

  /* ---------- 複製 ---------- */
  // host：退回 execCommand 時那個暫用 textarea 掛在哪裡。⚠️ Materialize 的 modal 開著時會把跑到它外面的焦點
  //       搶回自己身上（focus trap）⇒ 掛在 body 上的 textarea 選不住；從 modal 裡複製就傳那個 modal。
  function copyText(text, host) {
    host = host || document.body;
    function fallback() {
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.left = '0';
          ta.style.opacity = '0';
          host.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          host.removeChild(ta);
          ok ? resolve() : reject(new Error('execCommand copy failed'));
        } catch (e) { reject(e); }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
  }

  function copyOutput(key, trigger) {
    var text = out[key] ? out[key].textContent : '';
    if (!text) {
      M.toast({ html: _esc(I18n.t('toast.nothingToCopy')), classes: 'orange' });
      return;
    }
    copyText(text).then(function () {
      setIconDone(trigger);
      M.toast({ html: _esc(I18n.t('toast.copied')), classes: 'teal' });
    }).catch(function () {
      M.toast({ html: _esc(I18n.t('toast.copyFail')), classes: 'red' });
    });
  }

  /* ---------- 清除 ----------
   * 只清輸入；選項留著。清完把焦點放回輸入框（鍵盤若開著就留著，接著打）。
   * 本來就是空的就什麼都不做——不跳一個「已清除」騙人。 */
  function clearInput() {
    if (!$input.value) return;
    $input.value = '';
    onInput();
    setIconDone(document.getElementById('clear-input'));
    M.toast({ html: _esc(I18n.t('toast.inputCleared')), classes: 'grey' });
    $input.focus();
  }

  /* ---------- 草稿（per-viewer 的方便，不是紀錄） ----------
   * 手機瀏覽器會把背景分頁整個丟掉，切回來時輸入就沒了 ⇒ 存一份草稿。
   * ⚠️ localStorage 可能不在、會丟例外、或（iOS 上的 Artifacts 版）寫得進讀不回——
   *    一律 try/catch，讀不回就當沒有草稿，頁面照樣正常。 */
  function saveDraftSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveDraft, 300);
  }
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ input: $input.value, options: readOptions() }));
    } catch (e) {}
  }
  function loadDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
    var d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch (e) {}
    return Lib.normalizeDraft(d);
  }

  /* ---------- 紀錄清單・JSON 輸出 ----------
   * 一筆紀錄＝標題＋類型＋來源＋當時的輸入＋當時的選項（lib 的 makeRecord；類型與來源見下面各自那一段）。**標題可以重複、可以留空**〔bonji-mobile，owner 2026-10-11〕：
   * 一部咒語分好幾段記，每一段掛同一個標題 ⇒ 加入時不查重、不覆寫。
   * 藏文／拉丁／碼位不存：列清單與輸出 JSON 的當下，每一筆用**它自己的**選項現算（convertWith）。
   * ⚠️ 清單存在 localStorage——**那是這支瀏覽器的方便，不是備份**：可能不在、會丟例外、或（iOS 上的 Artifacts 版）
   *    寫得進讀不回。每次存完讀回來比對，對不上就在面板上講出來（不講的話看起來像 app 把清單弄丟了）。
   * ⚠️ 沒有 window.confirm：Artifacts 的 iframe 裡它不跳對話框、直接回 false ⇒ 會毀掉東西的動作
   *    （取代／刪除／全部清除／載回時蓋掉還沒記下的輸入）一律「再按一次」。 */
  // 每一筆各自一個轉換器（不是畫面上那一個——它帶的是「現在」的選項）。對照表是模組層共用的，載過一次就都能轉。
  // 只取藏文與拉丁；碼位是藏文那一欄的（同 tibetan-siddham 畫面上的「Unicode 碼位」）。
  function convertWith(input, options) {
    var r = new TibetanSiddhamConverter(options).convert(input);
    return { tibetan: r.tibetan, latin: r.latin, codepoints: r.codepoints.tibetan };
  }

  function readRaw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  // 舊資料沒有 id／order：id 現給一個，order 照它在清單裡的位置（小數字 ⇒ 排在之後新加的前面）
  function ensureIds(items) {
    items.forEach(function (it, i) { if (!it.id) it.id = newId(); if (!it.order) it.order = i + 1; });
    return items;
  }
  function parseStore(raw) {
    var d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch (e) {}
    var st = Lib.normalizeStore(d);
    ensureIds(st.items);
    return st;
  }

  /* ⚠️⚠️ 標題與清單**分兩格存**，而且各自只在自己被改的時候寫〔bonji-mobile 2026-10-11，owner 回報「清除標題把原來的紀錄也清掉了」〕。
   *    第一版是一格 { title, items }、每次整格重寫：這個畫面記憶裡的清單只要比儲存區舊
   *    （另一個分頁、另一個還開著的畫面後來記了幾筆），在這邊改一下標題、按清除、甚至只是關掉面板，
   *    就把那幾筆全部蓋掉（實測三條路都重現）。⇒ 改標題的路上**沒有任何一行碰得到 REC_KEY**（verify 第 ㉞ 條）。 */
  function loadRecords() {
    var raw = readRaw(REC_KEY);
    var st = parseStore(raw);
    state.recRaw = raw;
    var t = readRaw(REC_TITLE_KEY);
    // 舊格式把標題與清單放在同一格：新的那一格還沒有的時候沿用它
    return { title: t != null ? Lib.normalizeTitle(t) : st.title, type: Lib.normalizeType(readRaw(REC_TYPE_KEY)),
      source: Lib.normalizeSource(readRaw(REC_SOURCE_KEY)), items: st.items };
  }

  /* 動清單之前先看儲存區：別的畫面可能已經改過它。'changed' ⇒ 記憶裡的那一份作廢，改用儲存區的
   * （加入＝接在它後面；取代／刪除／清除的序號可能已經不對 ⇒ 呼叫端停下來、請使用者再確認一次）。
   * 'lost'（我們寫過、現在讀不到）⇒ 儲存區不可靠，留著記憶裡的。 */
  function syncItems() {
    if (remoteOn()) return 'same';   // 清單由資料庫作主：別處的更動由它推過來，不看這支瀏覽器的儲存區
    var raw = readRaw(REC_KEY);
    var drift = Lib.storeDrift(state.recRaw, raw);
    if (drift === 'changed') {
      state.rec.items = parseStore(raw).items;
      state.recRaw = raw;
    }
    if (drift === 'lost') {   // 存得進、讀不回 ⇒ 在面板上講，而且這一場都留著（下一次存成功不代表它之後讀得回）
      state.storageLost = true;
      document.getElementById('rec-storage-note').hidden = false;
    }
    return drift;
  }

  function saveTitle() {
    clearTimeout(state.recSaveTimer);
    try { localStorage.setItem(REC_TITLE_KEY, state.rec.title); } catch (e) {}
  }
  function saveTitleSoon() {
    clearTimeout(state.recSaveTimer);
    state.recSaveTimer = setTimeout(saveTitle, 300);
  }

  /* 來源欄〔owner 2026-10-13〕：面板上標題欄底下那一格，行為照標題欄——加入一筆時帶入它現在的值
   * （同一部咒語分好幾段記，來源只要填一次），每一筆之後可在編輯表單裡各自改。
   * ⚠️ 存法也照標題：**自己一格**（REC_SOURCE_KEY）、只在自己被改時寫；這幾條路上沒有任何一行碰得到清單。 */
  function saveSource() {
    clearTimeout(state.recSourceTimer);
    try { localStorage.setItem(REC_SOURCE_KEY, state.rec.source); } catch (e) {}
  }
  function saveSourceSoon() {
    clearTimeout(state.recSourceTimer);
    state.recSourceTimer = setTimeout(saveSource, 300);
  }

  /* 類型欄〔owner 2026-10-13〕：這一筆是什麼（真言／種子字／…）。自由文字＋快選鈕（lib 的 typeChoices）；
   * 行為與存法照標題欄與來源欄——加入時帶入、**自己一格**（REC_TYPE_KEY）、這幾條路上沒有任何一行碰得到清單。 */
  function saveType() {
    clearTimeout(state.recTypeTimer);
    try { localStorage.setItem(REC_TYPE_KEY, state.rec.type); } catch (e) {}
  }
  function saveTypeSoon() {
    clearTimeout(state.recTypeTimer);
    state.recTypeTimer = setTimeout(saveType, 300);
  }

  // 只有增刪改某一筆的那幾條路（addCurrent／recAction／saveEdit）會走到這裡，而且它們都先 syncItems() 過
  function saveItems() {
    if (remoteOn()) return;   // 同上：這支瀏覽器裡不留第二份（留著的話，別台刪掉的紀錄日後會從這裡被送回去）
    var text = JSON.stringify({ items: state.rec.items });
    var ok = false;
    try { localStorage.setItem(REC_KEY, text); ok = localStorage.getItem(REC_KEY) === text; } catch (e) {}
    if (ok) state.recRaw = text;
    state.storageOk = ok;
    document.getElementById('rec-storage-note').hidden = ok && !state.storageLost;
    // 面板沒開的時候（藏文欄底下那顆加入鈕）使用者看不到面板上那行字 ⇒ 第一次存不住時講一次
    if (!ok && !state.storageWarned && state.rec.items.length) {
      state.storageWarned = true;
      M.toast({ html: _esc(I18n.t('rec.storageFail')), classes: 'orange', displayLength: 6000 });
    }
  }
  // keep：取代某一筆時傳它進來——身分（id）與位置（order）沿用，分段的順序就是資料
  function currentRecord(keep) {
    return Lib.makeRecord($recTitle.value, $input.value, readOptions(), new Date().toISOString(),
      keep ? keep.id : newId(), keep ? keep.order : 0, $recSource.value, $recType.value);
  }
  function titleOr(t) { return t || I18n.t('rec.untitled'); }
  function recToast(key, params, cls, ms) {
    M.toast({ html: _esc(I18n.t(key, params)), classes: cls, displayLength: ms || 4000 });
  }

  /* 「再按一次」：第一次按只上膛（鈕變成打勾、toast 講清楚再按一次會發生什麼），4 秒內再按同一顆才執行。 */
  // 上膛記的是「哪一筆」（id）不是第幾筆：同步把清單換過之後，序號可能已經指到別筆
  function armKey(act, i) { var it = state.rec.items[i]; return act === 'clear' ? '*' : (it ? it.id : ''); }
  function isArmed(act, i) { return !!state.armed && state.armed.act === act && state.armed.key === armKey(act, i); }
  function disarm() {
    clearTimeout(state.armTimer);
    state.armed = null;
  }
  function arm(act, i, key, params) {
    disarm();
    state.armed = { act: act, key: armKey(act, i) };
    state.armTimer = setTimeout(function () { state.armed = null; renderRecords(); }, 4000);
    renderRecords();
    recToast(key, params, 'orange');
  }

  function addCurrent(trigger) {
    var rec = currentRecord();
    if (!rec) { recToast('rec.toast.nothing', null, 'orange'); return; }
    disarm();
    syncItems();   // 別的畫面記過新的 ⇒ 接在它們後面，不拿這邊舊的那一份蓋回去
    rec.order = Lib.nextOrder(state.rec.items, Date.now());
    state.rec.items = Lib.addRecord(state.rec.items, rec);
    state.rec.title = rec.title;
    state.rec.source = rec.source;
    state.rec.type = rec.type;
    saveItems();
    saveTitle();
    saveSource();
    saveType();
    pushPut(rec);
    pushTitle();
    pushSource();
    pushType();
    renderRecords();
    setIconDone(trigger);
    // 短一點：toast 在頁首上方，停太久會擋住紀錄鈕（加完常常接著就要開面板）
    recToast('rec.toast.added', { n: state.rec.items.length, t: titleOr(rec.title) }, 'teal', 1800);
  }

  function recAction(act, i) {
    // 清單在別的畫面被改過 ⇒ 畫面上的序號可能已經不是同一筆：先換成最新的，這一下不執行
    if (syncItems() === 'changed') {
      disarm();
      renderRecords();
      recToast('rec.toast.changedElsewhere', null, 'orange', 5000);
      return;
    }
    var items = state.rec.items;
    var n = i + 1;
    if (act === 'clear') {
      if (!items.length) return;
      if (!isArmed(act, -1)) { arm(act, -1, 'rec.toast.confirmClear', { n: items.length }); return; }
      disarm();
      state.rec.items = [];
      saveItems();
      items.forEach(function (x) { pushDel(x.id); });
      renderRecords();
      recToast('rec.toast.cleared', { n: items.length }, 'grey');
      return;
    }
    var it = items[i];
    if (!it) return;
    if (act === 'edit') { startEdit(it); return; }
    if (act === 'load') {
      // 輸入框裡有還沒記下、而且與這一筆不同的內容 ⇒ 載回會把它蓋掉，先講一次
      var dirty = !!$input.value.trim() && $input.value !== it.input;
      if (dirty && !isArmed(act, i)) { arm(act, i, 'rec.toast.confirmLoad', { n: n }); return; }
      disarm();
      $recTitle.value = it.title;
      state.rec.title = it.title;
      $recSource.value = it.source;   // 來源跟著那一筆回來（之後按取代，來源才不會被面板上別的值換掉）
      state.rec.source = it.source;
      $recType.value = it.type;       // 類型同上
      state.rec.type = it.type;
      $inputMethod.value = it.options.inputMethod;
      $translit.value = it.options.transliteration;
      $ignoreSpaces.checked = it.options.ignoreSpacesAndHyphens;
      $input.value = it.input;
      saveTitle();
      pushTitle();
      saveSource();
      pushSource();
      saveType();
      pushType();
      onInput();
      M.Modal.getInstance($recModal).close();
      recToast('rec.toast.loaded', { n: n, t: titleOr(it.title) }, 'teal');
      return;
    }
    if (act === 'replace') {
      var rec = currentRecord(it);
      if (!rec) { recToast('rec.toast.nothing', null, 'orange'); return; }
      if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmReplace', { n: n }); return; }
      disarm();
      state.rec.items = Lib.replaceRecord(items, i, rec);
      state.rec.title = rec.title;
      state.rec.source = rec.source;
      state.rec.type = rec.type;
      saveItems();
      saveTitle();
      saveSource();
      saveType();
      pushPut(rec);
      pushTitle();
      pushSource();
      pushType();
      renderRecords();
      recToast('rec.toast.replaced', { n: n }, 'teal');
      return;
    }
    if (act === 'remove') {
      if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmRemove', { n: n }); return; }
      disarm();
      state.rec.items = Lib.removeRecord(items, i);
      saveItems();
      pushDel(it.id);
      renderRecords();
      recToast('rec.toast.removed', { n: n }, 'grey');
    }
  }

  // 只清標題欄（清單裡已經記下的各筆不動）。本來就是空的就什麼都不做——不跳一個「已清除」騙人（同 clearInput）
  function clearTitle(trigger) {
    if (!$recTitle.value) return;
    $recTitle.value = '';
    state.rec.title = '';
    saveTitle();
    pushTitle();
    setIconDone(trigger);
    recToast('rec.toast.titleCleared', null, 'grey', 1800);
  }

  // 只清來源欄（清單裡已經記下的各筆不動；標題欄也不動——換一部咒語時兩顆各按一次）
  function clearSource(trigger) {
    if (!$recSource.value) return;
    $recSource.value = '';
    state.rec.source = '';
    grow($recSource);
    saveSource();
    pushSource();
    setIconDone(trigger);
    recToast('rec.toast.sourceCleared', null, 'grey', 1800);
  }

  // 面板上的類型欄換成 v（打字、點快選鈕、清除都走這裡）：只寫類型那一格
  function setPanelType(v, soon) {
    state.rec.type = Lib.normalizeType(v);
    if (soon) { saveTypeSoon(); pushTypeSoon(); } else { saveType(); pushType(); }
    renderTypeChips();
  }
  // 只清類型欄（清單裡已經記下的各筆、標題欄、來源欄都不動）
  function clearType(trigger) {
    if (!$recType.value) return;
    $recType.value = '';
    setPanelType('');
    setIconDone(trigger);
    recToast('rec.toast.typeCleared', null, 'grey', 1800);
  }

  // 快選鈕（面板上與編輯表單裡各一排，.rec-chips[data-for=<那一格的 id>]）：詞由 lib 給，亮著的那一顆＝那一格現在的值
  function renderTypeChips() {
    var choices = Lib.typeChoices(state.rec.items);
    $recModal.querySelectorAll('.rec-chips').forEach(function (box) {
      var cur = Lib.normalizeType(document.getElementById(box.getAttribute('data-for')).value);
      box.textContent = '';
      choices.forEach(function (t) {
        var b = node('button', 'rec-chip' + (t === cur ? ' active' : ''), t);
        b.type = 'button';
        b.setAttribute('data-type', t);
        box.appendChild(b);
      });
    });
  }

  // 面板上「目前的輸入」那一格＝按「加入清單」會記下的那一段（空的時候加入鈕停用）
  function renderRecCurrent() {
    var box = document.getElementById('rec-current');
    var has = !!$input.value.trim();
    // 藏文欄正在顯示「對照表載不到」時，那不是輸出，不搬過來（輸入本身仍然可以加入清單）
    var shown = has && !out.tibetan.classList.contains('out-error');
    box.textContent = shown ? out.tibetan.textContent : I18n.t('rec.currentEmpty');
    box.classList.toggle('tibetan-text', shown);
    box.classList.toggle('is-empty', !shown);
    document.getElementById('rec-add').classList.toggle('disabled', !has);
  }

  function node(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function recButton(act, i, icon, titleKey, danger) {
    var armed = isArmed(act, i);
    var a = node('a', 'rec-btn' + (danger ? ' rec-danger' : '') + (armed ? ' armed' : ''));
    a.href = '#!';
    a.setAttribute('data-act', act);
    a.setAttribute('data-i', String(i));
    a.setAttribute('title', I18n.t(titleKey));
    a.setAttribute('aria-label', I18n.t(titleKey));
    a.appendChild(node('i', 'material-icons', armed ? 'check' : icon));
    return a;
  }

  // JSON 輸出的文字：畫面上那一份＝複製／下載的那一份（每次現算，exportedAt 是那一刻）。清單是空的回 ''。
  function refreshJson() {
    var exp = Lib.buildExport(state.rec.items, convertWith, new Date().toISOString());
    var text = exp.count ? JSON.stringify(exp, null, 2) : '';
    var pre = document.getElementById('rec-json');
    pre.textContent = text || I18n.t('rec.jsonEmpty');
    pre.classList.toggle('is-empty', !text);
    return { exp: exp, text: text };
  }

  function renderRecords() {
    var items = state.rec.items;
    var badge = document.getElementById('rec-count');
    badge.textContent = items.length ? String(items.length) : '';
    badge.hidden = !items.length;
    document.getElementById('rec-list-title').textContent = I18n.t('rec.list', { n: items.length });

    var clearBtn = document.getElementById('rec-clear');
    clearBtn.hidden = !items.length;
    clearBtn.classList.toggle('armed', isArmed('clear', -1));
    clearBtn.querySelector('i').textContent = isArmed('clear', -1) ? 'check' : 'delete_sweep';

    var list = document.getElementById('rec-list');
    // 藏文對照表還在載：每一筆都要現算，這時算只會得到一整排「轉換失敗」⇒ 先講「載入中」，載好了 init 會再畫一次。
    // （載不到的話照常往下畫：每一筆都寫出轉不出來的原因，那是實情。）
    if (!state.ready && !state.tableFailed) {
      list.textContent = '';
      list.appendChild(node('li', 'rec-empty', I18n.t('rec.loading')));
      renderRecCurrent();
      renderRecNote();
      return;
    }

    var exp = refreshJson().exp;
    var total = {};   // 同一個標題共有幾段——只有一段的不必標「第 1 段」
    exp.records.forEach(function (r) { total['t:' + r.title] = (total['t:' + r.title] || 0) + 1; });

    list.textContent = '';
    if (!items.length) {
      list.appendChild(node('li', 'rec-empty', I18n.t('rec.empty')));
    }
    exp.records.forEach(function (r, i) {
      var li = node('li', 'rec-item');
      var main = node('a', 'rec-main' + (isArmed('load', i) ? ' armed' : ''));
      main.href = '#!';
      main.setAttribute('data-act', 'load');
      main.setAttribute('data-i', String(i));
      main.setAttribute('title', I18n.t('rec.load'));
      var head = node('span', 'rec-head');
      head.appendChild(node('span', 'rec-seq', String(r.seq)));
      head.appendChild(node('span', 'rec-name' + (r.title ? '' : ' is-empty'), titleOr(r.title)));
      if (total['t:' + r.title] > 1) head.appendChild(node('span', 'rec-part', I18n.t('rec.part', { p: r.part })));
      if (r.type) head.appendChild(node('span', 'rec-type', r.type));
      main.appendChild(head);
      // 轉不出來的那一筆把原因寫在原本放藏文的那一行——不留白
      main.appendChild(r.output
        ? node('span', 'rec-tib', r.output.tibetan)
        : node('span', 'rec-err', I18n.t('toast.convertFail', { m: r.error || '' })));
      // 記法裡的連續空格有意義（兩個＝tsheg、三個＝全形空格）⇒ 這一行以 white-space:pre 顯示；換行改畫成 ↵，維持單行
      main.appendChild(node('span', 'rec-in mono', r.input.replace(/\n/g, ' ↵ ')));
      // 有來源的那一筆多一行（單行、截斷；全文在編輯表單裡看）
      if (r.source) main.appendChild(node('span', 'rec-src', I18n.t('rec.sourceLine', { s: r.source.replace(/\s*\n\s*/g, '／') })));
      li.appendChild(main);
      li.appendChild(recButton('edit', i, 'edit', 'rec.edit', false));
      li.appendChild(recButton('replace', i, 'system_update_alt', 'rec.replace', false));
      li.appendChild(recButton('remove', i, 'delete', 'rec.remove', true));
      list.appendChild(li);
    });
    renderRecCurrent();
    renderRecNote();
    renderEditChrome();
    renderTypeChips();   // 清單變了，用過的類型也跟著變
  }

  /* ---------- 編輯某一筆〔owner 2026-10-13〕 ----------
   * 清單上每一筆多一顆 ✎：面板換成那一筆的表單（標題／記法／三個選項＋即時的轉換結果），存回**同一筆**（id、位置不變）。
   * ⭐ 不經過主畫面：輸入框、標題欄、畫面上的選項一個都不動——那邊正在打的下一段不會被蓋掉
   *    （原本的路是「載回 → 改 → 再開面板按取代」，載回那一步就會蓋掉它）。
   * ⚠️ 編輯中唯一的出口是 儲存／取消：點面板外面不關（dismissible 先關掉）、「完成」收起來——
   *    否則按它會被讀成「存好了」，而打的字就那樣不見。取消時有還沒存的更動 ⇒「再按一次」（同刪除）。
   * ⚠️ 認的是「哪一筆」（id）不是第幾筆：表單開著的期間，別處可能刪掉前面幾筆（同步）。
   * ⚠️ 這是第三條會寫清單的路 ⇒ 與另外兩條一樣先 syncItems()；只寫那一筆自己，標題欄那一格不碰。 */
  function readEditOptions() {
    return {
      inputMethod: $editMethod.value,
      transliteration: $editTranslit.value,
      ignoreSpacesAndHyphens: $editIgnore.checked
    };
  }
  // 表單現在的內容算成一筆：沒有更動＝回 orig 本身、記法被清空＝null（lib 的 editRecord）
  function editDraft(savedAt) {
    return Lib.editRecord(state.edit.orig, $editTitle.value, $editInput.value, readEditOptions(), savedAt, $editSource.value, $editType.value);
  }

  // textarea 跟著內容長高（面板裡那三格共用）。⚠️ 面板沒顯示時 scrollHeight 是 0——那時由 CSS 的 min-height 兜底，開面板時再量一次
  function grow(el) {
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';   // border-box ⇒ 內容高 ＋ 上下框線
  }
  function autosizeEdit() {
    grow($editInput);
    grow($editSource);
  }

  // 轉換結果跟著表單走（用表單上的選項，不是畫面上的）。轉不出來把原因寫在同一格——不留白
  function renderEditPreview() {
    var main = document.getElementById('rec-edit-out'), lat = document.getElementById('rec-edit-latin');
    var input = $editInput.value;
    main.classList.remove('is-error');
    if (!input.trim()) { main.textContent = ''; lat.textContent = I18n.t('rec.currentEmpty'); return; }
    try {
      var r = convertWith(input, Lib.normalizeOptions(readEditOptions()));
      main.textContent = r.tibetan;
      lat.textContent = r.latin;
    } catch (e) {
      main.textContent = I18n.t('toast.convertFail', { m: String((e && e.message) || e) });
      main.classList.add('is-error');
      lat.textContent = '';
    }
  }

  // 面板現在是清單還是表單、表單的抬頭、取消鈕有沒有上膛——都由 state 推出來（renderRecords 的最後一步）
  function renderEditChrome() {
    var ed = state.edit;
    $recModal.classList.toggle('is-editing', !!ed);
    if (!ed) return;
    var i = Lib.indexOfId(state.rec.items, ed.id);
    document.getElementById('rec-edit-heading').textContent =
      i >= 0 ? I18n.t('rec.editHeading', { n: i + 1 }) : I18n.t('rec.editGone');
    var armed = isArmed('editCancel', i);
    $recModal.querySelectorAll('[data-edit="cancel"]').forEach(function (a) { a.classList.toggle('armed', armed); });
  }

  function startEdit(it) {
    disarm();
    var box = $recModal.querySelector('.modal-content');
    state.edit = { id: it.id, orig: it, scroll: box.scrollTop };
    $editTitle.value = it.title;
    $editType.value = it.type;
    $editSource.value = it.source;
    $editInput.value = it.input;
    $editMethod.value = it.options.inputMethod;
    $editTranslit.value = it.options.transliteration;
    $editIgnore.checked = it.options.ignoreSpacesAndHyphens;
    M.Modal.getInstance($recModal).options.dismissible = false;
    renderRecords();
    renderEditPreview();
    box.scrollTop = 0;
    autosizeEdit();   // 要在表單顯示出來之後量（display:none 時 scrollHeight 是 0）
  }

  // 離開表單（存了、取消了、或面板被關掉）。回到清單時捲回剛才那一筆的位置
  function endEdit() {
    var ed = state.edit;
    if (!ed) return;
    state.edit = null;
    $editTitle.blur();
    $editInput.blur();
    $editSource.blur();
    $editType.blur();
    M.Modal.getInstance($recModal).options.dismissible = true;
    disarm();
    renderRecords();
    $recModal.querySelector('.modal-content').scrollTop = ed.scroll;
  }

  function saveEdit() {
    var ed = state.edit;
    if (!ed) return;
    // 清單在別的畫面被改過 ⇒ 先換成最新的，這一下不執行（表單與裡面打的字都留著）
    if (syncItems() === 'changed') {
      disarm();
      renderRecords();
      recToast('rec.toast.changedElsewhere', null, 'orange', 5000);
      return;
    }
    var i = Lib.indexOfId(state.rec.items, ed.id);
    // 那一筆已經在別處被刪掉：存回去等於把它加回來——不做，表單留著（裡面的字還抄得出來）
    if (i < 0) { recToast('rec.toast.editGone', null, 'orange', 6000); return; }
    var rec = editDraft(new Date().toISOString());
    if (!rec) { recToast('rec.toast.editEmpty', null, 'orange'); return; }
    if (rec === ed.orig) {   // 沒有更動：不寫入（savedAt 不該變成今天）
      endEdit();
      recToast('rec.toast.editSame', null, 'grey', 1800);
      return;
    }
    state.rec.items = Lib.replaceRecord(state.rec.items, i, rec);
    saveItems();
    pushPut(rec);
    endEdit();
    recToast('rec.toast.edited', { n: i + 1 }, 'teal');
  }

  function cancelEdit() {
    var ed = state.edit;
    if (!ed) return;
    var i = Lib.indexOfId(state.rec.items, ed.id);
    if (editDraft('') !== ed.orig && !isArmed('editCancel', i)) { arm('editCancel', i, 'rec.toast.confirmDiscard'); return; }
    endEdit();
  }

  /* ---------- 同步：清單住在 artifact 的資料庫裡（只有 Artifacts 版有） ----------
   * 〔bonji-mobile 2026-10-11，owner 實測〕iPhone 的 Claude App 把 artifact 關掉重開，localStorage 裡的清單就讀不回來——
   * 清單不能只放在瀏覽器裡。Artifacts 版多載一支 `remote-db.js`（artifact/src/，由 build.py 帶進去），
   * 它把 `window.TibetanSiddhamMobileRemote` 掛上來；GitHub／3001 那一份沒有它，下面整段都不會動，清單照舊存 localStorage。
   * ⭐ 資料庫裡**一筆一份文件**（文件名＝那一筆的 id）：加入／取代／刪除各自只碰自己那一份，
   *    沒有「整份清單寫回去」這個動作 ⇒ 兩台裝置同時記也不會互相蓋掉（家族 CHANGELOG v2.181 那個坑在這裡結構上不存在）。
   * 畫面上的清單＝資料庫送來的（last）⊕ 這個畫面送出、還沒被確認的寫入（put／del），見 lib 的 mergeRemote。 */
  function remoteOn() { return state.remote.on; }

  function startRemote() {
    var R = window.TibetanSiddhamMobileRemote, rm = state.remote;
    if (!R || rm.started) return;
    rm.started = true;
    renderRecNote();
    R.start({
      onReady: function () {
        // 從這一刻起清單由資料庫作主。這支瀏覽器裡原本有的（載入後、連上前記下的也算）先留在畫面上，
        // 等第一份完整的清單到了，再決定哪幾筆要送上去（migrateLocal）
        rm.on = true;
        state.rec.items.forEach(function (it) { rm.local[it.id] = it; });
        renderRecNote();
      },
      onItems: function (list, definitive) {
        rm.ready = true;
        rm.last = Lib.normalizeStore({ items: list }).items;   // 資料庫來的一樣走白名單
        applyRemote();
        // 不在這個回呼裡寫資料庫（回呼裡寫＝每來一份就寫一次的迴圈）：排到下一輪，而且只做一次
        if (definitive && !rm.migrated) { rm.migrated = true; setTimeout(migrateLocal, 0); }
      },
      onTitle: function (t) {
        t = Lib.normalizeTitle(t);
        rm.titleSent = t;
        if (document.activeElement === $recTitle || t === state.rec.title) return;   // 正在打的那一欄不搶
        state.rec.title = t;
        $recTitle.value = t;
        saveTitle();
      },
      onSource: function (s) {
        s = Lib.normalizeSource(s);
        rm.sourceSent = s;
        if (document.activeElement === $recSource || s === state.rec.source) return;   // 正在打的那一欄不搶
        state.rec.source = s;
        $recSource.value = s;
        grow($recSource);
        saveSource();
      },
      onType: function (t) {
        t = Lib.normalizeType(t);
        rm.typeSent = t;
        if (document.activeElement === $recType || t === state.rec.type) return;   // 正在打的那一欄不搶
        state.rec.type = t;
        $recType.value = t;
        saveType();
        renderTypeChips();
      },
      onDown: function (code) {
        rm.down = String(code || 'unavailable');
        renderRecNote();
      }
    });
  }

  function applyRemote() {
    var rm = state.remote, pending = {};
    Object.keys(rm.local).forEach(function (id) { pending[id] = rm.local[id]; });
    Object.keys(rm.put).forEach(function (id) { pending[id] = rm.put[id]; });
    state.rec.items = Lib.mergeRemote(rm.last, pending, rm.del);
    // 上膛的那一筆在別處被刪掉了 ⇒ 解除
    if (state.armed && state.armed.key !== '*' && !state.rec.items.some(function (it) { return it.id === state.armed.key; })) disarm();
    renderRecords();
  }

  // 連上之前就在這支瀏覽器裡的紀錄：資料庫裡還沒有的送上去；已經有同一筆的以資料庫為準、不送。
  // 全部送成功之後這支瀏覽器裡那一份就拿掉——留著的話，日後在別台刪掉的紀錄會從這裡被送回去。
  function migrateLocal() {
    var rm = state.remote, have = {}, jobs = [];
    rm.last.forEach(function (it) { have[it.id] = true; });
    Object.keys(rm.local).forEach(function (id) {
      var rec = rm.local[id];
      delete rm.local[id];
      if (!have[id]) jobs.push(pushPut(rec));
    });
    Promise.all(jobs).then(function (oks) {
      if (!oks.every(Boolean)) return;
      try { localStorage.removeItem(REC_KEY); } catch (e) {}
      state.recRaw = null;
    });
    applyRemote();
  }

  // 回傳 Promise<boolean>（存到資料庫了沒）。沒存到的那一筆留在畫面上，並在面板上講。
  function pushPut(rec) {
    var rm = state.remote;
    if (!rm.on) return Promise.resolve(true);
    rm.put[rec.id] = rec;
    delete rm.del[rec.id];
    delete rm.local[rec.id];   // 這一筆已經由這次寫入負責；留著的話 migrateLocal 會拿舊的那一份再送一次
    return window.TibetanSiddhamMobileRemote.put(rec).then(function () {
      if (rm.put[rec.id] !== rec) return true;   // 這一筆在等的期間又被改過，留給後面那一次
      // 確認存到了：把它併進「資料庫那一份」再從待確認拿掉（否則下一份清單送到之前，它會從畫面上消失一下）
      rm.last = rm.last.filter(function (it) { return it.id !== rec.id; }).concat([rec]);
      delete rm.put[rec.id];
      return true;
    }, function (e) { remoteFail(e); return false; });
  }

  function pushDel(id) {
    var rm = state.remote;
    if (!rm.on) return;
    rm.del[id] = true;
    delete rm.put[id];
    delete rm.local[id];
    window.TibetanSiddhamMobileRemote.remove(id).then(function () {
      rm.last = rm.last.filter(function (it) { return it.id !== id; });
      delete rm.del[id];
    }, function (e) {
      delete rm.del[id];   // 沒刪成：資料庫裡還在，畫面上照實放回來
      remoteFail(e);
      applyRemote();
    });
  }

  function remoteFail(e) {
    state.remote.unsynced = true;
    renderRecNote();
    recToast('rec.toast.syncFail', { m: String((e && (e.code || e.message)) || e) }, 'red', 6000);
  }

  // 標題欄的值也同步（換裝置、重開時接著用同一個標題）；值沒變就不寫
  function pushTitle() {
    var rm = state.remote;
    clearTimeout(rm.titleTimer);
    if (!rm.on || rm.titleSent === state.rec.title) return;
    rm.titleSent = state.rec.title;
    window.TibetanSiddhamMobileRemote.setTitle(state.rec.title).then(null, function () { rm.titleSent = null; });
  }
  function pushTitleSoon() {
    clearTimeout(state.remote.titleTimer);
    if (state.remote.on) state.remote.titleTimer = setTimeout(pushTitle, 800);
  }

  // 來源欄的值同上（state/source）；值沒變就不寫
  function pushSource() {
    var rm = state.remote;
    clearTimeout(rm.sourceTimer);
    if (!rm.on || rm.sourceSent === state.rec.source) return;
    rm.sourceSent = state.rec.source;
    window.TibetanSiddhamMobileRemote.setSource(state.rec.source).then(null, function () { rm.sourceSent = null; });
  }
  function pushSourceSoon() {
    clearTimeout(state.remote.sourceTimer);
    if (state.remote.on) state.remote.sourceTimer = setTimeout(pushSource, 800);
  }

  // 類型欄的值同上（state/type）
  function pushType() {
    var rm = state.remote;
    clearTimeout(rm.typeTimer);
    if (!rm.on || rm.typeSent === state.rec.type) return;
    rm.typeSent = state.rec.type;
    window.TibetanSiddhamMobileRemote.setType(state.rec.type).then(null, function () { rm.typeSent = null; });
  }
  function pushTypeSoon() {
    clearTimeout(state.remote.typeTimer);
    if (state.remote.on) state.remote.typeTimer = setTimeout(pushType, 800);
  }

  // 面板底下那一行：清單現在存在哪裡。沒有同步的那一份（GitHub／3001）恆是「只存在這支瀏覽器裡」。
  function renderRecNote() {
    var el = document.getElementById('rec-note'), rm = state.remote;
    var key = 'rec.note', warn = false, params = null;
    if (rm.started) {
      if (rm.down) { key = 'rec.noteDown'; warn = true; params = { m: rm.down }; }
      else if (rm.unsynced) { key = 'rec.noteUnsynced'; warn = true; }
      else if (rm.ready) key = 'rec.noteRemote';
      else key = 'rec.noteConnecting';
    }
    el.textContent = I18n.t(key, params);
    el.classList.toggle('rec-warn', warn);
    // 清單已經不靠這支瀏覽器的儲存區了 ⇒「這支瀏覽器記不住」那一行不再適用
    if (rm.on && !rm.down) document.getElementById('rec-storage-note').hidden = true;
  }

  function openRecords() {
    $input.blur();   // 先收鍵盤（同選項面板）
    endEdit();
    disarm();
    syncItems();   // 開面板時看到的要是儲存區現在的那一份
    renderRecords();
    M.Modal.getInstance($recModal).open();
    // modal-fixed-footer ⇒ 捲動的是 .modal-content，它會留在上次關掉時的位置；歸零要在 open() 之後（之前是 display:none）
    $recModal.querySelector('.modal-content').scrollTop = 0;
    grow($recSource);   // 同上：要在面板顯示出來之後量
  }

  /* 下載一段文字。回傳 Promise<boolean>：true＝交給瀏覽器了；false＝使用者自己取消（不是錯誤、不必講）。
   * ⚠️ Artifacts 版的沙盒會擋掉 <a download>（blob: 也一樣）而且不報錯
   *    ⇒ artifact/build.py 把這一整支換成走 downloads capability 的版本（錨點就是這支函式的全文，改這裡那邊會建置失敗）。 */
  function downloadText(name, text) {
    return new Promise(function (resolve) {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      resolve(true);
    });
  }

  function copyJson(trigger) {
    var text = refreshJson().text;
    if (!text) { recToast('rec.toast.empty', null, 'orange'); return; }
    copyText(text, $recModal).then(function () {
      setIconDone(trigger);
      M.toast({ html: _esc(I18n.t('toast.copied')), classes: 'teal' });
    }).catch(function () {
      M.toast({ html: _esc(I18n.t('toast.copyFail')), classes: 'red' });
    });
  }

  function downloadJson(trigger) {
    var text = refreshJson().text;
    if (!text) { recToast('rec.toast.empty', null, 'orange'); return; }
    var name = Lib.exportFilename(new Date());
    downloadText(name, text).then(function (done) {
      if (!done) return;
      setIconDone(trigger);
      recToast('toast.downloaded', { n: name }, 'teal');
    }).catch(function (err) {
      recToast('rec.toast.downloadFail', { m: String((err && (err.message || err.code)) || err) }, 'red');
    });
  }

  function bindRecords() {
    document.getElementById('open-records').addEventListener('click', function (e) {
      e.preventDefault();
      openRecords();
    });

    // 藏文欄底下那顆：正在打字時按它不該讓鍵盤收起來（打一段、加一筆、接著打下一段）
    var quick = document.getElementById('rec-add-quick');
    quick.addEventListener('mousedown', function (e) { e.preventDefault(); });
    quick.addEventListener('click', function (e) { e.preventDefault(); addCurrent(quick); });

    document.getElementById('rec-add').addEventListener('click', function (e) {
      e.preventDefault();
      addCurrent(e.currentTarget);
    });
    document.getElementById('rec-clear').addEventListener('click', function (e) {
      e.preventDefault();
      recAction('clear', -1);
    });
    document.getElementById('rec-list').addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]');
      if (!a) return;
      e.preventDefault();
      recAction(a.getAttribute('data-act'), parseInt(a.getAttribute('data-i'), 10));
    });
    document.getElementById('rec-copy').addEventListener('click', function (e) {
      e.preventDefault();
      copyJson(e.currentTarget);
    });
    document.getElementById('rec-download').addEventListener('click', function (e) {
      e.preventDefault();
      downloadJson(e.currentTarget);
    });

    // 標題：邊打邊存（不改寫欄位裡的字——正規化只發生在記下來的那一刻）
    $recTitle.addEventListener('input', function () {
      state.rec.title = Lib.normalizeTitle($recTitle.value);
      saveTitleSoon();
      pushTitleSoon();
    });

    // 來源：同標題，邊打邊存（只寫它自己那一格）
    $recSource.addEventListener('input', function () {
      state.rec.source = Lib.normalizeSource($recSource.value);
      grow($recSource);
      saveSourceSoon();
      pushSourceSoon();
    });
    // 清除來源：同清除標題——擋 mousedown，焦點維持原狀
    var sourceClear = document.getElementById('rec-source-clear');
    sourceClear.addEventListener('mousedown', function (e) { e.preventDefault(); });
    sourceClear.addEventListener('click', function (e) { e.preventDefault(); clearSource(sourceClear); });

    // 類型：邊打邊存（只寫它自己那一格）；單行欄位，Enter＝打完了
    $recType.addEventListener('input', function () { setPanelType($recType.value, true); });
    var typeClear = document.getElementById('rec-type-clear');
    typeClear.addEventListener('mousedown', function (e) { e.preventDefault(); });
    typeClear.addEventListener('click', function (e) { e.preventDefault(); clearType(typeClear); });
    $editType.addEventListener('input', renderTypeChips);
    [$recType, $editType].forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    });
    // 快選鈕：點一顆＝填進它那一格。擋 mousedown ⇒ 焦點維持原狀（鍵盤不會跳出來，正在打別格時也不會收起來）
    $recModal.addEventListener('mousedown', function (e) {
      if (e.target.closest('.rec-chip')) e.preventDefault();
    });
    $recModal.addEventListener('click', function (e) {
      var c = e.target.closest('.rec-chip');
      if (!c) return;
      e.preventDefault();
      var v = c.getAttribute('data-type');
      if (c.parentNode.getAttribute('data-for') === 'rec-edit-type') { $editType.value = v; renderTypeChips(); }
      else { $recType.value = v; setPanelType(v); }
    });

    // 別的分頁改了清單 ⇒ 這邊跟著換（只在「別的文件」寫入時才會收到這個事件）。key 為 null＝整個儲存區被清空
    window.addEventListener('storage', function (e) {
      if (e.key !== REC_KEY && e.key !== null) return;
      if (syncItems() === 'changed') { disarm(); renderRecords(); }
    });
    // 清除標題：擋 mousedown ⇒ 焦點維持原狀——正在打標題時鍵盤留著接著打，沒在打時鍵盤不會跳出來
    var titleClear = document.getElementById('rec-title-clear');
    titleClear.addEventListener('mousedown', function (e) { e.preventDefault(); });
    titleClear.addEventListener('click', function (e) { e.preventDefault(); clearTitle(titleClear); });
    $recTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $recTitle.blur(); }   // 單行欄位：Enter＝打完了，收鍵盤
    });
    $recTitle.addEventListener('blur', function () { setTimeout(fitShell, 0); });

    // 編輯表單：儲存／取消各有兩顆（表單第一列的圖示——鍵盤開著時底列被蓋住；底列的文字鈕），都帶 data-edit
    $recModal.addEventListener('click', function (e) {
      var a = e.target.closest('[data-edit]');
      if (!a) return;
      e.preventDefault();
      if (a.getAttribute('data-edit') === 'save') saveEdit(); else cancelEdit();
    });
    $editInput.addEventListener('input', function () { autosizeEdit(); renderEditPreview(); });
    $editSource.addEventListener('input', autosizeEdit);
    [$editMethod, $editTranslit, $editIgnore].forEach(function (el) { el.addEventListener('change', renderEditPreview); });
    $editTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $editTitle.blur(); }
    });
    [$editTitle, $editInput, $editSource, $editType, $recSource, $recType].forEach(function (el) {
      el.addEventListener('blur', function () { setTimeout(fitShell, 0); });
    });
  }

  /* ---------- 主題 / 語言 / 工具列開關 ---------- */
  function applyTheme(theme) {
    state.theme = theme;
    root.setAttribute('data-theme', theme);
    // 共用 materialize-dark.css 以 html.light-mode 標記淺色，兩個 class 要一起切（§5.1）
    root.classList.toggle('dark-mode', theme === 'dark');
    root.classList.toggle('light-mode', theme === 'light');
    var icon = document.querySelector('#setting-mode i');
    if (icon) icon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function cycleLang() {
    var next = I18n.cycle();
    M.toast({ html: _esc(I18n.t('toast.lang', { name: I18n.name(next) })), classes: 'teal' });
  }

  // 形制照 bonji-mobile（上游是 bonji 的 tools-toggle.js）；「只在手機」由 CSS 決定，這裡不判斷寬度
  function applyTools(show) {
    var btn = document.getElementById('tools-toggle');
    document.body.classList.toggle('tools-hidden', !show);
    btn.classList.toggle('active', show);
    try { localStorage.setItem(TOOLS_KEY, show ? 'on' : 'off'); } catch (e) {}
    if (show && window.SideTool && window.SideTool.refreshOverflow) window.SideTool.refreshOverflow();
  }
  function toggleTools() { applyTools(document.body.classList.contains('tools-hidden')); }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    $input.addEventListener('input', onInput);

    [$inputMethod, $translit, $ignoreSpaces].forEach(function (el) {
      el.addEventListener('change', function () {
        convert();
        saveDraftSoon();
      });
    });

    document.querySelectorAll('.examples .ex').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        $input.value = chip.getAttribute('data-ex') || '';
        // 不聚焦：點範例是想看結果，不是要打字——聚焦會把鍵盤彈出來蓋掉一半輸出
        onInput();
      });
    });

    document.querySelectorAll('.out-copy[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        copyOutput(btn.getAttribute('data-copy'), btn);
      });
    });

    var keysetBtn = document.getElementById('keyset-toggle');
    // 同記號列：切換不該讓鍵盤收起來（正在打字時換一組鍵是常態）
    keysetBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    keysetBtn.addEventListener('click', function (e) { e.preventDefault(); toggleKeyset(); });
    document.addEventListener('i18n:changed', function () {
      renderRecords();   // 清單裡的「第 n 段」「（無標題）」與空狀態跟著語言走
      if (state.edit) renderEditPreview();
      renderKeysetToggle();
      if (!Lib.keysFromAssist(state.assist, state.keyset).length) renderKeybar();   // 失敗說明跟著語言走
      if (state.tableFailed) convert();   // 藏文欄裡那一句「對照表載不到」也是文案
    });

    var clearBtn = document.getElementById('clear-input');
    // 同記號列：按清除不該讓鍵盤收起來
    clearBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    clearBtn.addEventListener('click', function (e) { e.preventDefault(); clearInput(); });

    document.getElementById('open-options').addEventListener('click', function (e) {
      e.preventDefault();
      $input.blur();   // 先收鍵盤：bottom-sheet 從下方滑出，鍵盤開著會把它擠到看不見
      M.Modal.getInstance(document.getElementById('options-modal')).open();
    });

    var toolsBtn = document.getElementById('tools-toggle');
    toolsBtn.addEventListener('click', toggleTools);
    toolsBtn.addEventListener('keydown', function (e) {   // role="button" ⇒ Enter／Space 也要能按
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTools(); }
    });

    document.getElementById('setting-mode').addEventListener('click', function (e) {
      e.preventDefault();
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('setting-lang').addEventListener('click', function (e) {
      e.preventDefault();
      cycleLang();
    });

    $input.addEventListener('focus', fitShell);
    $input.addEventListener('blur', function () { setTimeout(fitShell, 0); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitShell);
      window.visualViewport.addEventListener('scroll', fitShell);
    }
    window.addEventListener('resize', fitShell);
    window.addEventListener('orientationchange', function () {
      state.baseline = 0;     // 轉向後舊基準作廢；下一次失焦時重量
      setTimeout(fitShell, 50);
    });
  }

  // toast 的 html 是 innerHTML：把帶進來的值（例外訊息、語言名）當文字處理
  function _esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    M.Modal.init(document.getElementById('options-modal'), {
      onCloseStart: function () { saveDraftSoon(); }
    });
    // onCloseStart 而不是 onCloseEnd：背景分頁裡動畫不推進，End 不會來（家族 memory animation-complete-callbacks-stall）
    M.Modal.init($recModal, {
      onCloseStart: function () { $recType.blur(); saveType(); $recSource.blur(); saveSource(); $recTitle.blur(); endEdit(); disarm(); saveTitle(); }   // 只收尾標題；清單只在它自己被改時寫
    });

    var saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    applyTheme(saved === 'light' ? 'light' : 'dark');

    var tools = 'off';
    try { tools = localStorage.getItem(TOOLS_KEY) || 'off'; } catch (e) {}
    applyTools(tools === 'on');

    I18n.apply(document);

    var d = loadDraft();
    $inputMethod.value = d.options.inputMethod;
    $translit.value = d.options.transliteration;
    $ignoreSpaces.checked = d.options.ignoreSpacesAndHyphens;
    $input.value = d.input;

    var ks = null;
    try { ks = localStorage.getItem(KEYSET_KEY); } catch (e) {}
    state.keyset = Lib.normalizeKeyset(ks);
    renderKeysetToggle();

    state.rec = loadRecords();
    $recTitle.value = state.rec.title;
    $recSource.value = state.rec.source;
    $recType.value = state.rec.type;
    // 探針：寫進去再讀回來比對（問「localStorage 在不在」永遠回「在」）。⚠️ 只證明這一刻存得住，證明不了撐得過關掉頁面
    var probeOk = false;
    try {
      localStorage.setItem(REC_KEY + '-probe', '1');
      probeOk = localStorage.getItem(REC_KEY + '-probe') === '1';
      localStorage.removeItem(REC_KEY + '-probe');
    } catch (e) {}
    state.storageOk = probeOk;
    document.getElementById('rec-storage-note').hidden = probeOk;

    bindKeybar();
    bindEvents();
    bindRecords();
    fitShell();
    convert();
    renderRecords();
    // 同步那一支若已經載入就接上；晚到的話它會發這個事件（兩者的先後不保證）
    startRemote();
    document.addEventListener('tibetan-siddham-mobile:remote', startRemote);
    loadAssist().then(function () { renderKeybar(); fitShell(); });

    // 藏文對照表（data/tibetan.tsv）：載好之前 convert() 與清單都先不算。載不到要在畫面上講——
    // 否則打了字、輸出欄一直是空的，看起來就是「這段記法轉不出任何字」。
    converter.ready().then(function () {
      state.ready = true;
    }, function (e) {
      console.error('藏文對照表載入失敗：', e);
      state.tableFailed = String((e && e.message) || e) || 'unknown';
      M.toast({ html: _esc(I18n.t('out.tableFail', { m: state.tableFailed })), classes: 'red', displayLength: 8000 });
    }).then(function () {
      convert();
      renderRecords();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
