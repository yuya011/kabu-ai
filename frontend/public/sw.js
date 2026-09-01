/* アプリの外枠だけを担うサービスワーカー。
 *
 * 配信 JSON (/data/browser/**) はアプリ側が IndexedDB に版付きで持っているので、
 * ここでは触らない。両方で持つと 40MB を二重に抱えることになる。
 * 受け持つのは HTML/JS/CSS/アイコンだけで、これで機内でも起動する。
 */
const CACHE = 'kabu-shell-v1';

/* 初回訪問では、HTML と JS は SW が登録される前に読み込まれてしまうので、
 * 素通りしてキャッシュに入らない。そのままだと機内で白紙になる。
 * ここで HTML を読み直し、参照している資材を先に取り込んでおく。
 * ビルドで名前にハッシュが付くため、HTML から辿るのが確実である。 */
async function warmShell() {
  const cache = await caches.open(CACHE);
  const root = new URL('./', self.location).href;
  const res = await fetch(root, { cache: 'reload' });
  if (!res.ok) return;
  await cache.put(root, res.clone());

  const html = await res.text();
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const raw = m[1];
    if (raw.startsWith('http') || raw.startsWith('data:')) continue;
    if (!/\.(js|css|png|webmanifest)$/.test(raw)) continue;
    urls.add(new URL(raw, root).href);
  }
  await Promise.all([...urls].map((u) =>
    fetch(u).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => null)));
}

self.addEventListener('install', (e) => {
  e.waitUntil(warmShell().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    await warmShell().catch(() => {});
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 外部（ファビコン等）は触らない
  if (url.pathname.includes('/data/browser/')) return;   // 配信データは IndexedDB の担当

  // ビルドが名前にハッシュを付けるため、/assets/ の中身は内容が変われば別名になる。
  // 同じ名前なら中身も同じなので、キャッシュを先に見てよい。通信の失敗にも強い。
  const immutable = url.pathname.includes('/assets/') || url.pathname.includes('/icons/');

  // Request で照合すると Vary の影響で外れることがある。
  // URL 文字列でも引き直し、確実に当てる。
  const lookup = async (cache) =>
    (await cache.match(req, { ignoreVary: true })) ||
    (await cache.match(url.href, { ignoreVary: true }));

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    if (immutable) {
      const hit = await lookup(cache);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }

    // HTML は通信を優先する。逆にすると配信後も古い画面が出続けるため。
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await lookup(cache);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match(new URL('./', self.location).href);
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
