/* 図表。Fluent 2 のチャートの見た目（細い補助線・角の小さい棒・12px の目盛り）に寄せて、
   SVG で直に描く。描くのは棒と横棒だけなので、図表ライブラリを丸ごと配るまでもない。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResultRow, SectorTile } from '../browser/types';
import { oku, pct } from './common';
import { sectorVar } from '../theme';

/** 目盛りのきりのよい刻み */
function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/* ---------------- 業績の推移 ----------------
   売上高と利益を期ごとに並べる。利益は売上の数十分の一しかないことが多く、
   同じ目盛りに載せると潰れて読めない。そこで棒は左右2本の軸に分ける。 */

/** 目盛りの数字。きりのよい値なので、小数の 0 は落とす */
const tickFmt = (v: number) => oku(v).replace(/\.0+(?=[^\d]|$)/, '').replace(/(\.\d*?)0+(?=[^\d]|$)/, '$1');

/** 実際の幅を測る。viewBox で引き伸ばすと、広い画面で目盛りの文字まで大きくなる */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ResultsChart({ rows, pretaxLabel }: { rows: ResultRow[]; pretaxLabel: string }) {
  const data = useMemo(() => [...rows].reverse(), [rows]);
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth<HTMLDivElement>(640);

  const H = 260, L = 60, R = 60, T = 16, B = 34;
  const iw = W - L - R, ih = H - T - B;

  const salesMax = Math.max(1, ...data.map((d) => d.sales ?? 0));
  const profits = data.flatMap((d) => [d.np, d.pretax]).filter((x): x is number => x != null);
  const pMax = Math.max(1, ...profits);
  const pMin = Math.min(0, ...profits);

  const sStep = niceStep(salesMax, 4);
  const sTop = Math.ceil(salesMax / sStep) * sStep;
  const pStep = niceStep(pMax - pMin, 4);
  const pTop = Math.ceil(pMax / pStep) * pStep;
  const pBot = Math.floor(pMin / pStep) * pStep;

  // 利益の0線と売上の0線を揃える。揃えないと、同じ高さの棒が別の値に見える
  const zeroFrac = pTop / (pTop - pBot || 1);
  const y0 = T + ih * zeroFrac;
  const ys = (v: number) => y0 - (v / sTop) * (ih * zeroFrac);
  const yp = (v: number) => y0 - (v / (pTop - pBot || 1)) * ih;

  const band = iw / data.length;
  const bw = Math.max(6, Math.min(22, band * 0.2));

  const sTicks: number[] = [];
  for (let v = 0; v <= sTop + 1e-9; v += sStep) sTicks.push(v);
  const pTicks: number[] = [];
  for (let v = pBot; v <= pTop + 1e-9; v += pStep) pTicks.push(v);

  const series = [
    { key: 'sales', label: '売上高', color: 'var(--colorBrandBackground)' },
    { key: 'pretax', label: pretaxLabel, color: 'var(--colorPaletteTealBorderActive)' },
    { key: 'np', label: '純利益', color: 'var(--colorPaletteMarigoldBorderActive)' },
  ] as const;

  const h = hover != null ? data[hover] : null;

  return (
    <div className="k-chart">
      <div className="k-chart-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
        <span className="k-caption" style={{ marginLeft: 'auto' }}>左軸 売上高 · 右軸 利益</span>
      </div>
      <div style={{ position: 'relative' }} ref={boxRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="k-chart-svg" role="img"
          aria-label={`業績の推移。${data.map((d) => `${d.label}期 売上高${oku(d.sales)} 純利益${oku(d.np)}`).join('、')}`}
          onMouseLeave={() => setHover(null)}>
          {sTicks.map((t) => (
            <g key={`s${t}`}>
              <line x1={L} x2={W - R} y1={ys(t)} y2={ys(t)} className="k-grid" />
              <text x={L - 8} y={ys(t) + 4} textAnchor="end" className="k-tick">{tickFmt(t)}</text>
            </g>
          ))}
          {pTicks.map((t) => (
            <text key={`p${t}`} x={W - R + 8} y={yp(t) + 4} className="k-tick">{tickFmt(t)}</text>
          ))}
          <line x1={L} x2={W - R} y1={y0} y2={y0} className="k-axis" />

          {data.map((d, i) => {
            const cx = L + band * i + band / 2;
            const bar = (val: number | null, x: number, y: (v: number) => number, color: string) => {
              if (val == null) return null;
              const top = Math.min(y(val), y0), hgt = Math.max(1, Math.abs(y(val) - y0));
              return <rect x={x} y={top} width={bw} height={hgt} rx="2" style={{ fill: color }}
                className={val < 0 ? 'k-bar k-bar-neg' : 'k-bar'} />;
            };
            return (
              <g key={d.label + d.rel} opacity={hover == null || hover === i ? 1 : 0.45}
                onMouseEnter={() => setHover(i)}>
                <rect x={L + band * i} y={T} width={band} height={ih} fill="transparent" />
                {bar(d.sales, cx - bw * 1.5 - 3, ys, series[0].color)}
                {bar(d.pretax, cx - bw / 2, yp, series[1].color)}
                {bar(d.np, cx + bw / 2 + 3, yp, series[2].color)}
                <text x={cx} y={H - 12} textAnchor="middle" className="k-tick k-tick-x">{d.label}</text>
              </g>
            );
          })}
        </svg>
        {h && hover != null && (
          <div className="k-chart-tip" style={{
            left: `${((L + band * hover + band / 2) / W) * 100}%`,
          }}>
            <div className="k-chart-tip-title">{h.label}期</div>
            <div><i style={{ background: series[0].color }} />売上高 <b>{oku(h.sales)}</b></div>
            <div><i style={{ background: series[1].color }} />{pretaxLabel} <b>{oku(h.pretax)}</b></div>
            <div><i style={{ background: series[2].color }} />純利益 <b>{oku(h.np)}</b></div>
            {h.roe != null && <div className="k-caption">ROE {pct(h.roe)} · 自己資本比率 {pct(h.equity_ratio)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 業種の分布 ----------------
   社数の横棒に、営業利益率の中央値を添える。行を押すとその業種に降りる。 */

export function SectorBars({ sectors, onPick, limit }: {
  sectors: SectorTile[];
  onPick: (code: string) => void;
  limit?: number;
}) {
  const rows = limit ? sectors.slice(0, limit) : sectors;
  const max = Math.max(1, ...sectors.map((s) => s.count));
  // 利益率の目盛りは 25% で頭打ちにする。外れ値（持株会社の多い業種など）に全体が潰されないように
  const mMax = MARGIN_CAP;
  return (
    <div className="k-sbars" role="list">
      <div className="k-sbars-head k-caption" aria-hidden="true">
        <span>業種</span><span>上場企業数</span><span style={{ textAlign: 'right' }}>営業利益率（中央値）</span>
      </div>
      {rows.map((s, i) => (
        <button key={s.code} className="k-sbar" role="listitem" onClick={() => onPick(s.code)}
          style={{ animationDelay: `${Math.min(i * 28, 400)}ms` }}>
          <span className="k-sbar-name">
            <i style={{ background: sectorVar(s.code) }} />{s.name}
          </span>
          <span className="k-sbar-track">
            <span className="k-sbar-fill" style={{ width: `${(s.count / max) * 100}%`, background: sectorVar(s.code) }} />
            <span className="k-sbar-n k-num">{s.count.toLocaleString()}</span>
          </span>
          <span className="k-sbar-margin">
            <span className="k-meter"><i style={{ width: `${Math.max(2, Math.min(100, ((s.median_op_margin ?? 0) / mMax) * 100))}%` }} /></span>
            <span className="k-num">{pct(s.median_op_margin)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** 営業利益率の横棒の満タン。これを超える業種は満タンで止める */
export const MARGIN_CAP = 0.25;

/** 小さな横棒。値の大小を数字より先に目に入れる */
export function Meter({ value, max = 1, color }: { value: number | null; max?: number; color?: string }) {
  const w = value == null ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <span className="k-meter">
      <i style={{ width: `${w}%`, background: color }} />
    </span>
  );
}
