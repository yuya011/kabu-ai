/* ロゴと挿絵。

   ロゴは K の字を結線で組んだもの。縦の幹に1社が立ち、そこから斜めに2本の
   つながりが伸びる。右の2つを結ぶ破線は、相手同士も持ち合っていることを表す。
   アプリアイコン（public/icons/*.png）は scripts/make_icons.sh がこれと同じ図形から作る。

   挿絵はすべて Fluent のトークン（CSS 変数）で塗っているので、ライトとダークの
   どちらでも組み直しなしで映る。SVG の fill 属性は var() を解さないため style で渡す。 */

import { useId } from 'react';
import { brand } from '../theme';

const v = (token: string) => `var(--${token})`;

/* ---------------- ロゴ ---------------- */

export function BrandMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Keiretsu">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand[90]} />
          <stop offset="1" stopColor={brand[60]} />
        </linearGradient>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#g${id})`} />
      <rect width="48" height="48" rx="12" fill={`url(#h${id})`} />
      <path d="M33.5 12.5 C 40 20, 40 28, 33.5 35.5" fill="none" stroke="#fff"
        strokeOpacity="0.55" strokeWidth="1.8" strokeDasharray="2.2 3" strokeLinecap="round" />
      <g stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
        <line x1="15" y1="11" x2="15" y2="37" />
        <line x1="15" y1="24" x2="33.5" y2="12.5" />
        <line x1="15" y1="24" x2="33.5" y2="35.5" />
      </g>
      <g fill="#fff">
        <circle cx="15" cy="11" r="3" />
        <circle cx="15" cy="37" r="3" />
        <circle cx="33.5" cy="12.5" r="3.8" />
        <circle cx="33.5" cy="35.5" r="3.8" />
      </g>
      <circle cx="15" cy="24" r="5.4" fill="#fff" />
      <circle cx="15" cy="24" r="2.4" fill={brand[70]} />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="k-wordmark">
      <BrandMark size={size} />
      <span className="k-wordmark-text">Keiretsu</span>
    </span>
  );
}

/* ---------------- ホームの図 ----------------

   1社を中心に、内側の輪に直接のつながり、外側の輪にその先を置く。
   実際のグラフ画面と同じ文法（色＝業種、緑＝持ち合い、太い藍＝中心からの経路）で描いて、
   押した先で何が見えるかを先に見せる。 */

const HERO_INNER = [
  { a: -100, s: 'RoyalBlue', t: '銀行' },
  { a: -35, s: 'Teal', t: '商社' },
  { a: 25, s: 'Pumpkin', t: '化学' },
  { a: 90, s: 'Forest', t: '保険' },
  { a: 150, s: 'Cranberry', t: '電機' },
  { a: 210, s: 'Grape', t: '機械' },
];
const HERO_OUTER = [
  { a: -125, s: 'Steel', from: 0 }, { a: -75, s: 'Marigold', from: 0 },
  { a: -15, s: 'Seafoam', from: 1 }, { a: 20, s: 'Berry', from: 2 },
  { a: 60, s: 'Cornflower', from: 2 }, { a: 120, s: 'Lavender', from: 3 },
  { a: 175, s: 'Brown', from: 4 }, { a: 235, s: 'Gold', from: 5 },
];

export function HeroArt() {
  const cx = 280, cy = 214;
  const pt = (a: number, r: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const inner = HERO_INNER.map((n) => ({ ...n, p: pt(n.a, 104) }));
  const outer = HERO_OUTER.map((n) => ({ ...n, p: pt(n.a, 176) }));
  const curve = (x1: number, y1: number, x2: number, y2: number, k = 0.12) => {
    const mx = (x1 + x2) / 2 - (y2 - y1) * k, my = (y1 + y2) / 2 + (x2 - x1) * k;
    return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  };
  // 経路として強調する道筋：中心 → 商社 → 外側
  const pathTo = outer[2];

  return (
    <svg className="k-hero-art" viewBox="0 0 560 430" role="img"
      aria-label="1社を中心に、政策保有と取引でつながる会社を2重の輪に並べた図">
      <defs>
        <radialGradient id="hero-bg" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: v('colorBrandBackground2') }} stopOpacity="1" />
          <stop offset="1" style={{ stopColor: v('colorBrandBackground2') }} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-center" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand[90]} />
          <stop offset="1" stopColor={brand[60]} />
        </linearGradient>
        <marker id="hero-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" style={{ fill: v('colorNeutralStroke1') }} />
        </marker>
      </defs>

      <circle cx={cx} cy={cy} r="210" fill="url(#hero-bg)" />
      <circle cx={cx} cy={cy} r="104" className="k-art-orbit" />
      <circle cx={cx} cy={cy} r="176" className="k-art-orbit" />

      {/* 外側への辺 */}
      {outer.map((o, i) => {
        const f = inner[o.from].p;
        return <path key={`o${i}`} d={curve(f[0], f[1], o.p[0], o.p[1], 0.1)} className="k-art-edge" markerEnd="url(#hero-arrow)" />;
      })}
      {/* 中心から内側への辺。1本は持ち合い、1本は取引 */}
      {inner.map((n, i) => (
        <path key={`i${i}`} d={curve(cx, cy, n.p[0], n.p[1], 0.08)}
          className={i === 0 || i === 3 ? 'k-art-edge k-art-mutual' : i === 4 ? 'k-art-edge k-art-trade' : 'k-art-edge k-art-edge-strong'} />
      ))}
      {/* 経路 */}
      <path d={`${curve(cx, cy, inner[1].p[0], inner[1].p[1], 0.08)} ${curve(inner[1].p[0], inner[1].p[1], pathTo.p[0], pathTo.p[1], 0.1).replace('M', 'L')}`}
        className="k-art-path" />

      {outer.map((o, i) => (
        <g key={`on${i}`} className="k-art-float" style={{ animationDelay: `${i * 0.4}s` }}>
          <circle cx={o.p[0]} cy={o.p[1]} r={i === 2 ? 13 : 10} className="k-art-node"
            style={{ fill: v(`colorPalette${o.s}BorderActive`) }} />
          {i === 2 && <circle cx={o.p[0]} cy={o.p[1]} r="19" className="k-art-sel" />}
        </g>
      ))}
      {inner.map((n, i) => (
        <g key={`in${i}`} className="k-art-float" style={{ animationDelay: `${0.2 + i * 0.5}s` }}>
          <circle cx={n.p[0]} cy={n.p[1]} r="17" className="k-art-node"
            style={{ fill: v(`colorPalette${n.s}BorderActive`) }} />
          <text x={n.p[0]} y={n.p[1] + 4.5} textAnchor="middle" className="k-art-letter">{n.t.slice(0, 1)}</text>
          <g transform={`translate(${n.p[0]}, ${n.p[1] + 31})`}>
            <rect x="-22" y="-10" width="44" height="20" rx="10" className="k-art-pill" />
            <text y="4" textAnchor="middle" className="k-art-label">{n.t}</text>
          </g>
        </g>
      ))}

      {/* 中心 */}
      <circle cx={cx} cy={cy} r="46" className="k-art-halo" />
      <circle cx={cx} cy={cy} r="34" fill="url(#hero-center)" className="k-art-node" />
      <g transform={`translate(${cx - 11}, ${cy - 12})`} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round">
        <path d="M2 23 V5 L12 1 V23 M12 9 H20 V23 M0 23 H22" />
        <path d="M5 8h4M5 12h4M5 16h4M15 13h2M15 17h2" strokeLinecap="round" />
      </g>

      {/* 辺の説明札。実画面で辺に触れたときに出るものと同じ中身 */}
      <g transform="translate(372, 36)" className="k-art-card">
        <rect width="172" height="84" rx="8" />
        <circle cx="16" cy="20" r="5" style={{ fill: v('colorPaletteGreenBorderActive') }} />
        <text x="28" y="24" className="k-art-card-title">政策保有 · 持ち合い</text>
        <rect x="12" y="38" width="148" height="7" rx="3.5" className="k-art-skel" />
        <rect x="12" y="52" width="122" height="7" rx="3.5" className="k-art-skel" />
        <rect x="12" y="66" width="86" height="7" rx="3.5" className="k-art-skel" />
      </g>
      <g transform="translate(18, 330)" className="k-art-card">
        <rect width="150" height="62" rx="8" />
        <text x="12" y="22" className="k-art-card-title">中心からの経路</text>
        <rect x="12" y="34" width="26" height="4" rx="2" style={{ fill: v('colorBrandBackground') }} />
        <text x="44" y="39" className="k-art-card-sub">2 ホップ</text>
        <rect x="12" y="46" width="104" height="6" rx="3" className="k-art-skel" />
      </g>
    </svg>
  );
}

/* ---------------- 行き先カードの挿絵 ---------------- */

export function ExploreArt() {
  const nodes = [[60, 58, 13, 'brand'], [22, 30, 7, 'Teal'], [104, 26, 8, 'Pumpkin'], [112, 86, 7, 'Grape'],
    [20, 92, 6, 'Forest'], [150, 56, 6, 'Cranberry'], [168, 22, 5, 'Steel']] as const;
  return (
    <svg className="k-mini-art" viewBox="0 0 190 116" aria-hidden="true">
      {nodes.slice(1).map(([x, y], i) => (
        <line key={i} x1={i === 4 ? 104 : 60} y1={i === 4 ? 26 : 58} x2={x} y2={y}
          className={i === 1 ? 'k-art-path k-art-path-static' : i === 0 ? 'k-art-edge k-art-mutual' : 'k-art-edge k-art-edge-strong'} />
      ))}
      <line x1="150" y1="56" x2="168" y2="22" className="k-art-edge" />
      {nodes.map(([x, y, r, c], i) => (
        <circle key={i} cx={x} cy={y} r={r} className="k-art-node"
          style={{ fill: c === 'brand' ? v('colorBrandBackground') : v(`colorPalette${c}BorderActive`) }} />
      ))}
    </svg>
  );
}

export function SectorsArt() {
  const bars = [0.92, 0.78, 0.66, 0.58, 0.44, 0.36, 0.28];
  const cols = ['RoyalBlue', 'Teal', 'Pumpkin', 'Grape', 'Forest', 'Cranberry', 'Marigold'];
  return (
    <svg className="k-mini-art" viewBox="0 0 190 116" aria-hidden="true">
      {bars.map((w, i) => (
        <g key={i} transform={`translate(10, ${10 + i * 14.5})`}>
          <rect width="26" height="7" rx="3.5" className="k-art-skel" />
          <rect x="34" width={w * 140} height="8" rx="2" style={{ fill: v(`colorPalette${cols[i]}BorderActive`) }} />
        </g>
      ))}
    </svg>
  );
}

export function ConnectArt() {
  return (
    <svg className="k-mini-art" viewBox="0 0 190 116" aria-hidden="true">
      <rect x="8" y="22" width="70" height="30" rx="10" className="k-art-bubble" />
      <rect x="18" y="32" width="44" height="5" rx="2.5" className="k-art-skel" />
      <rect x="18" y="41" width="30" height="5" rx="2.5" className="k-art-skel" />
      <rect x="22" y="62" width="62" height="26" rx="10" className="k-art-bubble k-art-bubble-me" />
      <rect x="32" y="72" width="40" height="5" rx="2.5" style={{ fill: '#fff', opacity: 0.8 }} />
      <path d="M92 56 H122" className="k-art-path" />
      <g transform="translate(128, 30)">
        <rect width="52" height="52" rx="12" style={{ fill: v('colorNeutralBackground1') }} className="k-art-card-rect" />
        <g transform="translate(12, 12) scale(0.583)"><BrandPaths /></g>
      </g>
    </svg>
  );
}

export function TodayArt() {
  return (
    <svg className="k-mini-art" viewBox="0 0 190 116" aria-hidden="true">
      <line x1="30" y1="10" x2="30" y2="108" className="k-art-edge" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(0, ${18 + i * 26})`}>
          <circle cx="30" cy="0" r={i === 0 ? 6 : 4.5}
            style={{ fill: i === 0 ? v('colorPaletteRedBorderActive') : v('colorNeutralStroke1') }}
            className={i === 0 ? 'k-art-live' : undefined} />
          <rect x="44" y="-6" width={[118, 96, 128, 84][i]} height="12" rx="4"
            className={i === 0 ? 'k-art-row-hot' : 'k-art-skel'} />
        </g>
      ))}
    </svg>
  );
}

/** ロゴの中身だけ（背景の角丸なし）。他の図の中に置くとき用 */
function BrandPaths() {
  return (
    <g>
      <rect width="48" height="48" rx="12" fill={brand[70]} />
      <g stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
        <line x1="15" y1="11" x2="15" y2="37" />
        <line x1="15" y1="24" x2="33.5" y2="12.5" />
        <line x1="15" y1="24" x2="33.5" y2="35.5" />
      </g>
      <g fill="#fff">
        <circle cx="15" cy="11" r="3" /><circle cx="15" cy="37" r="3" />
        <circle cx="33.5" cy="12.5" r="3.8" /><circle cx="33.5" cy="35.5" r="3.8" />
        <circle cx="15" cy="24" r="5.4" />
      </g>
    </g>
  );
}

/* ---------------- MCP の結線図 ----------------

   左に対話型AI、中央にこのサイトの MCP サーバー、右に出どころの EDINET。
   問い合わせは左から右へ流れ、答えは同じ道を戻る。 */

const CLIENTS = ['Claude', 'Cursor', 'VS Code', 'Gemini'];

export function McpDiagram() {
  const ys = [34, 84, 134, 184];
  return (
    <svg className="k-mcp-art" viewBox="0 0 640 218" role="img"
      aria-label="Claude・Cursor・VS Code・Gemini から Keiretsu の MCP サーバーにつながり、その先で EDINET の有価証券報告書を読む図">
      {ys.map((y, i) => (
        <path key={y} className="k-art-flow" style={{ animationDelay: `${i * 0.25}s` }}
          d={`M132,${y} C196,${y} 214,109 262,109`} />
      ))}
      <path className="k-art-flow" style={{ animationDelay: '0.5s' }} d="M398,109 H478" />
      {ys.map((y, i) => (
        <g key={`c${y}`} transform={`translate(8, ${y - 17})`}>
          <rect width="124" height="34" rx="17" className="k-art-pill k-art-pill-lg" />
          <text x="62" y="22" textAnchor="middle" className="k-art-label k-art-label-lg">{CLIENTS[i]}</text>
        </g>
      ))}
      <g transform="translate(262, 62)">
        <rect width="136" height="94" rx="12" className="k-art-card-rect k-art-hub" />
        <g transform="translate(16, 16) scale(0.5)"><BrandPaths /></g>
        <text x="48" y="36" className="k-art-card-title">Keiretsu</text>
        <text x="16" y="62" className="k-art-card-sub">MCP サーバー</text>
        <text x="16" y="79" className="k-art-card-sub k-art-mono">/mcp · 認証不要</text>
      </g>
      <g transform="translate(478, 58)">
        <rect width="150" height="102" rx="12" className="k-art-card-rect" />
        <g transform="translate(18, 20)" className="k-art-db">
          <ellipse cx="18" cy="6" rx="18" ry="6" />
          <path d="M0 6 V40 A18 6 0 0 0 36 40 V6" />
          <path d="M0 23 A18 6 0 0 0 36 23" fill="none" />
        </g>
        <text x="64" y="36" className="k-art-card-title">EDINET</text>
        <text x="64" y="54" className="k-art-card-sub">有価証券報告書</text>
        <text x="18" y="86" className="k-art-card-sub">業績・政策保有・大株主</text>
      </g>
    </svg>
  );
}

/* ---------------- 空の状態 ---------------- */

export function EmptySearchArt() {
  return (
    <svg className="k-empty-art" viewBox="0 0 200 150" aria-hidden="true">
      <circle cx="100" cy="75" r="68" style={{ fill: v('colorBrandBackground2') }} />
      {[[62, 52, 'Teal'], [138, 46, 'Pumpkin'], [64, 108, 'Grape'], [142, 104, 'Forest']].map(([x, y, c], i) => (
        <g key={i}>
          <line x1="100" y1="76" x2={x as number} y2={y as number} className="k-art-edge k-art-edge-strong" />
          <circle cx={x as number} cy={y as number} r="9" className="k-art-node"
            style={{ fill: v(`colorPalette${c}BorderActive`) }} />
        </g>
      ))}
      <circle cx="100" cy="76" r="15" className="k-art-node" style={{ fill: v('colorNeutralBackground1'), stroke: v('colorBrandStroke1'), strokeWidth: 3, strokeDasharray: '4 4' }} />
      <g transform="translate(112, 86)">
        <circle cx="14" cy="14" r="14" style={{ fill: v('colorNeutralBackground1'), stroke: v('colorBrandBackground'), strokeWidth: 4 }} />
        <line x1="24" y1="24" x2="38" y2="38" style={{ stroke: v('colorBrandBackground'), strokeWidth: 6, strokeLinecap: 'round' }} />
      </g>
    </svg>
  );
}
