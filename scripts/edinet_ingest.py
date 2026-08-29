"""EDINET 有価証券報告書の一括取り込み。

API を毎回叩かずに済むよう、取得したものはローカルに溜める。
  - 生の書類は data/edinet_cache/ にキャッシュ（再抽出しても API を叩かない）
  - 抽出結果は data/edinet_raw/*.jsonl に追記（途中で落ちても失われない）
  - 処理済み doc_id は _ledger.jsonl に記録し、再実行時はスキップする

使い方:
    python scripts/edinet_ingest.py --months 13            # 直近13ヶ月の有報を全社ぶん
    python scripts/edinet_ingest.py --limit 300            # 300社で打ち切り（試し）
    python scripts/edinet_ingest.py --with-affiliates      # 資本関係(XBRL)も取る。1件650KBと重い
"""

import sys
import json
import time
import argparse
import datetime as dt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from src import edinet_client as ec

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "edinet_raw"
LIST_CACHE = RAW_DIR / "doclist"
for _d in (RAW_DIR, LIST_CACHE):
    _d.mkdir(parents=True, exist_ok=True)

LEDGER = RAW_DIR / "_ledger.jsonl"
HOLDINGS = RAW_DIR / "holdings.jsonl"
SHAREHOLDERS = RAW_DIR / "shareholders.jsonl"
AFFILIATES = RAW_DIR / "affiliates.jsonl"


def append_jsonl(path: Path, records: list):
    if not records:
        return
    with path.open("a", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def done_doc_ids() -> set:
    if not LEDGER.exists():
        return set()
    out = set()
    with LEDGER.open(encoding="utf-8") as f:
        for line in f:
            try:
                out.add(json.loads(line)["doc_id"])
            except Exception:
                continue
    return out


def collect_filings(months: int) -> list:
    """直近 months ヶ月の有価証券報告書(上場企業)を列挙する。日付ごとにキャッシュ。"""
    today = dt.date.today()
    start = today - dt.timedelta(days=int(months * 30.5))
    filings, day = [], start
    n_days = 0
    while day <= today:
        if day.weekday() < 5:  # 土日は提出がない
            ds = day.isoformat()
            cache = LIST_CACHE / f"{ds}.json"
            if cache.exists():
                results = json.loads(cache.read_text(encoding="utf-8"))
            else:
                try:
                    results = ec.fetch_doc_list(ds)
                except Exception as e:
                    print(f"  ⚠️ {ds}: {e}", flush=True)
                    results = []
                cache.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
                time.sleep(0.25)
            hits = [x for x in results
                    if x.get("docTypeCode") == "120" and x.get("secCode")]
            filings.extend(hits)
            n_days += 1
            if n_days % 40 == 0:
                print(f"  📅 {ds} まで走査: 有報 {len(filings)} 件", flush=True)
        day += dt.timedelta(days=1)
    return filings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=13)
    ap.add_argument("--limit", type=int, default=0, help="0 なら全件")
    ap.add_argument("--with-affiliates", action="store_true",
                    help="資本関係(XBRL type=1)も取得する。1件650KBと重い")
    args = ap.parse_args()

    if not ec.API_KEY:
        print("❌ .env に EDINET_API がありません")
        sys.exit(1)

    # コードリストは日次スナップショットとして保存する。
    # 配布されるのは常に現在の1本だけで、上場廃止・社名変更で消えた企業は後から遡れない。
    codelist = ec.fetch_codelist()
    listed, full_dict, core_dict = ec.build_name_dicts(codelist)
    print(f"📚 コードリスト {len(codelist)}社 / 上場 {len(listed)}社 を名寄せ辞書に展開\n", flush=True)

    print(f"📡 直近{args.months}ヶ月の有価証券報告書を列挙...", flush=True)
    filings = collect_filings(args.months)

    # 同一企業が複数期の有報を出している場合は最新のみ採用する
    latest = {}
    for f in sorted(filings, key=lambda x: x.get("submitDateTime") or ""):
        latest[f["secCode"]] = f
    targets = list(latest.values())
    print(f"✅ 有報 {len(filings)} 件 → 企業単位に集約して {len(targets)} 社\n", flush=True)

    done = done_doc_ids()
    todo = [t for t in targets if t["docID"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"🎯 取得済み {len(done)} 件をスキップ → 今回 {len(todo)} 件を処理\n", flush=True)

    t0 = time.time()
    n_hold = n_share = n_aff = 0
    for i, d in enumerate(todo, 1):
        doc_id, sec = d["docID"], d["secCode"]
        rows = ec.fetch_csv_rows(doc_id)
        holdings, shareholders, affiliates = [], [], []

        for h in ec.extract_holdings(rows):
            rec = ec.resolve(h["raw_name"], full_dict, core_dict)
            holdings.append({
                "doc_id": doc_id, "src_sec": sec, "row": h["row"],
                "raw_name": h["raw_name"],
                "dst_sec": rec["sec"] if rec else None,
                "dst_name": rec["name"] if rec else None,
                "shares": h.get("shares"), "book_value": h.get("book_value"),
                # エッジの理由。有報に記載義務があり、生成せずに出せる
                "purpose": (h.get("purpose") or "").strip() or None,
                "mutual": (h.get("mutual") or "").strip() or None,
            })

        for s in ec.extract_shareholders(rows):
            if ec.is_shareholder_noise(s["raw_name"]):
                continue
            rec = ec.resolve(s["raw_name"], full_dict, core_dict)
            shareholders.append({
                "doc_id": doc_id, "dst_sec": sec, "rank": s["rank"],
                "raw_name": s["raw_name"],
                "src_sec": rec["sec"] if rec else None,
                "src_name": rec["name"] if rec else None,
            })

        if args.with_affiliates:
            for a in ec.extract_affiliates(ec.fetch_affiliate_html(doc_id)):
                rec = ec.resolve(a["raw_name"], full_dict, core_dict)
                if not rec or rec["sec"] == sec:
                    continue
                affiliates.append({
                    "doc_id": doc_id, "src_sec": sec, "dst_sec": rec["sec"],
                    "dst_name": rec["name"], "raw_name": a["raw_name"],
                    "category": a["category"], "voting_pct": a["voting_pct"],
                })

        append_jsonl(HOLDINGS, holdings)
        append_jsonl(SHAREHOLDERS, shareholders)
        append_jsonl(AFFILIATES, affiliates)
        append_jsonl(LEDGER, [{
            "doc_id": doc_id, "sec_code": sec, "filer_name": d.get("filerName"),
            "edinet_code": d.get("edinetCode"),
            "submit_datetime": d.get("submitDateTime"),
            "period_end": d.get("periodEnd"),
            "doc_description": d.get("docDescription"),
            "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
            "n_holdings": len(holdings), "n_shareholders": len(shareholders),
            "n_affiliates": len(affiliates),
            "status": "ok" if rows else "empty",
        }])
        n_hold += len(holdings)
        n_share += len(shareholders)
        n_aff += len(affiliates)

        if i % 25 == 0:
            el = time.time() - t0
            eta = el / i * (len(todo) - i)
            print(f"  ... {i}/{len(todo)}  政策保有 {n_hold} / 大株主 {n_share}"
                  f" / 資本関係 {n_aff}  (経過 {el/60:.1f}分, 残り約 {eta/60:.1f}分)", flush=True)
        time.sleep(0.15)

    print(f"\n✅ 完了: {len(todo)}社 / 政策保有 {n_hold} / 大株主 {n_share} / 資本関係 {n_aff}")
    print(f"   台帳: {LEDGER}")


if __name__ == "__main__":
    main()
