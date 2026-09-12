/* 閲覧統計と、開示の速報。Cloudflare Workers + D1。
 *
 * 個人を識別する値は受け取らないし、保存もしない。
 * 閲覧の記録は「銘柄コード・日付・時間帯・国」の4つだけで、
 * これだけでも「どの企業がいつ調べられたか」という時系列は取れる。
 * IP は集計にも保存にも使わない（CF が付ける国コードだけを見る）。
 *
 * 対話型AI 向けの口（/mcp）も同じ Worker に同居させている。中身は
 * 手元で動かす版（src/mcp_server.py）と同じ5つの道具で、実装は mcp.js。
 *
 * 速報のほうは Cron が10分おきに当日の開示を集めて D1 に積み、
 * 画面はそこを引く。取得元は sources/ にアダプタとして分けてあり、
 * 既定で動くのは再配信の認められている EDINET だけである（sources/index.js 参照）。
 *
 * 展開:
 *   npx wrangler d1 create kabu-stats
 *   npx wrangler d1 execute kabu-stats --file worker/schema.sql --remote
 *   npx wrangler secret put EDINET_KEY       # EDINET API のキー
 *   node worker/vapid-keygen.mjs             # 通知を使うなら
 *   npx wrangler secret put VAPID_PRIVATE
 *   npx wrangler deploy
 */

import { CORS, json, CODE, jstYmd, jstStamp, ymdBefore } from './util.js';
import { collectors, responders, attributions } from './sources/index.js';
import * as push from './push.js';
import { handleMcp } from './mcp.js';

/* 外に出す形。D1 の列名とアダプタの返す形をここで一致させておく */
const shape = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name ?? null,
  title: r.title,
  url: r.url,
  disclosed_at: r.disclosed_at,
  category: r.category ?? null,
  important: !!r.important,
  source: r.source,
});

/* Cache API に乗せて返す。同じ銘柄を続けて開いても外には出ない。
 *
 * ただし **workers.dev のサブドメインでは Cache API が働かない**（put が素通りし、
 * match は常に外れる）。独自ドメインに移すまでは、効いているのは同時に付ける
 * Cache-Control のほうで、こちらは各ブラウザの中でだけ止まる。
 *
 * 既定の構成では外部に出るのは Cron の巡回だけ（画面の要求は D1 を読むだけ）なので、
 * エッジで止まらなくても外部への負荷は増えない。効くのはオンデマンドの
 * アダプタを有効にしたときで、そのときは独自ドメインに移してから入れること。
 */
async function cached(request, ttl, build) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch { /* 使えない構成では素通りする */ }

  const data = await build();
  const res = json(data, 200, { 'Cache-Control': `public, max-age=${ttl}` });
  try {
    await cache.put(key, res.clone());
  } catch { /* 同上。キャッシュできなくても応答は返す */ }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* ---- 対話型AI の口（MCP / Streamable HTTP） ----
       CORS の見出しが他の口と違う（Mcp-Session-Id 等を通す必要がある）ので、
       共通の OPTIONS より先に捌く。認証は求めない。返すのは公開データだけで、
       書き込む口も無いため、誰が叩いても失うものが無い。
       そのぶん /.well-known/oauth-* は 404 のままにしてあり、
       クライアントは「認証不要のサーバー」と読む。 */
    if (url.pathname === '/mcp') {
      return handleMcp(request, env, (code) => todayFor(env, code));
    }

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

    /* ---- 銘柄ひとつぶんの最新（Phase 1） ----
       積んである速報を引き、その場で引ける情報源があれば足す。
       15分の Edge キャッシュを噛ませて、同じ銘柄で外に出続けないようにする。 */
    if (url.pathname === '/news' && request.method === 'GET') {
      const code = (url.searchParams.get('code') || '').toUpperCase();
      if (!CODE.test(code)) return json({ error: 'bad code' }, 400);
      const query = (url.searchParams.get('query') || '').slice(0, 80);

      return cached(request, 900, async () => {
        const status = {};
        const items = [];

        try {
          const { results } = await env.DB.prepare(
            `SELECT * FROM today_disclosures WHERE code = ?
             ORDER BY disclosed_at DESC LIMIT 20`
          ).bind(code).all();
          items.push(...(results ?? []).map(shape));
          status.stored = `ok:${results?.length ?? 0}`;
        } catch (e) {
          status.stored = `err:${e.message}`;
        }

        // その場で引ける情報源（既定では無い）。1つ転んでも他は返す
        await Promise.all(responders(env).map(async (src) => {
          try {
            const got = await src.onDemand(env, { code, query });
            items.push(...got.map(shape));
            status[src.id] = `ok:${got.length}`;
          } catch (e) {
            status[src.id] = `err:${e.message}`;
          }
        }));

        return {
          code,
          items: dedupe(items),
          fetched_at: jstStamp(),
          crawled_at: await meta(env, 'last_run'),
          sources: status,
        };
      });
    }

    /* ---- 当日の開示速報（Phase 2） ---- */
    if (url.pathname === '/disclosures/today' && request.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 200);
      const onlyImportant = url.searchParams.get('important') === '1';

      return cached(request, 60, async () => {
        // 休場日や寄り前は当日ぶんが空になる。数日で掃いているので、
        // 残っている中の最新日がそのまま「直近の営業日」になる
        const today = jstYmd();
        const latest = await env.DB.prepare(
          'SELECT max(ymd) AS ymd FROM today_disclosures'
        ).first();
        const ymd = latest?.ymd ?? today;

        const { results } = await env.DB.prepare(
          `SELECT * FROM today_disclosures
           WHERE ymd = ? ${onlyImportant ? 'AND important = 1' : ''}
           ORDER BY disclosed_at DESC, rowid DESC LIMIT ?`
        ).bind(ymd, limit).all();

        return {
          ymd,
          today: ymd === today,
          items: (results ?? []).map(shape),
          crawled_at: await meta(env, 'last_run'),
          sources: attributions(env),
        };
      });
    }

    /* ---- 情報源の状態。取り込みが効いているかを画面から確かめられる ---- */
    if (url.pathname === '/sources' && request.method === 'GET') {
      return json({
        active: attributions(env),
        push: push.configured(env),
        last_run: await meta(env, 'last_run'),
        last_status: JSON.parse((await meta(env, 'last_status')) || '{}'),
      });
    }

    /* ---- 通知（Phase 4） ---- */
    if (url.pathname === '/push/key' && request.method === 'GET') {
      if (!push.configured(env)) return json({ error: 'push disabled' }, 503);
      return json({ key: env.VAPID_PUBLIC });
    }

    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      if (!push.configured(env)) return json({ error: 'push disabled' }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

      const sub = body?.subscription;
      const endpoint = sub?.endpoint;
      const p256dh = sub?.keys?.p256dh;
      const auth = sub?.keys?.auth;
      if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')
          || typeof p256dh !== 'string' || typeof auth !== 'string') {
        return json({ error: 'bad subscription' }, 400);
      }
      const codes = [...new Set((Array.isArray(body.codes) ? body.codes : [])
        .filter((c) => typeof c === 'string' && CODE.test(c)))].slice(0, 100);

      const now = jstStamp();
      const stmts = [
        env.DB.prepare(
          `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
        ).bind(endpoint, p256dh, auth, now),
        // 監視銘柄は毎回入れ替える。端末側の一覧をそのまま正とするほうが、
        // 追加と削除で口を分けるより取り違えが起きない
        env.DB.prepare('DELETE FROM push_watch WHERE endpoint = ?').bind(endpoint),
        ...codes.map((c) => env.DB.prepare(
          'INSERT OR IGNORE INTO push_watch (endpoint, code) VALUES (?, ?)'
        ).bind(endpoint, c)),
      ];
      await env.DB.batch(stmts);
      return json({ ok: true, codes: codes.length });
    }

    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const endpoint = body?.endpoint;
      if (typeof endpoint !== 'string') return json({ error: 'bad endpoint' }, 400);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM push_watch WHERE endpoint = ?').bind(endpoint),
        env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint),
      ]);
      return json({ ok: true });
    }

    /* 手で巡回を蹴る口。Cron を待たずに動作を確かめられる。
       ?date=YYYY-MM-DD を付ければ過去日も取れる（初回の埋め戻しと不具合の切り分け用）。
       鍵を知っている人だけが叩ける（COLLECT_TOKEN を設定したときのみ有効）。 */
    if (url.pathname === '/collect' && request.method === 'POST') {
      if (!env.COLLECT_TOKEN
          || request.headers.get('Authorization') !== `Bearer ${env.COLLECT_TOKEN}`) {
        return json({ error: 'forbidden' }, 403);
      }
      const date = url.searchParams.get('date');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'bad date' }, 400);
      return json(await collect(env, date || undefined));
    }

    return json({ error: 'not found' }, 404);
  },

  /* 平日の場中〜引け後、10分おきに走る（wrangler.toml の crons）。
     応答を待たせる相手がいないので、失敗しても次の回で取り戻せばよい。 */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collect(env).catch((e) => console.error('collect', e)));
  },
};

/** 積んである当日の速報を1銘柄ぶん。MCP からも画面からも同じものを見る。
    落ちても他の結果は返したいので、例外にせず空で返す。 */
async function todayFor(env, code) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM today_disclosures WHERE code = ?
       ORDER BY disclosed_at DESC LIMIT 20`
    ).bind(code).all();
    return (results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      disclosed_at: r.disclosed_at,
      category: r.category ?? null,
      source: r.source,
    }));
  } catch {
    return [];
  }
}

/* ---------------- 収集 ---------------- */

async function meta(env, k) {
  try {
    const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first();
    return row?.v ?? null;
  } catch {
    return null;
  }
}

/** 同じ書類が複数の情報源から来ることがある。新しい順に均す */
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items.sort((a, b) => (b.disclosed_at || '').localeCompare(a.disclosed_at || ''))) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

async function collect(env, day) {
  const ymd = day || jstYmd();
  const status = {};
  const found = [];

  for (const src of collectors(env)) {
    try {
      const items = await src.today(env, ymd);
      found.push(...items.filter((it) => CODE.test(it.code) && it.url));
      status[src.id] = `ok:${items.length}`;
    } catch (e) {
      // 1つの情報源が落ちても他は積む。次の回で取り戻せる
      status[src.id] = `err:${e.message}`;
    }
  }

  // 既に入っているものは触らない。差分だけを通知に回すため、ここで先に照合する
  const { results } = await env.DB.prepare(
    'SELECT id FROM today_disclosures WHERE ymd >= ?'
  ).bind(day || ymdBefore(1)).all();
  const known = new Set((results ?? []).map((r) => r.id));

  const fresh = [];
  const seen = new Set();
  for (const it of found) {
    if (known.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    fresh.push(it);
  }

  const now = jstStamp();
  for (let i = 0; i < fresh.length; i += 50) {
    await env.DB.batch(fresh.slice(i, i + 50).map((it) => env.DB.prepare(
      `INSERT OR IGNORE INTO today_disclosures
       (id, code, name, title, url, disclosed_at, ymd, category, important, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      it.id, it.code, it.name ?? null, it.title, it.url,
      it.disclosed_at || `${ymd} 00:00`, (it.disclosed_at || ymd).slice(0, 10),
      it.category ?? null, it.important ? 1 : 0, it.source, now,
    )));
  }

  // 速報の置き場なので短く回す。過去分は静的データの担当。
  // 日付を指定して埋め戻すときは掃かない（入れた端から消えるため）
  const swept = day ? { meta: { changes: 0 } } : await env.DB.prepare(
    'DELETE FROM today_disclosures WHERE ymd < ?'
  ).bind(ymdBefore(3)).run();

  // 埋め戻しでは鳴らさない。過去の開示で通知が飛ぶのは事故でしかない
  const notified = day ? 0 : await notify(env, fresh);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .bind('last_run', now),
    env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .bind('last_status', JSON.stringify({ ...status, new: fresh.length, notified })),
  ]);

  return {
    ymd, at: now, sources: status,
    found: found.length, new: fresh.length,
    swept: swept.meta?.changes ?? 0, notified,
  };
}

/* ---------------- 通知 ---------------- */

/** 監視している銘柄に重要な開示が出たら鳴らす。1回の巡回で1端末3件まで。 */
async function notify(env, fresh) {
  if (!push.configured(env)) return 0;
  const targets = fresh.filter((it) => it.important);
  if (!targets.length) return 0;

  const codes = [...new Set(targets.map((it) => it.code))];
  const marks = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT w.code, s.endpoint, s.p256dh, s.auth
     FROM push_watch w JOIN push_subs s ON s.endpoint = w.endpoint
     WHERE w.code IN (${marks})`
  ).bind(...codes).all();
  if (!results?.length) return 0;

  const byEndpoint = new Map();
  for (const r of results) {
    if (!byEndpoint.has(r.endpoint)) {
      byEndpoint.set(r.endpoint, { sub: r, codes: new Set() });
    }
    byEndpoint.get(r.endpoint).codes.add(r.code);
  }

  const dead = [];
  let sent = 0;
  await Promise.all([...byEndpoint.values()].map(async ({ sub, codes: watched }) => {
    const mine = targets.filter((it) => watched.has(it.code)).slice(0, 3);
    for (const it of mine) {
      try {
        const res = await push.send(env, sub, {
          title: `${it.name || it.code} ${it.category || '開示'}`,
          body: it.title,
          url: it.url,
          code: it.code,
        });
        if (res.gone) { dead.push(sub.endpoint); break; }
        if (res.ok) sent += 1;
      } catch (e) {
        console.error('push', e.message);
      }
    }
  }));

  if (dead.length) {
    await env.DB.batch(dead.flatMap((e) => [
      env.DB.prepare('DELETE FROM push_watch WHERE endpoint = ?').bind(e),
      env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e),
    ]));
  }
  return sent;
}
