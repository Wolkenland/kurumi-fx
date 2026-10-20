/* AI 挑战目标：达成即清除、7 天过期清除、上限 3 个 */
const fs=require('fs'),vm=require('vm');
const sb={console,performance:{now:()=>Date.now()},Math,Date,JSON,isFinite,parseFloat,parseInt,Object,Array,Number,String,Boolean,Error,Promise,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},btoa:s=>s,atob:s=>s,escape:s=>s,unescape:s=>s};
const mem={};sb.localStorage={getItem:k=>(k in mem?mem[k]:null),setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]}};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
for(const k of ['$','$$','$$$','el','bindTap'])sb[k]=()=>({style:{},classList:{add(){},remove(){},toggle(){return true}},appendChild(c){return c},remove(){},querySelector:()=>({style:{}}),querySelectorAll:()=>[],addEventListener(){}});
sb.document={querySelector:()=>({style:{}}),querySelectorAll:()=>[],getElementById:()=>({style:{}}),createElement:()=>({style:{}}),body:{},head:{},addEventListener(){}};sb.navigator={vibrate(){}};
let b='';for(const f of ['01-util.js','02-chart.js','03-market.js','04-core.js','05-tutorials.js','08-ai.js'])b+='\n'+fs.readFileSync('src/'+f,'utf8');
b+='\nglobalThis.__X={Core,AIPlayer,LLM};';vm.runInContext(b,sb);
const {Core,AIPlayer,LLM}=sb.__X;

let pass=0,fail=0; const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));
function setup(){
  const core=new Core();
  AIPlayer.init(core);
  LLM.configure({provider:'custom',url:'https://x/v1/chat/completions',model:'x',key:'sk-t',temp:.9,maxTok:100,enabled:true});
  AIPlayer.spawn({});
  return core;
}
/** 直接给 AI 的账户加钱（equity 是计算属性，只能改底层现金） */
function setAIEquity(agent, v){ agent.core.st.cash = v - agent.core.st.wallet - agent.core.unrealizedAll() + agent.core.totalLoan(); }
function settle(core){ core.st.date.day = AIPlayer.api.contest.endDay; for(let i=0;i<3;i++) AIPlayer.onTick(250); }

console.log('=== 1. 创建 ===');
{
  const core=setup();
  const r=AIPlayer.api.addGoal(20);
  chk('能设目标', r.ok, r.why);
  chk('列表有 1 个', AIPlayer.goals().length===1);
  chk('目标是 +20%', AIPlayer.goals()[0].target===20);
}

console.log('\n=== 2. 达成后立即清除（不用等 7 天）===');
{
  const core=setup();
  AIPlayer.api.addGoal(10);
  const g=AIPlayer.goals()[0];
  setAIEquity(AIPlayer.agent, g.base * 1.15);
  const pts0 = core.st.insightPts;
  const done = AIPlayer.api.checkGoals();
  chk('checkGoals 返回达成项', done.length===1, String(done.length));
  chk('达成后列表清空', AIPlayer.goals().length===0);
  chk('底层数组也清空', (core.st.aiGoals||[]).length===0);
  chk('拿到了里程碑奖励', core.st.insightPts > pts0, `${pts0} → ${core.st.insightPts}`);
  chk('留下了里程碑记录', !!core.st.milestones['goal_'+g.id], Object.keys(core.st.milestones||{}).join(','));
  chk('记录了结果', !!core.st.lastGoalResult && core.st.lastGoalResult.ok===true);
}

console.log('\n=== 3. 未达成时保留 ===');
{
  const core=setup();
  AIPlayer.api.addGoal(200);
  const g=AIPlayer.goals()[0];
  setAIEquity(AIPlayer.agent, g.base * 1.02);
  AIPlayer.api.checkGoals();
  chk('未达成时保留', AIPlayer.goals().length===1);
  chk('进度被更新', Math.abs(AIPlayer.goals()[0].current - 2) < 0.5, (AIPlayer.goals()[0].current||0).toFixed(1)+'%');
}

console.log('\n=== 4. 7 天过期清除 ===');
{
  const core=setup();
  AIPlayer.api.addGoal(200);
  const g=AIPlayer.goals()[0];
  setAIEquity(AIPlayer.agent, g.base * 1.01);   // 远未达成
  core.st.date.day = g.setDay + 8;
  settle(core);
  chk('过期后清除', AIPlayer.goals().length===0);
  chk('过期不给奖励', core.st.milestones['goal_'+g.id]===undefined);
}

console.log('\n=== 5. 进度更新 ===');
{
  const core=setup();
  AIPlayer.api.addGoal(50);
  const g=AIPlayer.goals()[0];
  setAIEquity(AIPlayer.agent, g.base * 1.25);
  AIPlayer.api.checkGoals();
  chk('未达成但记录 25%', Math.abs(AIPlayer.goals()[0].current - 25) < 1, (AIPlayer.goals()[0].current||0).toFixed(1)+'%');
}

console.log('\n=== 6. 最多 3 个 ===');
{
  const core=setup();
  AIPlayer.api.addGoal(10); AIPlayer.api.addGoal(20); AIPlayer.api.addGoal(30);
  const r=AIPlayer.api.addGoal(40);
  chk('第 4 个被拒绝', !r.ok, r.why);
  chk('仍是 3 个', AIPlayer.goals().length===3);
}

console.log('\n=== 7. 老存档遗留的已完成目标 ===');
{
  const core=setup();
  core.st.aiGoals=[{id:1,base:100,target:10,setDay:0,current:20,done:true,doneDay:3}];
  chk('goals() 返回空', AIPlayer.goals().length===0);
  chk('底层被清理', (core.st.aiGoals||[]).length===0);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
