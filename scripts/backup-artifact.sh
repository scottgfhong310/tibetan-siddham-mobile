#!/bin/sh
# backup-artifact.sh — 把 Claude Artifacts 版的紀錄清單（artifact 的資料庫）備份到本機＋iCloud
#
# 用法：backup-artifact.sh <取回來的資料夾> <取回的文件數>
#   <取回來的資料夾>  ArtifactData `list` `records` 的 `out_dir`（文件落在它底下的 records/<id>.json）
#   <取回的文件數>    那一次 `list` 回報的筆數（0 也要給）——拿來與磁碟上的檔數對帳
# exit：0 成功（含「清單是空的，沒有新備份」）／1 失敗（驗證沒過、檔數對不上、異地副本對不上）／2 前提不成立
#
# ⚠️⚠️ **為什麼需要它**（整支照 bonji-mobile 的 scripts/backup-artifact.sh；那邊是 owner 2026-10-11 要求的：
#    「在每次更新的時候，可以先備份或同步資料嗎？」「加每日備份排程，比照 coffee-deposit」）
#    Artifacts 版的清單住在 artifact 的資料庫裡（artifact/src/remote-db.js），**那是 owner 記的咒語唯一的一份**。
#    資料庫撐得過關掉重開與 republish，但它跟著 artifact 走：artifact 被刪、或某一版的頁面把資料弄壞，就沒有第二份了。
#    這支補上那一格。（bonji-mobile 在改存資料庫之前，清單住在 iPhone 的瀏覽器儲存裡，同一天被清掉兩次、救不回來。）
#
# ⚠️ **分工照 coffee-deposit 的 backup-artifact.sh**：資料庫只有 Claude 的 ArtifactData 工具讀得到（shell 沒辦法向 claude.ai 認證）
#    ⇒ 排程任務（~/.claude/scheduled-tasks/tibetan-siddham-mobile-artifact-backup）與發佈前的那一步**只做一件事**：把 `records` 取回本機，
#    然後呼叫本腳本。**其餘每一步都在這裡**——對帳、驗證、合成一個檔、輪替、異地副本、log。
#    把這些寫進 prompt，等於每天由 LLM 重新想一次同一段邏輯：會變的東西不要放在每次都重寫的地方。
#
# 與 coffee-deposit 那一支不同的四件事（都是因為來源的形狀不同；與 bonji-mobile 那一支相同）：
#   ① 來源是**一筆一份文件**（不是一個 data.js）⇒ 取回來的是一個資料夾。**上一次留下的檔會混進來**（別台刪掉的那幾筆仍在磁碟上）
#      ⇒ 兩道關：只收最近 60 分鐘內寫下的檔（更舊的先清掉）；而且檔數要等於呼叫端報的筆數。兩者對不上就失敗，不動既有備份。
#   ② **空的清單是合法狀態**（owner 全部清除／剛開始用）⇒ exit 0，但**不寫新檔、不輪替、不碰異地副本**：
#      連續七天空的清單不可以把最後一份有內容的備份擠掉——而「不小心全部清除」正是備份最該撐住的那一天。
#   ③ **內容與上一份相同就不另存**（只記 log、仍更新異地副本）：本機留的 KEEP 份是「最近 KEEP 個不同的狀態」，不是「最近 KEEP 天」。
#   ④ 標題欄的值（state/title）不備份：那是輸入時的方便，不是紀錄；多取一份就多一個工具呼叫。
#
# 驗證用的是 app 自己的 lib（`TibetanSiddhamMobileLib.normalizeStore`，以 vm 載入）——**規則只有那一份**，頁面寫入時走的也是它。
#   它擋得住的是「取回來的不是紀錄」（不是 JSON、沒有 input、id 不合格）；擋不住的是「內容被改錯了」——那要靠 log 裡那一行差異。
#
# 備份檔：<根>/tibetan-siddham-mobile-artifact-<yyyyMMdd-HHmmss>.json
#   { app, source, pulledAt, count, records: [{ id, title, type, source, input, options, savedAt, order }] }（依 order、同值依 id；`type`＝類型（字串陣列；第一版是單一字串）、`source`＝來源，舊備份沒有這兩欄）
#   還原：把 records 逐筆以 ArtifactData `batch`／`set` 寫回 `records/<id>`（文件內容＝去掉 id 的那一筆）。
#
# 環境變數（測試與發佈前那一步用；排程不設）：
#   TSM_BACKUP_ROOT    本機存放根（預設 /Users/Shared/nodeapp-db-backup/tibetan-siddham-mobile-artifact）
#   TSM_BACKUP_CLOUD   異地副本資料夾（預設 iCloud Drive/nodeapp-db-backup）；設成 `-` ＝這次不寫異地副本
#   TSM_BACKUP_NOTIFY  設成 0 就不跳系統通知
#
# ⚠️ iCloud Drive 是 TCC 保護路徑：排程**只能覆寫自己建的檔**（家族三支備份腳本都實測撞過）
#    ⇒ 異地副本一律交給排程寫；發佈前手動跑的那一次帶 `TSM_BACKUP_CLOUD=-`。
set -u

PULL=${1:-}
EXPECT=${2:-}
[ -n "$PULL" ] && [ -n "$EXPECT" ] || { echo "用法：backup-artifact.sh <取回來的資料夾> <取回的文件數>" >&2; exit 2; }
case "$EXPECT" in *[!0-9]*) echo "文件數要是非負整數：$EXPECT" >&2; exit 2 ;; esac
command -v node >/dev/null || { echo "找不到 node" >&2; exit 2; }

REPO=$(cd "$(dirname "$0")/.." && pwd)
LIB="$REPO/public/apps/tibetan-siddham-mobile/tibetan-siddham-mobile-lib.js"
[ -f "$LIB" ] || { echo "找不到 lib：$LIB" >&2; exit 2; }

DIR=${TSM_BACKUP_ROOT:-/Users/Shared/nodeapp-db-backup/tibetan-siddham-mobile-artifact}
CLOUD=${TSM_BACKUP_CLOUD:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/nodeapp-db-backup}
NOTIFY=${TSM_BACKUP_NOTIFY:-1}
KEEP=7
NAME=tibetan-siddham-mobile-artifact
STAMP=$(date +%Y%m%d-%H%M%S)
SOURCE_URL=https://claude.ai/artifact/9jxT8XXBY9wF2wyt67qXv7

mkdir -p "$DIR" || { echo "建不出 $DIR" >&2; exit 2; }
LOG="$DIR/backup.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$LOG"; echo "$*"; }

notify() {
  [ "$NOTIFY" = "0" ] && return 0
  osascript -e "display notification \"$1\" with title \"tibetan-siddham-mobile 備份\"" >/dev/null 2>&1
  return 0
}

log "── 開始（來源 $PULL，呼叫端報 $EXPECT 筆）"

# ───────────────────────── ① 對帳：磁碟上的檔數 ＝ 呼叫端報的筆數 ─────────────────────────
# 上一次留下的檔（超過 60 分鐘）先清掉——它們是「上一次的清單」，不是這一次的。
REC="$PULL/records"
STALE=0
if [ -d "$REC" ]; then
  STALE=$(find "$REC" -maxdepth 1 -type f -name '*.json' -mmin +60 | wc -l | tr -d ' ')
  [ "$STALE" = "0" ] || find "$REC" -maxdepth 1 -type f -name '*.json' -mmin +60 -delete
  FOUND=$(find "$REC" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')
else
  FOUND=0
fi
[ "$STALE" = "0" ] || log "    清掉上一次留下的 $STALE 個檔"

# 取回來的檔用完就清（不論成敗）：留著的話下一次會混進來。驗證沒過時先留一份隔離副本。
cleanup_pull() { [ -d "$REC" ] && find "$REC" -maxdepth 1 -type f -name '*.json' -delete; return 0; }

if [ "$FOUND" != "$EXPECT" ]; then
  cleanup_pull
  log "  ✗ 檔數對不上：磁碟上 $FOUND 個、呼叫端報 $EXPECT 筆——這一次取回來的不完整，或混進了別次的檔（既有備份未被動過）"
  notify "檔數對不上，這次沒有備份"
  exit 1
fi

# ───────────────────────── ② 空的清單：合法，但不寫新檔 ─────────────────────────
if [ "$FOUND" = "0" ]; then
  log "  · 資料庫裡的清單是空的——沒有新備份，既有備份與異地副本都沒有動"
  date '+%Y-%m-%d %H:%M:%S' > "$DIR/LAST-SUCCESS.txt"
  log "── 完成"
  exit 0
fi

# ───────────────────────── ③ 驗證＋合成一個檔 ─────────────────────────
# ⚠️ 這一步**必須擋住後面每一步**：印一行「驗證失敗」然後照樣輪替，等於用一份壞檔換掉一份好檔。
PREV=$(ls -t "$DIR"/"$NAME"-*.json 2>/dev/null | head -1)
OUT="$DIR/$NAME-$STAMP.json"

VERDICT=$(REC="$REC" PREV="${PREV:-}" LIB="$LIB" OUT="$OUT.part" SOURCE_URL="$SOURCE_URL" node -e '
const fs = require("fs"), path = require("path"), vm = require("vm");
try {
  const sb = {}; sb.window = sb;
  vm.runInNewContext(fs.readFileSync(process.env.LIB, "utf8"), sb);
  const L = sb.TibetanSiddhamMobileLib;
  const raw = fs.readdirSync(process.env.REC).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const body = JSON.parse(fs.readFileSync(path.join(process.env.REC, f), "utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(f + " 不是一份文件");
    return Object.assign({}, body, { id: f.slice(0, -5) });
  });
  const items = L.normalizeStore({ items: raw }).items;
  // normalizeStore 會丟掉不合格的（沒有 input）並清掉不合格的 id——兩種都不該出現在資料庫裡
  if (items.length !== raw.length) throw new Error("有 " + (raw.length - items.length) + " 份文件不是合格的紀錄（沒有 input）");
  const noId = items.filter((it) => !it.id).length;
  if (noId) throw new Error("有 " + noId + " 份文件的檔名不是合格的 id");
  const records = L.mergeRemote(items, {}, {});   // 依 order、同值依 id（與頁面同一支排序）
  const titles = new Set(records.map((r) => r.title));

  let delta = "（這是第一份）", same = false;
  if (process.env.PREV) {
    try {
      const p = JSON.parse(fs.readFileSync(process.env.PREV, "utf8")).records || [];
      // 類型與來源也是內容：只改了其中一欄也算一個不同的狀態。舊備份沒有這兩欄、或類型還是第一版的單一字串 ⇒ 兩邊都過同一支正規化再比
      // （否則升級後第一次會整份被判成「修改」）
      const body = (r) => JSON.stringify([r.title, L.normalizeTypes(r.type), r.source || "", r.input, r.options, r.order]);
      const oldMap = new Map(p.map((r) => [r.id, r])), newMap = new Map(records.map((r) => [r.id, r]));
      const added = records.filter((r) => !oldMap.has(r.id));
      const gone = p.filter((r) => !newMap.has(r.id));
      const changed = records.filter((r) => oldMap.has(r.id) && body(oldMap.get(r.id)) !== body(r));
      const label = (r) => (r.title || "（無標題）") + "／" + String(r.input).slice(0, 16);
      const cap = (list) => list.slice(0, 3).map(label).join("、") + (list.length > 3 ? "…+" + (list.length - 3) : "");
      const bits = [];
      if (added.length) bits.push("新增 " + added.length + "（" + cap(added) + "）");
      if (gone.length) bits.push("刪除 " + gone.length + "（" + cap(gone) + "）");
      if (changed.length) bits.push("修改 " + changed.length + "（" + cap(changed) + "）");
      same = !bits.length;
      // 只比數量看不見「一進一出」（家族 memory count-checks-blind-to-swaps）⇒ 逐 id 比，筆數沒變而有增有刪時大聲講
      const swap = (added.length || gone.length) && records.length === p.length;
      const d = records.length - p.length;
      delta = "vs 上一份：" + (d >= 0 ? "+" : "") + d + " 筆｜" + (bits.length ? bits.join("；") : "內容無變動") +
        (swap ? "｜⚠️ 筆數沒變但有增有刪（一進一出）" : "");
    } catch (e) { delta = "（上一份讀不出來：" + e.message + "）"; }
  }

  fs.writeFileSync(process.env.OUT, JSON.stringify({
    app: "tibetan-siddham-mobile", source: process.env.SOURCE_URL, pulledAt: new Date().toISOString(),
    count: records.length, records: records
  }, null, 2) + "\n");
  console.log((same ? "SAME" : "OK") + "\t" + records.length + " 筆／" + titles.size + " 個標題｜" + delta);
} catch (e) {
  console.log("FAIL\t" + e.message);
}
' 2>&1)

case "$VERDICT" in
  OK*|SAME*)
    log "  ✓ 驗證通過：$(printf '%s' "$VERDICT" | cut -f2-)"
    ;;
  *)
    # 隔離檔叫 .failed 不叫 .json：叫 .json 的話下一次輪替會把它算進「保留 KEEP 份」，一份壞的擠掉一份好的
    FAILED="$DIR/$NAME-$STAMP-$$.failed"
    mkdir -p "$FAILED" && cp "$REC"/*.json "$FAILED"/ 2>/dev/null
    rm -f "$OUT.part"
    cleanup_pull
    log "  ✗ 驗證沒過：$(printf '%s' "$VERDICT" | cut -f2-)"
    log "    已隔離：$FAILED（既有備份未被動過）"
    notify "驗證沒過，這次沒有備份"
    exit 1
    ;;
esac
cleanup_pull

# ───────────────────────── ④ 寫出（內容與上一份相同就不另存）＋輪替 ─────────────────────────
case "$VERDICT" in
  SAME*)
    rm -f "$OUT.part"
    DEST="$PREV"
    log "  · 內容與上一份相同，不另存（最新的仍是 $(basename "$PREV")）"
    ;;
  *)
    mv -f "$OUT.part" "$OUT" || { log "  ✗ 改名失敗：$OUT"; rm -f "$OUT.part"; notify "寫入失敗"; exit 1; }
    DEST="$OUT"
    log "  ✓ 本機：$(basename "$DEST")（$(wc -c < "$DEST" | tr -d ' ') bytes）"
    # 驗證通過、新檔落地之後才清舊檔
    ls -t "$DIR"/"$NAME"-*.json 2>/dev/null | grep -vxF "$DEST" | tail -n +"$KEEP" | while read -r f; do
      rm -f "$f" && log "    清除舊備份 $(basename "$f")"
    done
    ;;
esac

# ───────────────────────── ⑤ 異地副本 ─────────────────────────
RC=0
SLOT="$NAME-slot$(date +%u).json"        # 1=週一 … 7=週日；不列目錄、不刪檔（TCC）
if [ "$CLOUD" = "-" ]; then
  log "  · 這次不寫異地副本（TSM_BACKUP_CLOUD=-；交給排程）"
elif [ -d "$CLOUD" ]; then
  if cp "$DEST" "$CLOUD/$SLOT.part" 2>/dev/null && mv -f "$CLOUD/$SLOT.part" "$CLOUD/$SLOT" 2>/dev/null; then
    A=$(shasum -a 256 < "$DEST" | cut -d' ' -f1)
    B=$(shasum -a 256 < "$CLOUD/$SLOT" | cut -d' ' -f1)
    if [ "$A" = "$B" ]; then
      log "  ✓ 異地副本 $SLOT"
    else
      log "  ✗ 異地副本 sha256 不符：$CLOUD/$SLOT"
      notify "異地副本 sha256 不符"
      RC=1
    fi
  else
    rm -f "$CLOUD/$SLOT.part" 2>/dev/null
    log "  ✗ 異地副本寫不進去（TCC？檔案可能是別的行程建的）：$CLOUD/$SLOT"
    notify "異地副本寫不進去"
    RC=1
  fi
else
  log "  ✗ 找不到異地資料夾：$CLOUD"
  RC=1
fi

# ───────────────────────── ⑥ 收尾 ─────────────────────────
if [ "$RC" = "0" ]; then
  date '+%Y-%m-%d %H:%M:%S' > "$DIR/LAST-SUCCESS.txt"
  log "── 完成"
else
  log "── 結束（本機那份成功，異地那份失敗）"
fi
exit "$RC"
