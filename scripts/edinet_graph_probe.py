"""
フェーズ4 着手前の必須確認: EDINET「関係会社の状況」における上場企業エッジ密度の実測。

有価証券報告書(docTypeCode=120)を N 社分取得し、type=1 (XBRL生データ) に
エスケープ保存された jpcrp_cor:OverviewOfAffiliatedEntitiesTextBlock の HTML表を
行・セル単位で復元して、関係会社名を1件ずつ取り出す。

名寄せは EDINETコードリスト(11,381社の正式社名 ↔ 証券コード)に対する完全一致で行う。
J-Quants の CoName は短縮表記(「昴」「極洋」等)のため部分一致に頼ると誤爆が激しく、
実測で precision 約3割まで落ちることを確認済み。よって完全一致のみを採用する。

親子上場は減少傾向のため、上場企業同士のエッジが薄いとグラフが成立しない。実装前に必ず本スクリプトを通すこと。
"""

import os
import io
import re
import csv
import sys
import json
import time
import html
import zipfile
import argparse
import unicodedata
import urllib.request
import urllib.parse
from pathlib import Path

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

OUT_DIR = ROOT / "data" / "edinet_affiliates"
CACHE_DIR = OUT_DIR / "html_cache"
for d in (OUT_DIR, CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)

AFFILIATE_ELEM = "jpcrp_cor:OverviewOfAffiliatedEntitiesTextBlock"

CORP_FORMS = [
    "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
    "一般社団法人", "一般財団法人", "協同組合", "医療法人", "特定目的会社",
]
# 関係会社区分。表の直前の見出しに現れる。
CATEGORIES = ["親会社", "連結子会社", "非連結子会社", "持分法適用関連会社",
              "持分法適用非連結子会社", "関連会社", "その他の関係会社"]


def norm(s: str) -> str:
    """NFKC 正規化 + 空白/注記除去。表記ゆれ(全角英数・㈱・（注1）等)を吸収する。"""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("㈱", "株式会社").replace("(株)", "株式会社")
    s = s.replace("㈲", "有限会社").replace("(有)", "有限会社")
    s = s.replace("(同)", "合同会社")
    # 注記マーカーを落とす: (注)、(注2、7)、※4、*1、【】、[100.0] など
    s = re.sub(r"[（(]\s*注[^)）]*[)）]", "", s)
    s = re.sub(r"[（(]\s*注\d*", "", s)
    s = re.sub(r"[（(][\d\s.,、・※*＊]+[)）]", "", s)
    s = re.sub(r"[※*＊]\s*[\d,、・]*", "", s)
    s = re.sub(r"[【】\[\]]", "", s)
    s = re.sub(r"\s+", "", s)
    # 注記除去で残った末尾の枝番("住友化学株式会社45" → "住友化学株式会社")を落とす。
    # 社名本体が数字で終わることは稀なため、法人格の直後に続く数字のみを対象にする。
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


def resolve(nm: str, cn: str, full_dict: dict, core_dict: dict):
    """正式名 → 法人格除去名 → 末尾枝番除去 の順に完全一致を試す。

    末尾の数字は注記の枝番("株式会社要興業6")であることがほぼ全てだが、
    レオパレス21 / ケア21 / No.1 / HODL1 のように社名本体が数字で終わる上場企業も
    4社実在する。それらは枝番除去前の完全一致で先に解決されるため取り違えは起きない。
    """
    rec = full_dict.get(nm) or core_dict.get(cn)
    if rec:
        return rec
    nm2 = re.sub(r"[\d,、・.]+$", "", nm)
    cn2 = re.sub(r"[\d,、・.]+$", "", cn)
    if len(cn2) >= 2:
        rec = full_dict.get(nm2) or core_dict.get(cn2)
    return rec


def fetch_json(url: str, params: dict) -> dict:
    params = dict(params, **{"Subscription-Key": API_KEY})
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def load_codelist() -> pd.DataFrame:
    """EDINETコードリスト(正式社名 ↔ 証券コード)。日次で更新されるのでローカルにキャッシュ。"""
    cache = OUT_DIR / "edinet_codelist.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    print("📥 EDINETコードリストを取得...", flush=True)
    req = urllib.request.Request(CODELIST_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as res:
        raw = res.read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    txt = z.read(z.namelist()[0]).decode("cp932", errors="replace")
    df = pd.read_csv(io.StringIO(txt), skiprows=1, dtype=str)
    df.to_parquet(cache, index=False)
    return df


def build_listed_dict(codelist: pd.DataFrame):
    """正式社名(と法人格除去形) → 証券コード。上場企業のみ。"""
    listed = codelist[
        (codelist["上場区分"] == "上場") & codelist["証券コード"].notna()
    ].copy()
    full, core = {}, {}
    for name, sec, ec in zip(listed["提出者名"], listed["証券コード"], listed["ＥＤＩＮＥＴコード"]):
        rec = {"sec": str(sec), "edinet": ec, "name": name}
        full.setdefault(norm(name), rec)
        c = core_name(name)
        if len(c) >= 2:
            core.setdefault(c, rec)
    return listed, full, core


def fetch_affiliate_html(doc_id: str) -> str:
    """type=1 の XBRL 生データから関係会社の状況テキストブロック(HTML)を取り出す。"""
    cache = CACHE_DIR / f"{doc_id}.html"
    if cache.exists():
        return cache.read_text(encoding="utf-8")

    url = DOC_URL.format(doc_id=doc_id) + "?" + urllib.parse.urlencode(
        {"type": 1, "Subscription-Key": API_KEY})
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
    except Exception as e:
        print(f"  ⚠️ 取得失敗 {doc_id}: {e}", flush=True)
        return ""

    frag = ""
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        for name in z.namelist():
            if not (name.endswith(".xbrl") and "PublicDoc" in name):
                continue
            body = z.read(name).decode("utf-8", errors="replace")
            m = re.search(
                rf"<{AFFILIATE_ELEM}[^>]*>(.*?)</{AFFILIATE_ELEM}>", body, re.S)
            if m:
                frag = html.unescape(m.group(1))
                break
    except Exception as e:
        print(f"  ⚠️ 解凍失敗 {doc_id}: {e}", flush=True)
        return ""

    cache.write_text(frag, encoding="utf-8")
    return frag


def parse_entities(frag: str):
    """HTML表を行単位で復元し、(社名セル, 議決権割合, 区分) を抽出する。"""
    if not frag:
        return []
    soup = BeautifulSoup(frag, "html.parser")
    out = []
    category = ""
    for el in soup.descendants:
        if getattr(el, "name", None) in ("p", "h3", "h4") and el.get_text(strip=True):
            t = norm(el.get_text())
            for c in CATEGORIES:
                if c in t and len(t) < 40:
                    category = c
                    break
        if getattr(el, "name", None) != "table":
            continue
        for tr in el.find_all("tr"):
            cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
            cells = [c for c in cells if c]
            if not cells:
                continue
            # 行内に区分見出しだけが入るケース
            joined = norm(" ".join(cells))
            for c in CATEGORIES:
                if joined == c or joined == f"({c})":
                    category = c
            name_cell = cells[0]
            # 議決権割合らしき数値(0〜100 の小数)を行内から拾う
            pct = None
            for c in cells[1:]:
                m = re.search(r"(\d{1,3}(?:\.\d+)?)", c.replace(",", ""))
                if m and "." in m.group(1):
                    v = float(m.group(1))
                    if 0 < v <= 100:
                        pct = v
                        break
            out.append({"raw_name": name_cell, "pct": pct, "category": category})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--dates", nargs="*", default=["2026-06-26", "2026-06-25", "2026-06-24"])
    args = ap.parse_args()

    if not API_KEY:
        print("❌ .env に EDINET_API がありません", file=sys.stderr)
        sys.exit(1)

    codelist = load_codelist()
    listed_df, full_dict, core_dict = build_listed_dict(codelist)
    print(f"📚 EDINETコードリスト: 全{len(codelist)}社 / 上場{len(listed_df)}社")
    print(f"   名寄せ辞書: 正式名 {len(full_dict)}件 / 法人格除去 {len(core_dict)}件\n", flush=True)

    print("📡 有価証券報告書の一覧を取得...", flush=True)
    docs = []
    for d in args.dates:
        try:
            j = fetch_json(LIST_URL, {"date": d, "type": 2})
        except Exception as e:
            print(f"  ⚠️ {d}: {e}", flush=True)
            continue
        res = j.get("results") or []
        hit = [x for x in res if x.get("docTypeCode") == "120" and x.get("secCode")]
        print(f"  📅 {d}: 全{len(res)}件 → 有報(上場){len(hit)}件", flush=True)
        docs.extend(hit)
        time.sleep(0.3)

    seen, targets = set(), []
    for d in docs:
        if d["secCode"] in seen:
            continue
        seen.add(d["secCode"])
        targets.append(d)
        if len(targets) >= args.n:
            break
    print(f"\n🎯 調査対象: {len(targets)}社\n", flush=True)

    rows, edges, unmatched = [], [], []
    for i, d in enumerate(targets, 1):
        frag = fetch_affiliate_html(d["docID"])
        ents = parse_entities(frag)
        self_sec = d["secCode"]
        n_hit = 0
        for e in ents:
            nm, cn = norm(e["raw_name"]), core_name(e["raw_name"])
            if len(cn) < 2:
                continue
            rec = resolve(nm, cn, full_dict, core_dict)
            if rec and rec["sec"] != self_sec:
                n_hit += 1
                edges.append({
                    "src_sec": self_sec, "src_name": d["filerName"],
                    "dst_sec": rec["sec"], "dst_name": rec["name"],
                    "raw_name": e["raw_name"], "pct": e["pct"],
                    "category": e["category"], "docID": d["docID"],
                })
            elif not rec and any(cf in nm for cf in CORP_FORMS):
                unmatched.append({"src_sec": self_sec, "raw_name": e["raw_name"]})
        rows.append({
            "docID": d["docID"], "secCode": self_sec, "filerName": d["filerName"],
            "has_block": bool(frag), "n_entities": len(ents), "n_listed_hits": n_hit,
        })
        if i % 20 == 0:
            print(f"  ... {i}/{len(targets)} 件 (累計エッジ {len(edges)})", flush=True)
        time.sleep(0.15)

    df, ed = pd.DataFrame(rows), pd.DataFrame(edges)
    df.to_parquet(OUT_DIR / "probe_docs.parquet", index=False)
    if len(ed):
        ed.to_parquet(OUT_DIR / "probe_edges.parquet", index=False)
    pd.DataFrame(unmatched).to_parquet(OUT_DIR / "probe_unmatched.parquet", index=False)

    n = len(df)
    print("\n" + "=" * 72)
    print("📊 フェーズ4 密度確認レポート（EDINETコードリスト完全一致）")
    print("=" * 72)
    print(f"調査企業数                      : {n}")
    print(f"「関係会社の状況」取得成功      : {int(df.has_block.sum())}")
    print(f"抽出した関係会社エントリ総数    : {int(df.n_entities.sum())} (1社平均 {df.n_entities.mean():.1f})")
    print(f"うち上場企業に名寄せできた数    : {len(ed)}")
    print(f"名寄せできなかった法人名        : {len(unmatched)} (大半は非上場子会社=正常)")
    print("-" * 72)
    if len(ed):
        uniq = ed.drop_duplicates(subset=["src_sec", "dst_sec"])
        print(f"ユニークな有向エッジ            : {len(uniq)}")
        print(f"エッジを1本以上持つ企業         : {ed.src_sec.nunique()} / {n} ({ed.src_sec.nunique()/n*100:.1f}%)")
        print(f"関与ノード数                    : {len(set(ed.src_sec) | set(ed.dst_sec))}")
        print(f"1社あたり平均エッジ             : {len(uniq)/n:.2f}")
        print("-" * 72)
        print("区分の内訳:")
        for k, v in ed.category.value_counts().items():
            print(f"   {k or '(不明)'}: {v}")
        print("-" * 72)
        print("エッジ一覧:")
        for _, r in uniq.iterrows():
            pct = f"{r.pct}%" if pd.notna(r.pct) else "?"
            print(f"  [{r.category or '?':<12}] {r.src_name} ({r.src_sec}) → {r.dst_name} ({r.dst_sec})  議決権 {pct}")
    else:
        print("⚠️ 上場企業同士のエッジが 0 本。グラフは成立しない。")
    print("=" * 72)


if __name__ == "__main__":
    main()
