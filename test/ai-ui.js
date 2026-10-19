/* AI 界面冒烟测试：验证「人物」页的 AI 区在无配置/有配置下都能渲染，且不破坏页面 */
const fs=require('fs'); const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('/sdcard/读博模拟器/kurumi-fx/dist/index.html','utf8');
const errors=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push('E: '+(e.message||e)));
vc.on('error',(...a)=>errors.push('E: '+a.join(' ')));
function fake2d(){const g={addColorStop(){}};return{setTransform(){},save(){},restore(){},clearRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},arcTo(){},arc(){},fill(){},stroke(){},fillRect(){},strokeRect(){},fillText(){},measureText:()=>({width:24}),createLinearGradient:()=>g,createRadialGradient:()=>g,setLineDash(){}};}
let fetchCalls=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',virtualConsole:vc,beforeParse(w){
  w.HTMLCanvasElement.prototype.getContext=function(){return fake2d()};
  w.Element.prototype.getBoundingClientRect=()=>({width:360,height:260,left:0,top:0,right:360,bottom:260});
  w.AudioContext=function(){return{state:'running',currentTime:0,sampleRate:44100,destination:{},resume(){},createGain(){return{gain:{value:1,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}},createOscillator(){return{type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}}},createBuffer(n,l){return{getChannelData:()=>new Float32Array(l)}},createBufferSource(){return{buffer:null,connect(){},start(){}}},createBiquadFilter(){return{type:'',frequency:{value:0},Q:{value:0},connect(){}}}}};
  w.navigator.vibrate=()=>true;
  if(!w.PointerEvent)w.PointerEvent=class extends w.MouseEvent{constructor(t,i){super(t,i);this.pointerId=1}};
  let vt=0;w.requestAnimationFrame=fn=>setTimeout(()=>{vt+=16;fn(vt)},0);w.cancelAnimationFrame=id=>clearTimeout(id);
  Object.defineProperty(w.performance,'now',{value:()=>vt});
  w.fetch=(url,opts)=>{fetchCalls.push({url,body:opts&&opts.body});
    return Promise.resolve({ok:true,status:200,json:async()=>({choices:[{message:{content:'{"thought":"看多","quote":"跟上","actions":[{"type":"open","pair":"USDJPY","dir":"long","units":10000,"lev":5}],"noop":false}'}}]}),text:async()=>'x'});};
}});
const {window}=dom, doc=window.document;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=m=>{pass++;console.log('  ✓ '+m)};
const bad=m=>{fail++;console.log('  ✗ '+m)};
const chk=(m,c,i)=>c?ok(m):bad(m+(i?'  → '+i:''));
const $=s=>doc.querySelector(s), $$=s=>Array.from(doc.querySelectorAll(s));
const click=n=>{if(!n)return false;n.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:5}));n.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));return true;};
(async()=>{
  await sleep(350);
  click($('.cv-btn')); await sleep(500);
  const K=window.__FXK__;
  chk('游戏启动', !!K);
  chk('AIPlayer 已挂到 core', !!(K && K.core.ai));

  // 切到人物页
  click($('#tabs button[data-s="me"]')); await sleep(120);
  chk('人物页已激活', $('#sc-me') && $('#sc-me').classList.contains('on'));
  chk('AI 区已插入', !!$('#aiZone'));
  chk('AI 区有内容', $('#aiZone') && $('#aiZone').innerHTML.length > 200, ($('#aiZone')||{}).innerHTML ? $('#aiZone').innerHTML.length + ' 字节' : '空');
  chk('未配置时显示"去配置 API"', /去配置 API|未登场的第四位参赛者/.test(($('#aiZone')||{}).innerHTML||''));
  chk('设定页有 AI 入口', !!$$('#setCard .kv').find(k=>/AI 交易员/.test(k.innerHTML)));

  // 打开配置抽屉
  click($('#aiOpenCfg')); await sleep(250);
  chk('配置抽屉已打开', $('#sheet').classList.contains('on'));
  chk('有服务商预设按钮', $$('#pvChips button').length >= 4, $$('#pvChips button').length+' 个');
  chk('有地址输入框', !!$('#cfgUrl'));
  chk('有模型输入框', !!$('#cfgModel'));
  chk('有 Key 输入框', !!$('#cfgKey'));
  chk('有温度滑块', !!$('#cfgTemp'));
  chk('有安全提示', /不会上传|只保存在本机/.test(($('#sheet')||{}).innerHTML||''));
  chk('有测试连接按钮', !!$('#cfgTest'));
  chk('有清除 Key 按钮', !!$('#cfgClear'));

  // 点 DeepSeek 预设应自动填地址与模型
  const dsBtn=$$('#pvChips button').find(b=>b.dataset.pv==='deepseek');
  click(dsBtn); await sleep(120);
  chk('选 DeepSeek 自动填地址', /deepseek\.com/.test($('#cfgUrl').value), $('#cfgUrl').value);
  chk('选 DeepSeek 自动填模型', $('#cfgModel').value === 'deepseek-chat', $('#cfgModel').value);

  // 填入配置并保存
  $('#cfgUrl').value='https://api.example.test/v1/chat/completions';
  $('#cfgModel').value='test-model';
  $('#cfgKey').value='sk-test-123';
  click($('#cfgSave')); await sleep(400);
  chk('保存后弹出「她登场了」提示（而不是停在配置页）',
      /出场|登场了|ゆき/.test(($('#sheet')||{}).innerHTML||''), ($('#sheet')||{}).innerHTML ? '有内容' : '空');
  chk('配置已写入 localStorage', /sk-test-123/.test(window.localStorage.getItem('fxkurumi.ai.v1')||''));

  // 保存后应自动让她登场
  chk('AI 对手已创建', !!K.core.ai.agent);
  chk('AI 名字为 ゆき', K.core.ai.agent && K.core.ai.agent.name==='ゆき');

  // 重新渲染人物页
  click($('#tabs button[data-s="trade"]')); await sleep(80);
  click($('#tabs button[data-s="me"]')); await sleep(160);
  const z=$('#aiZone').innerHTML;
  chk('AI 卡显示她的名字', /ゆき/.test(z));
  chk('有三个竞赛排名行', (z.match(/福賀久留美|山師芽吹/g)||[]).length>=2);
  chk('显示洞察点', /洞察点/.test(z));
  chk('显示对赌区', /对赌/.test(z));
  chk('显示挑战目标区', /挑战目标/.test(z));
  chk('显示三个技能', /交易成本减免/.test(z)&&/爆仓保险/.test(z)&&/情报力/.test(z));

  // 触发一次 AI 思考
  const before=fetchCalls.length;
  click($('#aiThink')); await sleep(700);
  chk('点"让她思考一次"发起了 API 请求', fetchCalls.length>before, 'before='+before+' after='+fetchCalls.length);
  chk('请求发往正确地址', fetchCalls.length&&fetchCalls[fetchCalls.length-1].url==='https://api.example.test/v1/chat/completions',
      fetchCalls.length?fetchCalls[fetchCalls.length-1].url:'');
  chk('她在这次思考后开了仓', K.core.ai.agent.positions.length>=1, 'pos='+K.core.ai.agent.positions.length);
  chk('写了她的动态日志', K.core.st.log.some(l=>l.kind==='ai'));

  // 打开对话
  click($('#aiTalk')); await sleep(300);
  chk('对话抽屉已打开', $('#sheet').classList.contains('on'));
  chk('有对话输入框', !!$('#chatIn'));
  $('#chatIn').value='你觉得我该止损吗';
  click($('#chatSend')); await sleep(700);
  chk('发送后产生了对话记录', K.core.ai.chat.length>=2, 'chat='+K.core.ai.chat.length);
  chk('AI 有回复', K.core.ai.chat.some(m=>m.role==='assistant'));
  Sheets_close();
  function Sheets_close(){ click($('#mask')); }
  await sleep(200);

  // 给 AI 设目标
  click($('#tabs button[data-s="me"]')); await sleep(140);
  const goalBtn=$('#aiGoal');
  chk('有设目标按钮', !!goalBtn);
  click(goalBtn); await sleep(250);
  chk('目标抽屉已打开', $('#sheet').classList.contains('on'));
  if($('#shOk')){ click($('#shOk')); await sleep(300); }
  chk('目标已记录', K.core.ai.goals().length>=1, 'goals='+K.core.ai.goals().length);

  // 对赌
  K.core.st.wallet = 300000;
  click($('#tabs button[data-s="me"]')); await sleep(140);
  const betBtn=$('#aiBet');
  chk('有押注按钮', !!betBtn);
  click(betBtn); await sleep(250);
  chk('押注成功', K.core.ai.myBets().length>=1, 'bets='+K.core.ai.myBets().length);
  chk('押注扣了钱包', K.core.st.wallet===200000, 'wallet='+K.core.st.wallet);

  chk('全程无未捕获异常', errors.length===0, errors.slice(0,4).join(' | '));
  console.log(`\n${'='.repeat(48)}\nAI 界面冒烟：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('测试崩溃：',e);process.exit(1)});
