export interface Summary {
  code: string;
  name: string;
  s33: string;
  market: string;
  scale: string;
  sales: number | null;
  op: number | null;
  np: number | null;
  op_margin: number | null;
  op_progress: number | null;
  /** 累計営業利益 ÷ 通期会社予想。四半期によって水準が決まるので絶対値は比較できない */
  progress: number | null;
  /** 同日開示内でのパーセンタイル順位。比較可能なのはこちら */
  pctile: number | null;
  excess: number | null;
  period: string | null;
  disc_date: string | null;
  n_holdings: number;
  n_held_by: number;
  n_sells_to: number;
  n_buys_from: number;
}

export interface FinancialRow {
  date: string;
  period: string;
  doc_type: string;
  sales: number | null;
  op: number | null;
  np: number | null;
  eps: number | null;
  f_sales: number | null;
  f_op: number | null;
  f_np: number | null;
}

export interface SurpriseRow {
  date: string;
  period: string;
  progress: number | null;
  pctile: number | null;
  day_n: number;
  excess: number | null;
}

export interface Holding {
  code: string | null;
  name: string | null;
  raw: string;
  shares: number | null;
  value: number | null;
  /** 有報に記載された保有目的・業務提携等の概要・定量的な保有効果 */
  purpose: string | null;
  /** 「有」なら相手も自社株を保有＝持ち合い */
  mutual: string | null;
  /** 保有目的から読める取引の性質 */
  relation: string | null;
}

export interface HeldBy {
  code: string;
  name: string;
  value: number | null;
  purpose: string | null;
  mutual: string | null;
  relation: string | null;
}

export interface Shareholder {
  rank: number | null;
  name: string;
  code: string | null;
}

export interface Disclosure {
  date: string;
  title: string;
  url: string;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string | null;
  published: string;
  /** 観測時刻。これより前の記事を後から検証に混ぜないための目印 */
  fetched_at: string;
}

export interface FilingItem {
  doc_id: string;
  title: string;
  submitted: string;
  doc_type: string;
}

export interface EventItem {
  doc_id: string;
  submitted: string;
  /** 「主要株主の異動」「吸収合併の決定」など、臨時報告書の記載区分 */
  kind: string;
  body: string;
}

export interface TradeItem {
  code: string | null;
  name: string | null;
  raw?: string;
  amount: number | null;
  segment: string | null;
}

export interface TradeRelation {
  code: string | null;
  name: string | null;
  /** 仕入先 / 販売先 / 業務提携 */
  direction: string;
  amount: number | null;
  segment: string | null;
  /** 保有目的の原文（出所が保有目的のとき） */
  note: string | null;
  source: string;
}

export interface Detail extends Summary {
  name_en: string | null;
  s17: string;
  formal_name: string | null;
  edinet_code: string | null;
  corp_number: string | null;
  fiscal_year_end: string | null;
  capital: number | null;
  margin_type: string | null;
  domain: string | null;
  site_url: string | null;
  doc_id: string | null;
  doc_submitted: string | null;
  eps: number | null;
  bps: number | null;
  equity_ratio: number | null;
  financials: FinancialRow[];
  surprises: SurpriseRow[];
  holdings: Holding[];
  held_by: HeldBy[];
  shareholders: Shareholder[];
  disclosures: Disclosure[];
  news: NewsItem[];
  filings: FilingItem[];
  events: EventItem[];
  sells_to: TradeItem[];
  trade: TradeRelation[];
  buys_from: TradeItem[];
}

export interface SectorTile {
  name: string;
  code: string;
  count: number;
  with_financials: number;
  median_op_margin: number | null;
  measured: number;
  median_pctile: number | null;
  markets: Record<string, number>;
}

export interface SectorFile {
  code: string;
  name: string;
  subsectors: { name: string; count: number }[];
  companies: Summary[];
}

export interface BrowserIndex {
  meta: {
    generated_at: string;
    company_count: number;
    filing_count: number;
    surprise_count: number;
    holding_count: number;
    holding_companies: number;
  };
  sectors: SectorTile[];
  /** [証券コード, 社名, 17業種コード, 33業種名, ドメイン] */
  nodes: [string, string, string, string, string][];
  markets: { name: string; count: number }[];
  scales: { name: string; count: number }[];
}
