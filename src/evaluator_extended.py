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

def run_embargoed_evaluation():
    dataset_path = DATA_DIR / "extended_clean_dataset.parquet"
    df = pd.read_parquet(dataset_path)
    
    print("=" * 90)
    print(f"📊 拡張データセット (2,901 件, T=28 日) エンバーゴ付き (5日重複遮断) 厳密評価")
    print("=" * 90)
    
    # 業種ダミーの作成
    s17_dummies = pd.get_dummies(df['S17'], prefix='sec', drop_first=True, dtype=float)
    dummy_cols = list(s17_dummies.columns)
    df_full = pd.concat([df, s17_dummies], axis=1)
    
    features_base = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio", "feat_has_fop", "is_fy_earnings"
    ]
    
    lgb_params = {
        "objective": "regression",
        "metric": "l2",
        "boosting_type": "gbdt",
        "learning_rate": 0.03,
        "num_leaves": 15,
        "max_depth": 4,
        "min_child_samples": 30,  # 過学習防止
        "lambda_l1": 0.5,
        "lambda_l2": 2.0,
        "verbosity": -1,
        "random_state": 42
    }
    
    dates = sorted(df_full["DiscDate"].unique())
    eval_records = []
    
    print("\n| 開示日 | 銘柄数 | 訓練件数 | 単純ルール IC | 業種ダミーのみ IC | GBDT Baseline IC |")
    print("|---|---|---|---|---|---|")
    
    for i, target_date in enumerate(dates):
        # エンバーゴ: 予測日の5営業日（7暦日）以上前のデータのみを訓練に使う（重複リーク完全遮断）
        embargo_cutoff = target_date - pd.Timedelta(days=7)
        df_train = df_full[df_full["DiscDate"] <= embargo_cutoff].copy()
        df_test = df_full[df_full["DiscDate"] == target_date].copy()
        
        # 訓練データが最低100件以上たまるまでスキップ
        if len(df_train) < 100 or len(df_test) < 10:
            continue
            
        y_train = df_train["excess_return"].values
        y_test = df_test["excess_return"].values
        
        # 1. 単純ルール (OPサプライズ単体)
        pred_rule = df_test["feat_op_surprise"].fillna(0.0).values
        ic_rule = calc_spearman_rank_ic(pred_rule, y_test)
        
        # 2. 業種ダミーのみ (Ridge)
        m_sec = Ridge(alpha=5.0)
        m_sec.fit(df_train[dummy_cols].values, y_train)
        pred_sec = m_sec.predict(df_test[dummy_cols].values)
        ic_sec = calc_spearman_rank_ic(pred_sec, y_test)
        
        # 3. GBDT Baseline (数値サプライズ + 財務 + 決算種別 + 予想有無)
        X_tr = df_train[features_base].values
        X_te = df_test[features_base].values
        
        trn_data = lgb.Dataset(X_tr, label=y_train)
        model = lgb.train(lgb_params, trn_data, num_boost_round=40)
        pred_gbdt = model.predict(X_te)
        ic_gbdt = calc_spearman_rank_ic(pred_gbdt, y_test)
        
        eval_records.append({
            "DiscDate": target_date,
            "n_stocks": len(df_test),
            "n_train": len(df_train),
            "RankIC_Rule": ic_rule,
            "RankIC_SectorOnly": ic_sec,
            "RankIC_GBDT": ic_gbdt
        })
        
        d_str = target_date.strftime("%Y-%m-%d")
        print(f"| {d_str} | {len(df_test):4d} | {len(df_train):5d} | {ic_rule:+.4f} | {ic_sec:+.4f} | {ic_gbdt:+.4f} |")

    df_eval = pd.DataFrame(eval_records)
    
    print("\n" + "=" * 90)
    print("📈 統計的検定サマリー (Embargoed Walk-Forward / T = 22 日 / 1,000回 ブートストラップ):")
    print("=" * 90)
    
    for col, name in [("RankIC_Rule", "単純ルール (OPサプライズ)"), ("RankIC_SectorOnly", "業種ダミーのみ (Ridge)"), ("RankIC_GBDT", "GBDT Baseline (数値サプライズ)")]:
        series = df_eval[col].values
        mean_v, ci_v, p_v = stationary_block_bootstrap(series)
        std_v = np.std(series)
        ir_v = (mean_v / std_v) * np.sqrt(len(series)) if std_v > 0 else 0
        print(f"・{name:<32}: 平均 Rank IC = **{mean_v:+.4f}** (std: {std_v:.4f}, ICIR: {ir_v:.2f}, 95%CI下限: {ci_v:+.4f}, p: {p_v:.4f})")

    out_csv = RESULTS_DIR / "extended_embargoed_evaluation.csv"
    df_eval.to_csv(out_csv, index=False)
    print(f"\n📁 評価結果保存完了: {out_csv}")
    return df_eval

if __name__ == "__main__":
    run_embargoed_evaluation()
