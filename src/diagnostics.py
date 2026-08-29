"""
クオンツ評価用 汎用診断ツール (Diagnostics Suite)
1. シャッフルテスト (日内ラベル並べ替え 100回試行による評価ループの健全性検証)
2. 特徴量多重共線性 ＆ 単独Rank IC 診断
"""

import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

def calc_spearman_rank_ic(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    if len(y_pred) < 3 or np.all(y_pred == y_pred[0]):
        return 0.0
    r, p = stats.spearmanr(y_pred, y_true)
    return 0.0 if np.isnan(r) else float(r)

def run_shuffle_test(df: pd.DataFrame, feature_col: str = "feat_op_surprise", n_trials: int = 100) -> dict:
    """日内ラベル並べ替えシャッフルテスト"""
    dates = sorted(df["DiscDate"].unique())
    shuffled_means = []
    
    for _ in range(n_trials):
        daily_ics = []
        for d in dates:
            sub = df[df["DiscDate"] == d]
            if len(sub) < 10:
                continue
            # 日内でラベルをシャッフル
            y_shuffled = np.random.permutation(sub["excess_return"].values)
            x_vals = sub[feature_col].fillna(0.0).values
            daily_ics.append(calc_spearman_rank_ic(x_vals, y_shuffled))
        if daily_ics:
            shuffled_means.append(np.mean(daily_ics))
            
    res = {
        "n_trials": n_trials,
        "mean_shuffled_ic": float(np.mean(shuffled_means)),
        "std_shuffled_ic": float(np.std(shuffled_means)),
        "ci_95": [float(np.percentile(shuffled_means, 2.5)), float(np.percentile(shuffled_means, 97.5))]
    }
    print("=" * 80)
    print("🔬 シャッフルテスト (帰無分布) 診断結果:")
    print(f"・試行回数: {n_trials} 回")
    print(f"・平均 Rank IC: {res['mean_shuffled_ic']:+.4f} (期待値: 0.0000)")
    print(f"・標準偏差    : {res['std_shuffled_ic']:.4f}")
    print(f"・95% 信頼区間: [{res['ci_95'][0]:+.4f}, {res['ci_95'][1]:+.4f}]")
    print("=" * 80)
    return res

if __name__ == "__main__":
    p = Path("data/extended_clean_dataset.parquet")
    if p.exists():
        df_data = pd.read_parquet(p)
        run_shuffle_test(df_data, "feat_op_surprise", 100)
