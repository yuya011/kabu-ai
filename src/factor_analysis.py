import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import Ridge
from pathlib import Path

DATA_DIR = Path("data")

def calc_spearman_rank_ic(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    if len(y_pred) < 3 or np.all(y_pred == y_pred[0]):
        return 0.0
    r, p = stats.spearmanr(y_pred, y_true)
    return 0.0 if np.isnan(r) else float(r)

def run_factor_analysis():
    dataset_path = DATA_DIR / "extended_clean_dataset.parquet"
    df = pd.read_parquet(dataset_path)
    
    print("=" * 85)
    print("🔬 単一特徴量（Single-Factor）Rank IC ＆ 多重共線性・係数診断")
    print("=" * 85)
    
    feature_cols = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio"
    ]
    
    # 決算期の付与
    def get_period(d):
        if d.year == 2024:
            return "2024-11 (2Q)"
        elif d.month == 2 or (d.month == 1 and d.day > 25):
            return "2025-02 (3Q)"
        else:
            return "2025-05 (FY)"
            
    df["period"] = df["DiscDate"].apply(get_period)
    dates = sorted(df["DiscDate"].unique())
    
    # 1. 各特徴量の単独 Rank IC の日次・期別計算
    factor_ic_records = []
    
    for target_date in dates:
        df_sub = df[df["DiscDate"] == target_date]
        if len(df_sub) < 10:
            continue
            
        y_true = df_sub["excess_return"].values
        row_res = {"DiscDate": target_date, "period": get_period(target_date), "n_stocks": len(df_sub)}
        
        for f in feature_cols:
            vals = df_sub[f].fillna(0.0).values
            ic = calc_spearman_rank_ic(vals, y_true)
            row_res[f] = ic
            
        factor_ic_records.append(row_res)
        
    df_factor_ics = pd.DataFrame(factor_ic_records)
    
    print("\n【1. 各特徴量の単独 平均 Rank IC】")
    print("-" * 85)
    
    mean_table = []
    for f in feature_cols:
        all_mean = df_factor_ics[f].mean()
        p1_mean = df_factor_ics[df_factor_ics["period"] == "2024-11 (2Q)"][f].mean()
        p2_mean = df_factor_ics[df_factor_ics["period"] == "2025-02 (3Q)"][f].mean()
        p3_mean = df_factor_ics[df_factor_ics["period"] == "2025-05 (FY)"][f].mean()
        std_all = df_factor_ics[f].std()
        
        mean_table.append({
            "特徴量": f,
            "全体平均 Rank IC": all_mean,
            "std": std_all,
            "2024-11 (2Q)": p1_mean,
            "2025-02 (3Q)": p2_mean,
            "2025-05 (FY)": p3_mean
        })
        
    df_summary = pd.DataFrame(mean_table)
    print(df_summary.to_string(index=False))
    
    # 2. 特徴量間の相関行列 (Multicollinearity Check)
    print("\n" + "=" * 85)
    print("【2. 特徴量間のスピアマン相関行列】")
    print("=" * 85)
    corr_matrix = df[feature_cols].corr(method="spearman")
    print(corr_matrix.round(4))
    
    # 3. リッジ回帰の係数診断 (ウォークフォワード最終時点)
    print("\n" + "=" * 85)
    print("【3. リッジ回帰 (線形モデル) の係数と寄与度】")
    print("=" * 85)
    
    # 日内ランク正規化
    df_ranked = df.copy()
    for col in feature_cols:
        df_ranked[f"{col}_rank"] = df_ranked.groupby("DiscDate")[col].rank(pct=True).fillna(0.5)
    df_ranked["excess_return_rank"] = df_ranked.groupby("DiscDate")["excess_return"].rank(pct=True)
    rank_cols = [f"{c}_rank" for c in feature_cols]
    
    # αを変えて係数を表示
    for alpha in [0.01, 1.0, 10.0, 100.0]:
        m = Ridge(alpha=alpha)
        m.fit(df_ranked[rank_cols].values, df_ranked["excess_return_rank"].values)
        coef_dict = dict(zip(feature_cols, [round(c, 4) for c in m.coef_]))
        print(f"・Ridge (alpha={alpha:6.2f}) 係数: {coef_dict}")
        
    print("=" * 85)

if __name__ == "__main__":
    run_factor_analysis()
