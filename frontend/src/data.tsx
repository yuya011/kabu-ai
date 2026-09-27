/* 配信データの読み口。

   索引（index.json）は全画面が使うので、起動時に1度だけ読んで配る。
   以前はグラフと一覧がそれぞれ読み直していた。IndexedDB に入っているので
   通信は起きないが、1万件の社名表を二重に組み立てていた。

   企業の詳細はシャード（証券コードの頭2桁）ごとに取り、ここで控える。
   グラフのインスペクタと企業ページが同じシャードを引いても、取りに行くのは1回。 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchJSON, loadIndex } from './browser/cache';
import type { BrowserIndex, Detail, SectorFile } from './browser/types';
import type { NodeRec } from './browser/graph';
import { match, norm } from './browser/nameKey';

export const BASE = `${import.meta.env.BASE_URL}data/browser`;

export interface Source {
  name: string; url: string; license: string; license_url: string; note?: string;
}

export interface AppData {
  index: BrowserIndex & { sources?: Source[] };
  /** 上場・非上場を含む全ノード。グラフの描画と検索に使う */
  catalog: Map<string, NodeRec>;
  /** 上場企業だけ。検索の既定の母集団 */
  listed: [string, NodeRec][];
}

const Ctx = createContext<{ data: AppData | null; error: string | null }>({ data: null, error: null });

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex<any>(`${BASE}/index.json`)
      .then((j) => {
        const catalog = new Map<string, NodeRec>();
        const listed: [string, NodeRec][] = [];
        for (const [code, name, s17, s33, domain, kind, keys, exact, size] of j.nodes) {
          const rec: NodeRec = { name, s17, s33, domain, kind: kind ?? 0, keys, exact, size };
          catalog.set(code, rec);
          if (rec.kind === 0) listed.push([code, rec]);
        }
        setData({ index: j, catalog, listed });
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  return <Ctx.Provider value={{ data, error }}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);

/* ---------------- 企業シャード ---------------- */

const shards = new Map<string, Promise<Record<string, Detail>>>();

function shard(prefix: string) {
  let p = shards.get(prefix);
  if (!p) {
    p = fetchJSON<Record<string, Detail>>(`${BASE}/companies/${prefix}.json`)
      .catch(() => ({} as Record<string, Detail>));
    shards.set(prefix, p);
  }
  return p;
}

/** 上場企業の詳細。非上場や未収録は null */
export async function loadCompany(code: string): Promise<Detail | null> {
  const s = await shard(code.slice(0, 2));
  return s[code] ?? null;
}

/** 企業詳細を購読する。コードが変われば読み直す */
export function useCompany(code: string | null): { detail: Detail | null; loading: boolean } {
  const [state, setState] = useState<{ code: string | null; detail: Detail | null }>({ code: null, detail: null });
  useEffect(() => {
    if (!code) return;
    let alive = true;
    loadCompany(code).then((d) => { if (alive) setState({ code, detail: d }); });
    return () => { alive = false; };
  }, [code]);
  const loading = !!code && state.code !== code;
  return { detail: loading ? null : state.detail, loading };
}

/* ---------------- 業種ファイル ---------------- */

const sectors = new Map<string, Promise<SectorFile>>();

export function loadSector(s17: string): Promise<SectorFile> {
  let p = sectors.get(s17);
  if (!p) {
    p = fetchJSON<SectorFile>(`${BASE}/sectors/${s17}.json`);
    p.catch(() => sectors.delete(s17));
    sectors.set(s17, p);
  }
  return p;
}

/* ---------------- 社名の検索 ---------------- */

/* 社名は norm した形を控える。1万社ぶんを打鍵のたびに潰し直さないため */
const normed = new WeakMap<NodeRec, string>();
function baseKey(rec: NodeRec): string {
  let v = normed.get(rec);
  if (v === undefined) { v = norm(rec.name); normed.set(rec, v); }
  return v;
}

/** 社名・証券コードで引く。表記ゆれ・ヨミ・英字名・略称も拾う（browser/nameKey.ts）。
    打ち間違いの救済は、ほかに当たりが無いときだけ出す */
export function searchCompanies(pool: [string, NodeRec][], query: string, limit = 8): [string, NodeRec][] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const q = norm(raw) || raw.replace(/\s+/g, '');
  const scored: [number, number, [string, NodeRec]][] = [];
  let fuzzyOnly = true;
  for (const row of pool) {
    const [code, rec] = row;
    const m: [number, number] | null = code.startsWith(raw)
      ? [code === raw || code === `${raw}0` ? 0 : 1, 0]
      : match(q, baseKey(rec), rec.keys, rec.exact);
    if (!m) continue;
    if (m[0] < 4) fuzzyOnly = false;
    scored.push([m[0], m[1], row]);
  }
  return scored
    .filter(([r]) => fuzzyOnly || r < 4)
    // 一致の強さ、次に会社の大きさ（資本金）、社名の短さ
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]
      || (b[2][1].size ?? 0) - (a[2][1].size ?? 0) || a[2][1].name.length - b[2][1].name.length)
    .slice(0, limit)
    .map(([, , row]) => row);
}
