"""有価証券報告書の XBRL から、上場している市場（東証プライム・スタンダード・グロース等）を取り出す。

市場区分は J-Quants と JPX の上場銘柄一覧にもあるが、どちらも公開サイトには載せられない。
  ・J-Quants: 第三者が閲覧できる状態を私的利用と認めていない
  ・JPX: サイトの情報は許諾なく二次利用・再配信できない（サイトのご利用上の注意）
有報の「発行済株式」には上場金融商品取引所名が XBRL でタグ付けされており、
EDINET のデータは公共データ利用規約（PDL1.0）で再配布できる。
取り込み済みの書類は data/edinet_cache/*.tsv に残っているので、ここから組み直す。

有報の提出日時点の市場なので、その後の市場変更（スタンダード→プライム等）は
次の有報まで反映されない。

  python scripts/extract_markets.py            # キャッシュにあるものだけ
  python scripts/extract_markets.py --fetch    # 足りない書類は EDINET から取る

出力: data/edinet_raw/markets.jsonl（1社1行）
"""

import sys
import csv
import io
import re
import json
import argparse
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import edinet_client as ec  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "edinet_raw"
CACHE = ROOT / "data" / "edinet_cache"
LEDGER = RAW / "_ledger.jsonl"
OUT = RAW / "markets.jsonl"

ELEM = ("jpcrp_cor:NameOfFinancialInstrumentsExchangeOnWhichSecuritiesAreListedOrAuthorized"
        "FinancialInstrumentsBusinessAssociationToWhichSecuritiesAreRegistered")
# 要素が無い書類のための受け皿。表を平文にしたもので、市場名はこの中に埋まっている
TEXT = "jpcrp_cor:IssuedSharesTotalNumberOfSharesEtcTextBlock"

# 東証の市場。書き方は「プライム市場」「(プライム)」「プライム」と揺れ、
# 長音も「スタンダ－ド」「スタンダ―ド」と揺れるので、長音の類は落としてから照らす
TSE = (("プライム", "プライム"), ("スタンダド", "スタンダード"), ("グロス", "グロース"),
       ("PROMARKET", "TOKYO PRO Market"))
# 東証に無く地方の取引所だけに上場している会社
LOCAL = (("名古屋", "名証"), ("福岡", "福証"), ("札幌", "札証"))


def classify(raw: str) -> tuple[str | None, list[str]]:
    """(東証の市場 or 地方の取引所, 重複上場している地方の取引所) を返す。

    東証に上場していて市場名が書かれていなければ「東証」とだけ返す（呼び手が別の欄を当たる）。
    書き方は「東京証券取引所プライム市場」のほか、
    「東京、名古屋各証券取引所（東京はプライム市場、名古屋はプレミア市場）」もある。
    名証の市場名（プレミア・メイン・ネクスト）は東証の市場名と重ならないので、
    東証に上場していれば文字列全体から東証の市場名を探してよい。
    """
    s = re.sub(r"[\s\-ー－―‐]+", "", unicodedata.normalize("NFKC", raw or "")).upper()
    local = [name for key, name in LOCAL if key in s]
    if "東京" in s:
        for key, name in TSE:
            if key in s:
                return name, local
        return "東証", local
    if local:
        return local[0], local[1:]
    return None, []


def read_rows(doc_id: str, fetch: bool):
    path = CACHE / f"{doc_id}.tsv"
    if path.exists():
        return list(csv.reader(io.StringIO(path.read_text(encoding="utf-8")), delimiter="\t"))
    if fetch:
        return ec.fetch_csv_rows(doc_id)
    return None


def extract(doc_id: str, fetch: bool):
    rows = read_rows(doc_id, fetch)
    if not rows:
        return None
    # 普通株を先に見る。優先株だけが別の市場ということは無いが、普通株が非上場で
    # 種類株だけ上場している会社（伊藤園の第1種優先株など）もあるので、残りも見る
    vals = sorted(((r[2], r[8]) for r in rows if len(r) >= 9 and r[0] == ELEM),
                  key=lambda cv: "OrdinaryShare" not in cv[0])
    vals += [(r[2], r[8]) for r in rows if len(r) >= 9 and r[0] == TEXT]
    # 東証とだけあって市場名が無いときは、残りの欄（発行済株式の表の本文）で市場名を探す
    fallback = None
    for _, raw in vals:
        market, also = classify(raw)
        if not market:
            continue
        rec = {"market": market, "also": also, "raw": re.sub(r"\s+", " ", raw).strip()[:120]}
        if market != "東証":
            return rec
        fallback = fallback or rec
    return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true",
                    help="キャッシュに無い書類は EDINET から取得する")
    args = ap.parse_args()

    if not LEDGER.exists():
        raise SystemExit("❌ 取り込み台帳がありません。先に edinet_ingest.py を流してください")

    # 同じ会社が複数期を出していれば新しいほうを採る
    latest = {}
    with LEDGER.open(encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            code = r.get("sec_code")
            if not code:
                continue
            prev = latest.get(code)
            if prev is None or (r.get("submit_datetime") or "") >= (prev.get("submit_datetime") or ""):
                latest[code] = r

    print(f"📚 台帳 {len(latest):,} 社。XBRL から上場市場を取り出します\n", flush=True)
    counts: dict[str, int] = {}
    n_miss = 0
    with OUT.open("w", encoding="utf-8") as out:
        for code, r in sorted(latest.items()):
            rec = extract(r["doc_id"], args.fetch)
            if rec is None:
                n_miss += 1
                continue
            rec = {"sec_code": code, "doc_id": r["doc_id"],
                   "as_of": (r.get("submit_datetime") or "")[:10] or None, **rec}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            counts[rec["market"]] = counts.get(rec["market"], 0) + 1

    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"   {k:18s} {v:>5,}")
    print(f"\n✅ {sum(counts.values()):,} 社ぶんを書き出しました（書類が無い・市場が読めない {n_miss} 社）")
    print(f"   {OUT}")


if __name__ == "__main__":
    main()
