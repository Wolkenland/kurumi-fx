/* FX战士久留美 · Service Worker
 * 策略：缓存优先 + 后台更新。游戏是单文件，缓存一次后完全离线可用。
 * 注意：Service Worker 只在 https 或 localhost 下生效（file:// 不生效）。
 */
const VERSION = 'fxkurumi-v3';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 不缓存跨域请求（AI 接口等），交给网络
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
