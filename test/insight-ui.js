const fs=require('fs'); const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('/sdcard/读博模拟器/kurumi-fx/dist/index.html','utf8');
const errs=[]; const vc=new VirtualConsole();
vc.on('jsdomError',e=>errs.push('E:'+(e.message||e))); vc.on('error',(...a)=>errs.push('E:'+a.join(' ')));
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
const {window}=dom, doc=window.document;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0; const ok=m=>{pass++;console.log('  ✓ '+m)}; const bad=m=>{fail++;console.log('  ✗ '+m)};
const chk=(m,c,i)=>c?ok(m):bad(m+(i?'  → '+i:''));
const $=s=>doc.querySelector(s), $$=s=>Array.from(doc.querySelectorAll(s));
const click=n=>{if(!n)return;n.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:5}));n.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));};
(async()=>{
  await sleep(350); click($('.cv-btn')); await sleep(600);
  const K=window.__FXK__; const c=K.core;
  // 给点数
  c.st.insightPts = 12; c.st.wallet = 0;
  click($('#tabs button[data-s="me"]')); await sleep(200);
  const z=$('#aiZone');
  chk('AI 区存在', !!z);
  const h=z.innerHTML;
  chk('显示"洞察换钱"', /洞察换钱/.test(h));
  chk('显示兑换比例 100,000', /100,000/.test(h));
  chk('有兑换 1 点按钮', !!$('#ex1'));
  chk('有全部兑换按钮', !!$('#exAll'));
  chk('六个技能都渲染', ['交易成本减免','爆仓保险','情报力','信用力','利息谈判','胆力'].every(n=>h.includes(n)),
      ['交易成本减免','爆仓保险','情报力','信用力','利息谈判','胆力'].filter(n=>!h.includes(n)).join(','));
  chk('技能按钮带 data-perk', $$('[data-perk]').length>=4, $$('[data-perk]').length+' 个');

  // 点兑换 1 点
  click($('#ex1')); await sleep(300);
  chk('兑换后点数 -1', c.st.insightPts===11, String(c.st.insightPts));
  chk('兑换后钱包 +10万', c.st.wallet===100000, String(c.st.wallet));

  // 点全部兑换
  c.st.insightPts = 5; const w0=c.st.wallet;
  click($('#exAll')); await sleep(300);
  chk('全部兑换点数为 0', c.st.insightPts===0, String(c.st.insightPts));
  chk('全部兑换进账 50 万', c.st.wallet===w0+500000, String(c.st.wallet-w0));

  // 点信用力技能
  c.st.insightPts = 30;
  click($('#tabs button[data-s="trade"]')); await sleep(80);
  click($('#tabs button[data-s="me"]')); await sleep(200);
  const btn=$$('[data-perk]').find(b=>b.dataset.perk==='credit');
  chk('找到信用力按钮', !!btn);
  if(btn){ click(btn); await sleep(300); }
  chk('信用力升到 Lv1', c.st.perks.credit===1, String(c.st.perks.credit));
  chk('借贷上限 +25%', Math.abs(c.loanLimitMul()-1.25)<1e-9, String(c.loanLimitMul()));

  chk('全程无未捕获异常', errs.length===0, errs.slice(0,3).join(' | '));
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('崩溃:',e);process.exit(1)});
