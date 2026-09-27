"""ローカルの倉庫 (data/kabu.duckdb) を組み立てる。

散らばった parquet と、EDINET 取り込みの jsonl を1つの DuckDB に集約する。
API を叩き直さずに済ませるための保存先であり、UI 用 JSON の書き出し元でもある。
倉庫はいつでも生データから作り直せるので、壊れたら消して再実行してよい。

    python scripts/build_warehouse.py
"""

import sys
import json
import argparse
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "edinet_raw"
DB_PATH = DATA / "kabu.duckdb"

# ETF・投信は企業ではないので、企業マスタからは外す
FUND_PATTERN = "ＥＴＦ|ＥＴＮ|上場投信|ファンド|マザーファンド"


def read_jsonl(path: Path) -> pd.DataFrame:
    """取り込み中でも読めるよう、壊れた行は捨てて読む。"""
    if not path.exists():
        return pd.DataFrame()
    records = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # 追記途中の末尾行
    return pd.DataFrame(records)


def load_edinet_financials() -> pd.DataFrame:
    """有報の「主要な経営指標等の推移」を1年1行に開く。

    J-Quants の決算は公開版に載せられないが、こちらは EDINET 由来なので載せられる。
    年1回・5期ぶんと粒度は粗い代わりに、全上場企業ぶんが揃う。
    """
    df = read_jsonl(RAW / "financials.jsonl")
    if not len(df):
        return df
    rows = []
    for r in df.itertuples():
        for i, y in enumerate(r.years):
            rows.append({"sec_code": r.sec_code, "doc_id": r.doc_id,
                         "standard": r.standard, "basis": r.basis,
                         "submitted": r.submitted, "n": i, **y})
    return pd.DataFrame(rows)


def load_companies_public() -> pd.DataFrame:
    """EDINETコードリストだけで企業マスタを組む。

    J-Quants 由来のデータは再配布に制限があるため、公開版では使わない。
    社名・業種・決算日・資本金は EDINET が持っているので、これだけで graph は成立する。
    失うのは市場区分(プライム等)と TOPIX 規模区分で、どちらも J-Quants 固有。
    """
    snaps = sorted((DATA / "edinet_codelist").glob("codelist_*.parquet"))
    if not snaps:
        raise SystemExit("❌ EDINETコードリストがありません")
    cl = pd.read_parquet(snaps[-1])

    # 上場の判定はコードリストの「上場区分」ではなく取り込み台帳を基準にする。
    # 区分は実態とずれることがあり、サッポロホールディングスは子会社名
    # 「サッポロビール株式会社」で登録されていて社名から引けない。
    # EDINET API の secCode は上場企業にしか付かないので、台帳の方が確かである。
    ledger = read_jsonl(RAW / "_ledger.jsonl")
    listed_codes = set()
    ledger_names = {}
    if len(ledger):
        for c, n in zip(ledger["sec_code"], ledger["filer_name"]):
            if isinstance(c, str) and c:
                listed_codes.add(c)
                if isinstance(n, str):
                    ledger_names.setdefault(c, n)

    cl = cl[((cl["上場区分"] == "上場") & cl["証券コード"].notna())
            | cl["証券コード"].isin(listed_codes)].copy()
    # 台帳にしかない上場企業を補う
    known = set(cl["証券コード"].dropna())
    missing = [c for c in listed_codes if c not in known]
    if missing:
        cl = pd.concat([cl, pd.DataFrame({
            "証券コード": missing,
            "提出者名": [ledger_names.get(c, c) for c in missing],
            "提出者名（英字）": [None] * len(missing),
            "提出者業種": [None] * len(missing),
            "ＥＤＩＮＥＴコード": [None] * len(missing),
            "提出者法人番号": [None] * len(missing),
            "決算日": [None] * len(missing),
            "資本金": [None] * len(missing),
        })], ignore_index=True)
    # 台帳の社名を優先する（コードリストが子会社名で登録している場合があるため）
    cl["提出者名"] = [ledger_names.get(c, n) for c, n in zip(cl["証券コード"], cl["提出者名"])]

    df = cl.rename(columns={
        "証券コード": "sec_code", "提出者名": "name",
        "提出者名（英字）": "name_en", "提出者業種": "s33_name",
        "ＥＤＩＮＥＴコード": "edinet_code", "提出者法人番号": "corp_number",
        "決算日": "fiscal_year_end", "資本金": "capital",
    })
    df["formal_name"] = df["name"]
    # 業種コードは色分けに使うだけなので、業種名から安定した番号を振る
    industries = sorted(df["s33_name"].dropna().unique())
    order = {v: str(i) for i, v in enumerate(industries)}
    df["s33_name"] = df["s33_name"].fillna("その他")
    industries = sorted(df["s33_name"].dropna().unique())
    order = {v: str(i) for i, v in enumerate(industries)}
    df["s33"] = df["s33_name"].map(order)
    df["s17"] = df["s33"]
    df["s17_name"] = df["s33_name"]
    df["scale"] = ""
    # 市場区分は有報の「上場金融商品取引所名」から（scripts/extract_markets.py）。
    # J-Quants と JPX の一覧は公開サイトに載せられない
    mk = read_jsonl(RAW / "markets.jsonl")
    by_code = dict(zip(mk.sec_code, mk.market)) if len(mk) else {}
    df["market"] = df["sec_code"].map(by_code).fillna("")
    df["margin_type"] = ""
    cols = ["sec_code", "name", "name_en", "s17", "s17_name", "s33", "s33_name",
            "scale", "market", "margin_type", "formal_name", "edinet_code",
            "corp_number", "fiscal_year_end", "capital"]
    return df[cols].drop_duplicates(subset=["sec_code"])


def load_companies() -> pd.DataFrame:
    m = pd.read_parquet(DATA / "master.parquet")
    m = m[~((m["S33Nm"] == "その他") & (m["MktNm"] == "その他"))]
    m = m[~m["CoName"].str.contains(FUND_PATTERN, na=False)]
    df = m.rename(columns={
        "Code": "sec_code", "CoName": "name", "CoNameEn": "name_en",
        "S17": "s17", "S17Nm": "s17_name", "S33": "s33", "S33Nm": "s33_name",
        "ScaleCat": "scale", "MktNm": "market", "MrgnNm": "margin_type",
    })[["sec_code", "name", "name_en", "s17", "s17_name", "s33", "s33_name",
        "scale", "market", "margin_type"]]

    # EDINETコードリストから正式社名・EDINETコード・法人番号を付ける。
    # 法人番号は社名変更しても変わらないので、名寄せの主キーに使える。
    snaps = sorted((DATA / "edinet_codelist").glob("codelist_*.parquet"))
    if snaps:
        cl = pd.read_parquet(snaps[-1])
        cl = cl[cl["証券コード"].notna()][
            ["証券コード", "提出者名", "ＥＤＩＮＥＴコード", "提出者法人番号", "決算日", "資本金"]
        ].rename(columns={
            "証券コード": "sec_code", "提出者名": "formal_name",
            "ＥＤＩＮＥＴコード": "edinet_code", "提出者法人番号": "corp_number",
            "決算日": "fiscal_year_end", "資本金": "capital",
        }).drop_duplicates(subset=["sec_code"])
        df = df.merge(cl, on="sec_code", how="left")
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--public", action="store_true",
                    help="J-Quants 由来のデータを含めない（再配布に制限があるため）")
    args = ap.parse_args()

    if DB_PATH.exists():
        DB_PATH.unlink()
    con = duckdb.connect(str(DB_PATH))

    def register(name: str, df: pd.DataFrame):
        if df is None or df.empty:
            print(f"   ⏭️  {name}: データなし")
            return
        con.register(f"_{name}", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM _{name}")
        con.unregister(f"_{name}")  # 一時ビューを残すと SHOW TABLES が二重に見える
        print(f"   ✅ {name}: {len(df):,} 行")

    print("🏗  倉庫を構築中...\n")

    if args.public:
        print("▸ 企業マスタ（EDINET のみ・J-Quants 由来は除外）")
        register("companies", load_companies_public())
        print("   ⏭️  決算・サプライズは公開版に含めません")
        register("financials", pd.DataFrame())
        register("surprise_events", pd.DataFrame())
    else:
        print("▸ 企業マスタ")
        register("companies", load_companies())

        print("▸ 決算 (J-Quants)")
        fins = pd.read_parquet(DATA / "fins_extended.parquet")
        fins = fins.rename(columns={"Code": "sec_code", "DiscDate": "disc_date"})
        register("financials", fins)

        print("▸ 決算サプライズ検証データ")
        clean = pd.read_parquet(DATA / "extended_clean_dataset.parquet")
        keep = ["DiscDate", "Code", "CoName", "DocType", "CurPerType", "S17Nm",
                "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
                "raw_5d_return", "excess_return"]
        keep = [c for c in keep if c in clean.columns]
        register("surprise_events", clean[keep].rename(
            columns={"DiscDate": "disc_date", "Code": "sec_code", "CoName": "name"}))

    print("▸ 有報の業績（EDINET の XBRL より・5期ぶん）")
    register("edinet_financials", load_edinet_financials())

    print("▸ EDINET 取り込み")
    register("holdings", read_jsonl(RAW / "holdings.jsonl"))
    # 有報「主要な顧客ごとの情報」。売上の10%以上を占める顧客に開示義務がある
    register("customers", read_jsonl(RAW / "customers.jsonl"))
    register("shareholders", read_jsonl(RAW / "shareholders.jsonl"))
    register("affiliates", read_jsonl(RAW / "affiliates.jsonl"))
    register("filings", read_jsonl(RAW / "_ledger.jsonl"))

    print("▸ 企業サイト（有報の株式事務の概要より）")
    wsite = RAW / "websites.parquet"
    register("websites", pd.read_parquet(wsite) if wsite.exists() else pd.DataFrame())

    print("▸ EDINET 提出書類の履歴")
    register("filings_recent", read_jsonl(RAW / "filings_recent.jsonl"))

    # 臨時報告書の提出理由と出来事。ニュースの代替として使う
    print("▸ 臨時報告書の出来事")
    register("events", read_jsonl(RAW / "events.jsonl"))

    # Google ニュースと TDnet は公開版に載せられない。
    #   ・Google ニュース: 利用規約が robot による取得・再表示・商用利用を禁じ、
    #     robots.txt も /rss/ を Disallow にしている
    #   ・TDnet: release.tdnet.info の robots.txt が User-agent:* Disallow:/ で全面拒否
    # どちらも手元での私的利用に留め、配信物には含めない。
    if args.public:
        print("   ⏭️  ニュース・TDnet は公開版に含めません（各サービスの規約と robots.txt により）")
        register("news", pd.DataFrame())
        register("disclosures", pd.DataFrame())
        con.close()
        _summary(DB_PATH)
        return

    print("▸ 企業ニュース（Google ニュース RSS・取得日時つき／手元専用）")
    news_files = sorted((ROOT / "data" / "news").glob("articles*.jsonl"))
    news_df = pd.concat([read_jsonl(f) for f in news_files], ignore_index=True) \
        if news_files else pd.DataFrame()
    if len(news_df):
        news_df = news_df.drop_duplicates(subset=["sec_code", "link"])
    register("news", news_df)

    print("▸ TDnet 適時開示")
    tdnet_files = sorted((DATA / "tdnet_disclosures").glob("*.parquet"))
    if tdnet_files:
        td = pd.concat([pd.read_parquet(f) for f in tdnet_files], ignore_index=True)
        register("disclosures", td)

    con.close()
    _summary(DB_PATH)


def _summary(db_path):
    con = duckdb.connect(str(db_path), read_only=True)
    print("\n📊 倉庫の中身:")
    for (t,) in con.execute("SHOW TABLES").fetchall():
        n = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"   {t:20} {n:>8,} 行")
    con.close()
    print(f"\n💾 {db_path}")


if __name__ == "__main__":
    main()
