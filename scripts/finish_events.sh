#!/usr/bin/env bash
# 臨時報告書の取得完了を待って、倉庫の再構築からビルドまで通す。
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate
while pgrep -f extract_events > /dev/null; do sleep 30; done
echo "=== 取得完了 ==="; tail -2 data/edinet_raw/events.log
python3 scripts/build_warehouse.py --public 2>&1 | tail -12
python3 scripts/export_browser_json.py 2>&1 | tail -5
python3 - <<'EOF'
import json, glob, collections
c = collections.Counter(); n = 0
for f in glob.glob("frontend/public/data/browser/companies/*.json"):
    for d in json.load(open(f)).values():
        for e in d.get("events", []):
            c[e["kind"]] += 1; n += 1
print(f"\n出来事 {n:,} 件 / 種類 {len(c)}")
for k, v in c.most_common(10):
    print(f"  {v:5,}  {k}")
EOF
cd frontend && npm run build 2>&1 | tail -3
echo "=== 完了 ==="
