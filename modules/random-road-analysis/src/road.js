/* ============================================================
 * road.js —— 随机路面 x(t) 的生成
 * 路面虽是随机的，但其“频率构成比例”大体不变（变中的不变）。
 * 采用 ISO 8601 路面空间功率谱密度，再按车速换算为时间频率谱，
 * 通过频域合成（随机相位）得到时域 x(t) 及其导数 ẋ(t)。
 * ============================================================ */
(function (global) {
  'use strict';

  /** ISO 8601 路面分级：n0 = 0.1 cycle/m 处的空间 PSD  G_d(n0)  [m³/cycle] */
  const ISO_CLASSES = {
    A: 16e-6, B: 64e-6, C: 256e-6, D: 1024e-6,
    E: 4096e-6, F: 16384e-6, G: 65536e-6, H: 262144e-6
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * 生成一条随机路面。
   * @param {object} o {N, fs, speed(m/s), Gd0, w, seed, fmin, fmax}
   */
  function generate(o) {
    const N = o.N, fs = o.fs, dt = 1 / fs;
    const T = N / fs, df = 1 / T;
    const v = o.speed, n0 = 0.1, wExp = o.w, Gd0 = o.Gd0;
    const fmin = o.fmin == null ? 0.1 : o.fmin;
    const fmax = o.fmax == null ? 25 : o.fmax;

    // 1) 单边目标 PSD（时间频率）
    const f = new Float64Array(N / 2 + 1);
    const Sx = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) {
      const fk = k * df;
      f[k] = fk;
      if (fk <= 0 || fk < fmin || fk > fmax) { Sx[k] = 0; continue; }
      const n = fk / v;                       // 时间频率 → 空间频率
      const Gd = Gd0 * Math.pow(n / n0, -wExp); // 空间 PSD
      Sx[k] = Gd / v;                          // 时间 PSD  S(f) = G_d(n)/v
    }

    // 2) 频域合成：给每个频率函数随机相位
    const rng = mulberry32(o.seed >>> 0);
    const re = new Float64Array(N), im = new Float64Array(N);
    const dre = new Float64Array(N), dim = new Float64Array(N);
    for (let k = 1; k < N / 2; k++) {
      const S = Sx[k];
      if (S <= 0) continue;
      const a = Math.sqrt(2 * S * df);          // 该频率分量的幅值
      const ph = rng() * 2 * Math.PI;
      const mag = N * a / 2;                     // IDFT 需乘 N
      const cr = mag * Math.cos(ph), ci = mag * Math.sin(ph);
      re[k] = cr; im[k] = ci;
      re[N - k] = cr; im[N - k] = -ci;           // 共轭对称，保证实信号
      // 导数谱 Ẋ = jω·X（负频率分量取共轭，保证实信号）
      const wv = 2 * Math.PI * k * df;
      dre[k] = -wv * im[k]; dim[k] = wv * re[k];
      dre[N - k] = dre[k]; dim[N - k] = -dim[k];
    }

    global.FFT.ifft(re, im);
    global.FFT.ifft(dre, dim);

    const x = re, xdot = dre;
    const t = new Float64Array(N);
    for (let i = 0; i < N; i++) t[i] = i * dt;

    return {
      N: N, fs: fs, dt: dt, T: T, df: df, t: t,
      x: x, xdot: xdot, f: f, Sx: Sx,
      speed: v, Gd0: Gd0, w: wExp, seed: o.seed
    };
  }

  global.Road = { ISO_CLASSES: ISO_CLASSES, generate: generate, mulberry32: mulberry32 };
})(window);
