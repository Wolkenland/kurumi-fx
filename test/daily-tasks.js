const fs=require('fs'),vm=require('vm');
const sb={console,performance:{now:()=>Date.now()},Math,Date,JSON,isFinite,parseFloat,parseInt,Object,Array,Number,String,Boolean,Error,Promise,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}};
sb.localStorage={getItem:()=>null,setItem(){},removeItem(){}};sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
for(const k of ['$','$$','el','bindTap'])sb[k]=()=>({style:{},classList:{add(){},remove(){},toggle(){return true}},appendChild(c){return c},remove(){},querySelector:()=>({style:{}}),querySelectorAll:()=>[],addEventListener(){}});
sb.document={querySelector:()=>({style:{}}),querySelectorAll:()=>[],getElementById:()=>({style:{}}),createElement:()=>({style:{}}),body:{},head:{},addEventListener(){}};sb.navigator={vibrate(){}};
let b='';for(const f of ['01-util.js','02-chart.js','03-market.js','04-core.js','05-tutorials.js','08-ai.js'])b+='\n'+fs.readFileSync('src/'+f,'utf8');
b+='\nglobalThis.__X={Core,DAILY_TASKS,DAILY_ALL_BONUS};';vm.runInContext(b,sb);
const {Core,DAILY_TASKS,DAILY_ALL_BONUS}=sb.__X;
let pass=0,fail=0; const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));

console.log('=== 1. 任务池 ===');
chk('共 9 个任务', DAILY_TASKS.length===9, String(DAILY_TASKS.length));
chk('每个任务字段完整', DAILY_TASKS.every(t=>t.id&&t.name&&t.desc&&t.pts>0&&t.goal>0&&typeof t.prog==='function'&&['instant','settle'].includes(t.when)));
chk('两类任务都有', DAILY_TASKS.some(t=>t.when==='instant') && DAILY_TASKS.some(t=>t.when==='settle'));

console.log('\n=== 2. 生成规则 ===');
const c=new Core();
chk('新游戏即有 3 个任务', c.st.dailyTasks.length===3, String(c.st.dailyTasks.length));
chk('任务是 2 即时 + 1 结算', (()=>{
  const kinds = c.st.dailyTasks.map(id=>DAILY_TASKS.find(t=>t.id===id).when);
  return kinds.filter(k=>k==='instant').length===2 && kinds.filter(k=>k==='settle').length===1;
})(), c.dailyProgress().map(p=>p.when).join(','));
chk('任务 id 不重复', new Set(c.st.dailyTasks).size===3);
chk('初始无已完成', c.st.dailyDoneIds.length===0);

console.log('\n=== 3. 即时任务：做三笔 ===');
// 强制指定任务方便测试
function withTasks(ids){ const x=new Core(); x.st.dailyTasks=ids; x.st.dailyDoneIds=[]; x.st.dailyAllDone=false;
  x.st.dailyStat={closed:0,pnl:0,liquidated:0,borrowed:0,repaid:0,bestWin:0,deposited:0,pairsToday:0}; return x; }
let t=withTasks(['close3']);
t.st.cash=5000000;
for(let i=0;i<3;i++){ t.open('USDJPY',1,10000,10); t.close(t.st.positions[0].id,0); }
chk('平仓 3 次完成任务', t.st.dailyDoneIds.includes('close3'), t.st.dailyDoneIds.join(','));
chk('获得洞察点', t.st.insightPts>0, String(t.st.insightPts));

console.log('\n=== 4. 即时任务：今日为正 ===');
t=withTasks(['profit']);
t.st.cash=5000000;
t.open('USDJPY',1,10000,10);
t.market.pair('USDJPY').price+=0.5;
t.close(t.st.positions[0].id,0);
chk('盈利后完成任务', t.st.dailyDoneIds.includes('profit'));

console.log('\n=== 5. 即时任务：还一点 ===');
t=withTasks(['repay']);
t.st.cash=5000000;
t.borrow('consumer',100000);
const before=t.st.insightPts;
t.repay('consumer',50000);
chk('还款后完成任务', t.st.dailyDoneIds.includes('repay'), t.st.dailyDoneIds.join(','));
chk('还款给点', t.st.insightPts>before, `${before} → ${t.st.insightPts}`);

console.log('\n=== 6. 结算型任务不即时给点 ===');
t=withTasks(['noliq']);
t.st.cash=5000000;
t.open('USDJPY',1,10000,10);
t.close(t.st.positions[0].id,0);
chk('结算型任务不会被即时检查触发', !t.st.dailyDoneIds.includes('noliq'),
  'done='+t.st.dailyDoneIds.join(','));
chk('结算时才会完成', (()=>{
  t.checkDaily('settle');
  return t.st.dailyDoneIds.includes('noliq');
})());

console.log('\n=== 7. 全清奖励 ===');
t=withTasks(['noliq','close3']);
t.st.cash=5000000;
for(let i=0;i<3;i++){ t.open('USDJPY',1,10000,10); t.close(t.st.positions[0].id,0); }
const p1=t.st.insightPts;
t.checkDaily('settle');
chk('全部完成后标记 allDone', t.st.dailyAllDone===true);
chk('全清额外奖励已发', t.st.insightPts>=p1+DAILY_ALL_BONUS, `${p1} → ${t.st.insightPts}`);

console.log('\n=== 8. 不重复领取 ===');
const p2=t.st.insightPts;
t.checkDaily('instant'); t.checkDaily('settle');
chk('重复检查不再给点', t.st.insightPts===p2, `${p2} → ${t.st.insightPts}`);

console.log('\n=== 9. 限时刷新（现实时间 15 分钟）===');
t=withTasks(['close3']);
chk('轮次长度是 15 分钟', t.st.dailyCycleMs === 15*60*1000, (t.st.dailyCycleMs/60000)+' 分钟');
chk('genDailyTasks 设了结束时间戳', t.st.dailyEndAt > Date.now(), '有效');
const oldIds=t.st.dailyTasks.slice();
const endAt = t.st.dailyEndAt;
// 时间未到：不刷新
chk('未到期不刷新', t.checkDailyExpiry(t.st.dailyEndAt - 60000) === false);
chk('未到期任务不变', t.st.dailyTasks.join(',') === oldIds.join(','));
chk('剩余时间可查', t.dailyRemainMs(t.st.dailyEndAt - 60000) === 60000, String(t.dailyRemainMs(t.st.dailyEndAt - 60000)));
// 到期：刷新
chk('到期会刷新', t.checkDailyExpiry(t.st.dailyEndAt + 1000) === true);
chk('刷新后结束时间推后', t.st.dailyEndAt > endAt, `${endAt} → ${t.st.dailyEndAt}`);
chk('刷新后完成列表清空', t.st.dailyDoneIds.length===0);
chk('刷新后仍 3 个任务', t.st.dailyTasks.length===3);
chk('刷新后统计清零', t.st.dailyStat.closed===0);
chk('轮次计数 +1', t.st.dailyRound === 1, String(t.st.dailyRound));
// 游戏内天数变化不影响刷新
const beforeDay = t.st.dailyTasks.slice();
t.st.date.day = 99;
t.newDay();
chk('游戏内天数变化不触发刷新', t.st.dailyTasks.join(',') === beforeDay.join(','), t.st.dailyTasks.join(','));

console.log('\n=== 10. AI 不参与 ===');
const ai=new Core(); ai.agent=true;
ai.checkDaily('instant');
chk('AI 不领每日任务', ai.st.dailyDoneIds.length===0 || ai.st.dailyTasks.length===0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
