/* 会社名で外部検索を開く。

   有価証券報告書の相手方には非上場が多い。取引先の 13%、大株主のほとんどは
   有報を出していないので、こちらが持っているのは名前だけになる。
   詳細を作れない以上、名前をそのまま渡して外で調べてもらうのが確実で、
   こちらで推測を混ぜずに済む。 */

import { getSettings, type Engine } from '../settings';

const URLS: Record<Engine, string> = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

/** 有報の原文に残る注記と全角空白を落とす。「株式会社　トプコン (注３)」の形で入る */
export function cleanName(raw: string): string {
  return raw
    .replace(/[（(]\s*注[^)）]*[)）]/g, '')
    .replace(/[（(][\d\s.,、・※*＊]+[)）]/g, '')
    .replace(/[　 \s]+/g, ' ')
    .trim();
}

export function searchUrl(query: string, engine: Engine = getSettings().engine): string {
  return URLS[engine] + encodeURIComponent(query);
}

/** 社名で検索する。引用符で囲むと、社名が普通名詞の会社でも埋もれない。 */
export function openSearch(name: string, extra?: string) {
  const clean = cleanName(name);
  if (!clean) return;
  const q = `"${clean}"${extra ? ` ${extra}` : ''}`;
  window.open(searchUrl(q), '_blank', 'noopener');
}
