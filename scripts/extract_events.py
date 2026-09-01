"""臨時報告書から企業の出来事を取り出す。

ニュースの代替。Google ニュースは利用規約と robots.txt の双方で自動取得と
再表示を禁じているため使えないが、臨時報告書は EDINET の公共データ利用規約
(PDL1.0) の下で商用利用まで認められている。

臨時報告書は「主要株主の異動」「親会社・特定子会社の異動」「株式交換・合併の決定」
「経営成績に著しい影響を与える事象」など、報道になる出来事そのものを扱う。
一次情報なので報道より確かで、速いことすらある。

CSV(type=5) が1件あたり平均 3.8KB と軽いので全件取れる。

    python scripts/extract_events.py              # 直近13ヶ月ぶん
    python scripts/extract_events.py --days 180
"""

import io
import csv
import sys
import json
import glob
import time
import zipfile
import argparse
import datetime as dt
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import edinet_client as ec

ROOT = Path(__file__).resolve().parent.parent
DOCLIST = ROOT / "data" / "edinet_raw" / "doclist"
OUT = ROOT / "data" / "edinet_raw" / "events.jsonl"
DONE = ROOT / "data" / "edinet_raw" / "_events_done.jsonl"

REASON = "ReasonForFilingTextBlock"
# 表紙まわりは出来事ではないので、見出しの候補から外す
SKIP = {"PlaceForPublicInspectionCoverPageTextBlock", "FootnotesCoverPageTextBlock",
        REASON}

_lock = threading.Lock()


def append(path: Path, records: list):
    if not records:
        return
    with _lock:
        with path.open("a", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


def done_ids() -> set:
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


def collect(days: int) -> list:
    """キャッシュ済みの書類一覧から臨時報告書を拾う。通信は発生しない。"""
    limit = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    out = []
    for f in sorted(DOCLIST.glob("*.json")):
        if f.stem < limit:
            continue
        try:
            docs = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for d in docs:
            # 180=臨時報告書。190(訂正)は元の報告を上書きするだけなので採らない
            if d.get("docTypeCode") == "180" and d.get("secCode"):
                out.append(d)
    return out


def parse(raw: bytes):
    """提出理由と、出来事の種類を表すテキストブロックを取り出す。"""
    reason, events = "", []
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except Exception:
        return reason, events
    for name in z.namelist():
        if not name.endswith(".csv"):
            continue
        try:
            rows = csv.reader(
                io.StringIO(z.read(name).decode("utf-16", errors="replace")),
                delimiter="\t")
        except Exception:
            continue
        for r in rows:
            if len(r) < 9 or not r[0].endswith("TextBlock"):
                continue
            key = r[0].split(":")[-1]
            body = r[8].strip()
            if len(body) < 20:
                continue
            if key == REASON:
                if len(body) > len(reason):
                    reason = body
            elif key not in SKIP:
                # 項目名から「[テキストブロック]」を落として見出しに使う
                label = r[1].replace("[テキストブロック]", "").strip()
                events.append({"kind": label, "body": body})
    return reason, events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=400)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--sleep", type=float, default=0.12)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    docs = collect(args.days)
    seen = done_ids()
    todo = [d for d in docs if d["docID"] not in seen]
    if args.limit:
        todo = todo[: args.limit]
    print(f"📄 臨時報告書 {len(docs):,} 件 / 済 {len(seen):,} → 今回 {len(todo):,} 件\n", flush=True)

    counts = {"n": 0, "ev": 0}
    t0 = time.time()

    def handle(d):
        try:
            raw = ec._download(d["docID"], 5)
        except Exception:
            append(DONE, [{"doc_id": d["docID"], "status": "error"}])
            return
        reason, events = parse(raw)
        if reason or events:
            append(OUT, [{
                "doc_id": d["docID"], "sec_code": d["secCode"],
                "filer_name": d.get("filerName"),
                "submitted": (d.get("submitDateTime") or "")[:16],
                "reason": reason,
                "events": [{"kind": e["kind"], "body": e["body"][:600]} for e in events[:3]],
            }])
        append(DONE, [{"doc_id": d["docID"], "status": "ok"}])
        with _lock:
            counts["n"] += 1
            counts["ev"] += len(events)
            i = counts["n"]
        if i % 200 == 0:
            el = time.time() - t0
            print(f"  ... {i}/{len(todo)}  出来事 {counts['ev']:,}"
                  f"  (経過 {el/60:.1f}分, 残り約 {el/i*(len(todo)-i)/60:.0f}分)", flush=True)
        time.sleep(args.sleep)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(handle, todo))

    print(f"\n✅ {counts['n']:,} 件 / 出来事 {counts['ev']:,}")


if __name__ == "__main__":
    main()
