import { useEffect, useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ErrorBar,
  Cell
} from 'recharts';
import {
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Layers,
  Calendar,
  Table as TableIcon,
  Search,
  Activity,
  CheckCircle2,
  Info
} from 'lucide-react';
import { DashboardData, QuintileStat, StockItem } from './types';

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tableFilterQuintile, setTableFilterQuintile] = useState<string>('all');

  useEffect(() => {
    fetch('/data/dashboard_data.json')
      .then((res) => {
        if (!res.ok) throw new Error('データの取得に失敗しました');
        return res.json();
      })
      .then((json: DashboardData) => {
        setData(json);
        if (json.metadata.dates && json.metadata.dates.length > 0) {
          setSelectedDate(json.metadata.dates[0]);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // 1. 分位別データ
  const currentQuintileStats: QuintileStat[] = useMemo(() => {
    if (!data) return [];
    return data.quintile_stats[selectedPeriod] || data.quintile_stats['all'] || [];
  }, [data, selectedPeriod]);

  // 分位別 ComposedChart 用データ
  const quintileBarData = useMemo(() => {
    return currentQuintileStats.map((q) => ({
      name: q.quintile,
      mean: q.mean,
      median: q.median,
      errorY: [q.std, q.std],
      count: q.count,
      p25: q.p25,
      p75: q.p75,
      band: [q.p25, q.p75]
    }));
  }, [currentQuintileStats]);

  // 4. 銘柄テーブルデータ
  const currentStocks: StockItem[] = useMemo(() => {
    if (!data || !selectedDate) return [];
    let list = data.daily_stocks[selectedDate] || [];
    if (tableFilterQuintile !== 'all') {
      list = list.filter((s) => s.quintile === tableFilterQuintile);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.code.includes(q));
    }
    return list;
  }, [data, selectedDate, tableFilterQuintile, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center text-gray-300">
        <div className="flex items-center space-x-3 bg-[#111827] border border-[#1f293d] p-6 rounded-2xl shadow-2xl">
          <Activity className="w-6 h-6 text-emerald-400 animate-spin" />
          <span className="font-mono text-sm">クオンツ検証データを読み込み中...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center text-rose-400 p-4">
        <div className="bg-rose-950/40 border border-rose-800/80 p-6 rounded-2xl max-w-md">
          <AlertTriangle className="w-8 h-8 mb-2" />
          <h2 className="font-bold text-lg">エラーが発生しました</h2>
          <p className="text-sm mt-1 text-rose-300">{error || 'データが見つかりません'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-gray-100 pb-16 font-sans">
      {/* 画面上部 固定注記 */}
      <div className="bg-amber-950/60 border-b border-amber-800/70 text-amber-200 px-4 py-3 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-start gap-3 text-xs md:text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-amber-300">【重要・事後検証に関する注記】</span>
            本ダッシュボードは過去データの事後検証結果です。平均 Rank IC は +0.0527、3決算期で一貫して正ですが、実効独立サンプル数は8前後で統計的有意性は主張できません。投資判断には使用しないこと。
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-white">
                Kabu-AI 決算サプライズ検証ダッシュボード
              </h1>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Point-in-Time 決算数値サプライズ（営業利益）および 5営業日後超過リターンの事後実証分析
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f293d] text-gray-300 font-mono">
              対象イベント数: <strong className="text-white">{data.metadata.total_events.toLocaleString()}</strong> 件
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-[#111827] border border-[#1f293d] text-gray-300 font-mono">
              開示日数: <strong className="text-white">{data.daily_rank_ic.total_days}</strong> 日
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8 mt-6">

        {/* ------------------------------------------------------------- */}
        {/* セクション 1: 分位別 平均 ＆ 中央値 超過リターン (棒グラフ + エラーバー) */}
        {/* ------------------------------------------------------------- */}
        <section className="bg-[#111827]/80 border border-[#1f293d] rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base md:text-lg font-bold text-white">
                  1. 分位別 平均 ＆ 中央値 超過リターン
                </h2>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                営業利益サプライズによる5分位（Q1最下位 〜 Q5最上位）。エラーバーは標準偏差（±1σ）。
              </p>
            </div>

            {/* 決算期セレクタ */}
            <div className="flex items-center gap-2">
              <label htmlFor="period-select" className="text-xs text-gray-400 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> 決算期:
              </label>
              <select
                id="period-select"
                aria-label="決算期セレクタ"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="bg-[#090d16] border border-[#1f293d] text-xs text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500 font-medium"
              >
                <option value="all">全期間 (2024秋 〜 2025春)</option>
                <option value="2025年5月期">2025年5月期 (FY本決算)</option>
                <option value="2025年2月期">2025年2月期 (3Q)</option>
                <option value="2024年11月期">2024年11月期 (2Q)</option>
              </select>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={quintileBarData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />
                <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  domain={[-8, 8]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded-xl shadow-2xl text-xs space-y-1">
                          <p className="font-bold text-white">{d.name} ({d.count} 銘柄)</p>
                          <p className="text-emerald-400">平均リターン: <strong>{d.mean > 0 ? '+' : ''}{d.mean.toFixed(2)}%</strong></p>
                          <p className="text-amber-400">中央値: <strong>{d.median > 0 ? '+' : ''}{d.median.toFixed(2)}%</strong></p>
                          <p className="text-gray-400">標準偏差 (std): ±{d.errorY[0].toFixed(2)}%</p>
                          <p className="text-gray-400">25〜75%帯: [{d.p25 > 0 ? '+' : ''}{d.p25.toFixed(2)}%, {d.p75 > 0 ? '+' : ''}{d.p75.toFixed(2)}%]</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1.5} />
                <Bar dataKey="mean" name="平均超過リターン" fill="#10b981" radius={[4, 4, 0, 0]}>
                  <ErrorBar dataKey="errorY" width={8} strokeWidth={1.5} stroke="#6ee7b7" />
                  {quintileBarData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.mean >= 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="median" name="中央値" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 5, fill: '#f59e0b' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1f293d] flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> 平均値 (Mean)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block"></span> 中央値 (Median)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border border-emerald-300 inline-block"></span> エラーバー (±1σ)</span>
            </div>
            <span className="text-gray-400">
              ※ Q5（最上位）は平均 +0.19% に対し中央値 -0.52% と乖離。少数の急騰銘柄が平均を押し上げています。
            </span>
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* セクション 2: 分位別 リターン分布の帯 (ファンチャート風) */}
        {/* ------------------------------------------------------------- */}
        <section className="bg-[#111827]/80 border border-[#1f293d] rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base md:text-lg font-bold text-white">
                2. 分位別 リターン分布帯 (25〜75パーセンタイル帯)
              </h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              各分位の 25〜75% 分布帯（Area）と中央値（Line）。分散が平均差の10倍以上大きく、帯が重なり合っている事実をありのままに可視化。
            </p>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={quintileBarData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />
                <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                  domain={[-10, 10]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded-xl shadow-2xl text-xs space-y-1">
                          <p className="font-bold text-white">{d.name}</p>
                          <p className="text-indigo-300">75%タイル: <strong>{d.p75 > 0 ? '+' : ''}{d.p75.toFixed(2)}%</strong></p>
                          <p className="text-amber-400">中央値 (50%): <strong>{d.median > 0 ? '+' : ''}{d.median.toFixed(2)}%</strong></p>
                          <p className="text-indigo-300">25%タイル: <strong>{d.p25 > 0 ? '+' : ''}{d.p25.toFixed(2)}%</strong></p>
                          <p className="text-gray-400">IQR (四分位範囲): {(d.p75 - d.p25).toFixed(2)}%</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1.5} />
                <Area type="monotone" dataKey="p75" stroke="#818cf8" fill="#818cf8" fillOpacity={0.15} name="75パーセンタイル" />
                <Area type="monotone" dataKey="p25" stroke="#818cf8" fill="#090d16" fillOpacity={1.0} name="25パーセンタイル" />
                <Line type="monotone" dataKey="median" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 5, fill: '#f59e0b' }} name="中央値" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1f293d] flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-400" />
              中央値（黄線）は全分位で -1.0% 〜 -0.2% の狭い範囲に位置し、25-75%帯は各分位で大きく重複しています。
            </span>
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* セクション 3: Q1 vs Q5 リターン分布ヒストグラム (1%ビン) */}
        {/* ------------------------------------------------------------- */}
        <section className="bg-[#111827]/80 border border-[#1f293d] rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-400" />
              <h2 className="text-base md:text-lg font-bold text-white">
                3. Q1 (最下位) vs Q5 (最上位) リターン分布ヒストグラム
              </h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              ビン幅 1.0%（-20% 〜 +20%）。最上位サプライズ（Q5）と最下位サプライズ（Q1）の超過リターン度数分布の比較。
            </p>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.histogram_q1_q5} margin={{ top: 20, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />
                <XAxis dataKey="bin" stroke="#9ca3af" tick={{ fontSize: 10 }} interval={3} />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} label={{ value: '銘柄数', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded-xl shadow-2xl text-xs space-y-1">
                          <p className="font-bold text-white">リターン階級: {d.bin}</p>
                          <p className="text-emerald-400">Q5 (最上位サプライズ): <strong>{d.Q5_count} 銘柄</strong> ({d.Q5_pct.toFixed(1)}%)</p>
                          <p className="text-rose-400">Q1 (最下位サプライズ): <strong>{d.Q1_count} 銘柄</strong> ({d.Q1_pct.toFixed(1)}%)</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine x="0%" stroke="#6b7280" strokeDasharray="3 3" />
                <Bar dataKey="Q5_count" name="Q5 (最上位)" fill="#10b981" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                <Bar dataKey="Q1_count" name="Q1 (最下位)" fill="#f43f5e" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1f293d] flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> Q5 (最上位サプライズ)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500 inline-block"></span> Q1 (最下位サプライズ)</span>
            </div>
            <span>※ Q5は +5% 以上の右裾にロングテールが存在し、これが平均押し上げに寄与。</span>
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* セクション 4: 日次 Rank IC (棒グラフ) */}
        {/* ------------------------------------------------------------- */}
        <section className="bg-[#111827]/80 border border-[#1f293d] rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base md:text-lg font-bold text-white">
                  4. 日次 Rank IC 時系列推移 (T=23日)
                </h2>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                各開示日における営業利益サプライズと5営業日超過リターンのスピアマン順位相関係数。
              </p>
            </div>

            {/* サマリ行バッジ */}
            <div className="px-4 py-2 bg-[#090d16] border border-[#1f293d] rounded-xl flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>{data.daily_rank_ic.total_days}日中 {data.daily_rank_ic.positive_days}日 がプラス ({((data.daily_rank_ic.positive_days / data.daily_rank_ic.total_days) * 100).toFixed(1)}%)</span>
              </div>
              <span className="text-gray-500">｜</span>
              <span className="text-gray-300">平均 Rank IC: <strong className="text-white font-mono">{data.daily_rank_ic.mean_rank_ic > 0 ? '+' : ''}{data.daily_rank_ic.mean_rank_ic.toFixed(4)}</strong></span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily_rank_ic.series} margin={{ top: 15, right: 15, left: 10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />
                <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 10 }} />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
                  domain={[-0.4, 0.4]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded-xl shadow-2xl text-xs space-y-1">
                          <p className="font-bold text-white">{d.date} ({d.period})</p>
                          <p className="text-gray-300">開示銘柄数: <strong>{d.n_stocks} 銘柄</strong></p>
                          <p className={d.rank_ic >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            Rank IC: {d.rank_ic > 0 ? '+' : ''}{d.rank_ic.toFixed(4)}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1.5} />
                <Bar dataKey="rank_ic" name="Rank IC" radius={[3, 3, 0, 0]}>
                  {data.daily_rank_ic.series.map((entry, index) => (
                    <Cell key={`ic-cell-${index}`} fill={entry.rank_ic >= 0 ? '#10b981' : '#f43f5e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* セクション 5: 銘柄テーブル (日別予測 vs 事後実績) */}
        {/* ------------------------------------------------------------- */}
        <section className="bg-[#111827]/80 border border-[#1f293d] rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <TableIcon className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base md:text-lg font-bold text-white">
                  5. 開示日別 銘柄予測スコア ＆ 事後超過リターン一覧
                </h2>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                各開示日における予測サプライズ順位と、事後5営業日の実際の超過リターン。
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* 日付セレクタ */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="date-select" className="text-xs text-gray-400">開示日:</label>
                <select
                  id="date-select"
                  aria-label="開示日セレクタ"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-[#090d16] border border-[#1f293d] text-xs text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500 font-mono font-medium"
                >
                  {data.metadata.dates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* 分位フィルタ */}
              <select
                aria-label="分位フィルタ"
                value={tableFilterQuintile}
                onChange={(e) => setTableFilterQuintile(e.target.value)}
                className="bg-[#090d16] border border-[#1f293d] text-xs text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">すべての分位</option>
                <option value="Q5">Q5 (最上位)</option>
                <option value="Q4">Q4 (上位)</option>
                <option value="Q3">Q3 (中位)</option>
                <option value="Q2">Q2 (下位)</option>
                <option value="Q1">Q1 (最下位)</option>
              </select>

              {/* 検索バー */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="銘柄名・コード検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-[#090d16] border border-[#1f293d] text-xs text-gray-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-emerald-500 w-36 sm:w-48"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto custom-scrollbar border border-[#1f293d] rounded-xl">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="bg-[#0d131f] text-gray-400 uppercase font-semibold border-b border-[#1f293d]">
                <tr>
                  <th className="px-4 py-3 w-16">順位</th>
                  <th className="px-4 py-3">銘柄コード / 企業名</th>
                  <th className="px-4 py-3">業種 / 種別</th>
                  <th className="px-4 py-3 text-right">サプライズ値</th>
                  <th className="px-4 py-3 text-center">分位</th>
                  <th className="px-4 py-3 text-right text-emerald-400 font-bold bg-emerald-950/20">
                    事後 実際の超過リターン
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f293d] bg-[#111827]/40 font-mono">
                {currentStocks.length > 0 ? (
                  currentStocks.map((s) => {
                    const isPosSurp = s.surprise_pct > 0;
                    const isPosRet = s.excess_return_pct > 0;
                    return (
                      <tr key={s.code} className="hover:bg-[#1e293b]/60 transition-colors">
                        <td className="px-4 py-3 font-bold text-gray-400">#{s.rank}</td>
                        <td className="px-4 py-3 font-sans">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{s.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#090d16] text-gray-400 border border-[#1f293d] font-mono">{s.code}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-sans text-gray-400">
                          <div>{s.sector}</div>
                          <div className="text-[10px] text-gray-400">{s.doc_type}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          <span className={isPosSurp ? 'text-emerald-400' : 'text-rose-400'}>
                            {isPosSurp ? '+' : ''}{s.surprise_pct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-sans">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            s.quintile === 'Q5' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
                            s.quintile === 'Q1' ? 'bg-rose-950 text-rose-300 border-rose-800' :
                            'bg-gray-800 text-gray-300 border-gray-700'
                          }`}>
                            {s.quintile}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-bold bg-emerald-950/10 ${isPosRet ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isPosRet ? '+' : ''}{s.excess_return_pct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400 font-sans">
                      該当する銘柄が見つかりませんでした。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-right text-[11px] text-gray-400">
            表示中: {currentStocks.length} 件 （開示日: {selectedDate}）
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 text-center text-xs text-gray-400 border-t border-[#1f293d] mt-12">
        <p>Kabu-AI Quantitative Research Platform ｜ Developed for Local Research & Validation</p>
      </footer>
    </div>
  );
}
