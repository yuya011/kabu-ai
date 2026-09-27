/* つながりを探索（関係グラフ）。

   画面は3段でできている。
     上  … 中心の会社と、見せ方の操作（Fluent の Toolbar）
     中  … グラフ。凡例と拡大縮小は隅に浮かせる
     右  … 選んだ会社のインスペクタ（Drawer）。狭い画面では下から出る

   インスペクタは中身が多いので、概要・関係・開示の3つのタブに分けた。
   以前は1本の長い巻物で、保有目的まで辿り着くのに何度も送る必要があった。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  Button, ToggleButton, Tooltip, Slider, Label, Spinner, Badge, Link,
  Toolbar, ToolbarDivider, TabList, Tab, Popover, PopoverTrigger, PopoverSurface,
  InlineDrawer, DrawerHeader, DrawerHeaderTitle, DrawerBody,
  MessageBar, MessageBarBody, CounterBadge,
} from '@fluentui/react-components';
import {
  ArrowLeft20Regular, Dismiss20Regular, Open16Regular, Globe20Regular, DocumentPdf20Regular,
  Document20Regular, ChartMultiple20Regular, ZoomIn20Regular, ZoomOut20Regular, ZoomFit20Regular,
  PanelRightExpand20Regular, PanelRightContract20Regular, Filter20Regular, Target20Regular,
  BuildingMultiple20Regular, ArrowRight16Regular, Search20Regular,
} from '@fluentui/react-icons';
import type { Detail } from '../browser/types';
import {
  AdjStore, buildEgo, shortestPath, findPath, linkKey,
  type GNode, type GLink, type NodeRec, type Hop,
} from '../browser/graph';
import { favicon, ready, onFaviconLoad } from '../browser/favicon';
import { buildPrompt } from '../browser/prompt';
import { recordView } from '../browser/analytics';
import { openSearch } from '../browser/search';
import { useMedia } from '../browser/useMedia';
import { useSettings } from '../settings';
import { useData, loadCompany, useCompany } from '../data';
import { go, href } from '../router';
import { sectorHex } from '../theme';
import { Favi, oku, pct, short, useKTheme } from '../ui/common';
import { CompanySearch } from '../ui/CompanySearch';
import { EmptySearchArt } from '../ui/art';
import { useAsk, AskButton, AnswerBox } from '../ui/Ask';
import { HoldingRow, TradeRow, EventRow, FilingRow, NewsRow, Empty } from '../ui/Relations';

const REL_NAME: Record<number, string> = { 1: '仕入先', 2: '販売先', 3: '業務提携', 4: '金融取引' };

/** '#rrggbb' に透明度を掛ける */
function alpha(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export default function Explore({ code }: { code: string | null }) {
  const { data } = useData();
  const catalog = data!.catalog;

  if (!code || catalog.get(code)?.kind !== 0) {
    return (
      <div className="k-page k-explore-empty">
        <EmptySearchArt />
        <h1 className="k-title">どの会社を中心にしますか</h1>
        <p className="k-lead">
          選んだ会社を中心に、政策保有・大株主・主要な取引先を描きます。
          上場企業のみ中心に置けます。
        </p>
        <CompanySearch size="large" inline autoFocus onPick={(c) => go(href.explore(c))} />
        {code && <MessageBar intent="warning" style={{ marginTop: 16 }}>
          <MessageBarBody>{catalog.get(code)?.name ?? code} は上場企業ではないため、中心に置けません。</MessageBarBody>
        </MessageBar>}
      </div>
    );
  }
  return <Graph key={code} center={code} catalog={catalog} />;
}

function Graph({ center, catalog }: { center: string; catalog: Map<string, NodeRec> }) {
  const settings = useSettings();
  const { theme, mode } = useKTheme();
  const narrow = useMedia('(max-width: 900px)');

  const [depth, setDepth] = useState<1 | 2>(1);
  const [hold, setHold] = useState(true);
  const [major, setMajor] = useState(true);
  const [trade, setTrade] = useState(true);
  const [colorBy, setColorBy] = useState<'capital' | 'trade'>('capital');
  const [perNode, setPerNode] = useState(10);
  const [graph, setGraph] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [truncated, setTruncated] = useState(false);
  /* 密度で間引かれて画面にいない会社を選んだとき、経路だけを描き足す */
  const [extra, setExtra] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceMiss, setTraceMiss] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(center);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<any>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [wide, setWide] = useState(false);
  const [, bumpPurpose] = useState(0);
  const [, bumpFavicon] = useState(0);
  const purposeCache = useRef(new Map<string, string | null>());
  const purposeLoaded = useRef(new Set<string>());

  const store = useRef(new AdjStore());
  const stageRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const viewRef = useRef<{ nodes: GNode[] } | null>(null);

  useEffect(() => onFaviconLoad(() => bumpFavicon((n) => n + 1)), []);
  useEffect(() => { recordView(center); }, [center]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 収まりの取り直し。余白と拡大率の上限は画面の広さに合わせる。
     zoomToFit に任せてから上限で戻すと、配置が固まる前の団子や繋がりの無い1社に
     一度めいっぱい寄ってから引くことになる。拡大率はここで上限込みで求め、1回で動かす。
     onlyIfOverflow のときは、はみ出したときだけ引く（寄り直しはしない） */
  const refit = useCallback((ms = 380, onlyIfOverflow = false) => {
    const fg = fgRef.current;
    // 描画側が view のノードに x, y を書き込む。ref からはデータを取れないので view を見る
    const nodes: any[] = viewRef.current?.nodes ?? [];
    if (!fg || !nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
      y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    if (!Number.isFinite(x0)) return;
    // 円と社名のぶん。社名は円の下に出る
    x0 -= 18; x1 += 18; y0 -= 18; y1 += 26;
    const pad = Math.max(16, Math.round(Math.min(size.w, size.h) * 0.08));
    const cap = narrow ? 4.2 : 2.4;
    const k = Math.max(0.05, Math.min(cap,
      (size.w - 2 * pad) / (x1 - x0), (size.h - 2 * pad) / (y1 - y0)));
    if (onlyIfOverflow && fg.zoom() <= k * 1.02) return;
    fg.centerAt((x0 + x1) / 2, (y0 + y1) / 2, ms);
    fg.zoom(k, ms);
  }, [size.w, size.h, narrow]);

  /* 最初の1回は、先回し（warmupTicks）で配置がほぼ固まった直後に動かさず合わせ、
     それまでは描かない。以降のデータの差し替えは、差し替え直後の1コマで滑らかに合わせる */
  const [shown, setShown] = useState(false);
  const pendingFit = useRef<'instant' | 'smooth' | null>('instant');
  const applyPendingFit = () => {
    const mode = pendingFit.current;
    if (!mode) return false;
    pendingFit.current = null;
    refit(mode === 'instant' ? 0 : 420);
    if (mode === 'instant') setShown(true);
    return true;
  };

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => refit(300), 80);
    return () => clearTimeout(t);
    // 画面の広さが変わったときだけ（インスペクタの開閉・回転）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  // 既定の力だと中心付近で団子になるので、反発を強めて辺を長くする
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph) return;
    fg.d3Force('charge')?.strength(-240).distanceMax(540);
    fg.d3Force('link')?.distance(80).strength(0.55);
  }, [graph]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    buildEgo(center, catalog, store.current, { depth, hold, major, trade, perNode, maxNodes: 220 })
      .then((g) => {
        if (cancelled) return;
        setGraph({ nodes: g.nodes, links: g.links });
        setTruncated(g.truncated);
        setBusy(false);
      });
    return () => { cancelled = true; };
  }, [center, catalog, depth, hold, major, trade, perNode]);

  /** 辺の理由は保有元の有報に書かれているので、保有元のシャードから引く */
  const ensurePurpose = useCallback(async (src: string) => {
    if (purposeLoaded.current.has(src)) return;
    purposeLoaded.current.add(src);
    const d = await loadCompany(src);
    if (d?.holdings) {
      for (const h of d.holdings) if (h.code) purposeCache.current.set(`${src}>${h.code}`, h.purpose);
      bumpPurpose((n) => n + 1);
    }
  }, []);
  const purposeOf = useCallback((holder: string, held: string) =>
    purposeCache.current.get(`${holder}>${held}`) ?? null, []);

  useEffect(() => { if (selected) ensurePurpose(selected); }, [selected, ensurePurpose]);

  /* 中心は変えずに選ぶ。画面にいない会社なら、全体を辿って経路だけを描き足す */
  const trace = useCallback(async (code: string) => {
    setTraceMiss(null);
    setSelected(code);
    if (code === center || graph?.nodes.some((n) => n.id === code)) return;
    setTracing(true);
    try {
      const hops = await findPath(center, code, store.current, catalog, {});
      if (!hops) { setTraceMiss(code); return; }
      const ids = new Set<string>([center]);
      for (const h of hops) { ids.add(h.from); ids.add(h.to); }
      const nodes: GNode[] = [...ids].map((id) => {
        const rec = catalog.get(id)!;
        return { id, depth: 1, name: rec.name, s17: rec.s17, s33: rec.s33, domain: rec.domain, kind: rec.kind, degree: 2 };
      });
      setExtra({ nodes, links: hops.map((h) => h.link) });
    } finally {
      setTracing(false);
    }
  }, [center, graph, catalog]);

  /* 行から相手を開く。上場なら中心を移し、非上場は選ぶだけにする */
  const focus = useCallback((code: string) => {
    if (catalog.get(code)?.kind === 0) go(href.explore(code));
    else trace(code);
  }, [catalog, trace]);

  const view = useMemo(() => {
    if (!graph) return null;
    if (!extra) return graph;
    const ids = new Set(graph.nodes.map((n) => n.id));
    const keys = new Set(graph.links.map(linkKey));
    return {
      nodes: [...graph.nodes, ...extra.nodes.filter((n) => !ids.has(n.id))],
      links: [...graph.links, ...extra.links.filter((l) => !keys.has(linkKey(l)))],
    };
  }, [graph, extra]);
  viewRef.current = view;

  useEffect(() => {
    if (view && shown) pendingFit.current = 'smooth';
    // shown は見ない。表示された瞬間に合わせ直しを積まないため
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /* 中心から選択までの経路。描かれている辺だけで求める */
  const path = useMemo(() => {
    if (!view || !selected || selected === center) return null;
    return shortestPath(view.links, center, selected);
  }, [view, selected, center]);
  const pathKeys = useMemo(() => new Set((path ?? []).map((h) => linkKey(h.link))), [path]);

  useEffect(() => {
    if (!path) return;
    for (const h of path) if (h.link.kind === 'hold') ensurePurpose(h.forward ? h.from : h.to);
  }, [path, ensurePurpose]);

  /* ---------- 配色。キャンバスは CSS 変数を読めないので、テーマの値を直に使う ---------- */
  const pal = useMemo(() => {
    const t = theme!;
    const dark = mode === 'dark';
    return {
      label: t.colorNeutralForeground1,
      sub: t.colorNeutralForeground3,
      ring: t.colorNeutralBackground1,
      halo: alpha(t.colorNeutralBackground1, dark ? 0.86 : 0.9),
      hold: alpha(t.colorBrandStroke1, dark ? 0.5 : 0.38),
      mutual: alpha(t.colorPaletteGreenBorderActive, 0.62),
      trade: alpha(t.colorPaletteBerryBorderActive, 0.55),
      major: alpha(t.colorPaletteMarigoldBorderActive, 0.6),
      rel: {
        1: alpha(t.colorPaletteGrapeBorderActive, 0.7), 2: alpha(t.colorPaletteBerryBorderActive, 0.65),
        3: alpha(t.colorPaletteGreenBorderActive, 0.65), 4: alpha(t.colorPaletteMarigoldBorderActive, 0.65),
        0: alpha(t.colorNeutralStroke1, 0.35),
      } as Record<number, string>,
      path: t.colorBrandBackground,
      font: t.fontFamilyBase,
    };
  }, [theme, mode]);

  const centerRec = catalog.get(center)!;
  const selRec = selected ? catalog.get(selected) : null;

  const controls = (
    <Controls {...{ depth, setDepth, hold, setHold, major, setMajor, trade, setTrade, colorBy, setColorBy, perNode, setPerNode, pal }} />
  );

  const inspector = selected && selRec && (
    <InlineDrawer open position={narrow ? 'bottom' : 'end'} separator
      className="k-inspector" data-wide={wide}
      style={narrow ? { height: wide ? '82dvh' : '52dvh' } : { width: wide ? 640 : 420 }}>
      <Inspector code={selected} rec={selRec} center={center} path={path}
        catalog={catalog} purposeOf={purposeOf} onFocus={focus}
        wide={wide} onToggleWide={() => setWide((v) => !v)}
        onClose={() => setSelected(null)} narrow={narrow} />
    </InlineDrawer>
  );

  return (
    <div className="k-explore" data-narrow={narrow}>
      <div className="k-explore-bar">
        <div className="k-explore-center">
          <Tooltip content="ホームへ戻る" relationship="label">
            <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => go(href.home())} />
          </Tooltip>
          <Favi domain={centerRec.domain} name={centerRec.name} s17={centerRec.s17} size={32} />
          <div style={{ minWidth: 0 }}>
            <div className="k-explore-name">{centerRec.name}</div>
            <div className="k-caption">{short(center)} · {centerRec.s33} · 中心</div>
          </div>
          {busy && <Spinner size="tiny" />}
        </div>

        {narrow ? (
          <div className="k-explore-tools">
            <Popover positioning="below-end" withArrow>
              <PopoverTrigger disableButtonEnhancement>
                <Button icon={<Filter20Regular />}>表示</Button>
              </PopoverTrigger>
              <PopoverSurface className="k-controls-pop">{controls}</PopoverSurface>
            </Popover>
          </div>
        ) : (
          <Toolbar className="k-explore-tools" aria-label="グラフの見せ方" size="small">
            {controls}
          </Toolbar>
        )}

      </div>

      <div className="k-explore-body" data-bottom={narrow}>
        <div className="k-stage" ref={stageRef}
          onMouseMove={(e) => {
            if (!hoverLink) return;
            const r = stageRef.current!.getBoundingClientRect();
            setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
          }}>
          {/* 経路探し。グラフの上に浮かせ、操作の列を1段に収める */}
          <div className="k-explore-trace">
            <CompanySearch size="medium" includeUnlisted limit={7}
              placeholder="この会社との関係を調べる"
              onPick={trace}
              action={(c) => catalog.get(c)?.kind === 0 ? (
                <Tooltip content="この会社を中心にする" relationship="label">
                  <Button size="small" appearance="subtle" icon={<Target20Regular />}
                    onClick={() => go(href.explore(c))} />
                </Tooltip>
              ) : null} />
          </div>
          {view && (
            <div className="k-stage-graph" data-shown={shown}>
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={view as any}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              warmupTicks={120}
              cooldownTicks={60}
              d3VelocityDecay={0.32}
              onEngineTick={applyPendingFit}
              // 先回しだけで落ち着いて1コマも回らなかったときも、ここで合わせて表示する
              onEngineStop={() => { if (!applyPendingFit()) refit(420, true); }}
              onBackgroundClick={() => setSelected(null)}
              linkColor={(l: any) => {
                if (pathKeys.has(linkKey(l))) return pal.path;
                if (colorBy === 'trade') {
                  if (l.kind === 'trade') return pal.rel[2];
                  if (l.kind === 'hold') return pal.rel[l.rel ?? 0];
                  return pal.rel[0];
                }
                return l.kind === 'trade' ? pal.trade : l.kind === 'major' ? pal.major : l.mutual ? pal.mutual : pal.hold;
              }}
              linkWidth={(l: any) => {
                if (pathKeys.has(linkKey(l))) return 3.6;
                if (l === hoverLink) return 3;
                if (colorBy === 'trade') return (l.kind === 'trade' || (l.kind === 'hold' && l.rel)) ? 1.9 : 0.8;
                return l.kind === 'trade' ? 1.6 : l.kind === 'major' ? 1 : l.mutual ? 1.9 : 1.1;
              }}
              onLinkHover={(l: any) => {
                setHoverLink(l);
                if (l && l.kind === 'hold') ensurePurpose(typeof l.source === 'object' ? l.source.id : l.source);
              }}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={0.99}
              linkCurvature={0.06}
              onNodeClick={(n: any) => setSelected(n.id)}
              onNodeHover={(n: any) => setHovered(n ? n.id : null)}
              nodeCanvasObjectMode={() => 'replace'}
              nodePointerAreaPaint={(n: any, color, ctx, scale) => {
                // 縮小時でも画面上で 16px 角は当たるようにする
                const r = Math.max(n.id === center ? 13 : 9, 16 / (scale || 1));
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fill();
              }}
              nodeCanvasObject={(n: any, ctx, scale) => {
                const isCenter = n.id === center, isSel = n.id === selected, isHov = n.id === hovered;
                const r = isCenter ? 12 : 5 + Math.min(4, Math.sqrt(n.degree));
                const color = sectorHex(n.s17, theme!);
                const img = favicon(n.domain);

                if (isCenter || isSel || isHov) {
                  ctx.beginPath(); ctx.arc(n.x, n.y, r + (isCenter ? 5 : 3.5), 0, 2 * Math.PI);
                  ctx.fillStyle = isCenter ? pal.path : isSel ? pal.path : pal.label;
                  ctx.globalAlpha = isCenter ? 0.22 : isSel ? 0.28 : 0.14;
                  ctx.fill(); ctx.globalAlpha = 1;
                }

                ctx.save();
                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
                if (n.kind !== 0) {
                  // 非上場。淡い塗りと破線の輪郭で上場と区別する
                  ctx.fillStyle = pal.ring; ctx.fill(); ctx.clip();
                  ctx.fillStyle = pal.sub;
                  ctx.font = `600 ${r}px ${pal.font}`;
                  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                  ctx.fillText(n.name.replace(/^株式会社\s*/, '').slice(0, 1), n.x, n.y + 0.5);
                } else if (n.domain && ready(img)) {
                  ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
                  const s = r * 1.5;
                  ctx.drawImage(img!, n.x - s / 2, n.y - s / 2, s, s);
                } else {
                  ctx.fillStyle = color; ctx.fill(); ctx.clip();
                  ctx.fillStyle = '#fff';
                  ctx.font = `700 ${r}px ${pal.font}`;
                  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                  ctx.fillText(n.name.replace(/^株式会社\s*/, '').slice(0, 1), n.x, n.y + 0.5);
                }
                ctx.restore();

                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
                if (n.kind !== 0) {
                  ctx.setLineDash([2.5 / scale, 2 / scale]);
                  ctx.strokeStyle = pal.sub; ctx.lineWidth = 1.1;
                } else {
                  ctx.setLineDash([]);
                  ctx.strokeStyle = isCenter || isSel ? pal.path : color;
                  ctx.lineWidth = isCenter ? 2.4 : isSel ? 2 : 1.4;
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // ラベルは常に画面上 11px。ワールド座標に下限を置くと、拡大時に膨れて重なる
                const showLabel = isCenter || isSel || isHov || scale > 1.7;
                if (!showLabel) return;
                const fs = (11 * settings.fontScale) / scale;
                ctx.font = `${isCenter || isSel ? 600 : 400} ${fs}px ${pal.font}`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                const label = n.name.length > 14 ? `${n.name.slice(0, 13)}…` : n.name;
                const w = ctx.measureText(label).width;
                const pad = 3 / scale, top = n.y + r + pad * 1.4;
                ctx.fillStyle = pal.halo;
                ctx.beginPath();
                const rr = 4 / scale;
                const x0 = n.x - w / 2 - pad * 1.5, y0 = top - pad / 2;
                const bw = w + pad * 3, bh = fs + pad * 1.2;
                ctx.moveTo(x0 + rr, y0);
                ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, rr);
                ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, rr);
                ctx.arcTo(x0, y0 + bh, x0, y0, rr);
                ctx.arcTo(x0, y0, x0 + bw, y0, rr);
                ctx.fill();
                ctx.fillStyle = isCenter || isSel ? pal.label : pal.sub;
                ctx.fillText(label, n.x, top);
              }}
            />
            </div>
          )}

          {/* 凡例 */}
          {!narrow && (
            <div className="k-float k-legend" aria-label="凡例">
              {colorBy === 'trade' ? (
                <>
                  {[1, 2, 3, 4].map((k) => (
                    <div key={k} className="k-legend-row"><i style={{ background: pal.rel[k] }} />{REL_NAME[k]}</div>
                  ))}
                  <div className="k-legend-row k-caption">有報の保有目的に書かれている関係のみ</div>
                </>
              ) : (
                <>
                  <div className="k-legend-row"><i style={{ background: pal.hold }} />政策保有（保有する側 → される側）</div>
                  <div className="k-legend-row"><i style={{ background: pal.mutual }} />持ち合い（相互保有）</div>
                  <div className="k-legend-row"><i style={{ background: pal.trade }} />取引（売る側 → 売上先）</div>
                  <div className="k-legend-row"><i style={{ background: pal.major }} />大株主として記載</div>
                </>
              )}
              {path && path.length > 0 && (
                <div className="k-legend-row"><i style={{ background: pal.path, height: 3 }} />中心から選択中の会社への経路</div>
              )}
              <div className="k-legend-row k-caption">
                <span className="k-legend-dash" />非上場（有報に相手として記載）
              </div>
              <div className="k-legend-count k-caption k-num">
                {view ? `${view.nodes.length} 社 · ${view.links.length} 本` : ''}
                {truncated && ' · 密度で絞り込み中'}
              </div>
            </div>
          )}

          {/* 拡大縮小 */}
          <div className="k-float k-zoom" role="group" aria-label="拡大縮小">
            <Tooltip content="拡大" relationship="label" positioning="before">
              <Button appearance="subtle" icon={<ZoomIn20Regular />}
                onClick={() => { const fg = fgRef.current; fg?.zoom(fg.zoom() * 1.35, 220); }} />
            </Tooltip>
            <Tooltip content="縮小" relationship="label" positioning="before">
              <Button appearance="subtle" icon={<ZoomOut20Regular />}
                onClick={() => { const fg = fgRef.current; fg?.zoom(fg.zoom() / 1.35, 220); }} />
            </Tooltip>
            <Tooltip content="全体を収める" relationship="label" positioning="before">
              <Button appearance="subtle" icon={<ZoomFit20Regular />} onClick={() => refit(360)} />
            </Tooltip>
          </div>

          {(tracing || traceMiss) && (
            <div className="k-float k-toast">
              {tracing ? <Spinner size="tiny" label="つながりを探しています…" /> : (
                <span>{catalog.get(traceMiss!)?.name} との資本のつながりは、有報の範囲では見つかりませんでした</span>
              )}
            </div>
          )}

          {hoverLink && !narrow && (
            <EdgeTip link={hoverLink} catalog={catalog} x={cursor.x} y={cursor.y} lookup={purposeOf} />
          )}
        </div>

        {inspector}
      </div>
    </div>
  );
}

/* ---------------- 見せ方の操作 ---------------- */

function Controls({ depth, setDepth, hold, setHold, major, setMajor, trade, setTrade,
  colorBy, setColorBy, perNode, setPerNode, pal }: {
  depth: 1 | 2; setDepth: (d: 1 | 2) => void;
  hold: boolean; setHold: (f: (v: boolean) => boolean) => void;
  major: boolean; setMajor: (f: (v: boolean) => boolean) => void;
  trade: boolean; setTrade: (f: (v: boolean) => boolean) => void;
  colorBy: 'capital' | 'trade'; setColorBy: (v: 'capital' | 'trade') => void;
  perNode: number; setPerNode: (n: number) => void;
  pal: { hold: string; major: string; trade: string };
}) {
  const dot = (c: string) => <span className="k-swatch" style={{ background: c }} />;
  return (
    <>
      <div className="k-ctl">
        <span className="k-ctl-label">範囲</span>
        <TabList size="small" selectedValue={String(depth)}
          onTabSelect={(_, d) => setDepth(Number(d.value) as 1 | 2)}>
          <Tooltip content="中心と直接つながる会社だけを描く" relationship="description">
            <Tab value="1">1 ホップ</Tab>
          </Tooltip>
          <Tooltip content="つながりの先の会社まで辿る。広いぶん重くなる" relationship="description">
            <Tab value="2">2 ホップ</Tab>
          </Tooltip>
        </TabList>
      </div>
      <ToolbarDivider className="k-ctl-div" />
      <div className="k-ctl">
        <span className="k-ctl-label">関係</span>
        <div className="k-ctl-row">
          <Tooltip content="有報の「特定投資株式の明細」に載る保有関係" relationship="description">
            <ToggleButton size="small" checked={hold} icon={dot(pal.hold)} onClick={() => setHold((v) => !v)}>政策保有</ToggleButton>
          </Tooltip>
          <Tooltip content="有報の「大株主の状況」で上位に名前がある関係" relationship="description">
            <ToggleButton size="small" checked={major} icon={dot(pal.major)} onClick={() => setMajor((v) => !v)}>大株主</ToggleButton>
          </Tooltip>
          <Tooltip content="有報の「主要な顧客ごとの情報」。売上の10%以上を占める顧客に開示義務がある" relationship="description">
            <ToggleButton size="small" checked={trade} icon={dot(pal.trade)} onClick={() => setTrade((v) => !v)}>取引</ToggleButton>
          </Tooltip>
        </div>
      </div>
      <ToolbarDivider className="k-ctl-div" />
      <div className="k-ctl">
        <span className="k-ctl-label">色分け</span>
        <TabList size="small" selectedValue={colorBy} onTabSelect={(_, d) => setColorBy(d.value as 'capital' | 'trade')}>
          <Tab value="capital">資本</Tab>
          <Tooltip content="保有目的から読める取引の性質（仕入先・販売先・提携・金融）で塗る" relationship="description">
            <Tab value="trade">取引の性質</Tab>
          </Tooltip>
        </TabList>
      </div>
      <ToolbarDivider className="k-ctl-div" />
      <div className="k-ctl">
        <Tooltip content="1社から何本まで辿るか。三菱UFJのように754社から保有される銘柄があるため上限が要る" relationship="description">
          <Label className="k-ctl-label" htmlFor="k-density">密度 <span className="k-num">{perNode}</span></Label>
        </Tooltip>
        <Slider id="k-density" size="small" min={3} max={24} value={perNode}
          onChange={(_, d) => setPerNode(d.value)} className="k-ctl-slider" />
      </div>
    </>
  );
}

/* ---------------- 辺の説明 ---------------- */

function EdgeTip({ link, catalog, x, y, lookup }: {
  link: any; catalog: Map<string, NodeRec>; x: number; y: number;
  lookup: (src: string, dst: string) => string | null;
}) {
  const sid = typeof link.source === 'object' ? link.source.id : link.source;
  const tid = typeof link.target === 'object' ? link.target.id : link.target;
  const s = catalog.get(sid), t = catalog.get(tid);
  if (!s || !t) return null;
  const purpose = lookup(sid, tid);
  return (
    <div className="k-float k-edgetip" style={{ left: Math.min(x + 16, 900), top: y + 16 }}>
      <div className="k-edgetip-title">{s.name} <span className="k-muted">→</span> {t.name}</div>
      <div className="k-caption">
        {link.kind === 'trade' ? '主要な取引（売上先）'
          : link.kind === 'major' ? '大株主として記載'
          : link.mutual ? '政策保有（持ち合い）' : '政策保有'}
        {link.value != null && ` · ${oku(link.value)}円`}
        {link.rel ? ` · ${REL_NAME[link.rel]}` : ''}
      </div>
      {purpose && <div className="k-edgetip-quote">{purpose.length > 150 ? `${purpose.slice(0, 150)}…` : purpose}</div>}
    </div>
  );
}

/* ---------------- インスペクタ ---------------- */

function Inspector({ code, rec, center, path, catalog, purposeOf, onFocus, wide, onToggleWide, onClose, narrow }: {
  code: string; rec: NodeRec; center: string; path: Hop[] | null;
  catalog: Map<string, NodeRec>;
  purposeOf: (holder: string, held: string) => string | null;
  onFocus: (code: string) => void;
  wide: boolean; onToggleWide: () => void; onClose: () => void; narrow: boolean;
}) {
  const unlisted = rec.kind !== 0;
  const { detail, loading } = useCompany(unlisted ? null : code);
  const [tab, setTab] = useState<'overview' | 'rel' | 'docs'>('overview');
  const ask = useAsk(code);

  useEffect(() => { setTab('overview'); }, [code]);

  const nRel = detail ? (detail.trade?.length ?? 0) + detail.holdings.length + detail.held_by.length : 0;
  const nDocs = detail ? (detail.events?.length ?? 0) + (detail.filings?.length ?? 0) + (detail.news?.length ?? 0) : 0;

  const onAsk = () => {
    const prompt = buildPrompt({
      rec, code, detail,
      path: path && path.length ? {
        hops: path,
        centerName: catalog.get(center)?.name ?? center,
        nameOf: (c) => catalog.get(c)?.name ?? c,
        purposeOf,
      } : null,
    });
    ask.run(prompt);
  };

  return (
    <>
      <DrawerHeader className="k-insp-head">
        <DrawerHeaderTitle
          action={
            <div style={{ display: 'flex', gap: 2 }}>
              <Tooltip content={wide ? 'パネルを狭める' : 'パネルを広げる'} relationship="label">
                <Button appearance="subtle" onClick={onToggleWide}
                  icon={narrow ? undefined : wide ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />}>
                  {narrow ? (wide ? '縮める' : '広げる') : undefined}
                </Button>
              </Tooltip>
              <Tooltip content="閉じる" relationship="label">
                <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onClose} />
              </Tooltip>
            </div>
          }>
          <span className="k-insp-title">
            <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={36} />
            <span style={{ minWidth: 0 }}>
              <span className="k-insp-name">{rec.name}</span>
              <span className="k-caption">
                {unlisted ? <>非上場 · {rec.s33 || (rec.kind === 1 ? 'EDINET に提出者登録あり' : '有報の記載のみ')}</>
                  : <>{short(code)} · {rec.s33}{code === center ? ' · 中心' : ''}</>}
              </span>
            </span>
          </span>
        </DrawerHeaderTitle>
        {!unlisted && (
          <div className="k-insp-actions">
            {code !== center && (
              <Button appearance="primary" size="small" icon={<Target20Regular />} onClick={() => go(href.explore(code))}>
                中心にする
              </Button>
            )}
            <Button size="small" icon={<BuildingMultiple20Regular />} onClick={() => go(href.company(code))}>
              企業ページ
            </Button>
          </div>
        )}
        {!unlisted && (
          <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as any)} className="k-insp-tabs">
            <Tab value="overview">概要</Tab>
            <Tab value="rel">関係 {nRel > 0 && <CounterBadge count={nRel} size="small" appearance="ghost" color="informative" />}</Tab>
            <Tab value="docs">開示 {nDocs > 0 && <CounterBadge count={nDocs} size="small" appearance="ghost" color="informative" />}</Tab>
          </TabList>
        )}
      </DrawerHeader>

      <DrawerBody className="k-insp-body">
        {unlisted ? (
          <div className="k-insp-sec">
            <p className="k-body-text">
              上場していないため、決算や開示の情報は扱っていません。
              上場企業の有価証券報告書に相手として記載されている関係だけを表示しています。
              この会社を中心にすることはできません。
            </p>
            <Button icon={<Search20Regular />} onClick={() => openSearch(rec.name)}>この会社を Web で検索</Button>
            {path && path.length > 0 && (
              <PathTrace hops={path} catalog={catalog} center={center} purposeOf={purposeOf} onPick={onFocus} />
            )}
          </div>
        ) : loading || !detail ? (
          <div className="k-insp-sec"><Spinner size="small" label="有報の記載を読み込んでいます" /></div>
        ) : tab === 'overview' ? (
          <>
            <div className="k-insp-sec">
              <AskButton state={ask} onClick={onAsk}
                text={path && path.length ? `このつながりを ${ask.label} に聞く` : `この会社を ${ask.label} に聞く`} />
              <AnswerBox state={ask} />
              {!ask.answer && <div className="k-caption" style={{ marginTop: 6 }}>有報から抜いた業績・政策保有・保有目的を添えて渡します</div>}
            </div>

            {path && path.length > 0 && (
              <PathTrace hops={path} catalog={catalog} center={center} purposeOf={purposeOf} onPick={onFocus} />
            )}

            <MiniResults d={detail} wide={wide} />

            <div className="k-insp-sec">
              <div className="k-insp-label">リンク</div>
              <div className="k-linklist">
                {detail.domain && (
                  <Link href={`https://${detail.domain}`} target="_blank" rel="noreferrer">
                    <Globe20Regular /> 公式サイト <span className="k-caption">{detail.domain}</span>
                  </Link>
                )}
                {detail.doc_id && (
                  <Link href={`https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${detail.doc_id}.pdf`} target="_blank" rel="noreferrer">
                    <DocumentPdf20Regular /> 有価証券報告書（PDF） <span className="k-caption">{detail.doc_submitted?.slice(0, 10)}</span>
                  </Link>
                )}
                {detail.doc_id && (
                  <Link href={`https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${detail.doc_id}`} target="_blank" rel="noreferrer">
                    <Document20Regular /> EDINET 書類詳細
                  </Link>
                )}
                <Link href={`https://finance.yahoo.co.jp/quote/${short(code)}.T`} target="_blank" rel="noreferrer">
                  <ChartMultiple20Regular /> 株価・IR（Yahoo!ファイナンス）
                </Link>
              </div>
            </div>
          </>
        ) : tab === 'rel' ? (
          <RelTab d={detail} onFocus={onFocus} />
        ) : (
          <DocsTab d={detail} />
        )}
      </DrawerBody>
    </>
  );
}

function MiniResults({ d, wide }: { d: Detail; wide: boolean }) {
  const cur = d.results?.[0];
  const cells: [string, string, string?][] = [
    ['売上高', oku(d.sales)],
    ['営業利益', oku(d.op), pct(d.op_margin)],
    ['純利益', oku(d.np)],
    ['自己資本比率', pct(d.equity_ratio)],
    ['ROE', pct(cur?.roe)],
    ['従業員', cur?.employees != null ? `${cur.employees.toLocaleString()}人` : '—'],
  ];
  return (
    <div className="k-insp-sec">
      <div className="k-insp-label">
        業績 {cur && <span className="k-caption">{cur.label}期{d.basis ? ` · ${d.basis}` : ''}</span>}
      </div>
      <div className="k-kpis" data-cols={wide ? 3 : 2}>
        {cells.map(([k, v, sub]) => (
          <div key={k} className="k-kpi">
            <div className="k-caption">{k}</div>
            <div className="k-kpi-v k-num">{v}</div>
            {sub && <div className="k-caption">利益率 {sub}</div>}
          </div>
        ))}
      </div>
      <Button appearance="transparent" size="small" icon={<ArrowRight16Regular />} iconPosition="after"
        onClick={() => go(href.company(d.code))}>5期の推移を企業ページで見る</Button>
    </div>
  );
}

function RelTab({ d, onFocus }: { d: Detail; onFocus: (code: string) => void }) {
  const LIMIT = 12;
  const more = (n: number) => n > LIMIT && (
    <Button appearance="transparent" size="small" icon={<Open16Regular />} iconPosition="after"
      onClick={() => go(href.company(d.code))}>ほか {n - LIMIT} 件は企業ページで</Button>
  );
  return (
    <>
      <div className="k-insp-sec">
        <div className="k-insp-label">取引関係 <Badge appearance="ghost">{d.trade?.length ?? 0}</Badge></div>
        {d.trade?.length ? d.trade.slice(0, LIMIT).map((t, i) => (
          <TradeRow key={i} rel={t} onOpen={t.code ? () => onFocus(t.code!) : undefined} />
        )) : <Empty>有報に主要な取引先の記載がありません</Empty>}
        {more(d.trade?.length ?? 0)}
      </div>
      <div className="k-insp-sec">
        <div className="k-insp-label">政策保有している銘柄 <Badge appearance="ghost">{d.n_holdings}</Badge></div>
        {d.holdings.length ? d.holdings.slice(0, LIMIT).map((h, i) => (
          <HoldingRow key={i} code={h.code} name={h.name || h.raw} value={h.value}
            purpose={h.purpose} mutual={h.mutual} onOpen={h.code ? () => onFocus(h.code!) : undefined} />
        )) : <Empty>政策保有株の記載がありません</Empty>}
        {more(d.holdings.length)}
      </div>
      <div className="k-insp-sec">
        <div className="k-insp-label">この会社を保有している企業 <Badge appearance="ghost">{d.n_held_by}</Badge></div>
        {d.held_by.length ? d.held_by.slice(0, LIMIT).map((h, i) => (
          <HoldingRow key={i} code={h.code} name={h.name} value={h.value}
            purpose={h.purpose} mutual={h.mutual} onOpen={() => onFocus(h.code)} />
        )) : <Empty>ほかの上場企業の有報に、保有先として載っていません</Empty>}
        {more(d.held_by.length)}
      </div>
    </>
  );
}

function DocsTab({ d }: { d: Detail }) {
  return (
    <>
      <div className="k-insp-sec">
        <div className="k-insp-label">最近の出来事（臨時報告書）</div>
        {d.events?.length ? d.events.slice(0, 6).map((e, i) => <EventRow key={i} ev={e} />)
          : <Empty>直近1年の臨時報告書はありません</Empty>}
      </div>
      <div className="k-insp-sec">
        <div className="k-insp-label">最近の提出書類（EDINET）</div>
        {d.filings?.length ? d.filings.slice(0, 8).map((f, i) => <FilingRow key={i} f={f} />)
          : <Empty>記録がありません</Empty>}
      </div>
      {d.news.length > 0 && (
        <div className="k-insp-sec">
          <div className="k-insp-label">最近のニュース</div>
          {d.news.slice(0, 6).map((n, i) => <NewsRow key={i} n={n} />)}
        </div>
      )}
    </>
  );
}

/** 中心から選択した会社までの道筋。有報の言葉で経由地を示す */
function PathTrace({ hops, catalog, center, purposeOf, onPick }: {
  hops: Hop[]; catalog: Map<string, NodeRec>; center: string;
  purposeOf: (holder: string, held: string) => string | null;
  onPick: (code: string) => void;
}) {
  const node = (code: string, tag?: string) => {
    const rec = catalog.get(code);
    if (!rec) return null;
    return (
      <button className="k-path-node" onClick={() => onPick(code)}>
        <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={22} />
        <span className="k-ellipsis">{rec.name}</span>
        {tag && <Badge appearance="tint" size="small" color={tag === '中心' ? 'brand' : 'informative'}>{tag}</Badge>}
      </button>
    );
  };
  return (
    <div className="k-insp-sec k-path">
      <div className="k-insp-label">中心とのつながり <Badge appearance="ghost">{hops.length} ホップ</Badge></div>
      {node(center, '中心')}
      {hops.map((h, i) => {
        const holder = h.forward ? h.from : h.to;
        const held = h.forward ? h.to : h.from;
        const hn = catalog.get(holder)?.name ?? holder, dn = catalog.get(held)?.name ?? held;
        const purpose = h.link.kind === 'hold' ? purposeOf(holder, held) : null;
        return (
          <div key={i}>
            <div className="k-path-edge" data-kind={h.link.kind} data-mutual={h.link.mutual}>
              <div className="k-path-tag">
                {h.link.kind === 'trade' ? `${hn} の主要な売上先が ${dn}`
                  : h.link.kind === 'major' ? `${hn} が ${dn} の大株主`
                  : `${hn} が ${dn} を政策保有`}
                {h.link.mutual && <Badge appearance="tint" color="success" size="small">持ち合い</Badge>}
                {h.link.value != null && <span className="k-num k-caption">{oku(h.link.value)}</span>}
              </div>
              {purpose && <div className="k-path-quote">「{purpose}」</div>}
            </div>
            {node(h.to, i === hops.length - 1 ? '選択中' : undefined)}
          </div>
        );
      })}
    </div>
  );
}
