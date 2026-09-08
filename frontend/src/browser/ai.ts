/* 外部の生成AIを端末から直接呼ぶ。

   鍵は利用者の端末の中にしかなく、通信も端末から各社へ直接出る。
   こちらに中継サーバが無いので、鍵がこちら側を通ることはない。

   3社とも生の fetch で呼んでいる。公式SDKを使わないのは、
   ・静的配信なので、鍵を入れない人にも3社ぶんの SDK が配られてしまう
   ・3社を1つの流し込み口（SSE）で同じに扱いたい
   の2つによる。叩くのは1社1エンドポイントだけで、SDK の利点が薄い。

   ブラウザから直接呼べるのは3社が CORS を許しているからで、
   どのAPIでもできるわけではない。X(Twitter) の API は許していないため、
   同じ作りでは呼べない。 */

export type Provider = 'gemini' | 'claude' | 'openai';

export interface ModelChoice {
  value: string;
  label: string;
  note: string;
}

interface Spec {
  label: string;
  /** 鍵の取得ページ */
  keyUrl: string;
  keyHint: string;
  keyPlaceholder: string;
  /** 鍵を入れない人向け。プロンプトを載せて各社のチャット画面を開く */
  chatUrl: (prompt: string) => string;
  chatLabel: string;
  models: ModelChoice[];
  defaultModel: string;
  /** 答えを流し込むリクエスト */
  request: (o: { key: string; model: string; prompt: string })
    => { url: string; headers: Record<string, string>; body: unknown };
  /** SSE の1件から本文を取り出す。返り値が空なら本文以外（思考・進捗など） */
  pick: (data: any) => string[];
  /* 鍵とモデル名を確かめる口。3社ともモデルの情報を返す GET を持っていて、
     これなら生成が走らない。1トークンだけ生成させる手は使えない ―
     いまのモデルは答える前に考えるので、出力の上限を絞っても
     考え終わるまで返らず、確認のつもりが数十秒待たされる。 */
  verify: (key: string, model: string)
    => { url: string; headers: Record<string, string> };
}

/** ブラウザから直接叩くことを明示するヘッダが要る。無いと CORS の事前確認で弾かれる */
const CLAUDE_HEADERS = (key: string) => ({
  'Content-Type': 'application/json',
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

/* モデルの一覧は各社の公表値。増減するので、設定画面では自由記述もできるようにしてある。
   出所: ai.google.dev/gemini-api/docs/models
        platform.claude.com/docs/ja/models/overview
        developers.openai.com/api/docs/models */
export const PROVIDERS: Record<Provider, Spec> = {
  gemini: {
    label: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Google AI Studio で無料で作れます。',
    keyPlaceholder: 'AIza...',
    chatUrl: (p) => `https://gemini.google.com/app?q=${encodeURIComponent(p)}`,
    chatLabel: 'Gemini を開く',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: '一番賢い Flash。ふだんはこれで足りる' },
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', note: '数をこなす用途向け' },
      { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: '一番速く、一番安い' },
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: '難しい問題向け。遅い' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '前の世代' },
    ],
    request: ({ key, model, prompt }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`
        + ':streamGenerateContent?alt=sse',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
    }),
    // 思考の断片(thought)が混ざることがある。本文ではないので落とす
    pick: (d) => (d?.candidates?.[0]?.content?.parts ?? [])
      .filter((p: any) => !p?.thought)
      .map((p: any) => p?.text).filter((t: any) => typeof t === 'string'),
    verify: (key, model) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
      headers: { 'x-goog-api-key': key },
    }),
  },

  claude: {
    label: 'Claude',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyHint: 'Claude Console（platform.claude.com）で作れます。無料枠はありません。',
    keyPlaceholder: 'sk-ant-...',
    chatUrl: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}`,
    chatLabel: 'Claude を開く',
    defaultModel: 'claude-opus-5',
    models: [
      { value: 'claude-opus-5', label: 'Claude Opus 5', note: 'まずはこれ。$5 / 100万トークン' },
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: '速さと賢さの釣り合いが良い。$2' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: '一番速い。$1' },
      { value: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: '一番賢いが遅く高い。$10' },
    ],
    request: ({ key, model, prompt }) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: CLAUDE_HEADERS(key),
      // 思考も max_tokens に含まれるので、切り詰めると本文が出ないまま終わる
      body: {
        model,
        max_tokens: 16000,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      },
    }),
    pick: (d) => {
      if (d?.type === 'error') throw new Error(d.error?.message || 'Claude API エラー');
      // 思考ブロック(thinking_delta)は本文ではないので取らない
      return d?.type === 'content_block_delta' && d.delta?.type === 'text_delta'
        ? [d.delta.text] : [];
    },
    verify: (key, model) => ({
      url: `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`,
      headers: CLAUDE_HEADERS(key),
    }),
  },

  openai: {
    label: 'ChatGPT',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'OpenAI Platform で作れます。無料枠はありません。',
    keyPlaceholder: 'sk-...',
    chatUrl: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}`,
    chatLabel: 'ChatGPT を開く',
    defaultModel: 'gpt-6-astra',
    models: [
      { value: 'gpt-6-astra', label: 'GPT-6 Astra', note: '一番賢い。難しい問いはこれ' },
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: '専門的な作業向け' },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: '賢さと安さの釣り合いが良い' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: '一番安い。数をこなす用途向け' },
    ],
    request: ({ key, model, prompt }) => ({
      url: 'https://api.openai.com/v1/responses',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: { model, input: prompt, stream: true },
    }),
    pick: (d) => {
      if (d?.type === 'error' || d?.type === 'response.failed') {
        throw new Error(d.error?.message || d.response?.error?.message || 'OpenAI API エラー');
      }
      return d?.type === 'response.output_text.delta' && typeof d.delta === 'string'
        ? [d.delta] : [];
    },
    /* OpenAI は /v1/responses でキーを拒むときだけ CORS ヘッダを付けない。
       そちらで確かめると、鍵が違っても中身を読めず「届きませんでした」としか
       言えなくなる。モデルの口は拒否時もヘッダが付くので、そちらで確かめる。 */
    verify: (key, model) => ({
      url: `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      headers: { Authorization: `Bearer ${key}` },
    }),
  },
};

export const PROVIDER_ORDER: Provider[] = ['gemini', 'claude', 'openai'];

/* ---------------- 呼び出し ---------------- */

function friendlyError(provider: Provider, status: number, message: string): Error {
  const name = PROVIDERS[provider].label;
  if (status === 401 || (status === 400 && /API key/i.test(message))) {
    return new Error(`${name} のAPIキーが正しくないようです。設定画面で入れ直してください。`);
  }
  if (status === 403) {
    return new Error(`このキーでは ${name} の API を使えません。作り直すか、権限を確認してください。`);
  }
  if (status === 404 || /model/i.test(message) && status === 400) {
    return new Error(`モデル名が違うようです（${message}）。設定画面で選び直してください。`);
  }
  if (status === 429) {
    return new Error('利用の上限に達しました。しばらく待つか、軽いモデルに変えてください。');
  }
  return new Error(message || `${name} API エラー (${status})`);
}

/** fetch が例外で落ちたとき。ブラウザからは理由が読めないので、心当たりを並べる。 */
function unreachable(provider: Provider): Error {
  if (provider === 'openai') {
    return new Error('OpenAI の応答をブラウザから読めませんでした。'
      + 'キーが違うときは OpenAI が CORS ヘッダを返さないため、この形になります。'
      + '設定画面でキーを確かめてください。');
  }
  return new Error(`${PROVIDERS[provider].label} の API に届きませんでした。`
    + 'ネットワークの状態を確かめてください。');
}

/** 応答が返り始めるまでの制限時間。答えの本文はここに含めない */
const HEAD_TIMEOUT_MS = 30_000;

/* 時間切れと、利用者による中断の両方で止まる signal を作る。

   時間切れの見張りは、応答が返り始めた時点で解く。解かないと、
   長い答えを流している最中に打ち切ってしまう。中断の紐はそのまま残す。 */
function guard(outer?: AbortSignal) {
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new DOMException('応答がありませんでした', 'TimeoutError')),
    HEAD_TIMEOUT_MS);
  if (outer) {
    if (outer.aborted) ac.abort(outer.reason);
    else outer.addEventListener('abort', () => ac.abort(outer.reason), { once: true });
  }
  return { signal: ac.signal, started: () => clearTimeout(timer) };
}

/** 通信そのものの失敗と、応答の中身の失敗を同じ言い方に揃える。 */
async function send(provider: Provider, url: string, init: RequestInit): Promise<Response> {
  const g = guard(init.signal ?? undefined);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: g.signal });
  } catch (e) {
    g.started();
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error(`${PROVIDERS[provider].label} から ${HEAD_TIMEOUT_MS / 1000} 秒待っても`
        + '応答がありませんでした。時間をおいて試してください。');
    }
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw unreachable(provider);
  }
  g.started();
  if (!res.ok) await fail(provider, res);
  return res;
}

async function fail(provider: Provider, res: Response): Promise<never> {
  let message = '';
  try {
    const j = await res.json();
    message = j?.error?.message ?? '';
  } catch {
    message = await res.text().catch(() => '');
  }
  throw friendlyError(provider, res.status, message);
}

export interface AskOptions {
  provider: Provider;
  key: string;
  model: string;
  signal?: AbortSignal;
  /** 届いた端から呼ばれる。全文が揃うのを待たずに読み始められる */
  onText: (chunk: string) => void;
}

/** 逐次生成。3社とも SSE なので、取り出し方だけを差し替えて同じ経路で流す。 */
export async function ask(prompt: string, o: AskOptions): Promise<void> {
  const spec = PROVIDERS[o.provider];
  const req = spec.request({ key: o.key, model: o.model, prompt });
  const res = await send(o.provider, req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: o.signal,
  });
  if (!res.body) throw unreachable(o.provider);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 行の途中で切れることがあるので、最後の1本は次の読み取りへ回す
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;   // event: 行は本文を持たない
      const body = line.slice(5).trim();
      if (!body || body === '[DONE]') continue;
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        continue; // 途中で切れた塊。次の読み取りで揃う
      }
      for (const text of spec.pick(data)) o.onText(text);
    }
  }
}

/** 鍵とモデル名が通るかを確かめる。生成は走らないので、待たされず費用も出ない。 */
export async function verifyKey(provider: Provider, key: string, model: string): Promise<void> {
  const spec = PROVIDERS[provider];
  const v = spec.verify(key, model);
  await send(provider, v.url, { method: 'GET', headers: v.headers });
}

/** 鍵を入れていない人向け。各社のチャット画面をプロンプトつきで開く。 */
export async function openChat(provider: Provider, prompt: string): Promise<'copied' | 'opened'> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    copied = false; // 権限がない・安全なコンテキストでない場合
  }
  // URL に載せられる長さには実質的な上限がある。全文はクリップボードにあるので、
  // 長い場合は切って渡し、貼り直せるようにしておく。
  const q = prompt.length > 3500
    ? `${prompt.slice(0, 3500)}\n（以下省略。全文は貼り付けてください）` : prompt;
  window.open(PROVIDERS[provider].chatUrl(q), '_blank', 'noopener');
  return copied ? 'copied' : 'opened';
}
