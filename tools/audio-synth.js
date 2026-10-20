#!/usr/bin/env node
/**
 * 配乐与音效合成器 —— 「燃」版
 *
 * 风格：电子摇滚 / 赛博朋克
 *   · 128 BPM，四四拍鼓组（kick / snare / hihat / clap）
 *   · 八分音符锯齿贝斯推进
 *   · 主旋律 lead（方波 + 延迟）
 *   · 十六分音符琶音
 *   · 和声进行：Am – F – C – G（最"燃"的万能进行）
 *
 * 结构：蓄力 → 建立 → 第一次 drop → 第二次 drop → 科技感 → 第三次 drop → 收束
 *
 * 全部数学合成，无外部采样。输出 44.1kHz / 16bit / 立体声 WAV
 */
const fs = require('fs');
const path = require('path');

const SR = 44100;
const DUR = 122;
const N = SR * DUR;
const BPM = 128;
const BEAT = 60 / BPM;            // 0.46875s
const BAR = BEAT * 4;             // 1.875s

const bufL = new Float32Array(N);
const bufR = new Float32Array(N);

/* ================= 基础工具 ================= */
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;

function curve(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
}

function osc(type, phase) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case 'sin': return Math.sin(p * Math.PI * 2);
    case 'tri': return 1 - 4 * Math.abs(p - 0.5);
    case 'saw': return 2 * p - 1;
    case 'sqr': return p < 0.5 ? 1 : -1;
    case 'sqr25': return p < 0.25 ? 1 : -1;   // 窄方波，更"电子"
    default: return Math.sin(p * Math.PI * 2);
  }
}

/** 通用发声：包络由 exp 衰减曲线给出 */
function voice(t0, dur, freq, opt) {
  opt = opt || {};
  const type = opt.type || 'sin';
  const gain = opt.gain === undefined ? 0.2 : opt.gain;
  const pan = opt.pan || 0;
  const atk = opt.a === undefined ? 0.005 : opt.a;
  const rel = opt.r === undefined ? 0.08 : opt.r;
  const decay = opt.decay === undefined ? 0 : opt.decay;     // 指数衰减速度（0=不衰减）
  const detune = opt.detune || 0;
  const vib = opt.vibrato || 0;
  const fSlide = opt.slide || 0;                              // 频率滑动目标比例

  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4);
  const gr = Math.sin((pan + 1) * Math.PI / 4);
  let ph1 = 0, ph2 = 0;
  const an = Math.max(1, atk * SR), rn = Math.max(1, rel * SR);

  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    let env;
    if (i < an) env = i / an;
    else if (i > len - rn) env = 1 - (i - (len - rn)) / rn;
    else env = 1;
    if (decay) env *= Math.exp(-decay * i / SR);
    if (env <= 0.0001) continue;

    const prog = i / len;
    const f = freq * (1 + vib * Math.sin(i / SR * Math.PI * 2 * 5.2)) * (1 + fSlide * prog);
    ph1 += f / SR;
    ph2 += (f * (1 + detune)) / SR;
    let v = osc(type, ph1);
    if (detune) v = (v + osc(type, ph2)) * 0.55;
    const out = v * env * gain;
    bufL[idx] += out * gl;
    bufR[idx] += out * gr;
  }
}

/** 噪声类打击 */
function noise(t0, dur, gain, opt) {
  opt = opt || {};
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const hp = opt.hp === undefined ? 0.3 : opt.hp;
  const decay = opt.decay === undefined ? 30 : opt.decay;
  const pan = opt.pan || 0;
  const gl = Math.cos((pan + 1) * Math.PI / 4);
  const gr = Math.sin((pan + 1) * Math.PI / 4);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const env = Math.exp(-decay * i / len);
    const n = Math.random() * 2 - 1;
    const out = (n - prev * hp) * env * gain;
    prev = n;
    bufL[idx] += out * gl;
    bufR[idx] += out * gr;
  }
}

/* ================= 鼓组 ================= */
function kick(t, gain) {
  // 频率从 130Hz 扫到 42Hz
  voice(t, 0.22, 130, { type: 'sin', gain: gain, a: 0.001, r: 0.02, decay: 16, slide: -0.68 });
  // 点击感
  noise(t, 0.02, gain * 0.35, { hp: 0.85, decay: 40 });
}
function snare(t, gain) {
  noise(t, 0.14, gain * 0.7, { hp: 0.55, decay: 18 });
  voice(t, 0.10, 190, { type: 'tri', gain: gain * 0.28, a: 0.001, r: 0.02, decay: 26 });
}
function hihat(t, gain, open) {
  noise(t, open ? 0.14 : 0.035, gain * 0.30, { hp: 0.9, decay: open ? 12 : 45 });
}
function clap(t, gain) {
  for (let k = 0; k < 3; k++) noise(t + k * 0.011, 0.10, gain * 0.30, { hp: 0.6, decay: 22 });
}
function crash(t, gain) {
  noise(t, 1.1, gain * 0.30, { hp: 0.72, decay: 5 });
}

/* ================= 和声 ================= */
/* Am – F – C – G ：i – VI – III – VII，最"燃"的循环 */
const CHORDS = [
  { root: 45, notes: [57, 60, 64] },   // Am
  { root: 41, notes: [53, 57, 60] },   // F
  { root: 48, notes: [55, 60, 64] },   // C
  { root: 43, notes: [55, 59, 62] },   // G
];
const chordAt = t => CHORDS[Math.floor(t / BAR) % CHORDS.length];

/* 段落强度（0~1） */
const INTENSITY = [
  [0, 0.10], [4, 0.25], [6, 0.38], [16, 0.50], [17, 0.62], [39, 0.72],
  [40, 1.00], [56, 1.00], [57, 1.05], [71, 1.00], [72, 0.62], [91, 0.68],
  [92, 0.98], [107, 0.92], [108, 0.55], [118, 0.30], [122, 0.05],
];
const ins = t => curve(INTENSITY, t);

/* 鼓组密度：0=无 1=底鼓+拍手 2=加八分 3=加十六分 */
const DRUM = [
  [0, 0], [6, 0.4], [16, 1], [17, 1.4], [23, 2], [40, 3], [56, 3],
  [57, 3], [71, 2.6], [72, 0.6], [79, 1.2], [91, 1.6], [92, 3], [107, 2],
  [108, 1.4], [116, 0.5], [122, 0],
];
const drumAmt = t => curve(DRUM, t);

/* 主旋律动机（A 小调，强拍起） */
const LEAD = [
  [0, 76, 2], [2, 74, 1], [3, 72, 1],
  [4, 69, 2], [6, 72, 1], [7, 74, 1],
  [8, 76, 2], [10, 79, 2],
  [12, 77, 2], [14, 76, 1], [15, 74, 1],
];
/* 高八度变奏（第三次 drop 用） */
const LEAD_HI = LEAD.map(([b, n, d]) => [b, n + 12, d]);

/* ================= 编曲 ================= */
console.log('→ 和弦铺底（Pad）');
{
  for (let t = 0; t < DUR; t += BAR) {
    const ch = chordAt(t);
    const g = 0.10 + ins(t) * 0.12;
    const dur = BAR * 1.02;
    ch.notes.forEach((n, k) => {
      voice(t, dur, midi(n), { type: 'saw', gain: g * 0.30, a: 0.35, r: 0.5, detune: 0.006, pan: (k - 1) * 0.55 });
      voice(t, dur, midi(n + 12), { type: 'tri', gain: g * 0.10, a: 0.5, r: 0.6, pan: (k - 1) * -0.3 });
    });
  }
}

console.log('→ 贝斯线（八分音符推进）');
{
  for (let t = 0; t < DUR - 0.1; t += BEAT / 2) {
    const amt = drumAmt(t);
    if (amt < 0.4) continue;
    const ch = chordAt(t);
    // 八分音符：根音 / 高八度交替，强拍加重
    const isDown = Math.abs((t / BEAT) % 1) < 0.02;
    const oct = Math.abs((t / (BEAT * 2)) % 2) < 0.02 ? 0 : 12;
    const g = (0.22 + ins(t) * 0.22) * (isDown ? 1 : 0.62) * clamp(amt / 2, 0.3, 1);
    voice(t, BEAT * 0.42, midi(ch.root + oct), {
      type: 'saw', gain: g * 0.5, a: 0.004, r: 0.04, decay: 7, pan: 0,
    });
  }
}

console.log('→ 鼓组');
{
  for (let t = 0; t < DUR - 0.05; t += BEAT) {
    const amt = drumAmt(t);
    if (amt <= 0.01) continue;
    const k = ins(t);
    const bi = Math.round(t / BEAT) % 4;
    const g = 0.30 + k * 0.12;

    // 底鼓：1、3 拍 + 驱动感的下拍
    if (bi === 0 || bi === 2) kick(t, g * clamp(amt / 2, 0.25, 1.1));
    if (amt > 2.4 && (bi === 1 || bi === 3)) kick(t, g * 0.35);

    // 军鼓：2、4 拍
    if ((bi === 1 || bi === 3) && amt > 0.8) snare(t, g * 0.9 * clamp(amt / 2, 0.3, 1));

    // 拍手：加强 2、4
    if ((bi === 1 || bi === 3) && amt > 2.2) clap(t, g * 0.55);

    // 踩镲：八分
    if (amt > 1.2) {
      hihat(t, g * 0.5, false);
      hihat(t + BEAT / 2, g * 0.34, false);
    }
    // 十六分（密集段）
    if (amt > 2.6) {
      hihat(t + BEAT / 4, g * 0.22, true);
      hihat(t + BEAT * 3 / 4, g * 0.22, true);
    }
  }

  // 段落开头的 crash
  [6, 17, 40, 57, 72, 92, 108].forEach(t => crash(t, 0.5 + ins(t) * 0.4));
}

console.log('→ 十六分琶音');
{
  for (let t = 0; t < DUR - 0.1; t += BEAT / 4) {
    const amt = drumAmt(t);
    if (amt < 1.6) continue;
    const ch = chordAt(t);
    const idx = Math.round(t / (BEAT / 4)) % (ch.notes.length * 2);
    const n = ch.notes[idx % ch.notes.length] + (idx >= ch.notes.length ? 12 : 0);
    const g = 0.018 + ins(t) * 0.030;
    voice(t, BEAT * 0.22, midi(n + 12), {
      type: 'sqr25', gain: g, a: 0.002, r: 0.03, decay: 18,
      pan: Math.sin(t * 1.7) * 0.6,
    });
  }
}

console.log('→ 主旋律 Lead');
{
  // 第一次 drop（40s）与第二次（57s）：原调
  [40, 57].forEach((base, ri) => {
    for (let rep = 0; rep < 4; rep++) {
      const off = base + rep * (BAR * 4);
      if (off >= 92) break;
      LEAD.forEach(([b, n, d]) => {
        const t = off + b * (BEAT / 2);
        if (t >= DUR) return;
        const g = (0.10 + ri * 0.02) * (0.8 + ins(t) * 0.5);
        voice(t, d * BEAT * 0.75, midi(n), {
          type: 'sqr', gain: g, a: 0.004, r: 0.10, decay: 3.2, pan: -0.12,
        });
        voice(t, d * BEAT * 0.75, midi(n + 12), {
          type: 'tri', gain: g * 0.35, a: 0.004, r: 0.10, decay: 4.5, pan: 0.25,
        });
      });
    }
  });

  // 第三次 drop（92s）：升高八度，最亮
  for (let rep = 0; rep < 4; rep++) {
    const off = 92 + rep * (BAR * 4);
    if (off >= 108) break;
    LEAD_HI.forEach(([b, n, d]) => {
      const t = off + b * (BEAT / 2);
      if (t >= DUR) return;
      voice(t, d * BEAT * 0.75, midi(n), {
        type: 'sqr', gain: 0.095, a: 0.004, r: 0.10, decay: 3.0, pan: -0.1,
      });
      voice(t, d * BEAT * 0.75, midi(n + 12), {
        type: 'tri', gain: 0.032, a: 0.004, r: 0.10, decay: 4.2, pan: 0.3,
      });
    });
  }
}

console.log('→ 场景音效');
{
  // 开场：心跳 + 蓄力的上升音
  for (let i = 0; i < 3; i++) {
    const t = 0.5 + i * 1.25;
    kick(t, 0.34); kick(t + 0.24, 0.22);
  }
  voice(0.2, 5.4, midi(45), { type: 'saw', gain: 0.05, a: 3.0, r: 1.2, decay: 0.2 });

  // 每次 drop 前的 riser（上升噪声）
  [38.5, 55.5, 90.5].forEach(t => {
    noise(t, 1.9, 0.09, { hp: 0.05, decay: -1.6 });   // 负衰减 = 渐强
  });

  // 爆仓三连（53 / 55.2 / 57.4s）
  [53.0, 55.2, 57.4].forEach((t, i) => {
    voice(t, 0.6, midi(26 - i * 2), { type: 'sin', gain: 0.42, a: 0.001, r: 0.05, decay: 7, slide: -0.35 });
    noise(t, 0.35, 0.20, { hp: 0.5, decay: 16 });
    voice(t + 0.01, 0.5, midi(90), { type: 'sqr25', gain: 0.020, a: 0.001, r: 0.2, decay: 9 });
  });

  // 借贷：细密计算器点击
  for (let t = 58.5; t < 71; t += BEAT / 4) {
    noise(t, 0.02, 0.030, { hp: 0.85, decay: 60 });
  }

  // AI：电子提示
  [74.4, 76.1, 77.8].forEach((t, i) => {
    voice(t, 0.16, midi(86 + i * 5), { type: 'sqr25', gain: 0.055, a: 0.002, r: 0.05, decay: 14, pan: 0.35 });
  });

  // 洞察：明亮上行
  [93.2, 93.7, 94.2, 94.7, 95.2].forEach((t, i) => {
    voice(t, 0.5, midi(72 + i * 3), { type: 'tri', gain: 0.075, a: 0.003, r: 0.2, decay: 5, pan: (i - 2) * 0.25 });
  });

  // 结尾：大三和弦长音收束
  [110, 115.5].forEach((t, i) => {
    [57, 61, 64].forEach((n, k) => {
      voice(t, 6.0 - i, midi(n), { type: 'tri', gain: 0.055, a: 0.8, r: 2.2, pan: (k - 1) * 0.4 });
    });
  });
}

/* ================= 混响 ================= */
console.log('→ 混响与母带');
{
  const wet = new Float32Array(N), wetR = new Float32Array(N);
  const taps = [[0.023, 0.32], [0.037, 0.26], [0.053, 0.19], [0.071, 0.13], [0.097, 0.08]];
  for (const [dly, g] of taps) {
    const d = Math.floor(dly * SR);
    for (let i = d; i < N; i++) {
      wet[i] += bufL[i - d] * g;
      wetR[i] += bufR[i - d] * g;
    }
  }
  for (let i = 0; i < N; i++) {
    bufL[i] = bufL[i] * 0.88 + wet[i] * 0.26;
    bufR[i] = bufR[i] * 0.88 + wetR[i] * 0.26;
  }
}

{
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(bufL[i]), Math.abs(bufR[i]));
  const g = peak > 0 ? 0.90 / peak : 1;
  for (let i = 0; i < N; i++) {
    bufL[i] = Math.tanh(bufL[i] * g * 1.15) * 0.96;
    bufR[i] = Math.tanh(bufR[i] * g * 1.15) * 0.96;
  }
  console.log(`   峰值 ${peak.toFixed(3)} → 归一化`);
}

/* ================= 写 WAV ================= */
function writeWav(file, L, R) {
  const n = L.length, dataBytes = n * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii'); buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32767), o); o += 2;
    buf.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32767), o); o += 2;
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

const out = process.env.OUT || path.join(path.dirname(__dirname), 'dist', 'score.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
const bytes = writeWav(out, bufL, bufR);
console.log(`✓ 音轨已生成：${out}  (${(bytes / 1048576).toFixed(1)} MB / ${DUR}s)`);
