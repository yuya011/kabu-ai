/* 通知の購読と、通知したい銘柄の一覧。
 *
 * 銘柄の一覧は端末の localStorage に置く。サーバに預けるのは
 * 「この購読で、この銘柄を鳴らす」という組だけで、誰の端末かは持たない。
 * 購読の宛先（endpoint）は配信元（FCM 等）が発行する URL で、
 * こちらから人を特定する材料にはならない。
 *
 * 送り先が未設定か、サーバ側に VAPID 鍵が入っていなければ、
 * この機能は丸ごと出さない（できないことを画面に出さない）。
 *
 * サービスワーカーは本番ビルドでしか登録しないので（main.tsx）、
 * 開発サーバでは通知の欄も出ない。
 */

import { useSyncExternalStore } from 'react';

const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
const WATCH_KEY = 'kabu-ai.watch';

export type PushState = 'unsupported' | 'unavailable' | 'off' | 'denied' | 'on';

const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/* ---------------- 通知したい銘柄 ---------------- */

let watch: string[] = read();

function read(): string[] {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    const j = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j.filter((c) => typeof c === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}

export const getWatch = (): string[] => watch;
export const isWatched = (code: string) => watch.includes(code);

/** 通知したい銘柄を出し入れする。購読済みならサーバ側の一覧も揃える。 */
export async function toggleWatch(code: string) {
  watch = watch.includes(code) ? watch.filter((c) => c !== code) : [...watch, code].slice(-100);
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(watch)); } catch { /* 端末に残せなくても今回は効く */ }
  emit();
  const sub = await current();
  if (sub) await sync(sub);
}

/** React から購読する。銘柄の出し入れも通知の状態も、これ1本で追える。 */
export function useWatch(): string[] {
  return useSyncExternalStore(subscribe, getWatch, () => watch);
}

/* ---------------- 購読 ---------------- */

const supported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/* サービスワーカーは本番ビルドでしか登録しない（main.tsx）。
   登録が無ければ通知も無いので、ここで止める。navigator.serviceWorker.ready を
   待つと、登録が無い開発サーバでは永久に返らない。 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

async function current(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  try {
    return (await reg.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** サーバ側が通知を受け付けるか。鍵が無ければ 503 が返る */
async function serverKey(): Promise<string | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(`${ENDPOINT}/push/key`);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.key === 'string' && j.key ? j.key : null;
  } catch {
    return null;
  }
}

export async function state(): Promise<PushState> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (!(await serverKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

/** base64url の公開鍵を、pushManager が要求するバイト列に直す */
function toBytes(b64url: string): Uint8Array {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function sync(sub: PushSubscription) {
  if (!ENDPOINT) return;
  await fetch(`${ENDPOINT}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), codes: watch }),
  });
}

/** 通知を入れる。許可のダイアログはここで出る。 */
export async function enable(): Promise<PushState> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  const key = await serverKey();
  if (!key) return 'unavailable';

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { emit(); return perm === 'denied' ? 'denied' : 'off'; }

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(key),
    });
    await sync(sub);
    emit();
    return 'on';
  } catch {
    emit();
    return 'off';
  }
}

/** 通知を切る。端末側の購読を解いてから、サーバの控えも消す。 */
export async function disable() {
  const sub = await current();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    if (ENDPOINT) {
      await fetch(`${ENDPOINT}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  }
  emit();
}
