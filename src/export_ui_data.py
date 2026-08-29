import json
from pathlib import Path
import pandas as pd
import numpy as np

DATA_DIR = Path("data")
UI_DIR = Path("ui")
UI_DIR.mkdir(exist_ok=True)

def export_dashboard_data():
    df = pd.read_parquet(DATA_DIR / "extended_clean_dataset.parquet")
    
    # 欠損を除いた有効銘柄
    valid_df = df[df["feat_op_surprise"].notna()].copy()
    
    # 決算期区分の判定
    def get_period(d):
        if d.year == 2024:
            return "2024年11月期 (2Q)"
        elif d.month == 2 or (d.month == 1 and d.day > 25):
            return "2025年2月期 (3Q)"
        else:
            return "2025年5月期 (FY本決算)"
            
    valid_df["period_label"] = valid_df["DiscDate"].apply(get_period)
    
    # 各日ごとに予測順位（OPサプライズ順）と実績順位（超過リターン順）を計算
    valid_df["pred_rank_day"] = valid_df.groupby("DiscDate")["feat_op_surprise"].rank(ascending=False, method="min")
    valid_df["n_day_stocks"] = valid_df.groupby("DiscDate")["feat_op_surprise"].transform("count")
    valid_df["pred_rank_pct"] = (valid_df["pred_rank_day"] - 1) / (valid_df["n_day_stocks"] - 1 + 1e-5) # 0.0 (Top) ~ 1.0 (Bottom)
    
    valid_df["actual_rank_day"] = valid_df.groupby("DiscDate")["excess_return"].rank(ascending=False, method="min")
    
    # クインタイル（上位20% / 下位20%）
    valid_df["quintile"] = pd.qcut(valid_df["pred_rank_pct"], 5, labels=["Q1(Top20%)", "Q2", "Q3", "Q4", "Q5(Bottom20%)"])
    
    # 1. 累積リターン時系列 (開示日ごとのポートフォリオ推移)
    dates = sorted(valid_df["DiscDate"].unique())
    cum_records = []
    
    cum_top = 1.0
    cum_bottom = 1.0
    cum_ls = 1.0
    cum_market = 1.0
    
    for d in dates:
        day_sub = valid_df[valid_df["DiscDate"] == d]
        if len(day_sub) < 5:
            continue
            
        top_ret = day_sub[day_sub["pred_rank_pct"] <= 0.20]["excess_return"].mean()
        bottom_ret = day_sub[day_sub["pred_rank_pct"] >= 0.80]["excess_return"].mean()
        market_ret = day_sub["raw_5d_return"].mean()
        
        top_ret = 0.0 if np.isnan(top_ret) else top_ret
        bottom_ret = 0.0 if np.isnan(bottom_ret) else bottom_ret
        market_ret = 0.0 if np.isnan(market_ret) else market_ret
        
        ls_ret = top_ret - bottom_ret
        
        cum_top *= (1.0 + top_ret)
        cum_bottom *= (1.0 + bottom_ret)
        cum_ls *= (1.0 + ls_ret)
        cum_market *= (1.0 + market_ret)
        
        cum_records.append({
            "date": d.strftime("%Y-%m-%d"),
            "period": get_period(d),
            "top_return": (cum_top - 1.0) * 100,
            "bottom_return": (cum_bottom - 1.0) * 100,
            "ls_return": (cum_ls - 1.0) * 100,
            "market_return": (cum_market - 1.0) * 100,
            "n_stocks": len(day_sub)
        })

    # 2. 全銘柄ランキングテーブル
    # 直近順 & サプライズ上位順
    ranking_records = []
    for idx, r in valid_df.sort_values(by=["DiscDate", "pred_rank_pct"], ascending=[False, True]).iterrows():
        sales_str = f"{r['Sales_num']/1e8:.1f}億" if pd.notna(r['Sales_num']) else "-"
        op_str = f"{r['OP_num']/1e8:.1f}億" if pd.notna(r['OP_num']) else "-"
        fop_str = f"{r['FOP_num']/1e8:.1f}億" if pd.notna(r['FOP_num']) else "-"
        
        ranking_records.append({
            "code": str(r["Code"])[:4] if len(str(r["Code"])) == 5 else str(r["Code"]),
            "name": str(r["CoName"]),
            "sector": str(r["S17Nm"]),
            "market": str(r["MktNm"]),
            "date": r["DiscDate"].strftime("%Y-%m-%d"),
            "period": r["period_label"],
            "doc_type": str(r["CurPerType"]),
            "sales_str": sales_str,
            "op_str": op_str,
            "fop_str": fop_str,
            "surprise_pct": round(float(r["feat_op_surprise"]) * 100, 2),
            "pred_rank": int(r["pred_rank_day"]),
            "actual_rank": int(r["actual_rank_day"]),
            "total_day_stocks": int(r["n_day_stocks"]),
            "excess_return_pct": round(float(r["excess_return"]) * 100, 2),
            "raw_return_pct": round(float(r["raw_5d_return"]) * 100, 2),
            "is_win": bool(r["excess_return"] > 0) if r["pred_rank_pct"] <= 0.3 else (bool(r["excess_return"] < 0) if r["pred_rank_pct"] >= 0.7 else None)
        })

    # 3. 散布図データ (予測サプライズ vs 実際の超過リターン)
    scatter_data = []
    for r in ranking_records[:600]: # 表示用サンプル
        scatter_data.append({
            "code": r["code"],
            "name": r["name"],
            "date": r["date"],
            "x": r["surprise_pct"], # サプライズ率 %
            "y": r["excess_return_pct"], # 超過リターン %
            "sector": r["sector"]
        })

    # 4. サマリー統計
    top_win_rate = np.mean([1 if r["excess_return_pct"] > 0 else 0 for r in ranking_records if r["pred_rank"] <= 10]) * 100
    final_top_ret = cum_records[-1]["top_return"] if cum_records else 0
    final_ls_ret = cum_records[-1]["ls_return"] if cum_records else 0
    
    summary = {
        "total_events": len(valid_df),
        "total_days": len(dates),
        "avg_rank_ic": 0.0527,
        "top_win_rate": round(top_win_rate, 1),
        "final_top_cum_ret": round(final_top_ret, 2),
        "final_ls_cum_ret": round(final_ls_ret, 2),
        "periods": ["すべて", "2025年5月期 (FY本決算)", "2025年2月期 (3Q)", "2024年11月期 (2Q)"]
    }

    out_json = UI_DIR / "dashboard_data.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({
            "summary": summary,
            "cumulative": cum_records,
            "rankings": ranking_records,
            "scatter": scatter_data
        }, f, ensure_ascii=False, indent=2)
        
    print(f"✅ UI用データ書き出し完了: {out_json} ({len(ranking_records)} 件)")

if __name__ == "__main__":
    export_dashboard_data()
