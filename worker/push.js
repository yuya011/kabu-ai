/* Web Push の送信。RFC 8291（aes128gcm）と RFC 8292（VAPID）を素で実装する。
 *
 * Workers には web-push ライブラリを持ち込めないが、必要な素材
 * （ECDH P-256・HKDF・AES-GCM・ECDSA 署名）は WebCrypto に全部ある。
 *
 * 鍵の作り方:
 *   node worker/vapid-keygen.mjs
 *   npx wrangler secret put VAPID_PRIVATE     # 出力の private
 *   # public は wrangler.toml の [vars] VAPID_PUBLIC に入れる（公開してよい）
 *
 * 鍵が無ければ通知の口は 503 を返すだけで、他の機能には影響しない。
 */

import { b64urlToBytes, bytesToB64url } from './util.js';

const enc = new TextEncoder();

export const configured = (env) => !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* HKDF。取り出す長さが 32 バイト以下なので、展開は1ブロックで足りる */
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  const out = await hmac(prk, concat(info, Uint8Array.of(1)));
  return out.slice(0, len);
}

/* VAPID の秘密鍵は 32 バイトのスカラだが、WebCrypto は raw の秘密鍵を受け取らない。
   公開鍵（非圧縮点 0x04||x||y）から x, y を切り出して JWK に組み直す。 */
let signKey = null;
async function vapidKey(env) {
  if (signKey) return signKey;
  const pub = b64urlToBytes(env.VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC の形が違う');
  signKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', ext: false,
    d: env.VAPID_PRIVATE,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signKey;
}

/** 送り先ごとに署名し直す。aud が配信元の origin に縛られるため */
async function authorization(env, audience) {
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:noreply@example.com',
  })));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidKey(env),
    enc.encode(`${head}.${body}`),
  );
  return `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

/* RFC 8291。本文を購読ごとの鍵で暗号化して、ヘッダ付きの1本の塊にする。 */
async function encrypt(text, p256dh, authSecret) {
  const ua = b64urlToBytes(p256dh);        // 受け手の公開鍵 65 バイト
  const secret = b64urlToBytes(authSecret); // 共有の秘密 16 バイト

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, pair.privateKey, 256));

  const ikm = await hkdf(
    secret, shared, concat(enc.encode('WebPush: info\0'), ua, as), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 平文の末尾に 0x02 を足す。これが「最後のレコード」の目印になる
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), Uint8Array.of(2))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(as.length), as, sealed);
}

/**
 * 1件送る。戻り値の gone が真なら購読が失効しているので、呼び側で消す。
 */
export async function send(env, sub, payload) {
  const body = await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await authorization(env, new URL(sub.endpoint).origin),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  // 404/410 は「その購読はもう無い」。ブラウザを消した、通知を切った等
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
