import os
import time
from pathlib import Path
import pandas as pd
import numpy as np
import yfinance as yf
import jquantsapi
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

class JQuantsExtendedLoader:
    def __init__(self):
        api_key = os.getenv("J_Quants_API", "")
        if not api_key:
            raise ValueError(".env に J_Quants_API が設定されていません。")
        self.cli = jquantsapi.ClientV2(api_key=api_key)
        self.master_cache_path = DATA_DIR / "master.parquet"
        self.fins_cache_path = DATA_DIR / "fins_extended.parquet"

    def get_master(self) -> pd.DataFrame:
        if self.master_cache_path.exists():
            return pd.read_parquet(self.master_cache_path)
        df = self.cli.get_eq_master()
        df["Code"] = df["Code"].astype(str)
        df.to_parquet(self.master_cache_path, index=False)
        return df

    def get_fin_summaries(self, dates: list[str]) -> pd.DataFrame:
        """複数四半期の開示データを一括取得（キャッシュ対応）"""
        if self.fins_cache_path.exists():
            df_cached = pd.read_parquet(self.fins_cache_path)
            cached_dates = set(df_cached["DiscDate"].astype(str).str.replace("-", "").str[:8].unique())
            missing_dates = [d for d in dates if d.replace("-", "")[:8] not in cached_dates]
            if not missing_dates:
                return df_cached
        else:
            df_cached = pd.DataFrame()
            missing_dates = dates

        print(f"📥 財務サマリ ({len(missing_dates)} 日分) を取得中...", flush=True)
        records = []
        for i, d in enumerate(missing_dates):
            d_fmt = d.replace("-", "")[:8]
            for retry in range(3):
                try:
                    df_d = self.cli.get_fin_summary(date_yyyymmdd=d_fmt)
                    if not df_d.empty:
                        records.append(df_d)
                    time.sleep(0.3)
                    break
                except Exception as e:
                    time.sleep(2.0 * (retry + 1))
            if (i + 1) % 10 == 0:
                print(f"  ・進捗: {i+1}/{len(missing_dates)} 日完了", flush=True)

        if records:
            df_new = pd.concat(records, ignore_index=True)
            df_all = pd.concat([df_cached, df_new], ignore_index=True) if not df_cached.empty else df_new
            df_all["Code"] = df_all["Code"].astype(str)
            df_all.to_parquet(self.fins_cache_path, index=False)
            print(f"✅ 財務サマリ保存完了: 総レコード数 {len(df_all):,} 件", flush=True)
            return df_all
        return df_cached

def build_extended_dataset():
    print("=" * 80)
    print("🚀 複数四半期（2024年秋 〜 2025年）データセット拡張 & 構築")
    print("=" * 80)
    
    loader = JQuantsExtendedLoader()
    df_master = loader.get_master()
    
    # 複数四半期の決算集中日（2024年11月、2025年2月、2025年5月）
    dates_2024_11 = [
        "20241030", "20241031", "20241101", "20241105", "20241106",
        "20241107", "20241108", "20241111", "20241112", "20241113",
        "20241114"
    ]
    dates_2025_02 = [
        "20250130", "20250131", "20250203", "20250204", "20250205",
        "20250206", "20250207", "20250210", "20250212", "20250213",
        "20250214"
    ]
    dates_2025_05 = [
        "20250508", "20250509", "20250512", "20250513", "20250514",
        "20250515"
    ]
    all_fin_dates = sorted(dates_2024_11 + dates_2025_02 + dates_2025_05)
    
    df_fins = loader.get_fin_summaries(all_fin_dates)
    print(f"📊 財務サマリ総レコード数: {len(df_fins):,} 件")
    
    df_master_sub = df_master[["Code", "CoName", "S17", "S17Nm", "MktNm", "ScaleCat"]].drop_duplicates(subset=["Code"])
    df_merged = pd.merge(df_fins, df_master_sub, on="Code", how="inner")
    
    # プライム市場銘柄 ＆ 15:00以降の引け後開示に厳密限定
    df_merged = df_merged[df_merged["MktNm"].str.contains("プライム", na=False)].copy()
    time_col = "DiscTime" if "DiscTime" in df_merged.columns else "DisclosedTime"
    df_merged = df_merged[df_merged[time_col].astype(str) >= "15:00:00"].copy()
    df_merged["DiscDate"] = pd.to_datetime(df_merged["DiscDate"])
    
    print(f"✅ 引け後開示・プライム銘柄数: {len(df_merged):,} 件")
    
    # 決算種別フラグ (本決算 FY vs 四半期決算 Q1/Q2/Q3)
    df_merged["is_fy_earnings"] = df_merged["CurPerType"].str.contains("FY", na=False).astype(int)
    
    # 数値サプライズ特徴量 (会社予想の有無フラグ + ネイティブNaN)
    df_merged["OP_num"] = pd.to_numeric(df_merged["OP"], errors="coerce")
    df_merged["FOP_num"] = pd.to_numeric(df_merged["FOP"], errors="coerce")
    df_merged["Sales_num"] = pd.to_numeric(df_merged["Sales"], errors="coerce")
    df_merged["FSales_num"] = pd.to_numeric(df_merged["FSales"], errors="coerce")
    df_merged["NP_num"] = pd.to_numeric(df_merged["NP"], errors="coerce")
    df_merged["FNP_num"] = pd.to_numeric(df_merged["FNP"], errors="coerce")
    
    # 予想開示フラグ
    df_merged["feat_has_fop"] = df_merged["FOP_num"].notna().astype(int)
    
    eps = 1e6
    df_merged["feat_op_surprise"] = (df_merged["OP_num"] - df_merged["FOP_num"]) / (df_merged["FOP_num"].abs() + eps)
    df_merged["feat_sales_surprise"] = (df_merged["Sales_num"] - df_merged["FSales_num"]) / (df_merged["FSales_num"].abs() + eps)
    df_merged["feat_np_surprise"] = (df_merged["NP_num"] - df_merged["FNP_num"]) / (df_merged["FNP_num"].abs() + eps)
    df_merged["feat_roe"] = pd.to_numeric(df_merged["ROE"], errors="coerce")
    df_merged["feat_eq_ratio"] = pd.to_numeric(df_merged["EqAR"], errors="coerce")
    
    # クリップ
    for col in ["feat_op_surprise", "feat_sales_surprise", "feat_np_surprise"]:
        df_merged[col] = df_merged[col].clip(-1.0, 1.0)
        
    # 株価データ取得 (2024-10-15 〜 2025-06-15)
    unique_codes = df_merged["Code"].unique().tolist()
    ticker_map = {}
    for c in unique_codes:
        c_str = str(c).strip()
        t_code = c_str[:4] if len(c_str) == 5 and c_str.endswith("0") else c_str
        ticker_map[c] = f"{t_code}.T"
        
    tickers = list(set(ticker_map.values()))
    print(f"📥 yfinance 株価一括ダウンロード ({len(tickers)} 銘柄, 2024-10-15 〜 2025-06-15)...", flush=True)
    
    df_prices_raw = yf.download(
        tickers=tickers,
        start="2024-10-15",
        end="2025-06-15",
        group_by="ticker",
        auto_adjust=False,
        threads=True
    )
    
    price_dict = {}
    for code, ticker in ticker_map.items():
        try:
            if ticker in df_prices_raw.columns.levels[0]:
                p_sub = df_prices_raw[ticker].dropna(how="all").copy().reset_index()
                p_sub["Date"] = pd.to_datetime(p_sub["Date"]).dt.tz_localize(None)
                p_sub = p_sub.sort_values("Date").reset_index(drop=True)
                if not p_sub.empty:
                    price_dict[code] = p_sub
        except Exception:
            continue
            
    # リターン計算 (翌朝寄り付き -> 5営業日後終値)
    valid_records = []
    for idx, row in df_merged.iterrows():
        code = row["Code"]
        d_date = row["DiscDate"]
        
        if code not in price_dict:
            continue
        p_df = price_dict[code]
        future_bars = p_df[p_df["Date"] >= d_date].reset_index(drop=True)
        if len(future_bars) < 6:
            continue
            
        adj_col = "Adj Close" if "Adj Close" in future_bars.columns else "Close"
        open_col = "Open"
        
        p_entry = future_bars.iloc[1][open_col] if len(future_bars) > 1 else future_bars.iloc[0][adj_col]
        p_exit = future_bars.iloc[5][adj_col] if len(future_bars) > 5 else future_bars.iloc[-1][adj_col]
        
        if p_entry <= 0 or np.isnan(p_entry) or np.isnan(p_exit):
            continue
            
        raw_ret = (p_exit - p_entry) / p_entry
        r_dict = row.to_dict()
        r_dict["raw_5d_return"] = raw_ret
        valid_records.append(r_dict)
        
    df_clean = pd.DataFrame(valid_records)
    print(f"✅ 同一計測区間リターン結合完了: {len(df_clean):,} 件", flush=True)
    
    # 全銘柄日次デミーン (Market-Neutral Excess Return)
    df_clean["day_mean_return"] = df_clean.groupby("DiscDate")["raw_5d_return"].transform("mean")
    df_clean["excess_return"] = df_clean["raw_5d_return"] - df_clean["day_mean_return"]
    
    # 開示日ごとの銘柄数
    day_counts = df_clean["DiscDate"].value_counts().sort_index()
    print("\n📅 開示日ごとの銘柄数内訳 (拡張版):")
    for d, cnt in day_counts.items():
        print(f"  ・{d.strftime('%Y-%m-%d')}: {cnt:3d} 銘柄")
        
    out_path = DATA_DIR / "extended_clean_dataset.parquet"
    df_clean.to_parquet(out_path, index=False)
    print(f"\n🎉 拡張版データセット作成完了: {out_path} ({len(df_clean):,} 件, T={len(day_counts)} 日)")
    return df_clean

if __name__ == "__main__":
    build_extended_dataset()
