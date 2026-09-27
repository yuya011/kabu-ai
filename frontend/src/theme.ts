/* Fluent 2 のテーマ。

   ブランド色は藍（あい）。Fluent 既定の Communication Blue と同じ明度の並びを保ったまま、
   色相だけを 272°（OKLCH）へ回して作った16段階である。明度を揃えてあるので、
   Fluent が各トークンに割り当てる段（文字は 80、ホバーは 70…）がそのまま使える。
   白地に対する 80 番のコントラストは 5.6:1。

   文字の大きさの設定は、Fluent の書体トークンを倍率で掛け直して効かせる。
   コンポーネントは全部トークンで寸法を決めているので、ここ1つで揃って動く。 */

import {
  createDarkTheme, createLightTheme,
  type BrandVariants, type Theme,
} from '@fluentui/react-components';

export const brand: BrandVariants = {
  10: '#0f1427', 20: '#181f3c', 30: '#20284f', 40: '#293464',
  50: '#323e7c', 60: '#3b4a95', 70: '#4252ac', 80: '#4c5ec8',
  90: '#6177ea', 100: '#7890ff', 110: '#879fff', 120: '#97acff',
  130: '#acbefe', 140: '#c3d0ff', 150: '#d7e0fe', 160: '#eef2fd',
};

/* Fluent の既定は Segoe UI で、日本語の指定が無い。Windows では Yu Gothic UI、
   Mac では Hiragino に落ちるよう、欧文の後ろに和文を並べる。 */
const FONT = [
  "'Segoe UI Variable Text'", "'Segoe UI'", "'Segoe UI Web (West European)'",
  "'Yu Gothic UI'", "'Meiryo UI'",
  '-apple-system', 'BlinkMacSystemFont', "'Hiragino Sans'", "'Hiragino Kaku Gothic ProN'",
  "'Noto Sans JP'", 'Roboto', "'Helvetica Neue'", 'sans-serif',
].join(', ');

const FONT_DISPLAY = [
  "'Segoe UI Variable Display'", "'Segoe UI'", "'Yu Gothic UI'",
  '-apple-system', 'BlinkMacSystemFont', "'Hiragino Sans'", "'Noto Sans JP'", 'sans-serif',
].join(', ');

const FONT_MONO = [
  "'Cascadia Mono'", 'Consolas', "'SF Mono'", 'ui-monospace', 'Menlo', "'Courier New'", 'monospace',
].join(', ');

const base = {
  light: createLightTheme(brand),
  dark: (() => {
    const t = createDarkTheme(brand);
    // Fluent の手引きどおり、暗い地では前景のブランド色を明るい段へ寄せる
    t.colorBrandForeground1 = brand[110];
    t.colorBrandForeground2 = brand[120];
    t.colorBrandForegroundLink = brand[110];
    t.colorBrandForegroundLinkHover = brand[120];
    t.colorBrandForegroundLinkPressed = brand[100];
    t.colorNeutralForeground2BrandHover = brand[110];
    t.colorNeutralForeground2BrandSelected = brand[110];
    t.colorCompoundBrandForeground1 = brand[110];
    t.colorCompoundBrandStroke = brand[110];
    return t;
  })(),
};

const cache = new Map<string, Theme>();

/** 配色と文字倍率からテーマを組む。同じ組は使い回す */
export function makeTheme(mode: 'light' | 'dark', scale = 1): Theme {
  const key = `${mode}:${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const t: Theme = { ...base[mode] };
  t.fontFamilyBase = FONT;
  t.fontFamilyMonospace = FONT_MONO;
  t.fontFamilyNumeric = FONT;
  if (scale !== 1) {
    for (const k of Object.keys(t) as (keyof Theme)[]) {
      if (!/^(fontSize|lineHeight)(Base|Hero)\d+$/.test(k)) continue;
      const px = parseFloat(String(t[k]));
      (t as any)[k] = `${Math.round(px * scale * 10) / 10}px`;
    }
  }
  cache.set(key, t);
  return t;
}

export const DISPLAY_FONT = FONT_DISPLAY;

/* ---------------- 業種の色 ----------------

   17業種を Fluent の共有色（shared colors）で塗り分ける。
   隣り合う業種コードが似た色にならないよう、色相環を飛び飛びに並べてある。
   DOM では CSS 変数、キャンバスでは実際の色の値が要るので、両方を返す。 */
const SECTOR_PALETTE = [
  'RoyalBlue', 'Teal', 'Pumpkin', 'Grape', 'Forest', 'Cranberry', 'Marigold',
  'Steel', 'Berry', 'Seafoam', 'Brown', 'Cornflower', 'Lavender', 'DarkOrange',
  'LightTeal', 'Magenta', 'Gold', 'Anchor',
] as const;

const tokenOf = (s17: string) => {
  const n = parseInt(s17, 10);
  const i = (Number.isFinite(n) ? n : s17.length) % SECTOR_PALETTE.length;
  return `colorPalette${SECTOR_PALETTE[i]}BorderActive` as keyof Theme;
};

/** DOM 用。FluentProvider が注入する CSS 変数を指す */
export const sectorVar = (s17: string) => `var(--${String(tokenOf(s17))})`;

/** キャンバス用。解決済みの色 */
export const sectorHex = (s17: string, theme: Theme) => String(theme[tokenOf(s17)]);
