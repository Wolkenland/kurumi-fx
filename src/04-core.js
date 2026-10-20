/* ============================================================
 * 04-core.js  游戏状态 / 持仓 / 保证金 / 爆仓 / 借贷 / 隔夜利息
 * ============================================================ */

/* ---------- 借贷产品（久留美世界的三种深渊） ---------- */
const LOAN_PRODUCTS = [
  {
    id: 'friend', name: '友人からの借金', sub: '无利息・人情',
    rate: 0.00, limit: 500000, fee: 0, rolloverFee: 0, grace: 30,
    danger: 1, color: '#8cb4ff',
    desc: '跟朋友开口。不要利息，但要脸。还不上会失去朋友。',
    require: st => st.flags.metMebuki,
  },
  {
    id: 'consumer', name: '消費者金融', sub: '年利18.0%・即日',
    rate: 0.18, limit: 2000000, fee: 0.01, rolloverFee: 5000, grace: 7,
    danger: 2, color: '#ffd166',
    desc: '最快到手，也最快开始追着你跑。每7天一笔手数料。',
    require: st => st.flags.hasJob || st.stats.level >= 2,
  },
  {
    id: 'yakuza', name: '闇金融', sub: '年利36.5%・取立て',
    rate: 0.365, limit: 8000000, fee: 0.05, rolloverFee: 20000, grace: 5,
    danger: 4, color: '#ff8fb1',
    desc: '多少都借得到。代价是你的冷静值。',
    require: st => st.flags.despairSeen || st.stats.mental < 45,
  },
  {
    id: 'mochiko', name: '小金萌智子・個人間融資', sub: '年利109%',
    rate: 1.09, limit: 30000000, fee: 0.02, rolloverFee: 0, grace: 3,
    danger: 5, color: '#c084fc',
    desc: '「个人间融资的法定最高利率。你借得起吗？」—— 她只借给正在走向毁灭的人。',
    require: st => st.flags.mochikoDeal,
  },
];

/* ---------- 角色对白（随状态变化） ---------- */
/* ================= 成就系统 ================= */
/**
 * 30 个成就，分 4 类。达成即给洞察点（可换钱 / 买永久技能）。
 * cat: trade 交易 / survive 生存 / danger 作死 / explore 探索
 */
const ACHIEVEMENTS = [
  /* ---- 交易 ---- */
  { id: 'first_open',   cat: 'trade', pts: 1, name: '第一笔',       desc: '开出第一笔仓位',
    test: c => c.st.stats.trades >= 0 && c.st.stats.opened >= 1 },
  { id: 'first_win',    cat: 'trade', pts: 1, name: '第一次盈利',   desc: '平仓并盈利',
    test: c => c.st.stats.wins >= 1 },
  { id: 'first_loss',   cat: 'trade', pts: 1, name: '第一次亏损',   desc: '平仓并亏损',
    test: c => c.st.stats.losses >= 1 },
  { id: 'ten_win',      cat: 'trade', pts: 2, name: '十胜',         desc: '累计盈利平仓 10 次',
    test: c => c.st.stats.wins >= 10 },
  { id: 'hundred_trade',cat: 'trade', pts: 4, name: '百战',         desc: '累计平仓 100 次',
    test: c => c.st.stats.trades >= 100 },
  { id: 'streak3',      cat: 'trade', pts: 2, name: '三连胜',       desc: '连续 3 次盈利平仓',
    test: c => c.st.stats.maxStreak >= 3 },
  { id: 'streak5',      cat: 'trade', pts: 3, name: '五连胜',       desc: '连续 5 次盈利平仓',
    test: c => c.st.stats.maxStreak >= 5 },
  { id: 'profit100k',   cat: 'trade', pts: 2, name: '十万',         desc: '单笔盈利 10 万円',
    test: c => c.st.stats.bestProfit >= 100000 },
  { id: 'profit500k',   cat: 'trade', pts: 4, name: '五十万',       desc: '单笔盈利 50 万円',
    test: c => c.st.stats.bestProfit >= 500000 },
  { id: 'profit1m',     cat: 'trade', pts: 6, name: '百万',         desc: '单笔盈利 100 万円',
    test: c => c.st.stats.bestProfit >= 1000000 },

  /* ---- 生存 ---- */
  { id: 'day7',         cat: 'survive', pts: 1, name: '活过一周',   desc: '游戏内度过 7 天',
    test: c => c.st.date.day >= 7 },
  { id: 'day30',        cat: 'survive', pts: 3, name: '活过一月',   desc: '游戏内度过 30 天',
    test: c => c.st.date.day >= 30 },
  { id: 'day100',       cat: 'survive', pts: 6, name: '百日',       desc: '游戏内度过 100 天',
    test: c => c.st.date.day >= 100 },
  { id: 'equity500k',   cat: 'survive', pts: 2, name: '五十万',     desc: '净值达到 50 万円',
    test: c => c.netAsset() >= 500000 },
  { id: 'equity1m',     cat: 'survive', pts: 4, name: '一百万',     desc: '净值达到 100 万円',
    test: c => c.netAsset() >= 1000000 },
  { id: 'equity10m',    cat: 'survive', pts: 8, name: '一千万',     desc: '净值达到 1000 万円',
    test: c => c.netAsset() >= 10000000 },
  { id: 'debt_free',    cat: 'survive', pts: 5, name: '无债一身轻', desc: '把所有借款还清',
    test: c => c.st.flags.hasBorrowed && c.totalLoan() <= 0 },
  { id: 'clean30',      cat: 'survive', pts: 3, name: '无债一月',   desc: '不负债活过 30 天',
    test: c => c.st.date.day >= 30 && c.totalLoan() <= 0 },
  { id: 'calm1',        cat: 'survive', pts: 3, name: '心如止水',   desc: '冷静值保持在 90 以上度过 15 天',
    test: c => c.st.date.day >= 15 && c.st.stats.mental >= 90 },

  /* ---- 作死 ---- */
  { id: 'first_liq',    cat: 'danger', pts: 1, name: '第一次爆仓', desc: '被强制平仓',
    test: c => c.st.stats.liquidated >= 1 },
  { id: 'liq5',         cat: 'danger', pts: 2, name: '五次爆仓',   desc: '被强制平仓 5 次',
    test: c => c.st.stats.liquidated >= 5 },
  { id: 'liq20',        cat: 'danger', pts: 5, name: '二十次',     desc: '被强制平仓 20 次',
    test: c => c.st.stats.liquidated >= 20 },
  { id: 'debt1m',       cat: 'danger', pts: 3, name: '负债百万',   desc: '总负债达到 100 万円',
    test: c => c.totalLoan() >= 1000000 },
  { id: 'debt10m',      cat: 'danger', pts: 6, name: '负债千万',   desc: '总负债达到 1000 万円',
    test: c => c.totalLoan() >= 10000000 },
  { id: 'loss500k',     cat: 'danger', pts: 2, name: '五十万的教训', desc: '单笔亏损 50 万円',
    test: c => c.st.stats.worstLoss <= -500000 },
  { id: 'margin_call',  cat: 'danger', pts: 2, name: '追证',       desc: '被要求追加保证金',
    test: c => c.st.stats.marginCalls >= 1 },
  { id: 'all_in',       cat: 'danger', pts: 3, name: '满仓',       desc: '维持率跌到 110% 以下',
    test: c => c.hasPosition() && c.marginRate() <= 110 },

  /* ---- 探索 ---- */
  { id: 'all_pairs',    cat: 'explore', pts: 4, name: '八面玲珑',  desc: '交易过全部 8 个品种',
    test: c => PAIR_ORDER.every(id => c.st.stats.pairsTried && c.st.stats.pairsTried[id]) },
  { id: 'lev100',       cat: 'explore', pts: 3, name: '百倍勇气',   desc: '用 100 倍杠杆开过仓',
    test: c => c.st.stats.maxLev >= 100 },
  { id: 'lev1',         cat: 'explore', pts: 2, name: '老实人',     desc: '用 1 倍杠杆开过仓',
    test: c => c.st.stats.usedLev1 === true },
  { id: 'four_pos',     cat: 'explore', pts: 2, name: '四手联弹',   desc: '同时持有 4 笔仓位',
    test: c => c.st.stats.maxPositions >= 4 },
  { id: 'all_loans',    cat: 'explore', pts: 3, name: '全渠道',     desc: '借遍所有借贷渠道',
    test: c => LOAN_PRODUCTS.every(d => c.st.stats.loansTaken && c.st.stats.loansTaken[d.id]) },
  { id: 'perk_max',     cat: 'explore', pts: 5, name: '技能大师',   desc: '把任意一个技能升到满级',
    test: c => ['fees','rebate','intel','credit','swap','guts'].some(k => (c.st.perks[k] || 0) >= c.perkMax(k)) },
];

/* ================= 每日任务 ================= */
/**
 * 每天刷新 3 个，完成得洞察点。
 * when: 'instant' 达成即刻结算 / 'settle' 当天结束时结算
 */
const DAILY_TASKS = [
  { id: 'close3',   when: 'instant', pts: 1, name: '做三笔',
    desc: '今天平仓 3 次', goal: 3, prog: c => c.st.dailyStat.closed },
  { id: 'profit',   when: 'instant', pts: 2, name: '今日为正',
    desc: '今天的已实现盈亏为正', goal: 1, prog: c => c.st.dailyStat.pnl > 0 ? 1 : 0 },
  { id: 'nail',     when: 'instant', pts: 1, name: '小赚一笔',
    desc: '单笔平仓盈利 ≥ 5000 円', goal: 1, prog: c => c.st.dailyStat.bestWin >= 5000 ? 1 : 0 },
  { id: 'trypair',  when: 'instant', pts: 2, name: '换换口味',
    desc: '交易一个今天还没碰过的品种', goal: 2, prog: c => c.st.dailyStat.pairsToday },
  { id: 'repay',    when: 'instant', pts: 2, name: '还一点',
    desc: '今天偿还一部分负债', goal: 1, prog: c => c.st.dailyStat.repaid > 0 ? 1 : 0 },
  { id: 'noborrow', when: 'settle', pts: 2, name: '不借钱',
    desc: '一整天没有新增借款', goal: 1, prog: c => c.st.dailyStat.borrowed === 0 ? 1 : 0 },
  { id: 'noliq',    when: 'settle', pts: 1, name: '活着',
    desc: '一整天没有被强制平仓', goal: 1, prog: c => c.st.dailyStat.liquidated === 0 ? 1 : 0 },
  { id: 'calm',     when: 'settle', pts: 1, name: '保持冷静',
    desc: '日落时冷静值 ≥ 60', goal: 1, prog: c => c.st.stats.mental >= 60 ? 1 : 0 },
  { id: 'nodeposit',when: 'settle', pts: 2, name: '自力更生',
    desc: '一整天没有入金', goal: 1, prog: c => c.st.dailyStat.deposited === 0 ? 1 : 0 },
];

/** 全部完成的额外奖励 */
const DAILY_ALL_BONUS = 2;

const ACH_CATS = {
  trade:   { name: '交易', color: '#3ddc97' },
  survive: { name: '生存', color: '#8cb4ff' },
  danger:  { name: '作死', color: '#ff4d6d' },
  explore: { name: '探索', color: '#ffd166' },
};

const BARKS = {
  mochiko: {
    idle: ['「你今天的手，在抖。」', '「市场不会因为你可怜就上涨。」', '「赔钱的人才是最诚实的。」'],
    profit: ['「哦？赚了。可惜你还会回来。」', '「别高兴太早，你只是被喂了一口。」'],
    loss: ['「你现在的表情，非常好看。」', '「继续。我想看更后面的部分。」'],
    loan: ['「年利109%。借据我收下了。」', '「不用谢。反正你会还的……或者不会。」'],
  },
  mebuki: {
    idle: ['「打工是不可能打工的。」', '「久留美，这单能上吗？」', '「我昨天梦见汇率了。」'],
    profit: ['「我好像……很适合这行？」', '「运气也是实力吧！」'],
    loss: ['「为什么……又是我？」', '「借我点本金，我一定能翻回来。」'],
  },
  yasuko: {
    idle: ['「我、我只是来画画的……」', '「这个人物叫『肉球酱』，可爱吧？」', '「我的博客昨天有1万人看了。」'],
    profit: ['「诶？我居然赚了？」'],
    loss: ['「不该碰的……我不该碰的。」'],
  },
  kurumiIn: {
    idle: ['「妈妈的2000万……我必须赚回来。」', '「止损？我设的就是止损。」', '「再来一点点，就一点点。」'],
    euphoria: ['「就是这样……钱在长大……」', '「我懂了！我懂这个市场了！」'],
    fear: ['「不要……不要跌了……」', '「平掉？不……再等一下……」'],
    despair: ['「我刚才……把爸爸的存款……」', '「我是不是，和妈妈一样了。」'],
  },
};

/* ---------- 主角初始状态 ---------- */
function initialState() {
  return {
    v: 2,
    seed: (Math.random() * 1e9) | 0,
    chapter: 0,
    date: { day: 0, tick: 0 },
    speed: 1,                 // 0 暂停, 1, 2, 4
    cash: 300000,             // 账户现金（保证金）
    wallet: 0,                // 钱包里没入金的钱
    positions: [],
    closed: [],
    loans: [],                // {pid, amount, since, nextRoll, defaulted}
    loanTotals: 0,
    swapToday: 0,
    stats: { level: 1, xp: 0, wins: 0, losses: 0, bestProfit: 0, worstLoss: 0,
             totalPnl: 0, liquidated: 0, mental: 100, greed: 0, insight: 0, daysPlayed: 0,
             peakEquity: 300000, streak: 0, maxStreak: 0,
             // —— 1.3.0 统计扩展 ——
             trades: 0,            // 总交易（平仓）次数
             pairsTried: {},       // 交易过的品种
             maxLev: 1,            // 用过的最大杠杆
             maxPositions: 0,      // 同时持有的最大仓位数
             loansTaken: {},       // 用过的借贷渠道
             maxDrawdown: 0,       // 最大回撤（%）
             marginCalls: 0,       // 被追证次数
             holdMs: 0,            // 累计持仓时长（ms）
             holdCount: 0,         // 时长统计样本数
             perksBought: 0, byPair: {} },  // 买过多少次技能 / 分品种统计
    achievements: [],              // 已解锁的成就 id
    dailyTasks: [],                // 今日任务（3 个）
    dailyStat: { closed: 0, pnl: 0, liquidated: 0, borrowed: 0, repaid: 0,
                 bestWin: 0, deposited: 0, pairsToday: 0 },
    dailyDoneIds: [],              // 今天已完成的任务 id
    dailyAllDone: false,           // 今天是否全部完成
    dailyClaimed: 0,               // 累计完成过的任务数
    flags: { tutorial: false, metMochiko: false, metMebuki: false, mochikoDeal: false,
             metYasuko: false, hasJob: true, despairSeen: false, dadMoney: false,
             fxQuit: false, prologue: false },
    goals: [],
    insightPts: 0,                 // 洞察点（AI 奖励机制的通用货币）
    perks: { fees: 0, rebate: 0, intel: 0, credit: 0, swap: 0, guts: 0 },
    // fees 交易成本减免 / rebate 爆仓保险 / intel 情报力
    // credit 信用力(借贷额度) / swap 利息谈判 / guts 胆力(抗精神打击)
    contest: null,                 // 竞赛状态（由 AI 模块驱动）
    bets: [],                      // 对赌记录
    aiGoals: [],                   // 给 AI 设定的挑战目标
    milestones: {},                // 已领取的里程碑
    chat: [],                      // 与 AI 的对话记录
    log: [],
    settings: { sfx: true, haptics: true, ma: true, effects: true, speedIdx: 1 },
    tutorials: {},            // 已读教学
    chapterDone: {},
  };
}

/* ---------- 核心 ---------- */
class Core {
  constructor() {
    this.agent = false;            // true = 这是一个 AI 玩家，不发声、不存档、不弹窗
    this.slot = 0;                 // 当前存档槽（0..2）
    this.st = initialState();
    this.market = new Market(this.st.seed);
    // 第一天也要有任务（否则要等到第二天 newDay 才生成）
    if (!Array.isArray(this.st.dailyTasks) || !this.st.dailyTasks.length) {
      this.genDailyTasks();
    }
    this.timers = U.makeTimers();
    this.tickMs = 700;
    this.acc = 0;
    this.running = false;
    this.daySwapDone = -1;
    this.listeners = [];
    this.pendingEvents = [];
    this.barkCool = 0;
    this.recentPnl = 0;       // 用于判定"刚赚/刚亏"的对白
    this.marginCall = null;   // {level:1|2}
    this.mochiko = { mood: 'idle', watched: 0 };
  }

  /* ===== 表现层守卫（AI 玩家不该触发玩家的音效/震动）===== */
  fx(name) { if (this.agent) return; try { Sfx[name].apply(Sfx, [].slice.call(arguments, 1)); } catch (e) {} }
  hap(name) { if (this.agent) return; try { Haptics[name].apply(Haptics, [].slice.call(arguments, 1)); } catch (e) {} }

  /* ===== 永久技能（洞察点购买）===== */

  /** 1 点洞察能兑换多少钱（日元） */
  static get INSIGHT_RATE() { return 100000; }
  insightRate() { return 100000; }

  /** 点差倍率：交易成本减免 Lv1-3 → 0.9 / 0.8 / 0.7 */
  spreadMul() { return 1 - 0.1 * (this.st.perks.fees || 0); }
  /** 某品种的实际点差 */
  spreadOf(pid) { return this.market.pair(pid).def.spread * this.spreadMul(); }

  /** 爆仓保险返还比例 */
  rebateRate() { return 0.1 * (this.st.perks.rebate || 0); }

  /** 信用力：借贷额度上限倍率（每级 +25%） */
  loanLimitMul() { return 1 + 0.25 * (this.st.perks.credit || 0); }
  /** 某借贷渠道的实际可借上限 */
  loanLimit(def) { return Math.round(def.limit * this.loanLimitMul()); }

  /**
   * 利息谈判：隔夜利息改善倍率
   * @param dir +1 表示收利息（放大），-1 表示付利息（缩小）
   */
  swapMul(dir) {
    const lv = this.st.perks.swap || 0;
    return dir >= 0 ? 1 + 0.3 * lv : 1 - 0.3 * lv;
  }

  /** 胆力：精神损失倍率（每级 -40%，最低 20%） */
  mentalLossMul() { return Math.max(0.2, 1 - 0.4 * (this.st.perks.guts || 0)); }

  /* ---- 技能定义表 ---- */
  static get PERK_MAX() {
    return { fees: 3, rebate: 3, intel: 2, credit: 3, swap: 3, guts: 2 };
  }
  static get PERK_COST() {
    return {
      fees:   { 1: 3, 2: 6, 3: 10 },
      rebate: { 1: 3, 2: 6, 3: 10 },
      intel:  { 1: 3, 2: 6 },
      credit: { 1: 4, 2: 8, 3: 14 },
      swap:   { 1: 3, 2: 7, 3: 12 },
      guts:   { 1: 3, 2: 6 },
    };
  }

  perkCost(key, level) {
    const row = Core.PERK_COST[key];
    return (row && row[level]) || 99;
  }
  perkMax(key) { return Core.PERK_MAX[key] || 3; }

  buyPerk(key) {
    const cur = this.st.perks[key] || 0;
    if (cur >= this.perkMax(key)) return { ok: false, why: '已经满级了' };
    const cost = this.perkCost(key, cur + 1);
    if (this.st.insightPts < cost) return { ok: false, why: `需要 ${cost} 点洞察（你有 ${this.st.insightPts}）` };
    this.st.insightPts -= cost;
    this.st.perks[key] = cur + 1;
    this.fx('bigwin'); this.hap('win');
    this.pushLog('perk', `技能升级：${key} Lv.${cur + 1}`, 0);
    this.emit('perk', { key, level: cur + 1 });
    this.save();
    return { ok: true, level: cur + 1 };
  }

  /* ===== 洞察点 ↔ 金钱 ===== */
  /** 1 点洞察 = 10 万円，兑到的钱进钱包（可自由决定是否入金） */
  exchangeInsight(points) {
    const n = Math.floor(points);
    if (!(n > 0)) return { ok: false, why: '兑换点数必须是正整数' };
    if (this.st.insightPts < n) return { ok: false, why: `洞察点不足（你有 ${this.st.insightPts} 点）` };
    const money = n * this.insightRate();
    this.st.insightPts -= n;
    this.st.wallet += money;
    this.fx('coin'); this.hap('win');
    this.pushLog('exchange', `洞察兑换：${n} 点 → ${U.fmt(money)} 円`, money);
    this.emit('exchange', { points: n, money });
    this.save();
    return { ok: true, points: n, money };
  }

  addInsight(n, why) {
    this.st.insightPts += n;
    this.emit('insight', { n, why, total: this.st.insightPts });
    return this.st.insightPts;
  }

  /* ===== 每日任务 ===== */
  /** 抽 3 个当日任务（尽量同时包含即时型与结算型） */
  genDailyTasks(rng) {
    const r = rng || Math.random;
    const instant = DAILY_TASKS.filter(t => t.when === 'instant');
    const settle = DAILY_TASKS.filter(t => t.when === 'settle');
    const pick = (arr, n) => {
      const a = arr.slice();
      const out = [];
      while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]);
      return out;
    };
    const chosen = pick(instant, 2).concat(pick(settle, 1));
    this.st.dailyTasks = chosen.map(t => t.id);
    this.st.dailyDoneIds = [];
    this.st.dailyAllDone = false;
    this.st.dailyStat = { closed: 0, pnl: 0, liquidated: 0, borrowed: 0, repaid: 0,
                          bestWin: 0, deposited: 0, pairsToday: 0 };
    return chosen;
  }

  /** 取任务定义 */
  dailyDef(id) { return DAILY_TASKS.find(t => t.id === id) || null; }

  /**
   * 检查任务完成
   * @param phase 'instant' 只查即时型；'settle' 结算当天（两类都查）
   */
  checkDaily(phase) {
    if (this.agent) return [];
    const st = this.st;
    if (!Array.isArray(st.dailyTasks) || !st.dailyTasks.length) return [];
    st.dailyDoneIds = st.dailyDoneIds || [];
    const got = [];
    for (const id of st.dailyTasks) {
      if (st.dailyDoneIds.indexOf(id) >= 0) continue;
      const def = this.dailyDef(id);
      if (!def) continue;
      if (phase === 'instant' && def.when !== 'instant') continue;
      let prog = 0;
      try { prog = def.prog(this) || 0; } catch (e) { prog = 0; }
      if (prog >= def.goal) {
        st.dailyDoneIds.push(id);
        st.insightPts += def.pts;
        st.dailyClaimed = (st.dailyClaimed || 0) + 1;
        got.push({ def, pts: def.pts });
      }
    }
    // 全部完成
    if (!st.dailyAllDone && st.dailyDoneIds.length >= st.dailyTasks.length) {
      st.dailyAllDone = true;
      st.insightPts += DAILY_ALL_BONUS;
      got.push({ def: { name: '今日全清', pts: DAILY_ALL_BONUS }, pts: DAILY_ALL_BONUS, bonus: true });
    }
    if (got.length) {
      this.fx('coin'); this.hap('win');
      got.forEach(g => this.pushLog('daily', `每日任务：${g.def.name}（+${g.pts} 洞察）`, 0));
      this.emit('daily', { list: got });
    }
    return got;
  }

  /** 今日任务进度（供界面） */
  dailyProgress() {
    const st = this.st;
    if (!Array.isArray(st.dailyTasks) || !st.dailyTasks.length) return [];
    return st.dailyTasks.map(id => {
      const def = this.dailyDef(id);
      if (!def) return null;
      let prog = 0;
      try { prog = def.prog(this) || 0; } catch (e) { prog = 0; }
      return {
        id, name: def.name, desc: def.desc, pts: def.pts, when: def.when,
        goal: def.goal, prog: Math.min(prog, def.goal),
        done: (st.dailyDoneIds || []).indexOf(id) >= 0,
      };
    }).filter(Boolean);
  }

  /* ===== 成就 ===== */
  hasAch(id) { return this.st.achievements.indexOf(id) >= 0; }

  /** 检查并解锁成就，返回本次新解锁的列表 */
  checkAchievements() {
    if (this.agent) return [];
    if (!Array.isArray(this.st.achievements)) this.st.achievements = [];
    const got = [];
    for (const a of ACHIEVEMENTS) {
      if (this.hasAch(a.id)) continue;
      let ok = false;
      try { ok = !!a.test(this); } catch (e) { ok = false; }
      if (ok) {
        this.st.achievements.push(a.id);
        this.st.insightPts += a.pts;
        got.push(a);
      }
    }
    if (got.length) {
      this.fx('bigwin'); this.hap('win');
      got.forEach(a => this.pushLog('ach', `成就解锁：${a.name}（+${a.pts} 洞察）`, 0));
      this.emit('achievement', { list: got });
    }
    return got;
  }

  /** 成就进度（用于界面展示） */
  achSummary() {
    const total = ACHIEVEMENTS.length;
    const done = (this.st.achievements || []).length;
    const byCat = {};
    for (const k in ACH_CATS) byCat[k] = { done: 0, total: 0 };
    for (const a of ACHIEVEMENTS) {
      byCat[a.cat].total++;
      if (this.hasAch(a.id)) byCat[a.cat].done++;
    }
    return { total, done, byCat };
  }

  /* ===== 事件总线 ===== */
  on(fn) { this.listeners.push(fn); }
  emit(type, data) {
    const ev = Object.assign({ type, at: this.st.date }, data || {});
    for (const f of this.listeners) { try { f(ev); } catch (e) {} }
    return ev;
  }

  /* ===== 存档（多槽 + 备份 + 元信息） ===== */
  save() {
    if (this.agent) return false;   // AI 的账户由主存档统一序列化
    const payload = {
      v: 2,
      st: this.st,
      market: this.market.serialize(),
      mochiko: this.mochiko,
      savedAt: Date.now(),
    };
    const info = {
      day: this.st.date.day,
      level: this.st.stats.level,
      netAsset: Math.round(this.netAsset()),
      cash: Math.round(this.st.cash),
      loan: Math.round(this.totalLoan()),
      chapter: this.st.chapter || 0,
      positions: this.st.positions.length,
    };
    return Store.save(payload, this.slot, info);
  }

  /**
   * 读档
   * @param slot 不传则读「上次使用的槽」
   * @returns {ok, fromBackup?, migrated?}
   */
  load(slot) {
    const want = slot === undefined ? Store.active : (slot | 0);
    const o = Store.load(want);
    if (!o || !o.st) return { ok: false };
    this.slot = want;
    Store.active = want;
    this.st = U.merge(initialState(), o.st);
    this.market = new Market(this.st.seed);
    this.market.restore(o.market);
    this.mochiko = o.mochiko || { mood: 'idle', watched: 0 };
    return {
      ok: true,
      fromBackup: !!o.__fromBackup,
      migrated: !!o.__migrated,
      savedAt: o.savedAt || null,
    };
  }

  /** 切换存档槽（不读档，只是后续保存写到新槽） */
  useSlot(n) {
    this.slot = n | 0;
    Store.active = this.slot;
  }

  reset() { Store.clear(); this.st = initialState(); this.market = new Market(this.st.seed); this.slot = 0; }

  /* ===== 时间推进 ===== */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(250, now - this.lastT);
      this.lastT = now;
      if (this.st.speed > 0) {
        this.acc += dt * this.st.speed;
        let guard = 0;
        while (this.acc >= this.tickMs && guard++ < 24) { this.acc -= this.tickMs; this.tick(); }
      } else { this.acc = 0; }
      this.emit('frame', { dt });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }

  tick() {
    const res = this.market.tick();
    this.st.date.tick++;
    if (this.st.date.tick % TICKS_PER_DAY === 0) {
      this.st.date.day++;
      this.st.date.tick = 0;
      this.newDay();
    }
    this.checkRisk();
    if (this.st.speed > 0) this.emit('tick', res);
  }

  newDay() {
    const d = this.st.date.day;
    this.st.stats.daysPlayed = d;

    // ---- 每日任务：先结算昨天（结算型任务在这一刻判定）----
    if (!this.agent) {
      if (Array.isArray(this.st.dailyTasks) && this.st.dailyTasks.length) {
        this.checkDaily('settle');
      }
      this.st.date.day = d;          // checkDaily 可能没改 day，这里顺手纠正
      this.genDailyTasks();
    } else {
      this.st.dailyTasks = [];
    }
    // 隔夜利息（周三三倍）
    let swap = 0;
    const mult = (d % 7 === 2) ? 3 : (d % 7 === 5 || d % 7 === 6 ? 0 : 1);
    for (const p of this.st.positions) {
      const s = this.market.pair(p.pid);
      const rate = p.dir > 0 ? s.def.swapL : s.def.swapS;
      // 利息谈判：收利息放大、付利息缩小
      const v = p.units * s.def.price * rate * mult * this.swapMul(rate >= 0 ? 1 : -1);
      swap += v;
    }
    this.st.swapToday = swap;
    this.st.cash += swap;
    if (Math.abs(swap) > 1) this.emit('swap', { amount: swap, mult });

    // 利息累积
    this.accrueInterest(d);

    // 状态衰减
    this.st.stats.mental = U.clamp(this.st.stats.mental + (this.hasPosition() ? -0.4 : 0.8), 0, 100);
    this.st.stats.greed = U.clamp(this.st.stats.greed - 0.5, 0, 100);

    this.emit('newday', { day: d });
    this.checkAchievements();
    this.save();
  }

  /* ===== 账号指标 ===== */
  totalLoan() { return this.st.loans.reduce((a, b) => a + b.amount, 0); }
  evalPrice(pos) { const s = this.market.pair(pos.pid); return pos.dir > 0 ? s.bid() : s.ask(); }
  unrealized(pos) { return (this.evalPrice(pos) - pos.entry) * pos.dir * pos.units; }
  unrealizedAll() { return this.st.positions.reduce((a, p) => a + this.unrealized(p), 0); }
  usedMargin() {
    let m = 0;
    for (const p of this.st.positions) {
      const s = this.market.pair(p.pid);
      m += p.units * (p.entry / p.lev);
    }
    return m;
  }
  equity() { return this.st.cash + this.unrealizedAll(); }
  freeMargin() { return this.equity() - this.usedMargin(); }
  marginRate() { const u = this.usedMargin(); return u <= 0 ? Infinity : this.equity() / u * 100; }
  hasPosition() { return this.st.positions.length > 0; }
  netAsset() { return this.st.cash + this.st.wallet + this.unrealizedAll() - this.totalLoan(); }

  /* ===== 下单 ===== */
  canOpen(units, lev, pid) {
    if (units <= 0) return { ok: false, why: '数量无效' };
    if (this.st.cash <= 0) return { ok: false, why: '保证金不足' };
    return { ok: true };
  }

  /**
   * 开仓
   * @param pid 货币对
   * @param dir +1 买(做多) / -1 卖(做空)
   * @param units 通貨量（1 = 1通貨；游戏里按「万通貨」输入）
   * @param lev 杠杆倍率
   */
  open(pid, dir, units, lev) {
    if (units <= 0) return { ok: false, why: '数量必须是正数' };
    if (units > 5000000) return { ok: false, why: '这已经超出任何券商的限度了' };
    const s = this.market.pair(pid);
    const entry = dir > 0 ? s.ask() : s.bid();
    const margin = units * entry / lev;
    if (margin > this.st.cash) {
      this.fx('error'); this.hap('lose');
      return { ok: false, why: `必要保证金的 ${U.fmt(Math.ceil(margin))} 円 不足（可用 ${U.fmt(Math.floor(this.st.cash))} 円）` };
    }
    const pos = {
      id: ++posSeq, pid, dir, units, lev, entry,
      openDay: this.st.date.day, openTick: this.st.date.tick,
      margin, sl: null, tp: null, opened: performance.now(),
    };
    this.st.positions.push(pos);
    this.st.cash -= margin;
    // —— 统计埋点 ——
    const st2 = this.st.stats;
    st2.opened = (st2.opened || 0) + 1;
    st2.pairsTried = st2.pairsTried || {};
    st2.pairsTried[pid] = true;
    st2.maxLev = Math.max(st2.maxLev || 1, lev);
    if (lev === 1) st2.usedLev1 = true;
    st2.maxPositions = Math.max(st2.maxPositions || 0, this.st.positions.length + 1);
    const DS2 = this.st.dailyStat;
    if (DS2) {
      if (!DS2._pairs) DS2._pairs = {};
      DS2._pairs[pid] = true;
      DS2.pairsToday = Object.keys(DS2._pairs).length;
    }
    this.st.stats.greed = U.clamp(this.st.stats.greed + (lev >= 25 ? 2.5 : lev >= 10 ? 1.2 : 0.4), 0, 100);
    this.pushLog(dir > 0 ? 'buy' : 'sell', `${s.def.short} ${dir > 0 ? '买' : '卖'} ${U.fmt(units)}通貨 ×${lev}倍`, 0);
    this.fx('buy'); this.hap('press');
    this.emit('open', { pos });
    this.checkAchievements();
    this.checkDaily('instant');
    this.save();
    return { ok: true, pos };
  }

  /** 平仓（部分平仓 amount 为通貨量，默认全部） */
  close(posId, units) {
    const i = this.st.positions.findIndex(p => p.id === posId);
    if (i < 0) return { ok: false, why: '持仓不存在' };
    const p = this.st.positions[i];
    const s = this.market.pair(p.pid);
    const n = U.clamp(units || p.units, 1, p.units);
    const exit = p.dir > 0 ? s.bid() : s.ask();
    const pnl = (exit - p.entry) * p.dir * n;
    const swap = 0;
    const marginBack = p.units * (p.entry / p.lev) * (n / p.units);
    this.st.cash += marginBack + pnl;
    this.st.stats.totalPnl += pnl;
    this.recentPnl = pnl;
    const S = this.st.stats;
    S.trades = (S.trades || 0) + 1;
    if (pnl > 0) {
      S.wins++; S.streak = Math.max(1, S.streak + 1);
      S.maxStreak = Math.max(S.maxStreak || 0, S.streak);
    } else {
      S.losses++; S.streak = Math.min(-1, S.streak - 1);
    }
    // 回撤记录
    const eq = this.equity();
    S.peakEquity = Math.max(S.peakEquity || eq, eq);
    if (S.peakEquity > 0) {
      const dd = (1 - eq / S.peakEquity) * 100;
      S.maxDrawdown = Math.max(S.maxDrawdown || 0, dd);
    }
    // 每日任务统计
    const DS = this.st.dailyStat;
    if (DS) {
      if (!DS._pairs) DS._pairs = {};
      DS.closed = (DS.closed || 0) + 1;
      DS.pnl = (DS.pnl || 0) + pnl;
      if (pnl > (DS.bestWin || 0)) DS.bestWin = pnl;
      DS._pairs[p.pid] = true;
      DS.pairsToday = Object.keys(DS._pairs).length;
    }
    // 分品种统计
    if (!S.byPair) S.byPair = {};
    const bp = S.byPair[p.pid] || (S.byPair[p.pid] = { n: 0, pnl: 0, wins: 0 });
    bp.n++; bp.pnl += pnl; if (pnl > 0) bp.wins++;
    // 持仓时长
    if (p.openedAt) {
      S.holdMs = (S.holdMs || 0) + Math.max(0, Date.now() - p.openedAt);
      S.holdCount = (S.holdCount || 0) + 1;
    }
    if (pnl > this.st.stats.bestProfit) this.st.stats.bestProfit = pnl;
    if (pnl < this.st.stats.worstLoss) this.st.stats.worstLoss = pnl;

    // 经验与洞察
    const xp = Math.round(Math.min(60, Math.abs(pnl) / 5000 + 3));
    this.addXp(xp, pnl > 0 ? '成功平仓' : '学习总是昂贵的');

    const rec = { pid: p.pid, dir: p.dir, units: n, entry: p.entry, exit, pnl, day: this.st.date.day,
                  lev: p.lev, reason: 'manual' };
    this.st.closed.unshift(rec);
    if (this.st.closed.length > 200) this.st.closed.pop();
    if (n >= p.units) this.st.positions.splice(i, 1);
    else p.units -= n;

    this.pushLog(pnl >= 0 ? 'win' : 'close', `${s.def.short} 平仓 ${U.fmt(n)}通貨`, pnl);
    // 心理变化
    if (pnl > 0) { this.st.stats.mental = U.clamp(this.st.stats.mental + 1.5, 0, 100); this.fx('coin'); }
    else { this.st.stats.mental = U.clamp(this.st.stats.mental - Math.min(12, Math.abs(pnl) / 20000 + 2), 0, 100); this.fx('lose'); }
    this.hap('tap');
    this.emit('close', { rec, pnl });
    this.checkAchievements();
    this.checkDaily('instant');
    this.save();
    return { ok: true, pnl, rec };
  }

  closeAll(reason) {
    let total = 0;
    const list = this.st.positions.slice();
    for (const p of list) {
      const r = this.close(p.id, p.units);
      if (r.ok) total += r.pnl;
    }
    return total;
  }

  /** 全部平仓但用于风控（强平） */
  liquidate(p, why) {
    const s = this.market.pair(p.pid);
    const exit = p.dir > 0 ? s.bid() : s.ask();
    const pnl = (exit - p.entry) * p.dir * p.units;
    const marginBack = p.units * (p.entry / p.lev);
    this.st.cash += marginBack + pnl;
    this.st.stats.totalPnl += pnl;
    this.st.stats.mental = U.clamp(this.st.stats.mental - 18 * this.mentalLossMul(), 0, 100);
    this.st.stats.liquidated++;
    if (this.st.dailyStat) this.st.dailyStat.liquidated = (this.st.dailyStat.liquidated || 0) + 1;
    this.checkAchievements();
    if (pnl < this.st.stats.worstLoss) this.st.stats.worstLoss = pnl;
    const i = this.st.positions.indexOf(p);
    if (i >= 0) this.st.positions.splice(i, 1);
    const rec = { pid: p.pid, dir: p.dir, units: p.units, entry: p.entry, exit, pnl, day: this.st.date.day,
                  lev: p.lev, reason: why || 'liquidated' };
    this.st.closed.unshift(rec);
    this.pushLog('liq', `${PAIRS[p.pid].short} 強制ロスカット`, pnl);
    return rec;
  }

  /* ===== 风控：追证 / 强制平仓 ===== */
  /**
   * 某货币对的爆仓价（维持率 50% 时）
   * 注意：维持率用的是【账户全部净值】÷【全部必要保证金】，
   * 所以同一个账户里其它货币对的浮盈浮亏，也会把你推下悬崖。
   * 而闲置现金会缓冲爆仓——这就是为什么"钱多反而爆得慢"，
   * 也正是为什么借钱加仓的人会死得特别快（一爆就全没了）。
   */
  liqPriceFor(pid, eqOverride, marginOverride, extraUnits) {
    const s = this.market.pair(pid);
    const ps = this.st.positions.filter(p => p.pid === pid);
    let units = ps.reduce((a, p) => a + p.units, 0);
    let dir = ps.length ? ps[0].dir : 0;
    // 预览模式：模拟"再加一单"之后的情形
    if (extraUnits) { units += extraUnits; dir = dir || this._previewDir || 1; }
    if (!units || !dir) return null;

    const usedMargin = marginOverride === undefined ? this.usedMargin() : marginOverride;
    const eq = eqOverride === undefined ? this.equity() : eqOverride;
    const lossAvail = eq - usedMargin * (this.liqThreshold() / 100);
    if (lossAvail <= 0) return s.price;                       // 现在就已经在爆仓边缘
    const curThis = ps.reduce((a, p) => a + this.unrealized(p), 0);
    const bearable = curThis + lossAvail;                     // 该品种可再承受的亏损
    const move = bearable / units;
    return dir > 0 ? s.price - move : s.price + move;
  }

  /** 距离爆仓还有多少 pips（正数=还安全） */
  pipsToLiq(pid) {
    const s = this.market.pair(pid);
    const lp = this.liqPriceFor(pid);
    if (lp === null) return Infinity;
    const ps = this.st.positions.filter(p => p.pid === pid);
    if (!ps.length) return Infinity;
    return (lp - s.price) * ps[0].dir / s.def.pip;
  }

  checkRisk() {
    if (!this.hasPosition()) { this.marginCall = null; return; }
    const rate = this.marginRate();
    if (rate <= this.liqThreshold()) {
      // 全部强平
      const list = this.st.positions.slice().sort((a, b) => this.unrealized(a) - this.unrealized(b));
      this.emit('liquidateBegin', {});
      this.fx('crash'); this.hap('crash');
      const recs = list.map(p => this.liquidate(p, 'liquidated'));
      this.st.stats.mental = U.clamp(this.st.stats.mental - 15 * this.mentalLossMul(), 0, 100);
      this.marginCall = null;
      this.emit('liquidated', { recs });
      this.save();
      return;
    }
    const callLine = Math.max(92, 100 - (this.st.stats.level - 1) * 0.8);
    if (rate <= callLine && (!this.marginCall || this.marginCall.level !== 1)) {
      this.st.stats.marginCalls = (this.st.stats.marginCalls || 0) + 1;
      this.marginCall = { level: 1, rate };
      this.fx('alarm'); this.hap('lose');
      this.emit('margincall', { level: 1, rate });
    } else if (rate > 130) {
      this.marginCall = null;
    }
  }

  /** 追证入金 */
  deposit(amount, fromWallet) {
    if (amount <= 0) return { ok: false, why: '金额无效' };
    const pool = fromWallet ? this.st.wallet : this.externalAvailable();
    if (amount > pool + 0.5) return { ok: false, why: '没有这么多钱' };
    if (fromWallet) this.st.wallet -= amount; else this.spendExternal(amount);
    this.st.cash += amount;
    if (this.st.dailyStat) this.st.dailyStat.deposited = (this.st.dailyStat.deposited || 0) + 1;
    this.fx('coin'); this.hap('tap');
    this.pushLog('deposit', '入金', amount);
    this.checkRisk();
    this.save();
    return { ok: true };
  }
  withdraw(amount) {
    if (amount <= 0 || amount > this.st.cash) return { ok: false, why: '出金金额超过可用保证金' };
    this.st.cash -= amount; this.st.wallet += amount;
    this.pushLog('withdraw', '出金', -amount);
    this.fx('click');
    this.save();
    return { ok: true };
  }

  externalAvailable() { return this.st.wallet; }
  spendExternal(a) { this.st.wallet -= a; }

  /* ===== 借贷 ===== */
  loanOffers() {
    return LOAN_PRODUCTS.filter(p => { try { return p.require(this.st); } catch (e) { return false; } });
  }
  borrowedOf(pid) { return this.st.loans.filter(l => l.pid === pid).reduce((a, l) => a + l.amount, 0); }

  borrow(pid, amount) {
    const def = LOAN_PRODUCTS.find(p => p.id === pid);
    if (!def) return { ok: false, why: '不存在的贷款' };
    if (!def.require(this.st)) return { ok: false, why: '对方不会借给你' };
    if (amount <= 0) return { ok: false, why: '金额无效' };
    const already = this.borrowedOf(pid);
    const cap = this.loanLimit(def);
    if (already + amount > cap) return { ok: false, why: `这个渠道的上限是 ${U.fmt(cap)} 円（已借 ${U.fmt(already)}）` };
    const fee = Math.round(amount * def.fee);
    const got = amount - fee;
    this.st.loans.push({ pid, amount, since: this.st.date.day, rollDay: this.st.date.day + def.grace, principal: amount });
    this.st.wallet += got;
    if (this.st.dailyStat) this.st.dailyStat.borrowed = (this.st.dailyStat.borrowed || 0) + 1;
    this.st.stats.loansTaken = this.st.stats.loansTaken || {};
    this.st.stats.loansTaken[pid] = true;
    this.st.flags.hasBorrowed = true;
    this.st.stats.mental = U.clamp(this.st.stats.mental - (def.danger >= 4 ? 6 : 3), 0, 100);
    this.st.stats.greed = U.clamp(this.st.stats.greed + def.danger, 0, 100);
    this.pushLog('loan', `${def.name} 借入 ${U.fmt(amount)} 円（手数料 ${U.fmt(fee)}）`, 0);
    this.fx('loan'); this.hap('lose');
    if (pid === 'mochiko') { this.st.flags.mochikoDeal = true; this.mochiko.mood = 'loan'; }
    this.bark('loan', pid);
    this.emit('borrow', { def, amount, fee });
    this.checkAchievements();
    this.checkDaily('instant');
    this.save();
    return { ok: true, got, fee };
  }

  repay(pid, amount) {
    const def = LOAN_PRODUCTS.find(p => p.id === pid);
    const ls = this.st.loans.filter(l => l.pid === pid);
    if (!ls.length) return { ok: false, why: '没有这笔借款' };
    let pool = Math.min(amount, this.st.cash + this.st.wallet);
    // 先花钱包，再花保证金
    let left = pool, paid = 0;
    for (const l of ls) {
      if (left <= 0) break;
      const pay = Math.min(left, l.amount);
      l.amount -= pay; left -= pay; paid += pay;
    }
    const fromWallet = Math.min(this.st.wallet, paid);
    this.st.wallet -= fromWallet;
    this.st.cash -= (paid - fromWallet);
    this.st.loans = this.st.loans.filter(l => l.amount > 0.5);
    if (paid > 0 && this.st.dailyStat) this.st.dailyStat.repaid = (this.st.dailyStat.repaid || 0) + paid;
    if (def.danger >= 4 && paid > 0) this.st.stats.mental = U.clamp(this.st.stats.mental + 4, 0, 100);
    this.pushLog('repay', `${def.name} 返済 ${U.fmt(paid)} 円`, 0);
    this.fx('coin'); this.hap('tap');
    this.emit('repay', { pid, paid });
    this.checkDaily('instant');
    this.save();
    return { ok: true, paid };
  }

  /** 每日利息与催收 */
  accrueInterest(day) {
    let total = 0;
    for (const l of this.st.loans.slice()) {
      const def = LOAN_PRODUCTS.find(p => p.id === l.pid);
      const interest = l.amount * def.rate / 365;
      l.amount += interest;
      total += interest;
      if (day >= l.rollDay) {
        l.rollDay = day + def.grace;
        if (def.rolloverFee > 0) l.amount += def.rolloverFee;
        this.emit('collect', { def, amount: l.amount });
        if (def.danger >= 4) {
          // 取立て：直接从保证金里扣，不够就吃心理值
          const take = Math.min(this.st.cash > 0 ? this.st.cash : 0, def.danger * 12000);
          this.st.cash -= take;
          if (take < def.danger * 12000) this.st.stats.mental = U.clamp(this.st.stats.mental - 8, 0, 100);
          this.fx('alarm');
          this.emit('harass', { def, take });
        } else if (def.danger >= 3) {
          this.fx('alarm');
          this.emit('harass', { def, take: 0 });
        }
      }
    }
    this.st.loanTotals = total;
  }

  /* ===== 经验 / 成就 ===== */
  /** 升级所需经验 */
  xpNeed(lv) { return 100 + ((lv || this.st.stats.level) - 1) * 85; }

  addXp(n, why) {
    this.st.stats.xp += n;
    let leveled = 0;
    // 一次可能连升多级
    while (this.st.stats.xp >= this.xpNeed()) {
      this.st.stats.xp -= this.xpNeed();
      this.st.stats.level++;
      this.st.stats.insight = Math.min(100, this.st.stats.insight + 4);
      // 升级奖励：1 点洞察（可换 10 万，或买永久技能）
      this.st.insightPts += 1;
      leveled++;
    }
    if (leveled > 0) {
      this.emit('levelup', { level: this.st.stats.level, why, gained: leveled });
      this.fx('bigwin'); this.hap('win');
    }
  }

  /**
   * 强平阈值（维持率）。等级越高越抗打击。
   * 基础 50%，每级 -0.7%，最低 40%。
   * Lv.1 → 50%   Lv.5 → 47.2%   Lv.10 → 43.7%   Lv.15+ → 40%
   */
  liqThreshold() {
    return Math.max(40, 50 - (this.st.stats.level - 1) * 0.7);
  }

  /* ===== 日志 / 对白 ===== */
  pushLog(kind, text, amount) {
    this.st.log.unshift({ kind, text, amount: amount || 0, day: this.st.date.day, t: Date.now() });
    if (this.st.log.length > 120) this.st.log.pop();
  }

  bark(kind, who) {
    if (this.barkCool > 0) return null;
    this.barkCool = 6;
    const src = BARKS[who];
    if (!src) return null;
    const arr = src[kind] || src.idle;
    const line = arr[Math.floor(Math.random() * arr.length)].replace('」，', '」');
    this.emit('bark', { who, line });
    return line;
  }

  /* ===== 教学 ===== */
  hasSeen(id) { return !!this.st.tutorials[id]; }
  seen(id) { this.st.tutorials[id] = 1; this.save(); }

  /* ===== 一日总结数据 ===== */
  snapshot() {
    return {
      equity: this.equity(), margin: this.usedMargin(), rate: this.marginRate(),
      pnl: this.unrealizedAll(), cash: this.st.cash, loan: this.totalLoan(),
      net: this.netAsset(), positions: this.st.positions.length,
    };
  }
}
let posSeq = 1;
