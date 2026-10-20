#!/usr/bin/env node
/**
 * 项目介绍视频生成器
 *
 * 思路：不用录屏，而是把游戏引擎本身跑起来，取真实数据，
 * 再用 Canvas 逐帧渲染，管道喂给 ffmpeg 编码成 MP4。
 *
 *   node tools/make-video.js
 *
 * 输出：dist/FX战士久留美_项目介绍.mp4
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const ROOT = path.dirname(path.dirname(require.resolve ? __filename : __filename));
const SRC = path.join(ROOT, 'src');

/* ================= 配置 ================= */
const W = 1920, H = 1080, FPS = 30;
const OUT = process.env.OUT || path.join(ROOT, 'dist', 'FX战士久留美_项目介绍.mp4');
const FFMPEG = process.env.FFMPEG || '/tmp/vidtool/node_modules/ffmpeg-static/ffmpeg';
const FONT_PATH = '/system/fonts/NotoSansCJK-Regular.ttc';
const FONT_BOLD = '/system/fonts/NotoSansCJK-Bold.ttc';

/* ================= 字体 ================= */
let FONT_OK = false;
try {
  const ok1 = GlobalFonts.registerFromPath(FONT_PATH, 'CJK');
  FONT_OK = true;
  try { GlobalFonts.registerFromPath(FONT_BOLD, 'CJKBold'); } catch (e) {}
  if (!GlobalFonts.families.some(f => f.family === 'CJKBold')) {
    // 没有粗体文件时用同一套字体，靠 fillText 的笔画加粗模拟权重
  }
} catch (e) {
  console.error('字体注册失败:', e.message);
  process.exit(1);
}
const FONT = 'CJK';

/* ================= 配色（与游戏一致） ================= */
const C = {
  bg: '#05070c',
  bg2: '#0a0f18',
  panel: 'rgba(19,26,41,0.85)',
  line: 'rgba(255,255,255,0.10)',
  tx: '#e8eefc',
  tx2: 'rgba(232,238,252,0.62)',
  tx3: 'rgba(232,238,252,0.35)',
  up: '#3ddc97',
  dn: '#ff4d6d',
  gold: '#ffd166',
  pink: '#ff8fb1',
  blue: '#8cb4ff',
  purple: '#c084fc',
};

/* ================= 缓动 ================= */
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
/** 在 [a,b] 区间内映射到 0..1 */
const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a), 0, 1);

/* ================= 绘图工具 ================= */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 画文字；alpha 控制淡入淡出 */
function txt(ctx, s, x, y, o) {
  o = o || {};
  const size = o.size || 40;
  const weight = o.weight || '400';
  const alpha = o.alpha === undefined ? 1 : o.alpha;
  if (alpha <= 0.001) return 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = o.color || C.tx;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.glowBlur || 24; }
  if (o.stroke) { ctx.lineWidth = o.strokeWidth || 3; ctx.strokeStyle = o.stroke; ctx.strokeText(s, x, y); }
  ctx.fillText(s, x, y);
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/** 自动换行段落 */
function para(ctx, s, x, y, o) {
  o = o || {};
  const size = o.size || 38, lh = o.lh || size * 1.55;
  const maxW = o.maxW || 1400;
  ctx.save();
  ctx.font = `${o.weight || '400'} ${size}px ${FONT}`;
  const chars = Array.from(s);
  let line = '', yy = y, lines = 0;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      txt(ctx, line, x, yy, o);
      line = ch; yy += lh; lines++;
      if (o.maxLines && lines >= o.maxLines) break;
    } else line = test;
  }
  if (line) txt(ctx, line, x, yy, o);
  ctx.restore();
  return yy + lh - y;
}

/** 背景：径向渐变 + 网格 */
function bg(ctx, t) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#05070c');
  g.addColorStop(0.45, '#080d16');
  g.addColorStop(1, '#0a0f18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 柔和光斑
  const g2 = ctx.createRadialGradient(300, -100 + Math.sin(t * 0.3) * 40, 0, 300, -100, 900);
  g2.addColorStop(0, 'rgba(255,143,177,0.10)');
  g2.addColorStop(1, 'rgba(255,143,177,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  const g3 = ctx.createRadialGradient(1650, 1150, 0, 1650, 1150, 900);
  g3.addColorStop(0, 'rgba(140,180,255,0.10)');
  g3.addColorStop(1, 'rgba(140,180,255,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, W, H);

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

/** 卡片 */
function card(ctx, x, y, w, h, o) {
  o = o || {};
  ctx.save();
  ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
  rr(ctx, x, y, w, h, o.r || 24);
  ctx.fillStyle = o.fill || 'rgba(19,26,41,0.82)';
  ctx.fill();
  ctx.strokeStyle = o.border || C.line;
  ctx.lineWidth = o.borderWidth || 2;
  ctx.stroke();
  ctx.restore();
}

/** 横向进度条 */
function bar(ctx, x, y, w, h, p, color, bgColor) {
  ctx.save();
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bgColor || 'rgba(255,255,255,0.08)';
  ctx.fill();
  if (p > 0) {
    rr(ctx, x, y, Math.max(h, w * clamp(p, 0, 1)), h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/* ================= 加载游戏引擎（真实数据） ================= */
function loadGame() {
  const sandbox = {
    console, performance: { now: () => Date.now() },
    Math, Date, JSON, isFinite, parseFloat, parseInt,
    Object, Array, Number, String, Boolean, Error, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  };
  const stub = () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() { return true }, contains() { return false } },
    innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0,
    appendChild(c) { return c; }, remove() {},
    querySelector() { return stub(); }, querySelectorAll() { return []; },
    addEventListener() {}, getBoundingClientRect() { return { width: 1, height: 1, left: 0, top: 0 }; },
  });
  sandbox.document = {
    querySelector: () => stub(), querySelectorAll: () => [], getElementById: () => stub(),
    createElement: () => stub(), body: stub(), head: stub(), readyState: 'complete', addEventListener() {},
  };
  sandbox.navigator = { vibrate() {} };
  sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const k of ['$', '$$', 'el', 'bindTap']) sandbox[k] = () => stub();
  sandbox.Camera = { shake() {} };
  sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
  sandbox.Sfx = new Proxy({}, { get: () => () => {} });
  sandbox.Haptics = new Proxy({}, { get: () => () => {} });
  sandbox.Store = { load: () => null, save: () => true, clear() {}, exportString: () => '', importString: () => null };
  sandbox.Sheets = { msg() {}, number() {}, borrow() {}, result() {}, base: () => stub(), close() {} };
  sandbox.Confirm = { ask() {} };
  sandbox.UI = { effects: false, toast() {}, renderAll() {}, showScreen() {} };

  let bundle = '';
  for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
    bundle += '\n' + fs.readFileSync(path.join(SRC, f), 'utf8');
  bundle += `\nglobalThis.__X = { U, Core, Market, PAIRS, PAIR_ORDER, LOAN_PRODUCTS, PERK_DEFS, PERK_ORDER, initialState };\n`;
  vm.runInContext(bundle, sandbox, { filename: 'engine.js' });
  return sandbox.__X;
}

module.exports = { W, H, FPS, C, FONT, rr, txt, para, bg, card, bar, seg, easeOut, easeInOut, easeBack, lerp, clamp, loadGame };

/* ================= 如果是直接运行，走渲染流程 ================= */
if (require.main === module) {
  require('./video-scenes.js');
}
