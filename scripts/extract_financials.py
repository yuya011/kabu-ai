"""有価証券報告書の XBRL から業績を取り出す。

公開版に決算数値が無いのは J-Quants を載せられないためで、数値そのものが
無いわけではない。有報の「主要な経営指標等の推移」には5期ぶんの売上・利益・
自己資本比率が XBRL でタグ付けされており、EDINET のデータは再配布できる。
取り込み済みの書類は data/edinet_cache/*.tsv に残っているので、
API を叩き直さずにここから組み直せる。

  python scripts/extract_financials.py            # キャッシュにあるものだけ
  python scripts/extract_financials.py --fetch    # 足りない書類は EDINET から取る

出力: data/edinet_raw/financials.jsonl（1社1行。年度の配列を持つ）
"""

import sys
import csv
import io
import re
import json
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import edinet_client as ec  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "edinet_raw"
CACHE = ROOT / "data" / "edinet_cache"
LEDGER = RAW / "_ledger.jsonl"
OUT = RAW / "financials.jsonl"

# 会計基準ごとに要素名が違う。同じ意味のものを順に試して、最初に取れたものを使う。
# 銀行・保険は売上高そのものが無く、経常収益や正味収入保険料が売上に当たる。
FIELDS = {
    "sales": ("NetSalesSummaryOfBusinessResults",
              "RevenueIFRSSummaryOfBusinessResults",
              "RevenuesUSGAAPSummaryOfBusinessResults",
              "OrdinaryIncomeSummaryOfBusinessResults",
              "GrossOperatingRevenueSummaryOfBusinessResults",
              "NetPremiumsWrittenSummaryOfBusinessResultsINS"),
    # 日本基準は経常利益、IFRS・米国基準は税引前利益。意味が違うので画面側で名前を変える
    "pretax": ("OrdinaryIncomeLossSummaryOfBusinessResults",
               "ProfitLossBeforeTaxIFRSSummaryOfBusinessResults",
               "ProfitLossBeforeTaxUSGAAPSummaryOfBusinessResults"),
    "np": ("ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
           "ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
           "NetIncomeLossAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults",
           "NetIncomeLossSummaryOfBusinessResults",
           "ProfitLossIFRSSummaryOfBusinessResults"),
    "assets": ("TotalAssetsSummaryOfBusinessResults",
               "TotalAssetsIFRSSummaryOfBusinessResults",
               "TotalAssetsUSGAAPSummaryOfBusinessResults"),
    "equity": ("NetAssetsSummaryOfBusinessResults",
               "EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
               "EquityAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults"),
    "equity_ratio": ("EquityToAssetRatioSummaryOfBusinessResults",
                     "RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults",
                     "EquityToAssetRatioIFRSSummaryOfBusinessResults",
                     "EquityToAssetRatioUSGAAPSummaryOfBusinessResults"),
    "eps": ("BasicEarningsLossPerShareSummaryOfBusinessResults",
            "BasicEarningsLossPerShareIFRSSummaryOfBusinessResults",
            "BasicEarningsLossPerShareUSGAAPSummaryOfBusinessResults"),
    "bps": ("NetAssetsPerShareSummaryOfBusinessResults",
            "EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults",
            "EquityAttributableToOwnersOfParentPerShareUSGAAPSummaryOfBusinessResults"),
    "roe": ("RateOfReturnOnEquitySummaryOfBusinessResults",
            "RateOfReturnOnEquityIFRSSummaryOfBusinessResults",
            "RateOfReturnOnEquityUSGAAPSummaryOfBusinessResults"),
    "per": ("PriceEarningsRatioSummaryOfBusinessResults",
            "PriceEarningsRatioIFRSSummaryOfBusinessResults",
            "PriceEarningsRatioUSGAAPSummaryOfBusinessResults"),
    "dividend": ("DividendPaidPerShareSummaryOfBusinessResults",),
    "ocf": ("NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults",
            "CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults",
            "CashFlowsFromUsedInOperatingActivitiesUSGAAPSummaryOfBusinessResults"),
    "employees": ("NumberOfEmployees",),
}

# 営業利益は「経営指標等の推移」に無い（日本基準の推移表は経常利益で載る）。
# 損益計算書のタグから取るので、当期と前期の2期ぶんしか揃わない。
OP_ELEMENTS = ("jppfs_cor:OperatingIncome",
               "jpigp_cor:OperatingProfitLossIFRS",
               "jpigp_cor:OperatingIncomeLossIFRS",
               "jpcrp_cor:OperatingIncomeLossUSGAAPSummaryOfBusinessResults")

# 会社独自の拡張タグ。トヨタは売上収益を
# jpcrp030000-asr_E02144-000:OperatingRevenuesIFRSKeyFinancialData で出しており、
# 名前空間に自社の EDINET コードが入るため候補として列挙できない。要素名の形で拾う。
SALES_PATTERN = re.compile(
    r":[A-Za-z]*(NetSales|Revenues?|OperatingRevenues?)[A-Za-z]*"
    r"(SummaryOfBusinessResults|KeyFinancialData)$")

# 推移表に売上が無い会社のための最後の受け皿。損益計算書から取るので当期と前期だけ。
SALES_PL = ("jpigp_cor:RevenueIFRS", "jpigp_cor:SalesRevenuesIFRS",
            "jppfs_cor:NetSales", "jppfs_cor:OperatingRevenue",
            "jppfs_cor:OrdinaryIncome")

YEARS = 5  # 推移表は5期。それ以上は載らない


def num(s):
    """XBRL の欠損は '－'（全角ダッシュ）で入る。空文字と区別せず None にする。"""
    if s is None:
        return None
    s = str(s).strip().replace(",", "")
    if s in ("", "-", "－", "―", "‐", "△", "NA"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def read_facts(doc_id: str, fetch: bool):
    """(要素ID, コンテキストID) → (値, 連結・個別) の索引を作る。

    同じ事実が複数の財務諸表ロールに現れて重複することがある。値は同じなので
    先に出たものを残す。
    """
    path = CACHE / f"{doc_id}.tsv"
    if path.exists():
        body = path.read_text(encoding="utf-8")
        rows = list(csv.reader(io.StringIO(body), delimiter="\t"))
    elif fetch:
        rows = ec.fetch_csv_rows(doc_id)
    else:
        return None
    facts = {}
    for r in rows:
        if len(r) < 9:
            continue
        facts.setdefault((r[0], r[2]), (r[8], r[4]))
    return facts


def ctx(n: int, instant: bool, sub: bool) -> str:
    head = "CurrentYear" if n == 0 else f"Prior{n}Year"
    return f"{head}{'Instant' if instant else 'Duration'}" \
        + ("_NonConsolidatedMember" if sub else "")


def pick(facts, elements, n: int, sub: bool):
    """要素名の候補を順に、期間・時点の両方の文脈で引く。

    自己資本比率は時点、売上高は期間で載る。項目ごとに覚えるより、
    両方を試すほうが会計基準の差にも耐える。
    """
    for elem in elements:
        key = elem if ":" in elem else f"jpcrp_cor:{elem}"
        for instant in (False, True):
            hit = facts.get((key, ctx(n, instant, sub)))
            if hit is not None:
                v = num(hit[0])
                if v is not None:
                    return v
    return None


def pick_sales(facts, n: int, sub: bool):
    """売上高。会計基準と業種で名前が変わるうえ、会社独自のタグで出す会社もある。"""
    v = pick(facts, FIELDS["sales"], n, sub)
    if v is not None:
        return v
    want = ctx(n, False, sub)
    for (elem, c), (raw, _) in facts.items():
        if c == want and SALES_PATTERN.search(elem):
            v = num(raw)
            if v is not None:
                return v
    for elem in SALES_PL:
        hit = facts.get((elem, want))
        if hit is not None and (sub or hit[1] != "個別"):
            v = num(hit[0])
            if v is not None:
                return v
    return None


def pick_op(facts, n: int, sub: bool):
    """営業利益。連結の会社は連結の値だけを採り、個別と混ぜない。"""
    for elem in OP_ELEMENTS:
        hit = facts.get((elem, ctx(n, False, sub)))
        if hit is None:
            continue
        v = num(hit[0])
        if v is None:
            continue
        # 個別の値を連結の欄に混ぜない（連結の会社は個別の営業利益も併記される）
        if not sub and hit[1] == "個別":
            continue
        return v
    return None


def fy_label(fy_end: str, n: int) -> str:
    """決算期の見出し。当期末の日付から n 年戻す。"""
    if not fy_end or len(fy_end) < 7:
        return ""
    try:
        y, m = int(fy_end[:4]), fy_end[5:7]
    except ValueError:
        return ""
    return f"{y - n}/{m}"


def extract(doc_id: str, fetch: bool):
    facts = read_facts(doc_id, fetch)
    if not facts:
        return None

    def dei(name):
        hit = facts.get((f"jpdei_cor:{name}", "FilingDateInstant"))
        return hit[0].strip() if hit else None

    fy_end = dei("CurrentFiscalYearEndDateDEI") or ""
    standard = dei("AccountingStandardsDEI") or ""

    # 連結を出している会社は連結を、単体だけの会社は単体を採る。
    # 推移表は連結と単体が同じ要素名で並ぶので、文脈の接尾辞で選り分ける。
    consolidated = any(k[1] == "CurrentYearInstant" or k[1] == "CurrentYearDuration"
                       for k in facts
                       if k[0].endswith("SummaryOfBusinessResults"))
    sub = not consolidated

    years = []
    for n in range(YEARS):
        row = {"label": fy_label(fy_end, n), "rel": "当期" if n == 0 else f"{n}期前"}
        for field, elements in FIELDS.items():
            row[field] = pick(facts, elements, n, sub)
        # 配当は提出会社の指標として載るので、連結の会社でも単体側から引く
        if row["dividend"] is None and not sub:
            row["dividend"] = pick(facts, FIELDS["dividend"], n, True)
        row["sales"] = pick_sales(facts, n, sub)
        row["op"] = pick_op(facts, n, sub)
        if all(row[f] is None for f in FIELDS):
            continue
        years.append(row)

    if not years:
        return None
    return {
        "doc_id": doc_id,
        "standard": standard,
        "basis": "個別" if sub else "連結",
        "fy_end": fy_end or None,
        "years": years,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true",
                    help="キャッシュに無い書類は EDINET から取得する")
    ap.add_argument("--limit", type=int, default=0)
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

    todo = list(latest.items())
    if args.limit:
        todo = todo[: args.limit]
    print(f"📚 台帳 {len(latest):,} 社。XBRL から業績を組み直します\n", flush=True)

    n_ok = n_miss = 0
    with OUT.open("w", encoding="utf-8") as out:
        for i, (code, r) in enumerate(todo, 1):
            rec = extract(r["doc_id"], args.fetch)
            if rec is None:
                n_miss += 1
                continue
            rec["sec_code"] = code
            rec["submitted"] = (r.get("submit_datetime") or "")[:10] or None
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_ok += 1
            if i % 500 == 0:
                print(f"  ... {i}/{len(todo)}  取得 {n_ok} / 欠落 {n_miss}", flush=True)

    print(f"\n✅ {n_ok:,} 社ぶんを書き出しました（書類が無い・読めない {n_miss} 社）")
    print(f"   {OUT}")


if __name__ == "__main__":
    main()
