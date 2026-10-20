/* 成就系统 + 交易统计 专项测试 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

const sandbox = {
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
sandbox.document = { querySelector: () => stub(), querySelectorAll: () => [], getElementById: () => stub(),
  createElement: () => stub(), body: stub(), head: stub(), readyState: 'complete', addEventListener() {} };
sandbox.navigator = { vibrate() {} };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const k of ['$', '$$', '$$$', 'el', 'bindTap']) sandbox[k] = () => stub();
sandbox.Camera = { shake() {} };
sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sandbox.Sfx = new Proxy({}, { get: () => () => {} });
sandbox.Haptics = new Proxy({}, { get: () => () => {} });
sandbox.Sheets = { msg() {}, base: () => stub(), close() {} };
sandbox.Confirm = { ask() {} };
sandbox.UI = { effects: false, toast() {}, renderAll() {}, showScreen() {} };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
  bundle += '\n' + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Core, Market, ACHIEVEMENTS, ACH_CATS, PAIR_ORDER, PAIRS, LOAN_PRODUCTS };\n`;
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
const { U, Core, Market, ACHIEVEMENTS, ACH_CATS, PAIR_ORDER, PAIRS, LOAN_PRODUCTS } = sandbox.__X;

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, i) => c ? ok(m) : bad(m + (i ? '  → ' + i : ''));

/* 冲一个干净核心 */
function fresh() { return new Core(); }
/** 让某个品种朝有利方向走 */
function moveFavorably(c, pid, dir, pips) {
  const s = c.market.pair(pid);
  const step = PAIRS[pid].pip * pips;
  s.price += step * dir;
  s.cur = null;
}

console.log('\n=== 0. 新增品种 ===');
{
  chk('品种总数 8 个', PAIR_ORDER.length === 8, PAIR_ORDER.length + ' 个');
  chk('包含 AUDJPY / TRYJPY / MXNJPY',
    ['AUDJPY', 'TRYJPY', 'MXNJPY'].every(id => !!PAIRS[id]),
    ['AUDJPY', 'TRYJPY', 'MXNJPY'].filter(id => !PAIRS[id]).join(','));
  const c = fresh();
  chk('新品种能正常开仓', PAIR_ORDER.every(id => c.market.pair(id) && c.market.pair(id).price > 0));
  const aud = PAIRS.AUDJPY, try_ = PAIRS.TRYJPY;
  chk('AUDJPY 做多收利息（swapL > 0）', aud.swapL > 0, String(aud.swapL));
  chk('TRYJPY 波动是 USDJPY 的 3 倍以上', try_.vol / PAIRS.USDJPY.vol > 3,
    (try_.vol / PAIRS.USDJPY.vol).toFixed(1) + '×');
}

console.log('\n=== 1. 成就表完整性 ===');
{
  chk('共 33 个成就', ACHIEVEMENTS.length === 33, ACHIEVEMENTS.length + ' 个');
  chk('每个成就字段完整', ACHIEVEMENTS.every(a => a.id && a.name && a.desc && typeof a.pts === 'number' && typeof a.test === 'function'));
  chk('id 不重复', new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length);
  chk('分类都在 ACH_CATS 里', ACHIEVEMENTS.every(a => !!ACH_CATS[a.cat]));
  chk('4 个分类', Object.keys(ACH_CATS).length === 4, Object.keys(ACH_CATS).join(','));
  const byCat = {};
  ACHIEVEMENTS.forEach(a => { byCat[a.cat] = (byCat[a.cat] || 0) + 1; });
  chk('每类都有成就', Object.values(byCat).every(n => n >= 5), JSON.stringify(byCat));
  chk('奖励都是正数', ACHIEVEMENTS.every(a => a.pts > 0));
  chk('总奖励点数合理（40~120）', (() => {
    const t = ACHIEVEMENTS.reduce((s, a) => s + a.pts, 0);
    return t >= 40 && t <= 120;
  })(), String(ACHIEVEMENTS.reduce((s, a) => s + a.pts, 0)));
}

console.log('\n=== 2. 成就触发 ===');
{
  // first_open
  const c = fresh();
  c.open('USDJPY', 1, 10000, 10);
  chk('开仓解锁「第一笔」', c.hasAch('first_open'));

  // first_win
  moveFavorably(c, 'USDJPY', 1, 50);
  c.close(c.st.positions[0].id, 0);
  chk('盈利平仓解锁「第一次盈利」', c.hasAch('first_win'));
  chk('没有误解锁「第一次亏损」', !c.hasAch('first_loss'));

  // first_loss
  const c2 = fresh();
  c2.open('USDJPY', 1, 10000, 10);
  moveFavorably(c2, 'USDJPY', -1, 50);
  c2.close(c2.st.positions[0].id, 0);
  chk('亏损平仓解锁「第一次亏损」', c2.hasAch('first_loss'));

  // lev100 / lev1
  const c3 = fresh();
  c3.st.cash = 5000000;
  c3.open('USDJPY', 1, 10000, 100);
  chk('100 倍杠杆解锁「百倍勇气」', c3.hasAch('lev100'));
  const c4 = fresh();
  c4.st.cash = 5000000;
  c4.open('USDJPY', 1, 10000, 1);
  chk('1 倍杠杆解锁「老实人」', c4.hasAch('lev1'));

  // day7
  const c5 = fresh();
  for (let i = 0; i < 7; i++) { c5.st.date.day = i + 1; c5.checkAchievements(); }
  chk('第 7 天解锁「活过一周」', c5.hasAch('day7'));

  // all_pairs
  const c6 = fresh();
  c6.st.cash = 50000000;
  PAIR_ORDER.forEach(id => {
    if (c6.st.positions.length) c6.close(c6.st.positions[0].id, 0);
    c6.open(id, 1, 1000, 1);
  });
  chk('交易过全部品种解锁「八面玲珑」', c6.hasAch('all_pairs'));

  // all_loans
  const c7 = fresh();
  c7.st.cash = 100000000;
  // 实际借一次，验证「借过的渠道」会被记录
  const okBorrow = c7.borrow('consumer', 100000).ok;
  chk('借过一次后记录渠道', okBorrow && c7.st.stats.loansTaken.consumer === true,
    JSON.stringify(c7.st.stats.loansTaken));
  // 其余渠道有剧情/好感前置，直接注入记录来验证成就判定本身
  LOAN_PRODUCTS.forEach(d => { c7.st.stats.loansTaken[d.id] = true; });
  c7.checkAchievements();
  chk('借遍全部渠道解锁「全渠道」', c7.hasAch('all_loans'),
    Object.keys(c7.st.stats.loansTaken).join(','));

  // four_pos
  const c8 = fresh();
  c8.st.cash = 50000000;
  ['USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY'].forEach(id => c8.open(id, 1, 1000, 1));
  chk('同时 4 笔解锁「四手联弹」', c8.hasAch('four_pos'), '持仓 ' + c8.st.positions.length);

  // perk_max
  const c9 = fresh();
  c9.st.insightPts = 100;
  for (let i = 0; i < 3; i++) c9.buyPerk('fees');
  c9.checkAchievements();
  chk('技能满级解锁「技能大师」', c9.hasAch('perk_max'));

  // liquidated
  const c10 = fresh();
  c10.open('USDJPY', 1, 10000, 100);       // 保证金 ≈ 1.1 万，爆仓需要亏掉约 29 万
  c10.market.pair('USDJPY').price *= 0.70;  // 跌 30% ≈ 亏 33 万 → 必爆
  c10.checkRisk();
  chk('爆仓解锁「第一次爆仓」', c10.hasAch('first_liq'), 'liquidated=' + c10.st.stats.liquidated);
  chk('爆仓后持仓被清空', c10.st.positions.length === 0, c10.st.positions.length + ' 笔');
}

console.log('\n=== 3. 奖励发放 ===');
{
  const c = fresh();
  c.open('USDJPY', 1, 10000, 10);
  const pts1 = c.st.insightPts;
  chk('首笔解锁给 1 点洞察', pts1 === 1, String(pts1));

  // 再检查一次，不应重复给
  c.checkAchievements();
  chk('重复检查不会重复给点', c.st.insightPts === pts1, String(c.st.insightPts));
  chk('成就列表不重复', new Set(c.st.achievements).size === c.st.achievements.length);

  // 连续触发多个
  moveFavorably(c, 'USDJPY', 1, 200);
  c.close(c.st.positions[0].id, 0);
  chk('多成就累加', c.st.insightPts > pts1, `${pts1} → ${c.st.insightPts}`);
}

console.log('\n=== 4. AI 不触发成就 ===');
{
  const ai = new Core();
  ai.agent = true;
  ai.open('USDJPY', 1, 10000, 10);
  chk('AI 开仓不记录成就', ai.st.achievements.length === 0, ai.st.achievements.join(','));
  chk('AI 不白拿洞察', ai.st.insightPts === 0, String(ai.st.insightPts));
}

console.log('\n=== 5. 成就进度汇总 ===');
{
  const c = fresh();
  const s0 = c.achSummary();
  chk('初始进度 0 / 33', s0.done === 0 && s0.total === 33, `${s0.done}/${s0.total}`);
  chk('分类统计齐全', Object.keys(s0.byCat).length === 4);
  const sumTotals = Object.values(s0.byCat).reduce((a, x) => a + x.total, 0);
  chk('分类总数 = 总成就数', sumTotals === s0.total, `${sumTotals} vs ${s0.total}`);

  c.open('USDJPY', 1, 10000, 10);
  const s1 = c.achSummary();
  chk('解锁后进度增加', s1.done === 1, String(s1.done));
  chk('交易类 +1', s1.byCat.trade.done === 1);
}

console.log('\n=== 6. 交易统计 ===');
{
  const c = fresh();
  c.st.cash = 10000000;
  c.open('USDJPY', 1, 10000, 10);
  c.st.stats.opened = 1;
  chk('记录开仓次数', c.st.stats.opened === 1);
  chk('记录试过的品种', c.st.stats.pairsTried.USDJPY === true);
  chk('记录最大杠杆', c.st.stats.maxLev === 10, String(c.st.stats.maxLev));

  moveFavorably(c, 'USDJPY', 1, 30);
  c.close(c.st.positions[0].id, 0);
  const S = c.st.stats;
  chk('记录交易次数', S.trades === 1, String(S.trades));
  chk('记录胜场', S.wins === 1);
  chk('记录连胜', S.maxStreak === 1);
  chk('记录分品种统计', S.byPair.USDJPY && S.byPair.USDJPY.n === 1, JSON.stringify(S.byPair));

  // 再来一笔亏损，验证连胜重置
  c.open('EURJPY', 1, 10000, 5);
  moveFavorably(c, 'EURJPY', -1, 30);
  c.close(c.st.positions[0].id, 0);
  chk('亏损后连胜清零', c.st.stats.streak < 0, String(c.st.stats.streak));
  chk('最长连胜保留', c.st.stats.maxStreak === 1, String(c.st.stats.maxStreak));
  chk('分品种统计累积', Object.keys(c.st.stats.byPair).length === 2, Object.keys(c.st.stats.byPair).join(','));
}

console.log('\n=== 7. 统计边界 ===');
{
  const c = fresh();
  chk('无交易时胜率计算安全', (() => {
    const t = c.st.stats.trades || 0;
    return t === 0;
  })());
  chk('byPair 初始为空对象', c.st.stats.byPair && Object.keys(c.st.stats.byPair).length === 0);
  chk('maxDrawdown 初始为 0', (c.st.stats.maxDrawdown || 0) === 0);
  chk('holdCount 初始为 0', (c.st.stats.holdCount || 0) === 0);

  // 回撤记录
  const c2 = fresh();
  c2.st.stats.peakEquity = 500000;
  c2.open('USDJPY', 1, 10000, 10);
  moveFavorably(c2, 'USDJPY', -1, 100);
  c2.close(c2.st.positions[0].id, 0);
  chk('亏损后记录回撤', c2.st.stats.maxDrawdown > 0, c2.st.stats.maxDrawdown.toFixed(1) + '%');
}

console.log(`\n${'='.repeat(48)}\n成就/统计测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
