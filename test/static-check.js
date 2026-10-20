#!/usr/bin/env node
/* 静态一致性检查：
 *  1. JS 中 $$('#id') / getElementById('id') 引用的 id 是否都存在于模板 HTML
 *  2. 模板 HTML 里的 id 是否有被 JS 用到（提示无用元素）
 *  3. JS 里引用的全局符号是否都有定义
 *  4. 构建产物是否内联了全部 CSS/JS、是否残留占位符
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = p => path.join(root, 'src', p);

const JS_FILES = ['01-util.js', '02-chart.js', '03-market.js', '04-core.js', '05-tutorials.js', '06-ui.js', '07-boot.js'];
const jsAll = JS_FILES.map(f => ({ f, code: fs.readFileSync(src(f), 'utf8') }));
const tpl = fs.readFileSync(src('index.template.html'), 'utf8');

let pass = 0, fail = 0, warn = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const wrn = (m) => { warn++; console.log('  ! ' + m); };

/* ---------- 1. 收集 HTML 里的 id ---------- */
const htmlIds = new Set();
for (const m of tpl.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);

/* 动态生成的 id（写在 JS 模板字符串里） */
const jsGenerated = new Set();
for (const { code } of jsAll) {
  for (const m of code.matchAll(/\bid="([^"$]+)"/g)) jsGenerated.add(m[1]);
}

/* ---------- 2. 收集 JS 引用的 id ---------- */
const referenced = new Set();
const RE = /(?:\$\$?|getElementById)\('#([A-Za-z0-9_-]+)'\)|\$\$?\('#([A-Za-z0-9_-]+)/g;
for (const { f, code } of jsAll) {
  for (const m of code.matchAll(/\$\$?\('#([A-Za-z0-9_-]+)'/g)) referenced.add(m[1]);
  for (const m of code.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) referenced.add(m[1]);
  for (const m of code.matchAll(/\$\(`#\$\{([^}]+)\}`/g)) referenced.add('`template:' + m[1] + '`');
}

console.log('\n=== 1. DOM id 引用完整性 ===');
const missing = [...referenced].filter(id => {
  if (id.startsWith('`')) return false;
  if (id.endsWith('-')) return false;          // #sc-<name> 之类的动态前缀
  return !htmlIds.has(id) && !jsGenerated.has(id);
});
if (missing.length) bad('以下 id 被 JS 引用但不存在：' + missing.join(', '));
else ok(`全部 ${[...referenced].filter(i => !i.startsWith('`')).length} 个被引用的 id 都存在`);

console.log('\n=== 2. 模板必需元素 ===');
const HUD_IDS = ['hudPair', 'hudDate', 'spd', 'equityVal', 'eqDelta', 'hudCash', 'hudMargin',
                 'hudRate', 'hudLoan', 'marginBar', 'screens', 'tabs', 'mask', 'sheet', 'cover'];
HUD_IDS.forEach(id => htmlIds.has(id) ? ok(`#${id}`) : bad(`缺少 #${id}`));

console.log('\n=== 3. 全局符号定义 ===');
const cssCode = fs.readFileSync(src('style.css'), 'utf8');
const allCode = jsAll.map(x => x.code).join('\n') + '\n' + cssCode;
const escapeRe = (t) => t.replace(/[$.]/g, ch => '\\' + ch);
const GLOBALS = ['U', 'Haptics', 'Sfx', 'Store', 'Surface', 'CandleChart', 'drawSparkline',
  'TICKS_PER_BAR', 'BARS_PER_DAY', 'TICKS_PER_DAY', 'PAIRS', 'PAIR_ORDER', 'NEWS_POOL',
  'Series', 'Market', 'LOAN_PRODUCTS', 'BARKS', 'initialState', 'Core', 'Tutorials', 'Chapters',
  'UI', '$$', '$$$', 'el', 'ripple', 'bindTap', 'buzzFloat', 'FX', 'Sheets', 'Confirm', '$', 'Camera'];
GLOBALS.forEach(g => {
  const re = new RegExp('(?:^|\\n)\\s*(?:const|let|var|function|class)\\s+' + escapeRe(g) + '(?![A-Za-z0-9_$])');
  if (re.test(allCode)) ok(g + ' 已定义');
  else bad(g + ' 未找到定义');
});

/* 跨文件调用但未定义的函数名（常见坑） */
console.log('\n=== 4. 明显的未定义引用 ===');
const calledNames = new Set();
for (const { code } of jsAll) {
  for (const m of code.matchAll(/(?<![.\w$])([A-Z][A-Za-z0-9_]{2,})\s*\.\s*(?!prototype)/g)) calledNames.add(m[1]);
}
const missingNs = [...calledNames].filter(n =>
  !GLOBALS.includes(n) && !/^(Math|Date|JSON|Object|Array|Number|String|Boolean|Error|Promise|RegExp|Set|Map|Infinity|NaN|console|window|document|navigator|localStorage|performance|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|clearTimeout|clearInterval|Intl)$/.test(n)
  && !new RegExp('(?:class|const|let|var|function)\\s+' + n + '\\b').test(allCode)
  && !new RegExp('\\b' + n + '\\s*[:=]').test(allCode));
if (missingNs.length) wrn('疑似未定义命名空间：' + missingNs.join(', '));
else ok('未发现可疑的未定义命名空间引用');

/* ---------- 5. 构建产物 ---------- */
console.log('\n=== 5. 构建产物 ===');
const distPath = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(distPath)) bad('dist/index.html 不存在');
else {
  const html = fs.readFileSync(distPath, 'utf8');
  t_ok: {
    if (html.includes('/*__CSS__*/')) { bad('CSS 占位符残留'); break t_ok; }
    if (html.includes('/*__JS__*/')) { bad('JS 占位符残留'); break t_ok; }
    ok('占位符已全部替换');
  }
  if (!html.includes('<style>') || !html.includes('</style>')) bad('缺少 <style>');
  else ok('CSS 已内联');
  const hasAll = JS_FILES.every(f => html.includes('===== ' + f + ' ====='));
  if (hasAll) ok(`JS 全部 ${JS_FILES.length} 个文件已内联`);
  else bad('部分 JS 文件未内联');
  if (/<script[^>]+src=/.test(html) || /<link[^>]+stylesheet/.test(html)) bad('存在外部资源引用（破坏离线可用性）');
  else ok('无外部资源引用（完全离线可用）');
  if (/https?:\/\//.test(html.replace(/<meta[^>]*>/g, ''))) wrn('产物中出现 http(s) 链接');
  else ok('无网络请求');
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  ok(`体积 ${kb} KB`);
}

/* ---------- 6. 关键行为存在性 ---------- */
console.log('\n=== 6. 关键机制存在性 ===');
const FEATURES = [
  ['杠杆（可调 1..100）', /id="levRange"[\s\S]{0,80}max="100"/],
  ['保证金计算', /usedMargin\s*\(\)/],
  ['维持率', /marginRate\s*\(\)/],
  ['强制平仓阈值（随等级动态）', /liqThreshold\(\)/],
  ['追证阈值（随等级动态）', /callLine/],
  ['隔夜利息', /swapL/],
  ['爆仓价预演', /liqPriceFor/],
  ['止损 / 止盈', /promptSLTP/],
  ['四种借贷渠道', /friend[\s\S]*consumer[\s\S]*yakuza[\s\S]*mochiko/],
  ['年利 109%', /1\.09/],
  ['日复利计息', /\/\s*365/],
  ['K线绘制', /class\s+CandleChart/],
  ['捏合缩放', /pinch/],
  ['拖动平移', /drag\.cam/],
  ['震动反馈', /navigator\.vibrate/],
  ['音效合成', /createOscillator/],
  ['浮动数字动效', /floatUp/],
  ['入场动画', /@keyframes posIn/],
  ['强平全屏警报', /alert-full/],
  ['屏幕震动', /Camera\.shake|class="shake"|'shake'/],
  ['本地存档', /localStorage/],
  ['存档导出', /exportString/],
  ['教学系统', /Tutorials/],
  ['剧情章节', /STORY\s*=/],
  ['FX 用语词典', /glossary/],
];
FEATURES.forEach(([name, re]) => re.test(allCode) || re.test(tpl) ? ok(name) : bad(name + ' —— 未找到'));

console.log(`\n${'='.repeat(48)}\n静态检查：${pass} 通过 / ${fail} 失败 / ${warn} 警告\n`);
process.exit(fail ? 1 : 0);
