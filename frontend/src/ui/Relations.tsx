/* 関係の行。グラフのインスペクタと企業ページで同じものを使う。

   関係の理由は企業自身が有報に書いた文章をそのまま出し、こちらで文章を作らない。
   長いので既定では2行で畳み、押すと全文を開く。 */

import { Badge, Tooltip, Link } from '@fluentui/react-components';
import {
  ChevronRight16Regular, Megaphone20Regular, DocumentText20Regular, Open16Regular,
} from '@fluentui/react-icons';
import { useData } from '../data';
import type { EventItem, FilingItem, TradeRelation, NewsItem } from '../browser/types';
import { Clamp, Favi, SearchOut, oku } from './common';

/** 名前の頭に置くアイコン。上場企業ならファビコン、そうでなければ頭文字 */
function Who({ code, name }: { code: string | null | undefined; name: string }) {
  const { data } = useData();
  const rec = code ? data?.catalog.get(code) : undefined;
  return <Favi domain={rec?.domain} name={name} s17={rec?.s17 ?? '0'} size={24} />;
}

export function HoldingRow({ code, name, value, purpose, mutual, shares, onOpen }: {
  code: string | null; name: string; value: number | null;
  purpose: string | null; mutual: string | null; shares?: number | null;
  onOpen?: () => void;
}) {
  return (
    <div className="k-rel" data-tap={!!onOpen} onClick={onOpen}
      role={onOpen ? 'link' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => { if (onOpen && e.key === 'Enter') onOpen(); }}>
      <div className="k-rel-head">
        <Who code={code} name={name} />
        <span className="k-rel-name">{name}</span>
        {mutual === '有' && (
          <Tooltip content="相手もこの会社の株を保有している（持ち合い）" relationship="description">
            <Badge appearance="tint" color="success" size="small">持ち合い</Badge>
          </Tooltip>
        )}
        {!code && <Badge appearance="outline" color="informative" size="small">非上場</Badge>}
        <span className="k-rel-value k-num">
          {shares != null && <span className="k-caption">{shares.toLocaleString()} 株 · </span>}
          {oku(value)}
        </span>
        <SearchOut name={name} />
        {onOpen && <ChevronRight16Regular className="k-muted" />}
      </div>
      {purpose && <Clamp quote>{purpose}</Clamp>}
    </div>
  );
}

const DIR_COLOR: Record<string, 'brand' | 'danger' | 'success' | 'informative'> = {
  仕入先: 'brand', 販売先: 'danger', 業務提携: 'success',
};

export function TradeRow({ rel, onOpen }: { rel: TradeRelation; onOpen?: () => void }) {
  const name = rel.name ?? '—';
  return (
    <div className="k-rel" data-tap={!!onOpen} onClick={onOpen}
      role={onOpen ? 'link' : undefined} tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => { if (onOpen && e.key === 'Enter') onOpen(); }}>
      <div className="k-rel-head">
        <Who code={rel.code} name={name} />
        <Badge appearance="tint" color={DIR_COLOR[rel.direction] ?? 'informative'} size="small">{rel.direction}</Badge>
        <span className="k-rel-name">{name}</span>
        {rel.segment && (
          <Badge appearance="outline" color="informative" size="small" className="k-rel-seg" title={rel.segment}>
            {rel.segment}
          </Badge>
        )}
        {rel.amount != null && <span className="k-rel-value k-num">{oku(rel.amount)}</span>}
        <SearchOut name={name} />
        {onOpen && <ChevronRight16Regular className="k-muted" />}
      </div>
      {rel.note && <Clamp quote>{rel.note}</Clamp>}
      <div className="k-caption k-rel-src">{rel.source}</div>
    </div>
  );
}

/** 臨時報告書1件。提出理由は法令の条項を引く定型文なので、出来事の本文を出す */
export function EventRow({ ev }: { ev: EventItem }) {
  return (
    <div className="k-rel">
      <div className="k-rel-head">
        <span className="k-rel-ico"><Megaphone20Regular /></span>
        <span className="k-rel-name">{ev.kind}</span>
        <Link className="k-rel-value k-num" href={`https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${ev.doc_id}.pdf`}
          target="_blank" rel="noreferrer">{ev.submitted?.slice(0, 10)}</Link>
      </div>
      <Clamp>{ev.body}</Clamp>
    </div>
  );
}

export function FilingRow({ f }: { f: FilingItem }) {
  return (
    <a className="k-rel k-rel-link" data-tap="true"
      href={`https://disclosure2dl.edinet-fsa.go.jp/searchdocument/pdf/${f.doc_id}.pdf`}
      target="_blank" rel="noreferrer">
      <div className="k-rel-head">
        <span className="k-rel-ico"><DocumentText20Regular /></span>
        <span className="k-rel-name k-rel-wrap">{f.title}</span>
        <span className="k-rel-value k-num k-caption">{f.submitted?.slice(0, 10)}</span>
        <Open16Regular className="k-muted" />
      </div>
    </a>
  );
}

export function NewsRow({ n }: { n: NewsItem }) {
  return (
    <a className="k-rel k-rel-link" data-tap="true" href={n.link} target="_blank" rel="noreferrer">
      <div className="k-rel-head" style={{ alignItems: 'flex-start' }}>
        <span className="k-rel-name k-rel-wrap">{n.title}</span>
        <Open16Regular className="k-muted" />
      </div>
      <div className="k-caption">{n.published} · {n.source}</div>
    </a>
  );
}

/** 空のときの一文。何も無いことと、読み込み中を区別する */
export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="k-empty-line k-caption">{children}</div>
);
