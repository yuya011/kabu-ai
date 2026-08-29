"""キャッシュ済みの有報から政策保有を取り直す。

生の書類は data/edinet_cache/ に残してあるので、抽出する項目を増やしても
EDINET API を叩き直す必要がない。ここでは保有目的と持ち合いフラグを追加で拾う。

    python scripts/reextract_holdings.py
"""

import sys
import json
import shutil
import datetime as dt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import edinet_client as ec

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "edinet_raw"
LEDGER = RAW / "_ledger.jsonl"
TARGET = RAW / "holdings.jsonl"


def main():
    if not LEDGER.exists():
        print("❌ 台帳がありません")
        sys.exit(1)

    codelist = ec.latest_codelist()
    _, full_dict, core_dict = ec.build_name_dicts(codelist)

    docs = []
    with LEDGER.open(encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
                docs.append((r["doc_id"], r["sec_code"]))
            except Exception:
                continue

    if TARGET.exists():
        backup = TARGET.with_suffix(f".jsonl.bak-{dt.datetime.now():%Y%m%d%H%M}")
        shutil.copy2(TARGET, backup)
        print(f"📦 既存を退避: {backup.name}")

    n_rows = n_purpose = n_mutual = n_docs = 0
    with TARGET.open("w", encoding="utf-8") as out:
        for i, (doc_id, sec) in enumerate(docs, 1):
            if not (ec.CACHE_DIR / f"{doc_id}.tsv").exists():
                continue
            rows = ec.fetch_csv_rows(doc_id)   # キャッシュから読むので通信しない
            if not rows:
                continue
            n_docs += 1
            for h in ec.extract_holdings(rows):
                rec = ec.resolve(h["raw_name"], full_dict, core_dict)
                purpose = (h.get("purpose") or "").strip()
                mutual = (h.get("mutual") or "").strip()
                if purpose:
                    n_purpose += 1
                if mutual:
                    n_mutual += 1
                out.write(json.dumps({
                    "doc_id": doc_id, "src_sec": sec, "row": h["row"],
                    "raw_name": h["raw_name"],
                    "dst_sec": rec["sec"] if rec else None,
                    "dst_name": rec["name"] if rec else None,
                    "shares": h.get("shares"), "book_value": h.get("book_value"),
                    "purpose": purpose or None,
                    "mutual": mutual or None,
                }, ensure_ascii=False) + "\n")
                n_rows += 1
            if i % 500 == 0:
                print(f"  ... {i}/{len(docs)} 社 / {n_rows:,} 件", flush=True)

    print(f"\n✅ {n_docs:,} 社 / 政策保有 {n_rows:,} 件")
    print(f"   保有目的あり  : {n_purpose:,} 件 ({n_purpose/max(n_rows,1)*100:.1f}%)")
    print(f"   持ち合い記載  : {n_mutual:,} 件 ({n_mutual/max(n_rows,1)*100:.1f}%)")


if __name__ == "__main__":
    main()
