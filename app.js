/**
 * tibetan-siddham-mobile — 獨立執行的 Express 伺服器
 *
 * 手機優先的藏文梵字轉換器：輸入的同時看得到輸出，不必捲動畫面。
 * 轉換全在瀏覽器（tibetan-siddham 的防腐層 TibetanSiddhamConverter 與藏文規則表的複製件），
 * 草稿與紀錄清單只存在使用者自己的瀏覽器——**伺服器上沒有任何持久化**，故後端無 API
 * （DATABASE_GUIDELINES §0 的第 0 層；同 bonji-mobile／circle-text 先例，DESIGN_GUIDELINES §3.1 的最小形）：
 * 只負責靜態檔、根路徑轉址、JSON 404。
 *
 * 啟動： npm install && npm start
 *        預設 http://localhost:3000/apps/tibetan-siddham-mobile/
 */

const express = require('express');
const path = require('path');
const logger = require('morgan');

const app = express();

app.use(logger('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// 根路徑導向應用頁
app.get('/', (req, res) => res.redirect('/apps/tibetan-siddham-mobile/'));

// 404（API 回 JSON，其餘回純文字）
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
  res.status(404).type('text/plain').send('Not found');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[tibetan-siddham-mobile] →  http://localhost:${PORT}/apps/tibetan-siddham-mobile/`));
