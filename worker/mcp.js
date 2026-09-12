/* MCP サーバー（リモート）。Streamable HTTP を素で実装する。
 *
 * 手元で動かす版（src/mcp_server.py）と同じ5つの道具を、同じデータから返す。
 * 違うのは置き場所だけで、利用者に uv も Python も求めない。Claude の
 * 「カスタムコネクタ」に URL を貼れば繋がる。
 *
 *   https://kabu-stats.yuya011.workers.dev/mcp
 *
 * SDK を使わないのは、この Worker が node_modules を持たない素の ESM で、
 * バンドラを挟んでいないため。ステートレスな MCP は JSON-RPC を1往復する
 * だけなので、素で書いても短い。セッションは張らず、Mcp-Session-Id も出さない
 * （仕様上サーバーの任意）。GET によるサーバー発の通知も使わないので 405 を返す。
 *
 * データは画面と同じ書き出しを HTTP で読む（worker/ 側に倉庫は持たない）。
 * 1社1ファイルに割ってあるので、1回の応答で読むのは10KB前後で済む。
 */

import { CORS, json } from './util.js';

/* 名乗る版。クライアントが知っている版を言ってきたらそれに合わせる */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = VERSIONS[0];

const SOURCE = 'EDINET（金融庁）の有価証券報告書。公共データ利用規約（PDL1.0）に基づき kabu-ai が加工';

/* 取り寄せた JSON は isolate が生きている間だけ持っておく。
   同じ目録を続けて読む検索が、そのぶん速くなる。消えても取り直せる。 */
const MEM = new Map();
const MEM_MAX = 24;

const base = (env) => (env.MCP_DATA_BASE || 'https://yuya011.github.io/kabu-ai/data/mcp')
  .replace(/\/$/, '');

async function load(env, rel) {
  if (MEM.has(rel)) return MEM.get(rel);

  const url = `${base(env)}/${rel}`;
  // 日次更新なので、辺で6時間持たせる。Cache API は同じ地域の別の利用者にも効く
  const res = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!res.ok) throw new Error(`${rel} を取得できませんでした (${res.status})`);
  const obj = await res.json();

  if (MEM.size >= MEM_MAX) MEM.delete(MEM.keys().next().value);
  MEM.set(rel, obj);
  return obj;
}

/* 「7203」「72030」「7203.T」のどれで来ても受ける。
   書き出し側の証券コードは EDINET と同じ5桁（4桁＋0）で揃えてある。 */
function normCode(code) {
  const s = String(code ?? '').trim().toUpperCase()
    .replace(/\.(T|JP|TO)$/, '').replace(/[^0-9A-Z]/g, '');
  if (s.length === 4) return `${s}0`;
  if (s.length === 5) return s;
  return '';
}

const short = (c) => c.slice(0, 4);

/** 相手方の識別子が証券コードなら4桁で返す。非上場に振った仮 ID は返さない */
const pubCode = (c) => (c && c.length === 5 && /[0-9]/.test(c[0]) ? short(c) : null);

/** 値の無い項目は返さない。LLM に渡すトークンを減らすため */
function tidy(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

async function detail(env, code) {
  const c = normCode(code);
  if (!c) {
    throw new Error(`証券コードとして読めません: ${JSON.stringify(code)}（例: 7203, 72030, 7203.T）`);
  }
  try {
    return [c, await load(env, `c/${c}.json`)];
  } catch {
    throw new Error(
      `証券コード ${short(c)} は見つかりませんでした。search_company で社名から引き直してください`
    );
  }
}

/* ---------------- 道具 ---------------- */

const TOOLS = [
  {
    name: 'search_company',
    description: '社名・証券コード・業種名で上場企業を検索する。'
      + 'まずこれを呼んで証券コードを確かめてから、他のツールに渡す。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '社名の一部（「トヨタ」「キーエンス」）、証券コード（7203 / 72030 / 7203.T）、'
            + 'または業種名（「情報・通信業」「銀行業」「電気機器」）',
        },
        limit: { type: 'integer', description: '返す最大件数。既定20、上限100', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_company_profile',
    description: '企業の基本情報と、有価証券報告書「主要な経営指標等の推移」による5期の業績を返す。'
      + '金額の単位は円（資本金だけ百万円）、比率は小数。',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: '証券コード' } },
      required: ['code'],
    },
  },
  {
    name: 'get_holding_network',
    description: '政策保有株・大株主・主要取引先の関係を返す。有報に書かれた保有目的の原文つき。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '証券コード' },
        direction: {
          type: 'string',
          enum: ['holding', 'held_by', 'trade', 'shareholders', 'all'],
          description: 'holding=保有先 / held_by=保有元 / trade=取引先 / shareholders=大株主 / all=すべて',
          default: 'all',
        },
        limit: { type: 'integer', description: '各区分の最大件数。既定40', default: 40 },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_surprise_ranking',
    description: '決算サプライズ（営業利益進捗のパーセンタイル順位）の上位銘柄を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: '決算期の絞り込み（"2Q" "FY" "2026/03" など）。省略時は全期間' },
        top_k: { type: 'integer', description: '返す件数。既定10、上限100', default: 10 },
      },
    },
  },
  {
    name: 'get_disclosures',
    description: '直近の開示情報を返す。EDINET の提出書類一覧と、臨時報告書の本文、当日の速報を含む。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '証券コード' },
        days: { type: 'integer', description: '何日ぶん遡るか。既定30、上限365', default: 30 },
      },
      required: ['code'],
    },
  },
];

async function searchCompany(env, { query, limit = 20 }) {
  const q = String(query ?? '').trim();
  if (!q) return { error: 'query が空です' };
  const n = Math.max(1, Math.min(Number(limit) || 20, 100));

  const idx = await load(env, 'index.json');
  const s17Name = new Map(idx.sectors.map((s) => [s.code, s.name]));
  const lower = q.toLowerCase();
  const code5 = normCode(q);
  // 数字だけで来たときはコードの前方一致に倒す。社名を数字で引くことはまず無い
  const asCode = !!code5 && /^[0-9A-Za-z.]+$/.test(q) && /[0-9]/.test(q);
  const bare = q.toUpperCase().replace(/[^0-9A-Z]/g, '');

  const hits = [];
  for (const row of idx.companies) {
    const [c, name, s17, s33] = row;
    let rank = null;
    if (asCode) {
      if (c === code5) rank = 0;
      else if (c.startsWith(bare)) rank = 1;
    } else {
      const nl = name.toLowerCase();
      if (nl === lower) rank = 0;
      else if (nl.startsWith(lower)) rank = 1;
      else if (nl.includes(lower)) rank = 2;
      else if ((s33 || '').toLowerCase().includes(lower)
               || (s17Name.get(s17) || '').toLowerCase().includes(lower)) rank = 3;
    }
    if (rank !== null) hits.push([rank, row]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1][1].length - b[1][1].length);

  return {
    query: q,
    matched: hits.length,
    returned: Math.min(hits.length, n),
    companies: hits.slice(0, n).map(([, r]) => tidy({
      code: short(r[0]),
      name: r[1],
      sector33: r[3] || null,
      sector17: s17Name.get(r[2]) || null,
      website: r[4] ? `https://${r[4]}` : null,
    })),
    source: SOURCE,
  };
}

async function getCompanyProfile(env, { code }) {
  const [c, d] = await detail(env, code);
  const results = (d.results || []).map((r) => tidy({
    period: r.label,
    relative: r.rel,
    sales: r.sales,
    operating_income: r.op,
    // 日本基準は経常利益、IFRS・米国基準は税引前利益。基準は accounting_standard を見る
    pretax_income: r.pretax,
    net_income: r.np,
    total_assets: r.assets,
    equity: r.equity,
    equity_ratio: r.equity_ratio,
    eps: r.eps,
    bps: r.bps,
    roe: r.roe,
    per: r.per,
    dividend_per_share: r.dividend,
    operating_cash_flow: r.ocf,
    employees: r.employees,
  }));

  const out = tidy({
    code: short(c),
    name: d.name,
    name_en: d.name_en,
    formal_name: d.formal_name,
    sector33: d.s33,
    sector17: d.s17,
    market: d.market || null,
    edinet_code: d.edinet_code,
    corporate_number: d.corp_number,
    fiscal_year_end: d.fiscal_year_end,
    capital_million_yen: d.capital,
    website: d.site_url,
    accounting_standard: d.standard,
    consolidation: d.basis,
    annual_report: tidy({ doc_id: d.doc_id, submitted: d.doc_submitted, results_submitted: d.results_submitted }),
    latest: tidy({
      period: d.period,
      sales: d.sales,
      operating_income: d.op,
      net_income: d.np,
      operating_margin: d.op_margin,
      eps: d.eps,
      bps: d.bps,
      equity_ratio: d.equity_ratio,
    }),
    results,
    quarterly: (d.financials || []).map((q) => tidy({
      disclosed: q.date,
      period: q.period,
      doc_type: q.doc_type,
      sales: q.sales,
      operating_income: q.op,
      net_income: q.np,
      eps: q.eps,
      forecast_sales: q.f_sales,
      forecast_operating_income: q.f_op,
      forecast_net_income: q.f_np,
    })),
    counts: {
      holdings: d.n_holdings ?? 0,
      held_by: d.n_held_by ?? 0,
      sells_to: d.n_sells_to ?? 0,
      buys_from: d.n_buys_from ?? 0,
    },
    units: '金額は円。capital_million_yen のみ百万円。比率は小数（0.0832 = 8.32%）',
    source: SOURCE,
  });
  if (!results.length) {
    out.note = 'この会社の有価証券報告書はまだ取り込めていません。'
      + '上場直後、または直近の提出が取り込み対象期間の外にあります';
  }
  return out;
}

const holdingRows = (rows) => rows.map((h) => tidy({
  code: pubCode(h.code),
  name: h.name || h.raw,
  shares: h.shares,
  book_value_yen: h.value,
  // 有報の原文。ここに「仕入先」「販売先」など取引の性質が書かれている
  purpose: h.purpose,
  mutual: h.mutual === '有' ? true : null,
  relation: h.relation,
}));

async function getHoldingNetwork(env, { code, direction = 'all', limit = 40 }) {
  const want = String(direction || 'all').toLowerCase();
  if (!['holding', 'held_by', 'trade', 'shareholders', 'all'].includes(want)) {
    return { error: `direction は holding / held_by / trade / shareholders / all です: ${direction}` };
  }
  const n = Math.max(1, Math.min(Number(limit) || 40, 100));
  const [c, d] = await detail(env, code);

  const out = { code: short(c), name: d.name, direction: want };
  if (want === 'holding' || want === 'all') out.holdings = holdingRows((d.holdings || []).slice(0, n));
  if (want === 'held_by' || want === 'all') out.held_by = holdingRows((d.held_by || []).slice(0, n));
  if (want === 'trade' || want === 'all') {
    out.trade = (d.trade || []).slice(0, n).map((t) => tidy({
      code: pubCode(t.code),
      name: t.name,
      direction: t.direction,   // 仕入先 / 販売先 / 業務提携
      amount_yen: t.amount,
      segment: t.segment,
      note: t.note,
      source: t.source,
    }));
  }
  if (want === 'shareholders' || want === 'all') {
    out.shareholders = (d.shareholders || []).slice(0, n).map((s) => tidy({
      rank: s.rank ?? null,
      name: s.name,
      code: pubCode(s.code),
    }));
  }

  out.legend = {
    holdings: 'この会社が有報で開示している政策保有株（保有先）',
    held_by: 'この会社の株を政策保有していると開示した上場企業（保有元）',
    trade: '有報の「主要な顧客ごとの情報」と、政策保有の保有目的から読める取引関係',
    mutual: 'true なら相互に保有＝持ち合い',
  };
  out.source = SOURCE;
  return tidy(out);
}

async function getSurpriseRanking(env, { period, top_k = 10 }) {
  const n = Math.max(1, Math.min(Number(top_k) || 10, 100));
  let all = { companies: [] };
  try {
    all = await load(env, 'surprise.json');
  } catch { /* 公開版には無い。下の note で理由を返す */ }

  const rows = (all.companies || [])
    .filter((r) => !period || String(r.period || '').includes(period))
    .slice(0, n)
    .map((r) => tidy({
      code: short(r.code),
      name: r.name,
      sector33: r.s33,
      period: r.period,
      disclosed: r.disc_date,
      // 累計営業利益 ÷ 通期会社予想。四半期で水準が変わるので絶対値は比べられない
      progress: r.progress,
      // 同日開示内でのパーセンタイル順位。比べられるのはこちら
      percentile: r.pctile,
      excess_return: r.excess,
    }));

  if (!rows.length) {
    // 元になる決算短信は J-Quants 由来で、規約が第三者の閲覧を認めていない
    return {
      period: period ?? null,
      count: 0,
      companies: [],
      note: '公開データには決算サプライズが含まれていません。'
        + '元になる決算短信の数値は J-Quants 由来で、利用規約が第三者の閲覧を'
        + '認めていないため配信物から外してあります。'
        + '有報ベースの業績推移は get_company_profile から引けます',
    };
  }
  return {
    period: period ?? null,
    count: all.count ?? rows.length,
    companies: rows,
    legend: {
      percentile: '同日開示内での営業利益進捗の順位（1.0 が最上位）',
      progress: '累計営業利益 ÷ 通期会社予想',
      excess_return: '開示後の市場調整後リターン',
    },
  };
}

async function getDisclosures(env, { code, days = 30 }, live) {
  const [c, d] = await detail(env, code);
  const n = Math.max(1, Math.min(Number(days) || 30, 365));
  const cutoff = new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const recent = (items, key) => (items || []).filter((x) => String(x[key] || '').slice(0, 10) >= cutoff);

  const out = {
    code: short(c),
    name: d.name,
    days: n,
    since: cutoff,
    filings: recent(d.filings, 'submitted').map((f) => tidy({
      doc_id: f.doc_id,
      title: f.title,
      submitted: f.submitted,
      // 画面と同じ本文 PDF への直リンク。鍵が無くても開ける
      url: f.doc_id ? `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${f.doc_id}.pdf` : null,
    })),
    // 臨時報告書。M&A・主要株主の異動・株主総会決議などが本文つきで入る
    events: recent(d.events, 'submitted').map((e) => tidy({
      doc_id: e.doc_id, submitted: e.submitted, kind: e.kind, body: e.body,
    })),
    disclosures: recent(d.disclosures, 'date').map((x) => tidy({
      date: x.date, title: x.title, url: x.url,
    })),
  };

  // 当日ぶんは書き出しに間に合わない。同じ Worker が積んでいる速報から足す
  const today = await live(c);
  if (today.length) out.today = today;

  out.source = SOURCE;
  return tidy(out);
}

/* ---------------- JSON-RPC ---------------- */

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function call(env, name, args, live) {
  switch (name) {
    case 'search_company': return searchCompany(env, args);
    case 'get_company_profile': return getCompanyProfile(env, args);
    case 'get_holding_network': return getHoldingNetwork(env, args);
    case 'get_surprise_ranking': return getSurpriseRanking(env, args);
    case 'get_disclosures': return getDisclosures(env, args, live);
    default: return null;
  }
}

async function dispatch(env, msg, live) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: VERSIONS.includes(asked) ? asked : LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: 'kabu-ai', title: 'kabu-ai 日本株データ', version: '0.1.0' },
        instructions: '日本株（東証上場約3,900社）のデータを返します。'
          + '出典は EDINET の有価証券報告書で、推測は入っていません。'
          + '証券コードが分からないときは、まず search_company で引いてください。',
      },
    };
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

  if (method === 'tools/call') {
    const tool = params?.name;
    if (!TOOLS.some((t) => t.name === tool)) {
      return rpcError(id, -32602, `そのような道具はありません: ${tool}`);
    }
    try {
      const result = await call(env, tool, params?.arguments ?? {}, live);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], isError: false },
      };
    } catch (e) {
      // 道具の中の失敗は、プロトコルの失敗ではなく結果として返す。
      // そうしないとモデルが読めず、言い直しもできない
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: e.message }], isError: true },
      };
    }
  }

  return rpcError(id, -32601, `対応していないメソッドです: ${method}`);
}

/* ---------------- 入口 ---------------- */

const MCP_CORS = {
  ...CORS,
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
};

/** MCP の口。live は当日の速報を引く関数（index.js から渡す） */
export async function handleMcp(request, env, live) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_CORS });
  }

  // サーバー発の通知は使わないので、GET の購読は断る（仕様どおり 405）。
  // セッションも張らないので DELETE も同じ。
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...MCP_CORS, Allow: 'POST, OPTIONS' } });
  }

  const ver = request.headers.get('MCP-Protocol-Version');
  if (ver && !VERSIONS.includes(ver)) {
    return json({ error: `対応していないプロトコル版です: ${ver}` }, 400, MCP_CORS);
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, 'JSON として読めません')),
      { status: 400, headers: { 'Content-Type': 'application/json', ...MCP_CORS } });
  }

  /* 返事の要る問い合わせだけ捌く。id を持たないものは通知か応答で、
     仕様では本文を返さず 202 にする。まとめて来たときは中身を見て分けるので、
     先頭が通知でも後ろの問い合わせを落とさない。 */
  const batch = Array.isArray(msg) ? msg : [msg];
  const asks = batch.filter((m) => m && m.id !== undefined && m.id !== null);
  if (!asks.length) {
    return new Response(null, { status: 202, headers: MCP_CORS });
  }

  const out = await Promise.all(asks.map((m) => dispatch(env, m, live)));
  return json(Array.isArray(msg) ? out : out[0], 200, MCP_CORS);
}
