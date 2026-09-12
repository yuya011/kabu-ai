"""倉庫からブラウザ用の階層 JSON を書き出す。

3階層に分けてあり、上から下へ絞り込む導線になっている。
API を毎回叩かず、ここで作った静的ファイルだけを読ませる。

  index.json              全体像。業種タイル・市場区分・全社サマリ
  sectors/{s17}.json      その業種の企業一覧（軽量行）
  companies/{XX}.json     証券コード上2桁ごとの詳細シャード（財務・サプライズ・政策保有・大株主）

    python scripts/export_browser_json.py
"""

import sys
import json
import math
from pathlib import Path
from collections import defaultdict

import re
import hashlib

import duckdb
import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.edinet_client import (  # noqa: E402
    norm as ec_norm, core_name as ec_core, is_shareholder_noise, latest_codelist,
)

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "kabu.duckdb"
OUT = ROOT / "frontend" / "public" / "data" / "browser"
# MCP 用。画面用と同じ素材から、サーバーが1件ずつ引ける形に割り直して書く
MCP_OUT = ROOT / "frontend" / "public" / "data" / "mcp"


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


# ---- 実体の名寄せ -------------------------------------------------------
#
# グラフの中心に置けるのは上場企業だけだが、相手方は非上場でもノードとして残す。
# 相手が非上場だからとエッジごと捨てると、大株主の 88%、主要顧客の 74% が失われる。
#
# 3層で解決する。
#   0: 上場企業        … 証券コードを id にする
#   1: EDINET 登録法人  … 非上場だが有報等の提出者。EDINETコードを id にする
#   2: 名前のみ        … EDINET にも無い相手。正規化名のハッシュを id にする
#
# 個人名はノードにしない。大株主には創業家などの個人が 10,027 件現れるが、
# 私人を図に載せる必要がないうえ、同姓同名の取り違えも起こる。
_CORP_TOKEN = re.compile(
    r"株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|㈱|組合|法人|"
    r"銀行|信用金庫|信用組合|公庫|機構|公社|事業団|大学|"
    # 官公庁・自治体も主要顧客として実在する（国土交通省が22社の顧客に挙がる）
    r"[省庁]$|^国|独立行政法人|[都道府県市区町村]$|"
    r"Inc|Corp|Ltd|LLC|L\.P|Co\.|Company|Holdings|Group|PLC|GmbH|S\.A")


class EntityResolver:
    def __init__(self, codelist, ledger=None):
        self.listed_full, self.listed_core = {}, {}
        self.edinet_full, self.edinet_core = {}, {}
        for name, sec, ecode, ind, listed, kind_ in zip(
                codelist["提出者名"], codelist["証券コード"],
                codelist["ＥＤＩＮＥＴコード"], codelist["提出者業種"],
                codelist["上場区分"], codelist["提出者種別"]):
            if not isinstance(name, str):
                continue
            # コードリストには大量保有報告書を出す個人が 3,146 件含まれる。
            # 私人をノードにしないため、種別で落とす。
            if isinstance(kind_, str) and "個人" in kind_:
                continue
            n, c = ec_norm(name), ec_core(name)
            industry = ind if isinstance(ind, str) else ""
            if listed == "上場" and isinstance(sec, str) and sec:
                rec = {"id": str(sec), "name": name, "kind": 0, "industry": industry}
                self.listed_full.setdefault(n, rec)
                if len(c) >= 2:
                    self.listed_core.setdefault(c, rec)
            else:
                rec = {"id": ecode, "name": name, "kind": 1, "industry": industry}
                self.edinet_full.setdefault(n, rec)
                if len(c) >= 2:
                    self.edinet_core.setdefault(c, rec)

        # 取り込み台帳を上場側に足す。EDINET API の secCode は上場企業にしか付かず、
        # コードリストの 上場区分 より実態に近い。サッポロホールディングスは
        # コードリストでは子会社名「サッポロビール」で登録されており引けない。
        if ledger is not None and len(ledger):
            for name, sec in zip(ledger["filer_name"], ledger["sec_code"]):
                if not isinstance(name, str) or not isinstance(sec, str):
                    continue
                rec = {"id": sec, "name": name, "kind": 0, "industry": ""}
                self.listed_full.setdefault(ec_norm(name), rec)
                c = ec_core(name)
                if len(c) >= 2:
                    self.listed_core.setdefault(c, rec)

    def _lookup(self, full, core, raw):
        n, c = ec_norm(raw), ec_core(raw)
        if len(c) < 2:
            return None
        hit = full.get(n) or core.get(c)
        if hit:
            return hit
        n2 = re.sub(r"[\d,、・.]+$", "", n)
        c2 = re.sub(r"[\d,、・.]+$", "", c)
        return full.get(n2) or core.get(c2) if len(c2) >= 2 else None

    def resolve(self, raw, allow_unlisted=True):
        """上場 → EDINET登録 → 名前のみ、の順に解決する。個人名は None。"""
        if not isinstance(raw, str) or not raw.strip():
            return None
        hit = self._lookup(self.listed_full, self.listed_core, raw)
        if hit:
            return hit
        if not allow_unlisted:
            return None
        hit = self._lookup(self.edinet_full, self.edinet_core, raw)
        if hit:
            return hit
        n = ec_norm(raw)
        if not _CORP_TOKEN.search(n):
            return None  # 個人名とみなす
        c = ec_core(raw)
        if len(c) < 2:
            return None
        return {"id": "X" + hashlib.sha1(c.encode("utf-8")).hexdigest()[:9],
                "name": raw.strip(), "kind": 2, "industry": ""}


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
    # XBRL の断片由来で &amp; などがそのまま残ることがある
    t = __import__("html").unescape(v).strip().strip("　")
    if t in _NO_PURPOSE or len(t) < 3 or _ONLY_MARKS.match(t):
        return None
    return t


# 保有目的の文中には取引の方向が企業自身の言葉で書かれている。
# 「同社より飲料用容器等の仕入を行っております」なら相手は仕入先。
# 判定は機械的な語の一致だけで行い、書かれていないものは分類しない。
# 6割は「取引関係の維持・強化のため」のように方向を書いていないので、
# 無理に推測せず未分類のままにする。
# 「サプライチェーン」の一部を仕入先と読んだり、「資金調達」を調達と読んだりしないよう、
# 判定前に紛らわしい語を伏せる
_MASK = __import__("re").compile(r"サプライチェーン|資金調達|調達先の分散|人材の調達")

_RELATION_RULES = [
    ("仕入先", __import__("re").compile(r"仕入|調達|購買|購入先|原材料|部品|外注|委託先|サプライヤー")),
    ("販売先", __import__("re").compile(r"販売先|得意先|納入|受注|供給先|顧客|製品を販売|販売しており")),
    ("業務提携", __import__("re").compile(r"業務提携|協業|アライアンス|共同開発|合弁|パートナー")),
    ("金融取引", __import__("re").compile(r"金融機関|金融取引|融資|借入|資金調達|資金の借|銀行取引|与信")),
]


def relation_of(purpose):
    """保有目的から取引の性質を読む。複数該当なら先に書かれている方を採る。"""
    if not isinstance(purpose, str):
        return None
    text = _MASK.sub("　", purpose)
    best, pos = None, len(text) + 1
    for label, pat in _RELATION_RULES:
        m = pat.search(text)
        if m and m.start() < pos:
            best, pos = label, m.start()
    return best


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
    recent = (con.execute("SELECT * FROM filings_recent").df()
              if _has(con, "filings_recent") else pd.DataFrame())
    customers = (con.execute("SELECT * FROM customers").df()
                 if _has(con, "customers") else pd.DataFrame())
    events = con.execute("SELECT * FROM events").df() if _has(con, "events") else pd.DataFrame()
    # 有報の経営指標等。J-Quants を載せられない公開版でも、これは EDINET 由来なので出せる
    annual = (con.execute("SELECT * FROM edinet_financials ORDER BY sec_code, n").df()
              if _has(con, "edinet_financials") else pd.DataFrame())
    con.close()

    if not len(fins):
        print("ℹ️  決算・サプライズを含まない公開版として書き出します")
    print(f"📦 企業 {len(companies):,} / 決算 {len(fins):,} / サプライズ {len(surprises):,}"
          f" / 有報の業績 {len(annual):,} / 政策保有 {len(holdings):,}"
          f" / 大株主 {len(shareholders):,} / ニュース {len(news):,}")

    # ---- 決算: 企業ごとに新しい順へ
    fins_by_code = {}
    if len(fins):
        fins = fins.sort_values("disc_date", ascending=False)
        fins_by_code = {c: g for c, g in fins.groupby("sec_code")}

    # ---- 有報の業績: 企業ごとに新しい期から順に
    #
    # 売上・利益の名前は会計基準で変わる。日本基準は経常利益、IFRS は税引前利益なので、
    # 画面で見出しを変えられるよう会計基準そのものを持たせる。
    ANNUAL_COLS = ("label", "rel", "sales", "op", "pretax", "np", "assets", "equity",
                   "equity_ratio", "eps", "bps", "roe", "per", "dividend", "ocf",
                   "employees")
    annual_by_code, annual_meta = {}, {}
    if len(annual):
        for code, g in annual.groupby("sec_code"):
            rows = []
            for r in g.itertuples():
                rows.append({c: (getattr(r, c) if c in ("label", "rel") else num(getattr(r, c)))
                             for c in ANNUAL_COLS})
            annual_by_code[code] = rows
            first = g.iloc[0]
            annual_meta[code] = {
                "standard": first["standard"], "basis": first["basis"],
                "submitted": first["submitted"],
            }

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

    # ---- 相手方を上場・非上場の別で名寄せし直す ----
    # 取り込み時は上場企業にしか名寄せしていなかったため、非上場が相手のエッジを
    # 捨てていた。ここで解決し直すことで、再取得なしに非上場ノードを足せる。
    resolver = EntityResolver(latest_codelist(), filings)
    extra_nodes = {}

    def resolve_into(df, raw_col, id_col, name_col, drop_noise=False):
        if not len(df):
            return df
        ids, names = [], []
        for raw in df[raw_col]:
            hit = None
            if not (drop_noise and is_shareholder_noise(raw)):
                hit = resolver.resolve(raw)
            if hit and hit["kind"] > 0:
                extra_nodes.setdefault(hit["id"], hit)
            ids.append(hit["id"] if hit else None)
            names.append(hit["name"] if hit else None)
        df = df.copy()
        df[id_col] = ids
        df[name_col] = names
        return df

    holdings = resolve_into(holdings, "raw_name", "dst_sec", "dst_name")
    customers = resolve_into(customers, "raw_name", "dst_sec", "dst_name")
    shareholders = resolve_into(shareholders, "raw_name", "src_sec", "src_name",
                                drop_noise=True)
    print(f"   名寄せ: 上場のみ → 非上場を含む / 非上場ノード {len(extra_nodes):,} 件")

    # 企業マスタは現時点の上場企業。上場廃止などで載っていない相手が僅かにあるので、
    # 取り込み台帳の提出者名で補う。素の証券コードが画面に出るのを防ぐ。
    name_by_code = {}
    if len(filings):
        for r in filings.itertuples():
            c = norm_code(r.sec_code)
            if c and getattr(r, "filer_name", None):
                name_by_code.setdefault(c, r.filer_name)
    for nid, rec in extra_nodes.items():
        name_by_code.setdefault(nid, rec["name"])
    name_by_code.update(dict(zip(companies.sec_code, companies.name)))
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
            relation = relation_of(purpose)
            rec = {"code": dst, "name": r.dst_name if dst else None, "raw": r.raw_name,
                   "shares": num(r.shares), "value": num(r.book_value),
                   "purpose": purpose, "mutual": mutual, "relation": relation}
            if src:
                hold_by_src[src].append(rec)
            if dst and src:
                held_by_dst[dst].append({
                    "code": src,
                    "name": name_by_code.get(src, src),
                    "value": num(r.book_value),
                    "purpose": purpose, "mutual": mutual,
                    # 相手から見た向きなので反転する。相手が「仕入先」と書いていれば
                    # この会社はその相手にとって仕入先＝この会社から見れば販売先
                    "relation": {"仕入先": "販売先", "販売先": "仕入先"}.get(
                        relation_of(purpose), relation_of(purpose)),
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

    # 臨時報告書の出来事。主要株主の異動・合併の決定など、報道になる事柄そのもの。
    # 提出理由は定型文（法令の条項を引くだけ）なので、出来事の本文がある行を優先する。
    events_by_code = defaultdict(list)
    if len(events):
        for r in events.sort_values("submitted", ascending=False).itertuples():
            c = norm_code(r.sec_code)
            if not c:
                continue
            # DuckDB を経由すると入れ子は numpy 配列で返るので、list 判定では弾かれる
            evs = list(r.events) if r.events is not None and len(r.events) else []
            if not evs:
                continue
            events_by_code[c].append({
                "doc_id": r.doc_id, "submitted": r.submitted,
                "kind": evs[0].get("kind"),
                "body": (evs[0].get("body") or "")[:400],
            })

    # EDINET の提出書類。ニュースの代替として「最近の動き」を示す
    recent_by_code = defaultdict(list)
    if len(recent):
        for r in recent.sort_values("submitted", ascending=False).itertuples():
            c = norm_code(r.sec_code)
            if c:
                recent_by_code[c].append({
                    "doc_id": r.doc_id, "title": r.title,
                    "submitted": r.submitted, "doc_type": r.doc_type,
                })

    # 商流。src が dst を主要顧客として挙げている（= dst が src の売上先）
    sells_to = defaultdict(list)   # この会社の主要顧客
    buys_from = defaultdict(list)  # この会社を主要顧客に挙げている会社
    if len(customers):
        for r in customers.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src:
                continue
            rec = {"code": dst, "name": r.dst_name if dst else None,
                   "raw": r.raw_name, "amount": num(r.amount), "segment": r.segment}
            sells_to[src].append(rec)
            if dst and dst != src:
                buys_from[dst].append({"code": src, "name": name_by_code.get(src, src),
                                       "amount": num(r.amount), "segment": r.segment})

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

        # 決算 (J-Quants) が無い公開版では、有報の当期の値をそのまま業績として出す。
        # 四半期の粒度は落ちるが、空欄のままにするよりは事実が伝わる。
        years = annual_by_code.get(code, [])
        cur = years[0] if years else None
        if sales is None and cur:
            sales, op, np_ = cur["sales"], cur["op"], cur["np"]
            eps, bps, eqar = cur["eps"], cur["bps"], cur["equity_ratio"]
            period = cur["label"]

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
            "n_sells_to": len(sells_to.get(code, [])),
            "n_buys_from": len(buys_from.get(code, [])),
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
            "results": years,
            "standard": annual_meta.get(code, {}).get("standard"),
            "basis": annual_meta.get(code, {}).get("basis"),
            "results_submitted": annual_meta.get(code, {}).get("submitted"),
            "financials": history,
            "surprises": surprise_hist,
            "holdings": sorted(held, key=lambda x: -(x["value"] or 0))[:40],
            "held_by": sorted(held_by_dst.get(code, []),
                              key=lambda x: -(x["value"] or 0))[:40],
            "shareholders": share_by_code.get(code, [])[:10],
            "disclosures": disc_by_code.get(code, [])[:20],
            "news": news_by_code.get(code, [])[:12],
            "filings": recent_by_code.get(code, [])[:12],
            "events": events_by_code.get(code, [])[:8],
            "sells_to": sorted(sells_to.get(code, []),
                               key=lambda x: -(x["amount"] or 0))[:20],
            "buys_from": sorted(buys_from.get(code, []),
                                key=lambda x: -(x["amount"] or 0))[:20],
            "trade": build_trade(code, sells_to, buys_from,
                                 hold_by_src, held_by_dst),
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
            "customer_count": int(len(customers)),
            "annual_companies": len(annual_by_code),
        },
        # 公共データ利用規約(PDL1.0)は出典の明記と、加工した旨の表示を求めている
        "sources": [
            {"name": "EDINET（金融庁）",
             "url": "https://disclosure2.edinet-fsa.go.jp/",
             "license": "公共データ利用規約（PDL1.0）",
             "license_url": "https://disclosure2dl.edinet-fsa.go.jp/guide/static/submit/WZEK0030.html",
             "note": "有価証券報告書の政策保有株・大株主・主要な顧客・株式事務・"
                     "経営指標等の推移の記載をもとに作成"},
        ],
        "sectors": sectors,
        # 全ノードの軽量な目録。検索とグラフのラベル/ファビコンをこれ1本で賄う。
        # 末尾は種別で、0=上場 1=EDINET登録の非上場 2=名前のみ。
        # 中心に置けるのは 0 だけだが、相手方としては 1,2 も描く。
        "nodes": ([[c.sec_code, c.name, c.s17, c.s33_name,
                    domain_by_code.get(c.sec_code) or "", 0]
                   for c in companies.itertuples()]
                  + [[nid, rec["name"], "", rec.get("industry") or "", "", rec["kind"]]
                     for nid, rec in sorted(extra_nodes.items())]),
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
    adj = defaultdict(lambda: {"ho": [], "hi": [], "mo": [], "mi": [], "co": [], "ci": []})
    if len(holdings):
        for r in holdings.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src or not dst or src == dst:
                continue
            v = num(r.book_value)
            mu = 1 if mutual_flag(getattr(r, "mutual", None)) == "有" else 0
            # 保有目的から読める取引の性質。相手側から見た辺では向きを反転する
            rel = relation_of(useful_purpose(getattr(r, "purpose", None)))
            code_of = {"仕入先": 1, "販売先": 2, "業務提携": 3, "金融取引": 4}
            flip = {"仕入先": "販売先", "販売先": "仕入先"}
            adj[src]["ho"].append([dst, v, mu, code_of.get(rel, 0)])
            adj[dst]["hi"].append([src, v, mu, code_of.get(flip.get(rel, rel), 0)])
    if len(shareholders):
        for r in shareholders.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src or not dst or src == dst:
                continue
            adj[src]["mo"].append(dst)
            adj[dst]["mi"].append(src)
    # co = 主要顧客として挙げている先 / ci = この会社を主要顧客に挙げている元
    if len(customers):
        for r in customers.itertuples():
            src, dst = norm_code(r.src_sec), norm_code(r.dst_sec)
            if not src or not dst or src == dst:
                continue
            v = num(r.amount)
            adj[src]["co"].append([dst, v])
            adj[dst]["ci"].append([src, v])
    for a in adj.values():
        for k in ("ho", "hi", "co", "ci"):
            a[k].sort(key=lambda x: -(x[1] or 0))

    gshards = defaultdict(dict)
    for c, a in adj.items():
        gshards[c[:2]][c] = a
    for prefix, obj in gshards.items():
        total += write(OUT / "graph" / f"{prefix}.json", obj)
    n_edges = sum(len(a["ho"]) + len(a["mo"]) + len(a["co"]) for a in adj.values())
    print(f"▸ graph/      {len(gshards)} シャード / ノード {len(adj):,} / 有向エッジ {n_edges:,}")
    print(f"\n💾 {OUT}  合計 {total/1024/1024:.1f} MB")

    write_mcp(index, summaries, details)


def write_mcp(index, summaries, details):
    """MCP サーバー（手元の Python / Cloudflare の Worker）が読む形で書き出す。

    画面用の companies/ は上2桁でまとめた 0.5MB のシャードで、
    1社を引くだけでも全部を読むことになる。画面は近隣の銘柄を続けて開くので
    それで得をするが、MCP は1社ずつ飛び飛びに引かれるので割が合わない。
    Worker の CPU 時間にも収まらない。そこで1社1ファイルに割り直す。

    目録も、画面用（index.json）は非上場の相手方まで含む1万件・830KB あるが、
    MCP で名前しか返せない相手を並べても役に立たないので、上場ぶんだけにする。
    """
    meta = {**index["meta"], "sources": index["sources"]}
    # 目録。[コード, 社名, 17業種コード, 33業種名, ドメイン]
    listed = [[n[0], n[1], n[2], n[3], n[4]] for n in index["nodes"] if n[5] == 0]
    total = write(MCP_OUT / "index.json", {
        "meta": meta,
        "sectors": [{"code": s["code"], "name": s["name"], "count": s["count"]}
                    for s in index["sectors"]],
        "companies": listed,
    })
    print(f"\n▸ mcp/index.json  {total/1024:.0f} KB / 上場 {len(listed):,} 社")

    for code, d in details.items():
        total += write(MCP_OUT / "c" / f"{code}.json", d)
    print(f"▸ mcp/c/          {len(details):,} ファイル")

    # サプライズは全社を横断して並べる。1ファイルにまとめておけば、
    # 順位を出すために全社ぶんを読み直さずに済む。
    rows = []
    for code, r in summaries.items():
        if r.get("pctile") is None:
            continue
        rows.append({"code": code, "name": r["name"], "s33": r["s33"],
                     "s17": (details.get(code) or {}).get("s17"),
                     "period": r.get("period"), "disc_date": r.get("disc_date"),
                     "progress": r.get("progress"), "pctile": r.get("pctile"),
                     "excess": r.get("excess")})
    rows.sort(key=lambda r: -(r["pctile"] or 0))
    total += write(MCP_OUT / "surprise.json", {"count": len(rows), "companies": rows})
    print(f"▸ mcp/surprise.json  {len(rows):,} 件")
    print(f"\n💾 {MCP_OUT}  合計 {total/1024/1024:.1f} MB")


def build_trade(code, sells_to, buys_from, hold_by_src, held_by_dst):
    """取引関係を1本にまとめる。出所は2つある。

      ・有報「主要な顧客ごとの情報」… 売上の10%以上を占める顧客。金額つきだが件数は少ない
      ・政策保有の保有目的の文言    … 方向が読める場合のみ。件数は多いが金額はない

    どちらも企業自身の記載で、こちらで推測を足していない。
    """
    out, seen = [], set()

    def add(rec):
        key = (rec["code"], rec["direction"])
        if rec["code"] and key in seen:
            return
        seen.add(key)
        out.append(rec)

    for t in sorted(sells_to.get(code, []), key=lambda x: -(x["amount"] or 0)):
        add({"code": t["code"], "name": t["name"] or t.get("raw"),
             "direction": "販売先", "amount": t["amount"],
             "segment": t["segment"], "note": None, "source": "主要な顧客の明細"})
    for t in sorted(buys_from.get(code, []), key=lambda x: -(x["amount"] or 0)):
        add({"code": t["code"], "name": t["name"], "direction": "仕入先",
             "amount": t["amount"], "segment": t["segment"],
             "note": None, "source": "相手の主要顧客の明細"})

    for h in sorted(hold_by_src.get(code, []), key=lambda x: -(x["value"] or 0)):
        if h.get("relation") in ("仕入先", "販売先", "業務提携") and h.get("code"):
            add({"code": h["code"], "name": h["name"], "direction": h["relation"],
                 "amount": None, "segment": None, "note": h.get("purpose"),
                 "source": "政策保有の保有目的"})
    for h in sorted(held_by_dst.get(code, []), key=lambda x: -(x["value"] or 0)):
        if h.get("relation") in ("仕入先", "販売先", "業務提携") and h.get("code"):
            add({"code": h["code"], "name": h["name"], "direction": h["relation"],
                 "amount": None, "segment": None, "note": h.get("purpose"),
                 "source": "相手の政策保有の保有目的"})
    return out[:30]


def _has(con, table) -> bool:
    return table in [t[0] for t in con.execute("SHOW TABLES").fetchall()]


if __name__ == "__main__":
    main()
