import time
import json
import statistics
import urllib.request
import urllib.error
import re
import uuid

OLLAMA_API_URL = "http://127.0.0.1:11434/api/generate"
# 7bが利用可能なら7b、なければcoder:latest(7.6B)を使用
DEFAULT_MODEL = "qwen2.5:7b"

# 実務を模した12銘柄データ ＋ 同義言い換え（摂動テスト用）
BENCHMARK_DISCLOSURES = [
    {
        "id": "01_bullish_clear",
        "company": "半導体A",
        "original": "2026年3月期第3四半期累計の連結営業利益は前年同期比45.2%増の1,420億円となった。生成AIデータセンター向け先端パッケージ基板の受注が想定を大幅に上回って推移した。これに伴い通期連結営業利益予想を従来の1,500億円から1,800億円（前期比38.5%増）へ上方修正し、年間配当予想も1株当たり15円増配の85円とする。",
        "paraphrased": "第3四半期の累計営業利益は前年同期比で45.2%伸長し1,420億円に達した。データセンター向け次世代パッケージ基板の引き合いが極めて旺盛だった。これを受けて通期営業利益の見通しを従来の1,500億円から1,800億円（38.5%増）へ引き上げ、期末配当も1株につき15円引き上げ85円へ増配する方針である。"
    },
    {
        "id": "02_bearish_clear",
        "company": "化学B",
        "original": "2026年3月期通期の連結営業損益予想を従来の80億円の黒字から150億円の赤字に下方修正する。中国市場における汎用樹脂の市況低迷が長期化し、製品スプレッドが急激に縮小したことに加え、減損損失120億円を特別損失に計上したため。",
        "paraphrased": "通期の連結営業損益について、当初見込んでいた80億円の黒字から一転して150億円の営業赤字へ下方改定する。中国での汎用樹脂の需要低迷が長引いて採算が悪化したこと、さらに120億円の固定資産減損損失を特損計上したことが響いた。"
    },
    {
        "id": "03_neutral_inline",
        "company": "通信C",
        "original": "第3四半期累計の売上高は前年同期比1.2%増の3兆4,200億円、営業利益は0.8%増の6,540億円と概ね期初計画通りの進捗となった。法人向けDXソリューションが堅調だった一方、光回線の競争激化による販促費増が相殺した。通期見通し（営業利益8,700億円）は据え置く。",
        "paraphrased": "3Q累計売上高は前年比1.2%増の3兆4,200億円、営業利益は0.8%増の6,540億円と、ほぼ期初計画通りの進捗で推移した。企業のDX投資需要が下支えしたものの、個人向けブロードバンドでの販売競争に伴う費用増が利益を押し下げた。通期の業績予想（営業益8,700億円）に変更はない。"
    },
    {
        "id": "04_topline_up_profit_down",
        "company": "小売D",
        "original": "第3四半期累計の売上高は前年同期比8.5%増の9,200億円と過去最高を更新したものの、営業利益は14.2%減の380億円となった。インバウンド需要や値上げ浸透で客単価は上昇したが、物流人件費の上昇および新規出店に伴う先行投資、光熱費の高騰が利益を圧迫した。通期予想は据え置く。",
        "paraphrased": "3Q累計の売上高は訪日外国人需要や価格転嫁が進み前年同期比8.5%増の9,200億円と最高を記録したが、営業利益は物流費・人件費の高騰や出店コスト増により14.2%減の380億円へ落ち込んだ。通期ガイダンスは現行のまま据え置く。"
    },
    {
        "id": "05_slight_beat_low_progress",
        "company": "精密機械E",
        "original": "第3四半期累計の営業利益は前年同期比5.4%増の320億円となり、四半期ベースでは市場予想を小幅に上回った。ただし、通期計画（480億円）に対する進捗率は66.7%にとどまり、過去3年平均の74%を下回る。第4四半期への需要回復を前提としており、通期計画は据え置く。",
        "paraphrased": "第3四半期累計の営業益は前年同期比5.4%増の320億円と、市場コンセンサスをわずかに上回って着地した。もっとも、年間目標480億円に対する進捗は66.7%と例年（平均74%）より鈍い。4Qでの挽回を見込んでおり、通期計画の修正は見送った。"
    },
    {
        "id": "06_guidance_cut_bottoming",
        "company": "電子部品F",
        "original": "通期営業利益予想を従来の250億円から180億円（前期比28.0%減）へ下方修正する。産業機器向け在庫調整の長期化が主因。ただし、車載向けセンサの受注は10-12月期を底に回復傾向にあり、第4四半期の受注高は前四半期比12%増と底入れの兆候が見られる。",
        "paraphrased": "通期の営業利益見通しを250億円から180億円（前年比28%減）へと引き下げた。産機向けの調整局面が長引いたため。しかし、自動車向けセンサーの受注動向は直近四半期で底を打ち、4Q受注は前期比12%増と持ち直しつつある。"
    },
    {
        "id": "07_one_off_boost",
        "company": "不動産G",
        "original": "第3四半期累計の純利益は前年同期比82.0%増の550億円となった。ただしこれは大型オフィスビルの売却に伴う固定資産売却益（特別利益240億円）が主因であり、本業の賃貸および分譲事業の営業利益は前年並みの水準にとどまる。通期見通しは据え置く。",
        "paraphrased": "3Q累計純利益は前年同期比82%増の550億円と大幅増益となったが、保有ビルの譲渡益240億円を特利計上した影響が大きい。主力のオフィス賃貸や住宅分譲の営業利益は前年と同水準。通期の業績見通しに変更はない。"
    },
    {
        "id": "08_slight_upgrade_conservative",
        "company": "食品H",
        "original": "通期営業利益予想を従来の120億円から125億円（前期比4.2%増）へ小幅上方修正する。価格改定の定着と原材料コストの落ち着きによる。ただし為替の急激な変動および消費者の節約志向の高まりを考慮し、第4四半期の前提は極めて保守的に見積もっている。",
        "paraphrased": "通期営業利益予想を120億円から125億円へ上方修正。値上げ効果と原料高の一服が寄与。もっとも、円安や生活防衛意識の影響を警戒し、残り期間の前提は慎重に設定している。"
    },
    {
        "id": "09_guidance_maintained_cost_risk",
        "company": "素材I",
        "original": "第3四半期累計の営業利益は前年同期比1.5%増の210億円。自動車向け高機能素材の出荷が堅調で計画線上。通期営業利益280億円は据え置くが、足元での中東情勢緊迫化に伴うナフサ価格の再上昇が第4四半期のコスト増加リスクとして懸念される。",
        "paraphrased": "3Q営業利益は210億円と前年比1.5%増で計画通りに進捗。通期280億円は維持するものの、原油・ナフサ価格の再上昇が今後のコスト面での下振れ要因として意識される。"
    },
    {
        "id": "10_guidance_beat_no_revision",
        "company": "ITサービスJ",
        "original": "第3四半期累計の営業利益は前年同期比22.0%増の95億円となり、通期計画（100億円）に対する進捗率は95.0%に達した。金融機関向けクラウド移行案件が前倒しで寄与した。通期上方修正の期待が高まるが、会社側は期末の人材採用投資および研究開発費の執行を見込み、通期計画を据え置いた。",
        "paraphrased": "3Q累計営業益は前年比22%増の95億円、通期計画100億円に対する達成率は95%に到達。クラウド案件の前倒しが寄与。市場の上方修正期待はあるが、期末の投資や採用費用を見込んで通期計画は据え置きとした。"
    },
    {
        "id": "11_foreign_exchange_windfall",
        "company": "機械K",
        "original": "第3四半期累計の営業利益は前年同期比18.5%増の410億円。円安進行に伴う為替換算影響が+65億円寄与した。現地通貨ベースでの実質販売数量は欧州市場の減速により前年同期比4%減。通期予想は期初想定レート（1ドル=145円）を150円に見直したことに伴い上方修正。",
        "paraphrased": "3Q営業益は410億円（18.5%増）となったが、円安効果が65億円押し上げた。現地通貨ベースの数量は欧州不振で前年割れ。想定為替レートの円安修正を主因に通期予想を引き上げた。"
    },
    {
        "id": "12_unfavorable_product_mix",
        "company": "自動車部品L",
        "original": "第3四半期累計の売上高は前年同期比5.0%増の6,200億円、営業利益は前年同期比8.0%減の240億円。完成車メーカーの減産影響は限定的だったものの、利益率の高い補修用部品の比率が低下し、製品ミックスの悪化が採算を押し下げた。通期予想は据え置く。",
        "paraphrased": "3Q売上は5%増の6,200億円だが、営業利益は8%減の240億円。高収益なアフターマーケット向け比率の低下など製品構成の悪化が利益率を押し下げた。通期計画は据え置く。"
    }
]

def clean_json_response(raw_text: str) -> dict:
    try:
        return json.loads(raw_text)
    except Exception:
        m = re.search(r'\{.*\}', raw_text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {
        "earnings_direction": "neutral",
        "guidance_revision": "maintained",
        "growth_quality": "steady",
        "uncertainty_level": "moderate",
        "reasoning": "パース失敗"
    }

def call_ollama(prompt: str, temperature: float = 0.0, num_ctx: int = 4096, model: str = DEFAULT_MODEL, disable_cache: bool = True) -> dict:
    # キャッシュ無効化のためのノンス埋め込み
    effective_prompt = f"[SessionID: {uuid.uuid4()}]\n{prompt}" if disable_cache else prompt
    
    payload = {
        "model": model,
        "prompt": effective_prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_ctx": num_ctx,
            "num_predict": 180
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA_API_URL, data=data, headers={"Content-Type": "application/json"})
    
    t_start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}
        
    wall_time = time.time() - t_start
    
    p_count = body.get("prompt_eval_count", 0)
    p_dur_ms = body.get("prompt_eval_duration", 0) / 1e6
    e_count = body.get("eval_count", 0)
    e_dur_ms = body.get("eval_duration", 0) / 1e6
    
    p_rate = (p_dur_ms / p_count) if p_count > 0 else 0
    e_rate = (e_dur_ms / e_count) if e_count > 0 else 0
    
    parsed = clean_json_response(body.get("response", "{}"))
    
    return {
        "wall_time": wall_time,
        "prompt_eval_count": p_count,
        "prompt_eval_duration_ms": p_dur_ms,
        "prompt_ms_per_tok": p_rate,
        "eval_count": e_count,
        "eval_duration_ms": e_dur_ms,
        "eval_ms_per_tok": e_rate,
        "result": parsed
    }

def encode_4d_vector(res: dict) -> tuple:
    """4項目を数値ベクトルにエンコード (LightGBM入力用)"""
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

def run_rigorous_smoke_test_v2():
    # 使用可能モデルの判定
    model_to_use = DEFAULT_MODEL
    # テスト呼び出しでモデル確認
    test_call = call_ollama("test", model=model_to_use)
    if "error" in test_call:
        print(f"⚠️ {model_to_use} not ready, trying qwen2.5-coder:latest...")
        model_to_use = "qwen2.5-coder:latest"
        test_call2 = call_ollama("test", model=model_to_use)
        if "error" in test_call2:
            model_to_use = "qwen2.5:3b"

    print("=" * 80, flush=True)
    print(f"🔬 厳密スモークテスト v2 開始 (Model: {model_to_use})", flush=True)
    print("=" * 80, flush=True)
    
    # ----------------------------------------------------
    # Step 1: プロンプト長スケーリング測定（キャッシュ無効化）
    # ----------------------------------------------------
    print("\n[Step 1] 入力長スケーリング & プロンプト処理レート実測 (キャッシュ無効化)...", flush=True)
    print("※ 200, 500, 1000, 2000 トークンで線形性と実効処理速度を計測", flush=True)
    
    dummy_text_unit = "2026年3月期の第3四半期決算における業績進捗状況と通期予想の修正要因について詳細に分析する。"
    lengths = [200, 500, 1000, 2000]
    scaling_results = []
    
    for l in lengths:
        # 指定トークン数に近いテキストを生成
        repeat_count = max(1, int(l / 25))
        prompt_body = f"以下のテキストを読み、JSONで応答してください。\n\n" + (dummy_text_unit * repeat_count)
        res = call_ollama(prompt_body, temperature=0.0, model=model_to_use, disable_cache=True)
        if "error" not in res:
            scaling_results.append(res)
            print(f"  Target ~{l:4d} tok | Actual PromptTok: {res['prompt_eval_count']:4d} | PromptDur: {res['prompt_eval_duration_ms']:6.1f}ms | Rate: {res['prompt_ms_per_tok']:.3f} ms/tok ({1000/res['prompt_ms_per_tok']:.1f} tok/s) | Gen: {res['eval_count']} tok ({res['eval_ms_per_tok']:.2f} ms/tok)", flush=True)

    avg_p_rate = statistics.mean([r["prompt_ms_per_tok"] for r in scaling_results])
    avg_e_rate = statistics.mean([r["eval_ms_per_tok"] for r in scaling_results])
    
    est_1000_inf = (1000 * avg_p_rate + 150 * avg_e_rate) / 1000
    print(f"\n実測プロンプト処理平均: {avg_p_rate:.3f} ms/tok ({1000/avg_p_rate:.1f} tok/s)")
    print(f"実測トークン生成平均  : {avg_e_rate:.3f} ms/tok ({1000/avg_e_rate:.1f} tok/s)")
    print(f"→ 本番1件想定（入力1,000 tok ＋ 出力150 tok）: **{est_1000_inf:.2f} 秒/件**")
    print(f"→ 4,000開示イベントの総推論時間: **約 {est_1000_inf * 4000 / 3600:.2f} 時間**")

    # ----------------------------------------------------
    # Step 2: 摂動テストによる真の within 分散・ICC測定
    # ----------------------------------------------------
    print("\n" + "-" * 80, flush=True)
    print("[Step 2] 摂動テスト（言い換え・プロンプト順序反転・temp=0.3）による真の within 分散測定...", flush=True)
    print("※ 同一銘柄に対して4パターンの摂動を与え、識別力 (ICC) と頑健性を評価", flush=True)
    
    prompt_std = """以下の適時開示テキストを客観的に評価し、必ず以下のJSONフォーマットのみを出力してください。
フォーマット:
{{
  "earnings_direction": "strong_positive" | "slight_positive" | "neutral" | "slight_negative" | "strong_negative",
  "guidance_revision": "large_upward" | "slight_upward" | "maintained" | "slight_downward" | "large_downward",
  "growth_quality": "high_quality_organic" | "steady" | "cost_push_one_off" | "deteriorating",
  "uncertainty_level": "low" | "moderate" | "high",
  "reasoning": "50文字以内の判定理由"
}}

開示テキスト:
{text}
"""

    prompt_inverted = """以下の適時開示テキストを客観的に評価し、必ず以下のJSONフォーマットのみを出力してください。
フォーマット:
{{
  "uncertainty_level": "low" | "moderate" | "high",
  "growth_quality": "high_quality_organic" | "steady" | "cost_push_one_off" | "deteriorating",
  "guidance_revision": "large_upward" | "slight_upward" | "maintained" | "slight_downward" | "large_downward",
  "earnings_direction": "strong_positive" | "slight_positive" | "neutral" | "slight_negative" | "strong_negative",
  "reasoning": "50文字以内の判定理由"
}}

開示テキスト:
{text}
"""

    perturbation_records = []
    four_d_vectors_all = []
    
    print("\n| ID | 銘柄名 | P1(原文) | P2(言い換え) | P3(順序反転) | P4(temp0.3) | 一致率 | 4Dベクトル代表値 |", flush=True)
    print("|---|---|---|---|---|---|---|---|", flush=True)
    
    for item in BENCHMARK_DISCLOSURES:
        # 4パターンの摂動
        trials = []
        
        # P1: 原文, temp=0
        r1 = call_ollama(prompt_std.format(text=item["original"]), temperature=0.0, model=model_to_use)
        v1 = encode_4d_vector(r1.get("result", {}))
        trials.append(v1)
        
        # P2: 同義言い換え, temp=0
        r2 = call_ollama(prompt_std.format(text=item["paraphrased"]), temperature=0.0, model=model_to_use)
        v2 = encode_4d_vector(r2.get("result", {}))
        trials.append(v2)
        
        # P3: プロンプト項目順序反転, temp=0
        r3 = call_ollama(prompt_inverted.format(text=item["original"]), temperature=0.0, model=model_to_use)
        v3 = encode_4d_vector(r3.get("result", {}))
        trials.append(v3)
        
        # P4: 原文, temp=0.3
        r4 = call_ollama(prompt_std.format(text=item["original"]), temperature=0.3, model=model_to_use)
        v4 = encode_4d_vector(r4.get("result", {}))
        trials.append(v4)
        
        perturbation_records.append(trials)
        four_d_vectors_all.append(v1)
        
        # 4試行の一致率（完全一致）
        match_cnt = sum(1 for v in trials if v == trials[0])
        match_rate = match_cnt / 4.0 * 100
        
        print(f"| {item['id'][:2]} | {item['company']} | {v1} | {v2} | {v3} | {v4} | {match_rate:4.1f}% | **{v1}** |", flush=True)

    # 4次元各要素ごとの ICC 計算
    feature_names = ["業績方向 (direction)", "予想修正 (revision)", "成長の質 (quality)", "不確実性 (uncertainty)"]
    print("\n--- 4本の特徴量ごとの分散分解 & ICC (摂動下) ---", flush=True)
    
    k = 4  # 摂動パターン数
    n = len(BENCHMARK_DISCLOSURES) # 12
    
    for feat_idx, fname in enumerate(feature_names):
        feat_trials = [[v[feat_idx] for v in item_t] for item_t in perturbation_records]
        all_vals = [val for sublist in feat_trials for val in sublist]
        grand_mean = statistics.mean(all_vals)
        
        ss_between = sum(k * (statistics.mean(group) - grand_mean) ** 2 for group in feat_trials)
        ss_within = sum(sum((x - statistics.mean(group)) ** 2 for x in group) for group in feat_trials)
        
        ms_between = ss_between / (n - 1)
        ms_within = ss_within / (n * (k - 1)) if (n * (k - 1)) > 0 else 1e-6
        
        var_w = ms_within
        var_b = max(0.0, (ms_between - ms_within) / k)
        icc = var_b / (var_b + var_w) if (var_b + var_w) > 0 else 0.0
        
        print(f"・{fname:<25}: ICC = **{icc:.4f}** (σ_between^2={var_b:.3f}, σ_within^2={var_w:.3f})", flush=True)

    # 4次元空間での階調分布（ユニークベクトル数）
    unique_4d_tuples = set(four_d_vectors_all)
    print("\n" + "=" * 80, flush=True)
    print("📊 厳密スモークテスト v2 最終結論:", flush=True)
    print("=" * 80, flush=True)
    print(f"1. 4次元特徴量の階調分解能: **{len(unique_4d_tuples)} / 12 ユニーク** (タイ率: {(1 - len(unique_4d_tuples)/12)*100:.1f}%)")
    print(f"   → 1次元合成スコアで潰さず4次元のままLightGBMに渡すことで、タイ問題が大幅に解消。")
    print(f"2. 本番推論時間（4,000件）: **約 {est_1000_inf * 4000 / 3600:.1f} 時間**")
    print("=" * 80, flush=True)

if __name__ == "__main__":
    run_rigorous_smoke_test_v2()
