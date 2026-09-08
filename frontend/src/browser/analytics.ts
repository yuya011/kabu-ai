/* 閲覧の記録。
 *
 * 識別子を一切持たない。送るのは「どの銘柄が見られたか」だけで、
 * 利用者を区別する値（ID・Cookie・端末情報）を作らないし送らない。
 * 個人情報を扱わない構成にしておくと、同意取得の重い手続きなしに
 * 「どの企業がどれくらい調べられているか」という肝心の統計が貯まる。
 *
 * 送り先が設定されていなければ何もしない。開発中や、
 * 集計基盤を立てる前でもアプリはそのまま動く。
 */

import { getSettings } from '../settings';

const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;

/** 同じ会社を何度も開いても1セッション1回だけ数える */
const sent = new Set<string>();

export function recordView(code: string) {
  // 設定で切れる。識別子を持たないので個人情報の同意は要らないが、
  // 送られること自体を嫌う人はいるので、断れるようにしておく。
  if (!getSettings().analytics) return;
  if (!ENDPOINT || !code || sent.has(code)) return;
  sent.add(code);
  const body = JSON.stringify({ code });
  try {
    // ページ遷移や離脱に巻き込まれず、描画も止めない。
    //
    // Blob の型は text/plain にする。application/json は CORS の単純リクエストから
    // 外れるためプリフライトが要るが、sendBeacon はそれを処理できず、
    // true を返したまま黙って送信を捨てる。受け側は Content-Type を見ずに
    // 本文を JSON として読むので、text/plain のままで問題ない。
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${ENDPOINT}/view`, new Blob([body], { type: 'text/plain' }));
      return;
    }
    fetch(`${ENDPOINT}/view`, {
      method: 'POST', body, keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  } catch {
    // 統計は本題ではないので、失敗しても黙って捨てる
  }
}

export interface TrendItem { code: string; views: number }

/** よく見られている銘柄。集計基盤が無ければ空を返す。 */
export async function fetchTrending(limit = 12): Promise<TrendItem[]> {
  if (!ENDPOINT) return [];
  try {
    const res = await fetch(`${ENDPOINT}/trending?limit=${limit}`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}
