/* FX战士久留美 · Service Worker
 * 策略：
 *   · 页面导航（HTML）→ 网络优先：保证每次打开都拿到最新版本
 *   · 静态资源（图标等）→ 缓存优先：省流量，离线可用
 * 注意：Service Worker 只在 https 或 localhost 下生效（file:// 不生效）。
 *
 * VERSION 由构建脚本按内容自动生成，内容一变版本号就变，
 * 浏览器就会装新的 SW 并清掉旧缓存——之前写死 'fxkurumi-v3' 导致
 * 发布新版本后用户一直看到旧界面。
 */
const VERSION = 'fxkurumi-ca9319a5ba';
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

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 不缓存跨域请求（AI 接口等），交给网络
  if (new URL(req.url).origin !== self.location.origin) return;

  // 打开页面：网络优先，拿不到才用缓存（离线时仍可玩）
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // 其他静态资源：缓存优先
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
