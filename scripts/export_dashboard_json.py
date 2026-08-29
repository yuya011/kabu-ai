import os
import json
from pathlib import Path
import pandas as pd
import numpy as np
from scipy import stats

DATA_DIR = Path("data")
RESULTS_DIR = Path("results")
OUTPUT_DIR = Path("frontend/public/data")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def export_dashboard_json():
    print("=" * 80)
    print("🔄 フロントエンド用 JSON データ生成 (ヒストグラム追加・T=22厳密統一版)")
    print("=" * 80)
    
    parquet_path = DATA_DIR / "extended_clean_dataset.parquet"
    df = pd.read_parquet(parquet_path)
    
    # 1. 有効なサプライズ銘柄のみを抽出 (1,691件)
    df_valid = df[df["feat_op_surprise"].notna()].copy()
    
    # 2. 開示日ごとに再デミーン (同一母集団内での完全中立化)
    df_valid["day_mean_raw"] = df_valid.groupby("DiscDate")["raw_5d_return"].transform("mean")
    df_valid["excess_return"] = df_valid["raw_5d_return"] - df_valid["day_mean_raw"]
    df_valid["excess_return_pct"] = df_valid["excess_return"] * 100
    df_valid["surprise_pct"] = df_valid["feat_op_surprise"] * 100
    
    # 期間ラベル（中立的表記）
    def get_period(d):
        if d.year == 2024:
            return "2024年11月期"
        elif d.month == 2 or (d.month == 1 and d.day > 25):
            return "2025年2月期"
        else:
            return "2025年5月期"
            
    df_valid["period"] = df_valid["DiscDate"].apply(get_period)
    df_valid["DiscDate_str"] = df_valid["DiscDate"].dt.strftime("%Y-%m-%d")
    
    # 各開示日ごとに5分位（Q1〜Q5）を付与
    q_records = []
    for d_str, grp in df_valid.groupby("DiscDate_str"):
        g = grp.copy()
        if len(g) < 5:
            ranks = g["feat_op_surprise"].rank(pct=True, method="first")
            g["quintile"] = pd.cut(ranks, bins=[0, 0.2, 0.4, 0.6, 0.8, 1.0], labels=["Q1", "Q2", "Q3", "Q4", "Q5"], include_lowest=True)
        else:
            g["quintile"] = pd.qcut(g["feat_op_surprise"].rank(method="first"), q=5, labels=["Q1", "Q2", "Q3", "Q4", "Q5"])
        g["pred_rank"] = g["feat_op_surprise"].rank(ascending=False, method="min").astype(int)
        q_records.append(g)
        
    df_valid = pd.concat(q_records, ignore_index=True)

    # -------------------------------------------------------------
    # 1. 分位別統計（全体 & 決算期別）
    # -------------------------------------------------------------
    def calc_quintile_stats(sub_df):
        stats_list = []
        for q in ["Q1", "Q2", "Q3", "Q4", "Q5"]:
            q_data = sub_df[sub_df["quintile"] == q]["excess_return_pct"]
            if len(q_data) > 0:
                stats_list.append({
                    "quintile": q,
                    "count": int(len(q_data)),
                    "mean": round(float(q_data.mean()), 2),
                    "median": round(float(np.percentile(q_data, 50)), 2),
                    "std": round(float(q_data.std()), 2),
                    "p25": round(float(np.percentile(q_data, 25)), 2),
                    "p75": round(float(np.percentile(q_data, 75)), 2),
                })
            else:
                stats_list.append({
                    "quintile": q,
                    "count": 0,
                    "mean": 0.0,
                    "median": 0.0,
                    "std": 0.0,
                    "p25": 0.0,
                    "p75": 0.0,
                })
        return stats_list

    quintile_stats = {
        "all": calc_quintile_stats(df_valid),
        "2024年11月期": calc_quintile_stats(df_valid[df_valid["period"] == "2024年11月期"]),
        "2025年2月期": calc_quintile_stats(df_valid[df_valid["period"] == "2025年2月期"]),
        "2025年5月期": calc_quintile_stats(df_valid[df_valid["period"] == "2025年5月期"]),
    }

    # -------------------------------------------------------------
    # 2. Q1 vs Q5 リターン分布ヒストグラム (1%刻み, -20% 〜 +20%)
    # -------------------------------------------------------------
    bins = np.arange(-20.0, 21.0, 1.0)
    bin_centers = (bins[:-1] + bins[1:]) / 2.0
    
    q1_rets = df_valid[df_valid["quintile"] == "Q1"]["excess_return_pct"].values
    q5_rets = df_valid[df_valid["quintile"] == "Q5"]["excess_return_pct"].values
    
    q1_hist, _ = np.histogram(q1_rets, bins=bins)
    q5_hist, _ = np.histogram(q5_rets, bins=bins)
    
    hist_data = []
    for center, count_q1, count_q5 in zip(bin_centers, q1_hist, q5_hist):
        hist_data.append({
            "bin": f"{center:+.0f}%",
            "bin_val": round(float(center), 1),
            "Q1_count": int(count_q1),
            "Q5_count": int(count_q5),
            "Q1_pct": round(float(count_q1 / len(q1_rets) * 100), 2) if len(q1_rets) > 0 else 0,
            "Q5_pct": round(float(count_q5 / len(q5_rets) * 100), 2) if len(q5_rets) > 0 else 0
        })

    # -------------------------------------------------------------
    # 3. 日次 Rank IC データ (厳密 T=22日版: 2024-11-07 以降)
    # -------------------------------------------------------------
    dates_22 = sorted([d for d in df_valid["DiscDate"].unique() if d >= pd.Timestamp("2024-11-07")])
    daily_ic_list = []
    
    for d in dates_22:
        sub = df_valid[df_valid["DiscDate"] == d]
        if len(sub) < 10:
            continue
        r, _ = stats.spearmanr(sub["feat_op_surprise"].values, sub["excess_return"].values)
        r_val = 0.0 if np.isnan(r) else float(r)
        daily_ic_list.append({
            "date": d.strftime("%Y-%m-%d"),
            "period": get_period(d),
            "n_stocks": int(len(sub)),
            "rank_ic": round(r_val, 4),
            "is_positive": bool(r_val > 0)
        })
        
    ic_values = [d["rank_ic"] for d in daily_ic_list]
    positive_days = sum(1 for v in ic_values if v > 0)
    ic_summary = {
        "total_days": len(daily_ic_list), # 厳密に 22
        "positive_days": positive_days,
        "negative_days": len(daily_ic_list) - positive_days,
        "mean_rank_ic": round(float(np.mean(ic_values)), 4), # +0.0527
        "series": daily_ic_list
    }

    # -------------------------------------------------------------
    # 4. 日別銘柄テーブルデータ
    # -------------------------------------------------------------
    daily_stocks_dict = {}
    unique_dates = sorted(df_valid["DiscDate_str"].unique(), reverse=True)
    
    for d_str in unique_dates:
        day_df = df_valid[df_valid["DiscDate_str"] == d_str].sort_values("pred_rank")
        stocks = []
        for _, row in day_df.iterrows():
            c_str = str(row["Code"])
            code_4 = c_str[:4] if len(c_str) == 5 and c_str.endswith("0") else c_str
            stocks.append({
                "rank": int(row["pred_rank"]),
                "code": code_4,
                "name": str(row["CoName"]),
                "sector": str(row["S17Nm"]),
                "surprise_pct": round(float(row["surprise_pct"]), 2),
                "quintile": str(row["quintile"]),
                "excess_return_pct": round(float(row["excess_return_pct"]), 2),
                "doc_type": str(row["CurPerType"])
            })
        daily_stocks_dict[d_str] = stocks

    out_payload = {
        "metadata": {
            "title": "Kabu-AI Quantitative Earnings Evaluation",
            "total_events": len(df_valid),
            "date_range": [min(unique_dates), max(unique_dates)],
            "periods": ["all", "2025年5月期", "2025年2月期", "2024年11月期"],
            "dates": unique_dates
        },
        "quintile_stats": quintile_stats,
        "histogram_q1_q5": hist_data,
        "daily_rank_ic": ic_summary,
        "daily_stocks": daily_stocks_dict
    }

    output_file = OUTPUT_DIR / "dashboard_data.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(out_payload, f, ensure_ascii=False, indent=2)
        
    print(f"✅ JSONエクスポート完了: {output_file}")
    print(f"  ・日次Rank IC件数: T={len(daily_ic_list)} 日 (平均: {ic_summary['mean_rank_ic']:+.4f})")
    print(f"  ・ヒストグラムビン数: {len(hist_data)} ビン (-20% 〜 +20%)")
    return out_payload

if __name__ == "__main__":
    export_dashboard_json()
