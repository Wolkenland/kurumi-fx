#!/usr/bin/env node
/**
 * 配乐与音效合成器
 *
 * 没有任何外部音源/采样，全部用数学合成：
 *   · 振荡器（正弦 / 三角 / 锯齿 / 方波）+ ADSR 包络
 *   · 一阶低通滤波
 *   · 简化的立体声延迟混响
 *   · 节奏序列 + 场景强度曲线
 *
 * 输出 44.1kHz / 16bit / 立体声 WAV
 *
 *   node tools/audio-synth.js  →  dist/score.wav
 */
const fs = require('fs');
const path = require('path');

const SR = 44100;
const DUR = 122;                       // 与视频等长
const N = SR * DUR;

const bufL = new Float32Array(N);
const bufR = new Float32Array(N);

/* ================= 工具 ================= */
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;

/** 分段折线插值：给定 [[t,v],...] 求 t 时刻的值 */
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

/** ADSR 包络值 */
function adsr(i, len, a, d, s, r) {
  const an = Math.max(1, a * SR), dn = Math.max(1, d * SR), rn = Math.max(1, r * SR);
  if (i < an) return i / an;
  if (i < an + dn) return lerp(1, s, (i - an) / dn);
  if (i < len - rn) return s;
  if (i < len) return s * (1 - (i - (len - rn)) / rn);
  return 0;
}

/** 振荡器 */
function osc(type, phase) {
  const p = phase % 1;
  switch (type) {
    case 'sin': return Math.sin(p * Math.PI * 2);
    case 'tri': return 1 - 4 * Math.abs(p - 0.5);
    case 'saw': return 2 * p - 1;
    case 'sqr': return p < 0.5 ? 1 : -1;
    default: return Math.sin(p * Math.PI * 2);
  }
}

/** 加一个音符 */
function note(t0, dur, freq, opt) {
  opt = opt || {};
  const type = opt.type || 'sin';
  const gain = opt.gain === undefined ? 0.2 : opt.gain;
  const pan = opt.pan === undefined ? 0 : opt.pan;          // -1 ~ 1
  const a = opt.a || 0.01, d = opt.d || 0.12, s = opt.s === undefined ? 0.7 : opt.s, r = opt.r || 0.2;
  const detune = opt.detune || 0;
  const vibrato = opt.vibrato || 0;
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4);
  const gr = Math.sin((pan + 1) * Math.PI / 4);
  let ph1 = Math.random(), ph2 = Math.random();
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const env = adsr(i, len, a, d, s, r);
    if (env <= 0) continue;
    const vib = vibrato ? 1 + vibrato * Math.sin(i / SR * Math.PI * 2 * 5.5) : 1;
    const f = freq * vib;
    ph1 += f / SR;
    ph2 += (f * (1 + detune)) / SR;
    let v = osc(type, ph1);
    if (detune) v = (v + osc(type, ph2)) * 0.5;
    const out = v * env * gain;
    bufL[idx] += out * gl;
    bufR[idx] += out * gr;
  }
}

/** 噪声（打击乐 / 类鼓） */
function noiseHit(t0, dur, gain, opt) {
  opt = opt || {};
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const a = opt.a || 0.002, d = opt.d || dur * 0.6;
  const hp = opt.hp || 0.2;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    const env = adsr(i, len, a, d, 0.06, dur * 0.3);
    const n = Math.random() * 2 - 1;
    // 简易高通
    const out = n - prev * hp;
    prev = n;
    const v = out * env * gain;
    bufL[idx] += v;
    bufR[idx] += v;
  }
}

/* ================= 编曲 ================= */
/*
 * 调性：A 小调
 * 和弦进行：Am – F – Dm – E（自然小调，最"不安"的循环）
 * 场景强度：开场低 → 杠杆/借贷最高 → AI 科技感 → 洞察明亮 → 结尾收束
 */

const AM = [57, 60, 64], F = [53, 57, 60], DM = [50, 53, 57], EM = [52, 55, 59];
const ROOT = { Am: 45, F: 41, Dm: 38, Em: 40 };
const PROG = [[AM, 'Am'], [F, 'F'], [DM, 'Dm'], [EM, 'Em']];

/** 场景强度（0~1）：控制音量、音色、密度 */
const INTENSITY = [
  [0, 0.05], [5, 0.18], [6, 0.25], [16, 0.35], [17, 0.45], [39, 0.55],
  [40, 0.85], [56, 0.9], [57, 1.0], [71, 0.95], [72, 0.7], [91, 0.75],
  [92, 0.5], [107, 0.6], [108, 0.35], [121, 0.15], [122, 0.0],
];
const ins = t => curve(INTENSITY, t);

/** 是否有低音铺底 */
const PAD_GAIN = [
  [0, 0.0], [1.5, 0.10], [6, 0.13], [17, 0.15], [40, 0.20],
  [57, 0.24], [72, 0.18], [92, 0.16], [108, 0.12], [121, 0.05], [122, 0]
];

console.log('→ 合成和弦铺底 + 低音线');
{
  // 每 4 秒一个和弦
  const barLen = 3.4;
  for (let t = 0; t < DUR - 0.2; t += barLen) {
    const [chord, name] = PROG[Math.floor(t / barLen) % PROG.length];
    const g = curve(PAD_GAIN, t) * (0.7 + ins(t) * 0.6);
    // Pad：三个音，轻微失谐 + 慢包络
    chord.forEach((n, k) => {
      note(t, barLen * 1.05, midi(n), {
        type: 'saw', gain: g * 0.13, a: 0.9 + k * 0.1, d: 0.6, s: 0.75, r: 1.1,
        detune: 0.004, pan: (k - 1) * 0.5,
      });
      note(t, barLen * 1.05, midi(n - 12), {
        type: 'tri', gain: g * 0.10, a: 1.1, d: 0.6, s: 0.7, r: 1.2, pan: (k - 1) * -0.4,
      });
    });
    // 低音
    note(t, barLen * 0.92, midi(ROOT[name]), {
      type: 'sin', gain: g * 0.30, a: 0.02, d: 0.35, s: 0.55, r: 0.4,
    });
    note(t, barLen * 0.92, midi(ROOT[name] - 12), {
      type: 'sin', gain: g * 0.22, a: 0.02, d: 0.35, s: 0.5, r: 0.4,
    });
  }
}

console.log('→ 合成节奏脉冲');
{
  const beat = 0.62;                        // ≈ 97 BPM
  for (let t = 0; t < DUR; t += beat) {
    const k = ins(t);
    if (k < 0.2) continue;
    const isDown = Math.abs((t / beat) % 4) < 0.01;
    // 底鼓
    if (isDown || k > 0.5) {
      note(t, 0.20, midi(28), { type: 'sin', gain: 0.30 * k, a: 0.002, d: 0.10, s: 0.2, r: 0.10 });
    }
    // 高频 tick（8 分）
    for (let sub = 0; sub < 2; sub++) {
      const tt = t + sub * beat / 2;
      if (tt >= DUR) break;
      if (k < 0.3) continue;
      noiseHit(tt, 0.05, 0.045 * k * (sub ? 0.6 : 1), { hp: 0.6 });
      note(tt, 0.045, midi(96 + (sub ? 3 : 0)), { type: 'sqr', gain: 0.012 * k, pan: sub ? 0.4 : -0.4 });
    }
  }
}

console.log('→ 合成场景音效');
{
  // 开场低频心跳
  for (let i = 0; i < 4; i++) {
    const t = 0.6 + i * 1.35;
    note(t, 0.30, midi(26), { type: 'sin', gain: 0.34, a: 0.005, d: 0.10, s: 0.25, r: 0.14 });
    note(t + 0.26, 0.26, midi(24), { type: 'sin', gain: 0.22, a: 0.005, d: 0.08, s: 0.2, r: 0.12 });
  }

  // 场景切换的 whoosh（噪声扫频感：用高通噪声 + 音量包络近似）
  [6, 17, 21, 40, 57, 72, 92, 108].forEach(t => {
    noiseHit(t - 0.18, 0.5, 0.10, { hp: 0.03, a: 0.20, d: 0.15 });
    note(t - 0.10, 0.4, midi(40), { type: 'saw', gain: 0.06, a: 0.18, d: 0.1, s: 0.3, r: 0.2 });
  });

  // 杠杆爆仓：三声低频冲击（对应 10×/50×/100× 依次爆仓）
  [53.0, 55.2, 57.4].forEach((t, i) => {
    note(t, 0.55, midi(22 - i * 2), { type: 'sin', gain: 0.42, a: 0.002, d: 0.22, s: 0.3, r: 0.35 });
    noiseHit(t, 0.30, 0.16, { hp: 0.5, a: 0.001, d: 0.10 });
    note(t + 0.02, 0.35, midi(88), { type: 'sqr', gain: 0.02, a: 0.001, d: 0.15, s: 0.05, r: 0.15 });
  });

  // 借贷场景：算盘/计算器的细密点击
  for (let t = 58.5; t < 71; t += 0.31) {
    noiseHit(t, 0.035, 0.055, { hp: 0.75 });
  }

  // AI 场景：电子提示音
  [74.5, 76.2, 78.0].forEach((t, i) => {
    note(t, 0.18, midi(84 + i * 4), { type: 'tri', gain: 0.10, a: 0.005, d: 0.06, s: 0.2, r: 0.08, pan: 0.3 });
  });

  // 洞察场景：明亮的上行琶音
  [93.6, 94.1, 94.6, 95.1].forEach((t, i) => {
    note(t, 0.42, midi(69 + i * 4), { type: 'tri', gain: 0.12, a: 0.005, d: 0.12, s: 0.3, r: 0.25, pan: (i - 1.5) * 0.3 });
  });

  // 结尾：长音收束
  note(112, 9.0, midi(45), { type: 'sin', gain: 0.20, a: 1.2, d: 1.0, s: 0.6, r: 4.0 });
  note(112, 9.0, midi(52), { type: 'tri', gain: 0.13, a: 1.4, d: 1.0, s: 0.55, r: 4.0 });
  note(112, 9.0, midi(57), { type: 'tri', gain: 0.10, a: 1.6, d: 1.0, s: 0.5, r: 4.0 });
}

/* ================= 混响（立体声延迟网） ================= */
console.log('→ 混响与母带处理');
{
  const wet = new Float32Array(N), wetR = new Float32Array(N);
  const taps = [[0.029, 0.34], [0.041, 0.28], [0.057, 0.22], [0.073, 0.16]];
  for (const [dly, g] of taps) {
    const d = Math.floor(dly * SR);
    for (let i = d; i < N; i++) {
      wet[i] += bufL[i - d] * g;
      wetR[i] += bufR[i - d] * g;
    }
  }
  for (let i = 0; i < N; i++) {
    bufL[i] = bufL[i] * 0.86 + wet[i] * 0.30;
    bufR[i] = bufR[i] * 0.86 + wetR[i] * 0.30;
  }
}

/* 总音量归一 + 软削波 */
{
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(bufL[i]), Math.abs(bufR[i]));
  const target = 0.82;
  const g = peak > 0 ? target / peak : 1;
  for (let i = 0; i < N; i++) {
    bufL[i] = Math.tanh(bufL[i] * g * 1.1) * 0.95;
    bufR[i] = Math.tanh(bufR[i] * g * 1.1) * 0.95;
  }
  console.log(`   峰值归一：${peak.toFixed(3)} → ${target}`);
}

/* ================= 写 WAV ================= */
function writeWav(file, L, R) {
  const n = L.length;
  const dataBytes = n * 2 * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(2, 22);          // 立体声
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2 * 2, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = clamp(L[i], -1, 1), r = clamp(R[i], -1, 1);
    buf.writeInt16LE(Math.round(l * 32767), o); o += 2;
    buf.writeInt16LE(Math.round(r * 32767), o); o += 2;
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

const out = process.env.OUT || path.join(path.dirname(__dirname), 'dist', 'score.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
const bytes = writeWav(out, bufL, bufR);
console.log(`✓ 音轨已生成：${out}`);
console.log(`  ${(bytes / 1048576).toFixed(1)} MB / ${DUR}s / 44.1kHz 立体声`);
