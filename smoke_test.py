import time
import json
import statistics
import urllib.request
import urllib.error
import re

OLLAMA_API_URL = "http://127.0.0.1:11434/api/generate"
MODEL_NAME = "qwen2.5:3b"

# 実務の開示を模したリアルな決算短信・業績修正サンプル（中間帯・判別困難ケース含む12件）
REALISTIC_DISCLOSURES = [
    {
        "id": "01_bullish_clear",
        "company": "半導体A",
        "text": "2026年3月期第3四半期累計の連結営業利益は前年同期比45.2%増の1,420億円となった。生成AIデータセンター向け先端パッケージ基板の受注が想定を大幅に上回って推移した。これに伴い通期連結営業利益予想を従来の1,500億円から1,800億円（前期比38.5%増）へ上方修正し、年間配当予想も1株当たり15円増配の85円とする。"
    },
    {
        "id": "02_bearish_clear",
        "company": "化学B",
        "text": "2026年3月期通期の連結営業損益予想を従来の80億円の黒字から150億円の赤字に下方修正する。中国市場における汎用樹脂の市況低迷が長期化し、製品スプレッドが急激に縮小したことに加え、減損損失120億円を特別損失に計上したため。"
    },
    {
        "id": "03_neutral_inline",
        "company": "通信C",
        "text": "第3四半期累計の売上高は前年同期比1.2%増の3兆4,200億円、営業利益は0.8%増の6,540億円と概ね期初計画通りの進捗となった。法人向けDXソリューションが堅調だった一方、光回線の競争激化による販促費増が相殺した。通期見通し（営業利益8,700億円）は据え置く。"
    },
    {
        "id": "04_topline_up_profit_down",
        "company": "小売D",
        "text": "第3四半期累計の売上高は前年同期比8.5%増の9,200億円と過去最高を更新したものの、営業利益は14.2%減の380億円となった。インバウンド需要や値上げ浸透で客単価は上昇したが、物流人件費の上昇および新規出店に伴う先行投資、光熱費の高騰が利益を圧迫した。通期予想は据え置く。"
    },
    {
        "id": "05_slight_beat_low_progress",
        "company": "精密機械E",
        "text": "第3四半期累計の営業利益は前年同期比5.4%増の320億円となり、四半期ベースでは市場予想を小幅に上回った。ただし、通期計画（480億円）に対する進捗率は66.7%にとどまり、過去3年平均の74%を下回る。第4四半期への需要回復を前提としており、通期計画は据え置く。"
    },
    {
        "id": "06_guidance_cut_bottoming",
        "company": "電子部品F",
        "text": "通期営業利益予想を従来の250億円から180億円（前期比28.0%減）へ下方修正する。産業機器向け在庫調整の長期化が主因。ただし、車載向けセンサの受注は10-12月期を底に回復傾向にあり、第4四半期の受注高は前四半期比12%増と底入れの兆候が見られる。"
    },
    {
        "id": "07_one_off_boost",
        "company": "不動産G",
        "text": "第3四半期累計の純利益は前年同期比82.0%増の550億円となった。ただしこれは大型オフィスビルの売却に伴う固定資産売却益（特別利益240億円）が主因であり、本業の賃貸および分譲事業の営業利益は前年並みの水準にとどまる。通期見通しは据え置く。"
    },
    {
        "id": "08_slight_upgrade_conservative",
        "company": "食品H",
        "text": "通期営業利益予想を従来の120億円から125億円（前期比4.2%増）へ小幅上方修正する。価格改定の定着と原材料コストの落ち着きによる。ただし為替の急激な変動および消費者の節約志向の高まりを考慮し、第4四半期の前提は極めて保守的に見積もっている。"
    },
    {
        "id": "09_guidance_maintained_cost_risk",
        "company": "素材I",
        "text": "第3四半期累計の営業利益は前年同期比1.5%増の210億円。自動車向け高機能素材の出荷が堅調で計画線上。通期営業利益280億円は据え置くが、足元での中東情勢緊迫化に伴うナフサ価格の再上昇が第4四半期のコスト増加リスクとして懸念される。"
    },
    {
        "id": "10_guidance_beat_no_revision",
        "company": "ITサービスJ",
        "text": "第3四半期累計の営業利益は前年同期比22.0%増の95億円となり、通期計画（100億円）に対する進捗率は95.0%に達した。金融機関向けクラウド移行案件が前倒しで寄与した。通期上方修正の期待が高まるが、会社側は期末の人材採用投資および研究開発費の執行を見込み、通期計画を据え置いた。"
    },
    {
        "id": "11_foreign_exchange_windfall",
        "company": "機械K",
        "text": "第3四半期累計の営業利益は前年同期比18.5%増の410億円。円安進行に伴う為替換算影響が+65億円寄与した。現地通貨ベースでの実質販売数量は欧州市場の減速により前年同期比4%減。通期予想は期初想定レート（1ドル=145円）を150円に見直したことに伴い上方修正。"
    },
    {
        "id": "12_unfavorable_product_mix",
        "company": "自動車部品L",
        "text": "第3四半期累計の売上高は前年同期比5.0%増の6,200億円、営業利益は前年同期比8.0%減の240億円。完成車メーカーの減産影響は限定的だったものの、利益率の高い補修用部品の比率が低下し、製品ミックスの悪化が採算を押し下げた。通期予想は据え置く。"
    }
]

def calculate_composite_score(res_dict: dict) -> float:
    """離散4項目から連続加重合成スコアを算出"""
    weights = {
        "direction": {"strong_positive": 1.0, "slight_positive": 0.5, "neutral": 0.0, "slight_negative": -0.5, "strong_negative": -1.0},
        "revision": {"large_upward": 1.0, "slight_upward": 0.5, "maintained": 0.0, "slight_downward": -0.5, "large_downward": -1.0},
        "quality": {"high_quality_organic": 0.5, "steady": 0.0, "cost_push_one_off": -0.25, "deteriorating": -0.5},
        "uncertainty": {"low": 0.2, "moderate": 0.0, "high": -0.2}
    }
    
    s_dir = weights["direction"].get(res_dict.get("earnings_direction"), 0.0)
    s_rev = weights["revision"].get(res_dict.get("guidance_revision"), 0.0)
    s_q = weights["quality"].get(res_dict.get("growth_quality"), 0.0)
    s_u = weights["uncertainty"].get(res_dict.get("uncertainty_level"), 0.0)
    
    raw_comp = (s_dir * 0.4) + (s_rev * 0.4) + (s_q * 0.15) + (s_u * 0.05)
    return round(raw_comp, 4)

def clean_json_response(raw_text: str) -> dict:
    """頑健なJSON抽出"""
    try:
        return json.loads(raw_text)
    except Exception:
        # JSONブロック抽出
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
        "raw_tone_score": 0.0,
        "reasoning": "パース失敗によるデフォルト補完"
    }

def call_ollama(prompt: str, temperature: float = 0.0, num_ctx: int = 2048, model: str = MODEL_NAME) -> dict:
    payload = {
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_ctx": num_ctx,
            "num_predict": 200
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA_API_URL, data=data, headers={"Content-Type": "application/json"})
    
    t_start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            resp_bytes = res.read()
            body = json.loads(resp_bytes.decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}
        
    wall_time = time.time() - t_start
    
    load_duration_ms = body.get("load_duration", 0) / 1e6
    prompt_eval_count = body.get("prompt_eval_count", 0)
    prompt_eval_duration_ms = body.get("prompt_eval_duration", 0) / 1e6
    eval_count = body.get("eval_count", 0)
    eval_duration_ms = body.get("eval_duration", 0) / 1e6
    
    prompt_ms_per_tok = (prompt_eval_duration_ms / prompt_eval_count) if prompt_eval_count > 0 else 0
    eval_ms_per_tok = (eval_duration_ms / eval_count) if eval_count > 0 else 0
    
    parsed = clean_json_response(body.get("response", "{}"))
    
    return {
        "wall_time": wall_time,
        "load_duration_ms": load_duration_ms,
        "prompt_eval_count": prompt_eval_count,
        "prompt_eval_duration_ms": prompt_eval_duration_ms,
        "prompt_ms_per_tok": prompt_ms_per_tok,
        "eval_count": eval_count,
        "eval_duration_ms": eval_duration_ms,
        "eval_ms_per_tok": eval_ms_per_tok,
        "result": parsed
    }

def run_smoke_test():
    print("=" * 75, flush=True)
    print(f"🔬 厳密スモークテスト開始 (Model: {MODEL_NAME})", flush=True)
    print("=" * 75, flush=True)
    
    prompt_template = """以下の適時開示テキストを客観的に評価し、必ず以下のJSONフォーマットのみを出力してください。

【出力フォーマット】
{{
  "earnings_direction": "strong_positive" | "slight_positive" | "neutral" | "slight_negative" | "strong_negative",
  "guidance_revision": "large_upward" | "slight_upward" | "maintained" | "slight_downward" | "large_downward",
  "growth_quality": "high_quality_organic" | "steady" | "cost_push_one_off" | "deteriorating",
  "uncertainty_level": "low" | "moderate" | "high",
  "raw_tone_score": -1.0から+1.0までの実数値（アンカー: +1.0=大幅上方修正, 0.0=据置, -1.0=赤字転落）,
  "reasoning": "50文字以内の判定理由"
}}

開示テキスト:
{text}
"""
    
    # 0. Warm-up
    print("\n[Warm-up] 1回目の呼び出し（コールドスタート計測）...", flush=True)
    w_res = call_ollama(prompt_template.format(text=REALISTIC_DISCLOSURES[0]["text"]), temperature=0.0)
    if "error" in w_res:
        print(f"❌ Warm-up エラー: {w_res['error']}", flush=True)
        return
    print(f"  Warm-up完了: Wall={w_res['wall_time']:.2f}s (Load={w_res['load_duration_ms']:.1f}ms, PromptRate={w_res['prompt_ms_per_tok']:.2f}ms/t, GenRate={w_res['eval_ms_per_tok']:.2f}ms/t)", flush=True)
    
    # 1. 決定性テスト (temp=0, 5回)
    print("\n[Test 1] フィールド別 決定性テスト (temp=0, 5 runs, sample: 精密機械E)...", flush=True)
    target = REALISTIC_DISCLOSURES[4]
    p_det = prompt_template.format(text=target["text"])
    
    det_runs = []
    p_rates = []
    e_rates = []
    
    for i in range(5):
        res = call_ollama(p_det, temperature=0.0)
        if "error" in res:
            print(f"  Run {i+1}: ERROR {res['error']}", flush=True)
            continue
        p_rates.append(res["prompt_ms_per_tok"])
        e_rates.append(res["eval_ms_per_tok"])
        det_runs.append(res["result"])
        
        comp_s = calculate_composite_score(res["result"])
        print(f"  Run {i+1}: Wall={res['wall_time']:.2f}s | PromptTok={res['prompt_eval_count']} | GenTok={res['eval_count']} | Raw={res['result'].get('raw_tone_score')} | Comp={comp_s:+.3f}", flush=True)

    first_r = det_runs[0]
    total_runs = len(det_runs)
    match_score = sum(1 for r in det_runs if r.get("raw_tone_score") == first_r.get("raw_tone_score")) / total_runs
    match_dir = sum(1 for r in det_runs if r.get("earnings_direction") == first_r.get("earnings_direction")) / total_runs
    match_rev = sum(1 for r in det_runs if r.get("guidance_revision") == first_r.get("guidance_revision")) / total_runs
    match_qual = sum(1 for r in det_runs if r.get("growth_quality") == first_r.get("growth_quality")) / total_runs
    
    print("\n--- Test 1 フィールド別再現性 ---", flush=True)
    print(f"・raw_tone_score 一致率    : {match_score*100:.1f}%")
    print(f"・earnings_direction 一致率  : {match_dir*100:.1f}%")
    print(f"・guidance_revision 一致率   : {match_rev*100:.1f}%")
    print(f"・growth_quality 一致率      : {match_qual*100:.1f}%")
    
    # 2. 12銘柄 × 3試行による ICC 分散分解テスト
    print("\n[Test 2] 12銘柄 分散分解 & ICC測定 (temp=0, 各3試行)...", flush=True)
    item_trials_raw = []
    item_trials_comp = []
    
    print("\n| ID | 銘柄名 | Raw Scores | Comp Scores | Comp Mean | 判定理由サマリ |", flush=True)
    print("|---|---|---|---|---|---|", flush=True)
    
    for item in REALISTIC_DISCLOSURES:
        prompt_item = prompt_template.format(text=item["text"])
        raw_scores = []
        comp_scores = []
        last_res = {}
        for t in range(3):
            r = call_ollama(prompt_item, temperature=0.0)
            if "error" not in r:
                res_obj = r["result"]
                try:
                    raw_s = float(res_obj.get("raw_tone_score", 0.0))
                except (ValueError, TypeError):
                    raw_s = 0.0
                raw_scores.append(raw_s)
                comp_s = calculate_composite_score(res_obj)
                comp_scores.append(comp_s)
                last_res = res_obj
        item_trials_raw.append(raw_scores)
        item_trials_comp.append(comp_scores)
        
        raw_str = ", ".join(f"{s:+.2f}" for s in raw_scores)
        comp_str = ", ".join(f"{s:+.3f}" for s in comp_scores)
        comp_mean = statistics.mean(comp_scores) if comp_scores else 0.0
        reason_short = (last_res.get("reasoning", ""))[:22]
        print(f"| {item['id'][:2]} | {item['company']} | [{raw_str}] | [{comp_str}] | **{comp_mean:+.3f}** | {reason_short} |", flush=True)

    # ICC計算
    def calc_icc(trials_list):
        k = len(trials_list[0])
        n = len(trials_list)
        all_vals = [val for sublist in trials_list for val in sublist]
        grand_mean = statistics.mean(all_vals)
        
        ss_between = sum(k * (statistics.mean(group) - grand_mean) ** 2 for group in trials_list)
        ss_within = sum(sum((x - statistics.mean(group)) ** 2 for x in group) for group in trials_list)
        
        ms_between = ss_between / (n - 1)
        ms_within = ss_within / (n * (k - 1)) if (n * (k - 1)) > 0 else 1e-6
        
        var_w = ms_within
        var_b = max(0.0, (ms_between - ms_within) / k)
        
        icc = var_b / (var_b + var_w) if (var_b + var_w) > 0 else 0.0
        return icc, var_b, var_w

    icc_raw, var_b_raw, var_w_raw = calc_icc(item_trials_raw)
    icc_comp, var_b_comp, var_w_comp = calc_icc(item_trials_comp)
    
    mean_comps = [round(statistics.mean(g), 3) for g in item_trials_comp]
    unique_mean_comp_ratio = len(set(mean_comps)) / len(mean_comps)
    
    avg_p_rate = statistics.mean(p_rates) if p_rates else 1.0
    avg_e_rate = statistics.mean(e_rates) if e_rates else 30.0
    
    print("\n" + "=" * 75, flush=True)
    print("📊 厳密スモークテスト 最終サマリー:", flush=True)
    print("=" * 75, flush=True)
    print(f"【スループット & 本番推論時間外挿】")
    print(f"・プロンプト処理レート: {avg_p_rate:.2f} ms/token ({1000/avg_p_rate:.1f} tok/s)")
    print(f"・トークン生成レート  : {avg_e_rate:.2f} ms/token ({1000/avg_e_rate:.1f} tok/s)")
    est_per_inf = (1000 * avg_p_rate + 150 * avg_e_rate) / 1000
    print(f"  → 本番想定（開示テキスト 1,000 token ＋ 出力 150 token）: **{est_per_inf:.2f} 秒/件**")
    print(f"  → 4,000開示イベント（TOPIX500×2年分）の総推論時間: **約 {est_per_inf * 4000 / 3600:.2f} 時間**")
    
    print(f"\n【分散分解 & 信頼性指標 (ICC)】")
    print(f"・単一 Raw スコア ICC : **{icc_raw:.4f}** (σ_between^2={var_b_raw:.4f}, σ_within^2={var_w_raw:.4f})")
    print(f"・加重合成スコア   ICC : **{icc_comp:.4f}** (σ_between^2={var_b_comp:.4f}, σ_within^2={var_w_comp:.4f})")
    print(f"・12銘柄の合成スコア階調数: {len(set(mean_comps))} / 12 (タイ率: {(1 - unique_mean_comp_ratio)*100:.1f}%)")
    print("=" * 75, flush=True)

if __name__ == "__main__":
    run_smoke_test()
