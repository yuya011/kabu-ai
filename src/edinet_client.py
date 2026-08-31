"""EDINET API v2 クライアントと、有報からの関係データ抽出。

抽出するのは3種類のエッジ源:
  A. 関係会社の状況     … 資本関係(子会社・持分法)。XBRL(type=1)の HTML表を復元して取る
  B. 特定投資株式の明細 … 政策保有株。CSV(type=5)に詳細タグ付けされている
  C. 大株主の状況       … 上位10大株主。同じく詳細タグ付け

名寄せは EDINETコードリストの正式社名に対する完全一致で行う。
J-Quants の CoName は短縮表記(「昴」「極洋」等)のため部分一致に頼ると精度が3割まで落ちる
(scripts/edinet_graph_probe.py での実測)。よって完全一致のみを採用する。
"""

import os
import io
import re
import csv
import json
import html
import time
import zipfile
import unicodedata
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict

import pandas as pd
from bs4 import BeautifulSoup
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("EDINET_API")
LIST_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
DOC_URL = "https://api.edinet-fsa.go.jp/api/v2/documents/{doc_id}"
CODELIST_URL = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"
HEADERS = {"User-Agent": "KabuAI-Research/1.0"}

DATA_DIR = ROOT / "data"
CODELIST_DIR = DATA_DIR / "edinet_codelist"
CACHE_DIR = DATA_DIR / "edinet_cache"
for _d in (CODELIST_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

ELEM_AFFILIATE = "jpcrp_cor:OverviewOfAffiliatedEntitiesTextBlock"
# 「主要な顧客ごとの情報」。売上の10%以上を占める顧客に開示義務があり、金額も載る。
# 顧客は XBRL の軸として切られていないため、テキストブロックの表を読むしかない。
ELEM_CUSTOMERS = (
    "jpcrp_cor:InformationForEachOfMainCustomersTextBlock",
    "jpigp_cor:InformationAboutMajorCustomersIFRSTextBlock",
)
ELEM_HOLDING_NAME = "NameOfSecuritiesDetailsOfSpecifiedInvestmentEquitySecurities"
ELEM_HOLDING_SHARES = "NumberOfSharesHeldDetailsOfSpecifiedInvestmentEquitySecurities"
ELEM_HOLDING_VALUE = "BookValueDetailsOfSpecifiedInvestmentEquitySecurities"
# 政策保有には1件ごとに保有目的の記載義務がある。エッジの理由を企業自身の言葉で取れる。
ELEM_HOLDING_PURPOSE = "PurposeOfShareholdingOverviewOfBusinessAlliance"
# 相手方が自社株を持っているか＝持ち合いかどうかのフラグ
ELEM_HOLDING_MUTUAL = "WhetherIssuerOfAforementionedSharesHoldsReportingCompanysShares"
# 大株主は氏名と住所しか詳細タグ付けされておらず、持株比率のタグは存在しない。
# 比率が要るときは MajorShareholdersTextBlock の表を別途パースすること。
# 議決権上位者(NameMajorShareholdersVotingRights)で報告する企業もあるため両方拾う。
# 「提出会社の株式事務の概要」。電子公告の掲載先として自社ドメインが書かれている。
# EDINET も J-Quants も企業サイトの URL を持たないため、ここが唯一の出所。
ELEM_SHARE_ADMIN = "jpcrp_cor:OverviewOfOperationalProceduresForSharesTextBlock"
URL_RE = re.compile(r"https?://[!-~]+")
NOT_OWN_SUFFIX = (
    "nikkei.com", "jpx.co.jp", "edinet-fsa.go.jp", "release.tdnet.info",
    "userlocal.jp", "e-kansa.jp", "pronexus.co.jp", "premium-yutaiclub.jp",
    "takara-print.co.jp", "wjps.jp",
)

ELEM_SHAREHOLDER_NAMES = ("jpcrp_cor:NameMajorShareholders",
                          "jpcrp_cor:NameMajorShareholdersVotingRights")

CORP_FORMS = [
    "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
    "一般社団法人", "一般財団法人", "協同組合", "医療法人", "特定目的会社",
]
CATEGORIES = ["親会社", "連結子会社", "非連結子会社", "持分法適用関連会社",
              "持分法適用非連結子会社", "関連会社", "その他の関係会社"]

# 大株主に頻出する非事業会社。持ち合い関係のノイズになるため除外する。
SHAREHOLDER_NOISE = [
    "信託口", "信託銀行", "カストディ", "CUSTODY", "STATESTREET", "ステートストリート",
    "JPMORGAN", "MORGANSTANLEY", "MERRILL", "BNP", "BNY", "CITIBANK", "GOLDMANSACHS",
    "自己株式", "従業員持株会", "取引先持株会", "共済会", "NORTHERNTRUST",
    "SSBTC", "CLIENTOMNIBUS", "GICPRIVATE", "投信口", "BBHFOR", "THEBANKOFNEWYORK",
]


# ---------------------------------------------------------------- 正規化・名寄せ

def norm(s: str) -> str:
    """NFKC 正規化 + 空白/注記除去。表記ゆれ(全角英数・㈱・（注1）等)を吸収する。"""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("㈱", "株式会社").replace("(株)", "株式会社")
    s = s.replace("㈲", "有限会社").replace("(有)", "有限会社")
    s = s.replace("(同)", "合同会社")
    s = re.sub(r"[（(]\s*注[^)）]*[)）]", "", s)
    s = re.sub(r"[（(]\s*注\d*", "", s)
    s = re.sub(r"[（(][\d\s.,、・※*＊]+[)）]", "", s)
    s = re.sub(r"[※*＊]\s*[\d,、・]*", "", s)
    s = re.sub(r"[【】\[\]]", "", s)
    s = re.sub(r"\s+", "", s)
    for cf in CORP_FORMS:
        s = re.sub(rf"({cf})[\d,、・.]+$", r"\1", s)
    s = re.sub(r"^[\d,、・.]+", "", s)
    return s.strip("　 ,、。・")


def core_name(s: str) -> str:
    """法人格を頭尾から除去した核。「住友化学株式会社」→「住友化学」。"""
    n = norm(s)
    for cf in CORP_FORMS:
        if n.startswith(cf):
            n = n[len(cf):]
        if n.endswith(cf):
            n = n[: -len(cf)]
    return n.strip("　 ,、。・")


def resolve(raw: str, full_dict: dict, core_dict: dict):
    """正式名 → 法人格除去名 → 末尾枝番除去 の順に完全一致を試す。

    末尾の数字は注記の枝番("株式会社要興業6")であることがほぼ全てだが、
    レオパレス21 / ケア21 / No.1 / HODL1 のように社名本体が数字で終わる上場企業も
    4社実在する。枝番除去前の完全一致で先に解決されるため取り違えは起きない。
    """
    nm, cn = norm(raw), core_name(raw)
    if len(cn) < 2:
        return None
    rec = full_dict.get(nm) or core_dict.get(cn)
    if rec:
        return rec
    nm2 = re.sub(r"[\d,、・.]+$", "", nm)
    cn2 = re.sub(r"[\d,、・.]+$", "", cn)
    if len(cn2) >= 2:
        rec = full_dict.get(nm2) or core_dict.get(cn2)
    return rec


def is_shareholder_noise(name: str) -> bool:
    n = norm(name).upper().replace("・", "").replace("(", "").replace(")", "")
    return any(k.upper().replace("・", "") in n for k in SHAREHOLDER_NOISE)


# ---------------------------------------------------------------- コードリスト

def fetch_codelist(snapshot_date: str = None) -> pd.DataFrame:
    """EDINETコードリストを取得し、日付つきスナップショットとして保存する。

    配布されるのは常に「現在」の1本のみで、過去版は取得できない。
    上場廃止・社名変更で辞書から消えた企業は後から遡れないため、
    日次で保存しておかないと過去の有報を読むときに生存バイアスが入る。
    """
    snapshot_date = snapshot_date or time.strftime("%Y-%m-%d")
    path = CODELIST_DIR / f"codelist_{snapshot_date}.parquet"
    if path.exists():
        return pd.read_parquet(path)

    req = urllib.request.Request(CODELIST_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    txt = z.read(z.namelist()[0]).decode("cp932", errors="replace")
    df = pd.read_csv(io.StringIO(txt), skiprows=1, dtype=str)
    df["snapshot_date"] = snapshot_date
    df.to_parquet(path, index=False)
    return df


def latest_codelist() -> pd.DataFrame:
    """保存済みスナップショットのうち最新を返す。無ければ取得する。"""
    snaps = sorted(CODELIST_DIR.glob("codelist_*.parquet"))
    if not snaps:
        return fetch_codelist()
    return pd.read_parquet(snaps[-1])


def build_name_dicts(codelist: pd.DataFrame):
    """正式社名(と法人格除去形) → レコード。上場企業のみ。"""
    listed = codelist[
        (codelist["上場区分"] == "上場") & codelist["証券コード"].notna()
    ].copy()
    full, core = {}, {}
    for name, sec, ec, corp in zip(
        listed["提出者名"], listed["証券コード"],
        listed["ＥＤＩＮＥＴコード"], listed["提出者法人番号"]
    ):
        rec = {"sec": str(sec), "edinet": ec, "corp_number": corp, "name": name}
        full.setdefault(norm(name), rec)
        c = core_name(name)
        if len(c) >= 2:
            core.setdefault(c, rec)
    return listed, full, core


# ---------------------------------------------------------------- API

def fetch_doc_list(date_str: str) -> list:
    """指定日の提出書類一覧。"""
    params = {"date": date_str, "type": 2, "Subscription-Key": API_KEY}
    req = urllib.request.Request(LIST_URL + "?" + urllib.parse.urlencode(params), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        return (json.loads(res.read().decode("utf-8")).get("results") or [])


def _download(doc_id: str, doc_type: int) -> bytes:
    url = DOC_URL.format(doc_id=doc_id) + "?" + urllib.parse.urlencode(
        {"type": doc_type, "Subscription-Key": API_KEY})
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def fetch_csv_rows(doc_id: str) -> list:
    """type=5 (CSV) の行。ローカルキャッシュあり。"""
    cache = CACHE_DIR / f"{doc_id}.tsv"
    if cache.exists():
        body = cache.read_text(encoding="utf-8")
    else:
        body = ""
        try:
            z = zipfile.ZipFile(io.BytesIO(_download(doc_id, 5)))
            for name in z.namelist():
                if "jpcrp" in name and name.endswith(".csv"):
                    body = z.read(name).decode("utf-16", errors="replace")
                    break
        except Exception:
            return []
        cache.write_text(body, encoding="utf-8")
    if not body:
        return []
    return list(csv.reader(io.StringIO(body), delimiter="\t"))


def fetch_affiliate_html(doc_id: str) -> str:
    """type=1 (XBRL生データ) から関係会社の状況のHTMLを取り出す。

    CSV 出力では表組みが1本の文字列に潰れてしまい行を復元できないため、
    資本関係だけは XBRL 側のエスケープされた HTML を使う。
    """
    cache = CACHE_DIR / f"{doc_id}.affiliates.html"
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    frag = ""
    try:
        z = zipfile.ZipFile(io.BytesIO(_download(doc_id, 1)))
        for name in z.namelist():
            if not (name.endswith(".xbrl") and "PublicDoc" in name):
                continue
            body = z.read(name).decode("utf-8", errors="replace")
            m = re.search(rf"<{ELEM_AFFILIATE}[^>]*>(.*?)</{ELEM_AFFILIATE}>", body, re.S)
            if m:
                frag = html.unescape(m.group(1))
                break
    except Exception:
        return ""
    cache.write_text(frag, encoding="utf-8")
    return frag


# ---------------------------------------------------------------- 抽出

def extract_holdings(rows: list) -> list:
    """特定投資株式の明細。コンテキストID(CurrentYearInstant_RowNMember)で行が揃う。"""
    by_row = defaultdict(dict)
    for r in rows:
        if len(r) < 9 or not r[8].strip():
            continue
        elem, ctx, val = r[0], r[2], r[8].strip()
        if not ctx.startswith("CurrentYear"):
            continue  # 前年度の列は捨て、当期のみ採用する
        m = re.search(r"Row(\d+)Member", ctx)
        if not m:
            continue
        key = int(m.group(1))
        if ELEM_HOLDING_NAME in elem:
            by_row[key]["raw_name"] = val
        elif ELEM_HOLDING_SHARES in elem:
            by_row[key]["shares"] = val
        elif ELEM_HOLDING_VALUE in elem:
            by_row[key]["book_value"] = val
        elif ELEM_HOLDING_PURPOSE in elem:
            by_row[key]["purpose"] = val
        elif ELEM_HOLDING_MUTUAL in elem:
            by_row[key]["mutual"] = val
    out = []
    for k in sorted(by_row):
        rec = by_row[k]
        if not rec.get("raw_name"):
            continue
        out.append({"row": k, **rec})
    return out


def extract_shareholders(rows: list) -> list:
    """大株主の状況。コンテキストID(CurrentYearInstant_NoNMajorShareholdersMember)が順位を持つ。"""
    out = []
    for r in rows:
        if len(r) < 9 or not r[8].strip():
            continue
        elem, ctx, val = r[0], r[2], r[8].strip()
        if elem not in ELEM_SHAREHOLDER_NAMES:
            continue
        if not ctx.startswith("CurrentYear"):
            continue  # 前年度の列は捨て、当期のみ採用する
        m = re.search(r"No(\d+)", ctx)
        out.append({"rank": int(m.group(1)) if m else None, "raw_name": val})
    out.sort(key=lambda x: x["rank"] if x["rank"] is not None else 99)
    return out


def fetch_xbrl_fragments(doc_id: str, elements) -> dict:
    """type=1 の XBRL から、指定した要素の HTML 断片をまとめて取り出す。

    CSV 出力は表組みを1本の文字列に潰してしまうため、行を復元したい節は
    XBRL 側のエスケープされた HTML を読む。1回の取得で複数の節を拾い、
    節ごとにキャッシュするので、後から別の節が欲しくなっても再取得が要らない。
    """
    want = {e: CACHE_DIR / f"{doc_id}.{e.split(':')[-1]}.html" for e in elements}
    out = {e: p.read_text(encoding="utf-8") for e, p in want.items() if p.exists()}
    missing = [e for e in elements if e not in out]
    if not missing:
        return out

    try:
        z = zipfile.ZipFile(io.BytesIO(_download(doc_id, 1)))
    except Exception:
        return out

    body = ""
    for name in z.namelist():
        if name.endswith(".xbrl") and "PublicDoc" in name:
            body = z.read(name).decode("utf-8", errors="replace")
            break
    for e in missing:
        # 同じ要素が前期と当期の2つ存在することがある（主要な顧客ごとの情報など）。
        # 素朴に最初の一致を取ると前期を掴んでしまうので、contextRef で当期を選ぶ。
        best, best_rank = "", -1
        for m in re.finditer(rf"<{e}([^>]*)>(.*?)</{e}>", body, re.S):
            ctx = re.search(r'contextRef="([^"]+)"', m.group(1))
            ref = ctx.group(1) if ctx else ""
            rank = 2 if ref.startswith("CurrentYear") else (0 if ref.startswith("Prior") else 1)
            if rank > best_rank:
                best, best_rank = m.group(2), rank
        frag = html.unescape(best)
        want[e].write_text(frag, encoding="utf-8")
        out[e] = frag
    return out


def extract_customers(frag: str) -> list:
    """主要な顧客ごとの情報。表の行から 顧客名 / 売上高 / セグメント を取る。"""
    if not frag:
        return []
    soup = BeautifulSoup(frag, "html.parser")
    # 単位は表の見出しか直前の文に「（千円）」「（百万円）」として書かれる
    head = soup.get_text(" ", strip=True)[:400]
    scale = 1_000_000 if "百万円" in head else (1_000 if "千円" in head else 1)
    out = []
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
            cells = [c for c in cells if c]
            if len(cells) < 2:
                continue
            name = cells[0]
            if not name or "顧客の名称" in name or "名称又は氏名" in name:
                continue  # 見出し行
            amount = None
            for c in cells[1:]:
                t = c.replace(",", "").replace("△", "-").strip()
                if re.fullmatch(r"-?\d+(\.\d+)?", t):
                    amount = float(t)
                    break
            segment = cells[-1] if len(cells) >= 3 and not re.fullmatch(
                r"[\d,.\s-]+", cells[-1]) else None
            out.append({"raw_name": name,
                        "amount": None if amount is None else amount * scale,
                        "segment": segment})
    return out


def extract_website(rows: list):
    """株式事務の概要から自社ドメインを取り出す。公告を新聞に載せる会社は取れない。"""
    from urllib.parse import urlparse
    text = ""
    for r in rows:
        if len(r) >= 9 and r[0] == ELEM_SHARE_ADMIN:
            text = r[8]
            break
    if not text:
        return None, None
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


def extract_affiliates(frag: str) -> list:
    """関係会社の状況。HTML表を行単位で復元し、社名・議決権割合・区分を取る。"""
    if not frag:
        return []
    soup = BeautifulSoup(frag, "html.parser")
    out, category = [], ""
    for el in soup.descendants:
        if getattr(el, "name", None) in ("p", "h3", "h4") and el.get_text(strip=True):
            t = norm(el.get_text())
            if len(t) < 40:
                for c in CATEGORIES:
                    if c in t:
                        category = c
                        break
        if getattr(el, "name", None) != "table":
            continue
        for tr in el.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
            cells = [c for c in cells if c]
            if not cells:
                continue
            joined = norm(" ".join(cells))
            for c in CATEGORIES:
                if joined in (c, f"({c})"):
                    category = c
            pct = None
            for c in cells[1:]:
                m = re.search(r"(\d{1,3}\.\d+)", c.replace(",", ""))
                if m:
                    v = float(m.group(1))
                    if 0 < v <= 100:
                        pct = v
                        break
            out.append({"raw_name": cells[0], "voting_pct": pct, "category": category})
    return out
