/* 上場市場の区分。有報の「上場金融商品取引所名」から取ったもの（scripts/extract_markets.py）。

   東証の3市場に、地方の取引所だけに上場している会社と TOKYO PRO Market を「その他」として足す。
   有報の提出日時点の市場なので、その後の市場変更は次の有報まで反映されない。 */

export type MarketKey = 'prime' | 'standard' | 'growth' | 'other';

export const MARKETS: { key: MarketKey; label: string; color: string }[] = [
  { key: 'prime', label: 'プライム', color: 'var(--k-mkt-prime)' },
  { key: 'standard', label: 'スタンダード', color: 'var(--k-mkt-standard)' },
  { key: 'growth', label: 'グロース', color: 'var(--k-mkt-growth)' },
  { key: 'other', label: 'その他', color: 'var(--k-mkt-other)' },
];

const BY_NAME: Record<string, MarketKey> = { プライム: 'prime', スタンダード: 'standard', グロース: 'growth' };

/** 書き出しの市場名（プライム・名証・TOKYO PRO Market など）を絞り込みの区分に寄せる */
export const marketKey = (m: string | null | undefined): MarketKey => BY_NAME[m ?? ''] ?? 'other';

export const isMarketKey = (s: string | null | undefined): s is MarketKey =>
  s === 'prime' || s === 'standard' || s === 'growth' || s === 'other';

/** 画面に出す市場名。東証の市場には「東証」を付ける */
export function marketLabel(m: string | null | undefined): string {
  if (!m) return '';
  return BY_NAME[m] ? `東証${m}` : m;
}

export const marketColor = (k: MarketKey) => MARKETS.find((m) => m.key === k)!.color;
