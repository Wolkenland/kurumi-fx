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
  // 造 40 笔交易记录
  c.st.closed = [];
  for(let i=0;i<40;i++){
    c.st.closed.push({ id:i, pid:'USDJPY', dir:i%2?1:-1, units:10000, lev:10,
      entry:110, exit:110.1, pnl:(i%3-1)*5000, day:i, reason:null });
  }
  click($('#tabs button[data-s="me"]')); await sleep(400);

  const list=$('#closedList');
  chk('记录容器限高可滚', list && /max-height/.test(list.getAttribute('style')||''), list?list.getAttribute('style'):'无');
  const items=$$('#closedList .log-item').length;
  chk('卡片只渲染 6 条（40 笔历史不刷屏）', items===6, items+' 条');
  chk('计数显示总数', /40/.test($('#closedCount').textContent), $('#closedCount').textContent);
  const btn=$('#btnAllClosed');
  chk('有查看全部按钮', !!btn);
  chk('按钮显示总数', btn && /40/.test(btn.textContent), btn?btn.textContent:'');
  click(btn); await sleep(400);
  chk('抽屉已打开', $('#sheet').classList.contains('on'));
  const inSheet=$$('#sheet .log-item').length;
  chk('抽屉里能看到全部 40 条', inSheet===40, inSheet+' 条');
  chk('显示累计盈亏', /累计/.test($('#sheet').innerHTML));
  chk('无异常', errs.length===0, errs.slice(0,2).join('|'));
  console.log('\n结果：'+pass+' 通过 / '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
