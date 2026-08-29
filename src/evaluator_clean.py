import numpy as np
import pandas as pd
import lightgbm as lgb
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

def stationary_block_bootstrap(series: np.ndarray, num_resamples: int = 1000, avg_block_len: float = 3.0) -> tuple[float, float, float]:
    n = len(series)
    if n == 0:
        return 0.0, 0.0, 1.0
    orig_mean = float(np.mean(series))
    p_geom = 1.0 / avg_block_len
    boot_means = []
    
    for _ in range(num_resamples):
        indices = []
        cur_idx = np.random.randint(0, n)
        while len(indices) < n:
            indices.append(cur_idx)
            if np.random.rand() < p_geom:
                cur_idx = np.random.randint(0, n)
            else:
                cur_idx = (cur_idx + 1) % n
        sample = series[indices]
        boot_means.append(np.mean(sample))
        
    boot_means = np.array(boot_means)
    ci_lower = float(np.percentile(boot_means, 5.0))
    p_val = float(np.mean(boot_means <= 0.0))
    return orig_mean, ci_lower, p_val

def evaluate_pure_after_close():
    dataset_path = DATA_DIR / "pure_after_close_dataset.parquet"
    df = pd.read_parquet(dataset_path)
    
    print("=" * 85)
    print(f"📊 完全中立化・引け後開示データセット (1,044 件) 厳密 Walk-Forward 評価")
    print("=" * 85)
    
    features = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio"
    ]
    
    # GBDTハイパーパラメータ
    lgb_params = {
        "objective": "regression",
        "metric": "l2",
        "boosting_type": "gbdt",
        "learning_rate": 0.05,
        "num_leaves": 7,
        "max_depth": 3,
        "min_child_samples": 5,
        "lambda_l1": 0.1,
        "lambda_l2": 1.0,
        "verbosity": -1,
        "random_state": 42
    }
    
    dates = sorted(df["DiscDate"].unique())
    eval_records = []
    
    for target_date in dates:
        # 厳密な過去データのみ (DiscDate < target_date) で学習
        df_train = df[df["DiscDate"] < target_date].copy()
        df_test = df[df["DiscDate"] == target_date].copy()
        
        # 評価基準: 銘柄数 >= 10, 学習データ >= 50
        if len(df_test) < 10 or len(df_train) < 50:
            continue
            
        y_train = df_train["excess_return"].values
        y_test = df_test["excess_return"].values
        
        # 1. 単純ルール (営業利益サプライズ単体)
        pred_rule = df_test["feat_op_surprise"].values
        ic_rule = calc_spearman_rank_ic(pred_rule, y_test)
        
        # 2. GBDT Baseline (数値サプライズ + 財務比率)
        X_train = df_train[features].fillna(0.0).values
        X_test = df_test[features].fillna(0.0).values
        
        trn_data = lgb.Dataset(X_train, label=y_train)
        model = lgb.train(lgb_params, trn_data, num_boost_round=30)
        pred_gbdt = model.predict(X_test)
        ic_gbdt = calc_spearman_rank_ic(pred_gbdt, y_test)
        
        eval_records.append({
            "DiscDate": target_date,
            "n_stocks": len(df_test),
            "RankIC_Rule": ic_rule,
            "RankIC_GBDT": ic_gbdt
        })
        
    df_eval = pd.DataFrame(eval_records)
    print("\n" + "-" * 85)
    print("| 開示日 | 銘柄数 | 単純ルール (OPサプライズ) Rank IC | GBDT Baseline (5特徴量) Rank IC |")
    print("|---|---|---|---|")
    for _, r in df_eval.iterrows():
        d_str = pd.to_datetime(r["DiscDate"]).strftime("%Y-%m-%d")
        print(f"| {d_str} | {int(r['n_stocks']):4d} | {r['RankIC_Rule']:+.4f} | {r['RankIC_GBDT']:+.4f} |")

    mean_rule = df_eval["RankIC_Rule"].mean()
    mean_gbdt = df_eval["RankIC_GBDT"].mean()
    std_gbdt = df_eval["RankIC_GBDT"].std()
    
    print("\n" + "=" * 85)
    print("📈 再測定結果サマリー (T=10日, 総銘柄数=1,044件):")
    print("=" * 85)
    print(f"・単純ルール (OPサプライズ単体) 平均 Rank IC: **{mean_rule:+.4f}**")
    print(f"・GBDT Baseline (数値サプライズ+財務) 平均 Rank IC: **{mean_gbdt:+.4f}** (std: {std_gbdt:.4f})")
    print("=" * 85)
    
    out_csv = RESULTS_DIR / "clean_evaluation_results.csv"
    df_eval.to_csv(out_csv, index=False)
    return df_eval

if __name__ == "__main__":
    evaluate_pure_after_close()
