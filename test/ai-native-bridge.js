/* 验证 APK 的原生 HTTP 桥接路径：模拟 AndroidAI 注入 */
const fs=require('fs'),vm=require('vm');
const sb={console,performance:{now:()=>Date.now()},Math,Date,JSON,isFinite,parseFloat,parseInt,Object,Array,Number,String,Boolean,Error,Promise,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}};
sb.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
sb.window=sb;sb.globalThis=sb;
/* 模拟原生桥：调用后异步回调 window.__AI_HTTP_RESOLVE */
const nativeCalls=[];
sb.AndroidAI={ httpPost(id,url,headers,body){
  nativeCalls.push({id,url,headers:JSON.parse(headers),body:JSON.parse(body)});
  setTimeout(()=>{ sb.__AI_HTTP_RESOLVE(id, true, 200, JSON.stringify({choices:[{message:{content:'{"thought":"native ok","actions":[],"noop":true}'}}]})); },5);
}};
vm.createContext(sb);
for(const k of ['$','$$','el','bindTap'])sb[k]=()=>({style:{},classList:{add(){},remove(){},toggle(){return true}},appendChild(c){return c},remove(){},querySelector:()=>({style:{}}),querySelectorAll:()=>[],addEventListener(){}});
sb.document={querySelector:()=>({style:{}}),querySelectorAll:()=>[],getElementById:()=>({style:{}}),createElement:()=>({style:{}}),body:{},head:{},addEventListener(){}};sb.navigator={vibrate(){}};
let b='';for(const f of ['01-util.js','02-chart.js','03-market.js','04-core.js','05-tutorials.js','08-ai.js'])b+='\n'+fs.readFileSync('src/'+f,'utf8');
b+='\nglobalThis.__X={Core,Agent,LLM,PAIR_ORDER};';vm.runInContext(b,sb);
const {Core,Agent,LLM}=sb.__X;
let pass=0,fail=0;
const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));
(async()=>{
console.log('\n=== 原生桥接（APK 路径）===');
LLM.configure({provider:'custom',url:'https://api.test/v1/chat/completions',model:'m',key:'sk-x',enabled:true});
chk('检出了原生桥接', LLM.hasNative()===true);
const r=await LLM.chat([{role:'user',content:'hi'}]);
chk('经原生桥接调用成功', r.ok, r.error);
chk('原生层收到了请求', nativeCalls.length===1);
chk('URL 正确传递', nativeCalls[0].url==='https://api.test/v1/chat/completions');
chk('Authorization 头正确传递', nativeCalls[0].headers.Authorization==='Bearer sk-x', JSON.stringify(nativeCalls[0].headers));
chk('body 含 model 与 messages', nativeCalls[0].body.model==='m' && Array.isArray(nativeCalls[0].body.messages));
chk('返回内容被正确解析', r.text.includes('native ok'), r.text);

// Agent 走桥接
const c=new Core();const a=new Agent({core:c,cash:300000});a.core.st.cash=300000;
nativeCalls.length=0;
const r2=await a.think(c.market);
chk('Agent 经桥接完成思考', r2.ok, JSON.stringify(r2));
chk('思考结果被应用', a.lastThought==='native ok', a.lastThought);

// 原生返回错误
sb.AndroidAI.httpPost=function(id,url,h,b){ setTimeout(()=>sb.__AI_HTTP_RESOLVE(id,false,401,'{"error":{"message":"bad key"}}'),5); };
const r3=await LLM.chat([{role:'user',content:'x'}]);
chk('原生 HTTP 401 被正确报错', !r3.ok && /401|bad key/.test(r3.error), r3.error);

// 原生不回调 → 超时保护
sb.AndroidAI.httpPost=function(){ /* 故意不回调 */ };
const t0=Date.now();
const r4=await LLM.chat([{role:'user',content:'x'}],{timeout:1200});
chk('原生无响应时超时返回（不会永久挂起）', !r4.ok && /超时/.test(r4.error), r4.error+' ('+(Date.now()-t0)+'ms)');
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail?1:0);
})();
