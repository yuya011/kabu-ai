/* EDINET（金融庁）の提出書類一覧。既定で有効な情報源。
 *
 * 公共データ利用規約(PDL1.0)で商用利用まで認められており、出典を明記すれば
 * 配信してよい。scripts/extract_filings.py が静的データで使っているのと同じ根拠で、
 * こちらは「当日ぶんを10分おきに取り直す」速報の役をする。
 *
 * 扱えるのは有報・四半期・臨時報告書・大量保有報告書など法定開示だけで、
 * 決算短信は TDnet 側にしか出ない。短信まで要るなら JPX の TDnet API を契約して
 * sources/tdnet.js を有効にする。
 *
 * 鍵は EDINET_KEY（wrangler secret put EDINET_KEY）。
 */

import { jstYmd } from '../util.js';

export const id = 'edinet';
export const label = 'EDINET（金融庁）';
export const attribution = {
  name: 'EDINET（金融庁）',
  url: 'https://disclosure2.edinet-fsa.go.jp/',
  license: '公共データ利用規約(PDL1.0)',
};

const API = 'https://api.edinet-fsa.go.jp/api/v2/documents.json';
const VIEW = 'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?';

/* 有報に必ず添付される確認書と、月次の自己株買付状況は情報量が乏しい。
   extract_filings.py の SKIP_TYPES と同じ扱いにして、静的側と揃える。 */
const SKIP = new Set(['135', '136', '220', '230']);

/* 株主構成や支配権が動くものを通知の対象にする。
   有報・四半期は予定された定期開示なので、鳴らしても意味が薄い。
   180 臨時報告書 / 240〜300 公開買付関係 / 350・360 大量保有報告書。 */
const IMPORTANT = new Set(
  ['180', '240', '250', '260', '270', '280', '290', '300', '350', '360']);

/* 区分の名前は docDescription の頭から取る。
   docTypeCode の対応表を持つより確実で、実際 350 は「大量保有報告書」と
   「変更報告書」の両方に使われている。括弧や期の記載から手前を切るだけでよい。 */
function category(desc) {
  const head = (desc || '').split(/[（(－―—\-]/)[0].trim();
  return head || null;
}

export function enabled(env) {
  return !!env.EDINET_KEY;
}

/** 当日ぶんの提出書類。Cron から呼ぶ。 */
export async function today(env, ymd = jstYmd()) {
  const url = `${API}?date=${ymd}&type=2&Subscription-Key=${encodeURIComponent(env.EDINET_KEY)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'kabu-ai/1.0 (+https://github.com/yuya011/kabu-ai)' },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`edinet ${res.status}`);

  const body = await res.json();

  /* EDINET はエラーも HTTP 200 で返す。
     鍵が違うときは本文が {"StatusCode":401,"message":"Access denied ..."} になり、
     一覧 API 側の異常は metadata.status に入る。res.ok だけを見ていると
     「鍵が違う」と「その日は提出が無い」がどちらも 0 件になって区別が付かない。
     提出が無い日でも results は [] として必ず来るので、無ければ異常とみなす。 */
  const status = Number(body.StatusCode ?? body.metadata?.status ?? 200);
  if (status !== 200) {
    const why = String(body.message ?? body.metadata?.message ?? '').slice(0, 90);
    throw new Error(`edinet ${status} ${why}`);
  }
  if (!Array.isArray(body.results)) {
    throw new Error('edinet 応答に results が無い');
  }

  const items = [];
  for (const d of body.results) {
    // 証券コードが無いのは投資信託・ファンド。上場企業の画面には出さない
    const sec = (d.secCode || '').trim();
    if (!sec) continue;
    // 取り下げ・非開示は無かったことにする
    if (d.withdrawalStatus && d.withdrawalStatus !== '0') continue;
    if (d.disclosureStatus && d.disclosureStatus !== '0') continue;
    const type = d.docTypeCode || '';
    if (SKIP.has(type)) continue;
    if (!d.docID) continue;

    const desc = (d.docDescription || '').trim();
    items.push({
      id: `edinet:${d.docID}`,
      code: sec,
      name: (d.filerName || '').trim() || null,
      title: desc || '提出書類',
      url: `${VIEW}${d.docID}`,
      // EDINET の submitDateTime は日本時間で 'YYYY-MM-DD HH:MM'
      disclosed_at: (d.submitDateTime || '').slice(0, 16),
      category: category(desc),
      important: IMPORTANT.has(type),
      source: id,
    });
  }
  return items;
}

/* 銘柄ごとの取り出しは D1 で足りる。EDINET の一覧 API は日付単位でしか引けず、
   1社ぶんのために全件を取り直すのは無駄なので、オンデマンドは持たない。 */
export const onDemand = null;
