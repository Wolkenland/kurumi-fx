/* 洞察兑换与新永久技能的专项测试 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

const sandbox = {
  console, performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error, Promise,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
function stubEl() {
  return { style: {}, classList: { add() {}, remove() {}, toggle() { return true }, contains() { return false } },
    innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0,
    appendChild(c) { return c; }, remove() {}, querySelector() { return stubEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, getBoundingClientRect() { return { width: 1, height: 1, left: 0, top: 0 }; } };
}
sandbox.document = { querySelector: () => stubEl(), querySelectorAll: () => [], getElementById: () => stubEl(),
  createElement: () => stubEl(), body: stubEl(), head: stubEl(), readyState: 'complete', addEventListener() {} };
sandbox.navigator = { vibrate() {} };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const k of ['$', '$$', 'el', 'bindTap']) sandbox[k] = () => stubEl();
sandbox.Camera = { shake() {} };
sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sandbox.Sfx = new Proxy({}, { get: () => () => {} });
sandbox.Haptics = new Proxy({}, { get: () => () => {} });
sandbox.Store = { load() { return null; }, save() { return true; }, clear() {}, exportString() { return ''; }, importString() { return null; } };
sandbox.Sheets = { msg() {}, number() {}, borrow() {}, result() {}, base() { return stubEl(); }, close() {} };
sandbox.Confirm = { ask() {} };
sandbox.UI = { effects: false, toast() {}, renderAll() {}, showScreen() {} };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
  bundle += '\n' + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Core, PAIRS, PAIR_ORDER, LOAN_PRODUCTS, PERK_DEFS, PERK_ORDER, initialState };\n`;
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
const { U, Core, LOAN_PRODUCTS, PERK_DEFS, PERK_ORDER } = sandbox.__X;

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, i) => c ? ok(m) : bad(m + (i ? '  → ' + i : ''));
const near = (a, b, t) => a === b ? true : (!isFinite(a) || !isFinite(b) ? false : Math.abs(a - b) <= (t === undefined ? 1e-6 : t));

console.log('\n=== 1. 洞察兑换金钱 ===');
{
  const c = new Core();
  chk('兑换比例是 1 点 = 100000 円', c.insightRate() === 100000, String(c.insightRate()));
  c.st.insightPts = 5;
  const wallet0 = c.st.wallet;

  const r = c.exchangeInsight(1);
  chk('兑换 1 点成功', r.ok, r.why);
  chk('拿到 10 万円', r.money === 100000, String(r.money));
  chk('扣掉 1 点', c.st.insightPts === 4, String(c.st.insightPts));
  chk('钱进了钱包', c.st.wallet === wallet0 + 100000, String(c.st.wallet));
  chk('不进保证金账户', c.st.cash === 300000, String(c.st.cash));

  const r2 = c.exchangeInsight(10);
  chk('点数不足时拒绝', !r2.ok && /不足/.test(r2.why), r2.why);
  chk('拒绝时不扣点', c.st.insightPts === 4);
  chk('拒绝时不加钱', c.st.wallet === wallet0 + 100000);

  const r3 = c.exchangeInsight(0);
  chk('兑换 0 点被拒绝', !r3.ok, r3.why);
  const r4 = c.exchangeInsight(-3);
  chk('兑换负数被拒绝', !r4.ok, r4.why);
  const r5 = c.exchangeInsight(1.7);
  chk('小数向下取整（1.7 → 1 点）', r5.ok && r5.points === 1, JSON.stringify(r5));

  const all = c.exchangeInsight(c.st.insightPts);
  chk('全部兑换成功', all.ok, all.why);
  chk('兑换后点数归零', c.st.insightPts === 0, String(c.st.insightPts));
  chk('全部兑换金额正确', all.money === 3 * 100000, String(all.money));
}

console.log('\n=== 2. 兑换事件与日志 ===');
{
  const c = new Core();
  c.st.insightPts = 2;
  let got = null;
  c.on(ev => { if (ev.type === 'exchange') got = ev; });
  c.exchangeInsight(1);
  chk('派发 exchange 事件', !!got && got.points === 1 && got.money === 100000, JSON.stringify(got));
  chk('写入日志', c.st.log.some(l => l.kind === 'exchange'), JSON.stringify(c.st.log[0]));
}

console.log('\n=== 3. 技能表完整性 ===');
{
  chk('共 6 个技能', PERK_ORDER.length === 6, PERK_ORDER.join(','));
  chk('每个技能都有定义', PERK_ORDER.every(k => !!PERK_DEFS[k]));
  chk('每个技能都有图标与描述', PERK_ORDER.every(k =>
    PERK_DEFS[k].icon && typeof PERK_DEFS[k].desc === 'function'));

  const c = new Core();
  const maxes = PERK_ORDER.map(k => [k, c.perkMax(k)]);
  chk('满级配置正确（fees/rebate/credit/swap=3，intel/guts=2）',
    JSON.stringify(Object.fromEntries(maxes)) ===
    JSON.stringify({ fees: 3, rebate: 3, intel: 2, credit: 3, swap: 3, guts: 2 }),
    JSON.stringify(Object.fromEntries(maxes)));

  let monotonic = true;
  for (const k of PERK_ORDER) {
    let prev = 0;
    for (let lv = 1; lv <= c.perkMax(k); lv++) {
      const cost = c.perkCost(k, lv);
      if (!(cost > prev)) monotonic = false;
      prev = cost;
    }
  }
  chk('所有技能成本随等级递增', monotonic);
}

console.log('\n=== 4. 信用力：提升借贷额度 ===');
{
  const c = new Core();
  const consumer = LOAN_PRODUCTS.find(p => p.id === 'consumer');
  const base = c.loanLimit(consumer);
  chk('初始额度 = 原始上限', base === consumer.limit, `${base} vs ${consumer.limit}`);
  chk('初始倍率 = 1', near(c.loanLimitMul(), 1));

  c.st.insightPts = 100;
  c.buyPerk('credit');
  chk('Lv1 额度 +25%', near(c.loanLimit(consumer), Math.round(consumer.limit * 1.25), 1),
    String(c.loanLimit(consumer)));
  c.buyPerk('credit');
  chk('Lv2 额度 +50%', near(c.loanLimit(consumer), Math.round(consumer.limit * 1.5), 1));
  c.buyPerk('credit');
  chk('Lv3 额度 +75%', near(c.loanLimit(consumer), Math.round(consumer.limit * 1.75), 1));
  chk('满级后不能再买', !c.buyPerk('credit').ok);

  // 实际能借到更多
  const c2 = new Core();
  c2.st.flags.hasJob = true;
  c2.st.insightPts = 100;
  const before = c2.borrow('consumer', consumer.limit);
  chk('未升级时刚好借满上限', before.ok, before.why);
  const over = c2.borrow('consumer', 1000);
  chk('未升级时超出被拒', !over.ok, over.why);

  const c3 = new Core();
  c3.st.flags.hasJob = true;
  c3.st.insightPts = 100;
  c3.buyPerk('credit'); c3.buyPerk('credit'); c3.buyPerk('credit');
  const r = c3.borrow('consumer', Math.round(consumer.limit * 1.75));
  chk('满级信用力能借到 1.75 倍', r.ok, r.why);
}

console.log('\n=== 5. 利息谈判：改善隔夜利息 ===');
{
  const mk = (lv) => {
    const c = new Core();
    c.st.cash = 5000000;
    c.st.insightPts = 100;
    for (let i = 0; i < lv; i++) c.buyPerk('swap');
    c.open('ZARJPY', 1, 100000, 10);       // 做多高息货币 → 收利息
    c.st.date.day = 4;
    c.newDay();
    return c.st.swapToday;
  };
  const s0 = mk(0), s1 = mk(1), s3 = mk(3);
  chk('Lv0 收到正利息', s0 > 0, String(s0));
  chk('Lv1 收入增加约 30%', near(s1, s0 * 1.3, Math.abs(s0) * 0.02), `${s0.toFixed(1)} → ${s1.toFixed(1)}`);
  chk('Lv3 收入增加约 90%', near(s3, s0 * 1.9, Math.abs(s0) * 0.02), `${s0.toFixed(1)} → ${s3.toFixed(1)}`);

  // 付利息的情况应该减少支出
  const pay = (lv) => {
    const c = new Core();
    c.st.cash = 5000000;
    c.st.insightPts = 100;
    for (let i = 0; i < lv; i++) c.buyPerk('swap');
    c.open('ZARJPY', -1, 100000, 10);      // 做空高息货币 → 付利息
    c.st.date.day = 4;
    c.newDay();
    return c.st.swapToday;
  };
  const p0 = pay(0), p3 = pay(3);
  chk('Lv0 支付负利息', p0 < 0, String(p0));
  chk('Lv3 支出减少约 90%', Math.abs(p3) < Math.abs(p0) * 0.2,
    `${p0.toFixed(1)} → ${p3.toFixed(1)}`);
}

console.log('\n=== 6. 胆力：减少爆仓的精神打击 ===');
{
  const mk = (lv) => {
    const c = new Core();
    c.st.cash = 100000;
    c.st.insightPts = 100;
    for (let i = 0; i < lv; i++) c.buyPerk('guts');
    c.open('USDJPY', 1, 10000, 100);
    c.market.pair('USDJPY').price *= 0.90;
    const before = c.st.stats.mental;
    c.checkRisk();
    return before - c.st.stats.mental;
  };
  const d0 = mk(0), d2 = mk(2);
  chk('Lv0 强平造成较大精神损失', d0 > 20, String(d0.toFixed(1)));
  chk('Lv2 损失明显减少', d2 < d0 * 0.5, `${d0.toFixed(1)} → ${d2.toFixed(1)}`);
  chk('胆力倍率正确（Lv2 = 0.2）', (() => {
    const c = new Core(); c.st.insightPts = 100;
    c.buyPerk('guts'); c.buyPerk('guts');
    return near(c.mentalLossMul(), 0.2, 1e-9);
  })());
}

console.log('\n=== 7. 技能购买与点数消耗 ===');
{
  const c = new Core();
  c.st.insightPts = 0;
  const r = c.buyPerk('credit');
  chk('点数不足时拒绝', !r.ok && /需要/.test(r.why), r.why);
  chk('拒绝时不扣点不升级', c.st.insightPts === 0 && c.st.perks.credit === 0);

  c.st.insightPts = 50;
  const total = c.perkCost('credit', 1) + c.perkCost('credit', 2) + c.perkCost('credit', 3);
  c.buyPerk('credit'); c.buyPerk('credit'); c.buyPerk('credit');
  chk('三级共花掉正确点数', c.st.insightPts === 50 - total, `剩 ${c.st.insightPts}，应为 ${50 - total}`);
  chk('信用力到 Lv3', c.st.perks.credit === 3);
}

console.log('\n=== 8. 兑换与技能互不干扰 ===');
{
  const c = new Core();
  c.st.insightPts = 20;
  c.buyPerk('swap');                      // 花 3 点
  chk('买技能后剩 17 点', c.st.insightPts === 17, String(c.st.insightPts));
  c.exchangeInsight(7);                   // 再换 7 点
  chk('兑换后剩 10 点', c.st.insightPts === 10, String(c.st.insightPts));
  chk('技能等级不受兑换影响', c.st.perks.swap === 1);
  chk('钱包增加 70 万', c.st.wallet === 700000, String(c.st.wallet));
}

console.log('\n=== 9. 存档兼容（老存档缺新字段）===');
{
  const c = new Core();
  // 模拟旧存档：perks 只有 3 个字段
  c.st.perks = { fees: 2, rebate: 1, intel: 1 };
  chk('缺 credit 时 loanLimitMul 仍正常', near(c.loanLimitMul(), 1, 1e-9), String(c.loanLimitMul()));
  chk('缺 swap 时 swapMul 仍正常', near(c.swapMul(1), 1, 1e-9));
  chk('缺 guts 时 mentalLossMul 仍正常', near(c.mentalLossMul(), 1, 1e-9));
  chk('购买新技能会自动创建字段', (() => {
    c.st.insightPts = 10;
    const r = c.buyPerk('credit');
    return r.ok && c.st.perks.credit === 1;
  })());
}

console.log(`\n${'='.repeat(48)}\n洞察/技能测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
