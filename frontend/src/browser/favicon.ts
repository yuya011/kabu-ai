/* 企業ファビコンの読み込み。

   ドメインは有報の「株式事務の概要」に載る電子公告の掲載先から取っており、
   上場3,919社のうち3,501社(91.6%)で判明している。
   取れない会社はキャンバス側で頭文字の円にフォールバックする。 */

const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

export function onFaviconLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function favicon(domain: string): HTMLImageElement | null {
  if (!domain) return null;
  const hit = cache.get(domain);
  if (hit) return hit;

  const img = new Image();
  // 各社のサイトから直接 /favicon.ico を引くと欠けやすいので、
  // リダイレクトとサイズ違いを吸収してくれる Google のファビコンサービスを通す。
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  img.onload = () => listeners.forEach((f) => f());
  img.onerror = () => { img.dataset.failed = '1'; };
  cache.set(domain, img);
  return img;
}

export function ready(img: HTMLImageElement | null): boolean {
  return !!img && !img.dataset.failed && img.complete && img.naturalWidth > 0;
}
