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
  click($('#tabs button[data-s="me"]')); await sleep(300);
  chk('人物页有今日任务卡片', /今日任务/.test(doc.documentElement.innerHTML));
  chk('显示任务进度 x/3', /[0-3] \/ 3/.test(doc.documentElement.innerHTML));
  chk('任务数量为 3', c.dailyProgress().length===3, c.dailyProgress().length+' 个');
  const before=c.st.insightPts;
  c.st.cash=5000000;
  for(let i=0;i<3;i++){ c.open('USDJPY',1,10000,10); c.close(c.st.positions[0].id,0); }
  await sleep(300);
  click($('#tabs button[data-s="trade"]')); await sleep(150);
  click($('#tabs button[data-s="me"]')); await sleep(300);
  chk('完成后洞察点增加', c.st.insightPts>before, before+' → '+c.st.insightPts);
  chk('有完成标记', (doc.documentElement.innerHTML.match(/✓/g)||[]).length>0);
  chk('无异常', errs.length===0, errs.slice(0,2).join('|'));
  console.log('\n结果：'+pass+' 通过 / '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
