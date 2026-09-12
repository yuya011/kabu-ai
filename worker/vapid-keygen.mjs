/* VAPID 鍵をひと組作る。依存なしで動く（Node 18 以降）。
 *
 *   node worker/vapid-keygen.mjs
 *
 * public は公開してよい。wrangler.toml の [vars] VAPID_PUBLIC に入れる。
 * private は秘密。npx wrangler secret put VAPID_PRIVATE で渡す。
 * 鍵を作り直すと既存の購読は全部無効になるので、一度作ったら使い回すこと。
 */
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`VAPID_PUBLIC  = ${b64url(pub)}`);
console.log(`VAPID_PRIVATE = ${jwk.d}`);
console.log('');
console.log('wrangler.toml の [vars] に VAPID_PUBLIC を書き、');
console.log('npx wrangler secret put VAPID_PRIVATE で秘密鍵を渡してください。');
