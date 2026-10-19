#!/usr/bin/env node
/* 构建：把所有源码内联成单个 index.html（零依赖、可离线、可直接用手机浏览器打开） */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = p => path.join(root, 'src', p);

const JS_ORDER = ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js',
  '06-ui.js', '08-ai.js', '09-ui-ai.js', '07-boot.js'];

const css = fs.readFileSync(src('style.css'), 'utf8');
const js = JS_ORDER.map(f => `\n/* ===== ${f} ===== */\n` + fs.readFileSync(src(f), 'utf8')).join('\n');

let html = fs.readFileSync(src('index.template.html'), 'utf8');
html = html.replace('/*__CSS__*/', () => css);
html = html.replace('/*__JS__*/', () => js);

const out = path.join(root, 'dist', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✓ built ${path.relative(root, out)}  (${kb} KB)`);

/* 简易语法校验 */
try {
  new Function(js);
  console.log('✓ JS syntax OK');
} catch (e) {
  console.error('✗ JS syntax error: ' + e.message);
  process.exit(1);
}
