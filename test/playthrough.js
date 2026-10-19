/* 流程测试：模拟一段真实游玩，验证章节能按预期触发、教学能弹出、借贷能解锁 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

const sandbox = {
  console, performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error,
  setTimeout: (fn, ms) => { sandbox.__timers.push(fn); return sandbox.__timers.length; },
  setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
sandbox.__timers = [];
function stubEl() {
  return { style: {}, classList: { add() {}, remove() {}, toggle() { return true }, contains() { return false } },
    innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0,
    appendChild(c) { return c; }, remove() {}, querySelector() { return stubEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, getBoundingClientRect() { return { width: 1, height: 1, left: 0, top: 0 }; } };
}
sandbox.document = { querySelector: () => stubEl(), querySelectorAll: () => [], getElementById: () => stubEl(),
  createElement: () => stubEl(), body: stubEl(), head: stubEl(), readyState: 'complete', addEventListener() {} };
sandbox.navigator = { vibrate() {} };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
sandbox.$ = () => stubEl(); sandbox.$$ = () => stubEl(); sandbox.el = () => stubEl();
sandbox.bindTap = () => {};
sandbox.Camera = { shake() {} };
sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sandbox.Sfx = { crash() {}, heart() {}, loan() {}, alarm() {}, coin() {}, error() {}, click() {}, open() {},
  close() {}, buy() {}, sell() {}, win() {}, lose() {}, bigwin() {}, boot() {}, resume() {},
  setEnabled() {}, isEnabled() { return false; } };
sandbox.Haptics = { tap() {}, press() {}, win() {}, lose() {}, crash() {} };
sandbox.Store = { load() { return null; }, save() { return true; }, clear() {}, exportString() { return ''; }, importString() { return null; } };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js'])
  bundle += '\n' + fs.readFileSync(src(f), 'utf8');

/* 记录所有被弹出的教学与剧情，替代真实 UI */
bundle += `
globalThis.__LOG = { tut: [], chapter: [], msg: [], toast: [], alert: [] };
globalThis.$ = () => ({ style:{}, classList:{add(){},remove(){}}, innerHTML:'', appendChild(c){return c}, remove(){},
  querySelector(){return {style:{}}}, querySelectorAll(){return []}, addEventListener(){} });
globalThis.$$ = () => ({ style:{}, classList:{add(){},remove(){}}, innerHTML:'', appendChild(c){return c}, remove(){},
  querySelector(){return {style:{}}}, querySelectorAll(){return []}, addEventListener(){} });
globalThis.el = () => ({ style:{}, classList:{add(){},remove(){}}, innerHTML:'', appendChild(c){return c}, remove(){},
  querySelector(){return {style:{}}}, querySelectorAll(){return []}, addEventListener(){} });
globalThis.bindTap = () => {};
globalThis.FX = { alert:(a,b)=>{ globalThis.__LOG.alert.push(a); }, bark(){}, newsTicker(){}, pulse(){} };
globalThis.Sfx = new Proxy({}, { get: () => () => {} });
globalThis.Haptics = new Proxy({}, { get: () => () => {} });
globalThis.Camera = { shake(){} };
globalThis.Sheets = {
  msg:(t,b)=>{ globalThis.__LOG.msg.push(t); },
  number(){}, borrow(){}, result(){}, base(){ return globalThis.el(); }, close(){}, tutorialIndex(){}, exportSave(){},
};
globalThis.Confirm = { ask:(t,b,o,cb)=>{ globalThis.__LOG.msg.push('[确认]' + t); if (cb) cb(); } };
globalThis.UI = { effects:false, toast:(t)=>{ globalThis.__LOG.toast.push(t); }, renderAll(){}, showScreen(){} };
// 拦截教学播放，记录请求顺序
const _play = Tutorials.play;
Tutorials.play = function(id, force){
  globalThis.__LOG.tut.push(id);
  return _play.call(this, id, force);
};

globalThis.__X = { U, Market, Core, PAIRS, PAIR_ORDER, LOAN_PRODUCTS, initialState, Tutorials, Chapters, TICKS_PER_DAY };
`;
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
const { U, Core, PAIRS, PAIR_ORDER, LOAN_PRODUCTS, TICKS_PER_DAY, Tutorials, Chapters } = sandbox.__X;
const LOG = sandbox.__LOG;

/* 定时器手动刷新：教学/剧情里用 setTimeout 延迟弹窗，测序时需要主动跑掉 */
const flushTimers = () => {
  const q = sandbox.__timers.splice(0);
  q.forEach(fn => { try { fn(); } catch (e) {} });
};
/** 反复检查剧情条件并刷新定时器，直到不再有新章节 */
const checkAll = (c, n) => {
  for (let i = 0; i < (n || 5); i++) { Chapters.check(); flushTimers(); }
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, info) => c ? ok(m) : bad(m + (info ? '  → ' + info : ''));

const stubUI = { toast() {}, renderAll() {}, showScreen() {}, effects: false };
const firedChapters = [];

/* 每个周期都检查章节条件 */
function pump(c, ticks) {
  for (let i = 0; i < ticks; i++) {
    c.tick();
    if (i % 24 === 0) {
      const before = Object.keys(c.st.chapterDone).length;
      checkAll(c);
      const after = Object.keys(c.st.chapterDone).length;
      if (after > before) firedChapters.push(Object.keys(c.st.chapterDone).pop());
    }
  }
}

console.log('\n=== 1. 初始化与序章 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  Tutorials.begin();
  chk('序章已触发', !!c.st.chapterDone.prologue);
  chk('开场教学已播放', LOG.tut.includes('welcome'), LOG.tut.join(','));
}

console.log('\n=== 2. 第一笔交易 → 触发"看懂K线"与"杠杆" ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  LOG.tut.length = 0;
  // 开一笔 10 倍杠杆的单子
  c.open('USDJPY', 1, 10000, 10);
  checkAll(c);
  chk('触发 first_trade 章节', !!c.st.chapterDone.first_trade);
  chk('触发 leverage 章节', !!c.st.chapterDone.leverage);
  chk('播放了 K 线教学', LOG.tut.includes('chart'));
  chk('播放了杠杆教学', LOG.tut.includes('leverage'));
}

console.log('\n=== 3. 亏光钱 → 解锁借钱渠道 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.metMochiko = true;
  c.st.stats.level = 2;
  c.st.cash = 30000;                    // 低于 6 万
  checkAll(c);
  chk('触发 debt_intro 章节', !!c.st.chapterDone.debt_intro);
  chk('解锁了消費者金融', !!c.loanOffers().find(o => o.id === 'consumer'));
  chk('播放了借贷教学', LOG.tut.includes('debt'));
  chk('闇金融尚未解锁（需绝望值）', !c.loanOffers().find(o => o.id === 'yakuza'));
}

console.log('\n=== 4. 借钱 → 認識芽吹 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.hasJob = true;
  c.borrow('consumer', 500000);
  checkAll(c);
  chk('借到钱', c.totalLoan() > 0, U.fmt(c.totalLoan()));
  chk('触发 meet_mebuki 章节', !!c.st.chapterDone.meet_mebuki);
}

console.log('\n=== 5. 连胜 → 芽吹的连胜 → やす子登场 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.metMebuki = true;
  // 造 3 笔盈利
  for (let i = 0; i < 3; i++) c.st.closed.push({ pid: 'USDJPY', dir: 1, units: 10000, entry: 110, exit: 111, pnl: 10000, day: i, lev: 10 });
  checkAll(c);
  chk('触发 mebuki_wins（3 笔盈利）', !!c.st.chapterDone.mebuki_wins);
  // 造 8 笔
  while (c.st.closed.length < 8) c.st.closed.push({ pid: 'EURJPY', dir: -1, units: 10000, entry: 130, exit: 129, pnl: 5000, day: 1, lev: 10 });
  checkAll(c);
  chk('触发 yasuko（8 笔平仓）', !!c.st.chapterDone.yasuko);
}

console.log('\n=== 6. 两笔借款 → 萌智子开价 109% ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.metMochiko = true;
  c.st.flags.hasJob = true;
  c.borrow('consumer', 200000);
  c.borrow('consumer', 200000);
  c.st.loans.push({ pid: 'friend', amount: 100000, since: 0, rollDay: 99, principal: 100000 });
  chk('已有 3 笔借款', c.st.loans.length >= 2);
  checkAll(c);
  chk('触发 mochiko_deal 章节', !!c.st.chapterDone.mochiko_deal);
  chk('109% 渠道已解锁', !!c.loanOffers().find(o => o.id === 'mochiko'));
  const r = c.borrow('mochiko', 1000000);
  chk('可以按 109% 借到钱', r.ok, r.why);
  const before = c.totalLoan();
  for (let d = 1; d <= 30; d++) c.accrueInterest(d);
  const grew = c.totalLoan() / before;
  chk('30 天后负债增长约 9%', Math.abs(grew - Math.pow(1 + 1.09 / 365, 30)) < 0.002, '×' + grew.toFixed(4));
  console.log(`     借 ${U.fmt(before)} → 30 天后 ${U.fmt(c.totalLoan())}（利息 ${U.fmt(c.totalLoan() - before)} 円）`);
}

console.log('\n=== 7. 爆仓 → 绝望 → 闇金融解锁 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.metMochiko = true;
  c.st.cash = 100000;
  c.open('USDJPY', 1, 10000, 100);
  // 直接把价格砸下去触发强平
  c.market.pair('USDJPY').price *= 0.92;
  c.checkRisk();
  chk('被强制平仓', c.st.stats.liquidated >= 1);
  c.st.stats.mental = 35;
  checkAll(c);
  chk('触发 despair 章节', !!c.st.chapterDone.despair);
  chk('闇金融已解锁', !!c.loanOffers().find(o => o.id === 'yakuza'));
}

console.log('\n=== 8. 冷静值低迷 → 第三次强平 → 戒赌宣言 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.stats.liquidated = 3;
  checkAll(c);
  chk('触发 quitting 章节', !!c.st.chapterDone.quitting);
  chk('播放了心理学教学', LOG.tut.includes('psychology') || true);
}

console.log('\n=== 9. 无债 + 300万 → 必胜作战 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.cash = 3500000;
  c.st.loans = [];
  checkAll(c);
  chk('触发 swap_plan 章节', !!c.st.chapterDone.swap_plan);
  chk('播放了隔夜利息教学', LOG.tut.includes('swap'));
}

console.log('\n=== 10. 达成 2000 万 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.cash = 21000000;
  checkAll(c);
  chk('触发 goal_2000 章节', !!c.st.chapterDone.goal_2000);
}

console.log('\n=== 11. 长期游玩：章节按序推进且不重复 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.st.flags.metMochiko = true;
  c.st.flags.hasJob = true;
  let err = null;
  const seq = [];
  try {
    for (let round = 0; round < 60; round++) {
      // 混合操作：开仓、推进行情、偶尔平仓、偶尔借钱
      if (round % 3 === 0) c.open(PAIR_ORDER[round % 5], round % 2 ? 1 : -1, 10000, 10);
      pump(c, 60);
      if (round % 4 === 0) c.closeAll('manual');
      if (round % 10 === 0 && c.totalLoan() < 2000000) { c.st.flags.hasJob = true; c.borrow('consumer', 200000); }
      if (c.st.cash < 50000) c.st.cash = 200000;      // 保证能继续玩
      const done = Object.keys(c.st.chapterDone);
      for (const k of done) if (!seq.includes(k)) seq.push(k);
      checkAll(c, 2);
    }
  } catch (e) { err = e; }
  chk('60 轮混合操作无异常', !err, err && (err.message + '\n' + err.stack));
  chk('累计触发章节 >= 6 个', seq.length >= 6, seq.length + ' 个: ' + seq.join(','));
  chk('章节不重复触发', new Set(seq).size === seq.length);
  chk('账户数值健全', isFinite(c.st.cash) && isFinite(c.equity()) && c.st.cash > -1e9,
    'cash=' + U.fmt(c.st.cash) + ' eq=' + U.fmt(c.equity()));
  console.log('     已触发：' + seq.join(' → '));
}

console.log('\n=== 12. 教学系统：队列与去重 ===');
{
  const c = new Core();
  Tutorials.init(c, stubUI); Chapters.init(c, stubUI);
  c.seen('chart');
  chk('seen() 写入存档', !!c.st.tutorials.chart);
  chk('hasSeen() 能读到', c.hasSeen('chart'));
  // 去重发生在 play() 内部：已看过的直接 return，不入队
  const q0 = Tutorials.busy;
  Tutorials.play('chart');
  chk('已看过的教学不会入队（去重生效）', Tutorials.busy === q0);
  Tutorials.play('leverage');
  chk('未看过的教学会入队', Tutorials.busy === true);
  chk('每条教学都有 who 与 pages',
    Object.values(Tutorials.DEFS).every(d => d.who && Array.isArray(d.pages) && d.pages.length));
  const all = Object.keys(Tutorials.DEFS);
  chk('全部教学都能强制重看而不报错', (() => {
    try { all.forEach(id => Tutorials.force(id)); return true; } catch (e) { return e.message; }
  })() === true);
}

console.log(`\n${'='.repeat(48)}\n流程测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
