export interface QuintileStat {
  quintile: string;
  count: number;
  mean: number;
  median: number;
  std: number;
  p25: number;
  p75: number;
}

export interface HistogramBin {
  bin: string;
  bin_val: number;
  Q1_count: number;
  Q5_count: number;
  Q1_pct: number;
  Q5_pct: number;
}

export interface DailyRankICItem {
  date: string;
  period: string;
  n_stocks: number;
  rank_ic: number;
  is_positive: boolean;
}

export interface DailyRankICSummary {
  total_days: number;
  positive_days: number;
  negative_days: number;
  mean_rank_ic: number;
  series: DailyRankICItem[];
}

export interface StockItem {
  rank: number;
  code: string;
  name: string;
  sector: string;
  surprise_pct: number;
  quintile: string;
  excess_return_pct: number;
  doc_type: string;
}

export interface DashboardData {
  metadata: {
    title: string;
    total_events: number;
    date_range: [string, string];
    periods: string[];
    dates: string[];
  };
  quintile_stats: Record<string, QuintileStat[]>;
  histogram_q1_q5: HistogramBin[];
  daily_rank_ic: DailyRankICSummary;
  daily_stocks: Record<string, StockItem[]>;
}
