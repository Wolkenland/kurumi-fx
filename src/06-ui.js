/* ============================================================
 * 06-ui.js  界面层：HUD / 图表交互 / 下单 / 持仓 / 借贷 / 成长
 * ============================================================ */

/* ---------- 通用小部件 ---------- */
const $$ = (s, r) => (r || document).querySelector(s);
const $$$ = (s, r) => Array.from((r || document).querySelectorAll(s));   // 复数：返回数组
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function ripple(btn, ev) {
  if (!UI.effects) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 0.6;
  const s = el('span', 'rip');
  s.style.width = s.style.height = d + 'px';
  s.style.left = ((ev && ev.clientX ? ev.clientX - r.left : r.width / 2) - d / 2) + 'px';
  s.style.top = ((ev && ev.clientY ? ev.clientY - r.top : r.height / 2) - d / 2) + 'px';
  btn.appendChild(s);
  setTimeout(() => s.remove(), 560);
}
function bindTap(node, fn) {
  node.addEventListener('pointerdown', e => { ripple(node, e); Haptics.tap(); Sfx.click(); });
  node.addEventListener('click', e => { e.preventDefault(); fn(e); });
}
function buzzFloat(text, color, x, y) {
  if (!UI.effects) return;
  const d = el('div', 'floaty', text);
  d.style.color = color;
  d.style.left = (x - 22) + 'px';
  d.style.top = (y - 14) + 'px';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1200);
}

/* ============================================================ */
const UI = {
  core: null,
  chart: null,
  screen: 'trade',
  effects: true,
  amountWan: 1,        // 手数（万通貨）
  leverage: 10,
  amtIdx: 0,          // 默认 1 万通貨：新手不该一上来就爆仓
  lastEquity: 0,
  lastPrice: 0,
  priceSeries: [],
  dirty: {},

  init(core) {
    this.core = core;
    this.effects = core.st.settings.effects;
    // 顺序很重要：画布与各屏骨架必须先建出来，图表才能挂上去
    this.buildTabs();
    this.buildScreens();
    this.chart = new CandleChart($$('#chart'));
    this.bindChart();
    this.bindHud();
    this.lastEquity = core.equity();
    core.on(ev => this.onCore(ev));
    this.showScreen('trade');
    this.renderAll();
    Tutorials.init(core, this);
    AIUI.install(core, this);          // AI 交易员（读取本机保存的 API 配置）
    Tutorials.begin();
  },

  /* ---------- 顶部栏 ---------- */
  bindHud() {
    const c = this.core;
    $$$('#spd button').forEach(b => {
      bindTap(b, () => {
        const v = +b.dataset.v;
        c.st.speed = v;
        $$$('#spd button').forEach(x => x.classList.toggle('on', x === b));
        $$$('#tabs .ic').forEach(() => {});
        this.toast(v === 0 ? '已暂停' : '时间流速 ×' + v);
      });
    });
    // 顶栏已有 ⏸ 按钮（速度 ×0），这里只需保证初始态一致
    this.syncSpeed();
  },
  syncSpeed() {
    const cur = this.core.st.speed;
    $$$('#spd button').forEach(x => x.classList.toggle('on', +x.dataset.v === cur));
  },

  /* ---------- 底部标签 ---------- */
  buildTabs() {
    const defs = [
      { id: 'trade', ic: '📈', t: '相場' },
      { id: 'pos', ic: '💼', t: '持倉' },
      { id: 'loan', ic: '🏦', t: '借金' },
      { id: 'me', ic: '👧', t: '人物' },
      { id: 'set', ic: '⚙️', t: '設定' },
    ];
    const tabs = $$('#tabs');
    defs.forEach(d => {
      const b = el('button', '', `<span class="ic">${d.ic}</span><span>${d.t}</span>`);
      b.dataset.s = d.id;
      bindTap(b, () => this.showScreen(d.id));
      tabs.appendChild(b);
    });
  },

  showScreen(id) {
    if (this.screen === id) {
      const cur = $$('#sc-' + id);
      if (cur) {
        cur.scrollTop = 0;
        // 首次进入时 this.screen 已等于 id，必须补上可见类
        if (!cur.classList.contains('on')) requestAnimationFrame(() => cur.classList.add('on'));
      }
      return;
    }
    const old = $$('#sc-' + this.screen);
    if (old) { old.classList.remove('on'); old.classList.add('leave');
      setTimeout(() => old.classList.remove('leave'), 320); }
    this.screen = id;
    const nw = $$('#sc-' + id);
    if (nw) { nw.scrollTop = 0; requestAnimationFrame(() => nw.classList.add('on')); }
    $$$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.s === id));
    if (id === 'loan') this.renderLoans();
    if (id === 'me') this.renderMe();
    if (id === 'set') this.renderSet();
    if (id === 'pos') this.renderPositions();
    if (id === 'trade') this.renderPairTabs();
  },

  /* ---------- 构建各屏骨架 ---------- */
  assignScreenId(node, id) { node.id = id; return node; },

  buildScreens() {
    const wrap = $$('#screens');
    // 相场
    const trade = el('div', 'screen', `
      <div class="pair-tabs" id="pairTabs"></div>
      <div id="chartWrap">
        <canvas id="chart"></canvas>
        <div id="swanTag" style="display:none;position:absolute;top:7px;left:50%;transform:translateX(-50%);
          padding:3px 12px;border-radius:20px;background:rgba(255,46,91,.92);color:#fff;
          font-size:10.5px;font-weight:800;letter-spacing:.05em;pointer-events:none;
          box-shadow:0 2px 12px rgba(255,46,91,.5);z-index:5"></div>
        <div class="chart-badge">
          <span class="p" id="cpPrice">—</span>
          <span class="d" id="cpDelta">—</span>
        </div>
      </div>
      <div class="chart-tools">
        <div class="seg">
          <button data-ma="1" class="on">均线</button>
          <button data-zoom="0.55">放大</button>
          <button data-zoom="1">标准</button>
          <button data-zoom="2.2">缩小</button>
        </div>
      </div>
      <div id="tutSlot"></div>
      <div class="order">
        <div class="lev-row">
          <span class="k">杠杆</span>
          <input type="range" id="levRange" min="1" max="100" step="1" value="10">
          <span class="lev-val" id="levVal">10×</span>
        </div>
        <div class="lev-row" style="margin-top:2px">
          <span class="k">手数</span>
          <input type="range" id="amtRange" min="0" max="7" step="1" value="0">
          <span class="lev-val" id="amtVal">1万</span>
        </div>
        <div class="amt-chips" id="amtChips"></div>
        <div class="order-sum" id="orderSum"></div>
        <div class="row">
          <button class="btn btn-sell" id="btnSell">卖出 / 做空</button>
          <button class="btn btn-buy" id="btnBuy">买入 / 做多</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:7px">
          <button class="btn btn-ghost btn-sm" id="btnSl" style="flex:1">设止损</button>
          <button class="btn btn-ghost btn-sm" id="btnTp" style="flex:1">设止盈</button>
          <button class="btn btn-ghost btn-sm" id="btnMax" style="flex:1">全仓手数</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-ghost btn-sm" id="btnDeposit" style="flex:1">入金</button>
          <button class="btn btn-ghost btn-sm" id="btnWithdraw" style="flex:1">出金</button>
          <button class="btn btn-ghost btn-sm" id="btnCloseAll" style="flex:1">全平仓</button>
        </div>
      </div>
      <div class="card" style="margin-top:9px">
        <div class="card-title"><span class="dot"></span>市场快讯<span class="right" id="newsCount"></span></div>
        <div id="newsList"></div>
      </div>
    `);
    wrap.appendChild(this.assignScreenId(trade, 'sc-trade'));

    // 持仓
    const pos = el('div', 'screen', `
      <div class="h1">持仓<small>POSITION</small></div>
      <div class="grid3" id="posSummary" style="margin-bottom:10px"></div>
      <div id="posList"></div>
    `);
    wrap.appendChild(this.assignScreenId(pos, 'sc-pos'));

    // 借贷
    const loan = el('div', 'screen', `
      <div class="h1">借贷<small>DEBT · 这可能是本作最重要的系统</small></div>
      <div class="card" id="debtOverview"></div>
      <div id="loanList"></div>
      <div class="card">
        <div class="card-title"><span class="dot"></span>借贷小课堂</div>
        <div style="font-size:11.5px;line-height:1.72;color:var(--tx2)">
          借钱本身不会让你破产，<b style="color:var(--gold)">杠杆 + 借钱</b>才会。<br>
          · 利息按<b>日</b>累积，年利 109% 意味着每天约 <b>0.3%</b>——30 天吃掉 9%，一年吃掉一倍。<br>
          · 借来的钱是<b>负债</b>，不计入净值；你赚的钱要先还债才算真正属于你。<br>
          · 强制平仓只清算保证金账户，<b>债务不会消失</b>。这正是久留美和芽吹的结局。
        </div>
      </div>
    `);
    wrap.appendChild(this.assignScreenId(loan, 'sc-loan'));

    // 人物 / 剧情
    const me = el('div', 'screen', `
      <div class="h1">人物 & 成长<small>STATUS</small></div>
      <div class="card" id="growthCard"></div>
      <div class="card">
        <div class="card-title"><span class="dot"></span>目标</div>
        <div id="goalList"></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="dot"></span>登场人物</div>
        <div id="charaList"></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="dot"></span>交易记录<span class="right" id="closedCount"></span></div>
        <div id="closedList"></div>
      </div>
    `);
    wrap.appendChild(this.assignScreenId(me, 'sc-me'));

    // 设定
    const set = el('div', 'screen', `
      <div class="h1">设定 & 资料<small>SETTINGS</small></div>
      <div class="card" id="setCard"></div>
      <div class="card">
        <div class="card-title"><span class="dot"></span>FX 用语词典<span class="right">不懂就查</span></div>
        <div id="glossary"></div>
      </div>
      <div class="card" id="aboutCard"></div>
    `);
    wrap.appendChild(this.assignScreenId(set, 'sc-set'));

    this.bindTrade();
    this.buildAmtChips();
    this.renderGlossary();
  },

  /* ---------- 相场屏绑定 ---------- */
  bindTrade() {
    const c = this.core;
    // 杠杆
    const lr = $$('#levRange');
    lr.addEventListener('input', () => { this.leverage = +lr.value; this.updateOrder(); });
    lr.addEventListener('change', () => { Haptics.tap(); this.updateOrder(); });
    const ar = $$('#amtRange');
    ar.addEventListener('input', () => { this.amtIdx = +ar.value; this.updateOrder(); });
    ar.addEventListener('change', () => { Haptics.tap(); this.updateOrder(); });
    // 手数快捷
    // 交易按钮
    $$('#btnBuy').addEventListener('pointerdown', e => ripple($$('#btnBuy'), e));
    $$('#btnSell').addEventListener('pointerdown', e => ripple($$('#btnSell'), e));
    bindTap($$('#btnBuy'), () => this.doOpen(1));
    bindTap($$('#btnSell'), () => this.doOpen(-1));
    bindTap($$('#btnSl'), () => this.promptSLTP('sl'));
    bindTap($$('#btnTp'), () => this.promptSLTP('tp'));
    bindTap($$('#btnMax'), () => {
      const mx = this.maxUnits();
      this.amtIdx = this.idxFromUnits(mx);
      $$('#amtRange').value = this.amtIdx;
      this.updateOrder(); this.toast('已按可用保证金算出最大手数');
    });
    bindTap($$('#btnDeposit'), () => this.promptDeposit());
    bindTap($$('#btnWithdraw'), () => this.promptWithdraw());
    bindTap($$('#btnCloseAll'), () => {
      if (!c.hasPosition()) return this.toast('现在没有持仓');
      Confirm.ask('全部平仓', `将平掉 ${c.st.positions.length} 笔持仓，立刻按市价结算。`, '全部平仓', () => {
        const pnl = c.closeAll('manual');
        this.toast(`已全部平仓 ${U.sfmt(pnl)} 円`);
        this.renderAll();
      });
    });
  },

  buildAmtChips() {
    const box = $$('#amtChips');
    const list = [
      { l: '1万', v: 1 }, { l: '5万', v: 5 }, { l: '10万', v: 10 }, { l: '50万', v: 50 },
    ];
    list.forEach((it, i) => {
      const b = el('button', '', it.l);
      b.dataset.v = it.v;
      bindTap(b, () => {
        this.manUnits = it.v * 10000;
        this.amtIdx = -1;
        $$$('#amtChips button').forEach(x => x.classList.toggle('on', x === b));
        $$('#amtRange').value = 1;
        this.updateOrder();
      });
      if (i === 0) b.classList.add('on');
      box.appendChild(b);
    });
  },
  get manUnits() { return this._man || 10000; },
  set manUnits(v) { this._man = v; },

  /** 滑块档位 -> 通貨量 */
  unitsFromIdx(i) {
    const table = [10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];
    return table[U.clamp(i, 0, table.length - 1)];
  },
  idxFromUnits(u) {
    const table = [10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];
    let best = 0, bd = Infinity;
    table.forEach((t, i) => { const d = Math.abs(t - u); if (d < bd) { bd = d; best = i; } });
    return best;
  },
  currentUnits() { return this.amtIdx < 0 ? this.manUnits : this.unitsFromIdx(this.amtIdx); },

  maxUnits() {
    const s = this.core.market.pair();
    const perUnit = s.ask() / this.leverage;
    const can = Math.floor(this.core.st.cash / perUnit);
    return Math.max(1, Math.min(2000000, can));
  },

  /** 风险等级 1..4 */
  riskLevel() {
    const u = this.currentUnits(), lev = this.leverage;
    const s = this.core.market.pair();
    const margin = u * s.ask() / lev;
    const cash = this.core.st.cash;
    const ratio = cash > 0 ? margin / cash : 9;
    let r = ratio < 0.1 ? 1 : ratio < 0.3 ? 2 : ratio < 0.6 ? 3 : 4;
    if (lev >= 50) r = Math.max(r, 3);
    if (lev >= 100) r = 4;
    // 有两种死法：杠杆太高，或手数太大（保证金吃掉全部缓冲）
    if (ratio > 0.5) r = 4;
    return r;
  },

  updateOrder() {
    const s = this.core.market.pair();
    const u = this.currentUnits(), lev = this.leverage;
    const margin = u * s.ask() / lev;
    const pipVal = u * s.def.pip;                 // 1pip 的损益
    const span = s.price * 0.01;                  // 波动1%的损益
    const kr = this.riskLevel();
    $$('#levVal').textContent = lev + '×';
    $$('#levVal').classList.toggle('hot', lev >= 25);
    $$('#amtVal').textContent = u >= 10000 ? (u / 10000) + '万' : u;
    $$('#orderSum').innerHTML = `
      <div class="l">必要保证金</div><div class="r mono">${U.fmt(Math.ceil(margin))} 円</div>
      <div class="l">可用保证金</div><div class="r mono">${U.fmt(Math.floor(this.core.freeMargin()))} 円</div>
      <div class="l">1 pip 盈亏</div><div class="r mono">${U.sfmt(pipVal, 0)} 円</div>
      <div class="l">汇率波动 1%</div><div class="r mono">${U.sfmt(span * u, 0)} 円</div>
      <div class="l">爆仓价距离</div><div class="r mono" id="liqDist">—</div>
      <div class="l">风险评级</div><div class="r"><span class="risk-tag risk-${kr}">${['稳健', '普通', '危险', '自杀式'][kr - 1]}</span></div>
    `;
    // 爆仓价：假设这一单成交后，站在新净值下反推强平价
    const liqEl = $$('#liqDist');
    if (liqEl) {
      const afterEq = this.core.equity();
      const afterMargin = this.core.usedMargin() + margin;
      this.core._previewDir = 1;
      const lp = this.core.liqPriceFor(s.def.id, afterEq, afterMargin, u);
      if (lp === null) { liqEl.textContent = '—'; }
      else {
        const move = Math.abs(s.price - lp);
        const pips = move / s.def.pip;
        if (pips <= 0.5) { liqEl.textContent = '开仓即爆（手数过大）'; }
        else liqEl.textContent = `约 ${U.fmt(pips, 1)} pips（${(move / s.price * 100).toFixed(2)}%）`;
        liqEl.style.color = pips <= 0.5 ? 'var(--dn)' : pips < 40 ? 'var(--dn)' : pips < 150 ? 'var(--gold)' : 'var(--tx)';
      }
    }
    // 图上强平线（已持仓时的真实强平价）
    this.chart.liqLine = this.core.hasPosition() ? this.core.liqPriceFor(s.def.id) : null;
    this.chart.o.showMA = !!this.core.st.settings.ma;
  },

  doOpen(dir) {
    const c = this.core;
    const pid = c.market.active;
    const u = this.currentUnits();
    c._previewDir = dir;
    const r = c.open(pid, dir, u, this.leverage);
    if (!r.ok) { this.toast(r.why, 'dn'); Sfx.error(); return; }
    const s = c.market.pair(pid);
    this.toast(`${s.def.short} ${dir > 0 ? '做多' : '做空'} ${U.fmt(u)}通貨 ×${this.leverage}`, dir > 0 ? 'up' : 'dn');
    const btn = $$(dir > 0 ? '#btnBuy' : '#btnSell');
    const r0 = btn.getBoundingClientRect();
    buzzFloat((dir > 0 ? '+' : '') + U.fmt(u) + '通貨', dir > 0 ? '#3ddc97' : '#ff4d6d',
      r0.left + r0.width / 2, r0.top - 6);
    if ($$('#tabs button[data-s="pos"]')) this.badge('pos', c.st.positions.length);
    this.renderAll();
    FX.pulse(dir > 0 ? '#3ddc97' : '#ff4d6d');
    Chapters.check();
  },

  promptSLTP(kind) {
    const c = this.core;
    if (!c.hasPosition()) return this.toast('先有持仓才能设价位');
    const s = c.market.pair();
    const def = kind === 'sl' ? (c.st.positions[0].dir > 0 ? s.bid() * 0.99 : s.bid() * 1.01)
                              : (c.st.positions[0].dir > 0 ? s.bid() * 1.02 : s.bid() * 0.98);
    Sheets.number(kind === 'sl' ? '设置止损线' : '设置止盈线',
      kind === 'sl'
        ? '市价触及这条线就自动平仓，锁住最大亏损。<b style="color:var(--gold)">这是散户唯一真正有效的风控。</b>'
        : '到达目标就落袋为安。难的不是设，是到了之后真的按下去。',
      def, kind === 'sl' ? '止损价' : '止盈价', 3, (v) => {
        c.st.positions.forEach(p => { p[kind] = v; });
        this.toast(`已把 ${c.st.positions.length} 笔持仓的${kind === 'sl' ? '止损' : '止盈'}设为 ${v}`);
      });
  },

  promptDeposit() {
    const c = this.core;
    Sheets.number('入金到交易账户', `手上可入金：<b class="mono">${U.fmt(c.st.wallet)} 円</b>。<br>入金后这笔钱成为<b>保证金</b>，可以承受亏损，也可能亏光。`, Math.max(10000, Math.floor(c.st.wallet)), '金额（円）', 0, (v) => {
      const r = c.deposit(v, true);
      if (!r.ok) return this.toast(r.why, 'dn');
      this.toast(`已入金 ${U.fmt(v)} 円`, 'up'); this.renderAll();
    });
  },
  promptWithdraw() {
    const c = this.core;
    Sheets.number('出金', `可用保证金：<b class="mono">${U.fmt(c.st.cash)} 円</b>。<br>出金是<b>唯一</b>能把浮盈变成真钱的动作。`, Math.floor(c.st.cash / 2), '金额（円）', 0, (v) => {
      const r = c.withdraw(v);
      if (!r.ok) return this.toast(r.why, 'dn');
      this.toast(`已出金 ${U.fmt(v)} 円`, 'up'); this.renderAll();
    });
  },

  /* ---------- 图交互 ---------- */
  bindChart() {
    const cv = $$('#chart'), ch = this.chart;
    let drag = null, pinch = null, lastTapT = 0;
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    cv.addEventListener('pointerdown', e => {
      try { if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); } catch (err) {}
      const p = local(e);
      drag = { x: p.x, cam: ch.cam, moved: false };
      ch.hover = { i: 0, x: p.x, y: p.y };
    });
    cv.addEventListener('pointermove', e => {
      const p = local(e);
      if (drag) {
        const dx = p.x - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        // 拖动平移：每根宽度
        const bars = this.core.market.pair().view();
        const v = ch.view(bars);
        const perBar = (ch.s.w - ch.o.padLeft - ch.o.padRight) / v.count;
        ch.cam = U.clamp(drag.cam + dx / perBar, 0, Math.max(0, bars.length - 12));
        ch.hover = null;
      } else {
        const bars = this.core.market.pair().view();
        const v = ch.view(bars), hl = ch.highLow(bars, v), sc = ch.makeScale(v, hl);
        ch.hover = { i: sc.invX(p.x), x: p.x, y: p.y };
      }
    });
    const end = (e) => {
      const now = Date.now();
      if (drag && !drag.moved) {
        if (now - lastTapT < 300) { ch.pinch = 1; ch.cam = 0; }   // 双击复位
        lastTapT = now;
      }
      drag = null;
      setTimeout(() => { ch.hover = null; }, 2200);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        pinch = { d, p: ch.pinch };
      }
    }, { passive: true });
    cv.addEventListener('touchmove', e => {
      if (pinch && e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        ch.pinch = U.clamp(pinch.p * (d / pinch.d), 0.5, 4);
      }
    }, { passive: true });
    cv.addEventListener('touchend', () => { pinch = null; });

    // 图表工具
    $$$('.chart-tools .seg button').forEach(b => {
      bindTap(b, () => {
        if (b.dataset.ma) {
          const on = b.classList.toggle('on');
          this.core.st.settings.ma = on;
          this.chart.o.showMA = on;
          return;
        }
        const z = +b.dataset.zoom;
        this.chart.pinch = 1 / z;
        this.chart.cam = 0;
      });
    });
  },

  renderPairTabs() {
    const box = $$('#pairTabs');
    if (box.childElementCount) {
      $$$('button', box).forEach(b => b.classList.toggle('on', b.dataset.p === this.core.market.active));
      return;
    }
    PAIR_ORDER.forEach(id => {
      const d = PAIRS[id];
      const b = el('button', 'pair-tab', `<span style="color:${d.color}">${d.icon}</span> ${d.short}`);
      b.dataset.p = id;
      if (id === this.core.market.active) b.classList.add('on');
      bindTap(b, () => {
        this.core.market.active = id;
        this.chart.cam = 0; this.chart.pinch = 1;
        this.priceSeries = [];
        this.renderPairTabs();
        this.updateOrder();
      });
      box.appendChild(b);
    });
  },

  /* ---------- 每帧 ---------- */
  frame(dt) {
    const c = this.core;
    const s = c.market.pair();
    const bars = s.view();
    if (this.screen === 'trade') {
      this.chart.liqLine = c.liqPriceFor(s.def.id);
      this.chart.draw(bars, dt);
    }
    this.syncHud(dt);
    if (this.screen === 'pos') this.syncPositions();
    if (this.screen === 'trade') this.syncQuote(s);
  },

  syncHud(dt) {
    const c = this.core;
    const eq = c.equity();
    const ev = $$('#equityVal');
    ev.textContent = U.fmt(eq);
    const d = eq - this.lastEquity;
    if (Math.abs(d) > 1) {
      ev.classList.remove('flash-up', 'flash-dn');
      void ev.offsetWidth;
      ev.classList.add(d > 0 ? 'flash-up' : 'flash-dn');
      this.lastEquity = eq;
    }
    const u = c.unrealizedAll();
    $$('#eqDelta').textContent = U.sfmt(u) + ' 円';
    $$('#eqDelta').className = 'mono ' + (u > 0 ? 'tick-up' : u < 0 ? 'tick-dn' : '');
    // 可用保证金 = 净值 − 必要保证金（之前错显示成账户余额 cash，会误导玩家）
    const free = c.freeMargin();
    const freeEl = $$('#hudCash');
    freeEl.textContent = U.fmt(free);
    freeEl.className = 'v mono' + (free < 0 ? ' tick-dn' : '');
    $$('#hudMargin').textContent = U.fmt(c.usedMargin());
    const rate = c.marginRate();
    $$('#hudRate').textContent = isFinite(rate) ? rate.toFixed(0) + '%' : '—';
    $$('#hudRate').className = 'v mono' + (rate < 150 ? ' tick-dn' : '');
    $$('#hudLoan').textContent = U.fmt(c.totalLoan());
    $$('#hudLoan').className = 'v mono' + (c.totalLoan() > 0 ? ' tick-dn' : '');
    // 保证金率条
    const bar = $$('#marginBar i');
    const pct = U.clamp(isFinite(rate) ? (rate - 50) / 250 * 100 : 0, 0, 100);
    bar.style.width = pct + '%';
    bar.style.background = rate < 100 ? 'var(--dn)' : rate < 200 ? 'var(--gold)' : 'var(--up)';
    $$('#hudDate').textContent = this.dateText();

    // 黑天鹅警示条
    const swTag = $$('#swanTag');
    if (swTag) {
      const sw = c.market.swan;
      if (sw) {
        swTag.style.display = 'block';
        swTag.textContent = '⚡ ' + sw.ev.name + '　点差 ' + sw.spreadMul + '×';
      } else {
        swTag.style.display = 'none';
      }
    }

    // 「入金」按钮直接显示钱包里还有多少钱（之前要点了才知道）
    const dep = $$('#btnDeposit');
    if (dep) {
      const w = c.st.wallet;
      if (w >= 1) {
        dep.textContent = `入金 · 钱包 ${U.yenShort(w)}`;
        dep.classList.add('btn-gold');
        dep.classList.remove('btn-ghost');
      } else {
        dep.textContent = '入金';
        dep.classList.remove('btn-gold');
        dep.classList.add('btn-ghost');
      }
    }

    const mc = c.marginCall;
    if (mc && !this._mcShown) {
      this._mcShown = true;
      FX.alert('追証発生', `保证金率 ${mc.rate.toFixed(0)}% —— 再不处理就要被强平`, 'warn');
      Camera.shake();
    }
    if (!mc) this._mcShown = false;
  },

  dateText() {
    const d = this.core.st.date;
    const dt = U.addDays(2021, 4, 5, d.day);
    return `${dt.y}/${dt.m}/${dt.d}(${U.WEEK[dt.w]}) ${U.pad2(Math.floor(this.core.st.date.tick / TICKS_PER_BAR * 8 + 9))}:00`;
  },

  syncQuote(s) {
    const last = s.bars.length ? s.bars[s.bars.length - 1] : null;
    const p = s.price;
    $$('#cpPrice').textContent = p.toFixed(s.def.digits);
    const up = this.lastPrice ? p >= this.lastPrice : true;
    $$('#cpPrice').className = 'p mono ' + (this.lastPrice ? (up ? 'tick-up' : 'tick-dn') : '');
    const o = last ? last.o : p;
    const dd = (p - o) / o * 100;
    const ddPips = (p - o) / s.def.pip;
    $$('#cpDelta').textContent = `${U.sfmt(ddPips, 1)} pips (${U.sfmt(dd, 2)}%)`;
    $$('#cpDelta').className = 'd mono ' + (dd >= 0 ? 'tick-up' : 'tick-dn');
    this.lastPrice = p;
    $$('#hudPair').textContent = s.def.short;
    $$('#hudPair').style.color = s.def.color;
  },

  /* ---------- 事件 → 界面 ---------- */
  onCore(ev) {
    const c = this.core;
    switch (ev.type) {
      case 'frame': this.frame(ev.dt); break;
      case 'news': {
        this.renderNews();
        if (this.screen === 'trade') FX.newsTicker(ev.news.t);
        break;
      }
      case 'gap': this.toast('週明けギャップ！开盘跳空', 'dn'); break;
      case 'crash': FX.alert('暴落', 'フラッシュクラッシュ', 'bad'); Camera.shake(); break;
      case 'scripted': this.toast('行情突然反转……', 'dn'); break;
      case 'margincall': break;
      case 'liquidateBegin': FX.alert('強制ロスカット', '维持率 50% 割れ', 'bad'); Camera.shake(); break;
      case 'liquidated': {
        const total = ev.recs.reduce((a, r) => a + r.pnl, 0);
        setTimeout(() => {
          Sheets.result('強制ロスカット', total, `追踪保证金耗尽，${ev.recs.length} 笔持仓被强制平仓。`, 'bad');
        }, 900);
        this.renderPositions();
        break;
      }
      case 'swap': {
        if (Math.abs(ev.amount) > 500) this.toast(`スワップ ${U.sfmt(ev.amount)} 円${ev.mult > 1 ? '（3倍日）' : ''}`,
          ev.amount >= 0 ? 'up' : 'dn');
        break;
      }
      case 'collect': {
        setTimeout(() => Sheets.msg('取立て', `【${ev.def.name}】的催收来了。<br>当前负债 <b class="mono" style="color:var(--dn)">${U.fmt(ev.amount)} 円</b>。<br>${ev.def.danger >= 4 ? '「再不还，就不是钱的问题了。」' : '「还款日到了哦。」'}`, ev.def.danger >= 4 ? 'bad' : 'warn'), 400);
        break;
      }
      case 'blackswan': {
        const sw = ev;
        const rows = (sw.hit || []).map(h =>
          `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px">
            <span style="color:${PAIRS[h.id].color}">${PAIRS[h.id].short}</span>
            <span class="mono" style="color:var(--dn);font-weight:700">${h.pct >= 0 ? '+' : ''}${h.pct.toFixed(1)}%</span>
          </div>`).join('');
        setTimeout(() => Sheets.msg('⚡ 黑天鹅',
          `<div style="font-size:13px;font-weight:700;color:var(--dn);line-height:1.6">${sw.ev.head}</div>
           <div style="margin:9px 0">${rows}</div>
           <div style="font-size:11px;color:var(--tx2);line-height:1.7">${sw.ev.desc}</div>
           <div style="margin-top:9px;padding:8px 10px;border-radius:9px;background:rgba(255,77,109,.12);
             border:1px solid rgba(255,77,109,.3);font-size:11.5px">
             点差扩大 <b style="color:var(--dn)">${sw.spreadMul} 倍</b>，持续约 ${Math.round((sw.ev.dur || 40) / 24)} 天。<br>
             <span style="color:var(--tx3)">这时候挂止损单，可能直接被打在异常价位上。</span>
           </div>`, 'bad'), 300);
        break;
      }
      case 'ending': {
        const e = ev.ending;
        setTimeout(() => this.showEnding(e), 500);
        break;
      }
      case 'daily': {
        const list = ev.list || [];
        if (list.length) {
          const names = list.map(x => x.def.name).join('、');
          const pts = list.reduce((a, x) => a + x.pts, 0);
          this.toast(`📋 每日任务：${names}　+${pts} 洞察`, 'up');
          Sfx.coin();
        }
        break;
      }
      case 'achievement': {
        const list = ev.list || [];
        if (list.length) {
          const names = list.map(a => a.name).join('、');
          const pts = list.reduce((a, x) => a + x.pts, 0);
          this.toast(`🏆 成就解锁：${names}　+${pts} 洞察`, 'up');
          Sfx.bigwin();
        }
        break;
      }
      case 'levelup': {
        Sfx.bigwin();
        Sheets.msg('LEVEL UP',
          `交易者等级提升到 <b style="color:var(--gold)">Lv.${ev.level}</b><br>
           <div style="margin-top:10px;padding:9px 11px;border-radius:10px;
             background:rgba(255,209,102,.10);border:1px solid rgba(255,209,102,.3);
             font-size:12px;line-height:1.7">
             🎁 获得 <b style="color:var(--gold)">${ev.gained || 1} 点洞察</b>（可换 10 万，或买永久技能）<br>
             
             <span style="font-size:11px;color:var(--tx2)">强平线已降至 ${this.core.liqThreshold().toFixed(1)}%</span>
           </div>
           <div style="font-size:11px;color:var(--tx3);margin-top:6px">${ev.why || '经验来自每一次真实的盈亏。'}</div>`);
        break;
      }
      case 'bark': FX.bark(ev.who, ev.line); break;
      case 'newday': this.renderLite(); break;
      case 'open': case 'close': case 'borrow': case 'repay':
        this.renderLite(); this.saveTick(); break;
    }
  },
  saveTick() { clearTimeout(this._sv); this._sv = setTimeout(() => this.core.save(), 400); },

  renderLite() {
    const c = this.core;
    const b = $$('#tabs button[data-s="pos"]');
    if (b) this.badge('pos', c.st.positions.length);
    if (this.screen === 'trade') this.renderNews();
    if (this.screen === 'me') this.renderMe();
    if (this.screen === 'loan') this.renderLoans();
  },

  badge(tabId, n) {
    const b = $$(`#tabs button[data-s="${tabId}"]`);
    if (!b) return;
    let bd = $('.badge', b);
    if (n <= 0) { if (bd) bd.remove(); return; }
    if (!bd) { bd = el('span', 'badge'); b.appendChild(bd); }
    bd.textContent = n > 99 ? '99+' : n;
  },

  toast(text, kind) {
    const t = el('div', '', text);
    t.style.cssText = `position:fixed;left:50%;top:calc(var(--safe-t) + 92px);transform:translateX(-50%);
      z-index:180;padding:8px 15px;border-radius:20px;font-size:12.5px;font-weight:700;
      background:${kind === 'dn' ? 'rgba(120,20,44,.94)' : kind === 'up' ? 'rgba(16,90,64,.94)' : 'rgba(24,32,48,.94)'};
      border:1px solid ${kind === 'dn' ? 'rgba(255,77,109,.5)' : kind === 'up' ? 'rgba(61,220,151,.5)' : 'rgba(255,255,255,.16)'};
      box-shadow:0 10px 30px rgba(0,0,0,.55);color:#fff;white-space:nowrap;max-width:88vw;overflow:hidden;text-overflow:ellipsis;
      animation:toastIn .3s cubic-bezier(.16,1,.3,1)`;
    const st = document.createElement('style');
    st.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(-14px) scale(.92)}to{opacity:1;transform:translateX(-50%)}}';
    document.head.appendChild(st);
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'all .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(-10px)';
      setTimeout(() => { t.remove(); st.remove(); }, 320); }, 1700);
  },

  /* ---------- 持仓屏 ---------- */
  renderPositions() {
    const c = this.core;
    const box = $$('#posList');
    if (!box) return;
    const sum = $$('#posSummary');
    const u = c.unrealizedAll();
    sum.innerHTML = `
      <div class="hud-cell"><div class="k">浮动盈亏</div><div class="v mono ${u >= 0 ? 'tick-up' : 'tick-dn'}">${U.sfmt(u)}</div></div>
      <div class="hud-cell"><div class="k">必要保证金</div><div class="v mono">${U.fmt(c.usedMargin())}</div></div>
      <div class="hud-cell"><div class="k">维持率</div><div class="v mono">${isFinite(c.marginRate()) ? c.marginRate().toFixed(0) + '%' : '—'}</div></div>`;
    if (!c.st.positions.length) {
      box.innerHTML = `<div class="empty"><span class="big">🕳️</span>现在没有持仓。<br>去「相場」下一单吧。</div>`;
      return;
    }
    box.innerHTML = '';
    for (const p of c.st.positions) {
      const s = c.market.pair(p.pid);
      const pnl = c.unrealized(p);
      const pips = (c.evalPrice(p) - p.entry) * p.dir / s.def.pip;
      const margin = p.units * (p.entry / p.lev);
      const lossPct = U.clamp(-pnl / (margin * c.liqThreshold() / 100) * 100, 0, 100);
      const node = el('div', 'pos ' + (p.dir > 0 ? 'long' : 'short'), `
        <div class="pos-head">
          <span class="pair" style="color:${s.def.color}">${s.def.short}</span>
          <span class="dir-tag ${p.dir > 0 ? 'long' : 'short'}">${p.dir > 0 ? 'LONG' : 'SHORT'}</span>
          <span class="tag">${p.lev}×</span>
          <span class="pos-pnl mono ${pnl >= 0 ? 'tick-up' : 'tick-dn'}">${U.sfmt(pnl)}</span>
        </div>
        <div class="pos-grid">
          <div><div class="k">建値</div><div class="v mono">${p.entry.toFixed(s.def.digits)}</div></div>
          <div><div class="k">現値</div><div class="v mono">${c.evalPrice(p).toFixed(s.def.digits)}</div></div>
          <div><div class="k">数量</div><div class="v mono">${U.fmt(p.units)}</div></div>
          <div><div class="k">pips</div><div class="v mono">${U.sfmt(pips, 1)}</div></div>
        </div>
        <div class="pos-bar"><i style="width:${lossPct}%"></i></div>
        <div style="font-size:10px;color:var(--tx3);margin-top:3px">强平进度 ${lossPct.toFixed(0)}%　保证金 ${U.fmt(margin)} 円</div>
      `);
      const acts = el('div', 'pos-actions',
        `${p.sl ? `<span class="tag dn">SL ${p.sl}</span>` : ''}${p.tp ? `<span class="tag up">TP ${p.tp}</span>` : ''}`);
      const cs = el('button', 'btn btn-ghost btn-sm', '结算全部');
      bindTap(cs, () => {
        const r = c.close(p.id, p.units);
        if (r.ok) {
          this.toast(`${s.def.short} 平仓 ${U.sfmt(r.pnl)} 円`, r.pnl >= 0 ? 'up' : 'dn');
          buzzFloat(U.sfmt(r.pnl), r.pnl >= 0 ? '#3ddc97' : '#ff4d6d', window.innerWidth - 70, 190);
        }
        this.renderPositions();
      });
      acts.appendChild(cs);
      const cf = el('button', 'btn btn-danger btn-sm', '一半平仓');
      bindTap(cf, () => {
        const r = c.close(p.id, Math.floor(p.units / 2));
        if (r.ok) this.toast(`平掉一半 ${U.sfmt(r.pnl)} 円`, r.pnl >= 0 ? 'up' : 'dn');
        this.renderPositions();
      });
      acts.appendChild(cf);
      node.appendChild(acts);
      box.appendChild(node);
    }
  },

  syncPositions() {
    // 轻量刷新：只改数字（避免重建导致动画抖动）
    const c = this.core;
    const box = $$('#posList');
    if (!box) return;
    const nodes = $$$('.pos', box);
    if (nodes.length !== c.st.positions.length) { this.renderPositions(); return; }
    c.st.positions.forEach((p, i) => {
      const n = nodes[i]; if (!n) return;
      const s = c.market.pair(p.pid);
      const pnl = c.unrealized(p);
      const el2 = $('.pos-pnl', n);
      el2.textContent = U.sfmt(pnl);
      el2.className = 'pos-pnl mono ' + (pnl >= 0 ? 'tick-up' : 'tick-dn');
      const g = $$$('.pos-grid .v', n);
      if (g[1]) g[1].textContent = c.evalPrice(p).toFixed(s.def.digits);
      if (g[3]) g[3].textContent = U.sfmt((c.evalPrice(p) - p.entry) * p.dir / s.def.pip, 1);
      const margin = p.units * (p.entry / p.lev);
      const lossPct = U.clamp(-pnl / (margin * c.liqThreshold() / 100) * 100, 0, 100);
      const bar = $('.pos-bar i', n);
      if (bar) bar.style.width = lossPct + '%';
    });
  },

  /* ---------- 借贷屏 ---------- */
  renderLoans() {
    const c = this.core;
    const box = $$('#loanList');
    if (!box) return;
    const tot = c.totalLoan();
    const offers = c.loanOffers();
    const dailyRate = c.st.loans.reduce((a, l) => {
      const d = LOAN_PRODUCTS.find(x => x.id === l.pid); return a + l.amount * d.rate / 365;
    }, 0);
    const days = dailyRate > 0 ? Math.ceil(tot / dailyRate) : Infinity;
    $$('#debtOverview').innerHTML = `
      <div class="card-title"><span class="dot" style="background:var(--dn)"></span>负债总览</div>
      <div class="kv"><span class="k">借款总额</span><span class="v mono ${tot > 0 ? 'tick-dn' : ''}">${U.fmt(tot)} 円</span></div>
      <div class="kv"><span class="k">每日利息</span><span class="v mono">${dailyRate > 0 ? U.fmt(dailyRate, 1) + ' 円' : '0 円'}</span></div>
      <div class="kv"><span class="k">净值（含负债）</span><span class="v mono">${U.fmt(c.netAsset())} 円</span></div>
      <div class="kv"><span class="k">按当前利息</span><span class="v" style="color:${days < 60 ? 'var(--dn)' : days < 200 ? 'var(--gold)' : 'var(--up)'}">
        ${tot <= 0 ? '无负债' : `约 ${days} 天翻一倍`}</span></div>
      ${tot > 0 ? `<div style="margin-top:9px;font-size:11.5px;color:var(--tx2);line-height:1.65">
        你目前有 <b class="mono">${c.st.loans.length}</b> 笔借款。
        ${tot > c.st.cash ? '<br><b class="tick-dn">注意：负债已经超过你的保证金了。</b>' : ''}
      </div>` : ''}`;

    box.innerHTML = '';
    // 已借的
    if (c.st.loans.length) {
      const h = el('div', 'h1', `未还借款<small>OUTSTANDING</small>`);
      h.style.fontSize = '15px'; h.style.marginTop = '12px';
      box.appendChild(h);
      const byPid = {};
      c.st.loans.forEach(l => { byPid[l.pid] = (byPid[l.pid] || 0) + l.amount; });
      for (const pid in byPid) {
        const def = LOAN_PRODUCTS.find(x => x.id === pid);
        const amt = byPid[pid];
        const node = el('div', 'loan-card');
        node.innerHTML = `
          <div class="bar" style="background:${def.color}"></div>
          <div class="loan-h"><span class="nm">${def.name}</span>
            <span class="rt mono debt-fire" style="color:${def.color}">${U.fmt(amt)}</span></div>
          <div class="loan-desc">年利 ${(def.rate * 100).toFixed(1)}% ・ 每日利息约 <b class="mono">${U.fmt(amt * def.rate / 365, 1)}</b> 円</div>
          <div class="loan-meter"><i style="width:${U.clamp(amt / c.loanLimit(def) * 100, 0, 100)}%;background:${def.color}"></i></div>
          <div class="loan-meta"><span>上限 ${U.fmt(c.loanLimit(def))}</span><span>已用 ${(amt / c.loanLimit(def) * 100).toFixed(0)}%</span></div>`;
        const acts = el('div', 'pos-actions');
        const b1 = el('button', 'btn btn-gold btn-sm', '还清这笔');
        bindTap(b1, () => {
          const r = c.repay(pid, amt);
          if (!r.ok) return this.toast(r.why, 'dn');
          this.toast(`已还 ${U.fmt(r.paid)} 円`, 'up');
          Sfx.coin(); this.renderLoans(); this.renderLite();
        });
        const b2 = el('button', 'btn btn-ghost btn-sm', '还一半');
        bindTap(b2, () => {
          const r = c.repay(pid, amt / 2);
          if (!r.ok) return this.toast(r.why, 'dn');
          this.toast(`已还 ${U.fmt(r.paid)} 円`, 'up'); this.renderLoans(); this.renderLite();
        });
        acts.appendChild(b1); acts.appendChild(b2);
        node.appendChild(acts);
        box.appendChild(node);
      }
    }
    const h2 = el('div', 'h1', `可借渠道<small>LOAN OPTIONS</small>`);
    h2.style.fontSize = '15px'; h2.style.marginTop = '12px';
    box.appendChild(h2);
    offers.forEach(def => {
      const used = c.borrowedOf(def.id);
      const avail = c.loanLimit(def) - used;
      const node = el('div', 'loan-card');
      node.innerHTML = `
        <div class="bar" style="background:${def.color};opacity:.85"></div>
        <div class="loan-h"><span class="nm">${def.name}</span>
          <span class="rt" style="color:${def.color}">${def.sub}</span></div>
        <div class="loan-desc">${def.desc}</div>
        <div class="loan-meter"><i style="width:${used / c.loanLimit(def) * 100}%;background:${def.color}"></i></div>
        <div class="loan-meta"><span>可借 ${U.fmt(avail)} 円</span>
          <span>手数料 ${(def.fee * 100).toFixed(0)}%</span>
          <span>还款周期 ${def.grace} 天</span></div>
        ${def.id === 'mochiko' ? '<div style="margin-top:7px;font-size:11px;color:var(--purple);font-style:italic">「年利109%。个人间融资的法定最高利率。你借得起吗？」</div>' : ''}
      `;
      const acts = el('div', 'pos-actions');
      const b = el('button', 'btn ' + (def.danger >= 4 ? 'btn-danger' : def.danger === 3 ? 'btn-gold' : 'btn-ghost') + ' btn-sm', '借款');
      bindTap(b, () => Sheets.borrow(def, c, this));
      acts.appendChild(b);
      node.appendChild(acts);
      box.appendChild(node);
    });
    if (!offers.length) {
      box.appendChild(el('div', 'empty', '<span class="big">🔒</span>还没有任何人愿意借钱给你。<br>先推进剧情，认识更多的人吧。'));
    }
  },

  /* ---------- 人物屏 ---------- */
  /** 结局全屏画面 */
  showEnding(e) {
    // 用实例字段追踪，避免 getElementById 查一个动态创建的节点
    if (this._endingVeil) { this._endingVeil.remove(); this._endingVeil = null; }
    const veil = el('div', '', '');
    veil.setAttribute('data-ending-veil', '1');
    veil.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;padding:26px;text-align:center;' +
      'background:radial-gradient(circle at 50% 30%, rgba(20,26,40,.98), rgba(3,5,9,.99));' +
      'opacity:0;transition:opacity .8s ease';
    const col = e.tone === 'good' ? 'var(--gold)' : 'var(--dn)';
    veil.innerHTML = `
      <div style="font-size:12px;letter-spacing:.35em;color:${col};opacity:.8">
        ${e.tone === 'good' ? 'E N D I N G' : 'E N D I N G'}</div>
      <div style="margin-top:18px;font-size:13px;color:var(--tx3)">结局 · ${e.name}</div>
      <div style="margin-top:10px;font-size:26px;font-weight:800;color:var(--tx);line-height:1.4">
        ${e.title}</div>
      <div style="margin-top:22px;max-width:520px;font-size:13.5px;line-height:2;color:var(--tx2)">
        ${e.body}</div>
      <button class="btn btn-gold" style="margin-top:30px;min-width:180px" id="endingOk">
        继续（自由模式）</button>
      <div style="margin-top:12px;font-size:11px;color:var(--tx3)">
        已经走过这个结局，但游戏不会结束——就像现实一样。</div>`;
    document.body.appendChild(veil);
    this._endingVeil = veil;
    requestAnimationFrame(() => { veil.style.opacity = '1'; });
    const close = () => {
      veil.style.opacity = '0';
      setTimeout(() => {
        veil.remove();
        if (this._endingVeil === veil) this._endingVeil = null;
      }, 700);
    };
    veil.querySelector('#endingOk').addEventListener('click', close);
    Sfx.bigwin(); Haptics.win();
  },

  /** 毫秒 → mm:ss */
  fmtCd(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },

  renderMe() {
    const c = this.core, st = c.st;
    const lv = st.stats.level;
    const need = 100 + (lv - 1) * 85;
    const mental = st.stats.mental;
    const mcol = mental > 65 ? 'var(--up)' : mental > 35 ? 'var(--gold)' : 'var(--dn)';
    const greed = st.stats.greed;
    const gcol = greed > 65 ? 'var(--dn)' : greed > 35 ? 'var(--gold)' : 'var(--up)';
    $$('#growthCard').innerHTML = `
      <div class="card-title"><span class="dot"></span>久留美<span class="right">Lv.${lv}</span></div>
      <div class="kv"><span class="k">经验</span><span class="v mono">${Math.floor(st.stats.xp)} / ${need}</span></div>
      <div class="kv"><span class="k">交易次数 / 胜</span><span class="v mono">${st.stats.wins + st.stats.losses} / ${st.stats.wins}</span></div>
      <div class="kv"><span class="k">累计实现盈亏</span><span class="v mono ${st.stats.totalPnl >= 0 ? 'tick-up' : 'tick-dn'}">${U.sfmt(st.stats.totalPnl)}</span></div>
      <div class="kv"><span class="k">最大单笔盈利</span><span class="v mono tick-up">${U.sfmt(st.stats.bestProfit)}</span></div>
      <div class="kv"><span class="k">最大单笔亏损</span><span class="v mono tick-dn">${U.sfmt(st.stats.worstLoss)}</span></div>
      <div class="kv"><span class="k">被强平次数</span><span class="v mono ${st.stats.liquidated ? 'tick-dn' : ''}">${st.stats.liquidated}</span></div>
      <div class="kv"><span class="k">交易天数</span><span class="v mono">${st.stats.daysPlayed} 天</span></div>
      <div style="margin-top:10px">
        <div class="heart"><span style="width:44px">冷静值</span><div class="bar"><i style="width:${mental}%;background:${mcol}"></i></div><span class="mono" style="color:${mcol}">${mental.toFixed(0)}</span></div>
        <div class="heart" style="margin-top:6px"><span style="width:44px">贪欲</span><div class="bar"><i style="width:${greed}%;background:${gcol}"></i></div><span class="mono" style="color:${gcol}">${greed.toFixed(0)}</span></div>
        <div class="heart" style="margin-top:6px"><span style="width:44px">洞察</span><div class="bar"><i style="width:${st.stats.insight}%;background:var(--blue)"></i></div><span class="mono" style="color:var(--blue)">${st.stats.insight.toFixed(0)}</span></div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--tx3);line-height:1.6">
        冷静值越低，越容易做出"再加仓一点"的决定；贪欲越高，杠杆会越抬越高。
      </div>
      ${(() => {
        const dp = c.dailyProgress();
        if (!dp.length) return '';
        const doneN = dp.filter(x => x.done).length;
        const allDone = doneN === dp.length;
        return `<div style="margin-top:10px;padding:10px 11px;border-radius:12px;
            background:${allDone ? 'rgba(61,220,151,.10)' : 'rgba(255,255,255,.04)'};
            border:1px solid ${allDone ? 'rgba(61,220,151,.35)' : 'rgba(255,255,255,.10)'}">
          <div style="display:flex;align-items:baseline;gap:8px">
            <span style="font-size:12.5px;font-weight:800;color:${allDone ? 'var(--up)' : 'var(--tx)'}">
              📋 限时任务</span>
            <span style="font-size:10px;color:var(--blue);margin-left:8px">
              <b class="mono" id="dailyCountdown">${this.fmtCd(c.dailyRemainMs())}</b> 后刷新</span>
            <span style="font-size:10.5px;color:var(--tx3);margin-left:auto">
              ${doneN} / ${dp.length}${allDone ? '　全清 +' + DAILY_ALL_BONUS : ''}</span>
          </div>
          ${dp.map(x => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
                border-bottom:1px solid rgba(255,255,255,.04)">
              <span style="flex:0 0 auto;width:14px;height:14px;border-radius:4px;
                display:flex;align-items:center;justify-content:center;font-size:9px;
                background:${x.done ? 'rgba(61,220,151,.3)' : 'rgba(255,255,255,.06)'};
                color:${x.done ? 'var(--up)' : 'var(--tx3)'};
                border:1px solid ${x.done ? 'rgba(61,220,151,.6)' : 'rgba(255,255,255,.12)'}">
                ${x.done ? '✓' : ''}</span>
              <div style="flex:1;min-width:0">
                <span style="font-size:11.5px;font-weight:700;color:${x.done ? 'var(--tx3)' : 'var(--tx)'}">
                  ${x.name}</span>
                <span style="font-size:10px;color:var(--tx3);margin-left:5px">${x.desc}</span>
              </div>
              ${x.when === 'settle' && !x.done
                ? '<span class="tag" style="font-size:8.5px;background:rgba(140,180,255,.15);color:var(--blue);border-color:rgba(140,180,255,.3)">周期结算</span>'
                : `<span class="mono" style="font-size:10px;color:var(--tx3)">${x.prog}/${x.goal}</span>`}
              <span style="font-size:10.5px;font-weight:700;color:var(--gold);flex:0 0 auto">+${x.pts}</span>
            </div>`).join('')}
        </div>`;
      })()}
      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn btn-ghost btn-sm" id="btnAch" style="flex:1">
          🏆 成就 <b style="color:var(--gold)">${(c.st.achievements || []).length}</b>/${ACHIEVEMENTS.length}</button>
        <button class="btn btn-ghost btn-sm" id="btnStats" style="flex:1">📊 交易统计</button>
      </div>
      <div class="row" style="margin-top:8px;gap:8px">
        <button class="btn btn-ghost btn-sm" id="btnEndings" style="flex:1">
          🎬 结局 <b style="color:var(--gold)">${(c.st.endingsSeen || []).length}</b>/${ENDINGS.length}</button>
      </div>
      <div style="margin-top:10px;padding:9px 11px;border-radius:11px;
        background:rgba(140,180,255,.07);border:1px solid rgba(140,180,255,.22);font-size:11px;line-height:1.72">
        <b style="color:var(--blue)">等级有什么用</b><br>
        · 每升 1 级 → <b style="color:var(--gold)">+1 洞察点</b>（可换 10 万 / 买技能）<br>
        · 每升 1 级 → <b>强平线 −0.7%</b>（50% → 最低 40%）<br>
        · Lv.2 解锁「消費者金融」借贷<br>
        · Lv.2 / Lv.3 触发关键剧情<br>
        <span style="color:var(--tx3)">当前强平线：<b style="color:${c.liqThreshold() < 48 ? 'var(--up)' : 'var(--tx2)'}">${c.liqThreshold().toFixed(1)}%</b>
        · 下一级需要 <b>${Math.ceil(c.xpNeed())}</b> 经验</span>
      </div>`;

    // 目标
    const GOAL = 20000000;
    const eq = c.netAsset();
    const p = U.clamp(eq / GOAL * 100, 0, 100);
    const rows = [
      { t: '复仇目标：2000 万', n: p.toFixed(1) + '%', w: p, c: 'linear-gradient(90deg,var(--pink),var(--gold))',
        s: `当前净值 ${U.fmt(eq)} 円 / ${U.fmt(GOAL)} 円` },
    ];
    if (st.flags.dadMoney) {
      const pa = U.clamp(c.st.wallet / 3000000 * 100, 0, 100);
      rows.push({ t: '还给爸爸的 300 万', n: pa.toFixed(0) + '%', w: pa,
        c: 'linear-gradient(90deg,var(--blue),var(--purple))',
        s: `手上 ${U.fmt(c.st.wallet)} 円 —— 这 300 万在他眼里不是钱，是信任` });
    }
    const dl = c.totalLoan();
    rows.push({ t: '把负债还清', n: dl <= 0 ? '达成' : U.fmt(dl) + ' 円',
      w: dl <= 0 ? 100 : U.clamp(100 - dl / 10000000 * 100, 0, 100),
      c: 'linear-gradient(90deg,var(--dn),var(--gold))',
      s: dl <= 0 ? '无债一身轻。这在本作里是稀有状态。' : (() => {
        const dr = c.st.loans.reduce((a, l) => {
          const d = LOAN_PRODUCTS.find(x => x.id === l.pid); return a + l.amount * d.rate / 365;
        }, 0);
        return `每日利息 ${U.fmt(dr, 1)} 円`;
      })() });
    $$('#goalList').innerHTML = rows.map(r => `
      <div class="goal">
        <div class="h"><span>${r.t}</span><span class="n mono">${r.n}</span></div>
        <div class="pb"><i class="${r.w > 80 ? 'shine' : ''}" style="width:${r.w}%;background:${r.c}"></i></div>
        <div style="font-size:10.5px;color:var(--tx3);margin-top:5px">${r.s}</div>
      </div>`).join('');

    // 人物
    const people = Chapters.people(c);
    $$('#charaList').innerHTML = people.map(p => `
      <div class="chara">
        <div class="face" style="background:linear-gradient(140deg,${p.c1},${p.c2});color:#160a12">${p.ini}</div>
        <div style="flex:1;min-width:0">
          <div class="nm">${p.name}<span class="tag ${p.tagCls}" style="margin-left:6px">${p.role}</span></div>
          <div class="ds">${p.ds}</div>
          <div class="ln">${p.line}</div>
        </div>
      </div>`).join('');

    if (typeof AIUI !== 'undefined') AIUI.render();

    // 交易记录
    const cl = st.closed.slice(0, 30);
    $$('#closedCount').textContent = st.closed.length + ' 笔';
    $$('#closedList').innerHTML = cl.length ? cl.map(r => {
      const mrk = r.reason === 'liquidated' ? '<span class="tag dn">强平</span>' : '';
      return `<div class="log-item"><span class="t mono">${r.day}d</span>
        <span class="tag ${r.dir > 0 ? 'up' : 'dn'}">${r.dir > 0 ? '多' : '空'}</span>
        <span>${PAIRS[r.pid].short} ${r.lev}× ${mrk}</span>
        <span class="a mono ${r.pnl >= 0 ? 'tick-up' : 'tick-dn'}">${U.sfmt(r.pnl)}</span></div>`;
    }).join('') : '<div class="empty">还没有平仓记录。</div>';

    // 限时任务倒计时：每秒刷新一次文本
    if (this._dailyTimer) { clearInterval(this._dailyTimer); this._dailyTimer = null; }
    const cdEl = $$('#dailyCountdown');
    if (cdEl) {
      this._dailyTimer = setInterval(() => {
        const n = $$('#dailyCountdown');
        if (!n) { clearInterval(this._dailyTimer); this._dailyTimer = null; return; }
        n.textContent = this.fmtCd(c.dailyRemainMs());
      }, 1000);
    }

    // 成就 / 统计入口（每次渲染都要重新绑定，因为 innerHTML 被整体替换）
    const ba = $$('#btnAch');
    if (ba) bindTap(ba, () => Sheets.achievements(c));
    const bs = $$('#btnStats');
    if (bs) bindTap(bs, () => Sheets.stats(c));
    const be = $$('#btnEndings');
    if (be) bindTap(be, () => Sheets.endings(c));
  },

  /* ---------- 设定屏 ---------- */
  renderSet() {
    const c = this.core, s = c.st.settings;
    $$('#setCard').innerHTML = `
      <div class="card-title"><span class="dot"></span>设定</div>
      <div class="kv" data-act="sfx"><span class="k">音效</span><span class="v">${s.sfx ? '开' : '关'}</span></div>
      <div class="kv" data-act="hap"><span class="k">震动反馈</span><span class="v">${s.haptics ? '开' : '关'}</span></div>
      <div class="kv" data-act="fx"><span class="k">特效与动画</span><span class="v">${s.effects ? '开' : '关'}</span></div>
      <div class="kv" data-act="ma"><span class="k">K线均线</span><span class="v">${s.ma ? '开' : '关'}</span></div>
      <div class="kv" data-act="slots"><span class="k">📁 存档管理（3 个槽位）</span><span class="v" id="slotState">→</span></div>
      <div class="kv" data-act="save"><span class="k">立即存档到当前槽</span><span class="v">→</span></div>
      <div class="kv" data-act="tut"><span class="k">重看教学</span><span class="v">→</span></div>
      <div class="kv" data-act="export"><span class="k">导出存档</span><span class="v">→</span></div>
      <div class="kv" data-act="reset"><span class="k" style="color:var(--dn)">重置全部进度</span><span class="v">→</span></div>`;
    $$$('#setCard .kv').forEach(k => {
      bindTap(k, () => {
        const a = k.dataset.act;
        if (a === 'sfx') { s.sfx = !s.sfx; Sfx.setEnabled(s.sfx); }
        else if (a === 'hap') { s.haptics = !s.haptics; Haptics.tap(); }
        else if (a === 'fx') { s.effects = !s.effects; this.effects = s.effects; }
        else if (a === 'ma') { s.ma = !s.ma; this.chart.o.showMA = s.ma; }
        else if (a === 'save') { c.save(); this.toast('已存档', 'up'); }
        else if (a === 'slots') { Sheets.slots(c); return; }
        else if (a === 'aiconfig') { AIUI.openConfig(); return; }
        else if (a === 'tut') { Sheets.tutorialIndex(c); }
        else if (a === 'export') { Sheets.exportSave(c, this); }
        else if (a === 'reset') {
          Confirm.ask('重置进度', '所有资产、剧情、图鉴都会清空。<br><b style="color:var(--dn)">这个操作不可撤销。</b>', '确定重置', () => {
            c.reset(); location.reload();
          });
        }
        this.renderSet();
      });
    });
    const ss = $$('#slotState');
    if (ss) ss.textContent = '槽 ' + (c.slot + 1) + ' / ' + Store.SLOTS;
    if (typeof AIUI !== 'undefined') AIUI.renderSetRow();
    $$('#aboutCard').innerHTML = `
      <div class="card-title"><span class="dot"></span>关于</div>
      <div style="font-size:11.5px;line-height:1.7;color:var(--tx2)">
        本作为《FX戦士くるみちゃん》（原作：でむにゃん／作画：炭酸だいすき）的<b>非官方同人游戏</b>，
        仅在个人设备本地运行，不含任何真实资金、不连接任何真实券商或行情源。<br><br>
        游戏内所有汇率、新闻、事件均为程序生成的虚构数据，与真实市场无关。<br><br>
        <span style="color:var(--gold)">本作的核心目的，是让你在失去任何真钱的前提下，理解杠杆、保证金、爆仓与借钱交易的危险。</span><br><br>
        <span style="color:var(--tx3)">如果玩完之后你觉得"这东西我再也不想碰"——那就说明这个游戏做对了。</span><br><br>
        <b style="color:var(--blue)">关于 AI 交易员：</b>使用你自己提供的第三方 API key，<b>只保存在本机</b>，
        请求直接发往你填写的接口地址。本游戏不收集、不上传、不中转任何数据。
      </div>`;
  },

  renderGlossary() {
    const G = [
      ['レバレッジ / 杠杆', '用少量保证金操作大额头寸。10倍杠杆意味着汇率动 1%，你的保证金就盈亏 10%。<b>它同时放大收益和亏损，也让爆仓距离除以 10。</b>'],
      ['証拠金 / 保证金', '开仓时被锁住的那笔钱。它不是你花的钱，是"押金"——亏完就没了。'],
      ['維持率 / 维持率', '净值 ÷ 必要保证金。降到 100% 触发追证，降到 50% 会被<b>强制平仓</b>。这是本游戏最重要的一个数字。'],
      ['ロスカット / 强制平仓', '维持率跌破线时，券商不问你的意见，直接按市价砍掉你的持仓。<b>这时的亏损是"已实现"的，救不回来。</b>'],
      ['追証 / 追加保证金', '维持率跌破 100% 时收到通知，要求你补钱。邻家的散户大多在这一步选择"再借一点"。'],
      ['スワップ / 隔夜利息', '持仓过夜产生的利息差。买高息货币能收钱，但方向错了会两头亏。周三通常是三倍。'],
      ['pips / 点', '汇率的最小变动单位，日元对通常是 0.01 円。你的盈亏 = 点差 × 通貨量。'],
      ['ロット / 手', '交易量的单位。1 万通貨 = 1 枚。手数越大，同样的行情波动带来的盈亏越大。'],
      ['含み損 / 浮动亏损', '还没平仓的账面亏损。它已经在了，只是你还没承认。'],
      ['損切り / 止损', '在预设价位认赔出场。<b>反人性的地方在于：你必须在还没亏之前决定亏多少。</b>'],
      ['ナンピン / 摊平加仓', '亏损时继续加仓，把均价拉低。听起来聪明，实则是散户走向爆仓的标准路径。'],
      ['コツコツドカン', '小幅稳定盈利，然后一次巨亏吐光全部。散户的宿命曲线，也是久留美的一生。'],
      ['個人間融資 / 个人间借贷', '法律允许范围内利率最高的借钱方式。萌智子给芽吹开的价码：<b>年利 109%</b>。'],
      ['ロスカットレート / 强平价', '使你的维持率刚好跌到 50% 的那个汇率。它可以被算出来——所以你没有理由"不知道会爆在哪"。'],
    ];
    $$('#glossary').innerHTML = G.map(([k, v], i) => `
      <div class="gloss" data-i="${i}" style="border-bottom:1px solid rgba(255,255,255,.05);padding:8px 0">
        <div style="display:flex;align-items:center;font-size:12.5px;font-weight:800">
          <span style="color:var(--gold)">${k}</span><span style="margin-left:auto;color:var(--tx3);font-size:14px">＋</span></div>
        <div class="gv" style="display:none;font-size:11.5px;line-height:1.72;color:var(--tx2);margin-top:6px">${v}</div>
      </div>`).join('');
    $$$('#glossary .gloss').forEach(g => {
      bindTap(g, () => {
        const v = $('.gv', g);
        const open = v.style.display === 'block';
        v.style.display = open ? 'none' : 'block';
        $('span:last-child', g).textContent = open ? '＋' : '−';
      });
    });
  },

  renderNews() {
    const box = $$('#newsList');
    if (!box) return;
    const log = this.core.market.newsLog.slice(0, 12);
    $$('#newsCount').textContent = log.length + ' 条';
    box.innerHTML = log.length ? log.map(n => `
      <div class="news-item ${n.tag}">
        <span class="bullet"></span>
        <span style="flex:1"><b style="color:var(--tx)">${PAIRS[n.focus] ? PAIRS[n.focus].short : ''}</b> ${n.t}
        <span style="color:var(--tx3)">・第${n.dt}日</span></span>
      </div>`).join('') : '<div class="empty" style="padding:18px">还没有值得记录的行情事件。</div>';
  },

  renderAll() {
    this.renderPairTabs();
    this.renderNews();
    if (this.screen === 'pos') this.renderPositions();
    if (this.screen === 'loan') this.renderLoans();
    if (this.screen === 'me') this.renderMe();
    if (this.screen === 'set') this.renderSet();
    this.updateOrder();
    this.badge('pos', this.core.st.positions.length);
    this.syncSpeed();
  },
};

/* ------------------------------------------------------------ */
/* 动效小工具                                                     */
const FX = {
  pulse(color) {
    if (!UI.effects) return;
    const d = el('div', '');
    d.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:88;
      background:radial-gradient(circle at 50% 42%, ${color}44, transparent 62%);
      animation:fxpulse .5s ease-out forwards`;
    const st = document.createElement('style');
    st.textContent = '@keyframes fxpulse{0%{opacity:0}30%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(st); document.body.appendChild(d);
    setTimeout(() => { d.remove(); st.remove(); }, 520);
  },
  newsTicker(text) {
    if (!UI.effects) return;
    const d = el('div', '', `📢 ${text}`);
    d.style.cssText = `position:fixed;left:0;right:0;top:calc(var(--safe-t) + 118px);z-index:92;
      padding:7px 14px;font-size:12px;font-weight:700;color:#fff;
      background:linear-gradient(90deg,rgba(255,77,109,.95),rgba(192,132,252,.9));
      box-shadow:0 8px 26px rgba(0,0,0,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      animation:tickIn .45s cubic-bezier(.16,1,.3,1)`;
    const st = document.createElement('style');
    st.textContent = '@keyframes tickIn{from{transform:translateY(-120%);opacity:0}to{transform:none;opacity:1}}';
    document.head.appendChild(st); document.body.appendChild(d);
    setTimeout(() => { d.style.transition = 'all .4s'; d.style.transform = 'translateY(-140%)'; d.style.opacity = '0';
      setTimeout(() => { d.remove(); st.remove(); }, 420); }, 3000);
  },
  alert(big, small, kind) {
    if (!UI.effects) { UI.toast(big + ' ' + small, kind === 'bad' ? 'dn' : 'warn'); return; }
    const d = el('div', 'alert-full', `
      <div class="flashbg"></div>
      <div class="txt">${big}</div><div class="sm">${small}</div>`);
    document.body.appendChild(d);
    requestAnimationFrame(() => d.classList.add('on'));
    Haptics[kind === 'bad' ? 'crash' : 'lose']();
    setTimeout(() => {
      d.style.transition = 'opacity .4s'; d.style.opacity = '0';
      setTimeout(() => d.remove(), 420);
    }, 1500);
  },
  bark(who, line) {
    if (!UI.effects) return;
    const colors = { mochiko: ['#c084fc', '#8cb4ff', '萌智子', '萌'], mebuki: ['#3ddc97', '#8cb4ff', '芽吹', '芽'],
                     yasuko: ['#ffd166', '#ff8fb1', 'やす子', '安'], kurumiIn: ['#ff8fb1', '#c084fc', '久留美', '久'],
                     yuki: ['#8cb4ff', '#3ddc97', 'ゆき', 'ゆ'] };
    const c = colors[who] || ['#ff8fb1', '#c084fc', who, '？'];
    const d = el('div', '', `
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="width:30px;height:30px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
          font-weight:900;font-size:13px;color:#160a12;background:linear-gradient(140deg,${c[0]},${c[1]})">${c[3]}</div>
        <div style="min-width:0"><div style="font-size:11px;font-weight:800;color:${c[0]}">${c[2]}</div>
        <div style="font-size:12.5px;line-height:1.55;margin-top:2px">${line}</div></div>
      </div>`);
    d.style.cssText = `position:fixed;left:12px;right:12px;top:calc(var(--safe-t) + 132px);z-index:91;
      padding:10px 12px;border-radius:14px;background:rgba(18,14,26,.95);border:1px solid rgba(255,255,255,.13);
      box-shadow:0 14px 40px rgba(0,0,0,.6);backdrop-filter:blur(10px);
      animation:toastIn2 .38s cubic-bezier(.16,1,.3,1)`;
    const st = document.createElement('style');
    st.textContent = '@keyframes toastIn2{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}';
    document.head.appendChild(st); document.body.appendChild(d);
    setTimeout(() => { d.style.transition = 'all .35s'; d.style.opacity = '0'; d.style.transform = 'translateY(-12px)';
      setTimeout(() => { d.remove(); st.remove(); }, 380); }, 3400);
  },
};

/* ------------------------------------------------------------ */
/* 底部抽屉（数字输入 / 借款 / 结果）                              */
const Sheets = {
  _open: null,
  base(inner) {
    const mask = $$('#mask');
    const sheet = $$('#sheet');
    sheet.innerHTML = `<div class="sheet-grip"></div>` + inner;
    mask.classList.add('on'); sheet.classList.add('on');
    this._open = true;
    Sfx.open();
    return sheet;
  },
  close() {
    if (!this._open) return;
    $$('#mask').classList.remove('on');
    $$('#sheet').classList.remove('on');
    this._open = false;
    Sfx.close();
  },
  number(title, sub, defVal, label, dec, onOk) {
    const sh = this.base(`
      <h3>${title}</h3><div class="sub">${sub}</div>
      <div class="field"><label>${label}</label><input type="number" id="shNum" value="${Math.floor(defVal)}" inputmode="decimal"></div>
      <div class="amt-chips" id="shChips"></div>
      <div class="row"><button class="btn btn-ghost" id="shCancel">取消</button>
      <button class="btn btn-gold" id="shOk">确定</button></div>`);
    const inp = $('#shNum', sh);
    const chips = [10000, 100000, 1000000, 5000000];
    chips.forEach(v => {
      const b = el('button', '', U.yenShort(v));
      bindTap(b, () => { inp.value = v; });
      $('#shChips', sh).appendChild(b);
    });
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 300);
    const ok = () => {
      const v = parseFloat(inp.value);
      if (!isFinite(v) || v <= 0) { UI.toast('请输入有效金额', 'dn'); Sfx.error(); return; }
      this.close();
      onOk(v);
    };
    $('#shOk', sh).addEventListener('click', ok);
    $('#shCancel', sh).addEventListener('click', () => this.close());
  },
  borrow(def, core, ui) {
    const used = core.borrowedOf(def.id);
    const avail = core.loanLimit(def) - used;
    const sh = this.base(`
      <h3>${def.name}</h3>
      <div class="sub">${def.desc}</div>
      <div class="kv"><span class="k">年利</span><span class="v mono" style="color:${def.color}">${(def.rate * 100).toFixed(1)}%</span></div>
      <div class="kv"><span class="k">可借上限</span><span class="v mono">${U.fmt(avail)} 円</span></div>
      <div class="kv"><span class="k">手数料</span><span class="v mono">${(def.fee * 100).toFixed(0)}%</span></div>
      <div class="kv"><span class="k">还款周期</span><span class="v mono">${def.grace} 天</span></div>
      ${def.id === 'mochiko' ? `<div style="margin:10px 0;padding:9px 11px;border-radius:11px;background:rgba(192,132,252,.10);border:1px solid rgba(192,132,252,.32);font-size:11.5px;line-height:1.62;color:#e6d5ff">
        「年利 109%。借 100 万，一年后你要还 209 万。<br>当然，你不可能拖到一年——因为你会先爆仓。」</div>` : ''}
      <div class="field"><label>借款金额（円）</label><input type="number" id="shNum" value="${Math.floor(Math.min(avail, 1000000))}"></div>
      <div class="amt-chips" id="shChips"></div>
      <div class="row"><button class="btn btn-ghost" id="shCancel">算了</button>
      <button class="btn ${def.danger >= 4 ? 'btn-danger' : 'btn-gold'}" id="shOk">借这笔钱</button></div>`);
    const inp = $('#shNum', sh);
    [Math.min(avail, 100000), Math.min(avail, 500000), Math.min(avail, 2000000), avail].forEach(v => {
      const b = el('button', '', U.yenShort(v));
      bindTap(b, () => { inp.value = Math.floor(v); });
      $('#shChips', sh).appendChild(b);
    });
    $('#shOk', sh).addEventListener('click', () => {
      const v = parseFloat(inp.value);
      const r = core.borrow(def.id, v);
      if (!r.ok) { UI.toast(r.why, 'dn'); Sfx.error(); return; }
      this.close();
      UI.toast(`借到 ${U.fmt(r.got)} 円（手数料 ${U.fmt(r.fee)}）`, 'up');
      if (def.danger >= 4) FX.alert('借入成立', `${def.name} ${U.yenShort(r.got)} 円`, 'bad');
      ui.renderLoans(); ui.renderAll();
    });
    $('#shCancel', sh).addEventListener('click', () => this.close());
  },
  msg(title, body, kind) {
    const sh = this.base(`
      <h3 style="color:${kind === 'bad' ? 'var(--dn)' : kind === 'warn' ? 'var(--gold)' : 'var(--pink)'}">${title}</h3>
      <div class="sub" style="font-size:13px;color:var(--tx)">${body}</div>
      <button class="btn ${kind === 'bad' ? 'btn-danger' : 'btn-gold'}" id="shOk" style="width:100%">知道了</button>`);
    $('#shOk', sh).addEventListener('click', () => this.close());
  },
  result(title, amount, sub, kind) {
    const good = amount >= 0;
    const sh = this.base(`
      <div class="result">
        <div class="lbl">${title}</div>
        <div class="big mono" style="color:${good ? 'var(--up)' : 'var(--dn)'};
          text-shadow:0 0 34px ${good ? 'rgba(61,220,151,.7)' : 'rgba(255,77,109,.7)'}">${U.sfmt(amount)} 円</div>
        <div class="sub" style="margin:10px 0 0">${sub}</div>
      </div>
      <button class="btn ${good ? 'btn-gold' : 'btn-ghost'}" id="shOk" style="width:100%;margin-top:14px">继续</button>`);
    $('#shOk', sh).addEventListener('click', () => this.close());
    Haptics[good ? 'win' : 'lose']();
  },
  /** 结局图鉴 */
  endings(core) {
    const seen = core.st.endingsSeen || [];
    const rows = ENDINGS.map(e => {
      const got = seen.indexOf(e.id) >= 0;
      const col = e.tone === 'good' ? 'var(--gold)' : 'var(--dn)';
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05);
          ${got ? '' : 'opacity:.45'}">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;font-weight:800;color:${got ? col : 'var(--tx3)'}">
            ${got ? '◆' : '◇'} ${e.name}</span>
          <span style="font-size:10px;color:var(--tx3);margin-left:auto">
            ${got ? '已达成' : '未触发'}</span>
        </div>
        <div style="font-size:11.5px;color:${got ? 'var(--tx2)' : 'var(--tx3)'};margin-top:5px;line-height:1.6">
          ${got ? e.title : '？？？'}</div>
      </div>`;
    }).join('');
    const sh = Sheets.base(`
      <h3>🎬 结局 <span style="font-size:13px;color:var(--gold);margin-left:6px">${seen.length} / ${ENDINGS.length}</span></h3>
      <div class="sub">走到这些状态时会触发一段收束。触发后游戏不会结束，你可以继续。</div>
      <div style="max-height:56vh;overflow-y:auto;margin-top:8px">${rows}</div>
      <button class="btn btn-ghost" id="endClose" style="width:100%;margin-top:10px">关闭</button>`);
    $$('#endClose', sh).addEventListener('click', () => Sheets.close());
  },

  /** 成就抽屉 */
  achievements(core) {
    const sum = core.achSummary();
    let filter = 'all';
    const render = () => {
      const list = ACHIEVEMENTS.filter(a => filter === 'all' || a.cat === filter);
      const catBtns = [['all', '全部', '#e8eefc', sum.done + '/' + sum.total]]
        .concat(Object.keys(ACH_CATS).map(k =>
          [k, ACH_CATS[k].name, ACH_CATS[k].color, sum.byCat[k].done + '/' + sum.byCat[k].total]));
      const rows = list.map(a => {
        const got = core.hasAch(a.id);
        const cc = ACH_CATS[a.cat].color;
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;
            border-bottom:1px solid rgba(255,255,255,.05);${got ? '' : 'opacity:.55'}">
          <div style="flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:flex;
            align-items:center;justify-content:center;font-size:13px;font-weight:800;
            background:${got ? cc + '33' : 'rgba(255,255,255,.05)'};
            color:${got ? cc : 'var(--tx3)'};border:1px solid ${got ? cc + '77' : 'rgba(255,255,255,.1)'}">
            ${got ? '✓' : '·'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:700;color:${got ? 'var(--tx)' : 'var(--tx2)'}">
              ${a.name}<span class="tag" style="margin-left:6px;font-size:9px;
                background:${cc}22;color:${cc};border-color:${cc}55">${ACH_CATS[a.cat].name}</span>
            </div>
            <div style="font-size:10.5px;color:var(--tx3);margin-top:2px">${a.desc}</div>
          </div>
          <div style="flex:0 0 auto;font-size:11px;font-weight:700;
            color:${got ? 'var(--gold)' : 'var(--tx3)'}">+${a.pts}</div>
        </div>`;
      }).join('');

      const sh = Sheets.base(`
        <h3>🏆 成就 <span style="font-size:13px;color:var(--gold);margin-left:6px">${sum.done} / ${sum.total}</span></h3>
        <div class="sub">解锁成就可得洞察点 —— 1 点可换 10 万円，也能买永久技能。</div>
        <div class="row" style="flex-wrap:wrap;gap:6px;margin:8px 0">
          ${catBtns.map(([k, name, col, cnt]) => `
            <button class="btn btn-xs ${filter === k ? 'btn-gold' : 'btn-ghost'}"
              data-cat="${k}" style="${filter === k ? '' : `color:${col};border-color:${col}44`}">
              ${name} ${cnt}</button>`).join('')}
        </div>
        <div style="max-height:52vh;overflow-y:auto">${rows}</div>
        <button class="btn btn-ghost" id="achClose" style="width:100%;margin-top:10px">关闭</button>`);

      $$$('[data-cat]', sh).forEach(b => bindTap(b, () => { filter = b.dataset.cat; render(); }));
      $$('#achClose', sh).addEventListener('click', () => Sheets.close());
    };
    render();
  },

  /** 交易统计抽屉 */
  stats(core) {
    const S = core.st.stats;
    const trades = S.trades || 0;
    const winRate = trades > 0 ? (S.wins / trades * 100) : 0;
    const avgHold = (S.holdCount || 0) > 0 ? (S.holdMs / S.holdCount / 1000) : 0;
    const pairsTried = Object.keys(S.pairsTried || {}).length;
    const total = PAIR_ORDER.length;

    const kpi = (k, v, color) => `<div style="display:flex;justify-content:space-between;
      padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="font-size:11.5px;color:var(--tx2)">${k}</span>
      <b class="mono" style="font-size:12.5px;color:${color || 'var(--tx)'}">${v}</b></div>`;

    const byPair = PAIR_ORDER.map(id => {
      const d = S.byPair && S.byPair[id];
      if (!d) return null;
      const def = PAIRS[id];
      return `<div style="display:flex;justify-content:space-between;align-items:center;
          padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <span style="font-size:11px;color:${def.color}">${def.short}</span>
        <span style="font-size:10.5px;color:var(--tx3)">${d.n} 笔 · 胜 ${d.wins}</span>
        <b class="mono" style="font-size:11.5px;color:${d.pnl >= 0 ? 'var(--up)' : 'var(--dn)'}">
          ${d.pnl >= 0 ? '+' : ''}${U.yenShort(d.pnl)}</b></div>`;
    }).filter(Boolean).join('') || '<div style="font-size:11px;color:var(--tx3)">还没交易过</div>';

    const sh = Sheets.base(`
      <h3>📊 交易统计</h3>
      <div class="sub">这些数字不会骗你。它们也是你亏钱的证据。</div>
      <div style="margin-top:6px">
        ${kpi('总交易次数', trades)}
        ${kpi('胜率', winRate.toFixed(0) + '%', winRate >= 50 ? 'var(--up)' : 'var(--dn)')}
        ${kpi('胜 / 负', (S.wins || 0) + ' / ' + (S.losses || 0))}
        ${kpi('最长连胜', (S.maxStreak || 0) + ' 场', (S.maxStreak || 0) >= 3 ? 'var(--gold)' : '')}
        ${kpi('单笔最大盈利', (S.bestProfit > 0 ? '+' : '') + U.fmt(S.bestProfit), 'var(--up)')}
        ${kpi('单笔最大亏损', U.fmt(S.worstLoss), 'var(--dn)')}
        ${kpi('累计盈亏', (S.totalPnl >= 0 ? '+' : '') + U.fmt(S.totalPnl), S.totalPnl >= 0 ? 'var(--up)' : 'var(--dn)')}
        ${kpi('最大回撤', (S.maxDrawdown || 0).toFixed(1) + '%', (S.maxDrawdown || 0) > 30 ? 'var(--dn)' : '')}
        ${kpi('平均持仓时长', avgHold > 0 ? (avgHold < 60 ? avgHold.toFixed(0) + ' 秒' : (avgHold / 60).toFixed(1) + ' 分钟') : '—')}
        ${kpi('用过的最大杠杆', (S.maxLev || 1) + ' 倍', (S.maxLev || 1) >= 50 ? 'var(--dn)' : '')}
        ${kpi('交易过的品种', pairsTried + ' / ' + total)}
        ${kpi('被强平次数', S.liquidated || 0, (S.liquidated || 0) > 0 ? 'var(--dn)' : '')}
      </div>
      <div style="margin-top:12px;font-size:11px;font-weight:700;color:var(--tx3)">分品种盈亏</div>
      <div>${byPair}</div>
      <button class="btn btn-ghost" id="statClose" style="width:100%;margin-top:10px">关闭</button>`);
    $$('#statClose', sh).addEventListener('click', () => Sheets.close());
  },

  /** 存档管理抽屉 */
  slots(core) {
    const fmtTime = (ts) => {
      if (!ts) return '—';
      const d = new Date(ts);
      const p2 = n => (n < 10 ? '0' : '') + n;
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    };
    const render = () => {
      const list = Store.list().filter(x => x.slot < Store.SLOTS);
      const rows = list.map(({ slot, info }) => {
        const cur = slot === core.slot;
        const empty = !info;
        return `<div class="loan-card" style="${cur ? 'border-color:rgba(255,143,177,.55)' : ''}">
          <div class="bar" style="background:${cur ? 'var(--pink)' : 'rgba(255,255,255,.12)'}"></div>
          <div class="loan-h">
            <span class="nm">槽 ${slot + 1}${cur ? '　<span class="tag pink" style="font-size:10px">使用中</span>' : ''}</span>
            <span class="rt mono" style="font-size:12px;color:var(--tx3)">${empty ? '空' : fmtTime(info.savedAt)}</span>
          </div>
          ${empty ? '<div class="loan-desc">还没有存档</div>' : `
          <div class="loan-desc" style="margin:6px 0">
            第 <b>${info.day || 0}</b> 天 · Lv.<b>${info.level || 1}</b> ·
            净值 <b class="mono">${U.yenShort(info.netAsset || 0)}</b> ·
            ${info.positions || 0} 笔持仓
            ${info.loan ? ` · 负债 <b style="color:var(--dn)">${U.yenShort(info.loan)}</b>` : ''}
          </div>
          <div class="loan-meta"><span>${info.savedAt ? fmtTime(info.savedAt) : '—'}</span><span>${info.size ? (info.size / 1024).toFixed(1) + ' KB' : ''}</span></div>`}
          <div class="pos-actions" style="margin-top:8px">
            ${!empty ? `<button class="btn btn-gold btn-sm" data-load="${slot}">读取</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-save="${slot}">保存到此</button>
            ${!empty ? `<button class="btn btn-danger btn-sm" data-del="${slot}">删除</button>` : ''}
          </div>
        </div>`;
      }).join('');

      const sh = Sheets.base(`
        <h3>存档管理</h3>
        <div class="sub">当前写到 <b>槽 ${core.slot + 1}</b>。每 8 秒自动存一次，读取时若主档损坏会回退到备份。</div>
        <div id="slotList">${rows}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" id="slotExport">导出当前档</button>
          <button class="btn btn-ghost btn-sm" id="slotImport">导入存档</button>
        </div>
        <button class="btn btn-ghost" id="slotClose" style="width:100%;margin-top:8px">关闭</button>`);

      const bind = (sel, fn) => $$$(sel, sh).forEach(b => bindTap(b, () => fn(b)));
      bind('[data-load]', b => {
        const n = +b.dataset.load;
        Confirm.ask('读取槽 ' + (n + 1), '当前未保存的进度会被覆盖。确定读取？', '读取', () => {
          if (core.load(n).ok) location.reload();
          else UI.toast('这个槽没有可用存档', 'dn');
        });
      });
      bind('[data-save]', b => {
        const n = +b.dataset.save;
        core.useSlot(n);
        core.save();
        UI.toast('已保存到槽 ' + (n + 1), 'up');
        UI.renderSet();
        render();
      });
      bind('[data-del]', b => {
        const n = +b.dataset.del;
        Confirm.ask('删除槽 ' + (n + 1), '这个槽的存档会被清空，不可恢复。', '删除', () => {
          Store.remove(n);
          UI.toast('已删除槽 ' + (n + 1), 'dn');
          render();
        });
      });
      $$('#slotClose', sh).addEventListener('click', () => Sheets.close());
      $$('#slotExport', sh).addEventListener('click', () => {
        const txt = Store.exportJson({ st: core.st, market: core.market.serialize(), mochiko: core.mochiko });
        const ta = el('textarea', '', '');
        ta.value = txt;
        ta.style.cssText = 'width:100%;height:140px;margin-top:8px;border-radius:10px;background:rgba(0,0,0,.45);' +
          'border:1px solid rgba(255,255,255,.18);color:var(--tx);padding:10px;font-size:10.5px;font-family:ui-monospace,monospace';
        ta.readOnly = true;
        const wrap = $$('#slotList', sh);
        wrap.innerHTML = '';
        wrap.appendChild(el('div', 'sub', '复制下面全部文本保存起来：'));
        wrap.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); UI.toast('已复制到剪贴板', 'up'); } catch (e) {}
      });
      $$('#slotImport', sh).addEventListener('click', () => {
        const ta = el('textarea', '');
        ta.style.cssText = 'width:100%;height:140px;margin-top:8px;border-radius:10px;background:rgba(0,0,0,.45);' +
          'border:1px solid rgba(255,255,255,.18);color:var(--tx);padding:10px;font-size:10.5px;font-family:ui-monospace,monospace';
        ta.placeholder = '把存档文本粘贴到这里';
        const wrap = $$('#slotList', sh);
        wrap.innerHTML = '';
        wrap.appendChild(ta);
        const btn = el('button', 'btn btn-gold btn-sm', '导入到当前槽');
        btn.style.marginTop = '8px';
        wrap.appendChild(btn);
        bindTap(btn, () => {
          let o = null;
          try { o = JSON.parse(ta.value); } catch (e) { o = Store.importString(ta.value); }
          if (!o || !o.st) { UI.toast('这不是有效的存档', 'dn'); return; }
          Store.save(o, core.slot, { day: (o.st.date || {}).day || 0, level: (o.st.stats || {}).level || 1 });
          UI.toast('导入成功，正在重新加载', 'up');
          setTimeout(() => location.reload(), 600);
        });
      });
    };
    render();
  },

  exportSave(core, ui) {
    const s = Store.exportString({ st: core.st, market: core.market.serialize(), mochiko: core.mochiko });
    const sh = this.base(`
      <h3>导出存档</h3>
      <div class="sub">复制下面这段文本保存起来。想恢复时，把它粘回输入框。</div>
      <textarea id="shTxt" style="width:100%;height:110px;border-radius:11px;background:rgba(0,0,0,.42);
        border:1px solid var(--line2);color:var(--tx);padding:10px;font-size:11px;
        font-family:ui-monospace,monospace;resize:none">${s}</textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-ghost" id="shImp">导入</button>
        <button class="btn btn-gold" id="shOk">关闭</button></div>`);
    $('#shOk', sh).addEventListener('click', () => this.close());
    $('#shImp', sh).addEventListener('click', () => {
      const txt = $('#shTxt', sh).value;
      const o = Store.importString(txt);
      if (!o || !o.st) return UI.toast('这段文本不是有效的存档', 'dn');
      Store.save(o); location.reload();
    });
  },
  tutorialIndex(core) {
    const items = Object.keys(Tutorials.DEFS).map(k => {
      const t = Tutorials.DEFS[k];
      const seen = !!core.st.tutorials[k];
      return `<div class="kv" data-id="${k}"><span class="k">${seen ? '✅' : '⬜️'} ${t.title}</span><span class="v">${t.pages.length} 页</span></div>`;
    }).join('');
    const sh = this.base(`<h3>教学图鉴</h3><div class="sub">点任意条目重看。未解锁的也可以看。</div>${items}
      <button class="btn btn-ghost" id="shOk" style="width:100%;margin-top:12px">关闭</button>`);
    $$$('.kv', sh).forEach(k => k.addEventListener('click', () => { this.close(); Tutorials.force(k.dataset.id); }));
    $('#shOk', sh).addEventListener('click', () => this.close());
  },
};

function $(s, r) { return (r || document).querySelector(s); }

/* ------------------------------------------------------------ */
/* 确认框                                                         */
const Confirm = {
  ask(title, body, okText, onOk) {
    const sh = Sheets.base(`
      <h3>${title}</h3><div class="sub" style="font-size:13px;color:var(--tx)">${body}</div>
      <div class="row"><button class="btn btn-ghost" id="cfNo">取消</button>
      <button class="btn btn-danger" id="cfYes">${okText}</button></div>`);
    $('#cfNo', sh).addEventListener('click', () => Sheets.close());
    $('#cfYes', sh).addEventListener('click', () => { Sheets.close(); onOk(); });
  }
};

/* ------------------------------------------------------------ */
const Camera = {
  shake() {
    if (!UI.effects) return;
    const a = $$('#app');
    a.classList.remove('shake');
    void a.offsetWidth;
    a.classList.add('shake');
    setTimeout(() => a.classList.remove('shake'), 560);
  }
};
