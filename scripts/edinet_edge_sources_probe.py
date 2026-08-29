"""
フェーズ4 密度確認 その2: エッジ源の比較計測。

「関係会社の状況」だけではエッジが薄い（100社で14本）ため、有報の他の2つの節も同じ100社で計測し、
どれをグラフの土台にするかを数字で決める。

  A. 関係会社の状況        … 資本関係(子会社・持分法)。edinet_graph_probe.py で計測済み
  B. 特定投資株式の明細    … 政策保有株。定義上すべて上場株なので上場-上場エッジになりやすい
  C. 大株主の状況          … 上位10大株主。信託口・カストディを除くと事業会社の持ち合いが残る

B と C は EDINET の CSV 出力(type=5)で詳細タグ付けされており、HTML パースが不要。
"""

import os
import io
import csv
import sys
import time
import zipfile
import argparse
import importlib.util
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict

import pandas as pd
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

_spec = importlib.util.spec_from_file_location("egp", ROOT / "scripts" / "edinet_graph_probe.py")
egp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(egp)

API_KEY = os.getenv("EDINET_API")
OUT_DIR = ROOT / "data" / "edinet_affiliates"
CSV_CACHE = OUT_DIR / "csv_cache"
CSV_CACHE.mkdir(parents=True, exist_ok=True)

ELEM_HOLDING = "NameOfSecuritiesDetailsOfSpecifiedInvestmentEquitySecurities"
ELEM_SHAREHOLDER = "jpcrp_cor:NameMajorShareholders"

# 大株主に頻出する非事業会社。持ち合いグラフのノイズになるため除外する。
SHAREHOLDER_NOISE = [
    "信託口", "信託銀行", "カストディ", "CUSTODY", "STATESTREET", "ステートストリート",
    "JPMORGAN", "MORGANSTANLEY", "MERRILL", "BNP", "BNY", "CITIBANK", "GOLDMANSACHS",
    "証券株式会社", "自己株式", "従業員持株会", "取引先持株会", "共済会", "NORTHERNTRUST",
    "SSBTC", "CLIENTOMNIBUS", "GICPRIVATE", "生命保険", "損害保険", "投信口",
]


def fetch_csv_rows(doc_id: str):
    """type=5 (CSV) を取得して行を返す。ローカルキャッシュあり。"""
    cache = CSV_CACHE / f"{doc_id}.tsv"
    if cache.exists():
        body = cache.read_text(encoding="utf-8")
    else:
        url = egp.DOC_URL.format(doc_id=doc_id) + "?" + urllib.parse.urlencode(
            {"type": 5, "Subscription-Key": API_KEY})
        req = urllib.request.Request(url, headers=egp.HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                raw = res.read()
        except Exception as e:
            print(f"  ⚠️ 取得失敗 {doc_id}: {e}", flush=True)
            return []
        body = ""
        try:
            z = zipfile.ZipFile(io.BytesIO(raw))
            for name in z.namelist():
                if "jpcrp" in name and name.endswith(".csv"):
                    body = z.read(name).decode("utf-16", errors="replace")
                    break
        except Exception as e:
            print(f"  ⚠️ 解凍失敗 {doc_id}: {e}", flush=True)
            return []
        cache.write_text(body, encoding="utf-8")
    return list(csv.reader(io.StringIO(body), delimiter="\t"))


def is_noise(name: str) -> bool:
    n = egp.norm(name).upper().replace("・", "").replace("(", "").replace(")", "")
    return any(k.upper().replace("・", "") in n for k in SHAREHOLDER_NOISE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--dates", nargs="*", default=["2026-06-26", "2026-06-25", "2026-06-24"])
    args = ap.parse_args()

    codelist = egp.load_codelist()
    listed_df, full_dict, core_dict = egp.build_listed_dict(codelist)
    print(f"📚 上場{len(listed_df)}社の名寄せ辞書を構築\n", flush=True)

    docs = []
    for d in args.dates:
        j = egp.fetch_json(egp.LIST_URL, {"date": d, "type": 2})
        docs.extend([x for x in (j.get("results") or [])
                     if x.get("docTypeCode") == "120" and x.get("secCode")])
        time.sleep(0.3)
    seen, targets = set(), []
    for d in docs:
        if d["secCode"] in seen:
            continue
        seen.add(d["secCode"])
        targets.append(d)
        if len(targets) >= args.n:
            break
    print(f"🎯 調査対象: {len(targets)}社\n", flush=True)

    hold_edges, share_edges = [], []
    raw_counts = defaultdict(int)
    unresolved = defaultdict(list)

    for i, d in enumerate(targets, 1):
        rows = fetch_csv_rows(d["docID"])
        self_sec = d["secCode"]
        for r in rows:
            if len(r) < 9 or not r[8].strip():
                continue
            elem, val = r[0], r[8].strip()
            if ELEM_HOLDING in elem:
                raw_counts["holding_raw"] += 1
                rec = egp.resolve(egp.norm(val), egp.core_name(val), full_dict, core_dict)
                if rec and rec["sec"] != self_sec:
                    hold_edges.append({"src_sec": self_sec, "src_name": d["filerName"],
                                       "dst_sec": rec["sec"], "dst_name": rec["name"],
                                       "raw_name": val, "docID": d["docID"]})
                elif not rec and len(val) > 1:
                    unresolved["holding"].append(val)
            elif elem == ELEM_SHAREHOLDER:
                raw_counts["shareholder_raw"] += 1
                if is_noise(val):
                    raw_counts["shareholder_noise"] += 1
                    continue
                rec = egp.resolve(egp.norm(val), egp.core_name(val), full_dict, core_dict)
                if rec and rec["sec"] != self_sec:
                    share_edges.append({"src_sec": rec["sec"], "src_name": rec["name"],
                                        "dst_sec": self_sec, "dst_name": d["filerName"],
                                        "raw_name": val, "docID": d["docID"]})
                elif not rec and len(val) > 1:
                    unresolved["shareholder"].append(val)
        if i % 20 == 0:
            print(f"  ... {i}/{len(targets)} 件 (政策保有 {len(hold_edges)} / 大株主 {len(share_edges)})", flush=True)
        time.sleep(0.15)

    n = len(targets)
    he = pd.DataFrame(hold_edges)
    se = pd.DataFrame(share_edges)
    if len(he):
        he.to_parquet(OUT_DIR / "probe_holding_edges.parquet", index=False)
    if len(se):
        se.to_parquet(OUT_DIR / "probe_shareholder_edges.parquet", index=False)

    def report(label, ed, raw, extra=""):
        print("-" * 72)
        print(f"■ {label}")
        print(f"   生の記載件数              : {raw}")
        print(f"   上場企業に名寄せ成功      : {len(ed)}" + extra)
        if len(ed):
            u = ed.drop_duplicates(subset=["src_sec", "dst_sec"])
            print(f"   ユニークな有向エッジ      : {len(u)}")
            print(f"   1社あたり平均エッジ       : {len(u)/n:.2f}")
            print(f"   エッジを持つ企業          : {ed.src_sec.nunique() if label.startswith('B') else ed.dst_sec.nunique()} / {n}")
            print(f"   関与ノード数              : {len(set(ed.src_sec) | set(ed.dst_sec))}")

    print("\n" + "=" * 72)
    print(f"📊 エッジ源の密度比較（同一{n}社）")
    print("=" * 72)
    report("B. 特定投資株式(政策保有株)", he, raw_counts["holding_raw"])
    report("C. 大株主の状況", se, raw_counts["shareholder_raw"],
           f" / 信託口等を除外 {raw_counts['shareholder_noise']}件")
    print("-" * 72)

    all_edges = []
    if len(he):
        all_edges.append(he[["src_sec", "dst_sec"]])
    if len(se):
        all_edges.append(se[["src_sec", "dst_sec"]])
    if all_edges:
        merged = pd.concat(all_edges).drop_duplicates()
        nodes = set(merged.src_sec) | set(merged.dst_sec)
        print(f"B+C 統合: ユニーク有向エッジ {len(merged)} / ノード {len(nodes)} / 平均次数 {2*len(merged)/max(len(nodes),1):.2f}")
    print("=" * 72)

    for k, v in unresolved.items():
        s = pd.Series(v).value_counts()
        print(f"\n[{k}] 名寄せ失敗の上位20（辞書改善の手がかり）: 全{len(v)}件 / ユニーク{len(s)}")
        for name, c in s.head(20).items():
            print(f"   {c:>3}回  {name}")


if __name__ == "__main__":
    main()
