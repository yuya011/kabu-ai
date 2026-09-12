/* Google ニュース RSS。既定では無効。
 *
 * ⚠️ Google の利用規約は robot による取得・再表示・商用利用を禁じており、
 * robots.txt も /rss/ を Disallow にしている。
 *
 *     https://news.google.com/robots.txt
 *     User-agent: *
 *     Disallow: /
 *
 * scripts/news_ingest.py は手元での私的利用に留めており、配信物には含めていない。
 * このアダプタを有効にすると、公開サーバーが取得して全利用者に再配信する形になり、
 * その線を越える。既定で切ってあるのはそのためである。
 *
 * 有効化するには wrangler.toml の SOURCES に gnews を足す。
 */

const FEED = 'https://news.google.com/rss/search';

export const id = 'gnews';
export const label = 'Google ニュース';
export const attribution = {
  name: 'Google ニュース',
  url: 'https://news.google.com/',
  license: '要確認（既定では取得しない）',
};

export function enabled(env) {
  return String(env.SOURCES || '').split(/[,\s]+/).includes(id);
}

/* 日付で全社ぶんを引く口が無いので、当日の一括収集はしない。
   このアダプタが働くのは銘柄を開いたときのオンデマンドだけ。 */
export const today = null;

export async function onDemand(env, { code, query }) {
  if (!query) return [];
  const url = `${FEED}?${new URLSearchParams({
    q: `"${query}"`, hl: 'ja', gl: 'JP', ceid: 'JP:ja',
  })}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`gnews ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = clean(tag(block, 'title'));
    const link = tag(block, 'link');
    if (!title || !link) continue;
    const pub = tag(block, 'pubDate');
    items.push({
      id: `gnews:${code}:${link}`,
      code,
      name: null,
      title,
      url: link,
      disclosed_at: toStamp(pub),
      category: source(block) || 'ニュース',
      important: false,
      source: id,
    });
    if (items.length >= 12) break;
  }
  return items;
}

const tag = (s, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(s);
  return m ? unescapeXml(m[1].trim()) : '';
};

const source = (s) => {
  const m = /<source[^>]*>([\s\S]*?)<\/source>/.exec(s);
  return m ? unescapeXml(m[1].trim()) : null;
};

const unescapeXml = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

/** Google ニュースは「見出し - 媒体名」の形にするので媒体名を落とす */
const clean = (t) => t.replace(/\s+-\s+[^-]+$/, '').trim();

/** RFC822 の日付を 'YYYY-MM-DD HH:MM'（日本時間）に */
function toStamp(s) {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}
