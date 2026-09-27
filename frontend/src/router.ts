/* 画面の行き先を URL に持たせる。

   以前は画面の状態を React の中だけで持っていたので、ブラウザの「戻る」で
   アプリごと抜けてしまい、見ている会社を人に渡すこともできなかった。
   GitHub Pages はサブパス配信で、未知のパスを index.html に回せない。
   そのためハッシュで持つ（#/company/72030 のように）。 */

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'explore'; code: string | null }
  | { name: 'sectors'; s17: string | null; s33: string | null; mkt: string | null }
  | { name: 'company'; code: string }
  | { name: 'today' }
  | { name: 'connect' }
  | { name: 'settings' };

function parse(hash: string): Route {
  const [path, qs] = hash.replace(/^#/, '').split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(qs ?? '');
  switch (seg[0]) {
    case 'explore': return { name: 'explore', code: seg[1] ?? null };
    case 'sectors': return { name: 'sectors', s17: seg[1] ?? null, s33: q.get('sub'), mkt: q.get('mkt') };
    case 'company': return seg[1] ? { name: 'company', code: seg[1] } : { name: 'sectors', s17: null, s33: null, mkt: null };
    case 'today': return { name: 'today' };
    case 'connect': return { name: 'connect' };
    case 'settings': return { name: 'settings' };
    default: return { name: 'home' };
  }
}

/** 行き先の URL。<a href> にもそのまま使える */
export const href = {
  home: () => '#/',
  explore: (code?: string | null) => (code ? `#/explore/${code}` : '#/explore'),
  /** mkt は市場の絞り込み（prime / standard / growth / other） */
  sectors: (s17?: string | null, s33?: string | null, mkt?: string | null) => {
    const q = new URLSearchParams();
    if (s17 && s33) q.set('sub', s33);
    if (mkt) q.set('mkt', mkt);
    const qs = q.toString();
    return `#/sectors${s17 ? `/${s17}` : ''}${qs ? `?${qs}` : ''}`;
  },
  company: (code: string) => `#/company/${code}`,
  today: () => '#/today',
  connect: () => '#/connect',
  settings: () => '#/settings',
};

let current = parse(typeof location === 'undefined' ? '' : location.hash);
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(location.hash);
    listeners.forEach((f) => f());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => current,
    () => current,
  );
}

/** 移動する。replace なら履歴を積まない（絞り込みの切り替えなど） */
export function go(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) {
    history.replaceState(null, '', to);
    current = parse(to);
    listeners.forEach((f) => f());
  } else {
    location.hash = to.replace(/^#/, '');
  }
}
