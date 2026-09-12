/* 速報の取得。Worker（閲覧統計と同じ宛先）から当日の開示を引く。
 *
 * 静的な配信データは1日1回の作り直しなので、その日に出た開示は載らない。
 * そこだけを Worker が10分おきに集めていて、ここはその読み口である。
 *
 * 送り先が設定されていなければ何もしない。取得に失敗しても null を返すだけで、
 * 画面は静的データのまま出る。速報は「あれば嬉しい」ものであって、
 * これが落ちたからといって企業ブラウザが使えなくなってはいけない。
 */

const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;

/** 速報を出せる構成か。偽なら関連する UI ごと描かない */
export const liveEnabled = !!ENDPOINT;

export interface LiveItem {
  id: string;
  code: string;
  name: string | null;
  title: string;
  url: string;
  /** 日本時間の 'YYYY-MM-DD HH:MM' */
  disclosed_at: string;
  /** 「臨時報告書」「大量保有報告書」など */
  category: string | null;
  /** 株主構成や支配権が動くもの。通知の対象でもある */
  important: boolean;
  source: string;
}

export interface Attribution {
  id: string; name: string; url: string; license: string;
}

export interface CompanyLive {
  code: string;
  items: LiveItem[];
  /** この応答を組んだ時刻（日本時間） */
  fetched_at: string;
  /** 最後に巡回した時刻。空なら一度も走っていない */
  crawled_at: string | null;
  sources: Record<string, string>;
}

export interface TodayLive {
  ymd: string;
  /** 偽なら休場日などで、出しているのは直近の営業日ぶん */
  today: boolean;
  items: LiveItem[];
  crawled_at: string | null;
  sources: Attribution[];
}

async function get<T>(path: string): Promise<T | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(`${ENDPOINT}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // 圏外・遮断。静的データで足りるので黙って諦める
  }
}

/** 銘柄ひとつぶんの最新。Worker 側で15分キャッシュされる */
export function fetchCompanyLive(code: string, name?: string): Promise<CompanyLive | null> {
  const q = name ? `&query=${encodeURIComponent(name)}` : '';
  return get<CompanyLive>(`/news?code=${encodeURIComponent(code)}${q}`);
}

/** 当日の開示一覧 */
export function fetchTodayLive(limit = 40): Promise<TodayLive | null> {
  return get<TodayLive>(`/disclosures/today?limit=${limit}`);
}

/* ---------------- 時刻の表示 ---------------- */

/** 'YYYY-MM-DD HH:MM'（日本時間）を Date に。端末の時計が何時であっても揃う */
export function parseJst(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = Date.parse(`${s.replace(' ', 'T')}:00+09:00`);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** 「3分前」。1日以上離れたら日付そのものを出す */
export function ago(s: string | null | undefined): string {
  const d = parseJst(s);
  if (!d) return '—';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return s!.slice(5, 10).replace('-', '/');
}

/** 一覧に出す時刻。同じ日なら時分だけ */
export function clock(s: string | null | undefined): string {
  if (!s) return '';
  const [ymd, hm] = s.split(' ');
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return ymd === today ? (hm ?? '') : `${ymd.slice(5).replace('-', '/')} ${hm ?? ''}`;
}
