#!/usr/bin/env bash
# 有価証券報告書を手元で取り込み、サイトの再生成まで走らせる。
#
# EDINET API は GitHub Actions のランナーからのアクセスを 403 で拒否するため、
# この工程だけは手元（自宅・オフィスの回線）で実行する必要がある。
# 有報の提出は6月下旬に集中するので、7月上旬に1回流せば大半が入る。
#
#   bash scripts/update_edinet_local.sh          # 取り込んで push まで
#   bash scripts/update_edinet_local.sh --no-push # 取り込むだけ
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "❌ .env がありません（EDINET_API が必要）"; exit 1
fi
source .venv/bin/activate

echo "▸ 有価証券報告書の取り込み（差分のみ・台帳で既取得分は飛ばす）"
python scripts/edinet_ingest.py --months 14

echo "▸ 業績の組み直し（取り込んだ XBRL から・API は叩かない）"
python scripts/extract_financials.py

echo "▸ 上場市場の取り出し（有報の上場金融商品取引所名から）"
python scripts/extract_markets.py

echo "▸ 倉庫の構築（公開版・J-Quants 由来を含めない）"
python scripts/build_warehouse.py --public

echo "▸ 配信 JSON の書き出し"
python scripts/export_browser_json.py

if [ "${1:-}" = "--no-push" ]; then
  echo "✅ 取り込み完了（push はしていません）"; exit 0
fi

echo "▸ 取り込んだ生データを push"
git add data/edinet_raw data/edinet_codelist data/news
if git diff --cached --quiet; then
  echo "更新なし"
else
  git commit -m "chore: 有価証券報告書の取り込み $(date '+%Y-%m-%d')"
  git push
  echo "✅ push しました。GitHub Actions がサイトを作り直します"
fi
