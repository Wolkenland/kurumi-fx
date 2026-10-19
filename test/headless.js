/* 无头测试：验证市场/保证金/爆仓/借贷的数学是否正确。node test/headless.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error,
  setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
function fakeCtx(){ return new Proxy({}, { get:(t,k)=> (k==='createLinearGradient'||k==='createRadialGradient')
  ? (()=>({addColorStop(){}})) : (k==='measureText' ? (()=>({width:10})) : (()=>{})) }); }
function fakeEl(){
  return { style:{}, classList:{add(){},remove(){},toggle(){return true},contains(){return false}},
    innerHTML:'', textContent:'', value:'', dataset:{}, scrollTop:0, offsetWidth:0,
    childElementCount:0, width:0, height:0,
    appendChild(c){return c}, remove(){}, focus(){}, select(){}, setAttribute(){},
    addEventListener(){}, removeEventListener(){}, setPointerCapture(){},
    querySelector(){return fakeEl()}, querySelectorAll(){return []},
    getBoundingClientRect(){return {width:360,height:260,left:0,top:0}},
    getContext(){return fakeCtx()}, closest(){return null}, contains(){return false} };
}
sandbox.document = { querySelector:()=>fakeEl(), querySelectorAll:()=>[], getElementById:()=>fakeEl(),
  createElement:()=>fakeEl(), createTextNode:()=>fakeEl(), body:fakeEl(), head:fakeEl(),
  readyState:'complete', addEventListener(){}, removeEventListener(){} };
sandbox.navigator = { vibrate(){} };
sandbox.localStorage = undefined;
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js'];
let bundle = '';
for (const f of files) bundle += `\n/*== ${f} ==*/\n` + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Market, Core, Series, CandleChart, PAIRS, PAIR_ORDER, LOAN_PRODUCTS,
  TICKS_PER_DAY, TICKS_PER_BAR, BARS_PER_DAY, initialState, BARKS, Tutorials, Chapters, NEWS_POOL, Surface };\n`;
try { vm.runInContext(bundle, sandbox, { filename: 'bundle.js' }); }
catch (e) { console.error('✗ 加载失败: ' + e.stack); process.exit(1); }

const { U, Market, Core, PAIRS, TICKS_PER_DAY, LOAN_PRODUCTS, PAIR_ORDER, initialState } = sandbox.__X;

/* 05-tutorials.js 里引用了 UI 层的小工具（$ / $$ / el），这里补桩 */
function stubEl(){
  return { style:{}, classList:{add(){},remove(){},toggle(){return true}},
    innerHTML:'', textContent:'', value:'', dataset:{}, scrollTop:0,
    appendChild(c){return c}, remove(){}, querySelector(){return stubEl()}, querySelectorAll(){return []},
    addEventListener(){}, getBoundingClientRect(){return {width:1,height:1,left:0,top:0}} };
}
sandbox.$ = () => stubEl();
sandbox.$$ = () => stubEl();
sandbox.el = () => stubEl();
sandbox.bindTap = () => {};
sandbox.Sheets = { msg(){}, number(){}, borrow(){}, result(){}, base(){return stubEl()}, close(){} };
sandbox.Confirm = { ask(){} };
sandbox.UI = { effects:false, toast(){}, renderAll(){}, showScreen(){} };
sandbox.Camera = { shake(){} };
sandbox.FX = { alert(){}, bark(){}, newsTicker(){}, pulse(){} };
sandbox.Sfx = { crash(){}, heart(){}, loan(){}, alarm(){}, coin(){}, error(){}, click(){}, open(){}, close(){},
  buy(){}, sell(){}, win(){}, lose(){}, bigwin(){}, boot(){}, resume(){}, setEnabled(){}, isEnabled(){return false} };
sandbox.Haptics = { tap(){}, press(){}, win(){}, lose(){}, crash(){} };
sandbox.Store = { load(){return null}, save(){return true}, clear(){}, exportString(){return ''}, importString(){return null} };

let pass = 0, fail = 0;
const t = (name, cond, info) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info ? '  → ' + info : '')); }
};
const near = (a, b, tol) => {
  if (a === b) return true;                                   // 含 Infinity === Infinity
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);
};

/** 把当前品种价格推到指定维持率（用保证金账本反推） */
function forceRate(c, targetRate) {
  const s = c.market.pair();
  const U0 = c.usedMargin();
  if (U0 <= 0) return;
  const P = c.st.positions.filter(p => p.pid === s.def.id)
    .reduce((a, p) => a + p.units * p.dir, 0);
  const targetEq = U0 * targetRate / 100;
  const dp = (targetEq - c.equity()) / P;
  s.price += dp;
  if (s.cur) { s.cur.c = s.price; s.cur.h = Math.max(s.cur.h, s.price); s.cur.l = Math.min(s.cur.l, s.price); }
}

console.log('\n=== 1. 市场引擎 ===');
{
  const m = new Market(12345);
  t('5 个货币对全部建立', PAIR_ORDER.every(id => m.map[id]));
  const s = m.pair('USDJPY');
  t('初始有历史 K 线 (>=100)', s.bars.length >= 100, 'bars=' + s.bars.length);
  t('所有价格为正', PAIR_ORDER.every(id => m.map[id].price > 0));
  for (let i = 0; i < 3000; i++) m.tick();
  t('推进后价格仍为正', PAIR_ORDER.every(id => m.map[id].price > 0),
    PAIR_ORDER.map(id => id + '=' + m.map[id].price.toFixed(3)).join(' '));
  const hm = m.pair('USDJPY');
  const bad = hm.bars.filter(b => !(b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9));
  t('OHLC 不变式成立 (h>=max(o,c), l<=min(o,c))', bad.length === 0, bad.length + ' 根异常');
  t('产生了新闻事件', m.newsLog.length > 0, m.newsLog.length + ' 条');
  t('日计数推进', m.day > 0, 'day=' + m.day);
  t('K 线缓存有上限', hm.bars.length <= 621, 'bars=' + hm.bars.length);
}

console.log('\n=== 2. 保证金与净值数学 ===');
{
  const c = new Core();
  c.st.cash = 1000000;
  const s = c.market.pair('USDJPY');
  const px = s.ask();
  const units = 10000, lev = 10;
  const r = c.open('USDJPY', 1, units, lev);
  t('开仓成功', r.ok, r.why);
  const expectMargin = units * px / lev;
  t('必要保证金 = 量×价÷杠杆', near(c.usedMargin(), expectMargin, 0.01),
    `${c.usedMargin().toFixed(2)} vs ${expectMargin.toFixed(2)}`);
  t('开仓后现金减少对应保证金', near(c.st.cash, 1000000 - expectMargin, 0.01));
  t('净值 = 现金 + 浮动盈亏', near(c.equity(), c.st.cash + c.unrealizedAll(), 0.01));
  t('维持率 = 净值/必要保证金×100', near(c.marginRate(), c.equity() / c.usedMargin() * 100, 0.01));
  // 开仓立刻是负的：你是按 Ask 买、按 Bid 卖，点差就是入场即亏的交易成本
  const spreadCost = s.def.spread * units;
  t('开仓即承担点差成本', near(-c.unrealized(c.st.positions[0]), spreadCost, 0.01),
    (-c.unrealized(c.st.positions[0])).toFixed(2) + ' vs ' + spreadCost.toFixed(2));
  const entry = c.st.positions[0].entry;
  s.price = entry + 1.0;
  const pnl = c.unrealized(c.st.positions[0]);
  t('1万通貨 涨1円 ≈ +10000 円', near(pnl, 10000, 10), pnl.toFixed(2));
  // 回到开仓时的市场价 → 仍亏一个点差；必须涨到建値才不亏
  s.price = entry - s.def.spread;
  t('价格回到原处仍亏一个点差', near(c.unrealized(c.st.positions[0]), -spreadCost, 0.01),
    c.unrealized(c.st.positions[0]).toFixed(2));
  s.price = entry;                       // 建値（你买入的那个价）
  t('涨过点差、回到建値才不亏不赚',
    near(c.unrealized(c.st.positions[0]), 0, 0.01), c.unrealized(c.st.positions[0]).toFixed(2));
  const c2 = c.close(c.st.positions[0].id, 4000);
  t('部分平仓成功', c2.ok);
  t('剩余量正确', c.st.positions[0].units === 6000, 'units=' + c.st.positions[0].units);
}

console.log('\n=== 3. 杠杆与爆仓距离成反比 ===');
{
  // 满仓（现金刚好等于必要保证金）时，理论爆仓距离 = 50 / 杠杆
  const mk = lev => {
    const c = new Core();
    const px = c.market.pair('USDJPY').ask();
    const units = 10000;
    c.st.cash = 2 * units * px / lev;      // 用一半资金做保证金（另一半作缓冲）
    c.open('USDJPY', 1, units, lev);
    const s = c.market.pair('USDJPY');
    return (s.price - c.liqPriceFor('USDJPY')) / s.price * 100;
  };
  const a = mk(10), b = mk(50), d = mk(100);
  t('10× 爆仓距离 > 50× > 100×', a > b && b > d,
    `10×=${a.toFixed(3)}%  50×=${b.toFixed(3)}%  100×=${d.toFixed(3)}%`);
  t('爆仓距离 = 50 ÷ 杠杆（一半资金作保证金的教科书公式）',
    Math.abs(a - 5) < 0.1 && Math.abs(b - 1) < 0.05 && Math.abs(d - 0.5) < 0.03,
    `10×→${a.toFixed(3)}%  50×→${b.toFixed(3)}%  100×→${d.toFixed(3)}%`);
  console.log(`     一半保证金时 10×→${a.toFixed(3)}%   50×→${b.toFixed(3)}%   100×→${d.toFixed(3)}%`);
  // 极端情况：现金刚好等于保证金 → 点差直接把人打到强平线以下
  const c9 = new Core();
  const px9 = c9.market.pair('USDJPY').ask();
  c9.st.cash = 10000 * px9 / 100;
  c9.open('USDJPY', 1, 10000, 100);
  t('杠杆拉满且不留缓冲 → 一开仓就已在强平线以下', c9.marginRate() < 50,
    'rate=' + c9.marginRate().toFixed(2) + '%');
}

console.log('\n=== 4. 闲置资金会缓冲爆仓（真实金融行为）===');
{
  const a = new Core(); a.st.cash = 50000;
  a.open('USDJPY', 1, 10000, 100);
  const pa = a.market.pair('USDJPY').price;
  const distPoor = (pa - a.liqPriceFor('USDJPY')) / pa * 100;
  const b = new Core(); b.st.cash = 1000000;
  b.open('USDJPY', 1, 10000, 100);
  const pb = b.market.pair('USDJPY').price;
  const distRich = (pb - b.liqPriceFor('USDJPY')) / pb * 100;
  t('同样手数，闲置资金多 → 爆仓距离更远', distRich > distPoor * 2,
    `穷 ${distPoor.toFixed(3)}% vs 富 ${distRich.toFixed(3)}%`);
}

console.log('\n=== 5. 强制平仓（维持率 50%）===');
{
  const c = new Core();
  c.st.cash = 100000;
  c.open('USDJPY', 1, 10000, 100);
  forceRate(c, 49);
  t('维持率已 <50%', c.marginRate() < 50, 'rate=' + c.marginRate().toFixed(1) + '%');
  c.checkRisk();
  t('触发强平，持仓清零', c.st.positions.length === 0, '剩 ' + c.st.positions.length);
  t('记录了强平次数', c.st.stats.liquidated === 1);
  t('强平记录 reason=liquidated', c.st.closed[0] && c.st.closed[0].reason === 'liquidated');
  t('强平后仍有剩余资金（不是归零）', c.st.cash > 0, 'cash=' + c.st.cash.toFixed(0));
  t('强平后维持率回到 Infinity', c.marginRate() === Infinity);
  t('冷静值大幅下降', c.st.stats.mental < 90, 'mental=' + c.st.stats.mental.toFixed(1));
}

console.log('\n=== 6. 追证（维持率 100%）===');
{
  const c = new Core();
  c.st.cash = 1000000;
  c.open('USDJPY', 1, 10000, 20);
  forceRate(c, 130);
  c.checkRisk();
  t('维持率 130% 时安全，不触发追证', !c.marginCall, 'rate=' + c.marginRate().toFixed(1) + '%');
  forceRate(c, 95);
  t('维持率约 95%', Math.abs(c.marginRate() - 95) < 1.5, c.marginRate().toFixed(1) + '%');
  c.checkRisk();
  t('跌破 100% 触发追证 marginCall', c.marginCall && c.marginCall.level === 1);
  t('未强平', c.st.positions.length === 1);
  forceRate(c, 140);
  c.checkRisk();
  t('维持率恢复后解除追证', c.marginCall === null);
}

console.log('\n=== 7. 隔夜利息（スワップ）===');
{
  const c = new Core();
  c.st.cash = 5000000;
  c.open('ZARJPY', -1, 100000, 10);
  c.st.date.day = 4;
  c.newDay();
  t('做空高息货币 → swap 为负', c.st.swapToday < 0, 'swap=' + c.st.swapToday.toFixed(2));
  const c2 = new Core();
  c2.st.cash = 5000000;
  c2.open('ZARJPY', 1, 100000, 10);
  c2.st.date.day = 4;
  c2.newDay();
  t('做多高息货币 → swap 为正', c2.st.swapToday > 0, 'swap=' + c2.st.swapToday.toFixed(2));
}

console.log('\n=== 8. 借贷系统 ===');
{
  const c = new Core();
  c.st.flags.hasJob = true;
  t('消費者金融 可选', !!c.loanOffers().find(o => o.id === 'consumer'));
  const before = c.st.wallet;
  const r = c.borrow('consumer', 1000000);
  t('借款成功', r.ok, r.why);
  t('到手 = 金额 − 手数料 1%', near(c.st.wallet - before, 990000, 0.5), 'got=' + (c.st.wallet - before));
  t('负债计入 totalLoan', near(c.totalLoan(), 1000000, 0.5));
  t('负债从净值中扣除', near(c.netAsset(), c.st.cash + c.st.wallet + c.unrealizedAll() - 1000000, 0.5));
  const r2 = c.borrow('consumer', 2000000);
  t('超出渠道上限被拒绝', !r2.ok, r2.why);
  const r3 = c.borrow('mochiko', 1000);
  t('未解锁的渠道借不到', !r3.ok, r3.why);
  const owed = c.totalLoan();
  c.accrueInterest(5);
  const delta = c.totalLoan() - owed;
  t('每日利息 ≈ 年利18%/365', near(delta, owed * 0.18 / 365, 2), delta.toFixed(2));
  c.st.cash = 2000000;
  const rr = c.repay('consumer', 500000);
  t('还款成功', rr.ok);
  t('负债相应减少', c.totalLoan() < 1600000, c.totalLoan().toFixed(0));
}

console.log('\n=== 9. 萌智子 109% 的真实代价 ===');
{
  const c = new Core();
  c.st.flags.mochikoDeal = true;
  const d = LOAN_PRODUCTS.find(x => x.id === 'mochiko');
  t('年利 109%', near(d.rate, 1.09));
  c.borrow('mochiko', 1000000);
  c.st.wallet = 0;
  const start = c.totalLoan();
  for (let day = 1; day <= 365; day++) c.accrueInterest(day);
  const growth = c.totalLoan() / start;
  t('一年后本息 ≈ 2.97 倍（日复利，与真实券商一致）',
    Math.abs(growth - Math.pow(1 + 1.09 / 365, 365)) < 0.001, `×${growth.toFixed(3)}`);
  t('日复利结果高于简单年利 2.09 倍', growth > 2.09, `×${growth.toFixed(3)}`);
  console.log(`     借 100 万 → 一年后 ${Math.round(c.totalLoan()).toLocaleString()} 円`);
  const c2 = new Core();
  c2.st.flags.mochikoDeal = true;
  c2.borrow('mochiko', 1000000);
  c2.st.wallet = 0;
  for (let day = 1; day <= 100; day++) c2.accrueInterest(day);
  t('100 天后本金增长约 34.7%', Math.abs(c2.totalLoan() / 1000000 - Math.pow(1 + 1.09 / 365, 100)) < 0.001,
    (c2.totalLoan() / 1000000).toFixed(3));
  t('换算成"每天"约 0.3%', Math.abs(Math.pow(1 + 1.09 / 365, 1) - 1.00299) < 0.0001,
    ((Math.pow(1 + 1.09 / 365, 1) - 1) * 100).toFixed(4) + '%/天');
}

console.log('\n=== 10. 存档 / 读档一致性 ===');
{
  const c = new Core();
  c.st.cash = 4000000;
  c.open('EURJPY', -1, 20000, 5);        // 低杠杆：保证 400 帧内不会被强平
  for (let i = 0; i < 400; i++) c.tick();
  const snap = { cash: c.st.cash, pos: c.st.positions.length, price: c.market.pair('EURJPY').price,
                 bars: c.market.pair('EURJPY').bars.length, rate: c.marginRate() };
  const blob = JSON.parse(JSON.stringify({ st: c.st, market: c.market.serialize() }));
  const c2 = new Core();
  c2.st = U.merge(initialState(), blob.st);
  c2.market = new Market(c2.st.seed);
  c2.market.restore(blob.market);
  t('读档后现金一致', near(c2.st.cash, snap.cash, 0.001));
  t('读档后持仓数一致', c2.st.positions.length === snap.pos);
  t('读档后价格一致', near(c2.market.pair('EURJPY').price, snap.price, 1e-9));
  t('读档后 K 线数量一致', c2.market.pair('EURJPY').bars.length === snap.bars);
  t('读档前确实还有持仓（否则这项测不到东西）', c.st.positions.length === 1,
    'positions=' + c.st.positions.length);
  t('读档后维持率一致', near(c2.marginRate(), snap.rate, 0.01),
    c2.marginRate().toFixed(6) + ' vs ' + snap.rate.toFixed(6));
}

console.log('\n=== 11. 数值健壮性（长时间随机操作不炸）===');
{
  const c = new Core();
  c.st.cash = 500000;
  let err = null;
  try {
    for (let i = 0; i < 40; i++) {
      c.open(PAIR_ORDER[i % 5], i % 2 ? 1 : -1, 20000, (i % 4) * 25 + 1);
      for (let k = 0; k < 120; k++) c.tick();
      if (c.st.cash > 1000) c.closeAll('manual');
    }
  } catch (e) { err = e; }
  t('随机下单/推进行情 40 轮无异常', !err, err && (err.message + '\n' + err.stack));
  t('账户数值始终有限', isFinite(c.st.cash) && isFinite(c.equity()) && isFinite(c.totalLoan()),
    `cash=${c.st.cash} eq=${c.equity()}`);
  t('价格全部有限且为正',
    PAIR_ORDER.every(id => isFinite(c.market.map[id].price) && c.market.map[id].price > 0));
  t('K 线缓存有上限（无内存泄漏）', PAIR_ORDER.every(id => c.market.map[id].bars.length <= 621));
}

console.log('\n=== 12. 教学内容完整性 ===');
{
  const { Tutorials, Chapters } = sandbox.__X;
  const ids = Object.keys(Tutorials.DEFS);
  t('教学条目 >= 6 个', ids.length >= 6, ids.length + ' 个');
  t('每条教学 >= 3 页', ids.every(k => Tutorials.DEFS[k].pages.length >= 3));
  t('教学覆盖杠杆/保证金/借贷', ['leverage', 'margin', 'debt'].every(k => Tutorials.DEFS[k]));
  t('章节 >= 12 个', Chapters.STORY.length >= 12, Chapters.STORY.length + ' 个');
  t('每章都有 id/title/cond', Chapters.STORY.every(s => s.id && s.title && typeof s.cond === 'function'));
  t('章节 id 无重复', new Set(Chapters.STORY.map(s => s.id)).size === Chapters.STORY.length);
  const stubUI = { toast() {}, renderAll() {}, showScreen() {},
    get effects() { return false; } };
  let ok = true, who = '';
  for (const s of Chapters.STORY) {
    if (!s.onEnter) continue;
    const c = new Core();
    try { Tutorials.init(c, stubUI); Chapters.init(c, stubUI); s.onEnter(c, stubUI); }
    catch (e) { ok = false; who = s.id + ': ' + e.message; break; }
  }
  t('所有章节 onEnter 可无异常执行', ok, who);
}

console.log(`\n${'='.repeat(48)}\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
