"""取得済みの提出書類一覧から、企業ごとの開示履歴を作る。

Google ニュースの代替。ニュースは Google の利用規約と robots.txt の双方で
自動取得・再表示が禁じられているため公開版では使えない。
一方 EDINET は公共データ利用規約(PDL1.0)で商用利用まで認められており、
出典を明記すれば配信できる。

書類一覧は取り込み時に data/edinet_raw/doclist/ へ保存済みなので、通信は発生しない。

    python scripts/extract_filings.py
"""

import json
import glob
import argparse
import datetime as dt
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DOCLIST = ROOT / "data" / "edinet_raw" / "doclist"
OUT = ROOT / "data" / "edinet_raw" / "filings_recent.jsonl"

# 有報に必ず添付される確認書と、月次の自己株買付状況は情報量が乏しいので落とす
SKIP_TYPES = {"135", "220"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-company", type=int, default=20)
    args = ap.parse_args()

    files = sorted(DOCLIST.glob("*.json"))
    if not files:
        raise SystemExit("❌ 書類一覧のキャッシュがありません（先に edinet_ingest.py）")

    rows = []
    for f in files:
        try:
            docs = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for d in docs:
            sec = d.get("secCode")
            if not sec or d.get("docTypeCode") in SKIP_TYPES:
                continue
            if d.get("withdrawalStatus") not in (None, "", "0"):
                continue
            rows.append({
                "sec_code": sec,
                "doc_id": d.get("docID"),
                "doc_type": d.get("docTypeCode"),
                "title": (d.get("docDescription") or "").strip(),
                "submitted": (d.get("submitDateTime") or "")[:16],
            })

    df = pd.DataFrame(rows).drop_duplicates(subset=["doc_id"])
    df = df.sort_values("submitted", ascending=False)
    df = df.groupby("sec_code", group_keys=False).head(args.per_company)

    with OUT.open("w", encoding="utf-8") as out:
        for r in df.itertuples(index=False):
            out.write(json.dumps(r._asdict(), ensure_ascii=False) + "\n")

    print(f"走査した日次ファイル : {len(files):,}")
    print(f"開示履歴            : {len(df):,} 件 / {df.sec_code.nunique():,} 社")
    print(f"1社あたり平均        : {len(df)/max(df.sec_code.nunique(),1):.1f} 件")
    print(f"\n💾 {OUT}")
    print("\n種別の内訳（上位）:")
    print(df.title.str.slice(0, 20).value_counts().head(8).to_string())


if __name__ == "__main__":
    main()
