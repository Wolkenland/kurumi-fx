#!/usr/bin/env node
/**
 * 视频分镜与渲染
 *
 * 8 个场景，共约 122 秒：
 *   1. 开场标题      6s
 *   2. 缘起          10s
 *   3. 真实 K 线     18s
 *   4. 杠杆          20s
 *   5. 借贷          18s
 *   6. AI 交易员     20s
 *   7. 洞察与技能    16s
 *   8. 结尾          14s
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');
const K = require('./video-kit.js');
const { W, H, FPS, C, rr, txt, para, bg, card, bar, seg, easeOut, easeInOut, easeBack, lerp, clamp } = K;

/* ================= 真实游戏数据 ================= */
const game = K.loadGame();
const { U, Market, PAIRS, PAIR_ORDER, LOAN_PRODUCTS, PERK_DEFS, PERK_ORDER } = game;

const market = new Market(20240401);
for (let i = 0; i < 30; i++) market.tick();          // 预热
const usd = market.pair('USDJPY');
const BARS = usd.bars.slice(-110).map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c }));

// 用于杠杆演示：算三种杠杆的爆仓距离（真实公式）
function liqDistancePct(lev, units) {
  // 账户资金刚好等于必要保证金的一半缓冲，可得 50/lev %
  return 50 / lev;
}
const LEV_DEMO = [10, 50, 100].map(lev => ({
  lev,
  dist: liqDistancePct(lev),
  color: lev === 10 ? C.up : lev === 50 ? C.gold : C.dn,
}));

// 109% 复利曲线（真实日复利）
function compoundCurve(rate, months) {
  const pts = [];
  for (let m = 0; m <= months; m++) {
    const days = m * 30.44;
    pts.push(Math.pow(1 + rate / 365, days));
  }
  return pts;
}
const CURVE_109 = compoundCurve(1.09, 12);
const CURVE_18 = compoundCurve(0.18, 12);

/* ================= 场景定义 ================= */
const scenes = [];

/* ---------- 1. 开场 ---------- */
scenes.push({
  name: 'title', dur: 6,
  draw(ctx, t) {
    bg(ctx, t);
    const a1 = easeOut(seg(t, 0.35, 1.6));
    const a2 = easeOut(seg(t, 1.1, 2.4));
    const a3 = easeOut(seg(t, 1.9, 3.0));

    // 扫过的粉线
    const sweep = seg(t, 0.2, 2.2);
    if (sweep > 0 && sweep < 1) {
      const y = H * 0.42;
      const g = ctx.createLinearGradient(0, y, W * sweep, y);
      g.addColorStop(0, 'rgba(255,143,177,0)');
      g.addColorStop(1, 'rgba(255,143,177,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 2, W * sweep, 4);
    }

    const cx = W / 2;
    ctx.save();
    ctx.translate(cx, H * 0.44);
    ctx.scale(lerp(0.94, 1, a1), lerp(0.94, 1, a1));
    txt(ctx, 'FX戦士くるみちゃん', 0, 0, {
      size: 108, weight: 'bold', color: C.tx, align: 'center', alpha: a1,
      glow: 'rgba(255,143,177,0.55)', glowBlur: 40,
    });
    ctx.restore();

    txt(ctx, '同 人 交 易 模 拟 器', cx, H * 0.44 + 96, {
      size: 42, weight: '500', color: C.pink, align: 'center', alpha: a2,
    });
    txt(ctx, 'TRADING  SIMULATOR', cx, H * 0.44 + 158, {
      size: 24, weight: '400', color: C.tx3, align: 'center', alpha: a3,
    });

    // 底部小字
    txt(ctx, '非官方粉丝作品 · 原作：でむにゃん / 炭酸だいすき', cx, H - 90, {
      size: 22, color: C.tx3, align: 'center', alpha: easeOut(seg(t, 3.0, 4.2)),
    });

    // 淡出
    const fade = seg(t, 5.2, 6);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 2. 缘起 ---------- */
const ORIGIN_LINES = [
  { s: '2008 年。母亲在 FX 里亏掉了 2000 万日元。', c: C.tx },
  { s: '然后她从楼上跳了下去。', c: C.dn },
  { s: '五年后，女儿带着 30 万入场——', c: C.tx },
  { s: '目标是把那 2000 万，从市场里抢回来。', c: C.gold },
];
scenes.push({
  name: 'origin', dur: 10,
  draw(ctx, t) {
    bg(ctx, t);
    const x = 180;
    let y = H * 0.32;
    const per = 2.1;
    ORIGIN_LINES.forEach((ln, i) => {
      const st = i * per;
      const a = easeOut(seg(t, st, st + 0.7));
      const dy = lerp(26, 0, a);
      if (a > 0) {
        txt(ctx, ln.s, x, y + dy, {
          size: 46, weight: i === 3 ? 'bold' : '400', color: ln.c, alpha: a,
          glow: i === 1 ? 'rgba(255,77,109,0.5)' : undefined, glowBlur: 30,
        });
      }
      y += 108;
    });

    // 一行竖线装饰
    const la = easeOut(seg(t, 0.1, 0.8));
    ctx.save();
    ctx.globalAlpha = la * 0.7;
    ctx.fillStyle = C.pink;
    ctx.fillRect(x - 54, H * 0.22, 4, 360 * la);
    ctx.restore();

    txt(ctx, '—— 这是复仇。', x, H * 0.32 + 108 * 4 + 30, {
      size: 30, color: C.pink, alpha: easeOut(seg(t, 8.2, 9.0)),
    });

    const fade = seg(t, 9.2, 10);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 3. 真实 K 线 ---------- */
scenes.push({
  name: 'chart', dur: 18,
  draw(ctx, t) {
    bg(ctx, t);

    const titleA = easeOut(seg(t, 0, 0.8));
    txt(ctx, '先看懂它在做什么', 120, 130, { size: 54, weight: 'bold', color: C.tx, alpha: titleA });
    txt(ctx, '这是游戏里真实生成的行情——和真实市场的规则一致', 120, 186, {
      size: 26, color: C.tx2, alpha: easeOut(seg(t, 0.3, 1.2)),
    });

    /* 图表区域 */
    const gx = 100, gy = 250, gw = 1180, gh = 620;
    card(ctx, gx, gy, gw, gh, { alpha: easeOut(seg(t, 0.2, 0.9)) });

    // 显示进度：逐根出现
    const showN = Math.floor(clamp(seg(t, 1.2, 11) * BARS.length, 1, BARS.length));
    const view = BARS.slice(0, showN);
    let hi = -Infinity, lo = Infinity;
    for (const b of view) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
    const pad = (hi - lo) * 0.12 || 0.01;
    hi += pad; lo -= pad;

    const X = i => gx + 40 + (i + 0.5) * ((gw - 90) / BARS.length);
    const Y = p => gy + gh - 50 - (p - lo) / (hi - lo) * (gh - 100);

    // 网格
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = gy + 50 + (gh - 100) * i / 5;
      ctx.beginPath(); ctx.moveTo(gx + 30, y); ctx.lineTo(gx + gw - 30, y); ctx.stroke();
      const price = hi - (hi - lo) * i / 5;
      txt(ctx, price.toFixed(3), gx + gw - 20, y + 6, { size: 18, color: C.tx3, align: 'right' });
    }
    ctx.restore();

    // 蜡烛
    const bw = Math.max(3, (gw - 90) / BARS.length * 0.62);
    view.forEach((b, i) => {
      const rise = b.c >= b.o;
      ctx.fillStyle = rise ? C.up : C.dn;
      ctx.strokeStyle = rise ? C.up : C.dn;
      const x = X(i);
      // 影线
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      // 实体
      const top = Y(Math.max(b.o, b.c)), bot = Y(Math.min(b.o, b.c));
      ctx.fillRect(x - bw / 2, top, bw, Math.max(2, bot - top));
    });

    // 最新价标牌
    if (view.length) {
      const last = view[view.length - 1];
      const yl = Y(last.c);
      ctx.save();
      ctx.shadowColor = C.gold; ctx.shadowBlur = 20;
      ctx.fillStyle = C.gold;
      rr(ctx, gx + gw - 250, yl - 18, 96, 36, 8);
      ctx.fill();
      ctx.restore();
      txt(ctx, last.c.toFixed(3), gx + gw - 202, yl + 8, { size: 22, weight: 'bold', color: '#08111c', align: 'center' });
    }

    /* 右侧说明 */
    const rx = 1340;
    let ry = 300;
    const items = [
      ['点（pip）', '汇率最小刻度，日元对是 0.01', C.blue],
      ['手数', '1 万通貨＝1 枚，1pip ≈ 100 円', C.up],
      ['点差', '买价与卖价的差，开仓即亏', C.dn],
      ['隔夜利息', '持仓过夜的利率差，周三三倍', C.purple],
    ];
    items.forEach((it, i) => {
      const a = easeOut(seg(t, 3 + i * 0.9, 3.6 + i * 0.9));
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = it[2];
      ctx.fillRect(rx, ry - 26, 4, 78);
      ctx.restore();
      txt(ctx, it[0], rx + 22, ry, { size: 32, weight: 'bold', color: it[2], alpha: a });
      para(ctx, it[1], rx + 22, ry + 40, { size: 22, color: C.tx2, alpha: a, maxW: 480, lh: 32 });
      ry += 128;
    });

    const fade = seg(t, 17, 18);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 4. 杠杆 ---------- */
scenes.push({
  name: 'leverage', dur: 20,
  draw(ctx, t) {
    bg(ctx, t);

    txt(ctx, '杠杆：这个世界最危险的发明', 120, 130, {
      size: 54, weight: 'bold', color: C.tx, alpha: easeOut(seg(t, 0, 0.8)),
    });
    txt(ctx, '同样 1 万通貨，杠杆越高，爆仓线贴得越近', 120, 186, {
      size: 26, color: C.tx2, alpha: easeOut(seg(t, 0.3, 1.2)),
    });

    const cardW = 500, cardH = 430, gap = 55;
    const startX = (W - (cardW * 3 + gap * 2)) / 2;
    const topY = 300;

    LEV_DEMO.forEach((d, i) => {
      const a = easeOut(seg(t, 0.8 + i * 0.5, 1.5 + i * 0.5));
      if (a <= 0) return;
      const x = startX + i * (cardW + gap);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, lerp(40, 0, a));
      card(ctx, x, topY, cardW, cardH, { border: d.color + '66' });

      txt(ctx, `${d.lev}×`, x + cardW / 2, topY + 108, {
        size: 86, weight: 'bold', color: d.color, align: 'center',
        glow: d.color, glowBlur: 30,
      });
      txt(ctx, '杠杆', x + cardW / 2, topY + 148, { size: 24, color: C.tx3, align: 'center' });

      // 爆仓距离条
      const pct = d.dist;              // 百分比
      const bx = x + 50, by = topY + 210, bwid = cardW - 100;
      txt(ctx, '可承受逆行', bx, by - 18, { size: 20, color: C.tx2 });
      txt(ctx, `${pct.toFixed(1)}%`, bx + bwid, by - 18, {
        size: 22, weight: 'bold', color: d.color, align: 'right',
      });
      bar(ctx, bx, by, bwid, 14, clamp(pct / 5, 0.02, 1), d.color);

      // 爆仓提示
      const boom = seg(t, 5 + i * 2.2, 5.6 + i * 2.2);
      if (boom > 0) {
        ctx.save();
        ctx.globalAlpha = boom * a;
        rr(ctx, x + 40, topY + 288, cardW - 80, 68, 12);
        ctx.fillStyle = 'rgba(255,77,109,0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,77,109,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        // 手绘警示三角（字体里没有 emoji）
        const tx2 = x + cardW / 2 - 92, ty2 = topY + 300;
        ctx.save();
        ctx.globalAlpha = boom * a;
        ctx.beginPath();
        ctx.moveTo(tx2, ty2);
        ctx.lineTo(tx2 + 26, ty2 + 30);
        ctx.lineTo(tx2 - 26, ty2 + 30);
        ctx.closePath();
        ctx.fillStyle = C.dn;
        ctx.fill();
        ctx.restore();
        txt(ctx, '!', tx2, ty2 + 26, { size: 22, weight: 'bold', color: '#1a0006', align: 'center', alpha: boom * a });
        txt(ctx, '强制平仓', x + cardW / 2 + 22, topY + 328, {
          size: 32, weight: 'bold', color: C.dn, align: 'center', alpha: boom * a,
        });
      }
      ctx.restore();
    });

    // 结语
    const ca = easeOut(seg(t, 12, 13));
    if (ca > 0) {
      txt(ctx, '杠杆不会让你赢。它只是让你输得更快、赢得更少次。', W / 2, H - 100, {
        size: 40, weight: 'bold', color: C.gold, align: 'center', alpha: ca,
        glow: 'rgba(255,209,102,0.5)', glowBlur: 26,
      });
    }

    const fade = seg(t, 19, 20);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 5. 借贷 ---------- */
scenes.push({
  name: 'debt', dur: 18,
  draw(ctx, t) {
    bg(ctx, t);
    txt(ctx, '借钱：把人推向深渊的第二只手', 120, 130, {
      size: 54, weight: 'bold', color: C.tx, alpha: easeOut(seg(t, 0, 0.8)),
    });
    txt(ctx, '四种渠道，利率越高越容易借到', 120, 186, {
      size: 26, color: C.tx2, alpha: easeOut(seg(t, 0.3, 1.2)),
    });

    /* 左侧渠道列表 */
    const list = LOAN_PRODUCTS.slice(0, 4);
    let y = 270;
    list.forEach((d, i) => {
      const a = easeOut(seg(t, 0.8 + i * 0.45, 1.4 + i * 0.45));
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(lerp(-40, 0, a), 0);
      card(ctx, 100, y, 760, 118, { border: d.color + '55' });
      ctx.fillStyle = d.color;
      ctx.fillRect(100, y + 22, 5, 74);
      txt(ctx, d.name, 138, y + 56, { size: 32, weight: 'bold', color: C.tx });
      txt(ctx, d.sub, 138, y + 94, { size: 21, color: C.tx3 });
      txt(ctx, `${(d.rate * 100).toFixed(1)}%`, 820, y + 72, {
        size: 46, weight: 'bold', color: d.color, align: 'right',
      });
      ctx.restore();
      y += 132;
    });

    /* 右侧：109% 复利曲线 */
    const a2 = easeOut(seg(t, 3.2, 4.2));
    if (a2 > 0) {
      const px = 960, py = 270, pw = 840, ph = 500;
      ctx.save();
      ctx.globalAlpha = a2;
      card(ctx, px, py, pw, ph);
      txt(ctx, '借 100 万，一年后要还多少？', px + 40, py + 62, { size: 28, weight: 'bold', color: C.tx });

      const gx = px + 70, gy = py + 110, gw = pw - 140, gh = ph - 190;
      const maxV = 3.1;
      const MX = m => gx + (m / 12) * gw;
      const MY = v => gy + gh - (v / maxV) * gh;

      // 轴
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.stroke();

      const draw = seg(t, 4.4, 8.5);
      const pts = Math.max(2, Math.floor(draw * CURVE_109.length));

      // 18% 参考线
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const x = MX(i), yy = MY(CURVE_18[i]);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 3;
      ctx.stroke();

      // 109% 曲线
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const x = MX(i), yy = MY(CURVE_109[i]);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.strokeStyle = C.purple;
      ctx.lineWidth = 5;
      ctx.shadowColor = C.purple;
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 末端标注
      const lastIdx = pts - 1;
      if (lastIdx >= 0) {
        const v = CURVE_109[lastIdx];
        const x = MX(lastIdx), yy = MY(v);
        ctx.beginPath(); ctx.arc(x, yy, 8, 0, Math.PI * 2);
        ctx.fillStyle = C.purple; ctx.fill();
        txt(ctx, `${(v * 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 万`, x - 10, yy - 26, {
          size: 26, weight: 'bold', color: C.purple, align: 'right',
        });
      }

      txt(ctx, '年利 18%（消費者和金融）', gx, gy + gh + 44, { size: 20, color: C.blue });
      txt(ctx, '年利 109%（萌智子的个人间融资）', gx, gy + gh + 76, { size: 20, color: C.purple });
      ctx.restore();
    }

    // 结语
    const ca = easeOut(seg(t, 11.5, 12.5));
    if (ca > 0) {
      txt(ctx, '利息按日复利。你不需要拖到一年——你会先爆仓。', W / 2, H - 110, {
        size: 38, weight: 'bold', color: C.gold, align: 'center', alpha: ca,
      });
    }

    const fade = seg(t, 17, 18);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 6. AI 交易员 ---------- */
const STANDING = [
  { name: '小金萌智子', ret: 12.4, c: C.purple, ini: '萌' },
  { name: 'ゆき（AI）', ret: 8.7, c: C.blue, ini: 'ゆ' },
  { name: '福賀久留美', ret: -3.2, c: C.pink, ini: '久', me: true },
  { name: '山師芽吹', ret: -18.6, c: C.up, ini: '芽' },
];
scenes.push({
  name: 'ai', dur: 20,
  draw(ctx, t) {
    bg(ctx, t);
    txt(ctx, '接一个 AI 进来，让她和你同场交易', 120, 130, {
      size: 54, weight: 'bold', color: C.tx, alpha: easeOut(seg(t, 0, 0.8)),
    });
    txt(ctx, '填写任意 OpenAI 兼容接口的 API Key，她会自己读行情、下单、爆仓', 120, 186, {
      size: 26, color: C.tx2, alpha: easeOut(seg(t, 0.3, 1.2)),
    });

    /* 左：三人竞赛排名 */
    const a1 = easeOut(seg(t, 0.8, 1.6));
    if (a1 > 0) {
      ctx.save(); ctx.globalAlpha = a1;
      card(ctx, 100, 260, 760, 560);
      txt(ctx, '三人 FX 竞赛 · 每 7 天结算', 140, 322, { size: 28, weight: 'bold', color: C.gold });
      ctx.restore();

      let y = 370;
      STANDING.forEach((s, i) => {
        const a = easeOut(seg(t, 1.4 + i * 0.5, 2.0 + i * 0.5));
        if (a <= 0) return;
        ctx.save();
        ctx.globalAlpha = a * a1;
        ctx.translate(lerp(50, 0, a), 0);

        // 名次
        txt(ctx, String(i + 1), 150, y + 40, {
          size: 32, weight: 'bold',
          color: i === 0 ? C.gold : i === 1 ? C.tx2 : C.tx3,
        });
        // 头像
        const cx = 210, cy = y + 20, r = 26;
        const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        g.addColorStop(0, s.c); g.addColorStop(1, C.blue);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        // 用名字首字（不能用 slice(-1)，中文名会取到姓氏末字）
        txt(ctx, s.name[0] === '小' || s.name[0] === '福' || s.name[0] === '山' ? s.name[1] : s.name[0], cx, cy + 10, {
          size: 24, weight: 'bold', color: '#0b0f16', align: 'center',
        });

        txt(ctx, s.name, 258, y + 30, { size: 28, weight: 'bold', color: C.tx });
        if (s.me) txt(ctx, '你', 258 + ctx.measureText(s.name).width + 12, y + 30, {
          size: 18, color: C.pink,
        });

        const rr2 = s.ret;
        txt(ctx, `${rr2 >= 0 ? '+' : ''}${rr2.toFixed(1)}%`, 810, y + 36, {
          size: 34, weight: 'bold', color: rr2 >= 0 ? C.up : C.dn, align: 'right',
        });
        ctx.restore();
        y += 106;
      });
    }

    /* 右：AI 对白 + 机制 */
    const a2 = easeOut(seg(t, 4.5, 5.5));
    if (a2 > 0) {
      ctx.save(); ctx.globalAlpha = a2;
      card(ctx, 920, 260, 880, 240, { border: 'rgba(140,180,255,0.35)' });
      ctx.restore();

      // 头像
      const cx = 1000, cy = 340, r = 40;
      ctx.save(); ctx.globalAlpha = a2;
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, C.blue); g.addColorStop(1, C.up);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      txt(ctx, 'ゆ', cx, cy + 14, { size: 36, weight: 'bold', color: '#08131f', align: 'center' });
      ctx.restore();

      txt(ctx, 'ゆき', 1064, 318, { size: 24, weight: 'bold', color: C.blue, alpha: a2 });
      const quote = '「你连维持率都不知道，也敢下单？」';
      txt(ctx, quote, 1064, 372, { size: 34, color: C.tx, alpha: a2 });
      txt(ctx, '她每约 1 分钟自主决策一次，会看到你的持仓和净值', 1064, 428, {
        size: 21, color: C.tx3, alpha: a2,
      });

      // 三条机制
      const feats = [
        ['① 押注她', '赌她这期赚不赚钱，赢了分她利润', C.pink],
        ['② 给她设目标', '7 天 +20%？她达成你领里程碑奖励', C.gold],
        ['③ 看她爆仓', '她也有独立账户，也会输光', C.dn],
      ];
      let fy = 560;
      feats.forEach((f, i) => {
        const a = easeOut(seg(t, 6.6 + i * 0.55, 7.2 + i * 0.55));
        if (a <= 0) return;
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = f[2];
        ctx.fillRect(940, fy - 26, 4, 56);
        ctx.restore();
        txt(ctx, f[0], 964, fy, { size: 28, weight: 'bold', color: f[2], alpha: a });
        txt(ctx, f[1], 964, fy + 34, { size: 21, color: C.tx2, alpha: a });
        fy += 96;
      });
    }

    // 结语
    const ca = easeOut(seg(t, 12.5, 13.5));
    if (ca > 0) {
      txt(ctx, '她的账户和你完全独立。她爆仓，不会救你。', W / 2, H - 110, {
        size: 38, weight: 'bold', color: C.gold, align: 'center', alpha: ca,
      });
    }

    const fade = seg(t, 19, 20);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 7. 洞察与技能 ---------- */
scenes.push({
  name: 'insight', dur: 16,
  draw(ctx, t) {
    bg(ctx, t);
    txt(ctx, '赢来的洞察，可以换钱，也可以变强', 120, 130, {
      size: 54, weight: 'bold', color: C.tx, alpha: easeOut(seg(t, 0, 0.8)),
    });

    /* 上：兑换 */
    const a1 = easeOut(seg(t, 0.6, 1.4));
    if (a1 > 0) {
      ctx.save(); ctx.globalAlpha = a1;
      card(ctx, 120, 240, 780, 260, { border: 'rgba(61,220,151,0.35)' });
      ctx.restore();

      // ¥ 符号代替 emoji
      ctx.save(); ctx.globalAlpha = a1;
      ctx.beginPath(); ctx.arc(186, 288, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(61,220,151,0.20)'; ctx.fill();
      ctx.strokeStyle = C.up; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      txt(ctx, '¥', 186, 297, { size: 24, weight: 'bold', color: C.up, align: 'center', alpha: a1 });
      txt(ctx, '洞察换钱', 220, 300, { size: 30, weight: 'bold', color: C.up, alpha: a1 });

      // 1 点 = 10 万
      const n = Math.floor(lerp(0, 10, easeOut(seg(t, 1.6, 3.0))));
      txt(ctx, '1', 200, 420, { size: 64, weight: 'bold', color: C.gold, alpha: a1 });
      txt(ctx, '点', 236, 420, { size: 26, color: C.tx2, alpha: a1 });
      txt(ctx, '=', 310, 420, { size: 46, color: C.tx3, alpha: a1 });
      txt(ctx, '100,000', 380, 420, {
        size: 64, weight: 'bold', color: C.up, alpha: a1,
        glow: 'rgba(61,220,151,0.5)', glowBlur: 26,
      });
      txt(ctx, '円', 690, 420, { size: 28, color: C.tx2, alpha: a1 });
      txt(ctx, '换成现金直接进钱包，不自动入金', 160, 468, { size: 22, color: C.tx3, alpha: a1 });
    }

    /* 上右：技能 */
    const a2 = easeOut(seg(t, 2.4, 3.2));
    if (a2 > 0) {
      ctx.save(); ctx.globalAlpha = a2;
      card(ctx, 940, 240, 860, 260, { border: 'rgba(255,209,102,0.3)' });
      ctx.restore();
      txt(ctx, '6 个永久技能', 980, 300, { size: 30, weight: 'bold', color: C.gold, alpha: a2 });

      const perks = [
        ['交易成本减免', C.gold], ['爆仓保险', C.up], ['情报力', C.blue],
        ['信用力', C.pink], ['利息谈判', C.purple], ['胆力', C.dn],
      ];
      perks.forEach((p, i) => {
        const a = easeOut(seg(t, 3.0 + i * 0.28, 3.5 + i * 0.28));
        if (a <= 0) return;
        const col = i % 3, row = Math.floor(i / 3);
        const bx = 980 + col * 270, by = 340 + row * 78;
        ctx.save(); ctx.globalAlpha = a * a2;
        rr(ctx, bx, by, 250, 62, 12);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();
        ctx.strokeStyle = p[1] + '55';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // 序号圆点
        ctx.beginPath(); ctx.arc(bx + 26, by + 31, 13, 0, Math.PI * 2);
        ctx.fillStyle = p[1] + '33'; ctx.fill();
        ctx.restore();
        txt(ctx, String(i + 1), bx + 26, by + 38, { size: 18, weight: 'bold', color: p[1], align: 'center', alpha: a * a2 });
        txt(ctx, p[0], bx + 50, by + 40, { size: 22, weight: 'bold', color: C.tx, alpha: a * a2 });
      });
    }

    /* 下：三条设计说明 */
    const notes = [
      ['洞察来自赢过 AI，不是充值', '竞赛优胜、对赌获胜、她的挑战达成'],
      ['换钱是最危险的选择', '它把「看穿市场的能力」变成「继续下注的本金」'],
      ['6 项全满约 105 点', '够你玩很久——也可能亏很久'],
    ];
    let ny = 610;
    notes.forEach((n, i) => {
      const a = easeOut(seg(t, 6.0 + i * 0.9, 6.6 + i * 0.9));
      if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = C.pink;
      ctx.fillRect(140, ny - 28, 4, 58);
      ctx.restore();
      txt(ctx, n[0], 164, ny, { size: 30, weight: 'bold', color: C.tx, alpha: a });
      txt(ctx, n[1], 164, ny + 36, { size: 21, color: C.tx2, alpha: a });
      ny += 104;
    });

    const fade = seg(t, 15, 16);
    if (fade > 0) { ctx.fillStyle = `rgba(5,7,12,${fade})`; ctx.fillRect(0, 0, W, H); }
  },
});

/* ---------- 8. 结尾 ---------- */
scenes.push({
  name: 'outro', dur: 14,
  draw(ctx, t) {
    bg(ctx, t);
    const cx = W / 2;

    const a1 = easeOut(seg(t, 0.3, 1.4));
    ctx.save();
    ctx.globalAlpha = a1;
    ctx.translate(cx, H * 0.30);
    ctx.scale(lerp(0.94, 1, a1), lerp(0.94, 1, a1));
    txt(ctx, 'FX戦士くるみちゃん', 0, 0, {
      size: 76, weight: 'bold', color: C.tx, align: 'center',
      glow: 'rgba(255,143,177,0.5)', glowBlur: 34,
    });
    ctx.restore();

    txt(ctx, '同人交易模拟器  ·  v1.2.0', cx, H * 0.30 + 70, {
      size: 32, color: C.pink, align: 'center', alpha: a1,
    });

    // 地址
    const a2 = easeOut(seg(t, 1.6, 2.6));
    if (a2 > 0) {
      ctx.save(); ctx.globalAlpha = a2;
      const bw = 1180, bh = 110;
      card(ctx, cx - bw / 2, H * 0.48, bw, bh, { border: 'rgba(140,180,255,0.4)', r: 18 });
      ctx.restore();
      txt(ctx, 'https://wolkenland.github.io/kurumi-fx/', cx, H * 0.48 + 68, {
        size: 40, weight: 'bold', color: C.blue, align: 'center', alpha: a2,
      });
    }

    txt(ctx, '手机浏览器打开 → 添加到主屏幕 → 就是一个 App', cx, H * 0.48 + 168, {
      size: 24, color: C.tx2, align: 'center', alpha: easeOut(seg(t, 2.4, 3.4)),
    });

    // 结束语
    const a3 = easeOut(seg(t, 4.2, 5.4));
    if (a3 > 0) {
      txt(ctx, '这个游戏里没有真钱。', cx, H * 0.68, {
        size: 34, color: C.tx2, align: 'center', alpha: a3,
      });
      txt(ctx, '但杠杆、保证金、爆仓、借钱交易的规则，是真的。', cx, H * 0.68 + 58, {
        size: 34, color: C.tx, align: 'center', alpha: a3,
      });
      txt(ctx, '如果玩完之后你觉得「这东西我再也不想碰」——', cx, H * 0.68 + 146, {
        size: 32, weight: 'bold', color: C.gold, align: 'center', alpha: a3,
      });
      txt(ctx, '那就说明这个游戏做对了。', cx, H * 0.68 + 198, {
        size: 32, weight: 'bold', color: C.gold, align: 'center', alpha: a3,
      });
    }

    txt(ctx, '非官方粉丝作品 · 全部行情为程序生成的虚构数据 · 不涉及真实资金', cx, H - 70, {
      size: 20, color: C.tx3, align: 'center', alpha: easeOut(seg(t, 5.5, 6.5)),
    });
  },
});

/* ================= 渲染主流程 ================= */
function totalDur() { return scenes.reduce((s, x) => s + x.dur, 0); }

async function render() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const total = totalDur();
  const frames = Math.round(total * FPS);

  if (!fs.existsSync(path.dirname(K_OUT()))) fs.mkdirSync(path.dirname(K_OUT()), { recursive: true });

  console.log(`→ 场景 ${scenes.length} 个，总时长 ${total}s，共 ${frames} 帧`);

  const ff = spawn(K_FF(), [
    '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    K_OUT(),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const done = new Promise((res, rej) => {
    ff.on('close', code => code === 0 ? res() : rej(new Error('ffmpeg 退出码 ' + code)));
    ff.on('error', rej);
  });

  let acc = 0;
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    // 找到当前场景
    let idx = 0, start = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (f / FPS < start + scenes[i].dur) { idx = i; break; }
      start += scenes[i].dur;
    }
    const local = f / FPS - start;
    // 清屏（每个场景自己会画背景）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    scenes[idx].draw(ctx, local, { frame: f, time: f / FPS });

    const buf = canvas.toBuffer('image/png');
    if (!ff.stdin.write(buf)) {
      await new Promise(r => ff.stdin.once('drain', r));
    }
    if (f % 60 === 0) {
      const pct = ((f / frames) * 100).toFixed(0);
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r  ${pct}%  (${f}/${frames} 帧, ${el.toFixed(0)}s)`);
    }
  }
  ff.stdin.end();
  await done;
  console.log(`\n✓ 完成：${K_OUT()}`);
  console.log(`  大小 ${(fs.statSync(K_OUT()).size / 1048576).toFixed(1)} MB`);
}

function K_OUT() {
  return process.env.OUT || path.join(path.dirname(__dirname), 'dist', 'FX战士久留美_项目介绍.mp4');
}
function K_FF() {
  return process.env.FFMPEG || '/tmp/vidtool/node_modules/ffmpeg-static/ffmpeg';
}

render().catch(e => { console.error('\n渲染失败:', e); process.exit(1); });
