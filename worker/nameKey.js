/* 社名検索の表記ゆれを吸収する。src/name_key.py の norm / match の写し。

   検索キー（ヨミ・英字名・略記・通称）は書き出し側で norm した形で入っている。
   ここの norm が Python 側と1文字でも違うと突き合わなくなるので、
   変えたら3か所（src/name_key.py・frontend/src/browser/nameKey.ts・ここ）を揃え、
   scripts/check_name_key.mjs で確かめる。 */

const SMALL_FROM = 'ァィゥェォッャュョヮヵヶヴ';
const SMALL_TO = 'アイウエオツヤユヨワカケブ';
const VAR_FROM = '髙﨑嵜齋齊斉澤邊邉濱眞德櫻廣國藏證會豐鐵驛實惠榮壽淺條寶萬彌圓學氣團龜';
const VAR_TO = '高崎崎斎斎斎沢辺辺浜真徳桜広国蔵証会豊鉄駅実恵栄寿浅条宝万弥円学気団亀';

const MAP = new Map();
for (let i = 0; i < SMALL_FROM.length; i++) MAP.set(SMALL_FROM[i], SMALL_TO[i]);
for (const [i, ch] of [...VAR_FROM].entries()) MAP.set(ch, [...VAR_TO][i]);

const JA_FORMS = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
  '(株)', '(有)', 'カブシキガイシヤ', 'カブシキカイシヤ', 'ユウゲンガイシヤ', 'ゴウドウガイシヤ'];

const EN_FORMS = /(?<![a-z0-9])(co|ltd|inc|corp|corporation|incorporated|limited|company|kabushiki|kaisha|kk|plc|llc)(?![a-z0-9])/g;

/** 検索用に潰した形。打たれた文字と社名の両方にかける */
export function norm(s) {
  if (!s) return '';
  let t = '';
  for (const ch of s.normalize('NFKC').toLowerCase()) {
    const c = ch.codePointAt(0);
    const k = c >= 0x3041 && c <= 0x3096 ? String.fromCodePoint(c + 0x60) : ch;
    t += MAP.get(k) ?? k;
  }
  for (const f of JA_FORMS) t = t.split(f).join('');
  t = t.replace(EN_FORMS, '');
  // 文字と数字だけ残す。長音は「ユーザー／ユーザ」の揺れが多いので落とす
  return t.replace(/[^\p{L}\p{N}]|ー/gu, '');
}

function subseqSpan(q, key) {
  if (q.length < 2 || !key || key[0] !== q[0]) return null;
  let i = 0;
  for (let j = 0; j < key.length; j++) {
    if (key[j] === q[i] && ++i === q.length) return j + 1;
  }
  return null;
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a, b) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return (2 * n) / (x.size + y.size);
}

/** [順位, 同順位内の並び] を返す。小さいほど上。一致しなければ null。
    0 完全一致・頭文字 / 1 前方一致 / 2 部分一致 / 3 略称 / 4 打ち間違い */
export function match(q, base, loose = '', exact = '') {
  const keys = loose ? [base, ...loose.split(' ')] : [base];
  if (keys.includes(q)) return [0, 0];
  if (exact && exact.split(' ').includes(q)) return [0, 1];
  if (keys.some((k) => k.startsWith(q))) return [1, 0];
  if (keys.some((k) => k.includes(q))) return [2, 0];
  // 英字は詰めた略称を作らない。2〜3文字の英字で拾うと無関係な社名が大量に掛かる
  if (!/^[\x00-\x7f]*$/.test(q)) {
    let span = Infinity;
    for (const k of keys) {
      const s = subseqSpan(q, k);
      if (s !== null && s < span) span = s;
    }
    if (span !== Infinity) return [3, span - q.length];
  }
  if (q.length >= 3) {
    let best = 0;
    for (const k of keys) {
      for (const d of [-1, 0, 1]) best = Math.max(best, dice(q, k.slice(0, q.length + d)));
    }
    if (best >= 0.5) return [4, -best];
  }
  return null;
}
