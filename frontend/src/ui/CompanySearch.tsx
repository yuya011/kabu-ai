/* 社名・証券コードの検索。ヘッダー・ホーム・グラフで同じものを使う。

   Fluent の SearchBox に、候補の一覧（ARIA の combobox / listbox）を付けたもの。
   Combobox 部品は選択肢を全部 DOM に並べる作りで、1万社を渡すと重い。
   ここでは打った文字で先に絞り、上位だけを描く。 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { SearchBox } from '@fluentui/react-components';
import { useData, searchCompanies } from '../data';
import type { NodeRec } from '../browser/graph';
import { Favi, short } from './common';

export function CompanySearch({
  onPick, placeholder = '社名または証券コード', size = 'medium', autoFocus,
  includeUnlisted = false, action, className, limit = 8, inline = false,
}: {
  onPick: (code: string) => void;
  placeholder?: string;
  size?: 'small' | 'medium' | 'large';
  autoFocus?: boolean;
  /** 非上場（有報に相手として出てくるだけの会社）も候補に含める */
  includeUnlisted?: boolean;
  /** 候補の行の右端に置く操作 */
  action?: (code: string) => ReactNode;
  className?: string;
  limit?: number;
  /** 候補を浮かせず、下に流し込む（ホームの大きな検索） */
  inline?: boolean;
}) {
  const { data } = useData();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useRef(`k-sugg-${Math.random().toString(36).slice(2, 8)}`).current;

  const pool = useMemo<[string, NodeRec][]>(() => {
    if (!data) return [];
    return includeUnlisted ? [...data.catalog] : data.listed;
  }, [data, includeUnlisted]);

  const results = useMemo(() => searchCompanies(pool, q, limit), [pool, q, limit]);
  const show = open && results.length > 0;

  const pick = (code: string) => {
    setQ(''); setOpen(false); setActive(0);
    onPick(code);
  };

  return (
    <div className={`k-search ${className ?? ''}`} data-size={size} data-inline={inline}>
      <SearchBox
        size={size}
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        onChange={(_, d) => { setQ(d.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % results.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(results[active][0]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
      />
      {show && (
        <div className="k-suggest" id={listId} role="listbox">
          {results.map(([code, rec], i) => (
            <div key={code} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className="k-suggest-row" data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(code)}>
              <Favi domain={rec.domain} name={rec.name} s17={rec.s17} size={28} />
              <span className="k-suggest-main">
                <span className="k-suggest-name">{rec.name}</span>
                <span className="k-caption">
                  {rec.kind === 0 ? `${short(code)} · ${rec.s33}` : '非上場'}
                </span>
              </span>
              {action && <span className="k-suggest-action" onClick={(e) => e.stopPropagation()}>{action(code)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
