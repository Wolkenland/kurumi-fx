/* ============================================================
 * 02-chart.js  蜡烛图 / 走势图 / 迷你线 绘制引擎
 * 全部基于 Canvas2D，支持高DPI，逐帧重绘
 * ============================================================ */

/* ---------- 高清画布封装 ---------- */
class Surface {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.w = 0; this.h = 0; this.dpr = 1;
    this.resize();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(40, Math.round(r.width)), h = Math.max(30, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  clear() { this.ctx.clearRect(0, 0, this.w, this.h); }
  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/* ---------- 主图表 ---------- */
class CandleChart {
  constructor(canvas, opts) {
    this.s = new Surface(canvas);
    this.o = Object.assign({
      up: (typeof Theme !== 'undefined' ? Theme.up() : '#3ddc97'),
      down: (typeof Theme !== 'undefined' ? Theme.down() : '#ff4d6d'),
      grid: 'rgba(255,255,255,0.055)',
      text: 'rgba(226,232,240,0.62)',
      textStrong: '#e2e8f0',
      accent: '#ffd166',
      showMA: true,
      priceDigits: 3,
      padTop: 16, padBottom: 20, padRight: 62, padLeft: 6,
      gap: 0.22
    }, opts || {});
    this.cam = 0;              // 摄像机：右端索引偏移（0 = 最新）
    this.pinch = 1;            // 缩放（1 = 自适应显示 maxBars 根）
    this.maxBars = 90;
    this.px = 0;               // 平滑价格显示
    this.py = 0;
    this.hover = null;         // {i, x, y}
    this.flash = 0;            // 最新价闪动
    this.shock = 0;            // 爆仓抖动
    this.liqLine = null;       // 强平价 {price} 或 null
    this.slLine = null;        // 止损/止盈线数组
    this.marker = 0;           // 持仓方向 0/1/-1
    this.entryLine = null;
    this._last = null;
  }

  /** 计算可见区间 */
  view(bars) {
    const n = bars.length;
    if (!n) return null;
    this.pinch = U.clamp(this.pinch, 0.5, 4);
    let count = Math.round(this.maxBars / this.pinch);
    count = U.clamp(count, 12, Math.max(12, n));
    let end = n - Math.round(this.cam);
    end = U.clamp(end, count, n);
    const start = Math.max(0, end - count);
    return { start, end, count: end - start };
  }

  highLow(bars, v) {
    let hi = -Infinity, lo = Infinity;
    const from = Math.max(0, v.start - 1);
    for (let i = from; i < v.end; i++) {
      if (bars[i].h > hi) hi = bars[i].h;
      if (bars[i].l < lo) lo = bars[i].l;
    }
    if (hi === -Infinity) { hi = 1; lo = 0; }

    /* 强平线 / 入场价只有在「离价格不太远」时才参与 Y 轴范围。
       否则 100 倍杠杆下强平线可能远在几十点之外，
       会把整张图压成一条直线——买入后价格走势完全看不出来。 */
    const span0 = Math.max(1e-9, hi - lo);
    const ref = this.px || hi;
    const far = (v) => v > hi ? v - hi : (v < lo ? lo - v : 0);
    /* 阈值同时看「波动跨度」和「现价的百分比」：
       取两者较大值。这样即使当天波动很小，只要强平线在现价 3% 以内
       （100 倍杠杆下已经非常危险）也会被画出来；
       而远在几十点外的强平线则交给边缘指示，不去压扁走势。 */
    const liqLimit = Math.max(span0 * 0.9, ref * 0.03);
    if (this.liqLine !== null && isFinite(this.liqLine) && far(this.liqLine) <= liqLimit) {
      hi = Math.max(hi, this.liqLine); lo = Math.min(lo, this.liqLine);
    }
    const entryLimit = Math.max(span0 * 2, ref * 0.06);
    if (this.entryLine !== null && isFinite(this.entryLine) && far(this.entryLine) <= entryLimit) {
      hi = Math.max(hi, this.entryLine); lo = Math.min(lo, this.entryLine);
    }
    const pad = (hi - lo) * 0.08 || hi * 0.002 || 0.01;
    return { hi: hi + pad, lo: lo - pad };
  }

  /** 屏幕坐标 <-> 价格 */
  makeScale(v, hl) {
    const o = this.o;
    const x0 = o.padLeft, x1 = this.s.w - o.padRight;
    const y0 = o.padTop, y1 = this.s.h - o.padBottom;
    const bw = (x1 - x0) / v.count;
    const span = hl.hi - hl.lo || 0.0001;
    return {
      x0, x1, y0, y1, bw,
      X: i => x0 + (i - v.start + 0.5) * bw,
      Y: p => y1 - (p - hl.lo) / span * (y1 - y0),
      invY: y => hl.lo + (y1 - y) / (y1 - y0) * span,
      invX: x => v.start + (x - x0) / bw - 0.5
    };
  }

  draw(bars, dt) {
    const s = this.s, o = this.o, ctx = s.ctx;
    s.clear();
    if (!bars || !bars.length) return;
    const v = this.view(bars);
    const hl = this.highLow(bars, v);
    const sc = this.makeScale(v, hl);
    const last = bars[bars.length - 1];
    this.px = this.px === 0 ? last.c : U.instDt(this.px, last.c, dt, 14);
    if (Math.abs(this.px - last.c) > (hl.hi - hl.lo) * 0.008) this.flash = Math.min(1, this.flash + 0.4);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    // ---- 网格 ----
    ctx.save();
    ctx.strokeStyle = o.grid; ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.fillStyle = o.text;
    const rows = 5;
    for (let i = 0; i <= rows; i++) {
      const y = Math.round(sc.y0 + (sc.y1 - sc.y0) * i / rows) + 0.5;
      ctx.beginPath(); ctx.moveTo(sc.x0, y); ctx.lineTo(sc.x1, y); ctx.stroke();
      const p = sc.invY(y);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(p.toFixed(o.priceDigits), sc.x1 + 5, y);
    }
    const nvl = 6;
    for (let i = 0; i <= nvl; i++) {
      const idx = Math.round(sc.invX(sc.x0 + (sc.x1 - sc.x0) * i / nvl));
      if (idx < 0 || idx >= bars.length) continue;
      const x = Math.round(sc.X(idx)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, sc.y0); ctx.lineTo(x, sc.y1); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(bars[idx].label || '', x, sc.y1 + 4);
    }
    ctx.restore();

    // ---- 价格通道（收盘价折线 + 渐变填充）----
    ctx.save();
    ctx.beginPath();
    for (let i = v.start; i < v.end; i++) {
      const x = sc.X(i), y = sc.Y(bars[i].c);
      i === v.start ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    // 最新一根接到平滑价
    ctx.lineTo(sc.X(v.end - 1), sc.Y(this.px));
    const grad = ctx.createLinearGradient(0, sc.y0, 0, sc.y1);
    const up = this.px >= bars[bars.length - 1].o;
    grad.addColorStop(0, up ? 'rgba(61,220,151,0.26)' : 'rgba(255,77,109,0.26)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.lineTo(sc.x1 - 0.5, sc.y1 - 1);
    ctx.lineTo(sc.X(v.start), sc.y1 - 1);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.restore();

    // ---- 蜡烛 ----
    const bw = Math.max(1.2, sc.bw * (1 - o.gap));
    for (let i = v.start; i < v.end; i++) {
      const b = bars[i];
      const rise = b.c >= b.o;
      const col = rise ? o.up : o.down;
      const x = sc.X(i);
      const yO = sc.Y(b.o), yC = sc.Y(b.c);
      const top = Math.min(yO, yC), bot = Math.max(yO, yC);
      const hh = Math.max(1, bot - top);
      const isLive = (i === bars.length - 1);
      ctx.globalAlpha = isLive ? 1 : 0.92;

      // 影线
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, Math.min(2, bw * 0.16));
      ctx.beginPath(); ctx.moveTo(x, sc.Y(b.h)); ctx.lineTo(x, sc.Y(b.l)); ctx.stroke();

      // 实体
      if (bw >= 3) {
        ctx.fillStyle = col;
        s.roundRect(x - bw / 2, top, bw, hh, Math.min(2, bw * 0.28));
        ctx.fill();
        if (isLive && this.flash > 0.02) {
          ctx.globalAlpha = 0.5 * this.flash;
          ctx.shadowColor = col; ctx.shadowBlur = 12;
          ctx.fill(); ctx.shadowBlur = 0;
        }
      } else {
        ctx.fillRect(x - bw / 2, top, Math.max(1, bw), hh);
      }
    }
    ctx.globalAlpha = 1;

    // ---- 均线 ----
    if (o.showMA && bars.length > 5) {
      [[5, 'rgba(255,209,102,0.85)'], [20, 'rgba(140,180,255,0.75)']].forEach(([span, col]) => {
        ctx.strokeStyle = col; ctx.lineWidth = 1.4;
        ctx.beginPath();
        let started = false;
        for (let i = Math.max(span - 1, v.start); i < v.end; i++) {
          let sum = 0;
          for (let k = i - span + 1; k <= i; k++) sum += bars[k].c;
          const x = sc.X(i), y = sc.Y(sum / span);
          started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
        }
        if (started) ctx.stroke();
      });
    }

    // ---- 入场线 / 强平线 ----
    const line = (price, col, label, dash, glow) => {
      if (price === null || !isFinite(price)) return;
      const y = sc.Y(price);
      if (y < sc.y0 - 20 || y > sc.y1 + 20) return;
      ctx.save();
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = col; ctx.lineWidth = glow ? 2 : 1.3;
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
      ctx.beginPath(); ctx.moveTo(sc.x0, y); ctx.lineTo(sc.x1, y); ctx.stroke();
      ctx.restore();
      ctx.font = 'bold 10px ui-sans-serif,system-ui,sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = col;
      s.roundRect(sc.x0 + 2, y - 14, tw, 13, 3); ctx.fill();
      ctx.fillStyle = '#0b0f16';
      ctx.fillText(label, sc.x0 + 6, y - 3);
      return y;
    };
    line(this.entryLine, 'rgba(255,255,255,0.55)', '入场', [3, 3]);
    if (this.slLine) this.slLine.forEach(sl => line(sl.price, sl.color, sl.label, [5, 4]));
    if (this.liqLine !== null && isFinite(this.liqLine)) {
      const inView = this.liqLine <= hl.hi && this.liqLine >= hl.lo;
      if (inView) {
        const shake = this.shock > 0.01 ? (Math.random() - 0.5) * this.shock * 4 : 0;
        line(this.liqLine + (sc.invY(0) - sc.invY(1)) * shake * 0, '#ff2e5b', '强平线', [], true);
      } else {
        // 远在视野之外：不撑大 Y 轴，改在最近的一侧画指示条
        const below = this.liqLine < hl.lo;
        const yEdge = below ? sc.y1 - 15 : sc.y0 + 15;
        const pct = Math.abs(this.liqLine - this.px) / this.px * 100;
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,46,91,0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sc.x0, yEdge); ctx.lineTo(sc.x1, yEdge);
        ctx.stroke();
        ctx.setLineDash([]);
        const tag = (below ? '▼ 强平 ' : '▲ 强平 ') + this.liqLine.toFixed(3) +
                    '（' + (below ? '低 ' : '高 ') + pct.toFixed(1) + '%）';
        ctx.font = '600 10px ui-monospace,SFMono-Regular,Menlo,monospace';
        const tw = ctx.measureText(tag).width + 12;
        const ty = below ? yEdge - 14 : yEdge + 4;
        ctx.fillStyle = 'rgba(255,46,91,0.92)';
        ctx.fillRect(sc.x0 + 6, ty, tw, 14);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(tag, sc.x0 + 12, ty + 10.5);
        ctx.restore();
      }
    }

    // ---- 最新价标牌 ----
    const yLast = sc.Y(this.px);
    const upNow = this.px >= (bars[bars.length - 1].o);
    const col = upNow ? o.up : o.down;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 8 * (1 + this.flash * 2);
    ctx.fillStyle = col;
    s.roundRect(sc.x1 + 2, yLast - 9, o.padRight - 6, 18, 4); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#08111c';
    ctx.font = 'bold 11px ui-monospace,SFMono-Regular,monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this.px.toFixed(o.priceDigits), sc.x1 + 6, yLast + 0.5);

    // ---- 十字光标 ----
    if (this.hover) {
      const i = U.clamp(Math.round(this.hover.i), 0, bars.length - 1);
      const b = bars[i], x = sc.X(i), y = sc.Y(b.c);
      ctx.save();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.beginPath(); ctx.moveTo(x, sc.y0); ctx.lineTo(x, sc.y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sc.x0, this.hover.y); ctx.lineTo(sc.x1, this.hover.y); ctx.stroke();
      ctx.restore();
      const txt = `${b.label} 开${b.o.toFixed(o.priceDigits)} 高${b.h.toFixed(o.priceDigits)} 低${b.l.toFixed(o.priceDigits)} 收${b.c.toFixed(o.priceDigits)}`;
      ctx.font = '10px ui-monospace,monospace';
      const w = ctx.measureText(txt).width + 10;
      ctx.fillStyle = 'rgba(8,14,24,0.92)';
      s.roundRect(sc.x0 + 3, sc.y0 + 3, Math.min(w, sc.x1 - sc.x0 - 6), 17, 4); ctx.fill();
      ctx.fillStyle = 'rgba(226,232,240,0.92)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, sc.x0 + 8, sc.y0 + 12);
    }

    // ---- 爆仓抖动 ----
    if (this.shock > 0.01) {
      const a = this.shock * 0.22;
      ctx.fillStyle = `rgba(255,46,91,${a})`;
      ctx.fillRect(0, 0, s.w, s.h);
      this.shock = Math.max(0, this.shock - dt * 1.1);
    }
  }
}

/* ---------- 迷你走势条（角色面板/摄像头用） ---------- */
function drawSparkline(canvas, values, color, fill) {
  const s = new Surface(canvas);
  const ctx = s.ctx;
  s.clear();
  if (!values || values.length < 2) return;
  let hi = -Infinity, lo = Infinity;
  for (const v of values) { if (v > hi) hi = v; if (v < lo) lo = v; }
  const span = hi - lo || 1;
  const X = i => (i / (values.length - 1)) * (s.w - 2) + 1;
  const Y = v => s.h - 2 - (v - lo) / span * (s.h - 4);
  ctx.beginPath();
  values.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.strokeStyle = color || '#ffd166'; ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round'; ctx.stroke();
  if (fill !== false) {
    ctx.lineTo(X(values.length - 1), s.h); ctx.lineTo(X(0), s.h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, s.h);
    const c = color || '#ffd166';
    g.addColorStop(0, c.replace('rgb', 'rgba').replace(')', ',0.30)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fill();
  }
}
