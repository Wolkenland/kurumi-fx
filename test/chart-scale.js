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
  const K=window.__FXK__, c=K.core, ui=K.ui;
  const chart = ui.chart || (ui.chartO && ui.chartO.chart) || null;
  chk('拿得到 chart 实例', !!chart, chart ? 'ok' : 'null');
  if(!chart){ console.log('结果：'+pass+' 通过 / '+fail+' 失败'); process.exit(1); }

  const bars = c.market.pair('USDJPY').bars;
  const v = { start: Math.max(0, bars.length-60), end: bars.length, count: 60 };

  // 1) 没有强平线时的基准范围
  chart.liqLine = null; chart.entryLine = null;
  const base = chart.highLow(bars, v);
  const baseSpan = base.hi - base.lo;

  // 2) 100 倍杠杆：强平线远在下方
  const px = bars[bars.length-1].c;
  chart.entryLine = px;
  chart.liqLine = px * 0.40;      // 远在视野外
  const far = chart.highLow(bars, v);
  const farSpan = far.hi - far.lo;
  chk('强平线远离时不撑大 Y 轴', farSpan < baseSpan * 1.6, `跨度 ${baseSpan.toFixed(3)} → ${farSpan.toFixed(3)}`);
  chk('价格仍在视野中央附近', px > far.lo && px < far.hi, `${far.lo.toFixed(2)} < ${px.toFixed(2)} < ${far.hi.toFixed(2)}`);

  // 3) 强平线很近时应当纳入
  chart.liqLine = px * 0.995;
  const near = chart.highLow(bars, v);
  chk('强平线很近时仍会纳入范围', near.lo <= chart.liqLine + 1e-9, `lo=${near.lo.toFixed(3)} liq=${chart.liqLine.toFixed(3)}`);

  // 4) 极端：强平线在上方很远
  chart.liqLine = px * 1.6;
  const up = chart.highLow(bars, v);
  chk('上方远离也不撑大', (up.hi - up.lo) < baseSpan * 1.6, `跨度 ${(up.hi-up.lo).toFixed(3)}`);

  chk('无异常', errs.length===0, errs.slice(0,2).join('|'));
  console.log('\n结果：'+pass+' 通过 / '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
