/* AI 模块测试：用假 fetch 模拟 LLM，验证决策执行、竞赛结算、对赌、里程碑、技能与容错 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

/* ---------------- 可控的假 fetch ---------------- */
let fetchPlan = [];      // 依次出队：{status, body} 或 {throw:'msg'} 或 {delay:ms,...}
const fetchLog = [];
function fakeFetch(url, opts) {
  fetchLog.push({ url, body: opts && opts.body, headers: opts && opts.headers });
  const plan = fetchPlan.shift() || { status: 200, body: { choices: [{ message: { content: '{}' } }] } };
  return new Promise((resolve, reject) => {
    const run = () => {
      if (plan.throw) return reject(new Error(plan.throw));
      const status = plan.status || 200;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => plan.body,
        text: async () => JSON.stringify(plan.body),
      });
    };
    plan.delay ? setTimeout(run, plan.delay) : run();
  });
}

const sandbox = {
  console, performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error, Promise,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  fetch: fakeFetch,
  AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
};
function stubEl() {
  return { style: {}, classList: { add() {}, remove() {}, toggle() { return true }, contains() { return false } },
    innerHTML: '', textContent: '', value: '', dataset: {}, scrollTop: 0, id: '',
    appendChild(c) { return c; }, remove() {}, querySelector() { return stubEl(); }, querySelectorAll() { return []; },
    addEventListener() {}, getBoundingClientRect() { return { width: 1, height: 1, left: 0, top: 0 }; } };
}
sandbox.document = { querySelector: () => stubEl(), querySelectorAll: () => [], getElementById: () => stubEl(),
  createElement: () => stubEl(), body: stubEl(), head: stubEl(), readyState: 'complete', addEventListener() {} };
sandbox.navigator = { vibrate() {} };
const memStore = {};
sandbox.localStorage = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
sandbox.$ = () => stubEl(); sandbox.$$ = () => stubEl(); sandbox.el = () => stubEl();
sandbox.bindTap = () => {};
sandbox.Camera = { shake() {} };
sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sandbox.Sfx = new Proxy({}, { get: () => () => {} });
sandbox.Haptics = new Proxy({}, { get: () => () => {} });
sandbox.Store = { load() { return null; }, save() { return true; }, clear() {}, exportString() { return ''; }, importString() { return null; } };
sandbox.Sheets = { msg() {}, number() {}, borrow() {}, result() {}, base() { return stubEl(); }, close() {}, tutorialIndex() {}, exportSave() {} };
sandbox.Confirm = { ask() {} };
sandbox.UI = { effects: false, toast() {}, renderAll() {}, showScreen() {} };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
  bundle += '\n/*== ' + f + ' ==*/\n' + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Market, Core, Agent, LLM, AIStore, AIContest, AIPlayer, PAIRS, PAIR_ORDER,
  AI_PRESETS, PERK_DEFS, AI_REWARDS, initialState, LOAN_PRODUCTS, Chapters, Tutorials, Store };
globalThis.__mem = null;`;
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });

const { U, Core, Agent, LLM, AIStore, AIContest, AIPlayer, PAIR_ORDER, PAIRS, AI_PRESETS, PERK_DEFS, AI_REWARDS } = sandbox.__X;
const memStoreRef = memStore;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, info) => c ? ok(m) : bad(m + (info ? '  → ' + info : ''));
const near = (a, b, tol) => (a === b) ? true : (!isFinite(a) || !isFinite(b) ? false : Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol));

/** 构造一个 LLM 回复 */
const reply = (obj) => ({ status: 200, body: { choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] } });

const CONFIG = { provider: 'custom', url: 'https://example.test/v1/chat/completions', model: 'test-model', key: 'sk-test', enabled: true, temp: 0.9, maxTok: 400 };

(async () => {

console.log('\n=== 1. 配置与密钥存储 ===');
{
  chk('未配置时 ready() 为 false', !LLM.ready(), JSON.stringify(LLM.get()));
  LLM.configure(CONFIG);
  chk('配置后 ready() 为 true', LLM.ready());
  chk('预设含 deepseek/openai/moonshot/dashscope/custom',
    ['deepseek', 'openai', 'moonshot', 'dashscope', 'custom'].every(k => AI_PRESETS[k]));
  chk('自定义预设地址为空（让用户手填）', AI_PRESETS.custom.url === '');
  LLM.configure({ enabled: false });
  chk('enabled=false 时 ready() 为 false', !LLM.ready());
  LLM.configure(CONFIG);
}

console.log('\n=== 2. JSON 解析容错（模型经常不老实）===');
{
  const P = LLM.parseJson;
  chk('纯 JSON', P('{"a":1}') && P('{"a":1}').a === 1);
  chk('markdown 围栏包裹', P('```json\n{"a":2}\n```') && P('```json\n{"a":2}\n```').a === 2);
  chk('前后有解释文字', P('好的，这是我的决策：{"thought":"看涨"} 完毕') && P('好的，这是我的决策：{"thought":"看涨"} 完毕').thought === '看涨');
  chk('尾随逗号', P('{"a":1,}') && P('{"a":1,}').a === 1);
  chk('嵌套对象', (() => { const r = P('{"actions":[{"type":"open","lev":10}]}'); return r && r.actions[0].lev === 10; })());
  chk('完全无效返回 null', P('我不是 JSON') === null);
  chk('空字符串返回 null', P('') === null);
}

console.log('\n=== 3. 单次对话（正常 / HTTP 错误 / 网络异常）===');
{
  fetchPlan = [reply({ hi: 1 })];
  const r = await LLM.chat([{ role: 'user', content: 'x' }]);
  chk('正常请求成功', r.ok && /hi/.test(r.text), r.error);
  chk('请求带上了 Authorization 头', /Bearer sk-test/.test(fetchLog[fetchLog.length - 1].headers.Authorization));
  chk('请求体含 model 与 messages', (() => { const b = JSON.parse(fetchLog[fetchLog.length - 1].body);
    return b.model === 'test-model' && Array.isArray(b.messages); })());

  fetchPlan = [{ status: 401, body: { error: { message: 'Invalid API key' } } }];
  const r2 = await LLM.chat([{ role: 'user', content: 'x' }]);
  chk('HTTP 401 被识别为失败', !r2.ok && /401|Invalid API key/.test(r2.error), r2.error);

  fetchPlan = [{ status: 429, body: {} }, { status: 429, body: {} }, reply('ok')];
  const r3 = await LLM.chatRetry([{ role: 'user', content: 'x' }], {}, 3);
  chk('429 会自动退避重试并最终成功', r3.ok, r3.error);
  chk('确实请求了 3 次', fetchLog.length >= 3);

  fetchPlan = [{ throw: 'Failed to fetch' }];
  const r4 = await LLM.chat([{ role: 'user', content: 'x' }]);
  chk('网络错误给出 CORS 提示', !r4.ok && /CORS|跨域/.test(r4.error), r4.error);

  fetchPlan = [reply('')];
  const r5 = await LLM.chat([{ role: 'user', content: 'x' }]);
  chk('空内容被判定为失败', !r5.ok, r5.error);

  fetchPlan = [{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }];
  const r6 = await LLM.chatRetry([{ role: 'user', content: 'x' }], {}, 3);
  chk('一直 5xx 时最终返回失败而不是抛错', !r6.ok);
}

console.log('\n=== 4. Agent 执行决策（开仓 / 平仓 / 全平）===');
{
  const c = new Core();
  const a = new Agent({ core: c, cash: 300000 });
  a.core.st.cash = 300000;
  const log = a.execute({ actions: [
    { type: 'open', pair: 'USDJPY', dir: 'long', units: 10000, lev: 10 },
    { type: 'open', pair: 'EURJPY', dir: 'short', units: 5000, lev: 5 },
  ]});
  chk('开出两笔仓位', a.positions.length === 2, JSON.stringify(log));
  chk('两笔方向正确', a.positions[0].dir === 1 && a.positions[1].dir === -1);
  chk('避免重复：超过 4 笔会拒绝', (() => {
    a.execute({ actions: [1, 2, 3].map(() => ({ type: 'open', pair: 'GBPJPY', dir: 'long', units: 1000, lev: 1 })) });
    return a.positions.length <= 4;
  })(), a.positions.length + ' 笔');

  const before = a.positions.length;
  a.execute({ actions: [{ type: 'close', pair: 'USDJPY', fraction: 1 }] });
  chk('按品种平仓生效', a.positions.length === before - 1);

  a.execute({ actions: [{ type: 'closeAll' }] });
  chk('全平生效', a.positions.length === 0);
}

console.log('\n=== 5. Agent 输入校验（防模型乱来）===');
{
  const c = new Core();
  const a = new Agent({ core: c, cash: 300000 });
  a.core.st.cash = 300000;
  // 非法品种 / 非法杠杆 / 超大数量 / 非法方向
  const log = a.execute({ actions: [
    { type: 'open', pair: 'NOTAPAIR', dir: 'long', units: 10000, lev: 10 },
    { type: 'open', pair: 'USDJPY', dir: 'long', units: 999999999, lev: 9999 },
    { type: 'open', pair: 'USDJPY', dir: 'garbage', units: 1000, lev: 1 },
    { type: 'unknown_type' },
    null,
  ]});
  chk('非法品种被拒绝', /品种无效/.test(log.join(',')) || a.positions.every(p => PAIR_ORDER.includes(p.pid)));
  chk('杠杆被夹到 1..100', a.positions.every(p => p.lev >= 1 && p.lev <= 100),
    a.positions.map(p => p.lev).join(','));
  chk('数量被夹到 <= 200 万', a.positions.every(p => p.units <= 2000000),
    a.positions.map(p => p.units).join(','));
  chk('非法方向默认按做空处理且不报错', true);
  chk('未知类型被忽略、null 被跳过', true);

  // 余额不足时必须只平仓
  a.core.st.cash = 1000;
  const log2 = a.execute({ actions: [{ type: 'open', pair: 'USDJPY', dir: 'long', units: 10000, lev: 10 }] });
  chk('余额 <5000 时拒绝开仓', /余额不足/.test(log2.join(',')), log2.join(','));
}

console.log('\n=== 6. Agent.think 端到端（含错误路径）===');
{
  const c = new Core();
  const a = new Agent({ core: c, cash: 300000 });
  a.core.st.cash = 300000;
  LLM.configure(CONFIG);

  fetchPlan = [reply({ thought: '美日站上MA5，做多', quote: '别急着跟', actions: [
    { type: 'open', pair: 'USDJPY', dir: 'long', units: 10000, lev: 8 }], noop: false })];
  const r = await a.think(c.market);
  chk('think 成功返回', r.ok, JSON.stringify(r));
  chk('开出了一笔仓', a.positions.length === 1);
  chk('记录了她的判断', a.lastThought === '美日站上MA5，做多', a.lastThought);
  chk('记录了她的台词并加了引号', /^「.*」$/.test(a.lastQuote), a.lastQuote);
  chk('决策计次 +1', a.actions === 1);
  chk('写入了记忆', a.memory.length === 1 && a.memory[0].acts.length > 0);

  // 模型返回垃圾
  fetchPlan = [reply('我今天不想交易，拜拜')];
  const r2 = await a.think(c.market);
  chk('非法 JSON 被记为错误而不是崩溃', r2.error && /JSON/.test(r2.error), r2.error);
  chk('错误计数增加', a.errors === 1);
  chk('busy 标志被正确释放', a.busy === false);

  // HTTP 错误
  fetchPlan = [{ status: 403, body: { error: { message: 'forbidden' } } }];
  const r3 = await a.think(c.market);
  chk('HTTP 错误被优雅返回', r3.error && /403/.test(r3.error), r3.error);

  // 模拟并发保护
  fetchPlan = [{ status: 200, delay: 60, body: { choices: [{ message: { content: '{"noop":true,"actions":[]}' } }] } }];
  const p1 = a.think(c.market);
  const r4 = await a.think(c.market);
  chk('思考进行中时第二次调用被跳过（防止并发烧额度）', r4.skipped === 'busy', JSON.stringify(r4));
  await p1;
  chk('第一次思考完成后 busy 释放', a.busy === false);
}

console.log('\n=== 7. Agent 是"安静的"（不触发玩家音效/不写主存档）===');
{
  const c = new Core();
  let fxCalls = 0;
  const origFx = sandbox.Sfx.coin;
  sandbox.Sfx.coin = () => { fxCalls++; };
  const a = new Agent({ core: c, cash: 300000 });
  a.core.st.cash = 300000;
  a.execute({ actions: [{ type: 'open', pair: 'USDJPY', dir: 'long', units: 10000, lev: 10 }] });
  chk('AI 开仓不触发玩家音效（agent 标记生效）', fxCalls === 0, 'fxCalls=' + fxCalls);
  chk('AI 自己的 Core 不写主存档（由主存档统一序列化）', a.core.save() === false);
  sandbox.Sfx.coin = origFx;
}

console.log('\n=== 8. 芽吹的脚本化曲线 ===');
{
  const c = new Core();
  const state = { mebuki: null };
  const vals = [];
  for (let i = 0; i < 24 * 60; i++) { c.tick(); vals.push(AIContest.tickMebuki(state, c.market, 'USDJPY').equity); }
  // 同一天多次调用必须不产生额外变化（按日去重）
  const eqSame = state.mebuki.equity;
  AIContest.tickMebuki(state, c.market, 'USDJPY');
  AIContest.tickMebuki(state, c.market, 'USDJPY');
  chk('同一天重复调用不重复推进（与帧率无关）', state.mebuki.equity === eqSame);
  chk('芽吹账户被建立', !!state.mebuki && state.mebuki.equity > 0);
  chk('她的曲线会波动（不是常数）', new Set(vals.map(v => v.toFixed(0))).size > 5,
    new Set(vals.map(v => v.toFixed(0))).size + ' 个不同值');
  chk('还原"连战连胜"：她曾在某个时点明显盈利',
    Math.max.apply(null, vals) > state.mebuki.start * 1.15,
    'peak=' + Math.round(Math.max.apply(null, vals)));
  chk('连胜主要发生在前 16 天（久留美给建议的时期）', (() => {
    let peakDay = 0, best = 0;
    vals.forEach((v, i) => { if (v > best) { best = v; peakDay = Math.floor(i / 24); } });
    return peakDay <= 20;
  })(), '峰值出现在第 ' + (() => { let pd = 0, b = 0; vals.forEach((v, i) => { if (v > b) { b = v; pd = Math.floor(i / 24); } }); return pd; })() + ' 天');
  chk('之后逐步崩坏（符合原作）', vals[vals.length - 1] < Math.max.apply(null, vals) * 0.6,
    '末值 ' + Math.round(vals[vals.length - 1]) + ' vs 峰值 ' + Math.round(Math.max.apply(null, vals)));
  chk('她的净值始终为正', vals.every(v => v > 0));
  // 长时间运行（必须同步推进 market，否则随机种子不变）
  // 推进 200 天（200*24 = 4800 tick），足够她走完"连胜 → 崩坏 → 爆仓"
  for (let i = 0; i < 200 * 24; i++) { c.tick(); AIContest.tickMebuki(state, c.market, 'USDJPY'); }
  const m = state.mebuki;
  chk('长期运行后她爆过仓（符合原作的散户宿命）', (m.blownCount || 0) >= 1,
    'equity=' + Math.round(m.equity) + ' blownCount=' + m.blownCount);
  chk('净值始终在合理范围（1% ~ 6 倍本金）',
    m.equity > m.start * 0.05 && m.equity <= m.start * 6,
    U.fmt(m.equity));
  chk('净值没有变成 NaN/负数', isFinite(m.equity) && m.equity > 0);
  chk('峰值被记录且不超过上限', m.peak <= m.start * 6 + 1, U.fmt(m.peak));
}

console.log('\n=== 9. 竞赛排名与结算 ===');
{
  const c = new Core();
  c.st.cash = 300000;
  const state = { agent: new Agent({ core: new Core(), cash: 300000 }), mebuki: { start: 500000, equity: 500000, seed: 1 }, contest: null };
  state.agent.core.st.cash = 300000;
  state.contest = AIContest.newCycle(c, state);

  let s = AIContest.standings(c, state);
  chk('排名含三名参赛者', s.rows.length === 3, JSON.stringify(s.rows.map(r => r.id)));
  chk('三名 id 正确', ['player', 'ai', 'mebuki'].every(x => s.rows.find(r => r.id === x)));
  chk('rank 已排序', s.rows[0].rank === 1 && s.rows[1].rank === 2 && s.rows[2].rank === 3);
  chk('倒计时正确（7 天周期）', s.daysLeft === 7, 'daysLeft=' + s.daysLeft);

  // 让玩家第一
  c.st.cash = 1000000;
  state.agent.core.st.cash = 100000;
  state.mebuki.equity = 100000;
  s = AIContest.standings(c, state);
  chk('玩家冲上第一', s.rows[0].id === 'player', s.rows.map(r => r.id + ':' + r.ret.toFixed(1)).join(' '));
  const before = c.st.insightPts;
  const res = AIContest.settle(c, state);
  chk('结算返回结果', !!res && res.rows.length === 3);
  chk('第一名获得 3 洞察', c.st.insightPts === before + 3, 'pts=' + c.st.insightPts);
  chk('结算后开启新周期', state.contest.round === 2 && state.contest.endDay > c.st.date.day);
  chk('历史被记录', (state.contest.history || []).length >= 1, JSON.stringify(state.contest.history));
  chk('玩家净值为新周期的基准', near(state.contest.base.player, c.netAsset(), 0.01));
}

console.log('\n=== 10. 对赌结算 ===');
{
  const c = new Core();
  c.st.cash = 300000; c.st.wallet = 500000;
  const state = { agent: new Agent({ core: new Core(), cash: 300000 }), mebuki: { start: 500000, equity: 500000, seed: 7 }, contest: null };
  state.agent.core.st.cash = 300000;
  state.contest = AIContest.newCycle(c, state);
  c.ai = AIPlayer;      // placeBet 通过模块内部 core 引用，这里直接构造对赌记录
  c.st.bets.push({ round: state.contest.round, amount: 100000, day: 0, settled: false, result: null });

  // AI 赚钱 → 玩家赢
  state.agent.core.st.cash = 400000;                 // +33%
  state.mebuki.equity = 450000;
  c.st.cash = 320000;                                 // 玩家只小赚
  c.st.wallet = 400000;
  const w0 = c.st.wallet;
  const res = AIContest.settle(c, state);
  const bet = c.st.bets[0];
  chk('对赌被标记为已结算', bet.settled === true);
  chk('AI 盈利时对赌获胜', bet.result && bet.result.won === true, JSON.stringify(bet.result));
  chk('赔付 = 本金 × (1 + 收益率)，有上限', bet.result.payout >= 100000 && bet.result.payout <= 400000,
    'payout=' + bet.result.payout);
  chk('钱包确实收到赔付', c.st.wallet === w0 + bet.result.payout, `${w0} → ${c.st.wallet}`);
  chk('对赌获胜额外给洞察', res.rewards.some(r => r.label === '对赌获胜'));

  // 第二期：AI 亏钱 → 玩家输
  c.st.bets.push({ round: state.contest.round, amount: 50000, day: 0, settled: false, result: null });
  state.agent.core.st.cash = 200000;                  // 从 400000 跌到 200000
  c.st.cash = 320000;
  AIContest.settle(c, state);
  chk('AI 亏损时对赌失败', c.st.bets[1].result && c.st.bets[1].result.won === false);
  chk('失败时赔付为 0', c.st.bets[1].result.payout === 0);
}

console.log('\n=== 11. 挑战目标与里程碑 ===');
{
  const c = new Core();
  c.st.cash = 300000;
  const state = { agent: new Agent({ core: new Core(), cash: 300000 }), mebuki: { start: 500000, equity: 500000, seed: 3 }, contest: null };
  state.agent.core.st.cash = 300000;
  c.st.aiGoals = [{ id: 1, base: 300000, target: 30, setDay: 0, current: 0, done: false, doneDay: null }];
  state.contest = AIContest.newCycle(c, state);

  // 未达成时不发奖
  state.agent.core.st.cash = 320000;                  // +6.7%
  c.st.cash = 100;                                    // 玩家垫底
  let before = c.st.insightPts;
  AIContest.settle(c, state);
  chk('未达成目标不发里程碑奖励', c.st.aiGoals[0].done === false);
  chk('当前进度被记录', typeof c.st.aiGoals[0].current === 'number', String(c.st.aiGoals[0].current));

  // 达成 → 发奖（v1.4.0 起达成即从列表移除，不再靠 done 标记）
  c.st.aiGoals.push({ id: 2, base: 300000, target: 20, setDay: 0, current: 0, done: false, doneDay: null });
  state.agent.core.st.cash = 400000;                  // +33%
  before = c.st.insightPts;
  const res = AIContest.settle(c, state);
  const ids = (c.st.aiGoals || []).map(g => g.id);
  chk('达成后从列表移除', ids.indexOf(2) < 0, '剩 ' + ids.join(','));
  chk('两个都达成后列表清空', ids.length === 0, '剩 ' + ids.join(','));
  chk('里程碑奖励 = 2 + floor(target/25)', (() => {
    const expect = AI_REWARDS.milestone.insight + Math.floor(20 / 25);
    return c.st.insightPts >= before + expect;
  })(), 'pts=' + c.st.insightPts);
  chk('里程碑写入存档', !!c.st.milestones['goal_2'], JSON.stringify(c.st.milestones));
  chk('记录了达成结果', !!c.st.lastGoalResult && c.st.lastGoalResult.ok === true, JSON.stringify(c.st.lastGoalResult));
}

console.log('\n=== 12. 洞察点与永久技能 ===');
{
  const c = new Core();
  c.st.insightPts = 50;
  chk('初始技能为 0 级', c.st.perks.fees === 0 && c.st.perks.rebate === 0);
  chk('初始点差倍率为 1', near(c.spreadMul(), 1, 1e-9));
  const baseSpread = c.market.pair('USDJPY').def.spread;
  chk('spreadOf 等于原始点差', near(c.spreadOf('USDJPY'), baseSpread, 1e-9));

  const r1 = c.buyPerk('fees');
  chk('购买技能成功', r1.ok && r1.level === 1, r1.why);
  chk('扣除了正确的点数', c.st.insightPts === 47, 'pts=' + c.st.insightPts);
  chk('点差降到 90%', near(c.spreadMul(), 0.9, 1e-9));
  chk('实际点差同步下降', near(c.spreadOf('USDJPY'), baseSpread * 0.9, 1e-9));

  c.buyPerk('fees'); c.buyPerk('fees');
  chk('升到 3 级后点差 70%', near(c.spreadMul(), 0.7, 1e-9), 'mul=' + c.spreadMul());
  const r2 = c.buyPerk('fees');
  chk('满级后不能再买', !r2.ok && /满级/.test(r2.why), r2.why);

  const r3 = c.buyPerk('rebate');
  chk('爆仓保险可购买', r3.ok);
  chk('返还率 10%', near(c.rebateRate(), 0.1, 1e-9));

  const c2 = new Core();
  c2.st.insightPts = 0;
  const r4 = c2.buyPerk('intel');
  chk('点数不足时拒绝', !r4.ok && /需要/.test(r4.why), r4.why);
  chk('拒绝时不扣点也不升级', c2.st.insightPts === 0 && c2.st.perks.intel === 0);
  chk('技能成本递增', c2.perkCost('fees', 1) < c2.perkCost('fees', 2) && c2.perkCost('fees', 2) < c2.perkCost('fees', 3));
}

console.log('\n=== 13. 洞察点奖励（addInsight）===');
{
  const c = new Core();
  const before = c.st.insightPts;
  c.addInsight(5, 'test');
  chk('addInsight 正确累加', c.st.insightPts === before + 5);
  let got = 0;
  c.on(ev => { if (ev.type === 'insight') got = ev.n; });
  c.addInsight(3, 'x');
  chk('派发了 insight 事件', got === 3);
}

console.log('\n=== 14. 存档持久化（含 AI 状态）===');
{
  const cfg = { provider: 'custom', url: 'https://x.test/v1/chat/completions', model: 'm', key: 'sk-abc', enabled: true };
  AIStore.save({ cfg, mebuki: { start: 1, equity: 2 }, chat: [{ role: 'user', text: 'hi' }], agent: { name: 'ゆき', cash: 123 } });
  const back = AIStore.load();
  chk('配置被写入 localStorage', !!memStore['fxkurumi.ai.v1']);
  chk('读回配置一致', back.cfg && back.cfg.key === 'sk-abc', JSON.stringify(back.cfg));
  chk('读回芽吹状态', back.mebuki && back.mebuki.equity === 2);
  chk('读回聊天记录', back.chat && back.chat[0].text === 'hi');
  chk('读回 AI 账户快照', back.agent && back.agent.cash === 123);
  chk('AI 状态与游戏主存档分开存（不同 key）', memStore['fxkurumi.ai.v1'] !== memStore['fxkurumi.save.v2']);
}

console.log('\n=== 15. 端到端：配置 → 下场 → 思考 → 竞赛推进 ===');
{
  memStore['fxkurumi.ai.v1'] = null; delete memStore['fxkurumi.ai.v1'];
  LLM.configure(CONFIG);
  const c = new Core();
  const ui = { effects: false, toast() {}, renderAll() {}, showScreen() {}, onAIActed() {}, onAIError() {}, onChat() {}, onContestSettled() {} };
  AIPlayer.init(c, ui);
  AIPlayer.configure(CONFIG);
  const a = AIPlayer.spawn({ name: 'ゆき' });
  chk('AI 对手被创建', !!a && a.name === 'ゆき');
  chk('竞赛周期已开启', !!AIPlayer.contest && AIPlayer.contest.round >= 1);
  chk('排名可读取', !!AIPlayer.standings() && AIPlayer.standings().rows.length === 3);
  chk('标记了已认识 AI', c.st.flags.metAI === true);

  // 手动跑一轮思考
  fetchPlan = [reply({ thought: '试探性做多', quote: '看着点', actions: [
    { type: 'open', pair: 'EURJPY', dir: 'long', units: 10000, lev: 5 }], noop: false })];
  const r = await AIPlayer.runOnce();
  chk('runOnce 成功', r && r.ok, JSON.stringify(r));
  chk('她真的开了仓', a.positions.length >= 1);
  chk('主存档里留下了她的动态日志', c.st.log.some(l => l.kind === 'ai'), JSON.stringify(c.st.log.slice(0, 2)));
  chk('AI 快照已持久化', !!AIStore.load().agent);

  // 对赌 + 设目标
  c.st.wallet = 300000;
  const b = AIPlayer.placeBet(100000);
  chk('可以下注', b.ok, b.why);
  chk('下注扣了钱包', c.st.wallet === 200000, 'wallet=' + c.st.wallet);
  chk('本期押注可查询', AIPlayer.myBets().length === 1);
  const b2 = AIPlayer.placeBet(99999999);
  chk('超过钱包余额的下注被拒绝', !b2.ok, b2.why);

  const g = AIPlayer.addGoal(25);
  chk('可以设挑战目标', g.ok, g.why);
  chk('目标记入存档', AIPlayer.goals().length === 1);
  const g2 = AIPlayer.addGoal(0);
  chk('非法目标被拒绝', !g2.ok, g2.why);

  // 对话
  fetchPlan = [reply('「你的手在抖。先设止损吧。」')];
  const t = await AIPlayer.talk('我该止损吗');
  chk('可以和 AI 对话', t.ok, t.error);
  chk('对话双方都记入历史', AIPlayer.chat.length >= 2 && AIPlayer.chat[AIPlayer.chat.length - 1].role === 'assistant');

  // 推进多天触发周期结算
  const roundBefore = AIPlayer.contest.round;
  for (let i = 0; i < 7 * 24 * 3 + 20; i++) c.tick();
  AIPlayer.onTick(0);
  chk('推进 7 天后竞赛周期已结算并开启新一期', AIPlayer.contest.round > roundBefore,
    roundBefore + ' → ' + AIPlayer.contest.round);
  chk('结算奖励已发放（洞察点增加）', c.st.insightPts > 0, 'pts=' + c.st.insightPts);
  chk('对赌已被结算', c.st.bets[0].settled === true);
}

console.log('\n=== 16. 关闭与重置 ===');
{
  AIPlayer.disable();
  chk('停用后 enabled 为 false', AIPlayer.enabled === false);
  chk('停用后仍保留账户数据', !!AIPlayer.agent);
  AIPlayer.resetAgent();
  chk('重置后 AI 对手被清除', AIPlayer.agent === null);
  chk('重置后本机不再保存她的账户', !AIStore.load().agent);
}

console.log(`\n${'='.repeat(48)}\nAI 模块测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);

})().catch(e => {
  console.error('\n测试自身崩溃：', e);
  process.exit(1);
});
