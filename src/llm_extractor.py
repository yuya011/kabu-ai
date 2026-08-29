import os
import json
import time
import uuid
import urllib.request
from pathlib import Path
import pandas as pd
import numpy as np

DATA_DIR = Path("data")
OLLAMA_API_URL = "http://127.0.0.1:11434/api/generate"
MODEL_NAME = "qwen2.5:7b"

# 1. 四半期決算用プロンプト (進捗率と通期修正余地を評価)
PROMPT_QUARTERLY = """以下の【四半期決算開示サマリ】を金融アナリストとして評価し、必ず指定のJSONフォーマットのみを出力してください。

【開示情報】
企業名: {company_name} ({code})
業種: {sector}
開示種別: {doc_type} ({period})
売上高累計: {sales_str} (通期進捗率: {sales_prog:.1f}%, 基準比: {sales_prog_diff:+.1f}%)
営業利益累計: {op_str} (通期進捗率: {op_prog:.1f}%, 基準比: {op_prog_diff:+.1f}%)
純利益累計: {np_str} (通期進捗率: {np_prog:.1f}%, 基準比: {np_prog_diff:+.1f}%)

【出力フォーマット (JSON)】
{{
  "earnings_direction": "strong_positive" | "slight_positive" | "neutral" | "slight_negative" | "strong_negative",
  "guidance_revision": "large_upward" | "slight_upward" | "maintained" | "slight_downward" | "large_downward",
  "growth_quality": "high_quality_organic" | "steady" | "cost_push_one_off" | "deteriorating",
  "uncertainty_level": "low" | "moderate" | "high",
  "reasoning": "50文字以内の判定理由"
}}
"""

# 2. 本決算用プロンプト (通期着地と翌期会社ガイダンスの成長性を評価)
PROMPT_ANNUAL = """以下の【本決算(通期)開示サマリ】を金融アナリストとして評価し、必ず指定のJSONフォーマットのみを出力してください。

【開示情報】
企業名: {company_name} ({code})
業種: {sector}
開示種別: 本決算 (通期実績 + 翌期会社ガイダンス)
当期売上高実績: {sales_str} -> 翌期予想: {nxf_sales_str} (前年比: {nxf_sales_growth:+.1f}%)
当期営業利益実績: {op_str} -> 翌期予想: {nxf_op_str} (前年比: {nxf_op_growth:+.1f}%)
当期純利益実績: {np_str} -> 翌期予想: {nxf_np_str} (前年比: {nxf_np_growth:+.1f}%)

【出力フォーマット (JSON)】
{{
  "earnings_direction": "strong_positive" | "slight_positive" | "neutral" | "slight_negative" | "strong_negative",
  "guidance_revision": "large_upward" | "slight_upward" | "maintained" | "slight_downward" | "large_downward",
  "growth_quality": "high_quality_organic" | "steady" | "cost_push_one_off" | "deteriorating",
  "uncertainty_level": "low" | "moderate" | "high",
  "reasoning": "50文字以内の判定理由"
}}
"""

def encode_4d_vector(res: dict) -> tuple:
    map_dir = {"strong_positive": 2, "slight_positive": 1, "neutral": 0, "slight_negative": -1, "strong_negative": -2}
    map_rev = {"large_upward": 2, "slight_upward": 1, "maintained": 0, "slight_downward": -1, "large_downward": -2}
    map_qua = {"high_quality_organic": 2, "steady": 1, "cost_push_one_off": -1, "deteriorating": -2}
    map_unc = {"low": 1, "moderate": 0, "high": -1}
    return (
        map_dir.get(res.get("earnings_direction"), 0),
        map_rev.get(res.get("guidance_revision"), 0),
        map_qua.get(res.get("growth_quality"), 0),
        map_unc.get(res.get("uncertainty_level"), 0)
    )

def call_ollama_single(prompt: str, model: str = MODEL_NAME) -> dict:
    payload = {
        "model": model,
        "prompt": f"[SessionID: {uuid.uuid4()}]\n{prompt}",
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.0, "num_ctx": 2048, "num_predict": 120}
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA_API_URL, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.loads(res.read().decode("utf-8"))
        return json.loads(body.get("response", "{}"))
    except Exception:
        return {}

def extract_features_for_dataset(sample_limit: int = None):
    dataset_path = DATA_DIR / "extended_clean_dataset.parquet"
    df = pd.read_parquet(dataset_path)
    
    # OPサプライズまたはガイダンスが有効なレコードのみを対象
    valid_df = df[df["feat_op_surprise"].notna()].copy()
    print(f"🎯 LLM抽出対象（有効サプライズ銘柄）: {len(valid_df):,} 件 / 全{len(df):,} 件", flush=True)
    
    cache_path = DATA_DIR / "llm_features_extended_cache.parquet"
    if cache_path.exists():
        df_cached = pd.read_parquet(cache_path)
        cached_ids = set(df_cached["DiscNo"].dropna().tolist())
        print(f"📦 既存キャッシュ読み込み: {len(cached_ids):,} 件", flush=True)
    else:
        df_cached = pd.DataFrame()
        cached_ids = set()

    target_df = valid_df[~valid_df["DiscNo"].isin(cached_ids)].copy()
    if sample_limit:
        target_df = target_df.head(sample_limit)
        
    print(f"🤖 LLM定性特徴量抽出開始 (未処理: {len(target_df):,} 件, モデル: {MODEL_NAME})...", flush=True)
    
    results = []
    t0 = time.time()
    
    for i, (idx, row) in enumerate(target_df.iterrows()):
        is_fy = row.get("is_fy_earnings", 0) == 1
        
        # 1. 本決算プロンプト
        if is_fy:
            sales_v = row.get("Sales_num", 0.0)
            op_v = row.get("OP_num", 0.0)
            np_v = row.get("NP_num", 0.0)
            nxf_sales_v = row.get("NxFSales_num", 0.0) if "NxFSales_num" in row else 0.0
            nxf_op_v = row.get("NxFOP_num", 0.0) if "NxFOP_num" in row else 0.0
            nxf_np_v = row.get("NxFNp_num", 0.0) if "NxFNp_num" in row else 0.0
            
            prompt = PROMPT_ANNUAL.format(
                company_name=row.get("CoName", ""),
                code=row.get("Code", ""),
                sector=row.get("S17Nm", ""),
                sales_str=f"{sales_v/1e8:.1f}億円" if pd.notna(sales_v) else "記載なし",
                nxf_sales_str=f"{nxf_sales_v/1e8:.1f}億円" if pd.notna(nxf_sales_v) and nxf_sales_v > 0 else "未定",
                nxf_sales_growth=((nxf_sales_v - sales_v) / (abs(sales_v) + 1e5)) * 100 if nxf_sales_v > 0 and pd.notna(sales_v) else 0.0,
                op_str=f"{op_v/1e8:.1f}億円" if pd.notna(op_v) else "記載なし",
                nxf_op_str=f"{nxf_op_v/1e8:.1f}億円" if pd.notna(nxf_op_v) and nxf_op_v > 0 else "未定",
                nxf_op_growth=((nxf_op_v - op_v) / (abs(op_v) + 1e5)) * 100 if nxf_op_v > 0 and pd.notna(op_v) else 0.0,
                np_str=f"{np_v/1e8:.1f}億円" if pd.notna(np_v) else "記載なし",
                nxf_np_str=f"{nxf_np_v/1e8:.1f}億円" if pd.notna(nxf_np_v) and nxf_np_v > 0 else "未定",
                nxf_np_growth=((nxf_np_v - np_v) / (abs(np_v) + 1e5)) * 100 if nxf_np_v > 0 and pd.notna(np_v) else 0.0
            )
        # 2. 四半期決算プロンプト
        else:
            p_type = str(row.get("CurPerType", "2Q"))
            bench = 0.25 if "1Q" in p_type else (0.50 if "2Q" in p_type else 0.75)
            
            sales_v = row.get("Sales_num", 0.0)
            fsales_v = row.get("FSales_num", 1e-5)
            sales_prog = (sales_v / (abs(fsales_v) + 1e-5)) * 100 if pd.notna(sales_v) and pd.notna(fsales_v) else 0.0
            
            op_v = row.get("OP_num", 0.0)
            fop_v = row.get("FOP_num", 1e-5)
            op_prog = (op_v / (abs(fop_v) + 1e-5)) * 100 if pd.notna(op_v) and pd.notna(fop_v) else 0.0
            
            np_v = row.get("NP_num", 0.0)
            fnp_v = row.get("FNP_num", 1e-5)
            np_prog = (np_v / (abs(fnp_v) + 1e-5)) * 100 if pd.notna(np_v) and pd.notna(fnp_v) else 0.0
            
            prompt = PROMPT_QUARTERLY.format(
                company_name=row.get("CoName", ""),
                code=row.get("Code", ""),
                sector=row.get("S17Nm", ""),
                doc_type=row.get("DocType", ""),
                period=p_type,
                sales_str=f"{sales_v/1e8:.1f}億円" if pd.notna(sales_v) else "記載なし",
                sales_prog=sales_prog,
                sales_prog_diff=sales_prog - (bench * 100),
                op_str=f"{op_v/1e8:.1f}億円" if pd.notna(op_v) else "記載なし",
                op_prog=op_prog,
                op_prog_diff=op_prog - (bench * 100),
                np_str=f"{np_v/1e8:.1f}億円" if pd.notna(np_v) else "記載なし",
                np_prog=np_prog,
                np_prog_diff=np_prog - (bench * 100)
            )

        res_json = call_ollama_single(prompt)
        v_dir, v_rev, v_qua, v_unc = encode_4d_vector(res_json)
        
        r_dict = row.to_dict()
        r_dict["llm_feat_direction"] = v_dir
        r_dict["llm_feat_revision"] = v_rev
        r_dict["llm_feat_quality"] = v_qua
        r_dict["llm_feat_uncertainty"] = v_unc
        r_dict["llm_reasoning"] = res_json.get("reasoning", "")
        results.append(r_dict)
        
        # 100件ごと（または末尾）に parquet へ追記保存（チェックポイント保証）
        if (i + 1) % 50 == 0 or (i + 1) == len(target_df):
            elapsed = time.time() - t0
            speed = (i + 1) / elapsed
            rem_min = (len(target_df) - (i + 1)) / speed / 60 if speed > 0 else 0
            print(f"  ・進捗: {i+1:4d}/{len(target_df)} 件 ({speed:.2f} 件/秒, 残り約 {rem_min:.1f} 分) | 直近: {row.get('CoName')} -> Dir={v_dir}, Rev={v_rev}", flush=True)
            
            df_batch = pd.DataFrame(results)
            df_save = pd.concat([df_cached, df_batch], ignore_index=True) if not df_cached.empty else df_batch
            df_save.to_parquet(cache_path, index=False)

    df_final = pd.concat([df_cached, pd.DataFrame(results)], ignore_index=True) if not df_cached.empty else pd.DataFrame(results)
    df_final.to_parquet(cache_path, index=False)
    print(f"✅ LLM特徴量抽出完了: {cache_path} (総保存件数: {len(df_final):,} 件)", flush=True)
    return df_final

if __name__ == "__main__":
    extract_features_for_dataset(sample_limit=50)
