"""有報から企業の公式ドメインを取り出す。

EDINET も J-Quants も企業サイトの URL を持たないが、
有報の「提出会社の株式事務の概要」には電子公告の掲載先として自社ドメインが書かれている。
取り込み済みのキャッシュから拾えるので、外部サービスに問い合わせる必要がない。

公告を新聞に載せる会社は URL を持たないため、その場合は空で返す（UI 側で頭文字にフォールバックする）。

    python scripts/extract_websites.py
"""

import re
import csv
import io
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "edinet_cache"
RAW = ROOT / "data" / "edinet_raw"
OUT = RAW / "websites.parquet"

ELEM = "jpcrp_cor:OverviewOfOperationalProceduresForSharesTextBlock"
# URL は ASCII のみ。直後に日本語本文が続くので、非 ASCII で必ず切れる
URL_RE = re.compile(r"https?://[!-~]+")

# 自社サイトではなく、公告代行・官公庁・優待代行のドメイン。自社ドメインとして採用しない。
# pronexus.co.jp は電子公告代行で、25社が同じホストを指していた。
NOT_OWN_SUFFIX = (
    "nikkei.com", "jpx.co.jp", "edinet-fsa.go.jp", "release.tdnet.info",
    "userlocal.jp", "e-kansa.jp", "pronexus.co.jp", "premium-yutaiclub.jp",
    "takara-print.co.jp", "wjps.jp",
)


def pick_domain(text: str):
    """テキストブロック中の最初の自社らしい URL からホストを取る。"""
    for m in URL_RE.finditer(text):
        raw = m.group(0).rstrip(").,;:/】」）")
        try:
            host = urlparse(raw).netloc.lower()
        except ValueError:
            continue
        if not host or host.endswith(".go.jp"):
            continue
        if any(host == d or host.endswith("." + d) for d in NOT_OWN_SUFFIX):
            continue
        return host, raw
    return None, None


def main():
    ledger = RAW / "_ledger.jsonl"
    if not ledger.exists():
        print("❌ 台帳がありません。先に scripts/edinet_ingest.py を実行してください")
        sys.exit(1)

    docs = []
    with ledger.open(encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
                docs.append((r["doc_id"], r["sec_code"]))
            except Exception:
                continue

    rows, n_seen, n_block = [], 0, 0
    for doc_id, sec in docs:
        path = CACHE / f"{doc_id}.tsv"
        if not path.exists():
            continue
        n_seen += 1
        text = ""
        try:
            for r in csv.reader(io.StringIO(path.read_text(encoding="utf-8")), delimiter="\t"):
                if len(r) >= 9 and r[0] == ELEM:
                    text = r[8]
                    break
        except Exception:
            continue
        if not text:
            continue
        n_block += 1
        host, url = pick_domain(text)
        if host:
            rows.append({"sec_code": sec, "doc_id": doc_id, "domain": host, "url": url})

    df = pd.DataFrame(rows).drop_duplicates(subset=["sec_code"])
    df.to_parquet(OUT, index=False)

    print(f"キャッシュ走査        : {n_seen:,} 社")
    print(f"株式事務の記載あり    : {n_block:,} 社 ({n_block/max(n_seen,1)*100:.1f}%)")
    print(f"ドメイン抽出成功      : {len(df):,} 社 ({len(df)/max(n_seen,1)*100:.1f}%)")
    print(f"\n💾 {OUT}")
    print("\n抽出例:")
    print(df.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
