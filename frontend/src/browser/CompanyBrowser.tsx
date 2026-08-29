import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search, X, ChevronRight, ArrowLeft, Building2, Layers, BarChart3,
  ExternalLink, Landmark, FileText, TrendingUp, Activity, Boxes,
} from 'lucide-react';
import './apple.css';
import type {
  BrowserIndex, Detail, SectorFile, Summary,
} from './types';
import { fetchJSON, loadIndex } from './cache';

const BASE = `${import.meta.env.BASE_URL}data/browser`;

/* 業種ごとの色。HIG のシステムカラーから、隣り合う業種が似ないよう並べてある */
const SECTOR_COLORS = [
  'var(--blue)', 'var(--green)', 'var(--orange)', 'var(--indigo)',
  'var(--teal)', 'var(--pink)', 'var(--yellow)', 'var(--red)',
  'var(--gray)',
];
const sectorColor = (code: string) => {
  const n = parseInt(code, 10);
  return SECTOR_COLORS[(Number.isFinite(n) ? n : code.length) % SECTOR_COLORS.length];
};

/* ---------- 表示整形 ---------- */
const oku = (v: number | null | undefined) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(a / 1e8 >= 100 ? 0 : 1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
};
const pct = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(d)}%`;
const signedPct = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const toneOf = (v: number | null | undefined) =>
  v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';

/* ---------- 小さな部品 ---------- */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ap-segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className="ap-seg"
          data-on={value === o.value}
          disabled={o.disabled}
          onClick={() => !o.disabled && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="ap-stat">
      <div className="ap-caption" style={{ marginBottom: 5 }}>{label}</div>
      <div className={`ap-stat-value ap-num ${tone || ''}`}>{value}</div>
      {sub && <div className="ap-footnote" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ---------- 概観 ---------- */
function Overview({ index, onPick }: { index: BrowserIndex; onPick: (s17: string) => void }) {
  const m = index.meta;
  return (
    <div className="ap-in">
      <h1 className="ap-large-title">企業ブラウザ</h1>
      <p className="ap-footnote" style={{ marginTop: 4, marginBottom: 20 }}>
        東証上場 {m.company_count.toLocaleString()} 社。J-Quants の決算と EDINET の保有関係を
        ローカルに取り込んで配信しています（{m.generated_at} 時点）。
      </p>

      <div className="ap-stats" style={{ marginBottom: 26 }}>
        <Stat label="上場企業" value={m.company_count.toLocaleString()} sub="ETF・投信を除く" />
        <Stat label="決算開示" value={m.filing_count.toLocaleString()} sub="J-Quants 財務サマリ" />
        <Stat label="検証イベント" value={m.surprise_count.toLocaleString()} sub="サプライズ測定済み" />
        <Stat
          label="政策保有エッジ"
          value={m.holding_count.toLocaleString()}
          sub={`${m.holding_companies.toLocaleString()} 社ぶん取込済`}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
        <h2 className="ap-title2">業種</h2>
        <span className="ap-footnote">17業種。選ぶと中分類と銘柄に降りられます</span>
      </div>

      <div className="ap-tiles">
        {index.sectors.map((s, i) => {
          const margin = s.median_op_margin ?? 0;
          const width = Math.max(3, Math.min(100, margin * 100 * 6));
          return (
            <div
              key={s.code}
              className="ap-tile"
              style={{ animationDelay: `${Math.min(i * 22, 300)}ms` }}
              onClick={() => onPick(s.code)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
                <span className="ap-dot" style={{ background: sectorColor(s.code) }} />
                <span className="ap-title3">{s.name}</span>
                <ChevronRight size={13} className="ter" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 10 }}>
                <span className="ap-num" style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>
                  {s.count}
                </span>
                <span className="ap-footnote">社</span>
                {s.measured > 0 && (
                  <span className="ap-badge" style={{ marginLeft: 'auto' }}
                    title="決算サプライズを測定できた銘柄数（2024年秋〜2025年春の開示が対象）">
                    検証 {s.measured}社
                  </span>
                )}
              </div>
              <div className="ap-tile-bar">
                <i style={{ width: `${width}%`, background: sectorColor(s.code) }} />
              </div>
              <div className="ap-footnote" style={{ marginTop: 6 }}>
                営業利益率の中央値 {pct(s.median_op_margin)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 銘柄一覧 ---------- */
type ColMode = 'basic' | 'financial' | 'progress';

type Column = {
  key: keyof Summary;
  label: string;
  fmt: (r: Summary) => string;
  tone?: (r: Summary) => string;
};

const COLUMNS: Record<ColMode, Column[]> = {
  basic: [
    { key: 'market', label: '市場', fmt: (r) => r.market || '—' },
    { key: 'scale', label: '規模', fmt: (r) => (r.scale && r.scale !== '-' ? r.scale : '—') },
    { key: 'sales', label: '売上高', fmt: (r) => oku(r.sales) },
    { key: 'op', label: '営業利益', fmt: (r) => oku(r.op) },
  ],
  financial: [
    { key: 'sales', label: '売上高', fmt: (r) => oku(r.sales) },
    { key: 'op', label: '営業利益', fmt: (r) => oku(r.op) },
    { key: 'np', label: '純利益', fmt: (r) => oku(r.np) },
    { key: 'op_margin', label: '営業利益率', fmt: (r) => pct(r.op_margin) },
    { key: 'op_progress', label: '通期進捗', fmt: (r) => pct(r.op_progress, 0) },
  ],
  progress: [
    { key: 'progress', label: '通期進捗(予想比)', fmt: (r) => pct(r.progress, 0) },
    {
      key: 'pctile',
      label: '同日順位',
      fmt: (r) => (r.pctile == null ? '—' : `上位 ${(100 - r.pctile * 100).toFixed(0)}%`),
      // 水準ではなく順位で色を付ける。四半期ごとに水準が違うので水準では比較できない
      tone: (r) => (r.pctile == null ? '' : r.pctile > 0.5 ? 'pos' : r.pctile < 0.5 ? 'neg' : ''),
    },
    { key: 'excess', label: '5日超過リターン', fmt: (r) => signedPct(r.excess, 2), tone: (r) => toneOf(r.excess) },
    { key: 'n_holdings', label: '政策保有', fmt: (r) => (r.n_holdings ? `${r.n_holdings}社` : '—') },
    { key: 'n_held_by', label: '被保有', fmt: (r) => (r.n_held_by ? `${r.n_held_by}社` : '—') },
  ],
};

function CompanyTable({ rows, cols, onPick }: {
  rows: Summary[]; cols: ColMode; onPick: (code: string) => void;
}) {
  const [sortKey, setSortKey] = useState<keyof Summary>('sales');
  const [desc, setDesc] = useState(true);
  const columns = COLUMNS[cols];

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
      return desc
        ? String(bv).localeCompare(String(av), 'ja')
        : String(av).localeCompare(String(bv), 'ja');
    });
    return arr;
  }, [rows, sortKey, desc]);

  const click = (k: keyof Summary) => {
    if (k === sortKey) setDesc((d) => !d);
    else { setSortKey(k); setDesc(true); }
  };

  return (
    <div className="ap-card">
      <table className="ap-table">
        <thead>
          <tr>
            <th data-sorted={sortKey === 'name'} onClick={() => click('name')}>
              銘柄 <span className="ter">({sorted.length})</span>
            </th>
            {columns.map((c) => (
              <th key={String(c.key)} data-sorted={sortKey === c.key} onClick={() => click(c.key)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.code} onClick={() => onPick(r.code)}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="ap-num ter" style={{ fontSize: 11, width: 40 }}>{r.code}</span>
                  <span className="ap-headline">{r.name}</span>
                  <span className="ap-footnote" style={{ marginLeft: 2 }}>{r.s33}</span>
                </div>
              </td>
              {columns.map((c) => {
                return (
                  <td key={String(c.key)} className={`ap-num ${c.tone ? c.tone(r) : ''}`}>
                    {c.fmt(r)}
                  </td>
                );
              })}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length + 1} className="ap-footnote" style={{ padding: 26, textAlign: 'center' }}>
              該当する銘柄がありません
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- 企業詳細 ---------- */
function CompanyDetail({ d, onPick }: { d: Detail; onPick: (code: string) => void }) {
  return (
    <div className="ap-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="ap-large-title">{d.name}</h1>
          <div className="ap-footnote" style={{ marginTop: 3 }}>
            {d.formal_name || d.name_en || ''}
          </div>
        </div>
        <span className="ap-num ter" style={{ fontSize: 13, marginLeft: 'auto', paddingTop: 6 }}>
          {d.code}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        <span className="ap-badge ap-badge-blue">{d.s17}</span>
        <span className="ap-badge">{d.s33}</span>
        {d.market && <span className="ap-badge">{d.market}</span>}
        {d.scale && d.scale !== '-' && <span className="ap-badge">{d.scale}</span>}
        {d.fiscal_year_end && <span className="ap-badge">決算 {d.fiscal_year_end}</span>}
        {d.margin_type && <span className="ap-badge">{d.margin_type}</span>}
      </div>

      <div className="ap-stats" style={{ marginBottom: 22 }}>
        <Stat label="売上高" value={oku(d.sales)} sub={d.period ? `${d.period} 累計` : undefined} />
        <Stat label="営業利益" value={oku(d.op)} sub={`利益率 ${pct(d.op_margin)}`} />
        <Stat label="純利益" value={oku(d.np)} />
        <Stat label="自己資本比率" value={pct(d.equity_ratio, 1)} />
        <Stat
          label="通期進捗（会社予想比）"
          value={pct(d.progress, 0)}
          tone={d.pctile == null ? '' : d.pctile > 0.5 ? 'pos' : 'neg'}
          sub={d.pctile == null ? '検証データなし'
            : `${d.surprises[0]?.date ?? ''} 開示 · 同日内で上位 ${(100 - d.pctile * 100).toFixed(0)}%`}
        />
      </div>

      {d.financials.length > 0 && (
        <Card icon={<BarChart3 size={13} />} title="決算の推移" note={`${d.financials.length} 期`}>
          <table className="ap-table">
            <thead>
              <tr>
                <th>開示日</th><th>期</th><th>売上高</th><th>営業利益</th>
                <th>純利益</th><th>EPS</th><th>通期営業利益(会社予想)</th>
              </tr>
            </thead>
            <tbody>
              {d.financials.map((f, i) => (
                <tr key={i}>
                  <td className="ap-num">{f.date}</td>
                  <td>{f.period}</td>
                  <td className="ap-num">{oku(f.sales)}</td>
                  <td className="ap-num">{oku(f.op)}</td>
                  <td className="ap-num">{oku(f.np)}</td>
                  <td className="ap-num">{f.eps != null ? f.eps.toFixed(2) : '—'}</td>
                  <td className="ap-num sec">{oku(f.f_op)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {d.surprises.length > 0 && (
        <Card icon={<TrendingUp size={13} />} title="通期進捗と株価反応"
          note="進捗率の水準は四半期で決まるため、比較できるのは同日順位のほう">
          <table className="ap-table">
            <thead>
              <tr>
                <th>開示日</th><th>期</th><th>通期進捗(予想比)</th>
                <th>同日順位</th><th>5日超過リターン</th>
              </tr>
            </thead>
            <tbody>
              {d.surprises.map((s, i) => (
                <tr key={i}>
                  <td className="ap-num">{s.date}</td>
                  <td>{s.period}</td>
                  <td className="ap-num">{pct(s.progress, 0)}</td>
                  <td className={`ap-num ${s.pctile == null ? '' : s.pctile > 0.5 ? 'pos' : 'neg'}`}>
                    {s.pctile == null ? '—'
                      : `上位 ${(100 - s.pctile * 100).toFixed(0)}% / ${s.day_n}社`}
                  </td>
                  <td className={`ap-num ${toneOf(s.excess)}`}>{signedPct(s.excess, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {d.holdings.length > 0 && (
        <Card icon={<Boxes size={13} />} title="政策保有株"
          note={`有報「特定投資株式の明細」より ${d.holdings.length} 銘柄`}>
          {d.holdings.map((h, i) => (
            <div key={i} className="ap-row" data-tap={!!h.code}
              onClick={() => h.code && onPick(h.code)}>
              <span className="ap-num ter" style={{ fontSize: 11, width: 40 }}>{h.code || '—'}</span>
              <span className="ap-headline" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {h.name || h.raw}
              </span>
              {!h.code && <span className="ap-badge" title="上場企業に名寄せできなかった">未名寄せ</span>}
              <span className="ap-num sec" style={{ marginLeft: 'auto', fontSize: 11 }}>
                {h.shares != null ? `${h.shares.toLocaleString()} 株` : ''}
              </span>
              <span className="ap-num" style={{ width: 76, textAlign: 'right' }}>{oku(h.value)}</span>
              {h.code && <ChevronRight size={13} className="ter" />}
            </div>
          ))}
        </Card>
      )}

      {d.held_by.length > 0 && (
        <Card icon={<Landmark size={13} />} title="この会社を政策保有している企業"
          note={`${d.held_by.length} 社の有報に記載`}>
          {d.held_by.map((h, i) => (
            <div key={i} className="ap-row" data-tap="true" onClick={() => onPick(h.code)}>
              <span className="ap-num ter" style={{ fontSize: 11, width: 40 }}>{h.code}</span>
              <span className="ap-headline">{h.name}</span>
              <span className="ap-num" style={{ marginLeft: 'auto', width: 76, textAlign: 'right' }}>
                {oku(h.value)}
              </span>
              <ChevronRight size={13} className="ter" />
            </div>
          ))}
        </Card>
      )}

      {d.shareholders.length > 0 && (
        <Card icon={<Landmark size={13} />} title="大株主"
          note="信託口・カストディ等を除いた上位">
          {d.shareholders.map((s, i) => (
            <div key={i} className="ap-row" data-tap={!!s.code}
              onClick={() => s.code && onPick(s.code)}>
              <span className="ap-num ter" style={{ fontSize: 11, width: 22 }}>{s.rank ?? '—'}</span>
              <span className="ap-body">{s.name}</span>
              {s.code && (
                <>
                  <span className="ap-badge ap-badge-blue" style={{ marginLeft: 'auto' }}>上場</span>
                  <ChevronRight size={13} className="ter" />
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      {d.disclosures.length > 0 && (
        <Card icon={<FileText size={13} />} title="適時開示" note="TDnet">
          {d.disclosures.map((x, i) => (
            <a key={i} className="ap-row" data-tap="true" href={x.url} target="_blank" rel="noreferrer"
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="ap-num ter" style={{ fontSize: 11, width: 62 }}>{x.date}</span>
              <span className="ap-body" style={{ minWidth: 0 }}>{x.title}</span>
              <ExternalLink size={12} className="ter" style={{ marginLeft: 'auto', flex: '0 0 12px' }} />
            </a>
          ))}
        </Card>
      )}

      <div className="ap-footnote" style={{ marginTop: 18, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {d.edinet_code && <span>EDINET {d.edinet_code}</span>}
        {d.corp_number && <span>法人番号 {d.corp_number}</span>}
        {d.capital != null && <span>資本金 {oku(d.capital * 1e6)}円</span>}
      </div>
    </div>
  );
}

function Card({ icon, title, note, children }: {
  icon: React.ReactNode; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="ap-card" style={{ marginBottom: 16 }}>
      <div className="ap-card-head">
        <span className="sec" style={{ display: 'flex' }}>{icon}</span>
        <span className="ap-title3">{title}</span>
        {note && <span className="ap-footnote" style={{ marginLeft: 'auto' }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/* ---------- 本体 ---------- */
export default function CompanyBrowser({ onOpenDashboard, onBackToGraph }: {
  onOpenDashboard?: () => void;
  onBackToGraph?: () => void;
}) {
  const [index, setIndex] = useState<BrowserIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s17, setS17] = useState<string | null>(null);
  const [s33, setS33] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [cols, setCols] = useState<ColMode>('basic');
  const [query, setQuery] = useState('');

  const sectorCache = useRef(new Map<string, SectorFile>());
  const shardCache = useRef(new Map<string, Record<string, Detail>>());
  const [sector, setSector] = useState<SectorFile | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadIndex<BrowserIndex>(`${BASE}/index.json`)
      .then(setIndex)
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const openSector = useCallback(async (c: string) => {
    setCode(null); setDetail(null); setS33(null); setS17(c); setQuery('');
    const hit = sectorCache.current.get(c);
    if (hit) { setSector(hit); return; }
    const j = await fetchJSON<SectorFile>(`${BASE}/sectors/${c}.json`);
    sectorCache.current.set(c, j);
    setSector(j);
  }, []);

  const openCompany = useCallback(async (c: string) => {
    const prefix = c.slice(0, 2);
    let shard = shardCache.current.get(prefix);
    if (!shard) {
      shard = await fetchJSON<Record<string, Detail>>(`${BASE}/companies/${prefix}.json`);
      shardCache.current.set(prefix, shard!);
    }
    const d = shard![c];
    if (d) { setDetail(d); setCode(c); }
  }, []);

  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [s17, s33, code]);

  const results = useMemo(() => {
    if (!index || query.trim().length === 0) return null;
    const q = query.trim().toLowerCase();
    return index.nodes
      .filter(([c, n, , s33n]) =>
        c.startsWith(q) || n.toLowerCase().includes(q) || s33n.includes(q))
      .slice(0, 60);
  }, [index, query]);

  const rows = useMemo(() => {
    if (!sector) return [];
    return s33 ? sector.companies.filter((c) => c.s33 === s33) : sector.companies;
  }, [sector, s33]);

  const level: 'overview' | 'sector' | 'company' = code ? 'company' : s17 ? 'sector' : 'overview';

  if (error) {
    return (
      <div className="ap" style={{ padding: 40 }}>
        <h1 className="ap-title1">データを読み込めません</h1>
        <p className="ap-footnote" style={{ marginTop: 8 }}>
          {error} — <code>python scripts/export_browser_json.py</code> を実行して
          <code>frontend/public/data/browser/</code> を作ってください。
        </p>
      </div>
    );
  }

  if (!index) {
    return (
      <div className="ap" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="ap-footnote">読み込み中…</div>
      </div>
    );
  }

  return (
    <div className="ap ap-shell">
      {/* サイドバー */}
      <aside className="ap-sidebar">
        <div className="ap-sidebar-head">
          <div className="ap-title2">Kabu-AI</div>
          <div className="ap-caption" style={{ marginTop: 1 }}>企業ブラウザ</div>
        </div>
        <div className="ap-sidebar-scroll">
          {onBackToGraph && (
            <div className="ap-srow" onClick={onBackToGraph}>
              <Search size={13} /> 検索・関係グラフ
            </div>
          )}
          <div className="ap-srow" data-active={level === 'overview'}
            onClick={() => { setS17(null); setS33(null); setCode(null); setQuery(''); }}>
            <Building2 size={13} /> 概観
          </div>

          <div className="ap-sidebar-label">業種（17分類）</div>
          {index.sectors.map((s) => (
            <div key={s.code} className="ap-srow" data-active={s17 === s.code && !code}
              onClick={() => openSector(s.code)}>
              <span className="ap-dot" style={{ background: sectorColor(s.code) }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <span className="ap-srow-count ap-num">{s.count}</span>
            </div>
          ))}

          {onOpenDashboard && (
            <>
              <div className="ap-sidebar-label">検証</div>
              <div className="ap-srow" onClick={onOpenDashboard}>
                <Activity size={13} /> クオンツ検証ダッシュボード
              </div>
            </>
          )}
        </div>
      </aside>

      {/* 本体 */}
      <div className="ap-main">
        <div className="ap-toolbar">
          {level !== 'overview' && (
            <button className="ap-btn ap-btn-plain" style={{ marginLeft: -6 }}
              onClick={() => {
                if (code) { setCode(null); setDetail(null); }
                else if (s33) setS33(null);
                else { setS17(null); setSector(null); }
              }}>
              <ArrowLeft size={14} />
            </button>
          )}

          <div className="ap-crumbs">
            <span className="ap-crumb" onClick={() => { setS17(null); setS33(null); setCode(null); }}>
              概観
            </span>
            {sector && (
              <>
                <ChevronRight size={11} className="ap-crumb-sep" />
                <span className={code || s33 ? 'ap-crumb' : 'ap-crumb-now'}
                  onClick={() => { setCode(null); setDetail(null); setS33(null); }}>
                  {sector.name}
                </span>
              </>
            )}
            {s33 && (
              <>
                <ChevronRight size={11} className="ap-crumb-sep" />
                <span className={code ? 'ap-crumb' : 'ap-crumb-now'}
                  onClick={() => { setCode(null); setDetail(null); }}>{s33}</span>
              </>
            )}
            {detail && (
              <>
                <ChevronRight size={11} className="ap-crumb-sep" />
                <span className="ap-crumb-now">{detail.name}</span>
              </>
            )}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {level === 'sector' && (
              <Segmented<ColMode>
                value={cols}
                onChange={setCols}
                options={[
                  { value: 'basic', label: '概要' },
                  { value: 'financial', label: '財務' },
                  { value: 'progress', label: '進捗・株価' },
                ]}
              />
            )}
            <div className="ap-search">
              <Search size={13} className="ter" />
              <input
                value={query}
                placeholder="銘柄名・コードで検索"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && <X size={13} className="ter" onClick={() => setQuery('')} style={{ cursor: 'default' }} />}
            </div>
          </div>
        </div>

        <div className="ap-content" ref={contentRef}>
          <div className="ap-content-inner">
            {results ? (
              <div className="ap-in">
                <h2 className="ap-title1" style={{ marginBottom: 12 }}>
                  「{query}」の検索結果 <span className="ter ap-num" style={{ fontSize: 15 }}>{results.length}</span>
                </h2>
                <div className="ap-card">
                  {results.map(([c, n, , s33n]) => (
                    <div key={c} className="ap-row" data-tap="true" onClick={() => { setQuery(''); openCompany(c); }}>
                      <span className="ap-num ter" style={{ fontSize: 11, width: 40 }}>{c}</span>
                      <span className="ap-headline">{n}</span>
                      <span className="ap-footnote">{s33n}</span>
                      <ChevronRight size={13} className="ter" style={{ marginLeft: 'auto' }} />
                    </div>
                  ))}
                  {results.length === 0 && (
                    <div className="ap-row"><span className="ap-footnote">該当なし</span></div>
                  )}
                </div>
              </div>
            ) : detail ? (
              <CompanyDetail d={detail} onPick={openCompany} />
            ) : sector ? (
              <div className="ap-in">
                <h1 className="ap-large-title" style={{ marginBottom: 3 }}>{sector.name}</h1>
                <p className="ap-footnote" style={{ marginBottom: 16 }}>
                  {sector.companies.length} 社 · 中分類 {sector.subsectors.length} 区分
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  <button className="ap-btn" onClick={() => setS33(null)}
                    style={s33 === null ? { background: 'var(--blue)', color: '#fff' } : undefined}>
                    <Layers size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    すべて {sector.companies.length}
                  </button>
                  {sector.subsectors.map((sub) => (
                    <button key={sub.name} className="ap-btn" onClick={() => setS33(sub.name)}
                      style={s33 === sub.name ? { background: 'var(--blue)', color: '#fff' } : undefined}>
                      {sub.name} <span className="ap-num" style={{ opacity: 0.6 }}>{sub.count}</span>
                    </button>
                  ))}
                </div>

                <CompanyTable rows={rows} cols={cols} onPick={openCompany} />
              </div>
            ) : (
              <Overview index={index} onPick={openSector} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
