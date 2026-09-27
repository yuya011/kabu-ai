/* 業種と企業。

   2段で降りる。業種の一覧（カードと分布図）→ 業種の中の企業表。
   どちらの段でも上場市場（プライム・スタンダード・グロース・その他）で絞れる。
   市場と中分類の絞り込みは URL に残すので、戻るで絞り込みごと戻る。 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Tooltip, Spinner, ToggleButton, TabList, Tab, Breadcrumb, BreadcrumbItem,
  BreadcrumbButton, BreadcrumbDivider, SearchBox,
  Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
} from '@fluentui/react-components';
import {
  Organization20Regular, Grid20Regular, DataBarHorizontal20Regular,
} from '@fluentui/react-icons';
import { useData, loadSector } from '../data';
import { go, href } from '../router';
import type { SectorFile, SectorTile, Summary } from '../browser/types';
import { SectorBars } from '../ui/charts';
import { Favi, oku, pct, signedPct } from '../ui/common';
import { MARKETS, isMarketKey, marketColor, marketKey, marketLabel, type MarketKey } from '../ui/market';
import { sectorVar } from '../theme';

export default function Sectors({ s17, s33, mkt }: { s17: string | null; s33: string | null; mkt: string | null }) {
  const market = isMarketKey(mkt) ? mkt : null;
  return s17 ? <SectorTable s17={s17} s33={s33} market={market} /> : <SectorOverview market={market} />;
}

/* ---------------- 市場の帯 ---------------- */

type Counts = Record<MarketKey, number>;
const zero = (): Counts => ({ prime: 0, standard: 0, growth: 0, other: 0 });

/** 市場ごとの社数を帯と凡例で見せ、そのまま絞り込みに使う */
function MarketStrip({ counts, value, onChange }: {
  counts: Counts; value: MarketKey | null; onChange: (m: MarketKey | null) => void;
}) {
  const total = MARKETS.reduce((n, m) => n + counts[m.key], 0);
  // 市場の分かるデータが無ければ出さない（0 を並べても意味が通らない）
  if (!total) return null;
  return (
    <div className="k-mkt">
      <div className="k-mkt-bar" aria-hidden="true">
        {MARKETS.filter((m) => counts[m.key]).map((m) => (
          <span key={m.key} style={{ flexGrow: counts[m.key], background: m.color }}
            data-dim={value !== null && value !== m.key}
            onClick={() => onChange(value === m.key ? null : m.key)} />
        ))}
      </div>
      <div className="k-mkt-keys" role="radiogroup" aria-label="上場市場で絞り込む">
        <button role="radio" aria-checked={value === null} className="k-mkt-key"
          onClick={() => onChange(null)}>
          <span className="k-mkt-name">すべて</span>
          <span className="k-mkt-n k-num">{total.toLocaleString()}</span>
        </button>
        {MARKETS.map((m) => (
          <button key={m.key} role="radio" aria-checked={value === m.key} className="k-mkt-key"
            disabled={!counts[m.key]}
            title={m.key === 'other' ? '名証・福証・札証のみ、TOKYO PRO Market、市場の読めない会社' : undefined}
            onClick={() => onChange(value === m.key ? null : m.key)}>
            <span className="k-mkt-name"><i style={{ background: m.color }} />{m.label}</span>
            <span className="k-mkt-n k-num">{counts[m.key].toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 業種の中の市場の内訳。細い積み上げの帯 */
function MarketMix({ counts, focus }: { counts: Counts; focus: MarketKey | null }) {
  if (!MARKETS.some((m) => counts[m.key])) return null;
  return (
    <span className="k-mix" aria-hidden="true">
      {MARKETS.filter((m) => counts[m.key]).map((m) => (
        <i key={m.key} style={{ flexGrow: counts[m.key], background: m.color }}
          data-dim={focus !== null && focus !== m.key} />
      ))}
    </span>
  );
}

/* ---------------- 業種の一覧 ---------------- */

type SortKey = 'count' | 'margin' | 'name';

function tileCounts(s: SectorTile): Counts {
  const c = zero();
  for (const m of MARKETS) c[m.key] = s.by_market?.[m.key]?.[0] ?? 0;
  return c;
}

function SectorOverview({ market: asked }: { market: MarketKey | null }) {
  const { data } = useData();
  const idx = data!.index;
  const [view, setView] = useState<'cards' | 'chart'>('cards');
  const [sort, setSort] = useState<SortKey>('count');

  const setMarket = (m: MarketKey | null) => go(href.sectors(null, null, m), { replace: true });

  const totals = useMemo(() => {
    const t = zero();
    for (const s of idx.sectors) {
      const c = tileCounts(s);
      for (const m of MARKETS) t[m.key] += c[m.key];
    }
    return t;
  }, [idx.sectors]);
  // 市場の分かるデータが無い索引では絞り込みを効かせない（全業種が消えてしまう）
  const market = MARKETS.some((m) => totals[m.key]) ? asked : null;

  /* 市場で絞ったときは、社数と利益率をその市場のぶんに差し替える */
  const tiles = useMemo(() => {
    const rows = idx.sectors
      .map((s) => {
        const mix = tileCounts(s);
        const hit = market ? s.by_market?.[market] : null;
        return {
          ...s, mix,
          count: market ? hit?.[0] ?? 0 : s.count,
          median_op_margin: market ? hit?.[1] ?? null : s.median_op_margin,
        };
      })
      .filter((s) => s.count > 0);
    rows.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name, 'ja')
        : sort === 'margin' ? (b.median_op_margin ?? -Infinity) - (a.median_op_margin ?? -Infinity)
          : b.count - a.count);
    return rows;
  }, [idx.sectors, market, sort]);

  const shown = tiles.reduce((n, s) => n + s.count, 0);
  const label = MARKETS.find((m) => m.key === market)?.label;

  return (
    <div className="k-page">
      <header className="k-pagehead">
        <div>
          <h1 className="k-title">業種と企業</h1>
          <p className="k-lead">
            {label ?? '上場'} {shown.toLocaleString()} 社 · {tiles.length} 業種
          </p>
        </div>
      </header>

      <MarketStrip counts={totals} value={market} onChange={setMarket} />

      <div className="k-sec-tools">
        <div className="k-seg" role="radiogroup" aria-label="並び順">
          {([['count', '社数'], ['margin', '利益率'], ['name', '名前']] as const).map(([k, l]) => (
            <ToggleButton key={k} size="small" appearance="subtle" checked={sort === k}
              role="radio" aria-checked={sort === k} onClick={() => setSort(k)}>{l}</ToggleButton>
          ))}
        </div>
        <TabList size="small" selectedValue={view} onTabSelect={(_, d) => setView(d.value as 'cards' | 'chart')}
          aria-label="表示の切り替え">
          <Tab value="cards" icon={<Grid20Regular />}>カード</Tab>
          <Tab value="chart" icon={<DataBarHorizontal20Regular />}>分布図</Tab>
        </TabList>
      </div>

      {view === 'chart' ? (
        <Card className="k-card">
          <SectorBars sectors={tiles} onPick={(c) => go(href.sectors(c, null, market))} />
        </Card>
      ) : (
        <div className="k-secs">
          {tiles.map((s, i) => (
            <a key={s.code} className="k-sec" href={href.sectors(s.code, null, market)}
              style={{ animationDelay: `${Math.min(i * 18, 300)}ms` }}>
              <span className="k-sec-name">
                <i style={{ background: sectorVar(s.code) }} />{s.name}
              </span>
              <span className="k-sec-figs">
                <span><b className="k-num">{s.count.toLocaleString()}</b> 社</span>
                <span className="k-sec-margin">
                  <span className="k-caption">利益率</span>
                  <span className={`k-num ${(s.median_op_margin ?? 0) < 0 ? 'k-neg' : ''}`}>{pct(s.median_op_margin)}</span>
                </span>
              </span>
              <MarketMix counts={s.mix} focus={market} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- 業種の中の企業表 ---------------- */

type ColMode = 'basic' | 'financial' | 'capital';

interface Column {
  key: keyof Summary;
  label: string;
  fmt: (r: Summary) => string;
  tone?: (r: Summary) => string;
  bar?: boolean;
}

const neg = (v: number | null | undefined) => (v != null && v < 0 ? 'k-neg' : '');

const COLUMNS: Record<ColMode, Column[]> = {
  basic: [
    { key: 'sales', label: '売上高', fmt: (r) => oku(r.sales), bar: true },
    { key: 'op', label: '営業利益', fmt: (r) => oku(r.op), tone: (r) => neg(r.op) },
    { key: 'op_margin', label: '営業利益率', fmt: (r) => pct(r.op_margin), tone: (r) => neg(r.op_margin) },
  ],
  financial: [
    { key: 'sales', label: '売上高', fmt: (r) => oku(r.sales) },
    { key: 'op', label: '営業利益', fmt: (r) => oku(r.op), tone: (r) => neg(r.op) },
    { key: 'np', label: '純利益', fmt: (r) => oku(r.np), tone: (r) => neg(r.np) },
    { key: 'op_margin', label: '営業利益率', fmt: (r) => pct(r.op_margin), tone: (r) => neg(r.op_margin) },
  ],
  capital: [
    { key: 'n_holdings', label: '政策保有', fmt: (r) => (r.n_holdings ? `${r.n_holdings} 社` : '—'), bar: true },
    { key: 'n_held_by', label: '被保有', fmt: (r) => (r.n_held_by ? `${r.n_held_by} 社` : '—') },
    { key: 'excess', label: '5日超過リターン', fmt: (r) => signedPct(r.excess, 2),
      tone: (r) => (r.excess == null ? '' : r.excess > 0 ? 'k-pos' : r.excess < 0 ? 'k-neg' : '') },
  ],
};

/** 表では法人格を落とす。並べたときに社名の頭が揃い、目で追いやすい */
const bare = (name: string) => name.replace(/^株式会社[\s　]*|[\s　]*株式会社$/g, '');

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function SectorTable({ s17, s33, market }: { s17: string; s33: string | null; market: MarketKey | null }) {
  const { data } = useData();
  const tile = data!.index.sectors.find((s) => s.code === s17);
  const [sector, setSector] = useState<SectorFile | null>(null);
  const [err, setErr] = useState(false);
  const [cols, setCols] = useState<ColMode>('basic');
  const [sortKey, setSortKey] = useState<keyof Summary>('sales');
  const [desc, setDesc] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setSector(null); setErr(false);
    loadSector(s17).then((j) => { if (alive) setSector(j); }).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [s17]);

  const nav = (sub: string | null, mkt: MarketKey | null) => go(href.sectors(s17, sub, mkt), { replace: true });

  // 5日超過リターンは J-Quants 由来で、公開版には入っていない。値が1つも無ければ列ごと出さない
  const hasExcess = useMemo(() => !!sector?.companies.some((c) => c.excess != null), [sector]);
  const columns = COLUMNS[cols].filter((c) => c.key !== 'excess' || hasExcess);

  /* 市場の数は中分類で絞った中で、中分類の数は市場で絞った中で数える */
  const inSub = useMemo(() => (sector?.companies ?? []).filter((c) => !s33 || c.s33 === s33), [sector, s33]);
  const inMkt = useMemo(() => (sector?.companies ?? []).filter((c) => !market || marketKey(c.market) === market),
    [sector, market]);
  const mktCounts = useMemo(() => {
    const c = zero();
    for (const r of inSub) c[marketKey(r.market)]++;
    return c;
  }, [inSub]);
  const subCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inMkt) m.set(r.s33, (m.get(r.s33) ?? 0) + 1);
    return m;
  }, [inMkt]);

  const scoped = useMemo(() => inSub.filter((c) => !market || marketKey(c.market) === market), [inSub, market]);
  const scopedMargin = useMemo(() => median(scoped.flatMap((c) => (c.op_margin == null ? [] : [c.op_margin]))), [scoped]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let arr = q ? scoped.filter((c) => c.code.startsWith(q) || c.name.toLowerCase().includes(q)) : scoped;
    arr = [...arr];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
      return desc ? String(bv).localeCompare(String(av), 'ja') : String(av).localeCompare(String(bv), 'ja');
    });
    return arr;
  }, [scoped, filter, sortKey, desc]);

  const barMax = useMemo(() => {
    const k = columns.find((c) => c.bar)?.key;
    return k ? Math.max(1, ...rows.map((r) => Number(r[k] ?? 0))) : 1;
  }, [rows, columns]);

  const sortBy = (k: keyof Summary) => {
    if (k === sortKey) setDesc((d) => !d);
    else { setSortKey(k); setDesc(k !== 'name'); }
  };
  const dir = (k: keyof Summary) => (sortKey === k ? (desc ? 'descending' : 'ascending') : undefined);

  return (
    <div className="k-page">
      <Breadcrumb aria-label="現在地" className="k-crumbs">
        <BreadcrumbItem><BreadcrumbButton onClick={() => go(href.sectors(null, null, market))}>業種と企業</BreadcrumbButton></BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current={!s33} onClick={() => nav(null, market)}>
            {tile?.name ?? s17}
          </BreadcrumbButton>
        </BreadcrumbItem>
        {s33 && (<><BreadcrumbDivider /><BreadcrumbItem><BreadcrumbButton current>{s33}</BreadcrumbButton></BreadcrumbItem></>)}
      </Breadcrumb>

      <header className="k-pagehead">
        <div>
          <h1 className="k-title">
            <span className="k-title-dot" style={{ background: sectorVar(s17) }} />
            {s33 ?? tile?.name}
          </h1>
          <p className="k-lead">
            {sector ? `${scoped.length.toLocaleString()} 社` : '…'}
            {sector && ` · 営業利益率の中央値 ${pct(scopedMargin)}`}
          </p>
        </div>
      </header>

      {err && <p className="k-lead">この業種のデータを読み込めませんでした。</p>}
      {!sector && !err && <div className="k-center" style={{ height: 240 }}><Spinner label="読み込み中" /></div>}

      {sector && (
        <>
          <MarketStrip counts={mktCounts} value={market} onChange={(m) => nav(s33, m)} />

          {/* 中分類が1つしか無ければ絞り込みは要らない */}
          {sector.subsectors.length > 1 && <div className="k-filters">
            <div className="k-pills" role="group" aria-label="中分類で絞り込む">
              <ToggleButton size="small" shape="circular" checked={!s33} onClick={() => nav(null, market)}>
                すべて <span className="k-pill-n">{inMkt.length}</span>
              </ToggleButton>
              {sector.subsectors.map((sub) => (
                <ToggleButton key={sub.name} size="small" shape="circular" checked={s33 === sub.name}
                  disabled={!subCounts.get(sub.name) && s33 !== sub.name}
                  onClick={() => nav(sub.name, market)}>
                  {sub.name} <span className="k-pill-n">{subCounts.get(sub.name) ?? 0}</span>
                </ToggleButton>
              ))}
            </div>
          </div>}

          <Card className="k-card k-table-card">
            <div className="k-table-tools">
              <TabList size="small" selectedValue={cols} onTabSelect={(_, d) => setCols(d.value as ColMode)}>
                <Tab value="basic">概要</Tab>
                <Tab value="financial">財務</Tab>
                <Tab value="capital">資本関係</Tab>
              </TabList>
              <SearchBox size="small" placeholder="この中で絞り込む" value={filter}
                onChange={(_, d) => setFilter(d.value)} className="k-table-filter" />
            </div>
            <div className="k-table-scroll">
              <Table size="small" className="k-table" aria-label={`${tile?.name ?? ''}の企業`}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell sortable sortDirection={dir('name')} onClick={() => sortBy('name')} className="k-th-name">
                      企業
                    </TableHeaderCell>
                    {columns.map((c) => (
                      <TableHeaderCell key={String(c.key)} sortable sortDirection={dir(c.key)}
                        onClick={() => sortBy(c.key)} className="k-th-num">
                        {c.label}
                      </TableHeaderCell>
                    ))}
                    <TableHeaderCell className="k-th-act" aria-label="操作" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const rec = data!.catalog.get(r.code);
                    const mk = marketKey(r.market);
                    return (
                      <TableRow key={r.code} className="k-tr" onClick={() => go(href.company(r.code))}
                        tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go(href.company(r.code)); }}>
                        <TableCell>
                          <div className="k-cell-co">
                            <Favi domain={rec?.domain} name={r.name} s17={s17} size={24} />
                            <span className="k-cell-main">
                              <span className="k-cell-name" title={r.name}>{bare(r.name)}</span>
                              <span className="k-cell-sub">
                                <span className="k-num">{r.code.slice(0, 4)}</span>
                                {/* 東証の市場で絞っているときは全行同じなので出さない。その他は中身が混ざるので出す */}
                                {r.market && (!market || market === 'other') && (
                                  <span className="k-mkt-tag"><i style={{ background: marketColor(mk) }} />{marketLabel(r.market).replace(/^東証/, '')}</span>
                                )}
                                {!s33 && r.s33 !== tile?.name && <span className="k-hide-sm">{r.s33}</span>}
                              </span>
                            </span>
                          </div>
                        </TableCell>
                        {columns.map((c) => (
                          <TableCell key={String(c.key)} className={`k-td-num k-num ${c.tone?.(r) ?? ''}`}>
                            {c.bar ? (
                              <span className="k-cell-bar">
                                <i style={{ width: `${Math.max(0, (Number(r[c.key] ?? 0) / barMax) * 64)}px`, background: sectorVar(s17) }} />
                                {c.fmt(r)}
                              </span>
                            ) : c.fmt(r)}
                          </TableCell>
                        ))}
                        <TableCell className="k-td-act">
                          <Tooltip content="この会社を中心にグラフを描く" relationship="label">
                            <Button size="small" appearance="subtle" icon={<Organization20Regular />}
                              onClick={(e) => { e.stopPropagation(); go(href.explore(r.code)); }} />
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={columns.length + 2}>
                      <span className="k-caption">該当する企業がありません</span>
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
