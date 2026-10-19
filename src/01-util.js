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

/* ---------------- 本地存储 ---------------- */
const Store = (() => {
  'use strict';
  const KEY = 'fxkurumi.save.v2';
  let available = true;
  try {
    localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
  } catch (e) { available = false; }

  const memory = {};
  return {
    available,
    load() {
      try {
        const raw = available ? localStorage.getItem(KEY) : memory[KEY];
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) { return null; }
    },
    save(obj) {
      try {
        const raw = JSON.stringify(obj);
        if (available) localStorage.setItem(KEY, raw); else memory[KEY] = raw;
        return true;
      } catch (e) { return false; }
    },
    clear() {
      try { if (available) localStorage.removeItem(KEY); else delete memory[KEY]; } catch (e) {}
    },
    raw() { try { return available ? localStorage.getItem(KEY) : memory[KEY]; } catch (e) { return null; } },
    /** 导出存档为可下载文本 */
    exportString(obj) { try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return ''; } },
    importString(s) { try { return JSON.parse(decodeURIComponent(escape(atob(s.trim())))); } catch (e) { return null; } }
  };
})();
