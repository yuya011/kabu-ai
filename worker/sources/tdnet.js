/* TDnet（適時開示情報閲覧サービス）。既定では無効。
 *
 * ⚠️ 配信元は機械的な取得を全面的に拒否している。
 *
 *     https://www.release.tdnet.info/robots.txt
 *     User-agent: *
 *     Disallow: /
 *
 * scripts/tdnet_scraper.py を止めたのと同じ理由で、このアダプタも既定では動かない。
 * 決算短信まで速報したいなら、筋は JPX の TDnet API サービス（有料・再配信可）を
 * 契約して TDNET_API_BASE を差し替えることである。契約すれば、下の HTML 解析は
 * 使われず JSON 経路だけが動く。
 *
 * 有効化するには wrangler.toml の SOURCES に tdnet を足す。
 * 規約と robots.txt を承知したうえでの操作として設計してある。
 */

const BASE = 'https://www.release.tdnet.info/inbs';

export const id = 'tdnet';
export const label = 'TDnet（適時開示）';
export const attribution = {
  name: 'TDnet 適時開示情報閲覧サービス',
  url: 'https://www.release.tdnet.info/',
  license: '要確認（既定では取得しない）',
};

/* 決算・予想修正・配当は株価に直接効くので通知に回す */
const IMPORTANT_WORDS = ['決算短信', '業績予想', '配当予想', '修正', '株式分割', '自己株式'];
const isImportant = (t) => IMPORTANT_WORDS.some((w) => t.includes(w));

export function enabled(env) {
  return String(env.SOURCES || '').split(/[,\s]+/).includes(id);
}

export async function today(env, ymd) {
  if (env.TDNET_API_BASE) return fromApi(env, ymd);
  return fromHtml(env, ymd);
}

/* JPX の TDnet API サービスを契約したときの経路。
   応答の形は契約する商品で変わるので、よくある
   { items: [{ time, code, name, title, url }] } を想定して薄く受ける。 */
async function fromApi(env, ymd) {
  const url = `${env.TDNET_API_BASE.replace(/\/$/, '')}/disclosures?date=${ymd}`;
  const headers = { Accept: 'application/json' };
  if (env.TDNET_API_KEY) headers.Authorization = `Bearer ${env.TDNET_API_KEY}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`tdnet-api ${res.status}`);
  const body = await res.json();
  const rows = body.items ?? body.results ?? [];
  return rows.map((r) => normalize({
    ymd,
    time: r.time ?? r.disclosed_at ?? '',
    code: r.code ?? r.securities_code ?? '',
    name: r.name ?? r.company_name ?? '',
    title: r.title ?? '',
    url: r.url ?? r.document_url ?? '',
  })).filter(Boolean);
}

/* 一覧ページの表を読む。列は 時刻 / コード / 会社名 / 表題(リンク) の順で固定されている。 */
async function fromHtml(env, ymd) {
  const day = ymd.replace(/-/g, '');
  const res = await fetch(`${BASE}/I_list_001_${day}.html`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  // 非営業日はページ自体が無い。空で返して静かに終わる
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`tdnet ${res.status}`);
  const html = await res.text();

  const items = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 4) continue;
    const href = /href="([^"]+)"/i.exec(tds[3])?.[1] ?? '';
    const it = normalize({
      ymd,
      time: strip(tds[0]),
      code: strip(tds[1]),
      name: strip(tds[2]),
      title: strip(tds[3]),
      url: href ? new URL(href, `${BASE}/`).href : '',
    });
    if (it) items.push(it);
  }
  return items;
}

const strip = (s) => s
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .trim();

function normalize({ ymd, time, code, name, title, url }) {
  if (!code || !title) return null;
  // TDnet の表示は5桁（末尾0）。EDINET の secCode と揃うのでそのまま使う
  const c = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{4,5}$/.test(c)) return null;
  const hhmm = /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5).padStart(5, '0') : '00:00';
  return {
    id: `tdnet:${ymd}:${c}:${hhmm}:${title.slice(0, 40)}`,
    code: c,
    name: name || null,
    title,
    url,
    disclosed_at: `${ymd} ${hhmm}`,
    category: '適時開示',
    important: isImportant(title),
    source: id,
  };
}

export const onDemand = null;
