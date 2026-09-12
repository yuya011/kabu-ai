/* Worker 内で使い回す小物。 */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });

// 証券コードは英数5桁。想定外の値でテーブルを汚さない
export const CODE = /^[0-9A-Z]{4,5}$/;

/* 開示は日本時間で「その日ぶん」を数える。Worker は UTC で動くので、
   9時間ずらした時刻を作ってから日付を切り出す。ずらした Date の
   getUTC* を読むのが、タイムゾーン依存の書式化を避ける一番確実な手。 */
export const jstNow = () => new Date(Date.now() + 9 * 3600_000);
export const jstYmd = (d = jstNow()) => d.toISOString().slice(0, 10);
export const jstStamp = (d = jstNow()) => d.toISOString().slice(0, 16).replace('T', ' ');

/** ymd から n 日前の ymd。掃除の閾値に使う */
export function ymdBefore(days, from = jstNow()) {
  return new Date(from.getTime() - days * 86400_000).toISOString().slice(0, 10);
}

/** 平日の場中〜引け後か。Cron は UTC 指定なので、実行側でも一応見る */
export function isMarketDay(d = jstNow()) {
  const w = d.getUTCDay(); // ずらした Date なので UTC 読みで JST の曜日になる
  return w >= 1 && w <= 5;
}

export const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export const bytesToB64url = (buf) => {
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
