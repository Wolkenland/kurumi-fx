const fs=require('fs'); const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('/sdcard/读博模拟器/kurumi-fx/dist/index.html','utf8');
const vc=new VirtualConsole(); const errs=[]; vc.on('jsdomError',e=>errs.push(e.message)); vc.on('error',(...a)=>errs.push(a.join(' ')));
function f2d(){const g={addColorStop(){}};return{setTransform(){},save(){},restore(){},clearRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},arcTo(){},arc(){},fill(){},stroke(){},fillRect(){},strokeRect(){},fillText(){},measureText:()=>({width:24}),createLinearGradient:()=>g,createRadialGradient:()=>g,setLineDash(){}};}
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',virtualConsole:vc,beforeParse(w){
  w.HTMLCanvasElement.prototype.getContext=function(){return f2d()};
  w.Element.prototype.getBoundingClientRect=()=>({width:360,height:260,left:0,top:0,right:360,bottom:260});
  w.AudioContext=function(){return{state:'running',currentTime:0,sampleRate:44100,destination:{},resume(){},createGain(){return{gain:{value:1,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}},createOscillator(){return{type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}}},createBuffer(n,l){return{getChannelData:()=>new Float32Array(l)}},createBufferSource(){return{buffer:null,connect(){},start(){}}},createBiquadFilter(){return{type:'',frequency:{value:0},Q:{value:0},connect(){}}}}};
  w.navigator.vibrate=()=>true;
  if(!w.PointerEvent)w.PointerEvent=class extends w.MouseEvent{constructor(t,i){super(t,i);this.pointerId=1}};
  let vt=0;w.requestAnimationFrame=fn=>setTimeout(()=>{vt+=16;fn(vt)},0);w.cancelAnimationFrame=id=>clearTimeout(id);
  Object.defineProperty(w.performance,'now',{value:()=>vt});
}});
const {window}=dom, doc=window.document; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>doc.querySelector(s), $$=s=>Array.from(doc.querySelectorAll(s));
const click=n=>{if(!n)return;n.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:5}));n.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));};
let pass=0,fail=0; const chk=(m,c,i)=>c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ '+m+(i?'  → '+i:'')));
(async()=>{
  await sleep(400); click($('.cv-btn')); await sleep(600);
  const K=window.__FXK__, c=K.core;
  chk('版本号 1.3.0', K.version==='1.3.0', K.version);
  chk('品种标签 8 个', $$('#pairTabs .pair-tab').length===8, $$('#pairTabs .pair-tab').length+' 个');
  click($('#tabs button[data-s="me"]')); await sleep(300);
  chk('人物页有成就按钮', !!$('#btnAch'));
  chk('人物页有统计按钮', !!$('#btnStats'));
  chk('成就按钮显示进度', /成就/.test($('#btnAch').textContent), $('#btnAch').textContent.trim());
  // 打开成就
  click($('#btnAch')); await sleep(300);
  chk('成就抽屉已开', $('#sheet').classList.contains('on'));
  chk('显示成就标题', /成就/.test($('#sheet').innerHTML));
  chk('有分类筛选', $$('#sheet [data-cat]').length===5, $$('#sheet [data-cat]').length+' 个');
  const rows=$$('#sheet [data-cat]').length;
  chk('列出成就条目', (($('#sheet').innerHTML.match(/data-cat/g)||[]).length)>=5);
  // 关掉
  const closeBtn=$$('#sheet button').find(b=>/关闭/.test(b.textContent));
  click(closeBtn); await sleep(300);
  // 打开统计
  click($('#btnStats')); await sleep(300);
  chk('统计抽屉已开', $('#sheet').classList.contains('on'));
  chk('显示交易统计', /交易统计/.test($('#sheet').innerHTML));
  chk('显示总交易次数', /总交易次数/.test($('#sheet').innerHTML));
  chk('显示胜率', /胜率/.test($('#sheet').innerHTML));
  chk('显示分品种盈亏', /分品种/.test($('#sheet').innerHTML));
  chk('全程无异常', errs.length===0, errs.slice(0,2).join(' | '));
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('崩溃:',e);process.exit(1)});
