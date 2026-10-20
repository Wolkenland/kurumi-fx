/* ============================================================
 * FX战士久留美 - 交易模拟器
 * 01-util.js  基础工具 / 数学 / 随机数 / 存储 / 音效 / 触感
 * ============================================================ */
const U = (() => {
  'use strict';

  /** 有种子随机数（mulberry32）—— 保证同一存档回放一致 */
  function rngFrom(seed) {
    let a = seed >>> 0;
    const f = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return f;
  }

  /** 标准正态（Box-Muller） */
  function gauss(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const inst = (c, v) => c + (v - c) * 0.22;         // 指数光滑（帧率无关的近似）
  const instDt = (c, v, dt, speed) => c + (v - c) * (1 - Math.exp(-dt * speed));

  /** 千分位 */
  function fmt(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const neg = n < 0;
    const d = dec === undefined ? 0 : dec;
    const s = Math.abs(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  /** 带正负号 */
  function sfmt(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : n < 0 ? '-' : '') + fmt(Math.abs(n), dec === undefined ? 0 : dec);
  }

  /** 日元金额缩写 */
  function yenShort(n) {
    const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '万';
    return fmt(n, 0);
  }

  function pct(n, dec) {
    return fmt(n, dec === undefined ? 1 : dec) + '%';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 游戏内日期：起始 2021/04/05 星期一 */
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function addDays(y, m, d, n) {
    let t = Date.UTC(y, m - 1, d) + n * 86400000;
    const dt = new Date(t);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), w: dt.getUTCDay() };
  }
  function dateLabel(dt) {
    return `${dt.m}/${dt.d}(${WEEK[dt.w]})`;
  }

  /** 淡入淡出的定时器集合（切场景时统一清理） */
  function makeTimers() {
    const set = new Set();
    return {
      after(ms, fn) {
        const id = setTimeout(() => { set.delete(id); fn(); }, ms);
        set.add(id); return id;
      },
      every(ms, fn) {
        const id = setInterval(fn, ms);
        set.add(id); return id;
      },
      clear(id) { clearTimeout(id); clearInterval(id); set.delete(id); },
      clearAll() { set.forEach(id => { clearTimeout(id); clearInterval(id); }); set.clear(); }
    };
  }

  /** 简易深合并（用于存档迁移） */
  function merge(base, patch) {
    if (patch === null || patch === undefined) return base;
    if (Array.isArray(base)) return Array.isArray(patch) ? patch : base;
    if (typeof base === 'object' && typeof patch === 'object') {
      const out = {};
      for (const k in base) out[k] = merge(base[k], patch[k]);
      for (const k in patch) if (!(k in out)) out[k] = patch[k];
      return out;
    }
    return patch;
  }

  return { rngFrom, gauss, clamp, lerp, inst, instDt, fmt, sfmt, yenShort, pct, pad2,
           addDays, dateLabel, MONTH_DAYS, WEEK, makeTimers, merge };
})();

/* ---------------- 触感反馈 ---------------- */
const Haptics = (() => {
  'use strict';
  let ok = true;
  function buzz(p) {
    if (!ok) return;
    try {
      // APK 版：原生震动桥接（比 WebView 的 navigator.vibrate 更可靠）
      if (window.AndroidVibe && typeof AndroidVibe.buzz === 'function') {
        AndroidVibe.buzz(Array.isArray(p) ? p.join(',') : String(p));
        return;
      }
      if (navigator.vibrate) { navigator.vibrate(p); return; }
      if (window.AndroidBridge && AndroidBridge.vibrate) { AndroidBridge.vibrate(Array.isArray(p) ? p[0] : p); }
    } catch (e) { /* 失败就静默降级，不影响游戏 */ }
  }
  return {
    tap()   { buzz(8); },
    press() { buzz(16); },
    win()   { buzz([0, 14, 40, 26]); },
    lose()  { buzz([0, 34, 50, 34, 50, 60]); },
    crash() { buzz([0, 90, 40, 90, 40, 160, 60, 240]); },
  };
})();

/* ---------------- 音效（纯 WebAudio 合成，无外部资源） ---------------- */
const Sfx = (() => {
  'use strict';
  let ctx = null, master = null, enabled = true, started = false;

  function boot() {
    if (started) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      started = true;
      return true;
    } catch (e) { return false; }
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.5 : 0; }
  function isEnabled() { return enabled; }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!enabled || !boot()) return;
    resume();
    const t0 = (ctx.currentTime) + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime((vol === undefined ? 0.2 : vol), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, freq, q) {
    if (!enabled || !boot()) return;
    resume();
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = freq || 900; bp.Q.value = q || 1.2;
    const g = ctx.createGain(); g.gain.value = vol || 0.2;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
  }

  return {
    setEnabled, isEnabled, boot, resume,
    click()    { tone(1250, 0.05, 'square', 0.06); },
    open()     { tone(660, 0.1, 'sine', 0.12, 990); },
    close()    { tone(520, 0.12, 'sine', 0.1, 330); },
    buy()      { tone(523, 0.1, 'triangle', 0.18); tone(784, 0.16, 'triangle', 0.14, null, 0.07); },
    sell()     { tone(392, 0.1, 'triangle', 0.18); tone(294, 0.16, 'triangle', 0.14, null, 0.07); },
    error()    { tone(180, 0.16, 'sawtooth', 0.14); },
    coin()     { tone(988, 0.07, 'square', 0.1); tone(1319, 0.12, 'square', 0.08, null, 0.05); },
    bigwin()   { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.26, 'triangle', 0.16, null, i * 0.08)); },
    lose()     { tone(300, 0.3, 'sawtooth', 0.13, 120); },
    crash()    {
      noise(0.7, 0.3, 420, 0.7);
      tone(140, 0.8, 'sawtooth', 0.2, 48);
      tone(90, 1.2, 'sine', 0.18, 40, 0.05);
    },
    alarm()    { tone(880, 0.18, 'square', 0.14); tone(880, 0.18, 'square', 0.14, null, 0.24); },
    heart()    { tone(70, 0.14, 'sine', 0.24, 50); tone(64, 0.18, 'sine', 0.18, 44, 0.16); },
    loan()     { [440, 466, 392].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, null, i * 0.11)); },
  };
})();

/* ---------------- 涨跌配色 ---------------- */
/**
 * 国际市场惯例：绿涨红跌
 * 东亚（日/中/台）股市惯例：红涨绿跌
 * 用 data-scheme 属性驱动 CSS 变量，JS 侧同步读取。
 */
const Theme = (() => {
  const KEY = 'fxkurumi.scheme';
  const WEST = { up: '#3ddc97', down: '#ff4d6d', name: '绿涨红跌（国际 FX）' };
  const EAST = { up: '#ff4d6d', down: '#3ddc97', name: '红涨绿跌（东亚股市）' };
  // 默认用东亚惯例（红涨绿跌）——《FX战士久留美》是日本作品，
  // 且中文玩家更习惯这套；设置里可切回国际 FX 的绿涨红跌。
  let cur = 'east';
  try { cur = localStorage.getItem(KEY) || 'east'; } catch (e) { cur = 'east'; }

  function apply() {
    try {
      document.documentElement.setAttribute('data-scheme', cur === 'east' ? 'east' : 'west');
    } catch (e) {}
  }
  apply();

  return {
    get current() { return cur; },
    up() { return cur === 'east' ? EAST.up : WEST.up; },
    down() { return cur === 'east' ? EAST.down : WEST.down; },
    /** 根据数值取色 */
    of(v) { return v >= 0 ? this.up() : this.down(); },
    set(id) {
      cur = id === 'east' ? 'east' : 'west';
      try { localStorage.setItem(KEY, cur); } catch (e) {}
      apply();
      return cur;
    },
    toggle() { return this.set(cur === 'east' ? 'west' : 'east'); },
    options() { return [['west', WEST.name], ['east', EAST.name]]; },
    label() { return cur === 'east' ? EAST.name : WEST.name; },
  };
})();

/* ---------------- 本地存储（多槽 + 自动备份 + 元信息） ---------------- */
const Store = (() => {
  'use strict';
  const LEGACY_KEY = 'fxkurumi.save.v2';          // 旧版单槽，读档时自动迁移
  const SLOT_KEY = n => `fxkurumi.save.slot${n}`;
  const META_KEY = 'fxkurumi.save.meta';
  const BACKUP_KEY = 'fxkurumi.save.backup';
  const SLOTS = 3;

  let available = true;
  try {
    localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
  } catch (e) { available = false; }
  const memory = {};

  function rawGet(k) {
    try { return available ? localStorage.getItem(k) : (memory[k] || null); }
    catch (e) { return memory[k] || null; }
  }
  function rawSet(k, v) {
    try {
      if (available) localStorage.setItem(k, v); else memory[k] = v;
      return true;
    } catch (e) {
      // 配额超限：尝试清理备份后再写一次
      try { localStorage.removeItem(BACKUP_KEY); localStorage.setItem(k, v); return true; }
      catch (e2) { memory[k] = v; return false; }
    }
  }

  /** 简易校验，用来发现损坏的存档 */
  function checksum(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function readMeta() {
    try { return JSON.parse(rawGet(META_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeMeta(m) { rawSet(META_KEY, JSON.stringify(m)); }

  return {
    available,
    SLOTS,

    /**
     * 保存到指定槽
     * @param obj 存档负载
     * @param slot 槽位 0..2
     * @param info 显示用元信息 {day, level, netAsset, chapter}
     */
    save(obj, slot, info) {
      slot = slot | 0;
      // 先把上一份内容挪到备份（只在写主槽时做，避免反复复制）
      const prev = rawGet(SLOT_KEY(slot));
      if (prev && prev.length > 200) rawSet(BACKUP_KEY, prev);

      let raw;
      try { raw = JSON.stringify(obj); } catch (e) { return false; }
      const wrapped = JSON.stringify({ cs: checksum(raw), d: raw, t: Date.now() });
      const ok = rawSet(SLOT_KEY(slot), wrapped);

      const m = readMeta();
      m[slot] = Object.assign({}, info || {}, {
        savedAt: Date.now(),
        size: wrapped.length,
        ok,
      });
      writeMeta(m);
      return ok;
    },

    /** 读指定槽；校验失败自动回退备份 */
    load(slot) {
      slot = slot | 0;
      const tryParse = (raw) => {
        if (!raw) return null;
        try {
          const w = JSON.parse(raw);
          if (!w || !w.d) return null;
          if (w.cs && checksum(w.d) !== w.cs) return { __corrupt: true };
          return JSON.parse(w.d);
        } catch (e) { return { __corrupt: true }; }
      };

      let r = tryParse(rawGet(SLOT_KEY(slot)));
      if (r && r.__corrupt) {
        const b = tryParse(rawGet(BACKUP_KEY));
        if (b && !b.__corrupt) return Object.assign(b, { __fromBackup: true });
        return null;
      }
      if (r) return r;

      // 迁移：没有多槽存档时，尝试读旧版单槽
      // 注意：旧格式是「裸 JSON」（没有 {cs,d,t} 包装），不能走 tryParse
      if (slot === 0) {
        const raw = rawGet(LEGACY_KEY);
        if (raw) {
          try {
            const o = JSON.parse(raw);
            if (o && o.st) return Object.assign(o, { __migrated: true });
            // 万一旧版也被包装过
            if (o && o.d) {
              const inner = JSON.parse(o.d);
              if (inner && inner.st) return Object.assign(inner, { __migrated: true });
            }
          } catch (e) { /* 忽略损坏的旧存档 */ }
        }
      }
      return null;
    },

    /** 列出所有槽的元信息（含是否存在、大小、时间） */
    list() {
      const m = readMeta();
      const out = [];
      for (let i = 0; i < SLOTS; i++) {
        let info = m[i] || null;
        if (!info) {
          // 元信息丢了但存档还在？现场补一个
          const raw = rawGet(SLOT_KEY(i));
          if (raw && raw.length > 200) info = { savedAt: null, size: raw.length };
        }
        out.push({ slot: i, info });
      }
      return out;
    },

    /** 哪个槽是当前使用的 */
    get active() {
      const v = rawGet('fxkurumi.save.active');
      return v === null ? 0 : (+v || 0);
    },
    set active(n) { rawSet('fxkurumi.save.active', String(n | 0)); },

    /** 是否存在任何存档 */
    hasAny() {
      for (let i = 0; i < SLOTS; i++) if (rawGet(SLOT_KEY(i))) return true;
      return !!rawGet(LEGACY_KEY);
    },

    remove(slot) {
      try { localStorage.removeItem(SLOT_KEY(slot | 0)); } catch (e) { memory[SLOT_KEY(slot | 0)] = undefined; }
      const m = readMeta(); delete m[slot | 0]; writeMeta(m);
    },

    hasBackup() { return !!rawGet(BACKUP_KEY); },

    clear() {
      for (let i = 0; i < SLOTS; i++) this.remove(i);
      try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(BACKUP_KEY); localStorage.removeItem(META_KEY); } catch (e) {}
    },

    /** 导出为可复制的文本 */
    exportString(obj) {
      try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return ''; }
    },
    importString(s) {
      try { return JSON.parse(decodeURIComponent(escape(atob(String(s).trim())))); } catch (e) { return null; }
    },
    /** 导出为 .json 文本（更通用） */
    exportJson(obj) { try { return JSON.stringify(obj, null, 1); } catch (e) { return ''; } },
  };
})();
