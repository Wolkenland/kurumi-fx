#!/usr/bin/env node
/* 生成 B 站封面：杠杆场景做底 + 大标题 + 三个卖点 */
const fs = require('fs'), path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath('/system/fonts/NotoSansCJK-Regular.ttc', 'CJK');

const W = 1920, H = 1080;
const c = createCanvas(W, H);
const ctx = c.getContext('2d');
const clamp=(x,a,b)=>x<a?a:x>b?b:x;

/* 背景 */
const g = ctx.createLinearGradient(0,0,W,H);
g.addColorStop(0,'#07090f'); g.addColorStop(.5,'#0a0f18'); g.addColorStop(1,'#120a12');
ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

const g2 = ctx.createRadialGradient(320,-120,0,320,-120,1000);
g2.addColorStop(0,'rgba(255,143,177,0.20)'); g2.addColorStop(1,'rgba(255,143,177,0)');
ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);

/* 背景 K 线（装饰） */
const rnd = (()=>{let s=42;return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};})();
let px = 980, price = 60;
ctx.globalAlpha = 0.5;
for (let i=0;i<46;i++){
  const o=price, cl=price+(rnd()-0.48)*46;
  const hi=Math.max(o,cl)+rnd()*22, lo=Math.min(o,cl)-rnd()*22;
  const Y=p=>H*0.55-(p-40)*4.2;
  const col = cl>=o ? '#3ddc97' : '#ff4d6d';
  ctx.strokeStyle=col; ctx.fillStyle=col;
  ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(px,Y(hi)); ctx.lineTo(px,Y(lo)); ctx.stroke();
  const top=Y(Math.max(o,cl)), bot=Y(Math.min(o,cl));
  ctx.fillRect(px-8, top, 16, Math.max(3,bot-top));
  px += 21; price = cl;
}
ctx.globalAlpha = 1;

/* 网格 */
ctx.strokeStyle='rgba(255,255,255,0.03)';
for(let x=0;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
for(let y=0;y<H;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

/* 左侧遮罩，保证文字可读 */
const mask = ctx.createLinearGradient(0,0,W*0.62,0);
mask.addColorStop(0,'rgba(7,9,15,0.96)');
mask.addColorStop(0.75,'rgba(7,9,15,0.75)');
mask.addColorStop(1,'rgba(7,9,15,0)');
ctx.fillStyle=mask; ctx.fillRect(0,0,W*0.62,H);

function T(s,x,y,{size=40,weight='400',color='#e8eefc',align='left',glow,alpha=1}={}){
  ctx.save(); ctx.globalAlpha=alpha;
  ctx.font=`${weight} ${size}px CJK`;
  ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline='alphabetic';
  if(glow){ctx.shadowColor=glow;ctx.shadowBlur=40;}
  ctx.fillText(s,x,y); ctx.restore();
}

/* 顶部小标 */
T('非官方同人作品', 110, 130, {size:26, weight:'500', color:'#ff8fb1'});
ctx.fillStyle='#ff8fb1'; ctx.fillRect(110,150,58,3);

/* 主标题 */
T('FX戦士くるみちゃん', 110, 320, {size:96, weight:'bold', color:'#ffffff', glow:'rgba(255,143,177,0.65)'});
T('同人交易模拟器', 116, 400, {size:54, weight:'bold', color:'#ff8fb1'});

/* 三个卖点 */
const tags = [
  ['100 倍杠杆', '#ff4d6d'],
  ['年利 109%',  '#c084fc'],
  ['AI 陪你爆仓', '#8cb4ff'],
];
let tx = 116;
tags.forEach(([s,col])=>{
  ctx.save();
  const pad=26, fs=34;
  ctx.font=`bold ${fs}px CJK`;
  const w=ctx.measureText(s).width+pad*2;
  ctx.beginPath();
  const r=12, x=tx, y=470, h=64;
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  ctx.fillStyle=col+'22'; ctx.fill();
  ctx.strokeStyle=col+'88'; ctx.lineWidth=2; ctx.stroke();
  ctx.restore();
  T(s, tx+pad, 470+44, {size:fs, weight:'bold', color:col});
  tx += w + 16;
});

/* 一句话钩子 */
T('玩完之后，你可能再也不想碰杠杆了', 116, 640, {size:46, weight:'bold', color:'#ffd166', glow:'rgba(255,209,102,0.45)'});

/* 地址 */
T('wolkenland.github.io/kurumi-fx', 116, 740, {size:30, weight:'500', color:'#8cb4ff'});

/* 底部条 */
ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(0,H-8,W,8);

const out = path.join(__dirname,'..','dist','cover-bili.png');
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('✓ 封面已生成:', out, (fs.statSync(out).size/1024).toFixed(0)+' KB');
