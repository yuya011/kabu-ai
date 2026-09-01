/* 閲覧統計の受け口。Cloudflare Workers + D1。
 *
 * 個人を識別する値は受け取らないし、保存もしない。
 * 記録するのは「銘柄コード・日付・時間帯・国」の4つで、
 * これだけでも「どの企業がいつ調べられたか」という時系列は取れる。
 * IP は集計にも保存にも使わない（CF が付ける国コードだけを見る）。
 *
 * 展開:
 *   npx wrangler d1 create kabu-stats
 *   npx wrangler d1 execute kabu-stats --file worker/schema.sql --remote
 *   npx wrangler deploy
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// 証券コードは英数5桁。想定外の値でテーブルを汚さない
const CODE = /^[0-9A-Z]{4,5}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/view' && request.method === 'POST') {
      // 送り側は sendBeacon を text/plain で送る。application/json だと
      // CORS のプリフライトが必要になり、ビーコンが黙って捨てられるため。
      // ここでは Content-Type を見ずに本文を JSON として読む。
      let code;
      try {
        ({ code } = await request.json());
      } catch {
        return json({ error: 'bad json' }, 400);
      }
      if (typeof code !== 'string' || !CODE.test(code)) {
        return json({ error: 'bad code' }, 400);
      }
      const now = new Date();
      const ymd = now.toISOString().slice(0, 10);
      const hour = now.getUTCHours();
      const country = request.headers.get('CF-IPCountry') || 'XX';

      await env.DB.prepare(
        `INSERT INTO views (code, ymd, hour, country, n) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(code, ymd, hour, country) DO UPDATE SET n = n + 1`
      ).bind(code, ymd, hour, country).run();

      return json({ ok: true });
    }

    if (url.pathname === '/trending' && request.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 12, 50);
      const days = Math.min(Number(url.searchParams.get('days')) || 7, 90);
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const { results } = await env.DB.prepare(
        `SELECT code, sum(n) AS views FROM views WHERE ymd >= ?
         GROUP BY code ORDER BY views DESC LIMIT ?`
      ).bind(since, limit).all();
      return json({ days, items: results ?? [] });
    }

    return json({ error: 'not found' }, 404);
  },
};
