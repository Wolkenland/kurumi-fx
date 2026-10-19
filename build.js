#!/usr/bin/env node
/**
 * 构建脚本
 *
 * 产物：
 *   dist/index.html      —— 单文件游戏（给本地打开 / 打进 APK 用）
 *   docs/                —— 可安装的 PWA（给 GitHub Pages 托管用）
 *     ├── index.html
 *     ├── manifest.webmanifest
 *     ├── sw.js
 *     ├── icon-192.png
 *     └── icon-512.png
 *
 * docs/ 这个目录名是 GitHub Pages 认的（Deploy from a branch → /docs）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const src = p => path.join(root, 'src', p);

const JS_ORDER = ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js',
  '06-ui.js', '08-ai.js', '09-ui-ai.js', '07-boot.js'];

/* ============ 1. 内联成单文件 ============ */
const css = fs.readFileSync(src('style.css'), 'utf8');
const js = JS_ORDER.map(f => `\n/* ===== ${f} ===== */\n` + fs.readFileSync(src(f), 'utf8')).join('\n');

let html = fs.readFileSync(src('index.template.html'), 'utf8');
html = html.replace('/*__CSS__*/', () => css);
html = html.replace('/*__JS__*/', () => js);

/* ============ 2. PNG 编码器（生成图标，无第三方依赖） ============ */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** 画图标：深色底 + 三根 K 线 + 一条强平线 */
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = 5; px[i * 4 + 1] = 7; px[i * 4 + 2] = 12; px[i * 4 + 3] = 255;
  }
  const S = size / 108;               // 设计稿按 108×108 画
  const rect = (x0, y0, w, h, c) => {
    const X0 = Math.round(x0 * S), Y0 = Math.round(y0 * S);
    const X1 = Math.round((x0 + w) * S), Y1 = Math.round((y0 + h) * S);
    for (let y = Y0; y < Y1; y++) {
      if (y < 0 || y >= size) continue;
      for (let x = X0; x < X1; x++) {
        if (x < 0 || x >= size) continue;
        const i = (y * size + x) * 4;
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      }
    }
  };
  const GREEN = [61, 220, 151], RED = [255, 77, 109], GOLD = [255, 209, 102], PINK = [255, 143, 177];
  // 三根蜡烛：影线 + 实体
  const candles = [
    [34, 50, 92, 62, 80, GREEN],
    [54, 38, 88, 46, 76, RED],
    [74, 28, 80, 34, 70, GOLD],
  ];
  for (const [cx, wickTop, wickBot, bodyTop, bodyBot, col] of candles) {
    rect(cx - 0.8, wickTop, 1.6, wickBot - wickTop, col);
    rect(cx - 5, bodyTop, 10, bodyBot - bodyTop, col);
  }
  // 强平线
  rect(20, 84, 68, 2.2, PINK);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;                                   // filter: none
    px.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============ 3. PWA 附加文件 ============ */
const MANIFEST = {
  name: 'FX战士久留美 · 交易模拟器',
  short_name: '久留美FX',
  description: '《FX戦士くるみちゃん》非官方同人交易模拟器 — 学杠杆、保证金、爆仓与借钱交易',
  lang: 'zh-CN',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#05070c',
  theme_color: '#05070c',
  categories: ['games', 'education', 'finance'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const SW_JS = `/* FX战士久留美 · Service Worker
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
`;

/** 在 <head> 里注入 PWA 相关标签，并注册 Service Worker */
function makePwaHtml(base) {
  const headInject = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="久留美FX">',
    '<link rel="apple-touch-icon" href="icon-192.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">',
  ].join('\n');
  let out = base.replace('</head>', headInject + '\n</head>');
  const swReg = `
<script>
// 注册 Service Worker（仅 https / localhost 生效；file:// 会静默跳过）
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>
`;
  out = out.replace('</body>', swReg + '</body>');
  return out;
}

/* ============ 4. 输出 ============ */
const distDir = path.join(root, 'dist');
const docsDir = path.join(root, 'docs');
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

// 4a. 单文件版
const distFile = path.join(distDir, 'index.html');
fs.writeFileSync(distFile, html, 'utf8');

// 4b. PWA 版
fs.writeFileSync(path.join(docsDir, 'index.html'), makePwaHtml(html), 'utf8');
fs.writeFileSync(path.join(docsDir, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2), 'utf8');
fs.writeFileSync(path.join(docsDir, 'sw.js'), SW_JS, 'utf8');
fs.writeFileSync(path.join(docsDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(docsDir, 'icon-512.png'), makeIcon(512));
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');

const kb = (n) => (n / 1024).toFixed(1);
console.log(`✓ dist/index.html          ${kb(Buffer.byteLength(html))} KB  (单文件版)`);
console.log(`✓ docs/index.html          ${kb(fs.statSync(path.join(docsDir, 'index.html')).size)} KB  (PWA 版)`);
console.log(`✓ docs/manifest.webmanifest`);
console.log(`✓ docs/sw.js`);
console.log(`✓ docs/icon-192.png / icon-512.png  ${kb(fs.statSync(path.join(docsDir, 'icon-512.png')).size)} KB`);

/* ============ 5. 语法校验 ============ */
try {
  new Function(js);
  console.log('✓ JS syntax OK');
} catch (e) {
  console.error('✗ JS syntax error: ' + e.message);
  process.exit(1);
}
