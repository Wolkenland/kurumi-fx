/* ============================================================
 * 03-market.js  FX市场引擎
 *  - 多货币对随机过程（趋势 / 区间 / 暴走 三种状态切换）
 *  - 新闻事件冲击（跳空、闪崩、央行干预）
 *  - 日内/周内波动率调制、点差、スワップ（隔夜利息）
 *  - 每个"刻度"= 游戏内15分钟；每 8 刻度 = 1 根 K 线
 * ============================================================ */

const TICKS_PER_BAR = 8;          // 一根2小时K线
const BARS_PER_DAY = 3;           // 一天 3 根（简化交易时段）
const TICKS_PER_DAY = TICKS_PER_BAR * BARS_PER_DAY;

const PAIRS = {
  USDJPY: {
    id: 'USDJPY', name: '美ドル/円', short: 'USD/JPY', price: 110.20, digits: 3, pip: 0.01,
    spread: 0.006, vol: 0.0016, swapL: -0.000021, swapS: 0.000006, icon: '＄', color: '#3ddc97',
    desc: '美元兑日元。日本散户最爱的「主战场」，也是久留美母亲的葬身之地。',
    lotUnit: 10000,             // 1万通貨 = 1枚
  },
  EURJPY: {
    id: 'EURJPY', name: 'ユーロ/円', short: 'EUR/JPY', price: 130.55, digits: 3, pip: 0.01,
    spread: 0.008, vol: 0.0021, swapL: -0.000028, swapS: 0.000004, icon: '€', color: '#8cb4ff',
    desc: '欧元兑日元。波动比美元日元更大，久留美最常玩的「高波动猎场」。',
    lotUnit: 10000,
  },
  GBPJPY: {
    id: 'GBPJPY', name: '英ポンド/円', short: 'GBP/JPY', price: 152.30, digits: 3, pip: 0.01,
    spread: 0.012, vol: 0.0029, swapL: -0.000038, swapS: -0.000004, icon: '£', color: '#ffd166',
    desc: '英镑兑日元，俗称「野兽」。一天动几百点，杠杆的恶魔。',
    lotUnit: 10000,
  },
  CHFJPY: {
    id: 'CHFJPY', name: 'スイスフラン/円', short: 'CHF/JPY', price: 118.60, digits: 3, pip: 0.01,
    spread: 0.010, vol: 0.0017, swapL: -0.000058, swapS: 0.000009, icon: '₣', color: '#ff8fb1',
    desc: '瑞郎兑日元。持有成本极高，是久留美「必胜作战」所选的品种。',
    lotUnit: 10000,
  },
  ZARJPY: {
    id: 'ZARJPY', name: '南アフリカランド/円', short: 'ZAR/JPY', price: 7.450, digits: 3, pip: 0.001,
    spread: 0.004, vol: 0.0042, swapL: 0.000088, swapS: -0.000145, icon: 'R', color: '#c084fc',
    desc: '南非兰特兑日元。超级高息货币，能吃到惊人利息，也能一口气全吐回去。',
    lotUnit: 10000,
  },
  AUDJPY: {
    id: 'AUDJPY', name: '豪ドル/円', short: 'AUD/JPY', price: 85.40, digits: 3, pip: 0.01,
    spread: 0.009, vol: 0.0024, swapL: 0.000012, swapS: -0.000022, icon: 'A', color: '#5ee7df',
    desc: '澳元兑日元。资源货币，跟大宗商品和中国经济走。利息是正的——做多能收钱。',
    lotUnit: 10000,
  },
  TRYJPY: {
    id: 'TRYJPY', name: 'トルコリラ/円', short: 'TRY/JPY', price: 4.180, digits: 3, pip: 0.001,
    spread: 0.008, vol: 0.0075, swapL: 0.000420, swapS: -0.000560, icon: '₺', color: '#ff6b6b',
    desc: '土耳其里拉兑日元。年利差几十个点，套息交易者的天堂——也是坟场。波动是美元日元的五倍。',
    lotUnit: 10000,
  },
  MXNJPY: {
    id: 'MXNJPY', name: 'メキシコペソ/円', short: 'MXN/JPY', price: 5.820, digits: 3, pip: 0.001,
    spread: 0.006, vol: 0.0058, swapL: 0.000220, swapS: -0.000310, icon: 'M', color: '#f7b731',
    desc: '墨西哥比索兑日元。日本散户最爱的「高息提款机」，但它的暴跌从不提前通知。',
    lotUnit: 10000,
  },
};
const PAIR_ORDER = ['USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY', 'ZARJPY', 'AUDJPY', 'TRYJPY', 'MXNJPY'];

/* ---------- 新闻事件库 ---------- */
/* ================= 黑天鹅事件 =================
 * 低频、极端、能一击爆掉满仓的账户。
 * 每一条都对应现实中真实发生过的行情。
 * warn: 提前几拍给预警（情报力技能可以更早看到）
 */
const BLACK_SWAN = [
  { id: 'snb', name: '瑞士央行取消汇率下限',
    pairs: ['CHFJPY'], jump: [-0.085, -0.065], spreadMul: 10, dur: 70, warn: 3,
    head: '⚡ SNB 突袭：取消欧元兑瑞郎下限',
    desc: '2015 年 1 月真实发生过。瑞郎几分钟内暴涨 30%，券商的止损单全部失效，无数账户直接穿仓。',
    tag: 'crash' },
  { id: 'carry_unwind', name: '套息交易全面平仓',
    pairs: ['ZARJPY', 'TRYJPY', 'MXNJPY'], jump: [-0.075, -0.050], spreadMul: 6, dur: 60, warn: 2,
    head: '⚡ 套息交易崩盘：高息货币全线暴跌',
    desc: '全球风险偏好瞬间逆转，机构同时撤出高息货币。利差一夜之间不再重要，只有流动性说了算。',
    tag: 'crash' },
  { id: 'yen_storm', name: '避险风暴',
    pairs: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY'], jump: [-0.055, -0.038], spreadMul: 5, dur: 55, warn: 2,
    head: '⚡ 避险风暴：日元全线暴涨',
    desc: '某个地方出事了。所有人同时买入日元，做多日元对的人在这一刻赚翻，做空的人连反应的时间都没有。',
    tag: 'crash' },
  { id: 'flash_crash', name: '闪崩',
    pairs: ['GBPJPY'], jump: [-0.048, -0.032], spreadMul: 12, dur: 30, warn: 1,
    head: '⚡ 闪崩：英镑在 30 秒内暴跌',
    desc: '2016 年 10 月亚洲早盘，英镑在两分钟内崩了 6%。流动性消失了，报价停止更新，你的止损单变成了一张废纸。',
    tag: 'crash' },
  { id: 'intervention', name: '日本央行大规模干预',
    pairs: ['USDJPY'], jump: [-0.042, -0.030], spreadMul: 4, dur: 50, warn: 2,
    head: '⚡ 日银干预：美元日元瞬间暴跌',
    desc: '「我们正在密切关注外汇市场」——这句话之后，通常就是几十亿日元的砸盘。',
    tag: 'crash' },
];

const NEWS_POOL = [
  { t: '美雇用統計が予想を大幅に上回る', tag: 'bull', mag: [0.55, 1.35], dur: 26, pairs: ['USDJPY'] },
  { t: '米雇用統計、市場予想を大きく下回る', tag: 'bear', mag: [0.55, 1.35], dur: 26, pairs: ['USDJPY'] },
  { t: 'FRB議長「利下げを検討する」', tag: 'bear', mag: [0.7, 1.6], dur: 30, pairs: ['USDJPY'] },
  { t: 'FRB「予想より早い利上げも」タカ派発言', tag: 'bull', mag: [0.7, 1.5], dur: 30, pairs: ['USDJPY'] },
  { t: 'ECB、サプライズ利上げを発表', tag: 'bull', mag: [0.8, 1.6], dur: 28, pairs: ['EURJPY'] },
  { t: 'ユーロ圏の政治不安が再燃', tag: 'bear', mag: [0.6, 1.3], dur: 24, pairs: ['EURJPY'] },
  { t: '日銀、無制限の国債買い入れを表明', tag: 'bull', mag: [0.9, 1.8], dur: 34, pairs: ['USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY'] },
  { t: '日銀が為替介入に踏み切る（円買い）', tag: 'bear', mag: [1.2, 2.4], dur: 38, pairs: ['USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY'] },
  { t: '英中銀が予想外の利下げ', tag: 'bear', mag: [0.9, 1.7], dur: 30, pairs: ['GBPJPY'] },
  { t: '英国のインフレが記録的加速', tag: 'bull', mag: [0.8, 1.6], dur: 28, pairs: ['GBPJPY'] },
  { t: 'スイス国立銀行がサプライズ介入', tag: 'bear', mag: [1.4, 2.8], dur: 40, pairs: ['CHFJPY'] },
  { t: '中東情勢の緊迫で「有事の円買い」', tag: 'bear', mag: [0.9, 1.9], dur: 32, pairs: ['USDJPY', 'EURJPY', 'GBPJPY', 'ZARJPY'] },
  { t: '南アの格付け引き下げ観測', tag: 'bear', mag: [1.5, 3.0], dur: 34, pairs: ['ZARJPY'] },
  { t: '資源価格の高騰でランドに買い', tag: 'bull', mag: [1.3, 2.6], dur: 30, pairs: ['ZARJPY'] },
  { t: '米長期金利が急低下', tag: 'bear', mag: [0.5, 1.2], dur: 22, pairs: ['USDJPY'] },
  { t: 'サプライズのGDP上方修正', tag: 'bull', mag: [0.5, 1.2], dur: 22, pairs: ['USDJPY', 'EURJPY'] },
  { t: '薄商いの中、突発的なフラッシュクラッシュ', tag: 'crash', mag: [2.0, 4.0], dur: 18, pairs: ['GBPJPY', 'ZARJPY', 'CHFJPY'] },
  { t: '大手ヘッジファンドの大規模ロスカット観測', tag: 'crash', mag: [1.6, 3.2], dur: 24, pairs: ['USDJPY', 'ZARJPY'] },
  { t: '「円安是正」要人発言が相次ぐ', tag: 'bear', mag: [0.8, 1.6], dur: 26, pairs: ['USDJPY', 'EURJPY'] },
  { t: '新NISA人気で個人の外貨買いが加速', tag: 'bull', mag: [0.4, 0.9], dur: 20, pairs: ['USDJPY'] },
];

/* ---------- 单品种行情序列 ---------- */
class Series {
  constructor(def, seed) {
    this.def = def;
    this.rnd = U.rngFrom(seed);
    this.bars = [];          // {o,h,l,c,label,day}
    this.tickInBar = 0;
    this.cur = null;         // 正在形成的K线
    this.price = def.price;
    this.regime = 'range';
    this.regimeLeft = 40;
    this.trend = 0;
    this.volMul = 1;
    this.news = null;        // {dir, left, power}
    this.lastTickMove = 0;
    this.rangeHigh = def.price; this.rangeLow = def.price;
    this.dayVol = 1;
    this._seedBars(220);
  }

  _seedBars(n) {
    // 用同一随机过程预热历史，让开局图表就有"历史感"
    for (let i = 0; i < n; i++) {
      const b = { o: this.price, h: this.price, l: this.price, c: this.price, label: '', day: 0 };
      for (let t = 0; t < TICKS_PER_BAR; t++) this._step(b);
      b.o = b.o; this.bars.push(b);
    }
    // 用临时条丢弃，最终 cur 从当前价开始
    this.bars = this.bars.slice(-200);
    this.cur = null;
    this.tickInBar = 0;
    this.bars.forEach((b, i) => { b.label = `${(i % 12) + 1}月${(i % 28) + 1}日`; });
  }

  _step(b) {
    const d = this.def;
    if (this.regimeLeft-- <= 0) {
      const r = this.rnd();
      if (r < 0.36) { this.regime = 'trend'; this.trend = (this.rnd() < 0.5 ? -1 : 1) * (0.35 + this.rnd() * 0.85) * d.vol * 60; }
      else if (r < 0.78) { this.regime = 'range'; this.trend = 0; }
      else { this.regime = 'wild'; this.trend = (this.rnd() < 0.5 ? -1 : 1) * (0.2 + this.rnd() * 0.6) * d.vol * 60; }
      this.regimeLeft = 18 + Math.floor(this.rnd() * 70);
      if (this.regime === 'range') { this.rangeHigh = this.price * (1 + d.vol * 12 * (0.4 + this.rnd())); this.rangeLow = this.price * (1 - d.vol * 12 * (0.4 + this.rnd())); }
    }
    let sigma = d.vol * this.volMul;
    if (this.regime === 'wild') sigma *= 2.6;
    if (this.regime === 'trend') sigma *= 1.25;

    let drift = 0;
    if (this.regime === 'trend') drift = this.trend * 0.006 * this.volMul;
    if (this.regime === 'range') {
      if (this.price > this.rangeHigh) drift = -(this.price - this.rangeHigh) * 0.02;
      else if (this.price < this.rangeLow) drift = (this.rangeLow - this.price) * 0.02;
    }

    // 新闻事件
    if (this.news) {
      drift += this.news.dir * this.news.power * 0.02;
      this.news.left--;
      this.news.power *= 0.985;
      if (this.news.left <= 0) this.news = null;
    }

    const shock = this.rnd() < 0.012 ? U.gauss(this.rnd) * sigma * 5 : 0;
    let dP = drift + U.gauss(this.rnd) * sigma + shock;
    // 极端保护：单刻度不超过 6%
    dP = U.clamp(dP, -this.price * 0.06, this.price * 0.06);
    const np = Math.max(this.def.price * 0.35, this.price + dP);
    this.lastTickMove = np - this.price;
    this.price = np;
    if (this.price > b.h) b.h = this.price;
    if (this.price < b.l) b.l = this.price;
    b.c = this.price;
    return this.lastTickMove;
  }

  tick() {
    if (!this.cur) this.cur = { o: this.price, h: this.price, l: this.price, c: this.price, label: '', day: 0 };
    this._step(this.cur);
    this.tickInBar++;
    if (this.tickInBar >= TICKS_PER_BAR) {
      this.bars.push(this.cur);
      if (this.bars.length > 620) this.bars.shift();
      this.cur = null;
      this.tickInBar = 0;
      return true;   // 新K线成立
    }
    return false;
  }

  /** 图表用的条序列（含正在形成的一根） */
  view() {
    if (!this.cur) return this.bars;
    const c = Object.assign({}, this.cur);
    return this.bars.concat([c]);
  }
  get last() {
    return this.cur ? this.cur.c : (this.bars.length ? this.bars[this.bars.length - 1].c : this.def.price);
  }

  /** Bid / Ask */
  bid() { return this.price; }
  ask() { return this.price + this.def.spread; }

  labelDay(day, barIdx) {
    const dt = U.addDays(2021, 4, 5, day);
    return `${dt.m}/${dt.d}`;
  }
}

/* ---------- 市场总控 ---------- */
class Market {
  constructor(seed) {
    this.seed = seed;
    this.rnd = U.rngFrom(seed ^ 0x9e3779b9);
    this.map = {};
    PAIR_ORDER.forEach((id, i) => { this.map[id] = new Series(PAIRS[id], (seed + i * 7919) >>> 0); });
    this.tickCount = 0;
    this.day = 0;
    this.newsLog = [];
    this.listeners = [];
    this.active = 'USDJPY';
    this.nextNews = 30 + Math.floor(this.rnd() * 60);
    this.lastVolDay = 1;
    this.corr = 0.45;                       // 品种间相关性
    this.liqShock = null;
    this.intervention = 0;                  // 日银警戒度
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { this.listeners.forEach(f => { try { f(ev); } catch (e) {} }); }

  pair(id) { return this.map[id || this.active]; }
  ids() { return PAIR_ORDER; }

  tick() {
    const common = U.gauss(this.rnd) * 0.0009;
    const made = [];
    for (const id of PAIR_ORDER) {
      const s = this.map[id];
      if (s.tick()) {
        s.bars.forEach((b, i) => { b.label = `${(i % 12) + 1}/${(i % 28) + 1}`; });
        made.push(id);
      }
      // 相关性：让所有品种共享一小部分冲击
      s.price = Math.max(0.3, s.price + common * s.def.price * this.corr);
      if (s.cur) {
        s.cur.c = s.price;
        if (s.price > s.cur.h) s.cur.h = s.price;
        if (s.price < s.cur.l) s.cur.l = s.price;
      } else if (s.bars.length) {
        const lb = s.bars[s.bars.length - 1];
        lb.c = s.price; lb.h = Math.max(lb.h, s.price); lb.l = Math.min(lb.l, s.price);
      }
    }
    this.tickCount++;
    if (this.tickCount % TICKS_PER_BAR === 0) { /* 每根K线一个小区间 */ }
    if (this.tickCount % TICKS_PER_DAY === 0) {
      this.day++;
      this.dayNews();
      this.maybeBlackSwan();
    }
    if (this.swan) {
      this.swan.left--;
      if (this.swan.left <= 0) this.swan = null;
    }
    // 预定新闻
    if (--this.nextNews <= 0) {
      this.fireNews();
      this.nextNews = 22 + Math.floor(this.rnd() * 70);
    }
    return { made, day: this.day };
  }

  /* ===== 黑天鹅 ===== */
  /**
   * 每天判定一次是否触发黑天鹅（默认 4.5%）。
   * 触发时：相关品种瞬间跳空 + 点差暴涨，持续 dur 个 tick。
   */
  maybeBlackSwan() {
    if (this.swan) return null;                      // 已有事件在生效
    if (this.rnd() > 0.045) return null;
    const ev = BLACK_SWAN[Math.floor(this.rnd() * BLACK_SWAN.length)];
    const mag = ev.jump[0] + this.rnd() * (ev.jump[1] - ev.jump[0]);
    const hit = [];
    for (const id of ev.pairs) {
      const s = this.map[id];
      if (!s) continue;
      // 按比例跳空（直接改价格，不经过正常波动）
      const from = s.price;
      s.price = Math.max(0.3, s.price * (1 + mag));
      if (s.cur) {
        s.cur.c = s.price;
        s.cur.h = Math.max(s.cur.h, from);
        s.cur.l = Math.min(s.cur.l, s.price);
      } else if (s.bars.length) {
        const lb = s.bars[s.bars.length - 1];
        lb.c = s.price;
        lb.h = Math.max(lb.h, from);
        lb.l = Math.min(lb.l, s.price);
      }
      hit.push({ id, from, to: s.price, pct: (s.price / from - 1) * 100 });
    }
    this.swan = {
      ev, mag, hit, left: ev.dur,
      spreadMul: ev.spreadMul || 4,
      atDay: this.day,
    };
    return this.swan;
  }

  /** 黑天鹅剩余 tick */
  swanLeft() { return this.swan ? this.swan.left : 0; }

  /** 当前点差倍率（黑天鹅期间放大） */
  spreadMulNow() { return this.swan ? (this.swan.spreadMul || 4) : 1; }

  dayNews() {
    // 每日隔夜利息已由 lever 结算；这里处理周末跳空与波动率
    const r = this.rnd();
    this.lastVolDay = 0.7 + r * 1.1;
    if (r > 0.90) {
      // 周一跳空
      for (const id of PAIR_ORDER) {
        const s = this.map[id];
        const gapBp = (this.rnd() < 0.5 ? -1 : 1) * (0.3 + this.rnd() * 1.4) * s.def.vol * 22;
        s.price = Math.max(0.5, s.price * (1 + gapBp));
        if (s.cur) { s.cur.c = s.price; s.cur.h = Math.max(s.cur.h, s.price); s.cur.l = Math.min(s.cur.l, s.price); }
      }
      this.emit({ type: 'gap' });
    }
  }

  fireNews() {
    const n = NEWS_POOL[Math.floor(this.rnd() * NEWS_POOL.length)];
    const targets = n.pairs.slice();
    const isCrash = n.tag === 'crash';
    const isBear = n.tag === 'bear';
    const item = { t: n.t, tag: n.tag, dt: this.day, id: ++idCounter, focus: targets[0] };
    for (const id of targets) {
      const s = this.map[id];
      const mag = n.mag[0] + this.rnd() * (n.mag[1] - n.mag[0]);
      let dir = isCrash ? (this.rnd() < 0.62 ? -1 : 1) : (n.tag === 'bear' ? -1 : 1);
      // 日银警戒：极端弱日元会招来更猛烈的反向冲击
      if (s.price > s.def.price * 1.14 && dir > 0) this.intervention += 0.2;
      const power = dir * mag * s.def.vol * 30 * (isCrash ? 1.5 : 1);
      s.news = { dir, power: power * 12, left: n.dur, mag, tag: n.tag };
      // 立即一次跳空
      const jump = dir * mag * s.def.vol * 9;
      s.price = Math.max(0.5, s.price + jump);
      if (s.cur) { s.cur.c = s.price; s.cur.h = Math.max(s.cur.h, s.price); s.cur.l = Math.min(s.cur.l, s.price); }
    }
    this.newsLog.unshift(item);
    if (this.newsLog.length > 40) this.newsLog.pop();
    this.emit({ type: 'news', news: item });
    if (isCrash) this.emit({ type: 'crash' });
  }

  /** 久留美式黑色幽默：主角持仓达到一定规模时会遭遇逆风 */
  nudgeAgainst(dir, strength) {
    const s = this.pair();
    s.news = { dir: -dir, power: s.def.vol * 22 * strength, left: 20, mag: strength, tag: 'scripted' };
    const jump = -dir * s.def.vol * 4 * strength;
    s.price = Math.max(0.5, s.price + jump);
    if (s.cur) { s.cur.c = s.price; s.cur.h = Math.max(s.cur.h, s.price); s.cur.l = Math.min(s.cur.l, s.price); }
    this.emit({ type: 'scripted', dir: -dir });
  }

  /**
   * 紧凑序列化：存档体积从 ~147KB 压到 ~20KB
   *  · 价格整数化（×1000 保留 3 位小数），浮点数不再存 15 位
   *  · K 线只留最近 120 根（图表够用），且用 [o,h,l,c] 数组而非对象
   *  · 不存 label，恢复时按索引重建
   */
  serialize() {
    const KEEP = 120;
    const ip = v => Math.round(v * 1000);
    const o = {
      v: 2,                                   // 序列化格式版本
      seed: this.seed, tickCount: this.tickCount, day: this.day,
      nextNews: this.nextNews, active: this.active, pairs: {},
    };
    for (const id of PAIR_ORDER) {
      const s = this.map[id];
      const bars = s.bars.slice(-KEEP).map(b => [ip(b.o), ip(b.h), ip(b.l), ip(b.c)]);
      o.pairs[id] = {
        p: ip(s.price),
        rg: s.regime, tr: Math.round(s.trend * 1e6), rl: s.regimeLeft,
        b: bars, tib: s.tickInBar,
        cur: s.cur ? [ip(s.cur.o), ip(s.cur.h), ip(s.cur.l), ip(s.cur.c)] : null,
        rh: ip(s.rangeHigh), rlo: ip(s.rangeLow),
      };
    }
    return o;
  }
  restore(o) {
    if (!o) return;
    this.tickCount = o.tickCount; this.day = o.day;
    this.nextNews = o.nextNews; this.active = o.active || this.active;
    const dp = v => v / 1000;
    const rebuildLabel = (bars) => bars.forEach((b, i) => {
      b.label = `${(i % 12) + 1}/${(i % 28) + 1}`;
    });

    for (const id in o.pairs) {
      const s = this.map[id]; if (!s) continue;
      const p = o.pairs[id];
      if (o.v === 2) {
        // ---- 新紧凑格式 ----
        s.price = dp(p.p);
        s.regime = p.rg; s.trend = p.tr / 1e6; s.regimeLeft = p.rl;
        s.bars = (p.b || []).map(a => ({ o: dp(a[0]), h: dp(a[1]), l: dp(a[2]), c: dp(a[3]), label: '' }));
        rebuildLabel(s.bars);
        s.tickInBar = p.tib || 0;
        s.cur = p.cur ? { o: dp(p.cur[0]), h: dp(p.cur[1]), l: dp(p.cur[2]), c: dp(p.cur[3]), label: '', day: 0 } : null;
        s.rangeHigh = dp(p.rh); s.rangeLow = dp(p.rlo);
      } else {
        // ---- 旧格式（向后兼容）----
        s.price = p.price; s.regime = p.regime; s.trend = p.trend; s.regimeLeft = p.regimeLeft;
        s.bars = p.bars || s.bars; s.tickInBar = p.tickInBar; s.cur = p.cur;
        s.rangeHigh = p.rh || s.rangeHigh; s.rangeLow = p.rl || s.rangeLow;
        rebuildLabel(s.bars);
      }
    }
  }
}
let idCounter = 1;
