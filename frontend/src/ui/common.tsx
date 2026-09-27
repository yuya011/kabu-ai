/* 画面をまたいで使う小さな部品と、数値の整形。 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button, Tooltip, type Theme } from '@fluentui/react-components';
import { Search16Regular } from '@fluentui/react-icons';
import { favicon, ready, onFaviconLoad } from '../browser/favicon';
import { openSearch } from '../browser/search';
import { sectorVar } from '../theme';

/* ---------------- 整形 ---------------- */

export const oku = (v: number | null | undefined) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(a / 1e8 >= 100 ? 0 : 1)}億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
};
export const pct = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(d)}%`;
export const signedPct = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

/** 4桁の証券コード。Yahoo!ファイナンス等は5桁目の 0 を落とした形を使う */
export const short = (code: string) => code.slice(0, 4);

/** チップに出す社名。法人格は落とす。押した先に正式名称が出る */
export const trimCo = (n: string) => n
  .replace(/^株式会社\s*/, '')
  .replace(/\s*株式会社$/, '')
  .trim();

/* ---------------- テーマ ----------------
   キャンバスは CSS 変数を読めないので、解決済みのテーマを文脈で配る */

export const ThemeCtx = createContext<{ theme: Theme | null; mode: 'light' | 'dark' }>({ theme: null, mode: 'light' });
export const useKTheme = () => useContext(ThemeCtx);

/* ---------------- 企業のアイコン ----------------
   ファビコンが取れれば角丸の四角に入れ、取れなければ業種色に頭文字を置く。
   Fluent の Avatar（square）と同じ寸法の段を使う。 */

export function Favi({ domain, name, s17, size = 24 }: {
  domain?: string | null; name: string; s17: string; size?: number;
}) {
  const img = domain ? favicon(domain) : null;
  const [, bump] = useState(0);
  useEffect(() => onFaviconLoad(() => bump((n) => n + 1)), []);
  const radius = size >= 40 ? 8 : size >= 28 ? 6 : 4;
  if (domain && ready(img)) {
    return (
      <span className="k-favi" style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius }}>
        <img src={img!.src} alt="" style={{ width: size * 0.72, height: size * 0.72 }} />
      </span>
    );
  }
  return (
    <span className="k-favi k-favi-letter"
      style={{
        width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius,
        background: sectorVar(s17), fontSize: size * 0.46,
      }}>
      {trimCo(name).slice(0, 1)}
    </span>
  );
}

/** 業種の色の点 */
export const SectorDot = ({ s17, size = 8 }: { s17: string; size?: number }) => (
  <span className="k-dot" style={{ background: sectorVar(s17), width: size, height: size, flex: `0 0 ${size}px` }} />
);

/** 社名で外部検索を開く小さなボタン。
    非上場の相手はこちらに情報が無いので、名前を渡して外で調べてもらう。 */
export function SearchOut({ name }: { name: string }) {
  return (
    <Tooltip content="この社名で Web 検索" relationship="label" withArrow>
      <Button size="small" appearance="subtle" icon={<Search16Regular />}
        onClick={(e) => { e.stopPropagation(); openSearch(name); }} />
    </Tooltip>
  );
}

/** 見出し。Fluent の Subtitle に説明を添える */
export function SectionTitle({ icon, title, note, action }: {
  icon?: ReactNode; title: string; note?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="k-sectitle">
      {icon && <span className="k-sectitle-ico">{icon}</span>}
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        {note && <div className="k-caption">{note}</div>}
      </div>
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </div>
  );
}

/** 押すと開閉する長文。保有目的などは長いので、既定は2行で畳む */
export function Clamp({ children, lines = 2, quote }: { children: ReactNode; lines?: number; quote?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`k-clamp${quote ? ' k-quote' : ''}`} data-open={open}
      style={{ ['--lines' as any]: lines }}
      role="button" tabIndex={0}
      aria-expanded={open}
      title={open ? '閉じる' : '全文を開く'}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}>
      {children}
    </div>
  );
}
