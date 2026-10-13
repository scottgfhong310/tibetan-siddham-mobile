/**
 * remote-db.js — tibetan-siddham-mobile 的紀錄清單同步（**只有 Claude Artifacts 版有**；由 artifact/build.py 帶進 dist，
 * GitHub／3001 那一份沒有這個檔，清單照舊存 localStorage）。
 *
 * 為什麼需要它〔bonji-mobile 2026-10-11，owner 實測〕：iPhone 的 Claude App 把 artifact 關掉重開，localStorage 裡的清單就讀不回來。
 * ⇒ 清單改存 artifact 的資料庫（`db` capability）：撐得過重開、republish 與換裝置，Claude 也讀得到（發佈前先備份）。
 *
 * 資料形狀（發佈時宣告 `capabilities: { downloads: true, db: { rules: [{ path: "", read: "owner", write: "owner" }] } }`）：
 *   records/<id>   { title, type, source, input, options, savedAt, order }   —— **一筆一份文件**，文件名＝那一筆的 id（`type`＝類型，**字串陣列**（第一版是單一字串，讀進來當成一個）；`source`＝來源；2026-10-13 起，舊文件沒有這兩欄＝空的）
 *   state/title    { value }                                   —— 標題欄現在的值
 *   state/source   { value }                                   —— 來源欄現在的值（加入一筆時帶進那一筆的 `source`）
 *   state/type     { value }                                   —— 類型欄現在的值（**欄位裡的字**，好幾個時以「、」相連；加入時拆成陣列帶進 `type`）
 * ⚠️ **沒有「整份清單」那種文件**：整份寫回去就是 家族 CHANGELOG v2.181 弄丟紀錄的那個做法。加入／取代只 set 自己那一份、刪除只 delete 自己那一份。
 * ⚠️ 同一份文件一次只寫一筆（平台的規矩：前一次還沒回來又寫，會越寫越慢）⇒ 每份文件各排一條隊。
 *
 * 介面：window.TibetanSiddhamMobileRemote = { start(handlers), put(rec), remove(id), setTitle(t), setSource(s), setType(t) }
 *   handlers.onReady()                  資料庫可用，清單從此由它作主
 *   handlers.onItems(list, definitive)  清單（每次有變動都會再來）；definitive=false＝還不是伺服器確認過的完整版本
 *   handlers.onTitle(t)                 標題欄的值
 *   handlers.onSource(s)                來源欄的值
 *   handlers.onType(t)                  類型欄的值
 *   handlers.onDown(code)               用不了（沒有這個環境／沒被授權／訂閱斷了）
 */
(function () {
  'use strict';

  var COL = 'records';
  var TITLE_DOC = 'state/title';
  var SOURCE_DOC = 'state/source';
  var TYPE_DOC = 'state/type';
  var db = null;
  var queues = {};   // 文件路徑 → 最後一次寫入的 Promise

  function queued(path, job) {
    var prev = queues[path] || Promise.resolve();
    var next = prev.then(job, job);
    queues[path] = next.then(null, function () {});   // 這一次失敗不擋住下一次
    return next;
  }

  function start(h) {
    var use = window.claude && window.claude.use;
    if (!use) { h.onDown('no_runtime'); return; }
    window.claude.use('db').then(function (d) {
      if (!d) { h.onDown('unavailable'); return; }
      db = d;
      h.onReady();
      db.collection(COL).onSnapshot(function (snap) {
        var list = snap.docs.map(function (doc) {
          var x = doc.data() || {};
          return { id: doc.id, title: x.title, type: x.type, source: x.source, input: x.input, options: x.options, savedAt: x.savedAt, order: x.order };
        });
        h.onItems(list, !(snap.metadata && snap.metadata.fromCache));
      }, function (e) { h.onDown((e && e.code) || 'unavailable'); });
      db.doc(TITLE_DOC).onSnapshot(function (s) {
        if (s.exists) h.onTitle(String((s.data() || {}).value || ''));
      }, function () {});
      db.doc(SOURCE_DOC).onSnapshot(function (s) {
        if (s.exists && h.onSource) h.onSource(String((s.data() || {}).value || ''));
      }, function () {});
      db.doc(TYPE_DOC).onSnapshot(function (s) {
        if (s.exists && h.onType) h.onType(String((s.data() || {}).value || ''));
      }, function () {});
    }, function () { h.onDown('unavailable'); });
  }

  function put(rec) {
    var path = COL + '/' + rec.id;
    return queued(path, function () {
      return db.collection(COL).doc(rec.id).set({
        title: rec.title, type: rec.type || [], source: rec.source || '', input: rec.input, options: rec.options, savedAt: rec.savedAt, order: rec.order
      });
    });
  }

  function remove(id) {
    return queued(COL + '/' + id, function () { return db.collection(COL).doc(id).delete(); });
  }

  function setTitle(t) {
    return queued(TITLE_DOC, function () { return db.doc(TITLE_DOC).set({ value: String(t || '') }); });
  }

  function setSource(s) {
    return queued(SOURCE_DOC, function () { return db.doc(SOURCE_DOC).set({ value: String(s || '') }); });
  }

  function setType(t) {
    return queued(TYPE_DOC, function () { return db.doc(TYPE_DOC).set({ value: String(t || '') }); });
  }

  window.TibetanSiddhamMobileRemote = { start: start, put: put, remove: remove, setTitle: setTitle, setSource: setSource, setType: setType };
  // 控制器是 module script，與本檔的先後不保證 ⇒ 掛好之後喊一聲
  document.dispatchEvent(new CustomEvent('tibetan-siddham-mobile:remote'));
})();
