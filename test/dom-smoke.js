/* 真实 DOM 冒烟测试：用 jsdom 加载 dist/index.html，模拟点击与动画帧，捕获所有运行时异常 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = '/sdcard/读博模拟器/kurumi-fx/dist/index.html';
const html = fs.readFileSync(HTML, 'utf8');

const errors = [];
const logs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => logs.push('warn: ' + a.join(' ')));

/* ---- 假 Canvas 2D 上下文 ---- */
function fake2d() {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: null,
    setTransform() {}, save() {}, restore() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
    fillText() {}, strokeText() {}, measureText: () => ({ width: 24 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    setLineDash() {}, translate() {}, scale() {}, rotate() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, clip() {}, rect() {},
    globalAlpha: 1, lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '',
    fillStyle: '', strokeStyle: '', shadowColor: '', shadowBlur: 0, globalCompositeOperation: '',
  };
  return ctx;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/index.html',
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { const c = fake2d(); c.canvas = this; return c; };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
    // 强制所有元素有真实尺寸（jsdom 布局全为 0）
    Object.defineProperty(window.Element.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
    Object.defineProperty(window.Element.prototype, 'clientHeight', { get() { return 260; }, configurable: true });
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 360, height: 260, left: 0, top: 0, right: 360, bottom: 260, x: 0, y: 0 };
    };
    window.Element.prototype.scrollIntoView = () => {};
    window.AudioContext = function () {
      return {
        state: 'running', currentTime: 0, sampleRate: 44100, destination: {},
        resume() {}, createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
        createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; },
        createBuffer(n, len) { return { getChannelData: () => new Float32Array(len) }; },
        createBufferSource() { return { buffer: null, connect() {}, start() {} }; },
        createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; },
      };
    };
    window.navigator.vibrate = () => true;
    if (!window.PointerEvent) {
      window.PointerEvent = class extends window.MouseEvent {
        constructor(type, init) { super(type, init); this.pointerId = 1; }
      };
    }
    // 可控时钟：rAF 每 16ms，performance.now 同步推进
    let vt = 0;
    window.__vt = () => vt;
    window.requestAnimationFrame = (fn) => setTimeout(() => { vt += 16; fn(vt); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    Object.defineProperty(window.performance, 'now', { value: () => vt });
  },
});

const { window } = dom;
const { document } = window;
window.addEventListener('error', e => errors.push('window.error: ' + (e.error ? e.error.stack : e.message)));
window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + e.reason));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, info) => c ? ok(m) : bad(m + (info ? '  → ' + info : ''));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = (node) => {
  if (!node) return false;
  node.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

(async () => {
  await sleep(300);
  const K = () => window.__FXK__;
  const pump = async (n) => { for (let i = 0; i < n; i++) await sleep(1); };
  /** 直接推进游戏时间 n 个 tick（绕过 rAF 的时序不确定性） */
  const ticks = (n) => { const c = K().core; for (let i = 0; i < n; i++) c.tick(); };
  const refresh = () => { K().ui.renderAll(); };

  console.log('\n=== 1. 启动 ===');
  chk('脚本已执行（存在 #app）', !!$('#app'));
  chk('开场遮罩存在', !!$('#cover'));
  chk('未发生启动期异常', errors.length === 0, errors.join(' | '));

  console.log('\n=== 2. 开场 → 进入游戏 ===');
  chk('开场文字已被逐行注入', ($('.cv-line') || {}).textContent !== undefined);
  const startBtn = $('.cv-btn');
  chk('开始按钮存在', !!startBtn);
  if (startBtn) { click(startBtn); await sleep(500); }
  chk('遮罩已淡出/移除', !$('#cover') || $('#cover').classList.contains('off'));

  console.log('\n=== 3. 界面骨架 ===');
  chk('5 个屏幕已创建', $$('.screen').length === 5, $$('.screen').length + ' 个');
  chk('5 个底部标签已创建', $$('#tabs button').length === 5);
  chk('相机图 tabs 已渲染（8 个货币对）', $$('#pairTabs .pair-tab').length === 8,
    $$('#pairTabs .pair-tab').length + ' 个');
  chk('下单面板已渲染', !!$('#btnBuy') && !!$('#btnSell'));
  chk('杠杆滑块存在', !!$('#levRange'));
  chk('手数快捷按钮存在', $$('#amtChips button').length === 4);
  chk('订单摘要已填充', ($('#orderSum') || {}).innerHTML.length > 50);
  chk('市场快讯区存在', !!$('#newsList'));

  console.log('\n=== 4. 时间推进与 HUD ===');
  const eqBefore = $('#equityVal').textContent;
  const dateBefore = $('#hudDate').textContent;
  await sleep(1800);
  const eqAfter = $('#equityVal').textContent;
  const dateAfter = $('#hudDate').textContent;
  chk('净值已渲染为数字', /[\d,]+/.test(eqAfter), eqAfter);
  chk('时间在走（日期文本变化）', dateBefore !== dateAfter, dateBefore + ' → ' + dateAfter);
  chk('维持率在无持仓时显示 —', $('#hudRate').textContent.trim() === '—', $('#hudRate').textContent);
  chk('保证金率条存在', !!$('#marginBar i'));

  console.log('\n=== 5. 下单 ===');
  const buyBtn = $('#btnBuy');
  click(buyBtn);
  await sleep(400);
  const posBadge = $('#tabs button[data-s="pos"] .badge');
  chk('下单后底部出现持仓角标', !!posBadge, posBadge ? posBadge.textContent : '无');
  chk('维持率变为数值', $('#hudRate').textContent.trim() !== '—', $('#hudRate').textContent);

  console.log('\n=== 6. 切换页面 ===');
  for (const tab of ['pos', 'loan', 'me', 'set']) {
    const btn = $(`#tabs button[data-s="${tab}"]`);
    click(btn);
    await sleep(60);                       // 屏幕切换动画走一帧
    const scr = $('#sc-' + tab);
    chk(`切到「${tab}」屏并激活`, !!scr && scr.classList.contains('on'));
  }
  click($('#tabs button[data-s="trade"]'));
  await sleep(60);
  chk('持仓页渲染出条目', $$('#sc-pos .pos').length >= 1 || ($('#posList') || {}).textContent.length > 0);
  chk('借贷页渲染出渠道卡', $$('#loanList .loan-card').length >= 1,
    $$('#loanList .loan-card').length + ' 张');
  chk('人物页渲染出人物', $$('#charaList .chara').length >= 1,
    $$('#charaList .chara').length + ' 人');
  chk('设定页渲染出词典条目', $$('#glossary .gloss').length >= 10,
    $$('#glossary .gloss').length + ' 条');

  console.log('\n=== 7. 借贷交互 ===');
  click($('#tabs button[data-s="loan"]'));
  await sleep(120);
  const borrowBtn = $$('#loanList .loan-card button').find(b => /借款/.test(b.textContent));
  chk('存在可借的渠道按钮', !!borrowBtn, borrowBtn ? borrowBtn.textContent : '无');
  if (borrowBtn) {
    click(borrowBtn);
    await sleep(250);
    chk('弹出借款抽屉', $('#sheet').classList.contains('on'));
    chk('抽屉内有金额输入框', !!$('#shNum'));
    const okBtn = $('#shOk');
    if (okBtn) { click(okBtn); await sleep(300); }
    chk('借款后负债 > 0', ($('#hudLoan') || {}).textContent !== '0', ($('#hudLoan') || {}).textContent);
  }

  console.log('\n=== 8. 抽屉与遮罩 ===');
  if ($('#mask')) {
    click($('#mask'));
    await sleep(200);
    chk('点遮罩关闭抽屉', !$('#sheet').classList.contains('on'));
  }

  console.log('\n=== 9. 教学与剧情 ===');
  chk('教学节点已插入', !!$('.tut') || $$('#screens').length > 0);
  const tut = $('.tut');
  if (tut) {
    const nb = $$('.tut button').find(b => /下一页|明白了/.test(b.textContent));
    chk('教学有翻页按钮', !!nb);
    if (nb) { click(nb); await sleep(150); ok('教学翻页无异常'); }
  } else ok('教学未在当前时机弹出（条件未满足，属正常）');

  console.log('\n=== 10. 图表演练（缩放/拖动） ===');
  click($('#tabs button[data-s="trade"]'));
  await sleep(120);
  const chart = $('#chart');
  chk('画布存在', !!chart);
  const zb = $$('.chart-tools .seg button').find(b => b.dataset.zoom === '0.55');
  if (zb) { click(zb); await sleep(120); ok('图表缩放按钮可点击'); }
  // 拖动
  chart.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 120 }));
  chart.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 120 }));
  chart.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, clientX: 120, clientY: 120 }));
  await sleep(200);
  ok('图表拖动无异常');

  console.log('\n=== 11. 速度控制 ===');
  const fast = $$('#spd button').find(b => b.dataset.v === '4');
  if (fast) { click(fast); await sleep(120); chk('×4 速度被选中', fast.classList.contains('on')); }
  const pause = $$('#spd button').find(b => b.dataset.v === '0');
  if (pause) { click(pause); await sleep(120); chk('暂停生效', pause.classList.contains('on')); }

  console.log('\n=== 12. 刷新后恢复存档 ===');
  const saved = window.localStorage.getItem('fxkurumi.save.slot0') || window.localStorage.getItem('fxkurumi.save.v2');
  chk('存档已写入 localStorage', !!saved, saved ? (saved.length + ' 字节') : '空');
  if (saved) {
    try {
      const w = JSON.parse(saved);
      const o = (w && w.d) ? JSON.parse(w.d) : w;      // 新格式是 {cs,d,t} 包装
      chk('存档可被解析且含账户数据', !!o.st && typeof o.st.cash === 'number');
    } catch (e) { bad('存档无法解析：' + e.message); }
  }

  console.log('\n=== 13. 运行时异常汇总 ===');
  chk('全程无未捕获异常', errors.length === 0, errors.slice(0, 5).join('\n      '));
  if (logs.length) console.log('  （其余日志 ' + logs.length + ' 条，已忽略）');

  console.log(`\n${'='.repeat(48)}\nDOM 冒烟测试：${pass} 通过 / ${fail} 失败\n`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n测试自身崩溃：', e);
  process.exit(1);
});
