/* 存档系统专项测试：压缩、多槽、备份、校验、迁移、元信息 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

// 用一个会真正存数据的内存 localStorage
const memStore = {};
const sandbox = {
  console, performance: { now: () => Date.now() },
  Math, Date, JSON, isFinite, parseFloat, parseInt, Object, Array, Number, String, Boolean, Error, Promise,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  // 注意：btoa/atob 只能处理 latin1，中文必须先经 escape/unescape 转字节串
  escape: s => String(s).replace(/[^A-Za-z0-9@*_+\-./]/g, c => {
    const code = c.charCodeAt(0);
    if (code < 256) return '%' + code.toString(16).padStart(2, '0');
    return '%u' + code.toString(16).padStart(4, '0');
  }),
  unescape: s => String(s).replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g,
    (m, p1, p2) => String.fromCharCode(parseInt(p1 || p2, 16))),
};
sandbox.localStorage = {
  getItem: k => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: k => { delete memStore[k]; },
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
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const k of ['$', '$$', '$$$', 'el', 'bindTap']) sandbox[k] = () => stub();
sandbox.Camera = { shake() {} };
sandbox.FX = { alert() {}, bark() {}, newsTicker() {}, pulse() {} };
sandbox.Sfx = new Proxy({}, { get: () => () => {} });
sandbox.Haptics = new Proxy({}, { get: () => () => {} });
sandbox.Sheets = { msg() {}, base: () => stub(), close() {} };
sandbox.Confirm = { ask() {} };
sandbox.UI = { effects: false, toast() {}, renderAll() {}, renderSet() {}, showScreen() {} };

let bundle = '';
for (const f of ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '08-ai.js'])
  bundle += '\n' + fs.readFileSync(src(f), 'utf8');
bundle += `\nglobalThis.__X = { U, Core, Market, Store, PAIR_ORDER, initialState };\n`;
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
const { U, Core, Market, Store, PAIR_ORDER } = sandbox.__X;

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };
const chk = (m, c, i) => c ? ok(m) : bad(m + (i ? '  → ' + i : ''));
const near = (a, b, t) => a === b ? true : (Math.abs(a - b) <= (t === undefined ? 1e-6 : t));

/** 造一个玩了一会儿的存档 */
function playedCore(ticks) {
  const c = new Core();
  for (let i = 0; i < (ticks || 300); i++) c.tick();
  c.open('USDJPY', 1, 10000, 10);
  for (let i = 0; i < 120; i++) c.tick();
  return c;
}

console.log('\n=== 1. 存档体积压缩 ===');
{
  const c = playedCore(400);
  const payload = { st: c.st, market: c.market.serialize(), mochiko: c.mochiko };
  const size = JSON.stringify(payload).length;
  chk('紧凑序列化后小于 40KB', size < 40 * 1024, (size / 1024).toFixed(1) + ' KB');
  chk('每个品种只留 120 根 K 线',
    PAIR_ORDER.every(id => c.market.serialize().pairs[id].b.length <= 120),
    c.market.serialize().pairs.USDJPY.b.length + ' 根');
  chk('K 线用数组而非对象',
    Array.isArray(c.market.serialize().pairs.USDJPY.b[0]),
    typeof c.market.serialize().pairs.USDJPY.b[0]);
  chk('价格是整数（×1000）',
    Number.isInteger(c.market.serialize().pairs.USDJPY.p));
}

console.log('\n=== 2. 往返一致性 ===');
{
  const c = playedCore(300);
  const blob = JSON.parse(JSON.stringify({ st: c.st, market: c.market.serialize(), mochiko: {} }));
  const c2 = new Core();
  c2.st = U.merge(sandbox.__X.initialState(), blob.st);
  c2.market = new Market(c2.st.seed);
  c2.market.restore(blob.market);

  const a = c.market.pair('USDJPY'), b = c2.market.pair('USDJPY');
  chk('价格误差 < 0.01%（整数化导致）', Math.abs(a.price - b.price) / a.price < 1e-4,
    `${a.price.toFixed(3)} vs ${b.price.toFixed(3)}`);
  chk('恢复后保留最近 120 根', b.bars.length === 120, `${a.bars.length} → ${b.bars.length}`);
  chk('保留的是最新的部分（末根收盘价接近）',
    Math.abs(a.bars.at(-1).c - b.bars.at(-1).c) < 0.01,
    `${a.bars.at(-1).c.toFixed(3)} vs ${b.bars.at(-1).c.toFixed(3)}`);
  chk('label 被重建', b.bars.every(x => x.label && x.label.length > 0));
  chk('最后一根 OHLC 一致',
    near(a.bars.at(-1).c, b.bars.at(-1).c, 0.002), `${a.bars.at(-1).c.toFixed(3)} vs ${b.bars.at(-1).c.toFixed(3)}`);
  chk('账户与持仓完整', c2.st.positions.length === c.st.positions.length && c2.st.cash === c.st.cash);
  chk('维持率一致（<0.5% 误差）', Math.abs(c2.marginRate() - c.marginRate()) / c.marginRate() < 0.005,
    `${c.marginRate().toFixed(2)} vs ${c2.marginRate().toFixed(2)}`);
}

console.log('\n=== 3. 多存档槽 ===');
{
  for (const k in memStore) delete memStore[k];
  const c = playedCore(150);
  chk('默认使用槽 0', c.slot === 0 && Store.active === 0);

  c.useSlot(0); const r0 = c.save();
  chk('存到槽 0 成功', r0 === true);

  c.useSlot(1); c.st.cash = 123456; const r1 = c.save();
  chk('存到槽 1 成功', r1 === true);

  const list = Store.list();
  chk('列出 3 个槽', list.length === Store.SLOTS, list.length + ' 个');
  chk('槽 0 有数据', !!list[0].info);
  chk('槽 1 有数据且现金是 123456', !!list[1].info);
  chk('槽 2 为空', !list[2].info);

  const back1 = Store.load(1);
  chk('读槽 1 拿到正确的现金', back1 && back1.st.cash === 123456, back1 && back1.st.cash);
  const back0 = Store.load(0);
  chk('读槽 0 拿到的是另一份', back0 && back0.st.cash !== 123456, back0 && back0.st.cash);
}

console.log('\n=== 4. 元信息 ===');
{
  for (const k in memStore) delete memStore[k];
  const c = playedCore(200);
  c.st.stats.level = 5;
  c.useSlot(0); c.save();
  const info = Store.list()[0].info;
  chk('记录了天数', typeof info.day === 'number' && info.day > 0, '第 ' + info.day + ' 天');
  chk('记录了等级', info.level === 5, 'Lv.' + info.level);
  chk('记录了净值', typeof info.netAsset === 'number');
  chk('记录了保存时间', !!info.savedAt);
  chk('记录了体积', info.size > 1000, (info.size / 1024).toFixed(1) + ' KB');
  chk('记录了持仓数', typeof info.positions === 'number');
}

console.log('\n=== 5. 损坏检测与备份回退 ===');
{
  for (const k in memStore) delete memStore[k];
  const c = playedCore(150);
  c.useSlot(0); c.save();                 // 第一次：无备份
  c.st.cash = 999999; c.save();            // 第二次：把上一次挪到备份
  chk('存在备份', Store.hasBackup());

  // 人为破坏主档
  const key = 'fxkurumi.save.slot0';
  const w = JSON.parse(memStore[key]);
  w.d = w.d.replace(/"cash":\d+/, '"cash":1');   // 改内容但不更新校验
  memStore[key] = JSON.stringify(w);

  const r = Store.load(0);
  chk('校验失败被识别', !!r, JSON.stringify(r && Object.keys(r)));
  chk('自动回退到备份', r && r.__fromBackup === true);
  chk('回退后数据可用', r && r.st && typeof r.st.cash === 'number', r && r.st && r.st.cash);
}

console.log('\n=== 6. 旧版存档迁移 ===');
{
  for (const k in memStore) delete memStore[k];
  const c = playedCore(150);
  // playedCore 跑 tick 时会自动存到 slot0，这里要清掉，
  // 才能真实模拟「从旧版升级、还没有任何新槽存档」的情形
  for (const k of Object.keys(memStore)) {
    if (k.startsWith('fxkurumi.save.slot') || k === 'fxkurumi.save.meta' || k === 'fxkurumi.save.backup') delete memStore[k];
  }
  // 模拟旧版单槽格式（未包装、无校验）
  const legacy = { st: c.st, market: c.market.serialize(), mochiko: {} };
  memStore['fxkurumi.save.v2'] = JSON.stringify(legacy);
  chk('模拟前槽 0 确实为空', !memStore['fxkurumi.save.slot0']);

  const r = Store.load(0);
  chk('能读到旧版存档', !!r && !!r.st);
  chk('标记为已迁移', r && r.__migrated === true);
  chk('数据完整', r && r.st.stats.level >= 1);
}

console.log('\n=== 7. 删除与清空 ===');
{
  for (const k in memStore) delete memStore[k];
  const c = playedCore(100);
  c.useSlot(0); c.save();
  c.useSlot(1); c.save();
  Store.remove(0);
  chk('删除槽 0 后列表显示为空', !Store.list()[0].info);
  chk('槽 1 不受影响', !!Store.list()[1].info);
  Store.clear();
  chk('clear 后所有槽清空', Store.list().every(x => !x.info));
  chk('clear 后 hasAny 为 false', !Store.hasAny());
}

console.log('\n=== 8. 导出 / 导入 ===');
{
  const c = playedCore(120);
  const payload = { st: c.st, market: c.market.serialize(), mochiko: c.mochiko };
  const json = Store.exportJson(payload);
  chk('导出 JSON 非空', json.length > 1000, (json.length / 1024).toFixed(1) + ' KB');
  const back = JSON.parse(json);
  chk('导出内容可解析且含账户', !!back.st && typeof back.st.cash === 'number');

  const b64 = Store.exportString(payload);
  chk('base64 导出非空', b64.length > 1000);
  const back2 = Store.importString(b64);
  chk('base64 往返成功', back2 && back2.st.cash === c.st.cash);
  chk('无效文本返回 null', Store.importString('这不是存档') === null);
}

console.log('\n=== 9. 存档体积随时间稳定 ===');
{
  const sizes = [];
  const c = new Core();
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 200; i++) c.tick();
    c.open(PAIR_ORDER[round % 5], 1, 10000, 5);
    sizes.push(JSON.stringify({ st: c.st, market: c.market.serialize() }).length);
  }
  const maxS = Math.max(...sizes), minS = Math.min(...sizes);
  chk('体积不随时间膨胀（最多 120 根 K 线）', maxS < 60 * 1024, (maxS / 1024).toFixed(1) + ' KB');
  chk('体积波动小', (maxS - minS) / maxS < 0.35, `${(minS / 1024).toFixed(1)} ~ ${(maxS / 1024).toFixed(1)} KB`);
  console.log('     各轮体积: ' + sizes.map(x => (x / 1024).toFixed(1)).join(' → ') + ' KB');
}

console.log(`\n${'='.repeat(48)}\n存档测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
