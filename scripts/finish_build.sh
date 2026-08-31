#!/usr/bin/env bash
# 抽出の完了を待って、倉庫の再構築からフロントのビルドまで通す。
set -uo pipefail
cd "$(dirname "$0")/.."
source .venv/bin/activate

while pgrep -f extract_customers > /dev/null; do sleep 30; done
echo "=== 抽出完了 ==="; tail -2 data/edinet_raw/customers.log

python3 scripts/extract_filings.py 2>&1 | head -3
python3 scripts/build_warehouse.py --public 2>&1 | tail -11
python3 scripts/export_browser_json.py 2>&1 | tail -5

python3 - <<'EOF'
import json, glob, collections
c = collections.Counter(); n = 0
for f in glob.glob("frontend/public/data/browser/companies/*.json"):
    for d in json.load(open(f)).values():
        for t in d.get("trade", []):
            c[t["direction"]] += 1; n += 1
print(f"\n取引関係 {n:,} 件")
for k, v in c.most_common():
    print(f"  {k:6} {v:,}")
EOF

cd frontend && npm run build 2>&1 | tail -3
echo "=== 完了 ==="
