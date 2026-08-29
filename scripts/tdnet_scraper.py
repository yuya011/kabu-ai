"""
TDnet (適時開示情報閲覧サービス) 自動スクレイパー ＆ 本文テキスト抽出器
東証の無料開示ページから開示一覧を取得し、決算短信・業績修正PDFから本文テキストを自動抽出して蓄積します。
"""

import os
import io
import time
import argparse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from bs4 import BeautifulSoup
import pandas as pd
import pypdf

DATA_DIR = Path("data/tdnet_disclosures")
DATA_DIR.mkdir(parents=True, exist_ok=True)

TDNET_BASE = "https://www.release.tdnet.info/inbs"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
}

def extract_pdf_text_from_url(pdf_url: str) -> str:
    """PDFをインメモリでダウンロードし、テキストを抽出（バイナリは保存せず軽量化）"""
    if not pdf_url:
        return ""
    try:
        req = urllib.request.Request(pdf_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as res:
            pdf_bytes = res.read()
            
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []
        # 短信サマリ・定性情報は最初の1〜5ページに集中
        for page in reader.pages[:5]:
            t = page.extract_text()
            if t:
                pages_text.append(t)
        return "\n".join(pages_text)
    except Exception as e:
        return ""

def fetch_tdnet_day(date_str: str, fetch_pdf_text: bool = True):
    url = f"{TDNET_BASE}/I_list_001_{date_str}.html"
    print(f"📥 TDnet 開示一覧取得: {date_str} ({url})...", flush=True)
    req = urllib.request.Request(url, headers=HEADERS)
    
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            html = res.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"⚠️ 取得スキップ (非営業日または未公開): {e}", flush=True)
        return []

    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="main-list-table")
    if not table:
        print(f"ℹ️ {date_str}: 開示テーブルなし（0件）", flush=True)
        return []

    records = []
    rows = table.find_all("tr")
    
    for tr in rows:
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue
            
        time_str = tds[0].text.strip()
        code = tds[1].text.strip()
        name = tds[2].text.strip()
        title = tds[3].text.strip()
        
        a_tag = tds[3].find("a")
        pdf_rel = a_tag.get("href") if a_tag else ""
        pdf_url = f"{TDNET_BASE}/{pdf_rel}" if pdf_rel else ""
        
        is_earnings = any(k in title for k in ["決算短信", "業績予想", "修正", "四半期"])
        
        content_text = ""
        if fetch_pdf_text and is_earnings and pdf_url:
            content_text = extract_pdf_text_from_url(pdf_url)
            time.sleep(0.3)  # サーバー負荷軽減
            
        records.append({
            "date": date_str,
            "time": time_str,
            "code": code,
            "name": name,
            "title": title,
            "pdf_url": pdf_url,
            "is_earnings": is_earnings,
            "content_text": content_text
        })

    if not records:
        return []

    df = pd.DataFrame(records)
    out_path = DATA_DIR / f"tdnet_{date_str}.parquet"
    
    # 既存データがあればマージ
    if out_path.exists():
        df_old = pd.read_parquet(out_path)
        df = pd.concat([df_old, df]).drop_duplicates(subset=["date", "time", "code", "title"], keep="last")
        
    df.to_parquet(out_path, index=False)
    earnings_with_text = df[df["content_text"].str.len() > 0]
    print(f"✅ 保存完了: {out_path} (総開示: {len(df)} 件, 決算テキスト抽出: {len(earnings_with_text)} 件)", flush=True)
    return records

def main():
    parser = argparse.ArgumentParser(description="TDnet 日次スクレイパー ＆ 本文テキスト抽出器")
    parser.add_argument("--days", type=int, default=1, help="遡って取得する日数 (デフォルト: 1)")
    args = parser.parse_args()
    
    today = datetime.now()
    for i in range(args.days):
        target_date = today - timedelta(days=i)
        date_str = target_date.strftime("%Y%m%d")
        fetch_tdnet_day(date_str)

if __name__ == "__main__":
    main()
