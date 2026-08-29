"""企業ニュースの日次収集。

重要な前提:
過去のニュースを後から検索で集めて検証に使うことはできない。
検索が返すのは「現在のインターネット」であり、記事は書き換えられ、削除もされる。
またローカルLLMは学習時点までの記憶を持っているため、プロンプトで「知らないふりをしろ」と
指示しても防げない。したがってこのスクリプトは、
  ・今日以降の記事を、取得日時つきで積み上げるためだけに使う
  ・積んだデータを検証に回せるのは、蓄積が十分になったあと
という運用を前提にしている。表示（ブラウザで最新ニュースを読む）は今日から使えるが、
バックテストの入力に混ぜてよいのは fetched_at 以降に取得した分だけ。

取得元は Google ニュースの RSS。DuckDuckGo はレート制限が厳しく、
GitHub Actions の IP は弾かれやすいため使わない。

    python scripts/news_ingest.py --top 400              # 売上高の大きい400社
    python scripts/news_ingest.py --codes 67580 72030
    python scripts/news_ingest.py --all --rotate 7 --hot 200
        全上場を7日で一周する。毎日は 200(常時) + 約530(その日の担当) ≒ 12分。
        全社を毎日舐めると80分かかるが、ニュースの鮮度は週単位で足りる。
        一方で「毎日どこかの会社を必ず観測する」性質は保たれるので、
        あとで検証に使うときに観測の穴が偏らない。
"""

import re
import sys
import json
import time
import html
import argparse
import datetime as dt
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "kabu.duckdb"
OUT_DIR = ROOT / "data" / "news"
OUT_DIR.mkdir(parents=True, exist_ok=True)
# 月ごとに分ける。1本にすると追記のたびに巨大なファイルが丸ごと差分になり、
# リポジトリに積むと効かない。読む側は articles_*.jsonl を全部舐める。
def store_path(day: dt.date | None = None) -> Path:
    day = day or dt.date.today()
    return OUT_DIR / f"articles_{day:%Y-%m}.jsonl"


def all_stores():
    return sorted(OUT_DIR.glob("articles_*.jsonl")) + (
        [OUT_DIR / "articles.jsonl"] if (OUT_DIR / "articles.jsonl").exists() else [])

FEED = "https://news.google.com/rss/search"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


def fetch_feed(query: str):
    url = f"{FEED}?" + urllib.parse.urlencode(
        {"q": query, "hl": "ja", "gl": "JP", "ceid": "JP:ja"})
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        return ET.fromstring(res.read())


def parse_pubdate(s: str):
    """RSS の日付を ISO に。パースできなければそのまま返す。"""
    for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return s[:16]


def text(v) -> str:
    """pandas の欠損は NaN(float) で来る。`a or b` は NaN を真として通してしまうので明示的に潰す。"""
    if v is None or isinstance(v, float):
        return ""
    return str(v).strip()


def clean_title(t: str) -> str:
    """Google ニュースは「見出し - 媒体名」の形にするので媒体名を落とす。"""
    t = html.unescape(t or "")
    return re.sub(r"\s+-\s+[^-]+$", "", t).strip()


def existing_keys() -> set:
    keys = set()
    for path in all_stores():
        with path.open(encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    keys.add((r["sec_code"], r["link"]))
                except Exception:
                    continue
    return keys


def load_universe() -> pd.DataFrame:
    """対象になりうる企業の一覧と、優先度に使う規模の指標。

    倉庫があればそれを使うが、無くても EDINET コードリストだけで組めるようにしてある。
    CI では倉庫はこのあとの手順で作られるうえ *.duckdb はコミットしていないので、
    倉庫に依存させると実行順序に縛られてしまう。
    """
    if DB_PATH.exists():
        con = duckdb.connect(str(DB_PATH), read_only=True)
        tables = {t[0] for t in con.execute("SHOW TABLES").fetchall()}
        if "financials" in tables:
            df = con.execute("""
                SELECT c.sec_code, c.name, c.formal_name,
                       f.sales AS size_metric
                FROM companies c
                LEFT JOIN (SELECT sec_code, max(TRY_CAST(Sales AS DOUBLE)) AS sales
                           FROM financials GROUP BY sec_code) f USING (sec_code)
            """).df()
        else:
            # 公開版の倉庫には決算が入らないので、規模は資本金で代用する
            df = con.execute("""
                SELECT sec_code, name, formal_name,
                       TRY_CAST(capital AS DOUBLE) AS size_metric
                FROM companies
            """).df()
        con.close()
        return df

    snaps = sorted((ROOT / "data" / "edinet_codelist").glob("codelist_*.parquet"))
    if not snaps:
        print("❌ 倉庫も EDINETコードリストも見つかりません")
        sys.exit(1)
    cl = pd.read_parquet(snaps[-1])
    cl = cl[(cl["上場区分"] == "上場") & cl["証券コード"].notna()]
    return pd.DataFrame({
        "sec_code": cl["証券コード"],
        "name": cl["提出者名"],
        "formal_name": cl["提出者名"],
        "size_metric": pd.to_numeric(cl["資本金"], errors="coerce"),
    }).drop_duplicates(subset=["sec_code"])


def pick_targets(args) -> list:
    df = load_universe()

    if args.codes:
        return list(df[df.sec_code.isin(args.codes)].itertuples(index=False))

    ranked = df.sort_values("size_metric", ascending=False, na_position="last")
    if not args.all:
        return list(ranked.head(int(args.top)).itertuples(index=False))

    hot = set(ranked.head(int(args.hot)).sec_code) if args.hot else set()

    if args.rotate and args.rotate > 1:
        # 証券コードで決まるスライスなので、同じ会社は必ず同じ曜日に当たる。
        # 乱数で選ぶと観測の間隔がばらつき、あとで時系列として扱いにくくなる。
        slot = dt.date.today().toordinal() % args.rotate
        keep = df.sec_code.map(lambda c: (int(str(c), 36) % args.rotate) == slot)
        df = df[keep | df.sec_code.isin(hot)]

    return list(df.itertuples(index=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=400)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--codes", nargs="*")
    ap.add_argument("--per-company", type=int, default=12)
    ap.add_argument("--rotate", type=int, default=0,
                    help="全体を N 日で一周する。0 なら分割しない")
    ap.add_argument("--hot", type=int, default=0,
                    help="ローテーションとは別に、売上上位 M 社は毎日取る")
    ap.add_argument("--sleep", type=float, default=1.1)
    args = ap.parse_args()

    targets = pick_targets(args)
    seen = existing_keys()
    fetched_at = dt.datetime.now().isoformat(timespec="seconds")
    print(f"🎯 対象 {len(targets)} 社 / 既存 {len(seen):,} 件をスキップ\n", flush=True)

    n_new = n_err = 0
    t0 = time.time()
    store = store_path()
    with store.open("a", encoding="utf-8") as out:
        for i, t in enumerate(targets, 1):
            # 正式社名のほうが同名企業との混同が起きにくい
            name = text(t.formal_name) or text(t.name)
            if not name:
                continue
            try:
                root = fetch_feed(f'"{name}"')
            except Exception as e:
                n_err += 1
                print(f"  ⚠️ {t.sec_code} {name}: {type(e).__name__}", flush=True)
                time.sleep(args.sleep * 2)
                continue

            for item in root.findall(".//item")[: args.per_company]:
                link = item.findtext("link", "")
                if not link or (t.sec_code, link) in seen:
                    continue
                seen.add((t.sec_code, link))
                src = item.find("{*}source")
                out.write(json.dumps({
                    "sec_code": t.sec_code,
                    "query_name": name,
                    "title": clean_title(item.findtext("title", "")),
                    "link": link,
                    "source": (src.text if src is not None else None),
                    "published": parse_pubdate(item.findtext("pubDate", "")),
                    # 検証に使えるのはこの時刻以降に取れた分だけ。必ず残す
                    "fetched_at": fetched_at,
                }, ensure_ascii=False) + "\n")
                n_new += 1
            out.flush()

            if i % 25 == 0:
                el = time.time() - t0
                print(f"  ... {i}/{len(targets)}  新規 {n_new:,} 件"
                      f"  (経過 {el/60:.1f}分, 残り約 {el/i*(len(targets)-i)/60:.1f}分)", flush=True)
            time.sleep(args.sleep)

    print(f"\n✅ 新規 {n_new:,} 件 / 失敗 {n_err} 社")
    print(f"   取得日時 {fetched_at}")
    print(f"   {store}")


if __name__ == "__main__":
    main()
