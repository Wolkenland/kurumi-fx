const fs=require('fs'),vm=require('vm');
const memStore={};
const sb={console,performance:{now:()=>Date.now()},Math,Date,JSON,isFinite,parseFloat,parseInt,Object,Array,Number,String,Boolean,Error,Promise,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),escape:s=>s,unescape:s=>s};
sb.localStorage={getItem:k=>(k in memStore?memStore[k]:null),setItem:(k,v)=>{memStore[k]=String(v)},removeItem:k=>{delete memStore[k]}};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
for(const k of ['$','$$','$$$','el','bindTap'])sb[k]=()=>({style:{},classList:{add(){},remove(){},toggle(){return true}},appendChild(c){return c},remove(){},querySelector:()=>({style:{}}),querySelectorAll:()=>[],addEventListener(){}});
sb.document={querySelector:()=>({style:{}}),querySelectorAll:()=>[],getElementById:()=>({style:{}}),createElement:()=>({style:{}}),body:{},head:{},addEventListener(){}};sb.navigator={vibrate(){}};
let b='';for(const f of ['01-util.js','02-chart.js','03-market.js','04-core.js','05-tutorials.js','08-ai.js'])b+='\n'+fs.readFileSync('src/'+f,'utf8');
b+='\nglobalThis.__X={Core,AIPlayer,LLM,THINK_PRESETS,AIStore};';vm.runInContext(b,sb);
const {Core,AIPlayer,LLM,THINK_PRESETS}=sb.__X;

let pass=0,fail=0; const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));

console.log('=== 频率档位 ===');
chk('共 4 档', THINK_PRESETS.length===4, THINK_PRESETS.map(x=>x.id).join(','));
chk('默认档位是 standard/normal', THINK_PRESETS.find(x=>x.id==='normal').ms===60000);
chk('手动档 ms=0', THINK_PRESETS.find(x=>x.id==='manual').ms===0);

console.log('\n=== 设置接口 ===');
// 先给个假 key 让它 ready
LLM.configure({provider:'custom', url:'https://example.com/v1/chat/completions', model:'x', key:'sk-test', temp:0.9, maxTok:100, enabled:true});
const core=new Core();
AIPlayer.init(core);
AIPlayer.spawn({});
AIPlayer.enable({});
chk('默认 thinkId 为 normal', AIPlayer.api.thinkId==='normal', AIPlayer.api.thinkId);
chk('默认 thinkMs=60000', AIPlayer.api.thinkMs===60000, String(AIPlayer.api.thinkMs));
AIPlayer.api.setThink('slow');
chk('切到 slow → 120000', AIPlayer.api.thinkMs===120000, String(AIPlayer.api.thinkMs));
chk('thinkId 同步', AIPlayer.api.thinkId==='slow', AIPlayer.api.thinkId);
AIPlayer.api.setThink('manual');
chk('切到 manual → 0', AIPlayer.api.thinkMs===0, String(AIPlayer.api.thinkMs));
AIPlayer.api.setThink('fast');
chk('切到 fast → 30000', AIPlayer.api.thinkMs===30000, String(AIPlayer.api.thinkMs));

console.log('\n=== 倍速不影响思考节奏 ===');
core.st.speed=4;   // 4 倍速
AIPlayer.api.setThink('normal');
// 模拟 10 秒真实时间（每秒一 tick）
for(let i=0;i<10;i++) AIPlayer.onTick(1000);
const timer = AIPlayer.api.thinkTimer;
chk('4 倍速下 10 秒真实时间只累积 10 秒', timer===null || Math.abs(timer-10000)<1, timer===null?'(未暴露)' : timer+'ms');

console.log('\n=== 手动模式不自增 ===');
AIPlayer.api.setThink('manual');
const before = AIPlayer.api.thinkTimer;
for(let i=0;i<10;i++) AIPlayer.onTick(1000);
const after = AIPlayer.api.thinkTimer;
chk('手动模式计时器不累积', after===before, `${before} → ${after}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
