"""有報の「主要な顧客ごとの情報」から商流のエッジを取り出す。

売上の10%以上を占める顧客には開示義務があり、名称と金額が載る。
顧客は XBRL の軸として切られていないため、テキストブロックの表を復元して読む。
CSV 出力では表が1本の文字列に潰れるので、type=1 の XBRL を使う。

同じ通信で「関係会社の状況」（資本関係）も一緒に取る。
どちらも type=1 が要るため、別々に取ると通信が倍になる。

    python scripts/extract_customers.py            # 全社
    python scripts/extract_customers.py --limit 50 # 試し
"""

import sys
import json
import time
import argparse
import datetime as dt
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import edinet_client as ec

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "edinet_raw"
LEDGER = RAW / "_ledger.jsonl"
CUSTOMERS = RAW / "customers.jsonl"
AFFILIATES = RAW / "affiliates.jsonl"
DONE = RAW / "_customers_done.jsonl"


def load_done() -> set:
    if not DONE.exists():
        return set()
    out = set()
    with DONE.open(encoding="utf-8") as f:
        for line in f:
            try:
                out.add(json.loads(line)["doc_id"])
            except Exception:
                continue
    return out


_write_lock = threading.Lock()


def append(path: Path, records: list):
    """複数スレッドから追記するので、書き込みは直列化する。"""
    if not records:
        return
    with _write_lock:
        with path.open("a", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.15)
    ap.add_argument("--workers", type=int, default=4,
                    help="同時取得数。1件650KBあり通信が律速なので並列化する")
    args = ap.parse_args()

    codelist = ec.latest_codelist()
    _, full_dict, core_dict = ec.build_name_dicts(codelist)

    ledger = [json.loads(l) for l in LEDGER.open(encoding="utf-8")]
    done = load_done()
    todo = [r for r in ledger if r["doc_id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"📚 台帳 {len(ledger):,} 社 / 済 {len(done):,} → 今回 {len(todo):,} 社\n", flush=True)

    elements = ec.ELEM_CUSTOMERS + (ec.ELEM_AFFILIATE,)
    counts = {"cust": 0, "aff": 0, "named": 0, "done": 0}
    t0 = time.time()

    def handle(r):
        doc_id, sec = r["doc_id"], r["sec_code"]
        frags = ec.fetch_xbrl_fragments(doc_id, elements)

        customers = []
        named = 0
        for e in ec.ELEM_CUSTOMERS:
            for c in ec.extract_customers(frags.get(e, "")):
                rec = ec.resolve(c["raw_name"], full_dict, core_dict)
                if rec and rec["sec"] == sec:
                    continue  # 自社は除く
                customers.append({
                    "doc_id": doc_id, "src_sec": sec, "raw_name": c["raw_name"],
                    "dst_sec": rec["sec"] if rec else None,
                    "dst_name": rec["name"] if rec else None,
                    "amount": c["amount"], "segment": c["segment"],
                })
                if rec:
                    named += 1

        affiliates = []
        for a in ec.extract_affiliates(frags.get(ec.ELEM_AFFILIATE, "")):
            rec = ec.resolve(a["raw_name"], full_dict, core_dict)
            if not rec or rec["sec"] == sec:
                continue
            affiliates.append({
                "doc_id": doc_id, "src_sec": sec, "dst_sec": rec["sec"],
                "dst_name": rec["name"], "raw_name": a["raw_name"],
                "category": a["category"], "voting_pct": a["voting_pct"],
            })

        append(CUSTOMERS, customers)
        append(AFFILIATES, affiliates)
        append(DONE, [{"doc_id": doc_id, "sec_code": sec,
                       "n_customers": len(customers), "n_affiliates": len(affiliates),
                       "at": dt.datetime.now().isoformat(timespec="seconds")}])

        with _write_lock:
            counts["cust"] += len(customers)
            counts["aff"] += len(affiliates)
            counts["named"] += named
            counts["done"] += 1
            i = counts["done"]
        if i % 100 == 0:
            el = time.time() - t0
            print(f"  ... {i}/{len(todo)}  顧客 {counts['cust']:,}（うち上場 {counts['named']:,}）"
                  f" / 資本関係 {counts['aff']:,}  (経過 {el/60:.1f}分, 残り約 {el/i*(len(todo)-i)/60:.0f}分)",
                  flush=True)
        time.sleep(args.sleep)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(handle, todo))

    n_cust, n_named, n_aff = counts["cust"], counts["named"], counts["aff"]

    print(f"\n✅ 顧客 {n_cust:,} 件（上場に名寄せ {n_named:,}）/ 資本関係 {n_aff:,} 件")


if __name__ == "__main__":
    main()
