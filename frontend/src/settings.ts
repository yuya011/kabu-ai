/* 端末に残す設定。

   このアプリは静的ファイルしか配信していないので、設定を預ける先がない。
   全部この端末の localStorage に置く。裏を返すと、設定は端末ごとに独立していて、
   こちらからは何も見えない。

   API キーもここに入る。送り先は設定した本人が選んだ提供元だけで、
   閲覧統計にも載せないし、こちらのサーバにも渡らない（そもそも持っていない）。 */

import { useSyncExternalStore } from 'react';
import { PROVIDERS, PROVIDER_ORDER, type Provider } from './browser/ai';

export type Theme = 'auto' | 'light' | 'dark';
export type Engine = 'google' | 'bing' | 'duckduckgo';
/** 外部AIの使い方。open=各社のチャット画面を開く / inapp=APIキーでこの画面に答えを出す */
export type AiMode = 'open' | 'inapp';

export interface Settings {
  theme: Theme;
  /** 文字の大きさの倍率。CSS の --fs として全画面に効かせる */
  fontScale: number;
  reduceMotion: boolean;
  engine: Engine;
  /** どの銘柄が何回開かれたかの記録を送るか */
  analytics: boolean;
  aiMode: AiMode;
  provider: Provider;
  /** 提供元ごとに別のモデルを覚えておく。切り替えるたびに選び直さずに済む */
  models: Record<Provider, string>;
}

export const DEFAULTS: Settings = {
  theme: 'auto',
  fontScale: 1,
  reduceMotion: false,
  engine: 'google',
  analytics: true,
  aiMode: 'open',
  provider: 'gemini',
  models: {
    gemini: PROVIDERS.gemini.defaultModel,
    claude: PROVIDERS.claude.defaultModel,
    openai: PROVIDERS.openai.defaultModel,
  },
};

export const FONT_SCALES: { value: number; label: string }[] = [
  { value: 0.92, label: '小' },
  { value: 1, label: '標準' },
  { value: 1.14, label: '大' },
  { value: 1.3, label: '特大' },
];

export const ENGINES: { value: Engine; label: string }[] = [
  { value: 'google', label: 'Google' },
  { value: 'bing', label: 'Bing' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
];

const KEY = 'kabu-ai.settings';
/** API キーは設定本体と分けて置く。設定を書き出す機能を足したときに巻き込まないため */
const secretKey = (p: Provider) => `kabu-ai.key.${p}`;

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const j = JSON.parse(raw);
    // 知らない項目は捨て、欠けている項目は既定で埋める。版が変わっても壊れない
    return {
      theme: (['auto', 'light', 'dark'] as const).includes(j.theme) ? j.theme : DEFAULTS.theme,
      fontScale: typeof j.fontScale === 'number' && j.fontScale >= 0.8 && j.fontScale <= 1.6
        ? j.fontScale : DEFAULTS.fontScale,
      reduceMotion: !!j.reduceMotion,
      engine: (['google', 'bing', 'duckduckgo'] as const).includes(j.engine)
        ? j.engine : DEFAULTS.engine,
      analytics: j.analytics !== false,
      aiMode: j.aiMode === 'inapp' ? 'inapp' : 'open',
      provider: PROVIDER_ORDER.includes(j.provider) ? j.provider : DEFAULTS.provider,
      models: Object.fromEntries(PROVIDER_ORDER.map((p) => [
        p,
        typeof j.models?.[p] === 'string' && j.models[p]
          ? j.models[p] : PROVIDERS[p].defaultModel,
      ])) as Record<Provider, string>,
    };
  } catch {
    return DEFAULTS; // プライベートウィンドウなどで読めないことがある
  }
}

let current: Settings = typeof localStorage === 'undefined' ? DEFAULTS : read();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 保存できなくても、この画面が開いている間は効く */
  }
  applySettings();
  emit();
}

export function resetSettings() {
  current = DEFAULTS;
  try {
    localStorage.removeItem(KEY);
  } catch { /* 消せなくても既定値には戻る */ }
  applySettings();
  emit();
}

/** 設定を購読する。画面の再描画はこれ1本で足りる */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSettings,
    () => DEFAULTS,
  );
}

export function resolveTheme(theme: Theme = current.theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 設定を DOM に反映する。配色と文字の大きさは CSS 変数で全画面に効く。 */
export function applySettings(s: Settings = current) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = resolveTheme(s.theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty('--fs', String(s.fontScale));
  if (s.reduceMotion) root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
  // iOS はここを見て、ホーム画面から起動したときの上下の帯を塗る。
  // Fluent の colorNeutralBackground3（ヘッダーの地）と揃える
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#141414' : '#f5f5f5');
}

/* OS 側の配色が変わったら、自動のときだけ追随する */
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current.theme === 'auto') { applySettings(); emit(); }
  });
}

/* ---------------- API キー ---------------- */

export function getApiKey(provider: Provider): string {
  try {
    return localStorage.getItem(secretKey(provider)) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(provider: Provider, key: string) {
  try {
    if (key) localStorage.setItem(secretKey(provider), key);
    else localStorage.removeItem(secretKey(provider));
  } catch { /* 保存できない端末では、その場限りになる */ }
  emit();
}

/** いま選んでいる提供元の鍵とモデル */
export function currentAi(s: Settings = current) {
  return { provider: s.provider, key: getApiKey(s.provider), model: s.models[s.provider] };
}

/** 画面に出すときの伏せ字。末尾だけ残して、貼り間違いに気づけるようにする */
export function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(10)}${key.slice(-4)}`;
}

/** インラインの px 指定にも文字の大きさを効かせる */
export const fs = (px: number) => `calc(${px}px * var(--fs, 1))`;
