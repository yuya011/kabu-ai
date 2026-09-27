/* 配信 JSON のブラウザ内キャッシュ。

   ニュースや保有目的は企業シャードに同梱してあるので、シャードごと残せば
   2回目以降の表示でネットワークに出なくて済む。
   localStorage は 5MB 前後で頭打ちになり、銀行のシャード1本(生 951KB)で
   すぐ溢れるため IndexedDB を使う。

   版はエクスポート時刻(index.json の meta.generated_at)。
   データを作り直したら版が変わり、古い中身は丸ごと捨てる。 */

const DB_NAME = 'kabu-ai-cache';
const STORE = 'json';
const INDEX_TTL_MS = 6 * 60 * 60 * 1000; // index.json だけは時間で見に行く
/* 配信 JSON の形の版。書き出しに項目を足して画面がそれを読むようになったら上げる。
   index.json は6時間使い回すので、上げないと公開直後の画面が古い形の索引を読み、
   新しい項目が無いまま描いてしまう（市場の社数が全部 0 に見えた）。 */
const SCHEMA = 2;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let version: string | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // プライベートウィンドウなどで使えないことがある
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

const get = <T>(key: string) => tx<T>('readonly', (s) => s.get(key));
const put = (key: string, val: unknown) => tx('readwrite', (s) => s.put(val, key));
const clearAll = () => tx('readwrite', (s) => s.clear());

interface Entry { v: string | null; t: number; d: unknown; s?: number; }

/** 版つきキャッシュ。版が一致すればネットワークに出ない。 */
export async function fetchJSON<T = any>(url: string): Promise<T> {
  const hit = await get<Entry>(url);
  if (hit && hit.v === version && hit.s === SCHEMA) return hit.d as T;

  const res = await fetch(url);
  if (!res.ok) {
    if (hit) return hit.d as T; // 取りに行けなければ古くても返す
    throw new Error(`${url} ${res.status}`);
  }
  const data = (await res.json()) as T;
  put(url, { v: version, t: Date.now(), d: data, s: SCHEMA } satisfies Entry);
  return data;
}

/** index.json を読み、その生成時刻を全体の版として据える。 */
export async function loadIndex<T extends { meta: { generated_at: string } }>(url: string): Promise<T> {
  const hit = await get<Entry>(url);
  const fresh = hit && hit.s === SCHEMA && Date.now() - hit.t < INDEX_TTL_MS;
  if (fresh) {
    version = hit!.v;
    return hit!.d as T;
  }

  let data: T;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    data = (await res.json()) as T;
  } catch (e) {
    if (hit) { version = hit.v; return hit.d as T; }
    throw e;
  }

  const next = data.meta.generated_at;
  if (hit && (hit.v !== next || hit.s !== SCHEMA)) {
    // 作り直された。混ざると厄介なので古い中身は全部捨てる
    await clearAll();
  }
  version = next;
  put(url, { v: next, t: Date.now(), d: data, s: SCHEMA } satisfies Entry);
  return data;
}

/** 手動で全消しするための出口（開発時やデータ不整合のとき）。 */
export async function clearCache() {
  await clearAll();
  version = null;
}
