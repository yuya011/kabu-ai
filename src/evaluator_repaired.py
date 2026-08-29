import numpy as np
import pandas as pd
import lightgbm as lgb
from scipy import stats
from sklearn.linear_model import Ridge
from pathlib import Path

DATA_DIR = Path("data")
RESULTS_DIR = Path("results")
RESULTS_DIR.mkdir(exist_ok=True)

def calc_spearman_rank_ic(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    if len(y_pred) < 3 or np.all(y_pred == y_pred[0]):
        return 0.0
    r, p = stats.spearmanr(y_pred, y_true)
    return 0.0 if np.isnan(r) else float(r)

def stationary_block_bootstrap(series: np.ndarray, num_resamples: int = 1000, avg_block_len: float = 7.0) -> tuple[float, float, float]:
    """
    Politis & Romano (1994) 定常ブロックブートストラップ (ブロック長 L=7 で5日重複を吸収)
    """
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

def run_repaired_evaluation():
    dataset_path = DATA_DIR / "extended_clean_dataset.parquet"
    df = pd.read_parquet(dataset_path)
    
    print("=" * 90)
    print(f"🔧 ベースライン修理（日内ランク正規化 ＋ エンバーゴ付き）厳密評価")
    print("=" * 90)
    
    # 1. 特徴量とラベルの日内ランク正規化（Percentile Rank: 0.0 〜 1.0）
    feature_cols = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio"
    ]
    
    df_ranked = df.copy()
    
    # 各開示日ごとにランク正規化
    for col in feature_cols:
        df_ranked[f"{col}_rank"] = df_ranked.groupby("DiscDate")[col].rank(pct=True).fillna(0.5)
        
    # ラベル（超過リターン）の日内ランク正規化
    df_ranked["excess_return_rank"] = df_ranked.groupby("DiscDate")["excess_return"].rank(pct=True)
    
    rank_feature_cols = [f"{c}_rank" for c in feature_cols]
    
    dates = sorted(df_ranked["DiscDate"].unique())
    eval_records = []
    
    lgb_params = {
        "objective": "regression",
        "metric": "l2",
        "boosting_type": "gbdt",
        "learning_rate": 0.03,
        "num_leaves": 7,
        "max_depth": 3,
        "min_child_samples": 30,
        "lambda_l1": 0.1,
        "lambda_l2": 1.0,
        "verbosity": -1,
        "random_state": 42
    }
    
    print("\n| 開示日 | 銘柄数 | 訓練件数 | 単純ルール IC | リッジ回帰 (線形) IC | GBDT (ランク学習) IC |")
    print("|---|---|---|---|---|---|")
    
    for target_date in dates:
        embargo_cutoff = target_date - pd.Timedelta(days=7)
        df_train = df_ranked[df_ranked["DiscDate"] <= embargo_cutoff].copy()
        df_test = df_ranked[df_ranked["DiscDate"] == target_date].copy()
        
        if len(df_train) < 100 or len(df_test) < 10:
            continue
            
        y_train = df_train["excess_return_rank"].values
        y_test_raw = df_test["excess_return"].values
        y_test_rank = df_test["excess_return_rank"].values
        
        # 1. 単純ルール (OPサプライズ単体)
        pred_rule = df_test["feat_op_surprise"].fillna(0.0).values
        ic_rule = calc_spearman_rank_ic(pred_rule, y_test_raw)
        
        # 2. リッジ回帰 (ランク特徴量 -> ランク予測)
        X_tr = df_train[rank_feature_cols].values
        X_te = df_test[rank_feature_cols].values
        
        m_ridge = Ridge(alpha=10.0)
        m_ridge.fit(X_tr, y_train)
        pred_ridge = m_ridge.predict(X_te)
        ic_ridge = calc_spearman_rank_ic(pred_ridge, y_test_raw)
        
        # 3. GBDT (ランク特徴量 -> ランク予測)
        trn_data = lgb.Dataset(X_tr, label=y_train)
        model = lgb.train(lgb_params, trn_data, num_boost_round=30)
        pred_gbdt = model.predict(X_te)
        ic_gbdt = calc_spearman_rank_ic(pred_gbdt, y_test_raw)
        
        # 決算期区分の判定
        d_month = target_date.month
        period_name = "2024-11 (2Q)" if target_date.year == 2024 else ("2025-02 (3Q)" if d_month == 2 or (d_month == 1 and target_date.day > 25) else "2025-05 (FY)")
        
        eval_records.append({
            "DiscDate": target_date,
            "period": period_name,
            "n_stocks": len(df_test),
            "n_train": len(df_train),
            "RankIC_Rule": ic_rule,
            "RankIC_Ridge": ic_ridge,
            "RankIC_GBDT": ic_gbdt
        })
        
        d_str = target_date.strftime("%Y-%m-%d")
        print(f"| {d_str} | {len(df_test):4d} | {len(df_train):5d} | {ic_rule:+.4f} | {ic_ridge:+.4f} | {ic_gbdt:+.4f} |")

    df_eval = pd.DataFrame(eval_records)
    
    print("\n" + "=" * 90)
    print("📈 統計サマリー (日内ランク正規化 / ブロック長 L=7 ブートストラップ検定):")
    print("=" * 90)
    
    for col, name in [("RankIC_Rule", "単純ルール (OPサプライズ)"), ("RankIC_Ridge", "リッジ回帰 (線形ランク合成)"), ("RankIC_GBDT", "GBDT (木ランク学習)")]:
        series = df_eval[col].values
        mean_v, ci_v, p_v = stationary_block_bootstrap(series, avg_block_len=7.0)
        std_v = np.std(series)
        ir_v = (mean_v / std_v) * np.sqrt(len(series)) if std_v > 0 else 0
        print(f"・{name:<32}: 平均 Rank IC = **{mean_v:+.4f}** (std: {std_v:.4f}, ICIR: {ir_v:.2f}, 95%CI下限: {ci_v:+.4f}, p: {p_v:.4f})")

    # 期別・レジーム別分解
    print("\n" + "-" * 90)
    print("📅 決算期別 (レジーム別) 平均 Rank IC 分解:")
    print("-" * 90)
    period_summary = df_eval.groupby("period")[["RankIC_Rule", "RankIC_Ridge", "RankIC_GBDT"]].mean()
    print(period_summary)
    
    # 訓練件数 vs Rank IC の相関分析 (知見3の客観検証)
    corr_train_rule = df_eval["n_train"].corr(df_eval["RankIC_Rule"])
    corr_train_gbdt = df_eval["n_train"].corr(df_eval["RankIC_GBDT"])
    print("\n" + "-" * 90)
    print(f"📊 訓練件数 (n_train) と Rank IC の相関:")
    print(f"・訓練件数 vs 単純ルール IC 相関 : {corr_train_rule:+.4f}")
    print(f"・訓練件数 vs GBDT IC 相関     : {corr_train_gbdt:+.4f}")
    print("-" * 90)

    out_csv = RESULTS_DIR / "repaired_evaluation_results.csv"
    df_eval.to_csv(out_csv, index=False)
    return df_eval

if __name__ == "__main__":
    run_repaired_evaluation()
