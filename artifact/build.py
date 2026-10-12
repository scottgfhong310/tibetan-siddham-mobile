#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build.py — 把 tibetan-siddham-mobile 的前端組成可發佈到 Claude Artifacts 的一份。

用法：  python3 artifact/build.py            → 輸出到 artifact/dist/（不進版控）
        python3 artifact/build.py --out DIR  → 輸出到別的地方

形制照 `bonji-mobile/artifact/build.py`：**本目錄不放逐字複製件**，建置時從
`public/apps/tibetan-siddham-mobile/` 現抓，差異一律以下面的 PATCHES 表達——那張表就是
「Express 版與 Artifact 版差在哪」的權威說明。
⚠️ 每一處錨點都要求**恰好命中一次**，否則 exit 1：app 那一側改了而補丁沒跟上時，
   建置會當場失敗，而不是安靜地少打一個補丁。

本 app 本來就零後端，所以 Artifact 版只差三件事（都是 bonji-mobile 在真機上踩出來的）：
  ① `materialize.min.css` 自己託管（vendor/）：Artifact 的 CSP 只允許 fonts.googleapis.com
     當外部樣式表來源，**cdnjs 的樣式表會被擋掉而且不報錯**（整頁沒有樣式）。
     來源 https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css（MIT），
     與 bonji-mobile/artifact/vendor/ 那份逐位元組相同。
  ② 紀錄清單的 JSON 下載：沙盒會擋掉 `<a download>`（blob: 也一樣）而且不報錯 ⇒ 改走 `downloads` capability。
     拿不到就講出來，不假裝下載了；使用者在確認框按取消（`declined`）不是錯誤。
  ③ 紀錄清單存 artifact 的資料庫（`db` capability）：iPhone 的 Claude App 把 artifact 關掉重開，localStorage 就讀不回來
     〔bonji-mobile，owner 2026-10-11 實測〕。多帶一支 `artifact/src/remote-db.js`（只有 Artifacts 版有；一筆一份文件），
     並在 index.html 的控制器之前載入它。app 那一側只留一個接點（`window.TibetanSiddhamMobileRemote`），沒有它就照舊存 localStorage。
     **發佈時要宣告 `downloads` 與 `db`，規則是只有 artifact 的 owner 讀寫**：見最後印出來的那一行。

⚠️ 字型：只有 Noto Serif Tibetan 與 Noto Sans Siddham（皆 SIL OFL）。最後的檢查擋著：dist 裡出現別的字型檔就 exit 1。
   （與 bonji-mobile 不同：本 app **沒有 CBETA 字形的 SVG**——記號列的鍵全是隨附的 Noto 畫的，所以沒有「不進 GitHub」的那一塊。）
⚠️ 藏文對照表 `data/tibetan.tsv` 是執行時 fetch 的（藏文核心以 import.meta.url 的相對路徑讀）——它要在 dist 裡，檢查會確認。
⚠️ 已知未驗：Artifacts 版跑在宿主頁的 iframe 裡，鍵盤彈出時 iframe 自己的 visualViewport
   會不會跟著縮，**取決於宿主**，不是本 app 控制得了的（見 DESIGN.md §3）。
"""
import json
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
APP = REPO / 'public' / 'apps' / 'tibetan-siddham-mobile'

EXCLUDE_NAMES = {'.DS_Store'}

CDN_CSS = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" />'
LOCAL_CSS = '<link rel="stylesheet" href="./materialize.min.css" />'

# 錨點＝ tibetan-siddham-mobile.js 那支 downloadText 的函式本體（恰好命中一次；那邊改了這裡會建置失敗）。
# 兩邊的契約相同：回傳 Promise<boolean>——true＝存了、false＝使用者自己取消；其餘失敗 reject，由呼叫端講。
DOWNLOAD_OLD = """  function downloadText(name, text) {
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
  }"""
DOWNLOAD_NEW = """  function downloadText(name, text) {
    var use = window.claude && window.claude.use;
    return (use ? window.claude.use('downloads') : Promise.resolve(null)).then(function (dl) {
      if (!dl) throw new Error('downloads unavailable');
      return dl.save({ filename: name, data: text }).then(function () { return true; });
    }).catch(function (err) {
      if (err && err.code === 'declined') return false;   // 使用者在確認框按了取消，不是錯誤
      throw err;
    });
  }"""

CONTROLLER_TAG = '  <script type="module" src="./tibetan-siddham-mobile.js"></script>'
REMOTE_TAG = '  <!-- 紀錄清單同步（只有 Artifacts 版有）：把 window.TibetanSiddhamMobileRemote 掛上來 -->\n  <script src="./remote-db.js"></script>\n'

# (相對路徑, 舊, 新)
PATCHES = [
    ('index.html', CDN_CSS, LOCAL_CSS),
    ('index.html', CONTROLLER_TAG, REMOTE_TAG + CONTROLLER_TAG),
    ('tibetan-siddham-mobile.js', DOWNLOAD_OLD, DOWNLOAD_NEW),
]

# 發佈時的 capabilities——這一行同時印在建置結尾；改這裡要連 remote-db.js 檔頭那一行一起改
CAPABILITIES = '{"downloads": true, "db": {"rules": [{"path": "", "read": "owner", "write": "owner"}]}}'

FONT_EXT = {'.ttf', '.otf', '.ttc', '.dfont', '.woff', '.woff2', '.eot'}
# Artifacts 推不出型別的檔（副檔名不在它的清單上，或沒有副檔名）：發佈時明講 text/plain
PLAIN_SUFFIX = {'.tsv', ''}
FILES_JSON = HERE / 'dist.files.json'
FONT_ALLOWED = {'fonts/NotoSerifTibetan-Regular.ttf', 'fonts/NotoSansSiddham-Regular.woff2'}
# 執行時要讀得到的資料檔（少了哪一個，頁面會開得起來但轉不出字或沒有記號列）
DATA_REQUIRED = ['data/tibetan.tsv', 'data/assist.json']


def main():
    unknown = [a for i, a in enumerate(sys.argv[1:], 1) if a != '--out' and sys.argv[i - 1] != '--out']
    if unknown:
        print('✗ 未知旗標：%s' % ' '.join(unknown)); return 2
    out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]).resolve() \
        if '--out' in sys.argv else HERE / 'dist'
    if not APP.is_dir():
        print('✗ 找不到 app 目錄：%s' % APP); return 2
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    print('輸出：%s\n' % out)

    print('① 自 app 取檔')
    n = 0
    for src in sorted(APP.rglob('*')):
        if not src.is_file() or src.name in EXCLUDE_NAMES:
            continue
        rel = src.relative_to(APP).as_posix()
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        n += 1
    shutil.copy2(HERE / 'vendor' / 'materialize.min.css', out / 'materialize.min.css')
    shutil.copy2(HERE / 'src' / 'remote-db.js', out / 'remote-db.js')
    print('  ✓ %d 個檔 ＋ materialize.min.css ＋ remote-db.js' % n)

    print('② 補丁（每一處恰好命中一次）')
    for rel, old, new in PATCHES:
        p = out / rel
        s = p.read_text(encoding='utf-8')
        c = s.count(old)
        if c != 1:
            print('  ✗ %s：錨點命中 %d 次（應為 1）——app 那側改了而補丁沒跟上\n    %s' % (rel, c, old.splitlines()[0]))
            return 1
        p.write_text(s.replace(old, new), encoding='utf-8')
    print('  ✓ %d 處' % len(PATCHES))

    print('③ 檢查')
    bad = []
    for p in out.rglob('*'):
        rel = p.relative_to(out).as_posix()
        if p.is_file() and p.suffix.lower() in FONT_EXT and rel not in FONT_ALLOWED:
            bad.append('不可散布的字型：' + rel)
        if p.is_file() and p.suffix in {'.html', '.js', '.css'}:
            t = p.read_text(encoding='utf-8')
            if '\x00' in t:
                bad.append('含 NUL：' + rel)
            if p.suffix == '.html' and 'cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/' in t:
                bad.append('仍引用 cdnjs 樣式表：' + rel)
            if rel == 'tibetan-siddham-mobile.js' and ('a.download' in t or "claude.use('downloads')" not in t):
                bad.append('下載仍走 <a download>（沙盒會擋掉且不報錯）：' + rel)
            if rel == 'tibetan-siddham-mobile.js' and 'TibetanSiddhamMobileRemote' not in t:
                bad.append('控制器沒有同步的接點（window.TibetanSiddhamMobileRemote）：' + rel)
            if rel == 'index.html' and t.find('./remote-db.js') < 0:
                bad.append('index.html 沒有載入 remote-db.js（清單會只存在瀏覽器裡，iPhone 上關掉就沒了）')
    for rel in DATA_REQUIRED:
        if not (out / rel).is_file() or not (out / rel).stat().st_size:
            bad.append('缺 ' + rel)
    for rel in FONT_ALLOWED:
        if not (out / rel).is_file():
            bad.append('缺字型 ' + rel)
    if bad:
        for b in bad:
            print('  ✗ ' + b)
        return 1
    print('  ✓ 只有那兩支 Noto 字型、資料檔都在、沒有 cdnjs 樣式表')

    # 發佈時 Artifact 工具的 `files` 參數（root＝dist）。⚠️ Artifacts 只送它認得的副檔名：`.tsv` 不在清單上（首次發佈時被退回），
    #    沒有副檔名的 LICENSE 也推不出型別 ⇒ 這兩種明講 text/plain。藏文核心只把對照表當文字讀，型別不影響它。
    files = {}
    for p in sorted(out.rglob('*')):
        rel = p.relative_to(out).as_posix()
        if not p.is_file() or rel == 'index.html':
            continue
        files[rel] = {'from': rel, 'contentType': 'text/plain'} if p.suffix.lower() in PLAIN_SUFFIX else rel
    FILES_JSON.write_text(json.dumps(files, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    print('\n✓ 建置完成。發佈：file_path＝dist/index.html、root＝dist、files＝%s 的內容（%d 個檔）' % (FILES_JSON.relative_to(REPO), len(files)))
    print('  capabilities: ' + CAPABILITIES)
    print('  ⚠️ 發佈之前先備份資料庫裡的清單（ArtifactData list `records` → scripts/backup-artifact.sh），見 CLAUDE.md。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
