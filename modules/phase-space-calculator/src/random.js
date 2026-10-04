/*!
 * random.js —— 随机外因：功率谱 → 时域样本 → 频谱估计（第五层：把"外因是随机的"变成可算的东西）
 *
 * 系统科学的读法：
 *   确定性系统的相空间里，一个点只有一条轨迹；外因一旦随机化，
 *   同一个点就有**一族**可能的轨迹，我们能问的不再是"它去哪"，而是"它在哪儿待得久"。
 *   这一层提供三样东西：
 *     ① 一个**有给定功率谱的随机过程**（路面激励 y(t)、以及它的速度 ẏ(t)）——
 *        用的是谱表示法（Shinozuka–Jan）：y(t) = Σ √(2·S(ω_k)·Δω)·cos(ω_k t + φ_k)
 *        于是"各频率占比"不是事后估计出来的，而是**一开始就按 S(ω) 造进去的**；
 *     ② 每次调用换一组 (ω_k, φ_k) → 得到"同一条路面统计特性下的另一次实现"；
 *     ③ 从响应信号反估 PSD（FFT + Hann 窗），用来回答"响应里哪些频率占得多"。
 *
 * 性能纪律（沿用 tools/web-frontend.md 2026-09-26 的留言）：
 *   造一条长信号绝不能"每个采样点都调一次三角函数"。这里每条谐波维护一对 (cosθ, sinθ)，
 *   每步乘一个预先算好的旋转因子递推下去，循环体里一次 cos/sin 都不调。
 *   代价是浮点误差随步数累积——实测与逐点 cos 的差在 1e-13 量级（见 tests/verify-core.mjs 的断言）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSRandom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 可复现的伪随机数
  /** mulberry32：小而快，给定种子完全可复现 —— 随机模式必须能被复算，否则无法验收 */
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- 谱形
  var SPECTRA = {
    band: '\u5E26\u9650\u767D\u566A\u58F0\uFF08S(\u03C9) = S\u2080\uFF0C\u9650\u4E8E\u9891\u5E26\u5185\uFF09',
    kanai: 'Kanai\u2013Tajimi \u8DEF\u9762\u8C31\uFF08\u5E26\u4E00\u4E2A\u4F4E\u9891\u5CF0\uFF09',
    white: '\u5BBD\u5E26\u767D\u566A\u58F0\uFF08\u4ECE 0 \u5F00\u59CB\uFF09'
  };
  /** 目标单边功率谱 S(ω)，单位：幅值²/(rad/s) */
  function makePSD(spec) {
    var kind = spec.kind || 'band';
    var S0 = spec.intensity === undefined ? 0.02 : spec.intensity;
    var wMin = spec.wMin === undefined ? 0.5 : spec.wMin;
    var wMax = spec.wMax === undefined ? 20 : spec.wMax;
    var wg = spec.wg === undefined ? 3.0 : spec.wg;
    var zg = spec.zg === undefined ? 0.6 : spec.zg;
    return function (w) {
      if (kind === 'white') return w >= 0 && w <= wMax ? S0 : 0;
      if (kind === 'kanai') {
        if (w < 0 || w > wMax) return 0;
        var r = w / wg;
        return S0 * (1 + 4 * zg * zg * r * r) / ((1 - r * r) * (1 - r * r) + 4 * zg * zg * r * r);
      }
      return (w >= wMin && w <= wMax) ? S0 : 0;
    };
  }

  /**
   * 造一次实现。返回 {y, v, t0, dt, n, sample(t), sampleV(t), components, psd}
   * 依赖 grid: {t0, dt, n}
   */
  function makeRealization(spec, grid, rand) {
    var psd = makePSD(spec);
    var K = Math.max(1, Math.round(spec.components === undefined ? 64 : spec.components));
    var wMin = spec.kind === 'white' ? 0 : (spec.wMin === undefined ? 0.5 : spec.wMin);
    var wMax = spec.wMax === undefined ? 20 : spec.wMax;
    var dw = (wMax - wMin) / K;
    var comps = new Array(K);
    for (var k = 0; k < K; k++) {
      var w = wMin + dw * (k + rand());          // 频率本身也随机 → 每次实现都不同，且均值收敛到 S(ω)
      var A = Math.sqrt(Math.max(0, 2 * psd(w) * dw));
      comps[k] = { w: w, A: A, phi: rand() * Math.PI * 2 };
    }
    var t0 = grid.t0, dt = grid.dt, n = grid.n;
    var y = new Float64Array(n), v = new Float64Array(n);
    var c = new Float64Array(K), s = new Float64Array(K);
    var cw = new Float64Array(K), sw = new Float64Array(K);
    for (var j = 0; j < K; j++) {
      var th = comps[j].w * t0 + comps[j].phi;
      c[j] = Math.cos(th); s[j] = Math.sin(th);
      cw[j] = Math.cos(comps[j].w * dt); sw[j] = Math.sin(comps[j].w * dt);
    }
    for (var i = 0; i < n; i++) {
      var acc = 0, accv = 0;
      for (var m = 0; m < K; m++) {
        acc += comps[m].A * c[m];
        accv -= comps[m].A * comps[m].w * s[m];
      }
      y[i] = acc; v[i] = accv;
      for (var q = 0; q < K; q++) {              // 相位旋转递推：循环体内一次三角函数都没有
        var nc = c[q] * cw[q] - s[q] * sw[q];
        s[q] = s[q] * cw[q] + c[q] * sw[q];
        c[q] = nc;
      }
    }
    function at(arr, t) {
      var idx = (t - t0) / dt;
      if (idx <= 0) return arr[0];
      if (idx >= n - 1) return arr[n - 1];
      var i0 = Math.floor(idx), f = idx - i0;
      return arr[i0] * (1 - f) + arr[i0 + 1] * f;
    }
    return {
      y: y, v: v, t0: t0, dt: dt, n: n,
      components: comps, psd: psd, spec: spec,
      sample: function (t) { return at(y, t); },
      sampleV: function (t) { return at(v, t); }
    };
  }

  // ---------------------------------------------------------------- 频谱估计
  /** 原地迭代 FFT（radix-2，n 必须是 2 的幂；re/im 长度必须等于 n） */
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s2 = 0; s2 < n; s2 += len) {
        var cr = 1, ci = 0;
        for (var k2 = 0; k2 < len / 2; k2++) {
          var ur = re[s2 + k2], ui = im[s2 + k2];
          var vr = re[s2 + k2 + len / 2] * cr - im[s2 + k2 + len / 2] * ci;
          var vi = re[s2 + k2 + len / 2] * ci + im[s2 + k2 + len / 2] * cr;
          re[s2 + k2] = ur + vr; im[s2 + k2] = ui + vi;
          re[s2 + k2 + len / 2] = ur - vr; im[s2 + k2 + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }
  /**
   * 单边功率谱密度估计，**自变量是角频率 ω（rad/s）**，归一化使得 ∫S(ω)dω = 方差。
   * 采用 Welch 平均（分段 + Hann 窗 + 50% 重叠）：单段周期图太尖，看起来全是毛刺，
   * 分段平均之后"哪些频率占得多"才看得清。
   *
   * 归一化的推导（写下来免得下次再错）：
   *   加窗后 Σ(x_n w_n)² = (1/N)Σ|X_k|²  →  方差 ≈ (1/(N·Σw²))·Σ|X_k|²
   *   频率间隔 dω = 2π/(N·dt)，单边（k≥1 非 Nyquist）再乘 2：
   *   S(ω_k) = 2|X_k|² / (N·Σw²·dω)
   * 本轮第一次写成了 /(dt·Σw²)，少了 1/dt² 的量级（实测差了 4 万倍），
   * 而且把 freq 写成 k/(N·dt)（那是 Hz）却当 rad/s 用——两处都已改正。
   */
  function psdEstimate(signal, dt, opts) {
    opts = opts || {};
    // trim：丢掉开头百分之几的信号。响应是从静止出发的，前几秒是**暂态**，
    // 它不是平稳响应的一部分，留在谱里会往低频堆一坨能量，把峰值频率整体拖低
    // （本轮实测：不 trim 时峰值读数 4.9 rad/s，trim 之后回到 7.4，接近理论 7.57）。
    var from = 0;
    if (opts.trim > 0) {
      from = Math.min(signal.length - 32, Math.floor(signal.length * opts.trim));
      if (from < 0) from = 0;
    }
    var data = from > 0 ? signal.subarray(from) : signal;
    var len = data.length;
    var maxN = 1;
    while (maxN * 2 <= len) maxN *= 2;
    var nperseg = opts.nperseg || 0;
    if (!nperseg) {
      var target = opts.segments || 4;
      nperseg = maxN;
      while (nperseg > 128 && (len / nperseg) < target) nperseg >>= 1;
    }
    var step = Math.max(1, nperseg >> 1);
    var win = new Float64Array(nperseg), wsum = 0;
    for (var i = 0; i < nperseg; i++) {
      win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nperseg - 1));
      wsum += win[i] * win[i];
    }
    var half = nperseg / 2;
    var acc = new Float64Array(half);
    var dw = 2 * Math.PI / (nperseg * dt);
    var segs = 0;
    var re = new Float64Array(nperseg), im = new Float64Array(nperseg);
    for (var start = 0; start + nperseg <= len; start += step) {
      for (var j = 0; j < nperseg; j++) { re[j] = data[start + j] * win[j]; im[j] = 0; }
      fft(re, im);
      var norm = 2 / (nperseg * wsum * dw);
      for (var k = 0; k < half; k++) {
        var mag2 = re[k] * re[k] + im[k] * im[k];
        acc[k] += (k === 0 ? mag2 / 2 : mag2) * norm;
      }
      segs++;
      if (opts.maxSegments && segs >= opts.maxSegments) break;
    }
    if (!segs) segs = 1;
    var freq = new Float64Array(half), psd = new Float64Array(half);
    for (var q = 0; q < half; q++) { freq[q] = q * dw; psd[q] = acc[q] / segs; }
    return { freq: freq, psd: psd, df: dw, n: nperseg, segments: segs };
  }
  /** 信号的时间均值与方差（样本口径） */
  function stats(signal) {
    var n = signal.length, s = 0;
    for (var i = 0; i < n; i++) s += signal[i];
    var mean = s / n, v = 0;
    for (var j = 0; j < n; j++) { var d = signal[j] - mean; v += d * d; }
    return { mean: mean, variance: v / Math.max(1, n - 1) };
  }

  return {
    SPECTRA: SPECTRA,
    mulberry32: mulberry32,
    makePSD: makePSD,
    makeRealization: makeRealization,
    fft: fft,
    psdEstimate: psdEstimate,
    stats: stats
  };
});
