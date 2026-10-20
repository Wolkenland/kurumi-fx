const fs=require('fs'),vm=require('vm');
const memStore={};
const sb={console,performance:{now:()=>Date.now()},Math,Date,JSON,isFinite,parseFloat,parseInt,Object,Array,Number,String,Boolean,Error,Promise,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),escape:s=>s,unescape:s=>s};
sb.localStorage={getItem:k=>(k in memStore?memStore[k]:null),setItem:(k,v)=>{memStore[k]=String(v)},removeItem:k=>{delete memStore[k]}};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
for(const k of ['$','$$','$$$','el','bindTap'])sb[k]=()=>({style:{},classList:{add(){},remove(){},toggle(){return true}},appendChild(c){return c},remove(){},querySelector:()=>({style:{}}),querySelectorAll:()=>[],addEventListener(){}});
sb.document={querySelector:()=>({style:{}}),querySelectorAll:()=>[],getElementById:()=>({style:{}}),createElement:()=>({style:{}}),body:{},head:{},addEventListener(){}};sb.navigator={vibrate(){}};
let b='';for(const f of ['01-util.js','02-chart.js','03-market.js','04-core.js','05-tutorials.js','08-ai.js'])b+='\n'+fs.readFileSync('src/'+f,'utf8');
b+='\nglobalThis.__X={Core,AIPlayer,LLM,AIContest};';vm.runInContext(b,sb);
const {Core,AIPlayer,LLM,AIContest}=sb.__X;

let pass=0,fail=0; const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));

const core=new Core();
AIPlayer.init(core);

console.log('=== 1. 未配置 API 时也要有竞赛 ===');
chk('LLM 未就绪', !LLM.ready());
chk('init 后已有竞赛', !!AIPlayer.api.contest, AIPlayer.api.contest ? '第'+AIPlayer.api.contest.round+'期' : 'null');
chk('竞赛有起止日', AIPlayer.api.contest && AIPlayer.api.contest.endDay > AIPlayer.api.contest.startDay);
chk('芽吹存在', !!AIPlayer.api.mebuki);

console.log('\n=== 2. 未启用 AI 时竞赛照样推进 ===');
chk('AI 未启用', !AIPlayer.api.enabled);
const m0 = AIPlayer.api.mebuki.equity;
const startDay = core.st.date.day;
const endDay = AIPlayer.api.contest.endDay;
// 推进日期到结算日
for (let d = startDay; d <= endDay + 1; d++) {
  core.st.date.day = d;
  for (let k = 0; k < 4; k++) AIPlayer.onTick(250);
}
chk('芽吹净值发生变化', AIPlayer.api.mebuki.equity !== m0, `${m0} → ${AIPlayer.api.mebuki.equity}`);
chk('竞赛已经滚到下一期', AIPlayer.api.contest.round > 1, '第'+AIPlayer.api.contest.round+'期');
chk('本期结束日已推后', AIPlayer.api.contest.endDay > endDay, `${endDay} → ${AIPlayer.api.contest.endDay}`);
chk('留有上一期结果', !!AIPlayer.api.contest.lastResult, AIPlayer.api.contest.lastResult ? AIPlayer.api.contest.lastResult.message.slice(0,20) : '无');
chk('历史记录有 1 条', (AIPlayer.api.contest.history||[]).length === 1, String((AIPlayer.api.contest.history||[]).length));

console.log('\n=== 3. 多期连续结算 ===');
const before = AIPlayer.api.contest.round;
let cd = AIPlayer.api.contest.endDay;
for (let i = 0; i < 3; i++) {
  cd = AIPlayer.api.contest.endDay;
  core.st.date.day = cd;
  for (let k = 0; k < 4; k++) AIPlayer.onTick(250);
}
chk('连续滚了 3 期', AIPlayer.api.contest.round === before + 3, `${before} → ${AIPlayer.api.contest.round}`);
chk('历史记录累积', (AIPlayer.api.contest.history||[]).length === 4, String((AIPlayer.api.contest.history||[]).length));

console.log('\n=== 4. 手动模式 / 关闭 AI 不影响竞赛 ===');
AIPlayer.api.setThink('manual');
const r1 = AIPlayer.api.contest.round;
core.st.date.day = AIPlayer.api.contest.endDay;
for (let k = 0; k < 4; k++) AIPlayer.onTick(250);
chk('手动模式下竞赛仍结算', AIPlayer.api.contest.round === r1 + 1, `${r1} → ${AIPlayer.api.contest.round}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
