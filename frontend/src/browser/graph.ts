/* 近傍グラフの組み立て。
   隣接リストはシャードで配信されているので、必要なぶんだけ取りに行く。 */

export interface NodeRec {
  name: string;
  s17: string;
  s33: string;
  domain: string;
}

export interface Adj {
  /** [相手コード, 貸借対照表計上額, 持ち合いなら1, 取引の性質(0..4)] */
  ho: [string, number | null, number, number?][]; // 政策保有している先
  hi: [string, number | null, number, number?][]; // 政策保有されている元
  mo: string[];                          // 大株主として名を連ねている先
  mi: string[];                          // 大株主に入っている上場企業
  /** [相手コード, 売上高] 有報「主要な顧客ごとの情報」より */
  co?: [string, number | null][];        // 主要顧客として挙げている先
  ci?: [string, number | null][];        // この会社を主要顧客に挙げている元
}

export interface GNode {
  id: string;
  name: string;
  s17: string;
  s33: string;
  domain: string;
  depth: number;
  degree: number;
}

export type EdgeKind = 'hold' | 'major' | 'trade';

export interface GLink {
  source: string;
  target: string;
  kind: EdgeKind;
  value: number | null;
  /** 相手も自社株を持っている（有報の「発行者による提出会社の株式の保有の有無」） */
  mutual: boolean;
  /** 保有目的から読める取引の性質。1=仕入先 2=販売先 3=業務提携 4=金融取引 */
  rel?: number;
}

export interface EgoOptions {
  depth: 1 | 2;
  hold: boolean;
  major: boolean;
  trade: boolean;
  /** 1ノードあたりに展開する隣接数の上限。三菱UFJのように754社から保有される銘柄があるため必須 */
  perNode: number;
  /** グラフ全体のノード上限 */
  maxNodes: number;
}

import { fetchJSON } from './cache';

const BASE = `${import.meta.env.BASE_URL}data/browser`;

export class AdjStore {
  private shards = new Map<string, Record<string, Adj>>();
  private inflight = new Map<string, Promise<void>>();

  async ensure(codes: string[]) {
    const prefixes = [...new Set(codes.map((c) => c.slice(0, 2)))]
      .filter((p) => !this.shards.has(p));
    await Promise.all(prefixes.map((p) => this.load(p)));
  }

  private load(prefix: string) {
    const running = this.inflight.get(prefix);
    if (running) return running;
    const task = fetchJSON<Record<string, Adj>>(`${BASE}/graph/${prefix}.json`)
      .then((j) => { this.shards.set(prefix, j); })
      .catch(() => { this.shards.set(prefix, {}); })
      .finally(() => { this.inflight.delete(prefix); });
    this.inflight.set(prefix, task);
    return task;
  }

  get(code: string): Adj | undefined {
    return this.shards.get(code.slice(0, 2))?.[code];
  }
}

/** 中心企業から depth ホップの近傍を組み立てる。 */
export async function buildEgo(
  center: string,
  catalog: Map<string, NodeRec>,
  store: AdjStore,
  opt: EgoOptions,
): Promise<{ nodes: GNode[]; links: GLink[]; truncated: boolean }> {
  const depthOf = new Map<string, number>([[center, 0]]);
  const linkMap = new Map<string, GLink>();
  let truncated = false;

  const addLink = (s: string, t: string, kind: EdgeKind, value: number | null,
                   mutual = false, rel = 0) => {
    const key = `${s}>${t}>${kind}`;
    if (!linkMap.has(key)) linkMap.set(key, { source: s, target: t, kind, value, mutual, rel });
  };

  let frontier = [center];
  for (let d = 0; d < opt.depth; d++) {
    await store.ensure(frontier);
    // 2ホップ目は扇形に広がるので、1ホップ目より展開数を絞る
    const cap = d === 0 ? opt.perNode : Math.max(2, Math.round(opt.perNode / 3));
    const next: string[] = [];

    for (const c of frontier) {
      const a = store.get(c);
      if (!a) continue;
      const touch = (other: string) => {
        if (!catalog.has(other)) return false;
        if (!depthOf.has(other)) {
          if (depthOf.size >= opt.maxNodes) { truncated = true; return false; }
          depthOf.set(other, d + 1);
          next.push(other);
        }
        return true;
      };
      if (opt.hold) {
        for (const [o, v, mu, rl] of a.ho.slice(0, cap)) if (touch(o)) addLink(c, o, 'hold', v, !!mu, rl ?? 0);
        for (const [o, v, mu, rl] of a.hi.slice(0, cap)) if (touch(o)) addLink(o, c, 'hold', v, !!mu, rl ?? 0);
        if (a.ho.length > cap || a.hi.length > cap) truncated = true;
      }
      if (opt.major) {
        for (const o of a.mo.slice(0, cap)) if (touch(o)) addLink(c, o, 'major', null);
        for (const o of a.mi.slice(0, cap)) if (touch(o)) addLink(o, c, 'major', null);
        if (a.mo.length > cap || a.mi.length > cap) truncated = true;
      }
      if (opt.trade) {
        for (const [o, v] of (a.co ?? []).slice(0, cap)) if (touch(o)) addLink(c, o, 'trade', v);
        for (const [o, v] of (a.ci ?? []).slice(0, cap)) if (touch(o)) addLink(o, c, 'trade', v);
        if ((a.co ?? []).length > cap || (a.ci ?? []).length > cap) truncated = true;
      }
    }
    frontier = next;
  }

  // 近傍どうしを結ぶ辺も足す。これがないと放射状になるだけで、
  // 「同じ銀行を一緒に持っている会社どうし」のような構造が見えない。
  await store.ensure([...depthOf.keys()]);
  for (const c of depthOf.keys()) {
    const a = store.get(c);
    if (!a) continue;
    if (opt.hold) for (const [o, v, mu, rl] of a.ho) if (depthOf.has(o)) addLink(c, o, 'hold', v, !!mu, rl ?? 0);
    if (opt.major) for (const o of a.mo) if (depthOf.has(o)) addLink(c, o, 'major', null);
    if (opt.trade) for (const [o, v] of (a.co ?? [])) if (depthOf.has(o)) addLink(c, o, 'trade', v);
  }

  const degree = new Map<string, number>();
  for (const l of linkMap.values()) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  const nodes: GNode[] = [...depthOf.entries()].map(([id, depth]) => {
    const rec = catalog.get(id)!;
    return {
      id, depth, name: rec.name, s17: rec.s17, s33: rec.s33,
      domain: rec.domain, degree: degree.get(id) || 0,
    };
  });

  return { nodes, links: [...linkMap.values()], truncated };
}


/** 経路の1区間。link の向きは「保有する側 → される側」で、
    traversal の向き(forward)とは別に持つ。 */
export interface Hop {
  from: string;
  to: string;
  link: GLink;
  /** 中心から選択へ辿る向きと、辺の向きが一致しているか */
  forward: boolean;
}

const endpoints = (l: GLink): [string, string] => [
  typeof l.source === 'object' ? (l.source as any).id : l.source,
  typeof l.target === 'object' ? (l.target as any).id : l.target,
];

export const linkKey = (l: GLink): string => {
  const [s, t] = endpoints(l);
  return `${s}>${t}>${l.kind}`;
};

/** いま描かれている辺だけを使って最短経路を求める。
    辺の向きは無視して辿る（資本関係は向きがあっても「繋がり」としては双方向に読みたい）。
    描画中の辺に限るので、画面に出ていない経路を説明してしまうことがない。 */
export function shortestPath(links: GLink[], from: string, to: string): Hop[] | null {
  if (from === to) return null;
  const adj = new Map<string, { other: string; link: GLink; forward: boolean }[]>();
  const add = (a: string, b: string, link: GLink, forward: boolean) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ other: b, link, forward });
  };
  for (const l of links) {
    const [s, t] = endpoints(l);
    add(s, t, l, true);
    add(t, s, l, false);
  }

  const prev = new Map<string, { node: string; link: GLink; forward: boolean } | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    if (u === to) break;
    for (const e of adj.get(u) ?? []) {
      if (prev.has(e.other)) continue;
      prev.set(e.other, { node: u, link: e.link, forward: e.forward });
      queue.push(e.other);
    }
  }
  if (!prev.has(to)) return null;

  const hops: Hop[] = [];
  let cur = to;
  while (true) {
    const step = prev.get(cur);
    if (!step) break;
    hops.push({ from: step.node, to: cur, link: step.link, forward: step.forward });
    cur = step.node;
  }
  return hops.reverse();
}


/** グラフ全体を辿って2社間の経路を探す。

    表示中のグラフは密度で間引かれているため、そこに出ていない会社との関係は
    描かれた辺だけでは説明できない。ここでは隣接シャードを必要なぶんだけ取りながら
    両側から探索する。三菱UFJのように754本の辺を持つノードがあるので、
    各段の広がりには上限を掛ける。 */
export async function findPath(
  from: string,
  to: string,
  store: AdjStore,
  catalog: Map<string, NodeRec>,
  opt: { maxDepth?: number; frontierCap?: number } = {},
): Promise<Hop[] | null> {
  const maxDepth = opt.maxDepth ?? 4;
  const cap = opt.frontierCap ?? 700;
  if (from === to) return null;

  type Step = { node: string; link: GLink; forward: boolean };
  const fwd = new Map<string, Step | null>([[from, null]]);
  const bwd = new Map<string, Step | null>([[to, null]]);
  let fFrontier = [from];
  let bFrontier = [to];

  const neighbours = (c: string) => {
    const a = store.get(c);
    const out: { other: string; link: GLink; forward: boolean }[] = [];
    if (!a) return out;
    for (const [o, v, mu, rl] of a.ho) if (catalog.has(o))
      out.push({ other: o, forward: true, link: { source: c, target: o, kind: 'hold', value: v, mutual: !!mu, rel: rl ?? 0 } });
    for (const [o, v, mu, rl] of a.hi) if (catalog.has(o))
      out.push({ other: o, forward: false, link: { source: o, target: c, kind: 'hold', value: v, mutual: !!mu, rel: rl ?? 0 } });
    for (const o of a.mo) if (catalog.has(o))
      out.push({ other: o, forward: true, link: { source: c, target: o, kind: 'major', value: null, mutual: false } });
    for (const o of a.mi) if (catalog.has(o))
      out.push({ other: o, forward: false, link: { source: o, target: c, kind: 'major', value: null, mutual: false } });
    for (const [o, v] of (a.co ?? [])) if (catalog.has(o))
      out.push({ other: o, forward: true, link: { source: c, target: o, kind: 'trade', value: v, mutual: false } });
    for (const [o, v] of (a.ci ?? [])) if (catalog.has(o))
      out.push({ other: o, forward: false, link: { source: o, target: c, kind: 'trade', value: v, mutual: false } });
    return out;
  };

  /** meet した地点から両側を繋いで経路を組み立てる */
  const assemble = (meet: string): Hop[] => {
    const head: Hop[] = [];
    let cur = meet;
    while (true) {
      const st = fwd.get(cur);
      if (!st) break;
      head.push({ from: st.node, to: cur, link: st.link, forward: st.forward });
      cur = st.node;
    }
    head.reverse();

    const tail: Hop[] = [];
    cur = meet;
    while (true) {
      const st = bwd.get(cur);
      if (!st) break;
      // bwd は to 側から遡っているので、進む向きを反転して並べる
      tail.push({ from: cur, to: st.node, link: st.link, forward: st.forward });
      cur = st.node;
    }
    return [...head, ...tail];
  };

  for (let d = 0; d < maxDepth; d++) {
    const expandForward = fFrontier.length <= bFrontier.length;
    const frontier = expandForward ? fFrontier : bFrontier;
    const seen = expandForward ? fwd : bwd;
    const other = expandForward ? bwd : fwd;
    if (frontier.length === 0) return null;

    await store.ensure(frontier);
    const next: string[] = [];
    for (const c of frontier) {
      for (const e of neighbours(c)) {
        if (seen.has(e.other)) continue;
        seen.set(e.other, { node: c, link: e.link, forward: expandForward ? e.forward : !e.forward });
        if (other.has(e.other)) return assemble(e.other);
        if (next.length < cap) next.push(e.other);
      }
    }
    if (expandForward) fFrontier = next; else bFrontier = next;
  }
  return null;
}
