/* 外部の生成AIに渡すプロンプトを組み立てる。

   このアプリは有価証券報告書から機械的に抽出した事実を持っているので、
   それをそのまま渡す。モデルに社名だけ投げると記憶と推測で埋められてしまい、
   古い決算や存在しない資本関係が返る。事実を添えて出典を明記させるほうが確実で、
   こちら側に推論用のバックエンドを持たなくて済む。 */

import type { Detail } from './types';
import type { Hop, NodeRec } from './graph';

const oku = (v: number | null | undefined) => {
  if (v == null) return '不明';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(a / 1e8 >= 100 ? 0 : 1)}億円`;
  return `${Math.round(v).toLocaleString()}円`;
};
const pct = (v: number | null | undefined) => (v == null ? '不明' : `${(v * 100).toFixed(1)}%`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface PromptContext {
  rec: NodeRec;
  code: string;
  detail: Detail | null;
  /** 中心企業からの経路が出ているときは、それも文脈として渡す */
  path?: { hops: Hop[]; centerName: string; nameOf: (code: string) => string;
           purposeOf: (holder: string, held: string) => string | null } | null;
}

export function buildPrompt({ rec, code, detail, path }: PromptContext): string {
  const L: string[] = [];
  const name = rec.name;

  L.push(`次の情報は、日本の上場企業「${name}」（証券コード ${code.slice(0, 4)}）について、`);
  L.push('有価証券報告書とEDINETから機械的に抽出した事実です。');
  L.push('この情報を根拠として答えてください。ここに書かれていないことを補う場合は、');
  L.push('必ず「これは提供された資料にない推測です」と明記してください。');
  L.push('');

  if (path && path.hops.length > 0) {
    L.push('【問い】');
    L.push(`「${path.centerName}」と「${name}」は、下記の資本関係でつながっています。`);
    L.push('この2社がなぜこのような関係にあるのか、事業上の背景を説明してください。');
    L.push('');
    L.push('【つながりの経路】');
    for (const h of path.hops) {
      const holder = h.forward ? h.from : h.to;
      const held = h.forward ? h.to : h.from;
      const purpose = h.link.kind === 'hold' ? path.purposeOf(holder, held) : null;
      const kind = h.link.kind === 'major' ? '大株主として記載' : '政策保有';
      L.push(`- ${path.nameOf(holder)} → ${path.nameOf(held)}（${kind}`
        + `${h.link.value != null ? `・簿価 ${oku(h.link.value)}` : ''}`
        + `${h.link.mutual ? '・持ち合い' : ''}）`);
      if (purpose) L.push(`  有報に記載された保有目的:「${purpose}」`);
    }
    L.push('');
  } else {
    L.push('【問い】');
    L.push(`${name}がどのような会社で、どこと、なぜ資本関係を持っているのかを説明してください。`);
    L.push('');
  }

  L.push('【基本情報】');
  L.push(`業種: ${rec.s33}${detail?.market ? ` / 市場: ${detail.market}` : ''}`
    + `${detail?.fiscal_year_end ? ` / 決算期: ${detail.fiscal_year_end}` : ''}`);
  if (detail?.domain) L.push(`公式サイト: https://${detail.domain}`);
  L.push('');

  if (detail && detail.sales != null) {
    L.push(`【直近決算（${detail.disc_date ?? ''} 開示・${detail.period ?? ''}）】`);
    L.push(`売上高 ${oku(detail.sales)} / 営業利益 ${oku(detail.op)}（利益率 ${pct(detail.op_margin)}）`
      + ` / 純利益 ${oku(detail.np)} / 自己資本比率 ${pct(detail.equity_ratio)}`);
    L.push('');
  }

  if (detail?.holdings?.length) {
    L.push('【この会社が政策保有している上場株（有報「特定投資株式の明細」より、簿価上位）】');
    for (const h of detail.holdings.slice(0, 10)) {
      L.push(`- ${h.name || h.raw}（${oku(h.value)}${h.mutual === '有' ? '・持ち合い' : ''}）`
        + `${h.purpose ? `: 保有目的「${clip(h.purpose, 90)}」` : ''}`);
    }
    if (detail.n_holdings > 10) L.push(`  ほか ${detail.n_holdings - 10} 銘柄`);
    L.push('');
  }

  if (detail?.held_by?.length) {
    L.push('【この会社の株を政策保有している上場企業（簿価上位）】');
    for (const h of detail.held_by.slice(0, 8)) {
      L.push(`- ${h.name}（${oku(h.value)}${h.mutual === '有' ? '・持ち合い' : ''}）`
        + `${h.purpose ? `: 保有目的「${clip(h.purpose, 90)}」` : ''}`);
    }
    if (detail.n_held_by > 8) L.push(`  ほか ${detail.n_held_by - 8} 社`);
    L.push('');
  }

  if (detail?.shareholders?.length) {
    L.push('【大株主（信託口・カストディを除く）】');
    for (const s of detail.shareholders.slice(0, 8)) L.push(`- ${s.rank ?? '-'}位 ${s.name}`);
    L.push('');
  }

  if (detail?.news?.length) {
    L.push('【最近の報道見出し（Googleニュース経由・参考）】');
    for (const n of detail.news.slice(0, 6)) L.push(`- ${n.published} ${n.title}（${n.source ?? ''}）`);
    L.push('');
  }

  L.push('【出典】');
  if (detail?.doc_id) {
    L.push(`有価証券報告書${detail.doc_submitted ? `（${detail.doc_submitted.slice(0, 10)} 提出）` : ''}: `
      + `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${detail.doc_id}.pdf`);
  }
  L.push(`株価・開示: https://finance.yahoo.co.jp/quote/${code.slice(0, 4)}.T`);

  return L.join('\n');
}

/** Gemini を開く。プロンプトはURLに載せつつ、確実を期してクリップボードにも置く。 */
export async function askGemini(prompt: string): Promise<'copied' | 'opened'> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    copied = false; // 権限がない・安全なコンテキストでない場合
  }
  // URL に載せられる長さには実質的な上限があるので、長い場合は切って渡す。
  // 全文はクリップボードにあるので、貼り直せば失われない。
  const q = prompt.length > 3500 ? `${prompt.slice(0, 3500)}\n（以下省略。全文は貼り付けてください）` : prompt;
  window.open(`https://gemini.google.com/app?q=${encodeURIComponent(q)}`, '_blank', 'noopener');
  return copied ? 'copied' : 'opened';
}
