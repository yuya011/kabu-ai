"""倉庫からブラウザ用の階層 JSON を書き出す。

3階層に分けてあり、上から下へ絞り込む導線になっている。
API を毎回叩かず、ここで作った静的ファイルだけを読ませる。

  index.json              全体像。業種タイル・市場区分・全社サマリ
  sectors/{s17}.json      その業種の企業一覧（軽量行）
  companies/{XX}.json     証券コード上2桁ごとの詳細シャード（財務・サプライズ・政策保有・大株主）

    python scripts/export_browser_json.py
"""

import json
import math
from pathlib import Path
from collections import defaultdict

import duckdb
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "kabu.duckdb"
OUT = ROOT / "frontend" / "public" / "data" / "browser"


def num(v):
    """J-Quants の数値は文字列で入っており、欠損は空文字・'-'・'－' で来る。"""
    if v is None:
        return None
    if isinstance(v, (int, float, np.integer, np.floating)):
        return None if (isinstance(v, float) and math.isnan(v)) else float(v)
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "－", "―", "nan", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def ratio(a, b):
    a, b = num(a), num(b)
    if a is None or b is None or b == 0:
        return None
    return round(a / b, 6)


def norm_code(v):
    """証券コードの正規化。欠損は None。
    pandas から来る欠損は NaN(float) で、真偽値としては True になってしまうため、
    素の `if not v` では弾けない。"""
    if v is None or isinstance(v, float):
        return None
    v = str(v).strip()
    return v if v and v.lower() != "nan" else None


# 持ち合いフラグは「無(注)２」のような表記ゆれで来る
_MUTUAL_RE = __import__("re").compile(r"^[（(]?\s*([有無])")


def mutual_flag(v):
    if not isinstance(v, str):
        return None
    m = _MUTUAL_RE.match(v.strip())
    return m.group(1) if m else None


# 記載なしを表すだけの値。文字数で切ると「業界動向の把握」(7文字)のような
# 短くても中身のある記述まで落ちてしまうため、この集合で判定する。
_NO_PURPOSE = {"－", "-", "―", "ー", "‐", "同上", "―――", "非開示", "記載なし", "該当なし", ""}


# 「（注）１．２．」のように注記番号だけの行も、保有目的を書いていないのと同じ
_ONLY_MARKS = __import__("re").compile(r"^[（(）)注\d\s．.、,・※*＊―ー\-‐]+$")


def useful_purpose(v):
    if not isinstance(v, str):
        return None
    t = v.strip().strip("　")
    if t in _NO_PURPOSE or len(t) < 3 or _ONLY_MARKS.match(t):
        return None
    return t


def clean(o):
    """NaN / numpy 型を JSON が飲める形に落とす。"""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        f = float(o)
        return None if math.isnan(f) else f
    if isinstance(o, float) and math.isnan(o):
        return None
    if isinstance(o, pd.Timestamp):
        return o.strftime("%Y-%m-%d")
    return o


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(obj), ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    return path.stat().st_size


def main():
    con = duckdb.connect(str(DB_PATH), read_only=True)

    companies = con.execute("SELECT * FROM companies").df()
    # 公開版では決算とサプライズを載せない（J-Quants 由来で再配布に制限があるため）。
    # 表が無い状態でも同じ書き出し経路で動くようにする。
    fins = con.execute("SELECT * FROM financials").df() if _has(con, "financials") else pd.DataFrame()
    surprises = (con.execute("SELECT * FROM surprise_events").df()
                 if _has(con, "surprise_events") else pd.DataFrame())
    holdings = con.execute("SELECT * FROM holdings").df() if _has(con, "holdings") else pd.DataFrame()
    shareholders = con.execute("SELECT * FROM shareholders").df() if _has(con, "shareholders") else pd.DataFrame()
    disclosures = con.execute("SELECT * FROM disclosures").df() if _has(con, "disclosures") else pd.DataFrame()
    websites = con.execute("SELECT * FROM websites").df() if _has(con, "websites") else pd.DataFrame()
    filings = con.execute("SELECT * FROM filings").df() if _has(con, "filings") else pd.DataFrame()
    news = con.execute("SELECT * FROM news").df() if _has(con, "news") else pd.DataFrame()
    con.close()

    if not len(fins):
        print("ℹ️  決算・サプライズを含まない公開版として書き出します")
    print(f"📦 企業 {len(companies):,} / 決算 {len(fins):,} / サプライズ {len(surprises):,}"
          f" / 政策保有 {len(holdings):,} / 大株主 {len(shareholders):,}"
          f" / ニュース {len(news):,}")

    # ---- 決算: 企業ごとに新しい順へ
    fins_by_code = {}
    if len(fins):
        fins = fins.sort_values("disc_date", ascending=False)
        fins_by_code = {c: g for c, g in fins.groupby("sec_code")}

    # feat_op_surprise = (累計営業利益 − 通期会社予想) / |通期会社予想| なので、
    # 1Q なら約 -0.75、2Q なら約 -0.5 と、四半期によって水準が決まってしまう。
    # 絶対値の符号には意味がなく、意味を持つのは同日開示内での相対順位だけ
    # (評価パイプラインが日次デミーン + Rank IC を使うのはこのため)。
    surp_by_code = {}
    if len(surprises):
        surprises["pctile"] = surprises.groupby("disc_date")["feat_op_surprise"].rank(pct=True)
        surprises["day_n"] = surprises.groupby("disc_date")["feat_op_surprise"].transform("size")
        surprises = surprises.sort_values("disc_date", ascending=False)
        surp_by_code = {c: g for c, g in surprises.groupby("sec_code")}

    name_by_code = dict(zip(companies.sec_code, companies.name))
    domain_by_code = dict(zip(websites.sec_code, websites.domain)) if len(websites) else {}
    url_by_code = dict(zip(websites.sec_code, websites.url)) if len(websites) else {}
    # 最新の有価証券報告書。docID があれば PDF と EDINET の書類画面に直接飛べる
    doc_by_code = {}
    if len(filings):
        f = filings.sort_values("submit_datetime").drop_duplicates("sec_code", keep="last")
        doc_by_code = dict(zip(f.sec_code, zip(f.doc_id, f.submit_datetime)))
    hold_by_src = defaultdict(list)
    held_by_dst = defaultdict(list)
    if len(holdings):
        for r in holdings.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            purpose = useful_purpose(getattr(r, "purpose", None))
            mutual = mutual_flag(getattr(r, "mutual", None))
            rec = {"code": dst, "name": r.dst_name if dst else None, "raw": r.raw_name,
                   "shares": num(r.shares), "value": num(r.book_value),
                   "purpose": purpose, "mutual": mutual}
            if src:
                hold_by_src[src].append(rec)
            if dst and src:
                held_by_dst[dst].append({
                    "code": src,
                    "name": name_by_code.get(src, src),
                    "value": num(r.book_value),
                    "purpose": purpose, "mutual": mutual,
                })

    share_by_code = defaultdict(list)
    if len(shareholders):
        for r in shareholders.sort_values("rank").itertuples():
            dst = norm_code(r.dst_sec)
            if dst:
                share_by_code[dst].append(
                    {"rank": r.rank, "name": r.raw_name, "code": norm_code(r.src_sec)})

    # ニュースは掲載日の新しい順。fetched_at は「いつ観測したか」であり、
    # 後から検証に使うときにこの時刻より前の記事を混ぜてはいけない目印になる。
    news_by_code = defaultdict(list)
    if len(news):
        for r in news.sort_values("published", ascending=False).itertuples():
            c = norm_code(r.sec_code)
            if c:
                news_by_code[c].append({
                    "title": r.title, "link": r.link, "source": r.source,
                    "published": r.published, "fetched_at": r.fetched_at,
                })

    disc_by_code = defaultdict(list)
    if len(disclosures):
        for r in disclosures.itertuples():
            disc_by_code[str(r.code)].append(
                {"date": str(r.date), "title": r.title, "url": r.pdf_url})

    # ---- 企業ごとの要約と詳細
    summaries, details = {}, {}
    for c in companies.itertuples():
        code = c.sec_code
        g = fins_by_code.get(code)
        latest = g.iloc[0] if g is not None and len(g) else None

        sales = op = np_ = eps = bps = eqar = None
        f_op = op_progress = period = disc_date = None
        if latest is not None:
            sales, op, np_ = num(latest.Sales), num(latest.OP), num(latest.NP)
            eps, bps, eqar = num(latest.EPS), num(latest.BPS), num(latest.EqAR)
            f_op = num(latest.FOP)
            period = latest.CurPerType
            disc_date = pd.Timestamp(latest.disc_date).strftime("%Y-%m-%d")
            if period != "FY":
                op_progress = ratio(op, f_op)

        sg = surp_by_code.get(code)
        progress = pctile = excess = None
        if sg is not None and len(sg):
            raw = num(sg.iloc[0]["feat_op_surprise"])
            progress = None if raw is None else round(1 + raw, 4)
            pctile = num(sg.iloc[0]["pctile"])
            excess = num(sg.iloc[0]["excess_return"])

        held = hold_by_src.get(code, [])
        summaries[code] = {
            "code": code, "name": c.name, "s33": c.s33_name,
            "market": c.market, "scale": c.scale,
            "sales": sales, "op": op, "np": np_,
            "op_margin": ratio(op, sales),
            "op_progress": op_progress,
            "progress": progress, "pctile": pctile, "excess": excess,
            "period": period, "disc_date": disc_date,
            "n_holdings": len(held), "n_held_by": len(held_by_dst.get(code, [])),
        }

        history = []
        if g is not None:
            for r in g.head(8).itertuples():
                history.append({
                    "date": pd.Timestamp(r.disc_date).strftime("%Y-%m-%d"),
                    "period": r.CurPerType, "doc_type": r.DocType,
                    "sales": num(r.Sales), "op": num(r.OP), "np": num(r.NP),
                    "eps": num(r.EPS), "f_sales": num(r.FSales),
                    "f_op": num(r.FOP), "f_np": num(r.FNP),
                })

        surprise_hist = []
        if sg is not None:
            for r in sg.head(8).itertuples():
                raw = num(r.feat_op_surprise)
                surprise_hist.append({
                    "date": pd.Timestamp(r.disc_date).strftime("%Y-%m-%d"),
                    "period": r.CurPerType,
                    "progress": None if raw is None else round(1 + raw, 4),
                    "pctile": num(r.pctile),
                    "day_n": int(r.day_n),
                    "excess": num(r.excess_return),
                })

        details[code] = {
            **summaries[code],
            "name_en": c.name_en, "s17": c.s17_name,
            "formal_name": getattr(c, "formal_name", None),
            "edinet_code": getattr(c, "edinet_code", None),
            "corp_number": getattr(c, "corp_number", None),
            "fiscal_year_end": getattr(c, "fiscal_year_end", None),
            "capital": num(getattr(c, "capital", None)),
            "margin_type": c.margin_type,
            "domain": domain_by_code.get(code),
            "site_url": url_by_code.get(code),
            "doc_id": doc_by_code.get(code, (None, None))[0],
            "doc_submitted": doc_by_code.get(code, (None, None))[1],
            "eps": eps, "bps": bps, "equity_ratio": eqar,
            "financials": history,
            "surprises": surprise_hist,
            "holdings": sorted(held, key=lambda x: -(x["value"] or 0))[:40],
            "held_by": sorted(held_by_dst.get(code, []),
                              key=lambda x: -(x["value"] or 0))[:40],
            "shareholders": share_by_code.get(code, [])[:10],
            "disclosures": disc_by_code.get(code, [])[:20],
            "news": news_by_code.get(code, [])[:12],
        }

    # ---- 業種タイル（大雑把な入口）
    sectors = []
    for s17, g in companies.groupby("s17_name"):
        codes = list(g.sec_code)
        rows = [summaries[c] for c in codes]
        margins = [r["op_margin"] for r in rows if r["op_margin"] is not None]
        pcts = [r["pctile"] for r in rows if r["pctile"] is not None]
        sectors.append({
            "name": s17,
            "code": g.iloc[0].s17,
            "count": len(codes),
            "with_financials": sum(1 for r in rows if r["sales"] is not None),
            "median_op_margin": round(float(np.median(margins)), 4) if margins else None,
            "measured": len(pcts),
            "median_pctile": round(float(np.median(pcts)), 3) if pcts else None,
            "markets": g.market.value_counts().to_dict(),
        })
    sectors.sort(key=lambda x: -x["count"])

    index = {
        "meta": {
            "generated_at": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
            "company_count": len(companies),
            "filing_count": len(fins),
            "surprise_count": len(surprises),
            "holding_count": int(len(holdings)),
            "holding_companies": int(holdings.src_sec.nunique()) if len(holdings) else 0,
        },
        "sectors": sectors,
        # 全銘柄の軽量な目録。検索とグラフのラベル/ファビコンをこれ1本で賄い、
        # ノードを描くたびに企業ファイルを取りに行かなくて済むようにする。
        "nodes": [[c.sec_code, c.name, c.s17, c.s33_name,
                   domain_by_code.get(c.sec_code) or ""]
                  for c in companies.itertuples()],
        "markets": [{"name": k, "count": int(v)}
                    for k, v in companies.market.value_counts().items()],
        "scales": [{"name": k, "count": int(v)}
                   for k, v in companies.scale.value_counts().items() if k and k != "-"],
    }

    total = write(OUT / "index.json", index)
    print(f"\n▸ index.json  {total/1024:.0f} KB")

    for s in sectors:
        rows = [summaries[c] for c in companies[companies.s17_name == s["name"]].sec_code]
        rows.sort(key=lambda r: -(r["sales"] or 0))
        sub = {}
        for r in rows:
            sub.setdefault(r["s33"], []).append(r["code"])
        subsectors = sorted(
            ({"name": k, "count": len(v)} for k, v in sub.items()),
            key=lambda x: -x["count"])
        sz = write(OUT / "sectors" / f"{s['code']}.json",
                   {"code": s["code"], "name": s["name"],
                    "subsectors": subsectors, "companies": rows})
        total += sz
    print(f"▸ sectors/    {len(sectors)} ファイル")

    shards = defaultdict(dict)
    for code, d in details.items():
        shards[code[:2]][code] = d
    for prefix, obj in shards.items():
        total += write(OUT / "companies" / f"{prefix}.json", obj)
    print(f"▸ companies/  {len(shards)} シャード")

    # --- 近傍グラフ用の隣接リスト ---
    # ho = 政策保有している先 / hi = 政策保有されている元
    # mo = 大株主になっている先 / mi = 大株主に入っている上場企業
    # 企業詳細より桁違いに軽いので、2ホップに広げても取得コストが小さい。
    adj = defaultdict(lambda: {"ho": [], "hi": [], "mo": [], "mi": []})
    if len(holdings):
        for r in holdings.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src or not dst or src == dst:
                continue
            v = num(r.book_value)
            mu = 1 if mutual_flag(getattr(r, "mutual", None)) == "有" else 0
            adj[src]["ho"].append([dst, v, mu])
            adj[dst]["hi"].append([src, v, mu])
    if len(shareholders):
        for r in shareholders.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src or not dst or src == dst:
                continue
            adj[src]["mo"].append(dst)
            adj[dst]["mi"].append(src)
    for a in adj.values():
        a["ho"].sort(key=lambda x: -(x[1] or 0))
        a["hi"].sort(key=lambda x: -(x[1] or 0))

    gshards = defaultdict(dict)
    for c, a in adj.items():
        gshards[c[:2]][c] = a
    for prefix, obj in gshards.items():
        total += write(OUT / "graph" / f"{prefix}.json", obj)
    n_edges = sum(len(a["ho"]) for a in adj.values()) + sum(len(a["mo"]) for a in adj.values())
    print(f"▸ graph/      {len(gshards)} シャード / ノード {len(adj):,} / 有向エッジ {n_edges:,}")
    print(f"\n💾 {OUT}  合計 {total/1024/1024:.1f} MB")


def _has(con, table) -> bool:
    return table in [t[0] for t in con.execute("SHOW TABLES").fetchall()]


if __name__ == "__main__":
    main()
