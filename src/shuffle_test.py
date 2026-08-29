import numpy as np
import pandas as pd
import lightgbm as lgb
from scipy import stats
from pathlib import Path

DATA_DIR = Path("data")

def calc_spearman_rank_ic(y_pred: np.ndarray, y_true: np.ndarray) -> float:
    if len(y_pred) < 3 or np.all(y_pred == y_pred[0]):
        return 0.0
    r, p = stats.spearmanr(y_pred, y_true)
    return 0.0 if np.isnan(r) else float(r)

def run_shuffle_test(n_trials: int = 100):
    dataset_path = DATA_DIR / "benchmark_dataset.parquet"
    if not dataset_path.exists():
        raise FileNotFoundError("benchmark_dataset.parquet が見つかりません。")
        
    df = pd.read_parquet(dataset_path)
    print("=" * 80)
    print(f"🔬 シャッフルテスト（日内ラベル並べ替え 100回試行）開始 (データ件数: {len(df):,} 件)")
    print("=" * 80)
    
    base_features = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio", "is_after_close"
    ]
    
    dates = sorted(df["DiscDate"].unique())
    
    # 1. 診断A: 従来の Leave-One-Out (未来データ混入バグあり) でのシャッフル結果
    # 2. 診断B: 厳密な Walk-Forward (過去データのみ、未来遮断) でのシャッフル結果
    
    lgb_params = {
        "objective": "regression",
        "metric": "l2",
        "boosting_type": "gbdt",
        "learning_rate": 0.05,
        "num_leaves": 15,
        "max_depth": 4,
        "min_child_samples": 10,
        "lambda_l1": 1.0,
        "lambda_l2": 5.0,
        "verbosity": -1,
        "random_state": 42
    }
    
    # オリジナル（シャッフルなし）の厳密Walk-Forward Rank IC
    wf_original_ics = []
    for i, target_date in enumerate(dates):
        # 厳密な過去データのみ (DiscDate < target_date)
        df_train = df[df["DiscDate"] < target_date].copy()
        df_test = df[df["DiscDate"] == target_date].copy()
        
        if len(df_train) < 50 or len(df_test) < 10:
            continue
            
        X_tr = df_train[base_features].fillna(0.0).values
        y_tr = df_train["excess_return"].values
        X_te = df_test[base_features].fillna(0.0).values
        y_te = df_test["excess_return"].values
        
        model = lgb.train(lgb_params, lgb.Dataset(X_tr, label=y_tr), num_boost_round=40)
        pred = model.predict(X_te)
        ic = calc_spearman_rank_ic(pred, y_te)
        wf_original_ics.append(ic)
        
    print(f"\n【事前確認】厳密な Walk-Forward (過去データのみで学習) でのオリジナル Rank IC:")
    print(f"  ・対象日数: {len(wf_original_ics)} 日")
    print(f"  ・平均 Rank IC: **{np.mean(wf_original_ics):+.4f}** (Leave-One-Outの +0.31 から激減して真の姿が露出)")
    print(f"  ・各日のIC: {[round(x, 3) for x in wf_original_ics]}")

    # シャッフルテスト実行
    print(f"\n【シャッフルテスト実行中】各開示日の中でラベルをランダム並べ替え ({n_trials} 回)...")
    shuffled_mean_ics_loo = [] # Leave-One-Out
    shuffled_mean_ics_wf = []  # Walk-Forward
    
    for trial in range(n_trials):
        # 日内でシャッフル
        df_shuffled = df.copy()
        shuffled_labels = []
        for d, grp in df.groupby("DiscDate"):
            perm = np.random.permutation(grp["excess_return"].values)
            df_shuffled.loc[grp.index, "excess_return"] = perm
            
        # Walk-Forward で評価
        trial_wf_ics = []
        for target_date in dates:
            df_tr = df_shuffled[df_shuffled["DiscDate"] < target_date]
            df_te = df_shuffled[df_shuffled["DiscDate"] == target_date]
            if len(df_tr) < 50 or len(df_te) < 10:
                continue
            X_tr = df_tr[base_features].fillna(0.0).values
            y_tr = df_tr["excess_return"].values
            X_te = df_te[base_features].fillna(0.0).values
            y_te = df_te["excess_return"].values
            
            model = lgb.train(lgb_params, lgb.Dataset(X_tr, label=y_tr), num_boost_round=40)
            pred = model.predict(X_te)
            trial_wf_ics.append(calc_spearman_rank_ic(pred, y_te))
            
        if trial_wf_ics:
            shuffled_mean_ics_wf.append(np.mean(trial_wf_ics))
            
        if (trial + 1) % 20 == 0:
            print(f"  ・進捗: {trial+1}/{n_trials} 試行完了 (直近平均IC: {shuffled_mean_ics_wf[-1]:+.4f})", flush=True)

    print("\n" + "=" * 80)
    print("📊 シャッフルテスト（帰無分布）最終結果:")
    print("=" * 80)
    print(f"・シャッフル 100回 試行の平均 Rank IC : **{np.mean(shuffled_mean_ics_wf):+.4f}**")
    print(f"・シャッフル Rank IC 標準偏差         : {np.std(shuffled_mean_ics_wf):.4f}")
    print(f"・シャッフル 95% 範囲                : [{np.percentile(shuffled_mean_ics_wf, 2.5):+.4f}, {np.percentile(shuffled_mean_ics_wf, 97.5):+.4f}]")
    print(f"・オリジナル Walk-Forward Rank IC   : **{np.mean(wf_original_ics):+.4f}**")
    
    # 帰無分布との比較による真の有意性
    p_perm = np.mean(np.array(shuffled_mean_ics_wf) >= np.mean(wf_original_ics))
    print(f"・並べ替え検定 (Permutation Test) p-value: **{p_perm:.4f}**")
    print("=" * 80)

if __name__ == "__main__":
    run_shuffle_test(n_trials=100)
