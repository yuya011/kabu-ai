import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

DATA_DIR = Path("data")
RESULTS_DIR = Path("results")
RESULTS_DIR.mkdir(exist_ok=True)

def calc_spearman_rank_ic(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    if len(y_pred) < 3 or np.all(y_pred == y_pred[0]):
        return 0.0
    r, p = stats.spearmanr(y_pred, y_true)
    return 0.0 if np.isnan(r) else float(r)

def regenerate_evaluation_csv():
    df = pd.read_parquet(DATA_DIR / "extended_clean_dataset.parquet")
    
    # 1. 有効銘柄のみに絞る
    df_valid = df[df["feat_op_surprise"].notna()].copy()
    
    # 2. 開示日ごとに再デミーン (同一母集団内での中立化)
    df_valid["day_mean_raw"] = df_valid.groupby("DiscDate")["raw_5d_return"].transform("mean")
    df_valid["excess_return"] = df_valid["raw_5d_return"] - df_valid["day_mean_raw"]
    
    def get_period(d):
        if d.year == 2024:
            return "2024年11月期"
        elif d.month == 2 or (d.month == 1 and d.day > 25):
            return "2025年2月期"
        else:
            return "2025年5月期"
            
    df_valid["period"] = df_valid["DiscDate"].apply(get_period)
    dates = sorted(df_valid["DiscDate"].unique())
    
    # エンバーゴ評価対象日 (T=22日: 2024-11-07 以降)
    dates_22 = [d for d in dates if d >= pd.Timestamp("2024-11-07")]
    
    records = []
    for target_date in dates_22:
        sub = df_valid[df_valid["DiscDate"] == target_date]
        if len(sub) < 10:
            continue
            
        r_ic = calc_spearman_rank_ic(sub["feat_op_surprise"].values, sub["excess_return"].values)
        records.append({
            "DiscDate": target_date.strftime("%Y-%m-%d"),
            "period": get_period(target_date),
            "n_stocks": len(sub),
            "RankIC_Rule": round(r_ic, 4),
            "is_positive": bool(r_ic > 0)
        })
        
    df_res = pd.DataFrame(records)
    out_csv = RESULTS_DIR / "repaired_evaluation_results.csv"
    df_res.to_csv(out_csv, index=False)
    
    mean_ic = df_res["RankIC_Rule"].mean()
    pos_days = (df_res["RankIC_Rule"] > 0).sum()
    
    print("=" * 80)
    print(f"✅ CSV再生成完了: {out_csv}")
    print(f"・対象日数: T = {len(df_res)} 日")
    print(f"・平均 Rank IC: **{mean_ic:+.4f}**")
    print(f"・プラス日数: {pos_days} / {len(df_res)} 日 ({(pos_days/len(df_res))*100:.1f}%)")
    print("=" * 80)
    return df_res

if __name__ == "__main__":
    regenerate_evaluation_csv()
