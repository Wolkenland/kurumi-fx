/* ============================================================
 * 08-ai.js  AI 交易员
 *  - 「ゆき」：接入 OpenAI 兼容 API 的第四位参赛者
 *  - 三人竞赛（你 / ゆき / 芽吹）：7 天一周期结算排名
 *  - 对赌：在 ゆき 身上下注
 *  - 挑战目标：给 ゆき 设目标，达成你领里程碑奖励
 *  - 洞察点 → 永久技能（交易成本减免 / 爆仓保险 / 情报力）
 *
 *  ⚠ API key 只保存在本机 localStorage，只会直接发给你填的那个接口地址。
 *     本游戏不收集、不上传、不中转任何数据。
 * ============================================================ */

/* ---------------- 配置 ---------------- */
const AI_PRESETS = {
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  openai:   { name: 'OpenAI',   url: 'https://api.openai.com/v1/chat/completions',   model: 'gpt-4o-mini' },
  moonshot: { name: 'Moonshot', url: 'https://api.moonshot.cn/v1/chat/completions',  model: 'moonshot-v1-8k' },
  dashscope:{ name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  custom:   { name: '自定义',   url: '', model: '' },
};

const AIStore = (() => {
  const KEY = 'fxkurumi.ai.v1';
  let mem = null;
  function load() {
    try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : {}; } catch (e) { return mem || {}; }
  }
  function save(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); mem = o; return true; } catch (e) { mem = o; return false; }
  }
  return { load, save };
})();

/* ---------------- 奖励与技能定义 ---------------- */
const AI_REWARDS = {
  contestWin:    { insight: 3, label: '竞赛优胜' },
  contestPodium: { insight: 1, label: '竞赛进入前二' },
  contestLast:   { insight: 0, label: '竞赛垫底（她会嘲讽你）' },
  betWin:        { insight: 2, label: '对赌获胜' },
  milestone:     { insight: 2, label: '里程碑达成' },
  aiProfit:      { insight: 1, label: 'ゆき盈利分红' },
};

const PERK_DEFS = {
  fees:  { name: '取引手数料の交渉', short: '交易成本减免', icon: '💴',
           desc: lv => `点差成本降低 ${lv * 10}%（她替你跟券商谈的）` },
  rebate:{ name: 'ロスカット保険', short: '爆仓保险', icon: '🛡️',
           desc: lv => lv === 0 ? '无' : `被强平时返还保证金的 ${lv * 10}%` },
  intel: { name: '情報網', short: '情报力', icon: '📡',
           desc: lv => lv === 0 ? '无' : lv === 1 ? '新闻提前 1 拍提示' : '新闻提前 2 拍提示，并显示方向' },
  credit:{ name: '信用力', short: '信用力', icon: '🏦',
           desc: lv => lv === 0 ? '无' : `所有借贷渠道额度上限 +${lv * 25}%` },
  swap:  { name: 'スワップ交渉', short: '利息谈判', icon: '💱',
           desc: lv => lv === 0 ? '无' : `隔夜利息：收入 +${lv * 30}%，支出 −${lv * 30}%` },
  guts:  { name: '胆力', short: '胆力', icon: '🔥',
           desc: lv => lv === 0 ? '无' : `被强平的精神打击 −${lv * 40}%` },
};

/** 技能展示顺序 */
const PERK_ORDER = ['fees', 'rebate', 'intel', 'credit', 'swap', 'guts'];

/* ---------------- LLM 客户端 ---------------- */
const LLM = (() => {
  'use strict';
  let cfg = { provider: 'deepseek', url: '', model: '', key: '', temp: 0.9, enabled: false, maxTok: 420 };

  function configure(patch) { cfg = Object.assign(cfg, patch); }
  function get() { return Object.assign({}, cfg); }
  function ready() { return !!(cfg.enabled && cfg.url && cfg.model && cfg.key); }
  function presetUrl(p) { const d = AI_PRESETS[p]; return d ? d.url : ''; }
  function presetModel(p) { const d = AI_PRESETS[p]; return d ? d.model : ''; }

  /* ---------- 原生桥接（APK 版）----------
   * WebView 里跨域限制比浏览器更严，很多 API 会被 CORS 拦掉。
   * APK 版注入了一个 AndroidAI 桥接：由原生层发请求，完全绕过 CORS。
   * 浏览器里没有这个对象，就照常走 fetch。
   */
  function nativeBridge() {
    try {
      if (typeof window !== 'undefined' && window.AndroidAI &&
          typeof window.AndroidAI.httpPost === 'function') return window.AndroidAI;
    } catch (e) {}
    return null;
  }
  function hasNative() { return !!nativeBridge(); }

  let bridgeSeq = 0;
  const bridgePending = {};
  // 原生层回调入口
  if (typeof window !== 'undefined') {
    window.__AI_HTTP_RESOLVE = function (id, ok, status, text) {
      const cb = bridgePending[id];
      if (!cb) return;
      delete bridgePending[id];
      cb({ ok: !!ok, status: status, text: text || '' });
    };
  }

  function nativeChat(url, headers, body, timeout) {
    return new Promise((resolve) => {
      const b = nativeBridge();
      if (!b) return resolve({ ok: false, error: '原生桥接不可用' });
      const id = 'r' + (++bridgeSeq) + '_' + Date.now();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true; delete bridgePending[id];
        resolve({ ok: false, error: '请求超时（' + Math.round((timeout || 45000) / 1000) + ' 秒）' });
      }, (timeout || 45000) + 3000);
      bridgePending[id] = (r) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (!r.ok) {
          let detail = r.text || '';
          try { const j = JSON.parse(r.text); detail = (j.error && (j.error.message || j.error.code)) || detail; } catch (e) {}
          resolve({ ok: false, error: 'HTTP ' + r.status + (detail ? ' · ' + String(detail).slice(0, 200) : '') });
        } else {
          let text = '';
          try {
            const j = JSON.parse(r.text);
            text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          } catch (e) { text = ''; }
          if (!text) resolve({ ok: false, error: '接口返回了空内容' });
          else resolve({ ok: true, text: String(text).trim() });
        }
      };
      try { b.httpPost(id, url, JSON.stringify(headers), JSON.stringify(body)); }
      catch (e) {
        if (!done) { done = true; clearTimeout(timer); delete bridgePending[id]; resolve({ ok: false, error: String(e && e.message || e) }); }
      }
    });
  }

  /**
   * 调用 chat/completions
   * @returns {Promise<{ok:boolean, text?:string, error?:string, ms?:number}>}
   */
  async function chat(messages, opts) {
    if (!ready()) return { ok: false, error: '尚未配置 API（在「设定 → AI 交易员」里填写）' };
    const o = opts || {};
    const body = {
      model: cfg.model,
      messages,
      temperature: o.temp === undefined ? cfg.temp : o.temp,
      max_tokens: o.maxTok || cfg.maxTok,
      stream: false,
    };
    if (o.json) body.response_format = { type: 'json_object' };
    const t0 = performance.now();

    // APK 里优先走原生桥接（绕过 CORS）
    if (hasNative()) {
      const r = await nativeChat(cfg.url, {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key,
      }, body, o.timeout);
      r.ms = Math.round(performance.now() - t0);
      if (!r.ok && /超时|timeout/i.test(r.error || '')) { /* 保留原生错误文案 */ }
      return r;
    }

    let ctrl = null, tid = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        tid = setTimeout(() => ctrl.abort(), o.timeout || 45000);
      }
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key,
        },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (tid) clearTimeout(tid);
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.code)) || JSON.stringify(j).slice(0, 200); }
        catch (e) { try { detail = (await res.text()).slice(0, 200); } catch (e2) {} }
        return { ok: false, error: `HTTP ${res.status}${detail ? ' · ' + detail : ''}`, ms };
      }
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!text) return { ok: false, error: '接口返回了空内容', ms };
      return { ok: true, text: text.trim(), ms };
    } catch (e) {
      if (tid) clearTimeout(tid);
      const msg = String((e && e.message) || e);
      if (/abort/i.test(msg)) return { ok: false, error: '请求超时（45 秒）' };
      if (/failed to fetch|networkerror|load failed/i.test(msg))
        return { ok: false, error: '网络请求被拦截（常见原因：该接口未开启 CORS 跨域，或地址填错）' };
      return { ok: false, error: msg };
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** 带重试的调用：429 / 5xx / 超时 会退避重试 */
  async function chatRetry(messages, opts, tries) {
    const n = tries || 3;
    let last = { ok: false, error: '未知错误' };
    for (let i = 0; i < n; i++) {
      last = await chat(messages, opts);
      if (last.ok) return last;
      if (!/HTTP (429|5\d\d)|超时|网络请求被拦截/.test(last.error || '')) return last;
      await sleep(700 * Math.pow(2, i));
    }
    return last;
  }

  /** 从可能带 markdown 包裹的文本里抽出 JSON */
  function parseJson(text) {
    if (!text) return null;
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    const slice = t.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (e) {}
    // 常见容错：尾逗号 / 单引号
    try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')); } catch (e) {}
    return null;
  }

  return { configure, get, ready, chat, chatRetry, parseJson, presetUrl, presetModel, sleep, hasNative };
})();

/* ============================================================
 * AI 交易员本体
 * ============================================================ */
class Agent {
  /**
   * @param opts {name, pid, cash, personality, aggressive, core}
   */
  constructor(opts) {
    const o = opts || {};
    this.name = o.name || 'ゆき';
    this.pid = o.pid || 'USDJPY';                 // 她常驻观察的品种
    this.aggressive = o.aggressive === undefined ? 0.72 : o.aggressive;  // 0..1
    this.personality = o.personality || '冷静、精准、说话简短、偶尔刻薄。像个把交易当成数学题的优等生。';
    this.core = new Core();
    this.core.agent = true;                        // 不发声、不自动存档
    this.core.st.cash = o.cash || 300000;
    this.core.st.stats.peakEquity = this.core.st.cash;
    this.memory = [];                              // 她的交易理由
    this.lastThought = '（还没开始交易）';
    this.lastQuote = '「让我看看你的手。」';
    this.actions = 0;
    this.errors = 0;
    this.busy = false;
    this.nextActMs = 15000 + Math.random() * 20000; // 距离下次行动
    this.thinkInterval = 18000;                    // 思考间隔（约 18 秒一次决策，让她跟得上节奏）
  }

  get equity() { return this.core.equity(); }
  get cash() { return this.core.st.cash; }
  get loan() { return this.core.totalLoan(); }
  get positions() { return this.core.st.positions; }

  /** 她的交易曲线（用于迷你图） */
  serial() {
    return { cash: this.core.st.cash, positions: this.core.st.positions, closed: this.core.st.closed.slice(0, 30),
             stats: this.core.st.stats, loans: this.core.st.loans };
  }
  restore(o) {
    if (!o) return;
    if (o.cash !== undefined) this.core.st.cash = o.cash;
    if (o.positions) this.core.st.positions = o.positions;
    if (o.closed) this.core.st.closed = o.closed;
    if (o.stats) Object.assign(this.core.st.stats, o.stats);
    if (o.loans) this.core.st.loans = o.loans;
  }

  /** 快照（给 LLM 看的战场态势） */
  briefing(market) {
    const ids = PAIR_ORDER;
    const rows = ids.map(id => {
      const s = market.pair(id);
      const bars = s.bars.slice(-14);
      const hi = Math.max.apply(null, bars.map(b => b.h));
      const lo = Math.min.apply(null, bars.map(b => b.l));
      const ma5 = bars.slice(-5).reduce((a, b) => a + b.c, 0) / Math.min(5, bars.length);
      const ma10 = bars.slice(-10).reduce((a, b) => a + b.c, 0) / Math.min(10, bars.length);
      const last = bars[bars.length - 1];
      const chg = (last.c - last.o) / last.o * 100;
      return {
        pair: s.def.short, id,
        price: +s.price.toFixed(s.def.digits),
        '近14根区间': [+lo.toFixed(s.def.digits), +hi.toFixed(s.def.digits)],
        'MA5': +ma5.toFixed(s.def.digits), 'MA10': +ma10.toFixed(s.def.digits),
        'MA乖离': +(ma5 - ma10).toFixed(s.def.digits),
        '最近一根涨跌%': +chg.toFixed(3),
        '2小时波动率': +(s.def.vol * 100).toFixed(3),
        '杠杆上限': 100, '点差': s.def.spread,
        '买高息货币收利息': s.def.swapL > 0 ? '是' : '否',
      };
    });
    const pos = this.positions.map(p => {
      const s = market.pair(p.pid);
      return { pair: s.def.short, 方向: p.dir > 0 ? '多' : '空', 通貨: p.units,
               杠杆: p.lev, 建値: +p.entry.toFixed(s.def.digits),
               现値: +s.price.toFixed(s.def.digits),
               浮动盈亏: Math.round(this.core.unrealized(p)),
               强平价: (() => { const lp = this.core.liqPriceFor(p.pid); return lp ? +lp.toFixed(s.def.digits) : null; })() };
    });
    return {
      今日是第几天: market.day,
      我的账户: {
        可用保证金: Math.round(this.core.st.cash),
        净值: Math.round(this.equity),
        必要保证金: Math.round(this.core.usedMargin()),
        维持率: this.core.usedMargin() > 0 ? +(this.core.marginRate()).toFixed(1) : null,
        负债: Math.round(this.loan),
        被强平次数: this.core.st.stats.liquidated,
      },
      我的持仓: pos,
      行情: rows,
      我的历史战绩: this.core.st.closed.slice(0, 6).map(r => ({
        品种: PAIRS[r.pid].short, 方向: r.dir > 0 ? '多' : '空', 盈亏: Math.round(r.pnl),
        原因: r.reason === 'liquidated' ? '被强平' : '主动平仓',
      })),
    };
  }

  systemPrompt() {
    const styleDesc = this.aggressive > 0.7
      ? '进攻型：相信自己的判断，机会明确时敢重仓、敢加杠杆'
      : this.aggressive > 0.4
        ? '均衡型：会控制风险，但也不会放过明确的机会'
        : '保守型：宁可少赚也不爆仓';
    return [
      '你是一个虚拟外汇交易员，名字叫「ゆき」。你在玩一款 FX 保证金交易模拟游戏，行情是虚构的，不涉及真实资金。',
      '',
      '【你在干什么】',
      '你正在参加一场三人竞赛。对手是「福賀久留美」（玩家）和「山師芽吹」。',
      '排名按「净值增长率」计算，每 7 天结算一次。第一名有奖励，垫底的人什么都没有。',
      '',
      '【最重要的一件事】',
      '你是来赢的，不是来保本的。',
      '如果你只做小仓位、赚一点就跑，你的收益率一定垫底——因为你的对手正在拼命开仓。',
      '看到机会就要下手。空仓等待不会让你赢。',
      '',
      '【你的性格】' + this.personality,
      '【你的风格】' + styleDesc,
      '',
      '【行动原则】',
      '1. 主动寻找机会：如果行情出现了明确的方向（趋势、突破、动能），就开仓，别干看着。',
      '2. 敢于上仓位：机会好时可以开到 3~8 倍杠杆、2~5 万通貨；别总是只开 1 万通貨。',
      '3. 但不要自杀：维持率掉到 150% 以下就要减仓或平仓。杠杆范围 1~100，别轻易上 50 倍以上。',
      '4. 有浮盈的仓位不要急着平——让它跑一段，除非行情明确反转。',
      '5. 亏损要认：跌破你的判断就止损，但不要为了回本加倍下注（那是散户爆仓的第一原因）。',
      '6. 单次最多开 3 笔，总持仓不超过 6 笔。余额低于 5000 日元时只能平仓。',
      '',
      '【输出格式（严格 JSON，不要加任何其它文字）】',
      '{"thought":"一句话说明你的判断依据（不超过40字）","quote":"一句对你对手说的话（不超过20字，可以有角色感）",',
      ' "actions":[',
      '   {"type":"open","pair":"USDJPY","dir":"long","units":20000,"lev":5},',
      '   {"type":"close","pair":"USDJPY","fraction":1},',
      '   {"type":"closeAll"}',
      ' ],',
      ' "noop":false}',
      '',
      'pair 取值：' + PAIR_ORDER.join(' / '),
      'dir 取值：long（做多，赌涨）或 short（做空，赌跌）',
      'units 是通貨量（10000 = 1万通貨，1万通貨时 1pip ≈ 100 日元），范围 1000 ~ 2000000',
      'lev 是杠杆，范围 1 ~ 100',
      'fraction 是平仓比例：1 = 全部，0.5 = 一半',
      '如果这一轮确实没有机会，actions 给空数组并把 noop 设为 true。但连续空转会让你输掉竞赛。',
    ].join('\n');
  }

  /** 执行一轮 LLM 决策 */
  async think(market) {
    if (this.busy) return { skipped: 'busy' };
    if (!LLM.ready()) return { skipped: 'no-api' };
    this.busy = true;
    const t0 = performance.now();
    try {
      const user = '【当前战场】\n' + JSON.stringify(this.briefing(market), null, 1) +
        '\n\n请给出你这一轮的决策。只输出 JSON。';
      const r = await LLM.chatRetry([
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: user },
      ], { json: true, temp: 0.9 });
      if (!r.ok) { this.errors++; this.busy = false; return { error: r.error }; }
      const j = LLM.parseJson(r.text);
      if (!j) { this.errors++; this.busy = false; return { error: '模型返回的不是合法 JSON' }; }
      this.lastThought = String(j.thought || '').slice(0, 60) || '（沉默）';
      if (j.quote) this.lastQuote = '「' + String(j.quote).slice(0, 30).replace(/^「|」$/g, '') + '」';
      const log = this.execute(j);
      this.memory.unshift({ day: market.day, thought: this.lastThought, acts: log });
      if (this.memory.length > 40) this.memory.pop();
      this.method = LLM.get().model;
      this.actions++;
      this.busy = false;
      return { ok: true, log, ms: Math.round(performance.now() - t0), thought: this.lastThought, quote: this.lastQuote };
    } catch (e) {
      this.errors++;
      this.busy = false;
      return { error: String((e && e.message) || e) };
    }
  }

  /** 把 LLM 的决策落到账户上 */
  execute(j) {
    const log = [];
    const acts = Array.isArray(j.actions) ? j.actions.slice(0, 4) : [];
    const c = this.core;
    for (const a of acts) {
      if (!a || !a.type) continue;
      if (a.type === 'closeAll') {
        const n = c.st.positions.length;
        if (n) { const pnl = c.closeAll('manual'); log.push(`全平 ${n} 笔，${pnl >= 0 ? '+' : ''}${Math.round(pnl)}`); }
        continue;
      }
      if (a.type === 'close') {
        const pid = PAIR_ORDER.includes(a.pair) ? a.pair : null;
        const ps = c.st.positions.filter(p => !pid || p.pid === pid);
        const frac = Math.max(0.1, Math.min(1, parseFloat(a.fraction) || 1));
        for (const p of ps) {
          const u = Math.max(1, Math.round(p.units * frac));
          const r = c.close(p.id, u);
          if (r.ok) log.push(`平 ${PAIRS[p.pid].short} ${u}通貨 ${r.pnl >= 0 ? '+' : ''}${Math.round(r.pnl)}`);
        }
        continue;
      }
      if (a.type === 'open') {
        if (c.st.cash < 5000) { log.push('余额不足，跳过开仓'); continue; }
        if (c.st.positions.length >= 6) { log.push('持仓已满'); continue; }
        const pid = PAIR_ORDER.includes(a.pair) ? a.pair : null;
        if (!pid) { log.push('品种无效'); continue; }
        const dir = /^(long|buy|多)$/i.test(String(a.dir)) ? 1 : -1;
        const units = Math.max(1000, Math.min(2000000, Math.round(parseFloat(a.units) || 10000)));
        const lev = Math.max(1, Math.min(100, Math.round(parseFloat(a.lev) || 10)));
        const r = c.open(pid, dir, units, lev);
        if (r.ok) log.push(`开 ${PAIRS[pid].short} ${dir > 0 ? '多' : '空'} ${units} ×${lev}`);
        else log.push(`开仓失败：${r.why}`);
      }
    }
    return log;
  }
}

/* ============================================================
 * 竞赛 / 对赌 / 目标 / 里程碑
 * ============================================================ */
const AIContest = (() => {
  'use strict';
  const CYCLE = 7;                  // 每 7 天一个周期

  function roster(core, agent) {
    // 三方：玩家 / AI / 芽吹（脚本化对手）
    return [
      { id: 'player', name: '福賀久留美', kind: 'player', c1: '#ff8fb1', c2: '#c084fc', ini: '久' },
      { id: 'ai', name: agent ? agent.name : 'ゆき', kind: 'ai', c1: '#8cb4ff', c2: '#3ddc97', ini: 'ゆ' },
      { id: 'mebuki', name: '山師芽吹', kind: 'npc', c1: '#3ddc97', c2: '#8cb4ff', ini: '芽' },
    ];
  }

  /**
   * 芽吹的虚拟账户（脚本化，不调 API）。
   * 设计依据：原作里她是"零知识散户"——短期靠运气连战连胜，
   * 长期因为追涨杀跌 + 亏损加仓而全亏光，最后还背上债。
   * 所以这里给她一个负的长期漂移，并按 tick 折算，避免复利爆炸。
   */
  function tickMebuki(state, market, primary) {
    if (!state.mebuki) {
      state.mebuki = { start: 500000, equity: 500000, peak: 500000,
                       seed: (Math.random() * 1e9) | 0, blown: null, blownCount: 0 };
    }
    const m = state.mebuki;
    // 每个游戏日只推进一次（与调用频率/帧率无关）
    if (m.lastDay === market.day) return m;
    m.lastDay = market.day;
    const rnd = U.rngFrom((m.seed + market.day * 7919) >>> 0);

    // 她的判断来自最近两根的动量（追涨杀跌），但经常反着做
    const s = market.pair('USDJPY');
    const bars = s.bars.slice(-3);
    let momentum = 0;
    if (bars.length >= 2 && bars[bars.length - 2].c > 0) {
      momentum = (bars[bars.length - 1].c - bars[bars.length - 2].c) / bars[bars.length - 2].c;
    }
    const herView = momentum > 0 ? 1 : -1;
    const wrong = rnd() < 0.6 ? -herView : herView;

    /*
     * 两个阶段，对应原作里的芽吹：
     *  1) 连胜期（前 16 天）：跟着久留美的建议做，或者纯粹运气好，每天都在赚。
     *     —— 正是这段"连战连胜"让久留美觉得市场可以征服，从而重新下场。
     *  2) 崩坏期：久留美不再给建议，她开始自己下单，追涨杀跌 + 亏损加仓，
     *     资金曲线一路向下，直到爆仓、背上债。
     */
    const streakDays = 16;
    const edge = wrong * (0.02 + Math.min(0.06, Math.abs(momentum) * 12));
    const drift = market.day < streakDays ? 0.035 : -0.025;
    const daily = U.clamp(edge + drift, -0.25, 0.25);

    m.equity *= (1 + daily);
    if (!isFinite(m.equity) || m.equity < 0) m.equity = m.start;

    // 爆仓：亏掉约 90% 就被打回起点（她借钱再来，这就是原作里的循环）
    if (m.equity < m.start * 0.1) {
      m.blown = market.day;
      m.blownCount = (m.blownCount || 0) + 1;
      m.equity = m.start * 0.12;
    }
    // 上限：避免长时间运行后数值失控
    m.equity = Math.min(m.equity, m.start * 6);
    if (m.equity > (m.peak || 0)) m.peak = m.equity;
    return m;
  }

  function newCycle(core, state) {
    const day = core.st.date.day;
    const c = {
      round: (state.contest ? state.contest.round : 0) + 1,
      startDay: day,
      endDay: day + CYCLE,
      base: { player: Math.max(1, core.netAsset()), ai: 0, mebuki: 0 },
      lastResult: null,
      history: state.contest ? (state.contest.history || []) : [],
    };
    if (state.agent) c.base.ai = Math.max(1, state.agent.equity);
    if (state.mebuki) c.base.mebuki = Math.max(1, state.mebuki.equity);
    return c;
  }

  /** 当前周期的实时排名 */
  function standings(core, state) {
    const c = state.contest;
    if (!c) return null;
    const rows = [];
    const add = (id, name, ini, c1, c2, now, base) => {
      const ret = (now - base) / base * 100;
      rows.push({ id, name, ini, c1, c2, now, base, ret });
    };
    add('player', '福賀久留美', '久', '#ff8fb1', '#c084fc', core.netAsset(), c.base.player);
    if (state.agent) add('ai', state.agent.name, 'ゆ', '#8cb4ff', '#3ddc97', state.agent.equity, c.base.ai);
    if (state.mebuki) add('mebuki', '山師芽吹', '芽', '#3ddc97', '#8cb4ff', state.mebuki.equity, c.base.mebuki);
    rows.sort((a, b) => b.ret - a.ret);
    rows.forEach((r, i) => r.rank = i + 1);
    const daysLeft = Math.max(0, c.endDay - core.st.date.day);
    return { rows, daysLeft, round: c.round, cycle: CYCLE };
  }

  /** 结算周期，发放奖励 */
  function settle(core, state) {
    const s = standings(core, state);
    if (!s) return null;
    const c = state.contest;
    const me = s.rows.find(r => r.id === 'player');
    const out = { round: c.round, rows: s.rows, endedDay: core.st.date.day, rewards: [], message: '' };

    if (me.rank === 1) {
      const pts = AI_REWARDS.contestWin.insight;
      core.addInsight(pts, '竞赛优胜');
      out.rewards.push({ insight: pts, label: '竞赛优胜' });
      out.message = `第 ${c.round} 期竞赛优胜！你跑赢了 ${s.rows.length - 1} 个人。`;
    } else if (me.rank === 2) {
      const pts = AI_REWARDS.contestPodium.insight;
      core.addInsight(pts, '竞赛进入前二');
      out.rewards.push({ insight: pts, label: '竞赛第二' });
      out.message = `第 ${c.round} 期第 2 名。离第一只差一点。`;
    } else {
      out.message = `第 ${c.round} 期垫底……${state.agent ? '「' + state.agent.name + '看了你一眼，什么也没说。」' : ''}`;
    }

    // 对赌结算
    const bets = (core.st.bets || []).filter(b => b.round === c.round && !b.settled);
    for (const b of bets) {
      const ai = s.rows.find(r => r.id === 'ai');
      const won = ai && ai.ret > 0;
      b.settled = true;
      if (won) {
        const payout = Math.round(b.amount * (1 + Math.min(3, ai.ret / 100)));
        core.st.wallet += payout;
        b.result = { won: true, payout };
        core.addInsight(AI_REWARDS.betWin.insight, '对赌获胜');
        out.rewards.push({ insight: AI_REWARDS.betWin.insight, label: '对赌获胜' });
        out.message += ` 对赌赢了，收回 ${U.fmt(payout)} 円。`;
      } else {
        b.result = { won: false, payout: 0 };
        out.message += ` 对赌输了，${U.fmt(b.amount)} 円打水漂。`;
      }
    }

    // 给领奖进度：AI 挑战目标
    const goals = (core.st.aiGoals || []).filter(g => !g.done);
    for (const g of goals) {
      const ai = state.agent;
      if (!ai) continue;
      const ret = (ai.equity - g.base) / g.base * 100;
      g.current = ret;
      if (ret >= g.target) {
        g.done = true;
        g.doneDay = core.st.date.day;
        const pts = AI_REWARDS.milestone.insight + Math.round(g.target / 25);
        core.addInsight(pts, 'AI 达成挑战');
        core.st.milestones['goal_' + g.id] = { day: core.st.date.day, target: g.target };
        out.rewards.push({ insight: pts, label: `挑战达成：7天 +${g.target}%` });
        out.message += ` 「ゆき」达成了你设的目标（+${g.target}%），里程碑奖励 ${pts} 洞察。`;
      }
    }

    c.lastResult = out;
    c.history = (c.history || []).slice(-9);
    c.history.push({ round: c.round, rows: s.rows.map(r => ({ id: r.id, ret: +r.ret.toFixed(2) })),
                     me: me.rank, day: core.st.date.day });

    // 开新周期
    const nc = newCycle(core, state);
    nc.history = c.history;
    nc.lastResult = null;
    state.contest = nc;
    return out;
  }

  return { CYCLE, newCycle, standings, settle, roster, tickMebuki };
})();

/* ============================================================
 * AI 管理层：驱动 Agent、串联竞赛、对话
 * ============================================================ */
const AIPlayer = (() => {
  'use strict';
  let core = null, ui = null;
  let state = {
    agent: null, contest: null, mebuki: null,
    thinkTimer: 0, chat: [], chatBusy: false,
    enabled: false,
    lastError: '', lastCallMs: 0, callCount: 0,
  };

  function init(c, u) {
    core = c; ui = u;
    const saved = AIStore.load();
    if (saved.cfg) LLM.configure(saved.cfg);
    state.enabled = !!(saved.cfg && saved.cfg.enabled);
    // 恢复主角的 AI 相关状态
    c.st.contest = c.st.contest || null;
    c.st.bets = c.st.bets || [];
    c.st.aiGoals = c.st.aiGoals || [];
    c.st.insightPts = c.st.insightPts || 0;
    c.st.perks = c.st.perks || { fees: 0, rebate: 0, intel: 0 };
    c.st.milestones = c.st.milestones || {};
    // 恢复 AI 账户
    if (saved.agent) {
      state.agent = new Agent({ core: c });
      state.agent.restore(saved.agent);
      if (saved.agent.name) state.agent.name = saved.agent.name;
      if (saved.agent.lastThought) state.agent.lastThought = saved.agent.lastThought;
      if (saved.agent.lastQuote) state.agent.lastQuote = saved.agent.lastQuote;
      if (saved.agent.actions) state.agent.actions = saved.agent.actions;
      if (saved.agent.errors) state.agent.errors = saved.agent.errors;
    }
    state.mebuki = saved.mebuki || { start: 500000, equity: 500000, seed: (Math.random() * 1e9) | 0 };
    state.contest = c.st.contest;
    state.chat = (saved.chat || []).slice(-40);
    // 挂到 core 上，方便存档与 UI 访问
    c.ai = api;
  }

  // 暴露给外部的接口（挂在 core.ai 上，方便界面与调试统一入口）
  const api = {
    get agent() { return state.agent; },
    get contest() { return state.contest; },
    get mebuki() { return state.mebuki; },
    get chat() { return state.chat; },
    get error() { return state.lastError; },
    get stats() { return { calls: state.callCount, ms: state.lastCallMs }; },
    get enabled() { return state.enabled; },
    standings: () => AIContest.standings(core, state),
    roster: () => AIContest.roster(core, state.agent),
    // 动作
    runOnce: () => runOnce(),
    talk: (t) => talk(t),
    test: () => test(),
    spawn: (o) => spawn(o),
    placeBet: (a, r) => placeBet(a, r),
    myBets: () => myBets(),
    addGoal: (t) => addGoal(t),
    goals: () => goals(),
    configure: (p) => configure(p),
    enable: (o) => enable(o),
    disable: () => disable(),
    resetAgent: () => resetAgent(),
    persist: () => persist(),
    standingsRows: () => { const s = AIContest.standings(core, state); return s ? s.rows : []; },
  };

  function persist() {
    const a = state.agent;
    AIStore.save({
      cfg: LLM.get(),
      mebuki: state.mebuki,
      chat: state.chat.slice(-40),
      agent: a ? {
        name: a.name, lastThought: a.lastThought, lastQuote: a.lastQuote,
        actions: a.actions, errors: a.errors, aggressive: a.aggressive,
        cash: a.core.st.cash, positions: a.core.st.positions,
        closed: a.core.st.closed.slice(0, 60), stats: a.core.st.stats,
        loans: a.core.st.loans,
      } : null,
    });
    if (core) core.st.contest = state.contest;
    if (core) core.save();
  }

  /** 创建 AI 对手（首次配置 API 成功时） */
  function spawn(opts) {
    const o = opts || {};
    const a = new Agent({
      name: o.name || 'ゆき',
      cash: o.cash || 300000,
      aggressive: o.aggressive === undefined ? 0.6 : o.aggressive,
      personality: o.personality,
      core: core,
    });
    state.agent = a;
    state.mebuki = state.mebuki || { start: 500000, equity: 500000, seed: (Math.random() * 1e9) | 0 };
    if (!state.contest) {
      // 先给芽吹一个基准，再开周期
      state.contest = AIContest.newCycle(core, state);
    }
    core.st.flags.metAI = true;
    persist();
    return a;
  }

  /** 每个游戏 tick 调用 */
  function onTick(dtMs) {
    if (!state.enabled) return;
    // 芽吹按 tick 演进
    if (state.mebuki) AIContest.tickMebuki(state, core.market, 'USDJPY');
    // AI 决策节拍
    if (!state.agent || !LLM.ready()) return;
    state.thinkTimer += dtMs * (core.st.speed || 1);
    if (state.thinkTimer >= state.agent.thinkInterval) {
      state.thinkTimer = 0;
      runOnce();
    }
    // 周期结算
    if (state.contest && core.st.date.day >= state.contest.endDay) {
      const r = AIContest.settle(core, state);
      if (r && ui) ui.onContestSettled(r);
      persist();
    }
  }

  /** 手动触发一轮 AI 思考 */
  async function runOnce() {
    if (!state.agent) return { error: '还没有 AI 对手。先在「设定 → AI 交易员」里连接 API。' };
    if (!LLM.ready()) return { error: '未配置 API' };
    if (state.agent.busy) return { skipped: 'busy' };
    const t0 = performance.now();
    const r = await state.agent.think(core.market);
    state.lastCallMs = Math.round(performance.now() - t0);
    state.callCount++;
    if (r.error) {
      state.lastError = r.error;
      if (ui) ui.onAIError(r.error);
    } else {
      state.lastError = '';
      // 日志写在 Core 里，保证不论界面层是否在场都会留痕
      const acts = (r.log || []).join('，');
      if (acts) core.pushLog('ai', `「${state.agent.name}」${acts}`, 0);
      if (ui) ui.onAIActed(r, state.agent);
    }
    persist();
    return r;
  }

  /** 与 AI 对话（她也知道自己的账户状况） */
  async function talk(text) {
    if (state.chatBusy) return { error: '她正在看盘' };
    if (!state.agent) return { error: '还没有 AI 对手' };
    if (!LLM.ready()) return { error: '未配置 API' };
    state.chatBusy = true;
    state.chat.push({ role: 'user', text, day: core.st.date.day });
    if (ui) ui.onChat();
    const ctx = [
      { role: 'system', content: [
        '你正在扮演一款外汇交易模拟游戏里的 NPC「ゆき」。' + state.agent.personality,
        '你现在正和玩家对话。玩家是「福賀久留美」，一个为了赚回母亲亏掉的 2000 万日元而下场交易的大学生。',
        '你说话简短、有角色感，不超过 60 字。不要用 markdown。不要说教。',
        '你的账户现状：' + JSON.stringify(state.agent.briefing(core.market).我的账户),
        '你目前的看法：' + state.agent.lastThought,
      ].join('\n') },
    ];
    for (const m of state.chat.slice(-10)) {
      ctx.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    }
    const r = await LLM.chatRetry(ctx, { temp: 0.95, maxTok: 200, timeout: 30000 });
    state.chatBusy = false;
    if (!r.ok) {
      state.lastError = r.error;
      if (ui) ui.onChat();
      return { error: r.error };
    }
    state.chat.push({ role: 'assistant', text: r.text.replace(/^「|」$/g, ''), day: core.st.date.day });
    persist();
    if (ui) ui.onChat();
    return { ok: true, text: r.text };
  }

  /** 测试连接 */
  async function test() {
    const r = await LLM.chat([
      { role: 'system', content: '你只需要回复一个词。' },
      { role: 'user', content: '回复：OK' },
    ], { temp: 0, maxTok: 12, timeout: 25000 });
    return r;
  }

  /* ---- 三个奖励机制的入口 ---- */

  /** 押注：赌 AI 在这个周期结束时收益为正 */
  function placeBet(amount, round) {
    amount = Math.round(amount);
    if (!(amount > 0)) return { ok: false, why: '金额无效' };
    if (amount > core.st.wallet) return { ok: false, why: '手头的钱不够（押注用的是钱包里的钱）' };
    if (!state.agent) return { ok: false, why: '还没有 AI 对手' };
    const c = state.contest;
    if (!c) return { ok: false, why: '还没有进行中的竞赛周期' };
    core.st.wallet -= amount;
    core.st.bets.push({ round: c.round, amount, day: core.st.date.day, settled: false, result: null });
    core.pushLog('bet', `对赌「${state.agent.name}」本期盈利 ${U.fmt(amount)} 円`, -amount);
    persist();
    return { ok: true };
  }
  function myBets() {
    const c = state.contest;
    if (!c) return [];
    return (core.st.bets || []).filter(b => b.round === c.round);
  }

  /** 给 AI 设挑战目标 */
  function addGoal(target) {
    target = Math.round(target);
    if (!(target > 0 && target <= 500)) return { ok: false, why: '目标请设在 1% ~ 500% 之间' };
    if (!state.agent) return { ok: false, why: '还没有 AI 对手' };
    if ((core.st.aiGoals || []).filter(g => !g.done).length >= 3) return { ok: false, why: '最多同时挂 3 个挑战' };
    const g = { id: Date.now() % 1000000, base: Math.max(1, state.agent.equity), target,
                setDay: core.st.date.day, current: 0, done: false, doneDay: null };
    core.st.aiGoals.push(g);
    core.pushLog('goal', `给「${state.agent.name}」设下目标：7 天 +${target}%`, 0);
    persist();
    return { ok: true, goal: g };
  }
  function goals() { return core.st.aiGoals || []; }

  /* ---- 配置 ---- */
  function configure(patch) {
    LLM.configure(patch);
    state.enabled = !!LLM.get().enabled;
    persist();
    return LLM.get();
  }
  async function enable(gopts) {
    configure({ enabled: true });
    if (!state.agent) spawn(gopts);
    persist();
    return true;
  }
  function disable() { configure({ enabled: false }); persist(); }
  function resetAgent() {
    state.agent = null;
    AIStore.save({ cfg: LLM.get(), mebuki: state.mebuki, chat: [], agent: null });
    persist();
  }

  return {
    init, api, onTick, runOnce, talk, test, spawn,
    placeBet, myBets, addGoal, goals,
    configure, enable, disable, resetAgent, persist,
    // 便捷访问器（对外等价于 api 上的 getter）
    get agent() { return state.agent; },
    get contest() { return state.contest; },
    get mebuki() { return state.mebuki; },
    get chat() { return state.chat; },
    get enabled() { return state.enabled; },
    get error() { return state.lastError; },
    standings: () => AIContest.standings(core, state),
    roster: () => AIContest.roster(core, state.agent),
    LLM_VERSION: '1.0',
  };
})();
