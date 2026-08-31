import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  Search, X, ArrowLeft, ExternalLink, FileText, LineChart,
  Globe, Network, Loader2, Building2, Newspaper, ChevronsLeft, ChevronsRight,
  SlidersHorizontal, CornerDownRight, Route, Crosshair, Sparkles, Check,
  ScrollText, Info,
} from 'lucide-react';
import './apple.css';
import type { Detail, TradeRelation } from './types';
import {
  AdjStore, buildEgo, shortestPath, findPath, linkKey,
  type GNode, type GLink, type NodeRec, type Hop,
} from './graph';
import { fetchJSON, loadIndex } from './cache';
import { favicon, ready, onFaviconLoad } from './favicon';
import { useMedia } from './useMedia';
import { buildPrompt, askGemini } from './prompt';

const BASE = `${import.meta.env.BASE_URL}data/browser`;

const SECTOR_COLORS = [
  '#007aff', '#34c759', '#ff9500', '#5856d6',
  '#30b0c7', '#ff2d55', '#ffcc00', '#ff3b30', '#8e8e93',
];
const sectorColor = (s17: string) => {
  const n = parseInt(s17, 10);
  return SECTOR_COLORS[(Number.isFinite(n) ? n : s17.length) % SECTOR_COLORS.length];
};

const oku = (v: number | null | undefined) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(a / 1e8 >= 100 ? 0 : 1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
};
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);

/* 4桁の証券コード。Yahoo!ファイナンス等は5桁目の 0 を落とした形を使う */
const short = (code: string) => code.slice(0, 4);

/** ホバーで説明を出す薄いラッパ。CSS の ::after で描くので DOM を増やさない。 */
function Tip({ tip, pos, children, style }: {
  tip: string;
  pos?: 'top' | 'left';
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span className="ap-tip" data-tip={tip} data-tip-pos={pos}
      style={{ display: 'inline-flex', alignItems: 'center', ...style }}>
      {children}
    </span>
  );
}

function Favi({ domain, name, color, size = 22 }: {
  domain: string; name: string; color: string; size?: number;
}) {
  const img = favicon(domain);
  const [, bump] = useState(0);
  useEffect(() => onFaviconLoad(() => bump((n) => n + 1)), []);
  if (domain && ready(img)) {
    return <img className="ap-favi" src={img!.src} alt="" style={{ width: size, height: size, flex: `0 0 ${size}px` }} />;
  }
  return (
    <span className="ap-favi-fallback" style={{ background: color, width: size, height: size, flex: `0 0 ${size}px`, fontSize: size * 0.5 }}>
      {name.slice(0, 1)}
    </span>
  );
}

/** 保有目的から読める取引の性質。番号は書き出し側と合わせてある */
const REL_NAME: Record<number, string> = {
  1: '仕入先', 2: '販売先', 3: '業務提携', 4: '金融取引',
};

/* ---------------- 検索起点のトップ ---------------- */
function Launch({ catalog, onPick, onOpenBrowser }: {
  catalog: Map<string, NodeRec>;
  onPick: (code: string) => void;
  onOpenBrowser: () => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out: [string, NodeRec][] = [];
    for (const [code, rec] of catalog) {
      // 中心に置けるのは上場企業だけなので、検索も上場に絞る
      if (rec.kind !== 0) continue;
      if (code.startsWith(s) || rec.name.toLowerCase().includes(s)) {
        out.push([code, rec]);
        if (out.length >= 40) break;
      }
    }
    // 打った文字で始まる社名を上に寄せる
    out.sort((a, b) => {
      const as = a[1].name.toLowerCase().startsWith(s) ? 0 : 1;
      const bs = b[1].name.toLowerCase().startsWith(s) ? 0 : 1;
      return as - bs || a[1].name.length - b[1].name.length;
    });
    return out.slice(0, 8);
  }, [q, catalog]);

  const examples = ['83060', '72030', '67580', '99840', '45680', '80580'];

  return (
    <div className="ap ap-launch">
      <div className="ap-launch-inner ap-in">
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <h1 className="ap-large-title" style={{ fontSize: 32 }}>企業のつながりを見る</h1>
          <p className="ap-footnote" style={{ marginTop: 7 }}>
            社名を入れると、その会社を中心に資本のつながりを描きます。
            有価証券報告書の政策保有株と大株主が出典です。
          </p>
        </div>

        <div className="ap-bigsearch">
          <Search size={19} className="ter" />
          <input
            ref={inputRef}
            value={q}
            placeholder="社名または証券コード"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0][0]); }}
          />
          {q && <X size={17} className="ter" onClick={() => setQ('')} style={{ cursor: 'default' }} />}
        </div>

        {results.length > 0 && (
          <div className="ap-suggest">
            {results.map(([code, rec]) => (
              <div key={code} className="ap-row" data-tap="true" onClick={() => onPick(code)}>
                <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} />
                <span className="ap-headline">{rec.name}</span>
                <span className="ap-footnote">{rec.s33}</span>
                <span className="ap-num ter" style={{ marginLeft: 'auto', fontSize: 11 }}>{short(code)}</span>
              </div>
            ))}
          </div>
        )}

        {!q && (
          <>
            <div className="ap-chips">
              {examples.map((c) => {
                const rec = catalog.get(c);
                if (!rec) return null;
                return (
                  <button key={c} className="ap-chip" onClick={() => onPick(c)}>
                    <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} size={14} />
                    {rec.name}
                  </button>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', marginTop: 30 }}>
              <button className="ap-btn ap-btn-plain" onClick={onOpenBrowser}>
                <Building2 size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                業種から一覧で探す
              </button>
            </div>

            {/* 公共データ利用規約(PDL1.0)は出典と、加工した旨の明記を求めている */}
            <div className="ap-footnote" style={{ textAlign: 'center', marginTop: 34, lineHeight: 1.7 }}>
              <Info size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              出典：<a href="https://disclosure2.edinet-fsa.go.jp/" target="_blank" rel="noreferrer"
                style={{ color: 'var(--blue)' }}>EDINET閲覧サイト</a>（金融庁）、
              <a href="https://disclosure2dl.edinet-fsa.go.jp/guide/static/submit/WZEK0030.html"
                target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>PDL1.0</a>
              <br />
              有価証券報告書の政策保有株・大株主・主要な顧客・株式事務の記載をもとに作成
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 取引1件の行。方向は企業自身の記載から読んだもので、こちらで推測していない。 */
function TradeRow({ rel, onClick }: { rel: TradeRelation; onClick?: () => void }) {
  const [open, setOpen] = useState(false);
  const tone = rel.direction === '仕入先' ? 'ap-badge-blue'
    : rel.direction === '販売先' ? 'ap-badge-red' : 'ap-badge-green';
  return (
    <div className="ap-row" data-tap={!!onClick}
      style={{ padding: '8px 16px', flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className={`ap-badge ${tone}`} style={{ flex: '0 0 auto' }}>{rel.direction}</span>
        <span className="ap-body" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}
          onClick={onClick}>
          {rel.name}
        </span>
        {rel.segment && <span className="ap-badge">{rel.segment}</span>}
        {rel.amount != null && (
          <span className="ap-num sec" style={{ marginLeft: 'auto', fontSize: 11 }}>{oku(rel.amount)}</span>
        )}
      </div>
      {rel.note && (
        <div className="ap-footnote ap-purpose" data-open={open}
          onClick={() => setOpen((v) => !v)} title={open ? '閉じる' : '全文を開く'}>
          「{rel.note}」
        </div>
      )}
      <div className="ap-caption">{rel.source}</div>
    </div>
  );
}

/** 保有1件の行。有報に書かれた保有目的をそのまま出す。
    エッジの理由は企業自身が書いているので、こちらで文章を作らない。 */
function HoldingRow({ name, value, purpose, mutual, onClick }: {
  name: string; value: number | null;
  purpose: string | null; mutual: string | null;
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ap-row" data-tap={!!onClick}
      style={{ padding: '8px 16px', flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span className="ap-body" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}
          onClick={onClick}>
          {name}
        </span>
        {mutual === '有' && (
          <Tip tip="相手も自社株を保有している（持ち合い）" pos="left">
            <span className="ap-badge ap-badge-blue">持ち合い</span>
          </Tip>
        )}
        <span className="ap-num sec" style={{ marginLeft: 'auto', fontSize: 11 }}>{oku(value)}</span>
      </div>
      {purpose && (
        <div className="ap-footnote ap-purpose" data-open={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? '閉じる' : '全文を開く'}>
          {purpose}
        </div>
      )}
    </div>
  );
}

/** 中心企業から選択した会社までの道筋。
    直接つながっていない相手でも、どこを経由して繋がっているかを有報の言葉で示す。 */
function PathTrace({ hops, catalog, center, purposeOf, onPick }: {
  hops: Hop[];
  catalog: Map<string, NodeRec>;
  center: string;
  purposeOf: (holder: string, held: string) => string | null;
  onPick: (code: string) => void;
}) {
  const node = (code: string, label?: string) => {
    const rec = catalog.get(code);
    if (!rec) return null;
    return (
      <div className="ap-path-node" onClick={() => onPick(code)}>
        <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} size={18} />
        <span className="ap-headline">{rec.name}</span>
        {label && <span className="ap-badge" style={{ marginLeft: 'auto' }}>{label}</span>}
      </div>
    );
  };

  return (
    <div className="ap-path">
      <div className="ap-sidebar-label" style={{ padding: '0 0 8px' }}>
        <Route size={11} style={{ verticalAlign: -1, marginRight: 5 }} />
        中心とのつながり（{hops.length} ホップ）
      </div>
      {node(center, '中心')}
      {hops.map((h, i) => {
        const holder = h.forward ? h.from : h.to;
        const held = h.forward ? h.to : h.from;
        const holderName = catalog.get(holder)?.name ?? holder;
        const heldName = catalog.get(held)?.name ?? held;
        const purpose = h.link.kind === 'hold' ? purposeOf(holder, held) : null;
        return (
          <div key={i}>
            <div className="ap-path-edge" data-kind={h.link.kind} data-mutual={h.link.mutual}>
              <div className="ap-path-tag">
                <CornerDownRight size={11} />
                {h.link.kind === 'trade'
                  ? `${holderName} の主要な売上先が ${heldName}`
                  : h.link.kind === 'major'
                  ? `${holderName} が ${heldName} の大株主`
                  : `${holderName} が ${heldName} を政策保有`}
                {h.link.mutual && <span className="ap-badge ap-badge-blue">持ち合い</span>}
                {h.link.value != null && <span className="ap-num sec">{oku(h.link.value)}</span>}
              </div>
              {purpose && <div className="ap-footnote ap-path-quote">「{purpose}」</div>}
            </div>
            {node(h.to, i === hops.length - 1 ? '選択中' : undefined)}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- インスペクタ ---------------- */
function Inspector({ code, catalog, detail, onClose, onCenter, wide, onToggleWide, width,
  path, center, purposeOf, onAsk, asked }: {
  code: string;
  catalog: Map<string, NodeRec>;
  detail: Detail | null;
  onClose: () => void;
  onCenter: (code: string) => void;
  wide: boolean;
  onToggleWide: () => void;
  width: number;
  path: Hop[] | null;
  center: string;
  purposeOf: (holder: string, held: string) => string | null;
  onAsk: () => void;
  asked: 'copied' | 'opened' | null;
}) {
  const rec = catalog.get(code);
  if (!rec) return null;
  const unlisted = rec.kind !== 0;
  const site = detail?.domain ? `https://${detail.domain}` : null;
  const pdf = detail?.doc_id
    ? `https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${detail.doc_id}.pdf` : null;
  const edinet = detail?.doc_id
    ? `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${detail.doc_id}` : null;

  return (
    <div className="ap-float ap-inspector ap-in" data-wide={wide}
      style={{ ['--inspector-w' as any]: `${width}px` }}>
      <div className="ap-inspector-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ap-title3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rec.name}
            </div>
            <div className="ap-footnote">
              {unlisted ? (
                <>
                  <span className="ap-badge">非上場</span>{' '}
                  {rec.s33 || (rec.kind === 1 ? 'EDINET に提出者登録あり' : '有報の記載のみ')}
                </>
              ) : (
                <>{rec.s33} · {short(code)}</>
              )}
            </div>
          </div>
          <Tip tip={wide ? 'パネルを狭める' : 'パネルを広げる'} pos="left">
            <button className="ap-btn ap-btn-plain" onClick={onToggleWide} style={{ padding: 3 }}>
              {wide ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
            </button>
          </Tip>
          <X size={15} className="ter" onClick={onClose} style={{ cursor: 'default' }} />
        </div>
      </div>

      <div className="ap-inspector-body">
        {unlisted && (
          <div className="ap-footnote" style={{ padding: '12px 16px', lineHeight: 1.6 }}>
            上場していないため、決算や開示の情報は扱っていません。
            上場企業の有価証券報告書に相手として記載されている関係だけを表示しています。
            この会社を中心にすることはできません。
          </div>
        )}

        {!unlisted && (
        <><button className="ap-ask" onClick={onAsk} disabled={!detail}>
          {asked ? <Check size={13} /> : <Sparkles size={13} />}
          {asked === 'copied' ? 'プロンプトをコピーしました'
            : asked === 'opened' ? 'Gemini を開きました'
            : path && path.length > 0 ? 'このつながりを Gemini に聞く' : 'この会社を Gemini に聞く'}
        </button>
        <div className="ap-footnote" style={{ padding: '0 16px 10px' }}>
          有報から抜いた決算・政策保有・保有目的を添えて開きます
        </div></>
        )}

        {path && path.length > 0 && (
          <PathTrace hops={path} catalog={catalog} center={center}
            purposeOf={purposeOf} onPick={onCenter} />
        )}
        {site && (
          <a className="ap-linkbtn" href={site} target="_blank" rel="noreferrer"
            title="有価証券報告書に記載された電子公告の掲載先ドメイン">
            <Globe size={13} className="sec" /> 公式サイト
            <span className="ap-footnote" style={{ marginLeft: 'auto' }}>{detail!.domain}</span>
            <ExternalLink size={11} className="ter" />
          </a>
        )}
        {pdf && (
          <a className="ap-linkbtn" href={pdf} target="_blank" rel="noreferrer"
            title="EDINET から直接ダウンロードします">
            <FileText size={13} className="sec" /> 有価証券報告書 (PDF)
            <span className="ap-footnote" style={{ marginLeft: 'auto' }}>{detail!.doc_submitted?.slice(0, 10)}</span>
            <ExternalLink size={11} className="ter" />
          </a>
        )}
        {edinet && (
          <a className="ap-linkbtn" href={edinet} target="_blank" rel="noreferrer">
            <FileText size={13} className="sec" /> EDINET 書類詳細
            <ExternalLink size={11} className="ter" style={{ marginLeft: 'auto' }} />
          </a>
        )}
        {!unlisted && (
        <a className="ap-linkbtn" href={`https://finance.yahoo.co.jp/quote/${short(code)}.T`}
          target="_blank" rel="noreferrer">
          <LineChart size={13} className="sec" /> 株価・IR (Yahoo!ファイナンス)
          <ExternalLink size={11} className="ter" style={{ marginLeft: 'auto' }} />
        </a>
        )}

        {detail && (
          <>
            <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>業績</div>
            <dl className="ap-kvgrid" style={{ margin: 0 }}>
              <div className="ap-kv"><dt>売上高</dt><dd className="ap-num">{oku(detail.sales)}</dd></div>
              <div className="ap-kv"><dt>営業利益</dt><dd className="ap-num">{oku(detail.op)}</dd></div>
              <div className="ap-kv"><dt>営業利益率</dt><dd className="ap-num">{pct(detail.op_margin)}</dd></div>
              <div className="ap-kv"><dt>自己資本比率</dt><dd className="ap-num">{pct(detail.equity_ratio)}</dd></div>
              <div className="ap-kv"><dt>市場</dt><dd>{detail.market || '—'}</dd></div>
              <div className="ap-kv"><dt>決算期</dt><dd>{detail.fiscal_year_end || '—'}</dd></div>
            </dl>

            {detail.news.length > 0 && (
              <>
                <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>
                  最近のニュース
                </div>
                {detail.news.slice(0, 6).map((n, i) => (
                  <a key={i} className="ap-linkbtn" href={n.link} target="_blank" rel="noreferrer"
                    style={{ alignItems: 'flex-start', gap: 9 }}>
                    <Newspaper size={13} className="sec" style={{ marginTop: 2, flex: '0 0 13px' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', lineHeight: 1.4 }}>{n.title}</span>
                      <span className="ap-footnote">{n.published} · {n.source}</span>
                    </span>
                  </a>
                ))}
              </>
            )}

            {detail.filings?.length > 0 && (
              <>
                <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>
                  最近の開示（EDINET）
                </div>
                {detail.filings.slice(0, 6).map((f, i) => (
                  <a key={i} className="ap-linkbtn"
                    href={`https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${f.doc_id}.pdf`}
                    target="_blank" rel="noreferrer" style={{ alignItems: 'flex-start', gap: 9 }}>
                    <ScrollText size={13} className="sec" style={{ marginTop: 2, flex: '0 0 13px' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', lineHeight: 1.4 }}>{f.title}</span>
                      <span className="ap-footnote">{f.submitted}</span>
                    </span>
                  </a>
                ))}
              </>
            )}

            {detail.trade?.length > 0 && (
              <>
                <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>
                  取引関係 {detail.trade.length}
                </div>
                {detail.trade.slice(0, 12).map((t, i) => (
                  <TradeRow key={i} rel={t}
                    onClick={t.code ? () => onCenter(t.code!) : undefined} />
                ))}
              </>
            )}

            {detail.holdings.length > 0 && (
              <>
                <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>
                  政策保有している銘柄 {detail.n_holdings}
                </div>
                {detail.holdings.slice(0, 8).map((h, i) => (
                  <HoldingRow key={i} name={h.name || h.raw} value={h.value}
                    purpose={h.purpose} mutual={h.mutual}
                    onClick={h.code ? () => onCenter(h.code!) : undefined} />
                ))}
              </>
            )}

            {detail.held_by.length > 0 && (
              <>
                <div className="ap-sidebar-label" style={{ padding: '14px 16px 5px' }}>
                  この会社を保有している企業 {detail.n_held_by}
                </div>
                {detail.held_by.slice(0, 8).map((h, i) => (
                  <HoldingRow key={i} name={h.name} value={h.value}
                    purpose={h.purpose} mutual={h.mutual}
                    onClick={() => onCenter(h.code)} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 辺にカーソルを当てたときの説明。政策保有なら有報の保有目的を出す。 */
function EdgeTip({ link, catalog, x, y, lookup }: {
  link: any; catalog: Map<string, NodeRec>;
  x: number; y: number;
  lookup: (src: string, dst: string) => string | null;
}) {
  const sid = typeof link.source === 'object' ? link.source.id : link.source;
  const tid = typeof link.target === 'object' ? link.target.id : link.target;
  const s = catalog.get(sid), t = catalog.get(tid);
  if (!s || !t) return null;
  const purpose = lookup(sid, tid);
  return (
    <div className="ap-float ap-edgetip ap-in"
      style={{ left: Math.min(x + 14, 900), top: y + 14 }}>
      <div className="ap-headline" style={{ marginBottom: 4 }}>
        {s.name} <span className="ter">→</span> {t.name}
      </div>
      <div className="ap-footnote">
        {link.kind === 'trade' ? '主要な取引（売上先）'
          : link.kind === 'major' ? '大株主として記載'
          : link.mutual ? '政策保有（持ち合い）' : '政策保有'}
        {link.value != null && ` · ${oku(link.value)}円`}
      </div>
      {purpose && (
        <div className="ap-footnote" style={{ marginTop: 6, lineHeight: 1.5, color: 'var(--label)' }}>
          {purpose.length > 150 ? `${purpose.slice(0, 150)}…` : purpose}
        </div>
      )}
    </div>
  );
}

/** ホップ数・エッジ種別・密度。狭い画面では折り畳んだ中に入る。 */
function Controls({ depth, setDepth, hold, setHold, major, setMajor,
  trade, setTrade, colorBy, setColorBy, perNode, setPerNode }: {
  depth: 1 | 2; setDepth: (d: 1 | 2) => void;
  hold: boolean; setHold: (f: (v: boolean) => boolean) => void;
  major: boolean; setMajor: (f: (v: boolean) => boolean) => void;
  trade: boolean; setTrade: (f: (v: boolean) => boolean) => void;
  colorBy: 'capital' | 'trade'; setColorBy: (v: 'capital' | 'trade') => void;
  perNode: number; setPerNode: (n: number) => void;
}) {
  return (
    <>
      <div className="ap-segmented">
        <Tip tip="中心企業と直接つながる会社だけを描く">
          <button className="ap-seg" data-on={depth === 1} onClick={() => setDepth(1)}>1ホップ</button>
        </Tip>
        <Tip tip="つながりの先の会社まで辿る。広いぶん重くなる">
          <button className="ap-seg" data-on={depth === 2} onClick={() => setDepth(2)}>2ホップ</button>
        </Tip>
      </div>
      <div className="ap-segmented">
        <Tip tip="有報の「特定投資株式の明細」に載る保有関係">
          <button className="ap-seg" data-on={hold} onClick={() => setHold((v) => !v)}>政策保有</button>
        </Tip>
        <Tip tip="有報の「大株主の状況」で上位に名前がある関係">
          <button className="ap-seg" data-on={major} onClick={() => setMajor((v) => !v)}>大株主</button>
        </Tip>
        <Tip tip="有報の「主要な顧客ごとの情報」。売上の10%以上を占める顧客に開示義務がある">
          <button className="ap-seg" data-on={trade} onClick={() => setTrade((v) => !v)}>取引</button>
        </Tip>
      </div>
      <Tip tip="同じ辺を、資本の種別で塗るか、有報の保有目的から読める取引の性質で塗るか">
        <div className="ap-segmented">
          <button className="ap-seg" data-on={colorBy === 'capital'}
            onClick={() => setColorBy('capital')}>資本で見る</button>
          <button className="ap-seg" data-on={colorBy === 'trade'}
            onClick={() => setColorBy('trade')}>取引で見る</button>
        </div>
      </Tip>
      <Tip tip="1社から何本まで辿るか。三菱UFJのように754社から保有される銘柄があるため上限が要る">
        <label className="ap-footnote" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          密度
          <input type="range" min={3} max={24} value={perNode} style={{ width: 78 }}
            onChange={(e) => setPerNode(Number(e.target.value))} />
          <span className="ap-num" style={{ width: 16 }}>{perNode}</span>
        </label>
      </Tip>
    </>
  );
}

/* ---------------- 本体 ---------------- */
export default function GraphExplorer({ onOpenBrowser }: { onOpenBrowser: () => void }) {
  const [catalog, setCatalog] = useState<Map<string, NodeRec> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState<string | null>(null);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [hold, setHold] = useState(true);
  const [major, setMajor] = useState(true);
  const [trade, setTrade] = useState(true);
  /* 同じ辺を『資本の種別』で塗るか『取引の性質』で塗るか */
  const [colorBy, setColorBy] = useState<'capital' | 'trade'>('capital');
  const [perNode, setPerNode] = useState(10);
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [truncated, setTruncated] = useState(false);
  /* 密度で間引かれて画面にいない会社を選んだとき、経路だけを描き足す。
     ego グラフを作り直しても消えないよう別に持つ。 */
  const [extra, setExtra] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceMiss, setTraceMiss] = useState<string | null>(null);
  const [asked, setAsked] = useState<'copied' | 'opened' | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<any>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const purposeCache = useRef(new Map<string, string | null>());
  const purposeLoaded = useRef(new Set<string>());
  const [, bumpPurpose] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState('');
  const [wideInspector, setWideInspector] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const compact = useMedia('(max-width: 820px)');

  const store = useRef(new AdjStore());
  const shardCache = useRef(new Map<string, Record<string, Detail>>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(0);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [, bumpFavicon] = useState(0);

  const dark = useMemo(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false, []);

  useEffect(() => onFaviconLoad(() => bumpFavicon((n) => n + 1)), []);

  const inspectorW = wideInspector ? 620 : 408;
  const panelSpace = inspectorW + 28;
  // 縦型ではシートが下を覆うので、描画高そのものを削る。
  // 削らないと zoomToFit が画面全体に収めてしまい、見えている帯の中で潰れる。
  const sheetPx = compact && selected
    ? Math.round(size.h * (wideInspector ? 0.82 : 0.52)) + 20 : 0;
  const canvasW = compact ? size.w : Math.max(320, size.w - (selected ? panelSpace : 0));
  const topInset = compact ? toolbarH + 18 : 0;
  const canvasH = Math.max(200, size.h - sheetPx - topInset);

  /* 収まりの取り直し。余白と拡大率の上限は画面の広さに合わせる。
     固定値だと、狭い画面で余白ばかりになりグラフが豆粒になる。 */
  const refit = useCallback((ms = 380) => {
    const fg = fgRef.current;
    if (!fg) return;
    const shortSide = Math.min(canvasW, canvasH);
    fg.zoomToFit(ms, Math.max(16, Math.round(shortSide * 0.07)));
    const cap = compact ? 4.2 : 2.2;
    setTimeout(() => { if (fg.zoom() > cap) fg.zoom(cap, 240); }, ms + 40);
  }, [canvasW, canvasH, compact]);

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => refit(300), 60);
    return () => clearTimeout(t);
  }, [selected === null, wideInspector, compact, showControls, data, refit]);

  // 既定の力だと中心付近で団子になるので、反発を強めて辺を長くする
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !data) return;
    fg.d3Force('charge')?.strength(-230).distanceMax(520);
    fg.d3Force('link')?.distance(78).strength(0.55);
  }, [data]);

  useEffect(() => {
    loadIndex<any>(`${BASE}/index.json`)
      .then((j) => {
        const m = new Map<string, NodeRec>();
        for (const [code, name, s17, s33, domain, kind] of j.nodes) {
          m.set(code, { name, s17, s33, domain, kind: kind ?? 0 });
        }
        setCatalog(m);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [center]);

  // ツールバーは浮いているので、その高さぶんキャンバスを下げないと上端が隠れる。
  // 段数が開閉で変わるため実測する。
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setToolbarH(e.contentRect.height));
    ro.observe(el);
    setToolbarH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [center, compact, showControls, query]);

  useEffect(() => {
    if (!center || !catalog) return;
    let cancelled = false;
    setBusy(true);
    buildEgo(center, catalog, store.current,
      { depth, hold, major, trade, perNode, maxNodes: 220 })
      .then((g) => {
        if (cancelled) return;
        setData({ nodes: g.nodes, links: g.links });
        setTruncated(g.truncated);
        setBusy(false);
      });
    return () => { cancelled = true; };
  }, [center, catalog, depth, hold, major, trade, perNode]);

  /** 企業シャードを1度だけ取り、その会社の保有目的をまとめて控える。 */
  const loadShard = useCallback(async (code: string) => {
    const prefix = code.slice(0, 2);
    let shard = shardCache.current.get(prefix);
    if (!shard) {
      shard = await fetchJSON<Record<string, Detail>>(`${BASE}/companies/${prefix}.json`)
        .catch(() => ({} as Record<string, Detail>));
      shardCache.current.set(prefix, shard!);
    }
    return shard!;
  }, []);

  /** 辺の理由は保有元の有報に書かれているので、保有元のシャードから引く。 */
  const ensurePurpose = useCallback(async (src: string) => {
    if (purposeLoaded.current.has(src)) return;
    purposeLoaded.current.add(src);
    const shard = await loadShard(src);
    const d = shard[src];
    if (d?.holdings) {
      for (const h of d.holdings) {
        if (h.code) purposeCache.current.set(`${src}>${h.code}`, h.purpose);
      }
      bumpPurpose((n) => n + 1);
    }
  }, [loadShard]);

  const loadDetail = useCallback(async (code: string) => {
    // 企業詳細のシャードは上場企業ぶんしか無い。非上場を引きに行くと 404 になる
    if (catalog?.get(code)?.kind !== 0) {
      setDetail(null);
      return;
    }
    const shard = await loadShard(code);
    setDetail(shard[code] ?? null);
    ensurePurpose(code);
  }, [loadShard, ensurePurpose, catalog]);

  const pick = useCallback((code: string) => {
    setCenter(code); setSelected(code); setDetail(null); setQuery('');
    setExtra(null); setTraceMiss(null);
    loadDetail(code);
  }, [loadDetail]);

  /* 中心は変えずに選ぶ。画面にいない会社なら、グラフ全体を辿って
     経路を見つけ、その道筋だけを描き足す。 */
  const trace = useCallback(async (code: string) => {
    setQuery(''); setTraceMiss(null);
    setSelected(code); setAsked(null);
    loadDetail(code);
    if (!center || code === center) return;
    if (data?.nodes.some((n) => n.id === code)) return;

    setTracing(true);
    try {
      const hops = await findPath(center, code, store.current, catalog!, {});
      if (!hops) {
        setTraceMiss(code);
        return;
      }
      const ids = new Set<string>([center]);
      for (const h of hops) { ids.add(h.from); ids.add(h.to); }
      const nodes: GNode[] = [...ids].map((id) => {
        const rec = catalog!.get(id)!;
        return { id, depth: 1, name: rec.name, s17: rec.s17, s33: rec.s33,
                 domain: rec.domain, kind: rec.kind, degree: 2 };
      });
      setExtra({ nodes, links: hops.map((h) => h.link) });
    } finally {
      setTracing(false);
    }
  }, [center, data, catalog, loadDetail]);

  const view = useMemo(() => {
    if (!data) return null;
    if (!extra) return data;
    const ids = new Set(data.nodes.map((n) => n.id));
    const keys = new Set(data.links.map(linkKey));
    return {
      nodes: [...data.nodes, ...extra.nodes.filter((n) => !ids.has(n.id))],
      links: [...data.links, ...extra.links.filter((l) => !keys.has(linkKey(l)))],
    };
  }, [data, extra]);

  /* 中心から選択までの経路。描かれている辺だけで求めるので、
     画面に出ていない道筋を説明してしまうことがない。 */
  const path = useMemo(() => {
    if (!view || !center || !selected || selected === center) return null;
    return shortestPath(view.links, center, selected);
  }, [view, center, selected]);

  const pathKeys = useMemo(
    () => new Set((path ?? []).map((h) => linkKey(h.link))), [path]);

  // 経路上の各ホップの保有目的を、保有元のシャードから引いておく
  useEffect(() => {
    if (!path) return;
    for (const h of path) {
      if (h.link.kind !== 'hold') continue;
      ensurePurpose(h.forward ? h.from : h.to);
    }
  }, [path, ensurePurpose]);

  const ask = useCallback(async () => {
    if (!selected || !catalog) return;
    const rec = catalog.get(selected);
    if (!rec) return;
    const prompt = buildPrompt({
      rec, code: selected, detail,
      path: path && center ? {
        hops: path,
        centerName: catalog.get(center)?.name ?? center,
        nameOf: (c) => catalog.get(c)?.name ?? c,
        purposeOf: (h, d) => purposeCache.current.get(`${h}>${d}`) ?? null,
      } : null,
    });
    setAsked(await askGemini(prompt));
    setTimeout(() => setAsked(null), 3200);
  }, [selected, catalog, detail, path, center]);

  const purposeOf = useCallback(
    (holder: string, held: string) => purposeCache.current.get(`${holder}>${held}`) ?? null,
    []);

  const results = useMemo(() => {
    if (!catalog) return [];
    const s = query.trim().toLowerCase();
    if (!s) return [];
    const out: [string, NodeRec][] = [];
    for (const [code, rec] of catalog) {
      if (rec.kind !== 0) continue;
      if (code.startsWith(s) || rec.name.toLowerCase().includes(s)) out.push([code, rec]);
      if (out.length >= 30) break;
    }
    return out.slice(0, 7);
  }, [query, catalog]);

  if (error) {
    return (
      <div className="ap" style={{ padding: 40 }}>
        <h1 className="ap-title1">データを読み込めません</h1>
        <p className="ap-footnote" style={{ marginTop: 8 }}>
          {error} — <code>python scripts/export_browser_json.py</code> を実行してください。
        </p>
      </div>
    );
  }
  if (!catalog) {
    return <div className="ap" style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <div className="ap-footnote">読み込み中…</div>
    </div>;
  }
  if (!center) {
    return <Launch catalog={catalog} onPick={pick} onOpenBrowser={onOpenBrowser} />;
  }

  const palette = dark
    ? { label: '#fff', sub: 'rgba(235,235,245,0.65)', hold: 'rgba(10,132,255,0.42)',
        major: 'rgba(255,159,10,0.5)', mutual: 'rgba(50,215,75,0.5)',
        trade: 'rgba(255,55,95,0.5)',
        rel: { 1: 'rgba(191,90,242,0.62)', 2: 'rgba(255,55,95,0.58)',
               3: 'rgba(50,215,75,0.58)', 4: 'rgba(255,159,10,0.55)',
               0: 'rgba(120,120,128,0.22)' } as Record<number, string>,
        path: '#5e5ce6', ring: '#1c1c1e', halo: 'rgba(28,28,30,0.82)' }
    : { label: '#000', sub: 'rgba(60,60,67,0.7)', hold: 'rgba(0,122,255,0.34)',
        major: 'rgba(255,149,0,0.45)', mutual: 'rgba(52,199,89,0.5)',
        trade: 'rgba(255,45,85,0.45)',
        rel: { 1: 'rgba(175,82,222,0.6)', 2: 'rgba(255,45,85,0.55)',
               3: 'rgba(52,199,89,0.55)', 4: 'rgba(255,149,0,0.5)',
               0: 'rgba(120,120,128,0.18)' } as Record<number, string>,
        path: '#5856d6', ring: '#fff', halo: 'rgba(255,255,255,0.86)' };

  const centerRec = catalog.get(center)!;

  return (
    <div className="ap ap-shell" style={{ flexDirection: 'column' }}>
      <div className="ap-graph-wrap" ref={wrapRef}
        onMouseMove={(e) => {
          if (!hoverLink) return;
          const r = wrapRef.current!.getBoundingClientRect();
          setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}>
        {view && (
          <div style={{ position: 'absolute', top: topInset, left: 0 }}>
          <ForceGraph2D
            ref={fgRef}
            width={canvasW}
            height={canvasH}
            graphData={view as any}
            backgroundColor="rgba(0,0,0,0)"
            nodeId="id"
            cooldownTicks={90}
            d3VelocityDecay={0.32}
            onEngineStop={() => refit(420)}
            linkColor={(l: any) => {
              if (pathKeys.has(linkKey(l))) return palette.path;
              if (colorBy === 'trade') {
                // 取引の性質で塗る。政策保有以外は商流の情報を持たないので薄く沈める
                if (l.kind === 'trade') return palette.rel[2];
                if (l.kind === 'hold') return palette.rel[l.rel ?? 0];
                return palette.rel[0];
              }
              return l.kind === 'trade' ? palette.trade
                : l.kind === 'major' ? palette.major
                : l.mutual ? palette.mutual : palette.hold;
            }}
            linkWidth={(l: any) => {
              if (pathKeys.has(linkKey(l))) return 3.4;
              if (l === hoverLink) return 3;
              if (colorBy === 'trade') {
                return (l.kind === 'trade' || (l.kind === 'hold' && l.rel)) ? 1.9 : 0.8;
              }
              return l.kind === 'trade' ? 1.6 : l.kind === 'major' ? 1 : l.mutual ? 1.8 : 1.1;
            }}
            onLinkHover={(l: any) => {
              setHoverLink(l);
              if (l && l.kind === 'hold') {
                ensurePurpose(typeof l.source === 'object' ? l.source.id : l.source);
              }
            }}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={0.99}
            linkCurvature={0.06}
            onNodeClick={(n: any) => { setSelected(n.id); loadDetail(n.id); }}
            onNodeHover={(n: any) => setHovered(n ? n.id : null)}
            nodeCanvasObjectMode={() => 'replace'}
            nodePointerAreaPaint={(n: any, color, ctx, scale) => {
              // 世界座標のままだと縮小時に数ピクセルになり、指でもマウスでも当たらない。
              // 画面上で最低 16px 角を確保する。
              const r = Math.max(n.id === center ? 13 : 9, 16 / (scale || 1));
              ctx.fillStyle = color;
              ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fill();
            }}
            nodeCanvasObject={(n: any, ctx, scale) => {
              const isCenter = n.id === center;
              const isSel = n.id === selected;
              const isHov = n.id === hovered;
              const r = isCenter ? 11 : 5 + Math.min(4, Math.sqrt(n.degree));
              const color = sectorColor(n.s17);
              const img = favicon(n.domain);

              if (isCenter || isSel || isHov) {
                ctx.beginPath(); ctx.arc(n.x, n.y, r + 3.5, 0, 2 * Math.PI);
                ctx.fillStyle = isCenter ? color : palette.label;
                ctx.globalAlpha = isCenter ? 0.3 : 0.18;
                ctx.fill(); ctx.globalAlpha = 1;
              }

              ctx.save();
              ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
              if (n.kind !== 0) {
                // 非上場。ドメインが分からずファビコンも引けないので、
                // 淡い塗りと破線の輪郭で上場と区別する
                ctx.fillStyle = palette.ring; ctx.fill();
                ctx.clip();
                ctx.fillStyle = palette.sub;
                ctx.font = `600 ${r}px -apple-system, "Hiragino Sans", sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(n.name.slice(0, 1), n.x, n.y + 0.5);
              } else if (n.domain && ready(img)) {
                ctx.fillStyle = palette.ring; ctx.fill();
                ctx.clip();
                ctx.drawImage(img!, n.x - r, n.y - r, r * 2, r * 2);
              } else {
                ctx.fillStyle = color; ctx.fill();
                ctx.clip();
                ctx.fillStyle = '#fff';
                ctx.font = `700 ${r}px -apple-system, "Hiragino Sans", sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(n.name.slice(0, 1), n.x, n.y + 0.5);
              }
              ctx.restore();

              ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
              if (n.kind !== 0) {
                ctx.setLineDash([2.5 / scale, 2 / scale]);
                ctx.strokeStyle = palette.sub; ctx.lineWidth = 1.1;
              } else {
                ctx.setLineDash([]);
                ctx.strokeStyle = palette.ring; ctx.lineWidth = 1.4;
              }
              ctx.stroke();
              ctx.setLineDash([]);

              // ラベルは常に画面上 11px。ワールド座標に下限を置くと、
              // ズームインしたときに画面上で数倍に膨れて全部重なる。
              const showLabel = isCenter || isSel || isHov || scale > 1.7;
              if (!showLabel) return;
              const fs = 11 / scale;
              ctx.font = `${isCenter ? 600 : 500} ${fs}px -apple-system, "Hiragino Sans", sans-serif`;
              ctx.textAlign = 'center'; ctx.textBaseline = 'top';
              const label = n.name.length > 14 ? `${n.name.slice(0, 13)}…` : n.name;
              const w = ctx.measureText(label).width;
              const pad = 3 / scale;
              const top = n.y + r + pad;
              ctx.fillStyle = palette.halo;
              ctx.beginPath();
              const rr = 3 / scale;
              const x0 = n.x - w / 2 - pad, y0 = top - pad / 2;
              const bw = w + pad * 2, bh = fs + pad;
              ctx.moveTo(x0 + rr, y0);
              ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, rr);
              ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, rr);
              ctx.arcTo(x0, y0 + bh, x0, y0, rr);
              ctx.arcTo(x0, y0, x0 + bw, y0, rr);
              ctx.fill();
              ctx.fillStyle = isCenter || isSel ? palette.label : palette.sub;
              ctx.fillText(label, n.x, top);
            }}
          />
          </div>
        )}

        {/* ツールバー */}
        <div className="ap-float ap-graph-toolbar" ref={toolbarRef}>
          <div className="ap-tb-row">
            <Tip tip="検索に戻る">
              <button className="ap-btn ap-btn-plain" onClick={() => { setCenter(null); setData(null); setSelected(null); }}>
                <ArrowLeft size={14} />
              </button>
            </Tip>
            <Favi domain={centerRec.domain} name={centerRec.name} color={sectorColor(centerRec.s17)} size={20} />
            <span className="ap-title3" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {centerRec.name}
            </span>
            {busy && <Loader2 size={13} className="ter" style={{ animation: 'spin 1s linear infinite' }} />}

            {compact ? (
              <Tip tip="表示の設定" pos="top" style={{ marginLeft: 'auto' }}>
                <button className="ap-btn" onClick={() => setShowControls((v) => !v)}
                  style={showControls ? { background: 'var(--blue)', color: '#fff' } : undefined}>
                  <SlidersHorizontal size={13} />
                </button>
              </Tip>
            ) : (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <Controls {...{ depth, setDepth, hold, setHold, major, setMajor, trade, setTrade, colorBy, setColorBy, perNode, setPerNode }} />
                <div className="ap-search" style={{ minWidth: 168 }}>
                  <Search size={13} className="ter" />
                  <input value={query} placeholder="関係を調べる会社"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) trace(results[0][0]); }} />
                </div>
              </div>
            )}
          </div>

          {compact && (
            <div className="ap-search">
              <Search size={13} className="ter" />
              <input value={query} placeholder="関係を調べる会社"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) trace(results[0][0]); }} />
              {query && <X size={13} className="ter" onClick={() => setQuery('')} />}
            </div>
          )}

          {compact && showControls && (
            <div className="ap-tb-row ap-tb-wrap">
              <Controls {...{ depth, setDepth, hold, setHold, major, setMajor, trade, setTrade, colorBy, setColorBy, perNode, setPerNode }} />
            </div>
          )}

          {results.length > 0 && (
            <div className="ap-suggest" style={{
              position: 'absolute', top: '100%',
              right: compact ? 10 : 12, left: compact ? 10 : 'auto',
              width: compact ? 'auto' : 300, marginTop: 6,
            }}>
              {results.map(([code, rec]) => (
                <div key={code} className="ap-row" data-tap="true" onClick={() => trace(code)}>
                  <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} size={18} />
                  <span className="ap-body" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec.name}
                  </span>
                  <Tip tip="この会社を中心にする" pos="left" style={{ marginLeft: 'auto' }}>
                    <button className="ap-btn" style={{ padding: '3px 7px' }}
                      onClick={(e) => { e.stopPropagation(); pick(code); }}>
                      <Crosshair size={12} />
                    </button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 凡例 */}
        <div className="ap-float ap-graph-legend">
          {colorBy === 'trade' ? (
            <>
              {[1, 2, 3, 4].map((k) => (
                <div key={k} className="ap-legend-row">
                  <span className="ap-legend-line" style={{ background: palette.rel[k] }} /> {REL_NAME[k]}
                </div>
              ))}
              <div className="ap-legend-row ter">有報の保有目的に書かれている関係のみ</div>
            </>
          ) : (
            <>
              <div className="ap-legend-row">
                <span className="ap-legend-line" style={{ background: palette.hold }} /> 政策保有（保有する側 → される側）
              </div>
              <div className="ap-legend-row">
                <span className="ap-legend-line" style={{ background: palette.mutual }} /> 政策保有のうち持ち合い（相互保有）
              </div>
              <div className="ap-legend-row">
                <span className="ap-legend-line" style={{ background: palette.trade }} /> 取引（売上先 ← 売る側）
              </div>
              <div className="ap-legend-row">
                <span className="ap-legend-line" style={{ background: palette.major }} /> 大株主として記載
              </div>
            </>
          )}
          {path && path.length > 0 && (
            <div className="ap-legend-row">
              <span className="ap-legend-line" style={{ background: palette.path, height: 3 }} /> 中心から選択中の会社への経路
            </div>
          )}
          <div className="ap-legend-row ter" style={{ marginTop: 2 }}>
            {view ? `${view.nodes.length} 社 / ${view.links.length} 本` : ''}
            {truncated && ' · 密度で絞り込み中'}
          </div>
        </div>

        {(tracing || traceMiss) && (
          <div className="ap-float ap-graph-actions ap-in"
            style={compact ? undefined
              : { left: `calc(50% - ${panelSpace / 2}px)`, transform: 'translateX(-50%)' }}>
            {tracing ? (
              <>
                <Loader2 size={14} className="ter" style={{ animation: 'spin 1s linear infinite' }} />
                <span className="ap-footnote">つながりを探しています…</span>
              </>
            ) : (
              <span className="ap-footnote">
                {catalog.get(traceMiss!)?.name} との資本のつながりは、有報の範囲では見つかりませんでした
              </span>
            )}
          </div>
        )}

        {hoverLink && (
          <EdgeTip link={hoverLink} catalog={catalog} x={cursor.x} y={cursor.y}
            lookup={(src, dst) => purposeCache.current.get(`${src}>${dst}`) ?? null} />
        )}

        {selected && selected !== center && (() => {
          const rec = catalog.get(selected);
          if (!rec || rec.kind !== 0) return null;  // 非上場は中心に置けない
          return (
            <div className="ap-float ap-graph-actions ap-in"
              style={compact ? undefined
                : { left: `calc(50% - ${panelSpace / 2}px)`, transform: 'translateX(-50%)' }}>
              <Favi domain={rec.domain} name={rec.name} color={sectorColor(rec.s17)} size={20} />
              <span className="ap-headline" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {rec.name}
              </span>
              <Tip tip="この会社を中心に描き直します" pos="top">
                <button className="ap-action-primary" onClick={() => pick(selected)}>
                  <Network size={12} /> 中心にする
                </button>
              </Tip>
            </div>
          );
        })()}

        {selected && (
          <Inspector code={selected} catalog={catalog} detail={detail}
            onClose={() => setSelected(null)} onCenter={pick}
            wide={wideInspector} onToggleWide={() => setWideInspector((v) => !v)}
            width={inspectorW} path={path} center={center} purposeOf={purposeOf}
            onAsk={ask} asked={asked} />
        )}
      </div>
    </div>
  );
}
