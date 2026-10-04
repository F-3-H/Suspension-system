/*!
 * core.js —— 相空间核心（第二层：数学内核，与界面、渲染完全解耦）
 *
 * 系统科学视角下的核心概念，全部落在这个文件里：
 *   · 状态 = 相空间中的一个点 x ∈ Rⁿ
 *   · 属性的个数 n = 相空间的维度（1/2/3 维相空间）
 *   · 微分方程 ẋ = f(x, t) 就是相空间上的向量场：每个点都挂着一支"往哪儿变"的箭头
 *   · 相流 φᵗ = 一族轨迹；正向积分 = 推演，反向积分 = 回溯
 *   · 不动点（f=0）、极限环、散度 ∇·f（相体积变化率）、雅可比谱、最大李雅普诺夫指数
 *     —— 这些是"系统的结构"，不是"某一条轨迹的样子"
 *
 * 全部函数都是纯函数式、不依赖 DOM，因此可以在 Node 里被机械断言（tests/verify-core.mjs）。
 * 数值方法：RK4 / Euler / Heun；Newton + 数值雅可比求不动点；Cardano 解三次特征方程。
 */
(function (root, factory) {
  var api = factory(typeof module !== 'undefined' && module.exports ? require('./expr.js') : root.PSExpr);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSPhase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PSExpr) {
  'use strict';
  void PSExpr;

  // ---------------------------------------------------------------- 线性代数小工具
  function vecNorm(v, n) {
    var s = 0;
    for (var i = 0; i < (n || v.length); i++) s += v[i] * v[i];
    return Math.sqrt(s);
  }
  function vecDist(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }
  /** 高斯-约当消元解 A·x = b，A 为 n×n 行主序（原地破坏 A、b） */
  function linSolve(A, b, n) {
    for (var col = 0; col < n; col++) {
      var piv = col, best = Math.abs(A[col * n + col]);
      for (var r = col + 1; r < n; r++) {
        var v = Math.abs(A[r * n + col]);
        if (v > best) { best = v; piv = r; }
      }
      if (best < 1e-14) return null;
      if (piv !== col) {
        for (var c = 0; c < n; c++) { var tmp = A[col * n + c]; A[col * n + c] = A[piv * n + c]; A[piv * n + c] = tmp; }
        var tb = b[col]; b[col] = b[piv]; b[piv] = tb;
      }
      var d = A[col * n + col];
      for (var r2 = col + 1; r2 < n; r2++) {
        var factor = A[r2 * n + col] / d;
        if (factor === 0) continue;
        for (var c2 = col; c2 < n; c2++) A[r2 * n + c2] -= factor * A[col * n + c2];
        b[r2] -= factor * b[col];
      }
    }
    var x = new Float64Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (var j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
      x[i] = s / A[i * n + i];
    }
    return x;
  }

  // ---------------------------------------------------------------- 积分器
  var _tmpA = null, _tmpB = null, _tmpC = null, _tmpD = null;
  function ensureTmp(dim) {
    if (!_tmpA || _tmpA.length < dim) {
      _tmpA = new Float64Array(dim); _tmpB = new Float64Array(dim);
      _tmpC = new Float64Array(dim); _tmpD = new Float64Array(dim);
    }
  }
  function copyTo(src, dst, dim) { for (var i = 0; i < dim; i++) dst[i] = src[i]; }

  function eulerStep(system, x, t, dt, out) {
    var dim = system.dim;
    ensureTmp(dim);
    var k1 = _tmpA;
    system.f(x, t, k1);
    for (var i = 0; i < dim; i++) out[i] = x[i] + dt * k1[i];
    return out;
  }
  function heunStep(system, x, t, dt, out) {
    var dim = system.dim;
    ensureTmp(dim);
    var k1 = _tmpA, k2 = _tmpB, tmp = _tmpC;
    system.f(x, t, k1);
    for (var i = 0; i < dim; i++) tmp[i] = x[i] + dt * k1[i];
    system.f(tmp, t + dt, k2);
    for (var j = 0; j < dim; j++) out[j] = x[j] + dt * 0.5 * (k1[j] + k2[j]);
    return out;
  }
  function rk4Step(system, x, t, dt, out) {
    var dim = system.dim;
    ensureTmp(dim);
    var k1 = _tmpA, k2 = _tmpB, k3 = _tmpC, k4 = _tmpD;
    var tmp = new Float64Array(dim);
    system.f(x, t, k1);
    for (var i = 0; i < dim; i++) tmp[i] = x[i] + 0.5 * dt * k1[i];
    system.f(tmp, t + 0.5 * dt, k2);
    for (var j = 0; j < dim; j++) tmp[j] = x[j] + 0.5 * dt * k2[j];
    system.f(tmp, t + 0.5 * dt, k3);
    for (var k = 0; k < dim; k++) tmp[k] = x[k] + dt * k3[k];
    system.f(tmp, t + dt, k4);
    for (var m = 0; m < dim; m++) out[m] = x[m] + (dt / 6) * (k1[m] + 2 * k2[m] + 2 * k3[m] + k4[m]);
    return out;
  }
  function stepWith(method, system, x, t, dt, out) {
    if (method === 'euler') return eulerStep(system, x, t, dt, out);
    if (method === 'heun') return heunStep(system, x, t, dt, out);
    return rk4Step(system, x, t, dt, out);
  }

  /**
   * 从 x0 积分 steps 步（dt 可正可负：负即回溯），返回等间隔采样轨迹。
   * 返回 {dim, n, t: Float64Array(n), x: Float64Array(n*dim)}，x 行主序。
   */
  function integrate(system, x0, t0, dt, steps, method, opts) {
    var dim = system.dim;
    var total = Math.max(1, Math.floor(steps)) + 1;
    var ts = new Float64Array(total);
    var xs = new Float64Array(total * dim);
    var cur = new Float64Array(dim);
    copyTo(x0, cur, dim);
    var next = new Float64Array(dim);
    for (var i = 0; i < dim; i++) xs[i] = cur[i];
    ts[0] = t0;
    var t = t0;
    var n = 1, stopped = false, stopT = t0, stopReason = '';
    var box = opts && opts.stopBox;
    for (var s = 1; s < total; s++) {
      stepWith(method, system, cur, t, dt, next);
      for (var d = 0; d < dim; d++) {
        if (!isFinite(next[d])) next[d] = cur[d]; // 发散保护：停在有限值上，不产生 NaN 画崩
      }
      copyTo(next, cur, dim);
      t = t0 + s * dt;
      // 截断判据：越出给定的盒子（通常是比视窗大得多的一个范围），或状态已经炸到无意义
      var out = false, huge = 0;
      for (var b = 0; b < dim; b++) {
        if (box && (cur[b] < box[b][0] || cur[b] > box[b][1])) out = true;
        huge = Math.max(huge, Math.abs(cur[b]));
      }
      if (out || huge > 1e12) {
        stopped = true; stopT = t;
        stopReason = out ? '\u8D8A\u51FA\u89C6\u7A97\u8303\u56F4' : '\u72B6\u6001\u53D1\u6563';
        break;
      }
      ts[n] = t;
      for (var e = 0; e < dim; e++) xs[n * dim + e] = cur[e];
      n++;
    }
    return {
      dim: dim, n: n, t: ts, x: xs, dt: dt, t0: t0, method: method || 'rk4',
      stopped: stopped, stopT: stopT, stopReason: stopReason
    };
  }

  /**
   * 在给定时刻取轨迹上的状态。
   * 传入 system 时用三次 Hermite 插值（端点导数由向量场给出），误差 ~ dt⁴；
   * 不传则退化为线性插值，误差 ~ dt² —— 播放动画时肉眼可见的"卡顿式"不连续就是它造成的。
   */
  function stateAt(traj, tq, out, system) {
    var dim = traj.dim;
    out = out || new Float64Array(dim);
    var dt = traj.dt;
    var idx = (tq - traj.t0) / dt;
    if (idx <= 0) { for (var i = 0; i < dim; i++) out[i] = traj.x[i]; return out; }
    if (idx >= traj.n - 1) {
      var last = (traj.n - 1) * dim;
      for (var j = 0; j < dim; j++) out[j] = traj.x[last + j];
      return out;
    }
    var i0 = Math.floor(idx), frac = idx - i0;
    if (!system) {
      for (var k = 0; k < dim; k++) {
        out[k] = traj.x[i0 * dim + k] * (1 - frac) + traj.x[(i0 + 1) * dim + k] * frac;
      }
      return out;
    }
    ensureTmp(dim);
    var d0 = _tmpA, d1 = _tmpB;
    var t0 = traj.t0 + i0 * dt, t1 = t0 + dt;
    system.f(traj.x.subarray(i0 * dim, i0 * dim + dim), t0, d0);
    system.f(traj.x.subarray((i0 + 1) * dim, (i0 + 1) * dim + dim), t1, d1);
    var s = frac, s2 = s * s, s3 = s2 * s;
    var h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (var m = 0; m < dim; m++) {
      var x0 = traj.x[i0 * dim + m], x1 = traj.x[(i0 + 1) * dim + m];
      out[m] = h00 * x0 + h10 * dt * d0[m] + h01 * x1 + h11 * dt * d1[m];
    }
    return out;
  }

  // ---------------------------------------------------------------- 局部结构量
  /** 散度 ∇·f = Σ ∂fᵢ/∂xᵢ：相体积的瞬时相对变化率（>0 膨胀、<0 收缩、=0 保体积） */
  function divergence(system, x, t, h) {
    var dim = system.dim;
    var step = h || (1e-6 * Math.max(1, vecNorm(x)));
    var base = new Float64Array(dim);
    system.f(x, t || 0, base);
    var xp = new Float64Array(dim);
    var fp = new Float64Array(dim);
    var sum = 0;
    for (var i = 0; i < dim; i++) {
      copyTo(x, xp, dim);
      xp[i] += step;
      system.f(xp, t || 0, fp);
      sum += (fp[i] - base[i]) / step;
    }
    return sum;
  }

  /** 雅可比矩阵 J[i][j] = ∂fᵢ/∂xⱼ（中心差分），行主序 Float64Array(dim*dim) */
  function jacobian(system, x, t, h) {
    var dim = system.dim;
    var step = h || (1e-6 * Math.max(1, vecNorm(x)));
    var J = new Float64Array(dim * dim);
    var xp = new Float64Array(dim), xm = new Float64Array(dim);
    var fp = new Float64Array(dim), fm = new Float64Array(dim);
    for (var j = 0; j < dim; j++) {
      copyTo(x, xp, dim); xp[j] += step;
      copyTo(x, xm, dim); xm[j] -= step;
      system.f(xp, t || 0, fp);
      system.f(xm, t || 0, fm);
      for (var i = 0; i < dim; i++) J[i * dim + j] = (fp[i] - fm[i]) / (2 * step);
    }
    return J;
  }

  /** 2×2 特征值（解析解） */
  function eigen2(J) {
    var a = J[0], b = J[1], c = J[2], d = J[3];
    var tr = a + d, det = a * d - b * c;
    var disc = tr * tr - 4 * det;
    if (disc >= 0) {
      var r = Math.sqrt(disc);
      return [{ re: (tr + r) / 2, im: 0 }, { re: (tr - r) / 2, im: 0 }];
    }
    var im = Math.sqrt(-disc) / 2;
    return [{ re: tr / 2, im: im }, { re: tr / 2, im: -im }];
  }

  /** 2×2 平衡点分类（线性化类型）。判据用迹-行列式平面，是标准结论。 */
  function classify2(J) {
    var eig = eigen2(J);
    var tr = eig[0].re + eig[1].re;
    var det = eig[0].re * eig[1].re - eig[0].im * eig[1].im; // 复共轭时 = |λ|²
    var complex = Math.abs(eig[0].im) > 1e-10;
    var type, stable;
    if (Math.abs(det) < 1e-9) { type = '\u9000\u5316\uFF08\u975E\u53CC\u66F2\uFF09'; stable = false; }
    else if (det < 0) { type = '\u978D\u70B9'; stable = false; }
    else if (tr < -1e-9) { type = complex ? '\u7A33\u5B9A\u7126\u70B9' : '\u7A33\u5B9A\u8282\u70B9'; stable = true; }
    else if (tr > 1e-9) { type = complex ? '\u4E0D\u7A33\u5B9A\u7126\u70B9' : '\u4E0D\u7A33\u5B9A\u8282\u70B9'; stable = false; }
    else { type = '\u4E2D\u5FC3'; stable = null; }
    return { type: type, stable: stable, trace: tr, det: det, eigenvalues: eig, spiral: complex };
  }

  // --- 3×3 特征值：解 λ³ + a λ² + b λ + c = 0 ---
  function cubicRoots(a, b, c) {
    // 去项：λ = y - a/3 → y³ + p y + q = 0
    var p = b - a * a / 3;
    var q = 2 * a * a * a / 27 - a * b / 3 + c;
    var shift = -a / 3;
    var disc = (q / 2) * (q / 2) + (p / 3) * (p / 3) * (p / 3);
    var eps = 1e-12 * (1 + Math.abs(p) + Math.abs(q));
    if (disc > eps) {
      var sq = Math.sqrt(disc);
      var u = Math.cbrt(-q / 2 + sq);
      var v = Math.cbrt(-q / 2 - sq);
      var y1 = u + v;
      var re = -(u + v) / 2 + shift;
      var im = Math.abs((u - v) * Math.sqrt(3) / 2);
      return [{ re: y1 + shift, im: 0 }, { re: re, im: im }, { re: re, im: -im }];
    }
    if (disc < -eps) {
      // 三个不同实根（三角解法）
      var r = Math.sqrt(-p * p * p / 27);
      var phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
      var m = 2 * Math.sqrt(-p / 3);
      return [0, 1, 2].map(function (k) {
        return { re: m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift, im: 0 };
      });
    }
    // 重根
    var u2 = Math.cbrt(-q / 2);
    return [{ re: 2 * u2 + shift, im: 0 }, { re: -u2 + shift, im: 0 }, { re: -u2 + shift, im: 0 }];
  }
  function eigen3(J) {
    var tr = J[0] + J[4] + J[8];
    var m2 = J[0] * J[0] + J[1] * J[3] + J[2] * J[6]
      + J[3] * J[1] + J[4] * J[4] + J[5] * J[7]
      + J[6] * J[2] + J[7] * J[5] + J[8] * J[8];
    var det = J[0] * (J[4] * J[8] - J[5] * J[7])
      - J[1] * (J[3] * J[8] - J[5] * J[6])
      + J[2] * (J[3] * J[7] - J[4] * J[6]);
    var a = -tr, b = (tr * tr - m2) / 2, c = -det;
    return cubicRoots(a, b, c);
  }
  function classifyND(J, dim) {
    // 一维必须单独处理：1×1 雅可比只有一个元素，套 2×2/3×3 公式会读到 undefined → NaN → 被误判成"鞍点"
    // （本轮 verify-core 抓到过这个错误：逻辑斯谛的稳定点 x=K 曾被报成鞍点）
    if (dim === 1) {
      var l = J[0];
      var stable1 = Math.abs(l) < 1e-9 ? null : (l < 0);
      var type1 = stable1 === null ? '\u9000\u5316\uFF08\u975E\u53CC\u66F2\uFF09' : (l < 0 ? '\u7A33\u5B9A\u4E0D\u52A8\u70B9' : '\u4E0D\u7A33\u5B9A\u4E0D\u52A8\u70B9');
      return { type: type1, stable: stable1, eigenvalues: [{ re: l, im: 0 }], trace: l, det: l };
    }
    var eig = dim === 2 ? eigen2(J) : eigen3(J);
    var realParts = eig.map(function (e) { return e.re; });
    var maxRe = Math.max.apply(null, realParts);
    var minRe = Math.min.apply(null, realParts);
    var anyIm = eig.some(function (e) { return Math.abs(e.im) > 1e-9; });
    var type, stable;
    if (Math.abs(maxRe) < 1e-8) { type = '\u4E2D\u5FC3\u578B\uFF08\u8FB9\u754C\uFF09'; stable = null; }
    else if (maxRe < 0) { type = anyIm ? '\u7A33\u5B9A\uFF08\u6709\u65CB\u8F6C\u6210\u5206\uFF09' : '\u7A33\u5B9A\u8282\u70B9'; stable = true; }
    else if (minRe > 0) { type = anyIm ? '\u4E0D\u7A33\u5B9A\uFF08\u6709\u65CB\u8F6C\u6210\u5206\uFF09' : '\u4E0D\u7A33\u5B9A\u8282\u70B9'; stable = false; }
    else { type = '\u978D\u70B9'; stable = false; }
    return { type: type, stable: stable, eigenvalues: eig, trace: dim === 2 ? (J[0] + J[3]) : (J[0] + J[4] + J[8]) };
  }

  // ---------------------------------------------------------------- 不动点
  function newton(system, x0, t, maxIter, tol) {
    var dim = system.dim;
    var x = new Float64Array(x0);
    var fx = new Float64Array(dim);
    for (var k = 0; k < (maxIter || 40); k++) {
      system.f(x, t || 0, fx);
      var nrm = vecNorm(fx);
      if (nrm < (tol || 1e-10)) break;
      var J = jacobian(system, x, t);
      var A = new Float64Array(J);
      var b = new Float64Array(dim);
      for (var i = 0; i < dim; i++) b[i] = -fx[i];
      var d = linSolve(A, b, dim);
      if (!d) break;
      var stepScale = 1;
      var dn = vecNorm(d);
      if (dn > 1e6) break;
      for (var j = 0; j < dim; j++) x[j] += stepScale * d[j];
    }
    return x;
  }

  /**
   * 在给定框内找不动点：dim=1 用符号变号 + 二分（最稳）；dim≥2 用网格起点 + Newton 收敛后去重。
   * 返回 [{x, residual, classification, jacobian}]，按残差升序。
   */
  function solveEquilibria(system, bounds, opts) {
    opts = opts || {};
    var dim = system.dim;
    var tol = opts.tol || 1e-7;
    var found = [];
    var fx = new Float64Array(dim);
    var t = opts.t || 0;

    if (dim === 1) {
      var a = bounds[0][0], b = bounds[0][1];
      var n = opts.grid || 400;
      var prevX = a, prevF = system.f([a], t, fx)[0];
      for (var i = 1; i <= n; i++) {
        var x1 = a + (b - a) * i / n;
        var f1 = system.f([x1], t, fx)[0];
        if (isFinite(prevF) && isFinite(f1)) {
          if (prevF === 0) pushEq(prevX);
          else if (prevF * f1 < 0) {
            var lo = prevX, hi = x1, flo = prevF;
            for (var it = 0; it < 80; it++) {
              var mid = 0.5 * (lo + hi);
              var fm = system.f([mid], t, fx)[0];
              if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
            }
            pushEq(0.5 * (lo + hi));
          }
        }
        prevX = x1; prevF = f1;
      }
      // 数值噪声导致的极近重复去掉
    } else {
      var grid = opts.grid || (dim === 2 ? 26 : 13);
      var starts = [];
      (function build(prefix, axis) {
        if (axis === dim) { starts.push(prefix.slice()); return; }
        for (var k = 0; k < grid; k++) {
          var v = bounds[axis][0] + (bounds[axis][1] - bounds[axis][0]) * (grid === 1 ? 0.5 : k / (grid - 1));
          prefix.push(v); build(prefix, axis + 1); prefix.pop();
        }
      })([], 0);
      var scale = Math.max.apply(null, bounds.map(function (r) { return r[1] - r[0]; }));
      var dedupeTol = scale * 1e-3;
      for (var s = 0; s < starts.length; s++) {
        var x = newton(system, Float64Array.from(starts[s]), t, 30, 1e-9);
        var inside = true;
        for (var d2 = 0; d2 < dim; d2++) {
          if (x[d2] < bounds[d2][0] - scale * 0.02 || x[d2] > bounds[d2][1] + scale * 0.02) inside = false;
        }
        if (!inside) continue;
        system.f(x, t, fx);
        if (vecNorm(fx) > tol) continue;
        var dup = false;
        for (var q = 0; q < found.length; q++) if (vecDist(found[q].x, x) < dedupeTol) { dup = true; break; }
        if (dup) continue;
        found.push(finishEq(x));
      }
    }
    found.sort(function (p, q) { return p.residual - q.residual; });
    return found;

    function pushEq(xv) {
      var x = Float64Array.of(xv);
      system.f(x, t, fx);
      var dup = false;
      for (var q = 0; q < found.length; q++) if (Math.abs(found[q].x[0] - xv) < 1e-6) { dup = true; break; }
      if (!dup) found.push(finishEq(x));
    }
    function finishEq(x) {
      system.f(x, t, fx);
      var J = jacobian(system, x, t);
      return { x: x, residual: vecNorm(fx), jacobian: J, classification: classifyND(J, dim) };
    }
  }

  // ---------------------------------------------------------------- 相流 / 面积 / Lyapunov
  /** 多边形面积（Shoelace），点集为 [[x,y],…] 或 Float64Array 列表 */
  function polygonArea(pts2) {
    var n = pts2.length;
    if (n < 3) return 0;
    var s = 0;
    for (var i = 0; i < n; i++) {
      var p = pts2[i], q = pts2[(i + 1) % n];
      s += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(s) / 2;
  }

  /** 在矩形区域上采样：nx×ny 内部网格 + 边界多边形（用于看面积如何被相流搬运） */
  function sampleRegion(bounds, nx, ny, boundaryCount) {
    var pts = [];
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < ny; j++) {
        var u = nx === 1 ? 0.5 : i / (nx - 1);
        var v = ny === 1 ? 0.5 : j / (ny - 1);
        pts.push(Float64Array.of(
          bounds[0][0] + (bounds[0][1] - bounds[0][0]) * u,
          bounds[1][0] + (bounds[1][1] - bounds[1][0]) * v
        ));
      }
    }
    var m = boundaryCount || 96;
    var perim = 2 * ((bounds[0][1] - bounds[0][0]) + (bounds[1][1] - bounds[1][0]));
    for (var k = 0; k < m; k++) {
      var s = perim * k / m;
      var w = bounds[0][1] - bounds[0][0], h = bounds[1][1] - bounds[1][0];
      var x, y;
      if (s < w) { x = bounds[0][0] + s; y = bounds[1][0]; }
      else if (s < w + h) { x = bounds[0][1]; y = bounds[1][0] + (s - w); }
      else if (s < 2 * w + h) { x = bounds[0][1] - (s - w - h); y = bounds[1][1]; }
      else { x = bounds[0][0]; y = bounds[1][1] - (s - 2 * w - h); }
      pts.push(Float64Array.of(x, y));
    }
    return pts;
  }

  /** 相流：把所有点一起积分。返回 {dim, count, n, t, x}，x 行主序 [step][point][dim] */
  function integrateEnsemble(system, pts, t0, dt, steps, method) {
    var dim = system.dim;
    var count = pts.length;
    var n = Math.max(1, Math.floor(steps)) + 1;
    var xs = new Float64Array(n * count * dim);
    var ts = new Float64Array(n);
    var cur = new Float64Array(count * dim);
    for (var i = 0; i < count; i++) for (var d = 0; d < dim; d++) cur[i * dim + d] = pts[i][d];
    for (var i2 = 0; i2 < count * dim; i2++) xs[i2] = cur[i2];
    ts[0] = t0;
    var single = new Float64Array(dim), out = new Float64Array(dim);
    for (var s = 1; s < n; s++) {
      var tt = t0 + (s - 1) * dt;
      for (var p = 0; p < count; p++) {
        for (var d2 = 0; d2 < dim; d2++) single[d2] = cur[p * dim + d2];
        stepWith(method, system, single, tt, dt, out);
        for (var d3 = 0; d3 < dim; d3++) {
          var val = out[d3];
          cur[p * dim + d3] = isFinite(val) ? val : single[d3];
        }
      }
      ts[s] = t0 + s * dt;
      var base = s * count * dim;
      for (var q = 0; q < count * dim; q++) xs[base + q] = cur[q];
    }
    return { dim: dim, count: count, n: n, t: ts, x: xs, dt: dt, t0: t0 };
  }
  function ensembleGet(ens, step, index, out) {
    var dim = ens.dim;
    out = out || new Float64Array(dim);
    var base = (step * ens.count + index) * dim;
    for (var d = 0; d < dim; d++) out[d] = ens.x[base + d];
    return out;
  }

  /**
   * 最大李雅普诺夫指数（Benettin 重正化法）：衡量"相邻初始状态被拉开的速率"，
   * 是"对初值敏感依赖"的定量表达，与具体某条轨迹无关。
   */
  function lyapunovMax(system, x0, tmax, dt, opts) {
    opts = opts || {};
    var dim = system.dim;
    var d0 = opts.d0 || 1e-8;
    var x = new Float64Array(x0);
    var y = new Float64Array(dim);
    for (var i = 0; i < dim; i++) y[i] = x[i];
    y[0] += d0;
    var sum = 0, time = 0;
    var renormEvery = Math.max(1, Math.floor((opts.renormEvery || (0.5 / Math.abs(dt)))));
    var totalSteps = Math.floor(tmax / Math.abs(dt));
    var a = new Float64Array(dim), b = new Float64Array(dim);
    var t = 0;
    for (var s = 0; s < totalSteps; s++) {
      stepWith('rk4', system, x, t, dt, a);
      stepWith('rk4', system, y, t, dt, b);
      for (var k = 0; k < dim; k++) { x[k] = a[k]; y[k] = b[k]; }
      t += dt; time += Math.abs(dt);
      if ((s + 1) % renormEvery === 0) {
        var d = vecDist(x, y);
        if (!isFinite(d) || d === 0) return NaN;
        sum += Math.log(d / d0);
        // 把偏离向量拉回 d0（同一方向）
        var scaleTo = d0 / d;
        for (var m = 0; m < dim; m++) y[m] = x[m] + (y[m] - x[m]) * scaleTo;
      }
    }
    return sum / time;
  }

  /**
   * 极限环探测：以 x₀=0 且 ẋ₀>0 的 Poincaré 截面记录穿越点，
   * 若两个穿越点足够近且间隔够长，则该间隔即周期。只对 2 维自治系统有意义。
   */
  function detectLimitCycle(system, x0, tmax, dt, opts) {
    opts = opts || {};
    if (system.dim !== 2) return null;
    var minPeriod = opts.minPeriod || 1e-2;
    var closeTol = opts.closeTol || 2e-3;
    var warmup = opts.warmup || 0;
    var crossings = [];
    var x = new Float64Array(x0);
    var prev = new Float64Array(x0);
    var next = new Float64Array(2);
    var steps = Math.floor(tmax / dt);
    var t = 0;
    for (var s = 0; s < steps; s++) {
      prev[0] = x[0]; prev[1] = x[1];
      rk4Step(system, x, t, dt, next);
      if (isFinite(next[0]) && isFinite(next[1])) { x[0] = next[0]; x[1] = next[1]; }
      t += dt;
      if (t < warmup) continue;
      if (prev[0] < 0 && x[0] >= 0) {
        var frac = (0 - prev[0]) / (x[0] - prev[0]);
        var tc = t - dt + frac * dt;
        var yc = prev[1] + frac * (x[1] - prev[1]);
        crossings.push({ t: tc, y: yc });
      }
      if (crossings.length > 4000) break;
    }
    var best = null;
    for (var i = 0; i < crossings.length; i++) {
      for (var j = i + 1; j < crossings.length; j++) {
        var p = crossings[j].t - crossings[i].t;
        if (p < minPeriod) continue;
        if (p > tmax * 0.5) break;
        var dy = Math.abs(crossings[j].y - crossings[i].y);
        if (dy < closeTol) return { period: p, y: crossings[i].y, crossings: crossings.length };
        if (!best || dy < best.dy) best = { period: p, dy: dy, y: crossings[i].y, crossings: crossings.length };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- 随机外因：蒙特卡洛与概率密度
  /**
   * 直方图累加器：把"统计访问频次"这件事独立出来，
   * 于是可以一次跑全部（monteCarlo），也可以分片跑（界面里每帧跑几次，避免卡住）。
   * 索引布局固定为 idx = (iz*ny + iy)*nx + ix（nx 变化最快）。
   */
  function densityAccumulator(bounds, nx, ny, nz) {
    ny = ny || 1; nz = nz || 1;
    var dens = new Float64Array(nx * ny * nz);
    var dim = nz > 1 ? 3 : (ny > 1 ? 2 : 1);
    function bin(v, axis, n) {
      var lo = bounds[axis][0], hi = bounds[axis][1];
      if (!(hi > lo)) return -1;
      var k = Math.floor((v - lo) / (hi - lo) * n);
      return (k < 0 || k >= n) ? -1 : k;
    }
    var acc = {
      dens: dens, bounds: bounds, nx: nx, ny: ny, nz: nz, dim: dim,
      count: 0, outside: 0, runs: 0, added: 0,
      sum: new Float64Array(dim), sum2: new Float64Array(dim),
      add: function (traj, burnFrac) {
        var d = traj.dim;
        var from = Math.min(traj.n - 1, Math.floor(traj.n * (burnFrac === undefined ? 0.2 : burnFrac)));
        var added = 0;
        for (var i = from; i < traj.n; i++) {
          var base = i * d;
          var ix = bin(traj.x[base], 0, nx);
          if (ix < 0) { acc.outside++; continue; }
          var iy = d >= 2 ? bin(traj.x[base + 1], 1, ny) : 0;
          if (iy < 0) { acc.outside++; continue; }
          var iz = d >= 3 ? bin(traj.x[base + 2], 2, nz) : 0;
          if (iz < 0) { acc.outside++; continue; }
          dens[(iz * ny + iy) * nx + ix] += 1;
          acc.count++; added++;
          for (var q = 0; q < d; q++) {
            var v = traj.x[base + q];
            acc.sum[q] += v; acc.sum2[q] += v * v;
          }
        }
        acc.runs++;
        acc.added = added;
        return added;
      },
      mean: function (out) {
        out = out || new Float64Array(dim);
        for (var q = 0; q < dim; q++) out[q] = acc.count ? acc.sum[q] / acc.count : 0;
        return out;
      },
      std: function (out) {
        out = out || new Float64Array(dim);
        for (var q = 0; q < dim; q++) {
          var m = acc.count ? acc.sum[q] / acc.count : 0;
          out[q] = Math.sqrt(Math.max(0, (acc.count ? acc.sum2[q] / acc.count : 0) - m * m));
        }
        return out;
      }
    };
    return acc;
  }

  /**
   * 蒙特卡洛（一次跑完的版本，测试与批处理用；界面里用累加器分片跑）。
   * 同一个初始状态，在**同一条统计特性、不同实现**的随机外因下重复演化 N 次，
   * 把访问过的状态点累加成概率密度直方图 —— 那就是平稳概率密度的经验估计。
   *
   * @param opts.makeSystem  (runIndex) -> system（每次实现一个新系统：随机外因藏在 system.aux 里）
   */
  function monteCarlo(opts) {
    var acc = densityAccumulator(opts.bounds, opts.nx, opts.ny, opts.nz);
    var samples = [];
    for (var r = 0; r < opts.runs; r++) {
      var sys = opts.makeSystem(r);
      var traj = integrate(sys, opts.x0, opts.t0, opts.dt, opts.steps, opts.method, opts.integrateOpts);
      acc.add(traj, opts.burnIn);
      if (samples.length < (opts.keepSamples || 0)) samples.push(traj);
    }
    return {
      dim: acc.dim, nx: acc.nx, ny: acc.ny, nz: acc.nz, dens: acc.dens, bounds: acc.bounds,
      count: acc.count, outside: acc.outside, runs: acc.runs,
      mean: acc.mean(), std: acc.std(), samples: samples
    };
  }
  /** 把直方图归一成概率密度（∫p = 1），返回新数组 */
  function normalizeDensity(dens, bounds, nx, ny, nz) {
    var out = new Float64Array(dens.length);
    var tot = 0;
    for (var i = 0; i < dens.length; i++) tot += dens[i];
    if (!tot) return out;
    var cell = 1;
    for (var a = 0; a < (nz > 1 ? 3 : (ny > 1 ? 2 : 1)); a++) {
      var n = a === 0 ? nx : (a === 1 ? ny : nz);
      cell *= (bounds[a][1] - bounds[a][0]) / n;
    }
    for (var j = 0; j < dens.length; j++) out[j] = dens[j] / (tot * cell);
    return out;
  }
  /** 点云的质心、协方差与主轴（PCA）：三维相流"被拉成什么形状"的定量描述 */
  function cloudStats(points) {
    var n = points.length, dim = points[0].length;
    var mean = new Float64Array(dim);
    for (var i = 0; i < n; i++) for (var d = 0; d < dim; d++) mean[d] += points[i][d] / n;
    var cov = new Float64Array(dim * dim);
    for (var k = 0; k < n; k++) {
      for (var a = 0; a < dim; a++) {
        for (var b = 0; b < dim; b++) {
          cov[a * dim + b] += (points[k][a] - mean[a]) * (points[k][b] - mean[b]) / n;
        }
      }
    }
    var eig = dim === 2 ? eigen2(cov) : eigen3(cov);
    var vals = eig.map(function (e) { return Math.max(0, e.re); }).sort(function (x, y) { return y - x; });
    return {
      mean: mean, cov: cov, eigenvalues: vals,
      axes: vals.map(function (v) { return Math.sqrt(v); })   // 主半轴长 = √λ
    };
  }
  function boxVolume(bounds) {
    var v = 1;
    for (var i = 0; i < bounds.length; i++) v *= Math.max(0, bounds[i][1] - bounds[i][0]);
    return v;
  }

  /** 沿轨迹检查是否有界 / 是否发散（判断"系统是否稳定"的最朴素证据） */
  function trajectoryStats(traj) {
    var dim = traj.dim, n = traj.n;
    var maxAbs = 0, finite = true;
    for (var i = 0; i < n * dim; i++) {
      var v = traj.x[i];
      if (!isFinite(v)) { finite = false; continue; }
      var a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
    }
    var first = traj.x.subarray(0, dim);
    var lastIdx = (n - 1) * dim;
    var last = traj.x.subarray(lastIdx, lastIdx + dim);
    return {
      maxAbs: maxAbs,
      finite: finite,
      returnsToStart: vecDist(first, last) < 1e-3 * (1 + maxAbs),
      endDistance: vecDist(first, last)
    };
  }

  return {
    vecNorm: vecNorm,
    vecDist: vecDist,
    linSolve: linSolve,
    eulerStep: eulerStep,
    heunStep: heunStep,
    rk4Step: rk4Step,
    stepWith: stepWith,
    integrate: integrate,
    stateAt: stateAt,
    divergence: divergence,
    jacobian: jacobian,
    eigen2: eigen2,
    eigen3: eigen3,
    cubicRoots: cubicRoots,
    classify2: classify2,
    classifyND: classifyND,
    newton: newton,
    solveEquilibria: solveEquilibria,
    polygonArea: polygonArea,
    sampleRegion: sampleRegion,
    integrateEnsemble: integrateEnsemble,
    ensembleGet: ensembleGet,
    lyapunovMax: lyapunovMax,
    detectLimitCycle: detectLimitCycle,
    monteCarlo: monteCarlo,
    densityAccumulator: densityAccumulator,
    normalizeDensity: normalizeDensity,
    cloudStats: cloudStats,
    boxVolume: boxVolume,
    trajectoryStats: trajectoryStats
  };
});
