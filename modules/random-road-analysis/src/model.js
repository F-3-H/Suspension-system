/* ============================================================
 * model.js —— 悬挂系统内因模型 + 相空间 + 优化
 * 1 自由度弹簧-质量-阻尼系统（对应《内因篇》）：
 *     m·ÿ + c·(ẏ-ẋ) + k·(y-x) = 0
 *     ⇒ m·ÿ + c·ẏ + k·y = c·ẋ + k·x
 * 传递函数： H_d(s) = Y(s)/X(s) = (c·s + k) / (m·s² + c·s + k)
 * 内因即 m, c, k；由此得固有频率 f_n、阻尼比 ζ 与频率响应 |H(f)|。
 * ============================================================ */
(function (global) {
  'use strict';

  const TAU = 2 * Math.PI;

  function naturalFreq(m, k) { return Math.sqrt(k / m) / TAU; }
  function dampingRatio(m, c, k) { return c / (2 * Math.sqrt(k * m)); }

  /** 位移传递函数的复数响应 H_d(f) */
  function Hd(f, m, c, k) {
    const w = TAU * f;
    const numR = k, numI = c * w;         // c·s + k
    const denR = k - m * w * w, denI = c * w; // m·s² + c·s + k
    const den = denR * denR + denI * denI || 1e-30;
    const re = (numR * denR + numI * denI) / den;
    const im = (numI * denR - numR * denI) / den;
    return { re: re, im: im, mag: Math.hypot(re, im) };
  }

  /** 位移传递函数幅值 |H_d(f)| —— 位移放大倍数 */
  function magD(f, m, c, k) { return Hd(f, m, c, k).mag; }

  /** 加速度传递函数幅值 |H_a(f)| = ω²·|H_d(f)| —— 舒适性所看的量 */
  function magA(f, m, c, k) {
    const w = TAU * f;
    return w * w * magD(f, m, c, k);
  }

  /** 位移相位（弧度） */
  function phaseD(f, m, c, k) {
    const h = Hd(f, m, c, k);
    return Math.atan2(h.im, h.re);
  }

  /** 在 [fmin,fmax] 上对谱积分得方差（梯形法） */
  function bandVariance(f, S, fmin, fmax) {
    let s = 0;
    for (let i = 1; i < f.length; i++) {
      const f0 = f[i - 1], f1 = f[i];
      if (f1 < fmin || f0 > fmax) continue;
      const a = Math.max(f0, fmin), b = Math.min(f1, fmax);
      if (b <= a) continue;
      const t = (b - a) / (f1 - f0);
      const s0 = S[i - 1] + (S[i] - S[i - 1]) * ((a - f0) / (f1 - f0 || 1));
      const s1 = S[i - 1] + (S[i] - S[i - 1]) * ((b - f0) / (f1 - f0 || 1));
      s += 0.5 * (s0 + s1) * (b - a);
    }
    return s;
  }

  function rms(f, S, fmin, fmax) {
    return Math.sqrt(Math.max(0, bandVariance(f, S, fmin, fmax)));
  }

  /**
   * 单次遍历同时积分位移与加速度方差（供 optimize 使用）。
   * 避免为同一 (c,k) 调用两次 outputPSD、重复计算 H_d。
   */
  function rmsDispAcc(f, Sx, m, c, k, fmin, fmax) {
    let vs = 0, va = 0;
    let ph = Hd(f[0], m, c, k).mag, pd = ph * ph * Sx[0];
    for (let i = 1; i < f.length; i++) {
      const f0 = f[i - 1], f1 = f[i];
      if (f0 > fmax) break;
      const ch = Hd(f1, m, c, k).mag;
      const cd = ch * ch * Sx[i];
      const a = Math.max(f0, fmin), b = Math.min(f1, fmax);
      if (b > a) {
        const dfi = f1 - f0 || 1;
        const t0 = (a - f0) / dfi, t1 = (b - f0) / dfi;
        const da = pd + (cd - pd) * t0, db = pd + (cd - pd) * t1;
        vs += 0.5 * (da + db) * (b - a);          // 位移方差 ∫|H|²Sx df
        const w0 = TAU * f0, w1 = TAU * f1;
        const A0 = w0 * w0 * w0 * w0 * pd, A1 = w1 * w1 * w1 * w1 * cd;
        const Aa = A0 + (A1 - A0) * t0, Ab = A0 + (A1 - A0) * t1;
        va += 0.5 * (Aa + Ab) * (b - a);          // 加速度方差 ∫ω⁴|H|²Sx df
      }
      ph = ch; pd = cd;
    }
    return { sy: Math.sqrt(Math.max(0, vs)), sa: Math.sqrt(Math.max(0, va)) };
  }

  /**
   * 给定输入谱 Sx，计算输出谱。kind: 'disp' | 'acc'
   */
  function outputPSD(f, Sx, m, c, k, kind) {
    const out = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const fk = f[i];
      if (Sx[i] <= 0 || fk <= 0) { out[i] = 0; continue; }
      const h = Hd(fk, m, c, k).mag;
      const gain = kind === 'acc' ? Math.pow(TAU * fk, 4) : 1;
      out[i] = gain * h * h * Sx[i];
    }
    return out;
  }

  /** 按频段统计比例（占比图） */
  function bandAggregate(f, S, edges) {
    const n = edges.length - 1;
    const vals = new Float64Array(n);
    let total = 0;
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (let i = 1; i < f.length; i++) {
        const f0 = f[i - 1], f1 = f[i];
        if (f1 <= edges[b] || f0 >= edges[b + 1]) continue;
        const a = Math.max(f0, edges[b]), bb = Math.min(f1, edges[b + 1]);
        if (bb <= a) continue;
        const s0 = S[i - 1] + (S[i] - S[i - 1]) * ((a - f0) / (f1 - f0 || 1));
        const s1 = S[i - 1] + (S[i] - S[i - 1]) * ((bb - f0) / (f1 - f0 || 1));
        s += 0.5 * (s0 + s1) * (bb - a);
      }
      vals[b] = s; total += s;
    }
    const share = new Float64Array(n);
    for (let b = 0; b < n; b++) share[b] = total > 0 ? vals[b] / total : 0;
    return { edges: edges, variance: vals, share: share, total: total };
  }

  /**
   * 频域精确轨迹：从初值 (y0, v0) 出发的 y(t) 与 ẏ(t)。
   * 稳态解由频域直接得出（Y = H_d·X），再叠加齐次衰减项以满足初值，
   * 无需求解微分方程，数值精确。用于相空间概率云与 y(t) 曲线。
   */
  function trajectory(road, m, c, k, y0, v0, seed) {
    const N = road.N, df = road.df, Sx = road.Sx, dt = road.dt;
    const rng = global.Road.mulberry32(((seed === undefined ? road.seed : seed) >>> 0) || 1);
    const reX = new Float64Array(N), imX = new Float64Array(N);
    for (let kk = 1; kk < N / 2; kk++) {
      const S = Sx[kk];
      if (S <= 0) continue;
      const amp = Math.sqrt(2 * S * df);
      const ph = rng() * TAU;
      const mag = N * amp / 2;
      const cr = mag * Math.cos(ph), ci = mag * Math.sin(ph);
      reX[kk] = cr; imX[kk] = ci;
      reX[N - kk] = cr; imX[N - kk] = -ci;
    }
    const reY = new Float64Array(N), imY = new Float64Array(N);
    const reV = new Float64Array(N), imV = new Float64Array(N);
    for (let kk = 1; kk < N / 2; kk++) {
      const fk = kk * df;
      const h = Hd(fk, m, c, k);         // Y/X
      const yr = h.re * reX[kk] - h.im * imX[kk];
      const yi = h.re * imX[kk] + h.im * reX[kk];
      reY[kk] = yr; imY[kk] = yi;
      reY[N - kk] = yr; imY[N - kk] = -yi;
      const w = TAU * fk;                // V = jω·Y（负频率分量取共轭）
      reV[kk] = -w * yi; imV[kk] = w * yr;
      reV[N - kk] = reV[kk]; imV[N - kk] = -imV[kk];
    }
    global.FFT.ifft(reY, imY);
    global.FFT.ifft(reV, imV);

    // 齐次项：叠加初始条件带来的暂态
    const wn = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
    const dy = (y0 || 0) - reY[0], dv = (v0 || 0) - reV[0];
    let mode, A, B, wd = 0, r1 = 0, r2 = 0;
    if (z < 1 - 1e-9) { wd = wn * Math.sqrt(1 - z * z); A = dy; B = (dv + z * wn * dy) / wd; mode = 0; }
    else if (z > 1 + 1e-9) { const s = wn * Math.sqrt(z * z - 1); r1 = -z * wn + s; r2 = -z * wn - s; A = (dv - r2 * dy) / (r1 - r2); B = dy - A; mode = 1; }
    else { A = dy; B = dv + wn * dy; mode = 2; }
    for (let i = 0; i < N; i++) {
      const t = i * dt; let h, dh;
      if (mode === 0) {
        const e = Math.exp(-z * wn * t), cw = Math.cos(wd * t), sw = Math.sin(wd * t);
        h = e * (A * cw + B * sw);
        dh = e * ((-z * wn * A + B * wd) * cw + (-z * wn * B - A * wd) * sw);
      } else if (mode === 1) {
        const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
        h = A * e1 + B * e2; dh = A * r1 * e1 + B * r2 * e2;
      } else {
        const e = Math.exp(-wn * t);
        h = (A + B * t) * e; dh = (B - wn * (A + B * t)) * e;
      }
      reY[i] += h; reV[i] += dh;
    }
    return { y: reY, v: reV };
  }

  /** 2D 直方图（相空间概率云） */
  function density2D(xs, ys, xmin, xmax, ymin, ymax, nx, ny) {
    const bins = new Float64Array(nx * ny);
    let max = 0, n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      let ix = Math.floor((xs[i] - xmin) / (xmax - xmin) * nx);
      let iy = Math.floor((ys[i] - ymin) / (ymax - ymin) * ny);
      if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) continue;
      const idx = iy * nx + ix;
      bins[idx]++;
      if (bins[idx] > max) max = bins[idx];
    }
    return { bins: bins, nx: nx, ny: ny, max: max };
  }

  /**
   * 内因优化：固定路面与质量 m，搜索 (c, k)，
   * 在行程约束下最小化车身 RMS 加速度（舒适性）。
   */
  function optimize(road, m, travelLimit, opts) {
    opts = opts || {};
    const f = road.f, Sx = road.Sx, fmin = opts.fmin || 0.1, fmax = opts.fmax || 25;
    const kLo = opts.kLo || 8000, kHi = opts.kHi || 60000;
    const cLo = opts.cLo || 200, cHi = opts.cHi || 6000;
    let best = null, bestAny = null;
    const Nk = 30, Nc = 30;
    for (let ik = 0; ik <= Nk; ik++) {
      const k = kLo * Math.pow(kHi / kLo, ik / Nk);
      for (let ic = 0; ic <= Nc; ic++) {
        const c = cLo * Math.pow(cHi / cLo, ic / Nc);
        const r = rmsDispAcc(f, Sx, m, c, k, fmin, fmax);
        const cand = { c: c, k: k, sigmaY: r.sy, sigmaA: r.sa };
        if (!bestAny || r.sa < bestAny.sigmaA) bestAny = cand;
        if (r.sy <= travelLimit && (!best || r.sa < best.sigmaA)) best = cand;
      }
    }
    return best || bestAny;
  }

  /**
   * 车速扫描（解析式）：同一路面的空间谱 G_d(n) 不随车速改变，
   * 时间谱 S_x(f;v) = G_d(f/v)/v ∝ v^(w-1)，输出谱与方差随之按比例缩放，
   * 故 RMS 加速度 = 基准值 × r^((w-1)/2)，无需重新生成路面、无需 IFFT。
   */
  function speedSweep(road, m, c, k, ratios, opts) {
    opts = opts || {};
    const fmin = opts.fmin || 0.1, fmax = opts.fmax || 25;
    const base = rms(road.f, outputPSD(road.f, road.Sx, m, c, k, 'acc'), fmin, fmax);
    const out = [];
    for (const r of ratios) {
      out.push({ ratio: r, speed: road.speed * r, sigmaA: base * Math.pow(r, (road.w - 1) / 2) });
    }
    return out;
  }

  global.Susp = {
    naturalFreq: naturalFreq,
    dampingRatio: dampingRatio,
    Hd: Hd,
    magD: magD,
    magA: magA,
    phaseD: phaseD,
    bandVariance: bandVariance,
    rms: rms,
    outputPSD: outputPSD,
    bandAggregate: bandAggregate,
    trajectory: trajectory,
    density2D: density2D,
    optimize: optimize,
    speedSweep: speedSweep
  };
})(window);
