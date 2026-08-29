import os
import numpy as np
import pandas as pd
import lightgbm as lgb
from scipy import stats
from pathlib import Path
from sklearn.model_selection import KFold

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

def run_evaluation_pipeline():
    full_dataset_path = DATA_DIR / "benchmark_dataset.parquet"
    llm_cache_path = DATA_DIR / "llm_features_cache.parquet"
    
    if not full_dataset_path.exists():
        raise FileNotFoundError("benchmark_dataset.parquet が存在しません。")
        
    df_full = pd.read_parquet(full_dataset_path)
    
    # LLMキャッシュが存在する場合はマージ
    if llm_cache_path.exists():
        df_llm = pd.read_parquet(llm_cache_path)
        llm_cols = ["DiscNo", "llm_feat_direction", "llm_feat_revision", "llm_feat_quality", "llm_feat_uncertainty"]
        df_merged = pd.merge(df_full, df_llm[llm_cols].drop_duplicates("DiscNo"), on="DiscNo", how="left")
    else:
        df_merged = df_full.copy()
        
    print("=" * 80)
    print(f"📊 LightGBM ベースライン & LLM増分検定パイプライン (全データ: {len(df_merged):,} 件)")
    print("=" * 80)
    
    base_features = [
        "feat_op_surprise", "feat_sales_surprise", "feat_np_surprise",
        "feat_roe", "feat_eq_ratio", "is_after_close"
    ]
    llm_feature_names = ["llm_feat_direction", "llm_feat_revision", "llm_feat_quality", "llm_feat_uncertainty"]
    
    # 全データに対するLightGBMパラメータ（実務クオンツ設定）
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
    
    dates = sorted(df_merged["DiscDate"].unique())
    eval_records = []
    
    for target_date in dates:
        df_test = df_merged[df_merged["DiscDate"] == target_date].copy()
        df_train = df_merged[df_merged["DiscDate"] != target_date].copy()
        
        if len(df_test) < 5 or len(df_train) < 50:
            continue
            
        y_train = df_train["excess_return"].values
        y_test = df_test["excess_return"].values
        
        # 1. 単純ルール IC
        pred_rule = df_test["feat_op_surprise"].values
        ic_rule = calc_spearman_rank_ic(pred_rule, y_test)
        
        # 2. Baseline GBDT
        X_train_base = df_train[base_features].fillna(0.0).values
        X_test_base = df_test[base_features].fillna(0.0).values
        
        trn_data_base = lgb.Dataset(X_train_base, label=y_train)
        model_base = lgb.train(lgb_params, trn_data_base, num_boost_round=50)
        pred_base = model_base.predict(X_test_base)
        ic_base = calc_spearman_rank_ic(pred_base, y_test)
        
        # 3. GBDT + LLM 特徴量 (LLM特徴量が埋まっている銘柄のみで比較)
        test_has_llm = df_test[llm_feature_names].dropna()
        if len(test_has_llm) >= 5:
            idx_sub = test_has_llm.index
            y_test_sub = df_test.loc[idx_sub, "excess_return"].values
            
            # LLMモデル (訓練データは欠損を0埋めして学習)
            all_feats = base_features + llm_feature_names
            X_train_all = df_train[all_feats].fillna(0.0).values
            X_test_all = df_test.loc[idx_sub, all_feats].fillna(0.0).values
            
            trn_data_all = lgb.Dataset(X_train_all, label=y_train)
            model_all = lgb.train(lgb_params, trn_data_all, num_boost_round=50)
            pred_llm = model_all.predict(X_test_all)
            
            pred_base_sub = model_base.predict(df_test.loc[idx_sub, base_features].fillna(0.0).values)
            ic_base_matched = calc_spearman_rank_ic(pred_base_sub, y_test_sub)
            ic_llm = calc_spearman_rank_ic(pred_llm, y_test_sub)
            delta_ic = ic_llm - ic_base_matched
        else:
            ic_llm = np.nan
            delta_ic = np.nan
            
        eval_records.append({
            "DiscDate": target_date,
            "n_stocks": len(df_test),
            "RankIC_Rule": ic_rule,
            "RankIC_Base": ic_base,
            "RankIC_LLM": ic_llm,
            "Delta_RankIC": delta_ic
        })
        
    df_eval = pd.DataFrame(eval_records)
    print("\n" + "-" * 80)
    print("| 開示日 | 銘柄数 | 単純ルール IC | GBDT Baseline IC | GBDT + LLM IC | 増分 ΔRank IC |")
    print("|---|---|---|---|---|---|")
    for _, r in df_eval.iterrows():
        d_str = pd.to_datetime(r["DiscDate"]).strftime("%Y-%m-%d")
        llm_s = f"{r['RankIC_LLM']:+.4f}" if pd.notna(r["RankIC_LLM"]) else "N/A"
        delta_s = f"**{r['Delta_RankIC']:+.4f}**" if pd.notna(r["Delta_RankIC"]) else "N/A"
        print(f"| {d_str} | {int(r['n_stocks']):4d} | {r['RankIC_Rule']:+.4f} | {r['RankIC_Base']:+.4f} | {llm_s} | {delta_s} |")

    # 統計サマリ
    print("\n" + "=" * 80)
    print("📈 統計的検定サマリー (Stationary Block Bootstrap / 1,000 Resamples):")
    print("=" * 80)
    
    base_ics = df_eval["RankIC_Base"].values
    mean_b, ci_b, p_b = stationary_block_bootstrap(base_ics)
    ir_b = (mean_b / np.std(base_ics)) * np.sqrt(len(base_ics)) if np.std(base_ics) > 0 else 0
    print(f"1. GBDT Baseline (全1,394銘柄・数値サプライズ):")
    print(f"   ・平均 Rank IC: **{mean_b:+.4f}**")
    print(f"   ・Rank ICIR   : **{ir_b:.3f}**")
    print(f"   ・95% CI 下限 : {ci_b:+.4f} (p-value: {p_b:.4f})")
    
    valid_deltas = df_eval["Delta_RankIC"].dropna()
    if len(valid_deltas) > 0:
        mean_d, ci_d, p_d = stationary_block_bootstrap(valid_deltas.values)
        print(f"\n2. 対応のある増分検定 (LLM特徴量抽出済みサンプル):")
        print(f"   ・平均増分 ΔIC: **{mean_d:+.4f}** (95% CI 下限: {ci_d:+.4f}, p-value: {p_d:.4f})")

    out_csv = RESULTS_DIR / "evaluation_results.csv"
    df_eval.to_csv(out_csv, index=False)
    print(f"\n📁 評価結果保存完了: {out_csv}")
    return df_eval

if __name__ == "__main__":
    run_evaluation_pipeline()
