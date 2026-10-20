/* 黑天鹅事件 + 多结局 专项测试 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);
const sb = {
  console, performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error, Promise,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
function stub() {
  return { style: {}, classList: { add() {}, remove() {}, toggle() { return true }, contains() { return false } },
    innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0,
    appendChild(c) { return c; }, remove() {}, querySelector() { return stub(); }, querySelectorAll() { return []; },
    addEventListener() {}, getBoundingClientRect() { return { width: 1, height: 1, left: 0, top: 0 }; } };
}
sb.document = { querySelector: () => stub(), querySelectorAll: () => [], getElementById: () => null,
  createElement: () => stub(), body: stub(), head: stub(), readyState: 'complete', addEventListener() {} };
sb.navigator = { vibrate() {} };
sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
for (const k of ['$', '$$', '$$$', 'el', 'bindTap']) sb[k] = () => stub();
sb.Camera = { shake() {} };
sb.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sb.Sfx = new Proxy({}, { get: () => () => {} });
sb.Haptics = new Proxy({}, { get: () => () => {} });
sb.Sheets = { msg() {}, base: () => stub(), close() {} };
sb.Confirm = { ask() {} };
sb.UI = { effects: false, toast() {}, renderAll() {}, showScreen() {} };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
  bundle += '\n' + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Core, Market, BLACK_SWAN, ENDINGS, PAIRS, PAIR_ORDER };\n`;
vm.runInContext(bundle, sb, { filename: 'bundle.js' });
const { U, Core, Market, BLACK_SWAN, ENDINGS, PAIRS, PAIR_ORDER } = sb.__X;

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, i) => c ? ok(m) : bad(m + (i ? '  → ' + i : ''));

console.log('\n=== 1. 黑天鹅定义 ===');
chk('共 5 种黑天鹅', BLACK_SWAN.length === 5, String(BLACK_SWAN.length));
chk('每个事件字段完整', BLACK_SWAN.every(e =>
  e.id && e.name && Array.isArray(e.pairs) && e.jump.length === 2 && e.desc && e.head && e.spreadMul > 1));
chk('跳空幅度都是负的（暴跌）', BLACK_SWAN.every(e => e.jump[0] < 0 && e.jump[1] < 0));
chk('都涉及真实品种', BLACK_SWAN.every(e => e.pairs.every(id => !!PAIRS[id])));

console.log('\n=== 2. 触发与效果 ===');
{
  const m = new Market(99);
  const s = m.pair('CHFJPY');
  const before = s.price;
  // 强制触发：第一次 rnd 判定概率，第二次选事件，第三次算幅度
  let i = 0;
  m.rnd = () => [0.01, 0.0, 0.5][Math.min(i++, 2)];
  const sw = m.maybeBlackSwan();
  chk('能强制触发', !!sw, sw ? sw.ev.name : 'null');
  chk('价格发生跳空', Math.abs(m.pair('CHFJPY').price - before) > 1,
    `${before.toFixed(2)} → ${m.pair('CHFJPY').price.toFixed(2)}`);
  chk('点差被放大', m.spreadMulNow() > 1, m.spreadMulNow() + '×');
  chk('事件有剩余时长', m.swanLeft() > 0, m.swanLeft() + ' tick');
}

console.log('\n=== 3. 黑天鹅不叠加 ===');
{
  const m = new Market(99);
  m.swan = { ev: BLACK_SWAN[0], mag: -0.07, hit: [], left: 40, spreadMul: 10 };
  let i = 0;
  m.rnd = () => [0.01, 0.0, 0.5][Math.min(i++, 2)];
  chk('已有事件时不再触发', m.maybeBlackSwan() === null);
}

console.log('\n=== 4. 概率合理（不是天天来）===');
{
  const m = new Market(2024);
  let triggers = 0;
  const days = 400;
  for (let t = 0; t < days * 24; t++) {
    m.tick();
    if (m.swan && m.swan.left === (m.swan.ev.dur || 0) - 1) triggers++;
  }
  const rate = triggers / days;
  chk('触发率在 1%~10% 之间', rate > 0.01 && rate < 0.10, (rate * 100).toFixed(1) + '%（' + triggers + ' 次 / ' + days + ' 天）');
}

console.log('\n=== 5. 点差影响交易成本 ===');
{
  const c = new Core();
  const normal = c.spreadOf('USDJPY');
  c.market.swan = { ev: BLACK_SWAN[0], mag: -0.07, hit: [], left: 40, spreadMul: 10 };
  const swanSpread = c.spreadOf('USDJPY');
  chk('黑天鹅期间点差变大', swanSpread > normal * 5, `${normal.toFixed(4)} → ${swanSpread.toFixed(4)}`);
  c.market.swan = null;
  chk('事件结束后恢复', Math.abs(c.spreadOf('USDJPY') - normal) < 1e-9);
}

console.log('\n=== 6. 结局定义 ===');
chk('共 5 个结局', ENDINGS.length === 5, String(ENDINGS.length));
chk('每个结局字段完整', ENDINGS.every(e => e.id && e.name && e.title && e.body && typeof e.cond === 'function' && e.tone));
chk('有好有坏', ENDINGS.some(e => e.tone === 'good') && ENDINGS.some(e => e.tone === 'bad'));

console.log('\n=== 7. 结局触发 ===');
{
  const c = new Core();
  chk('初始没有结局', (c.st.endingsSeen || []).length === 0);
  // 坠落：负债 1000 万
  c.st.loans = [{ pid: 'consumer', amount: 12000000, since: 0, rollDay: 30, principal: 12000000 }];
  const e = c.checkEndings();
  chk('负债千万触发「坠落」', e && e.id === 'ruin', e && e.id);
  chk('记录了已见结局', c.st.endingsSeen.includes('ruin'));
  const again = c.checkEndings();
  chk('同一结局不重复触发', again === null || again.id !== 'ruin');
}

console.log('\n=== 8. 赎罪结局 ===');
{
  const c = new Core();
  c.st.cash = 25000000;
  c.st.wallet = 0;
  const e = c.checkEndings();
  chk('净值 2000 万触发「赎罪」', e && e.id === 'revenge', e && e.id);
}

console.log('\n=== 9. 清盘结局 ===');
{
  const c = new Core();
  c.st.cash = 100; c.st.wallet = 0;
  c.st.loans = [{ pid: 'consumer', amount: 500000, since: 0, rollDay: 10, principal: 500000 }];
  const e = c.checkEndings();
  chk('净值归零且有债 → 清盘', e && (e.id === 'wipeout' || e.id === 'ruin'), e && e.id);
}

console.log('\n=== 10. AI 不触发结局 ===');
{
  const ai = new Core();
  ai.agent = true;
  ai.st.cash = 50000000;
  chk('AI 不记录结局', ai.checkEndings() === null);
  chk('AI 结局列表为空', (ai.st.endingsSeen || []).length === 0);
}

console.log(`\n${'='.repeat(48)}\n黑天鹅/结局测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
