/*!
 * render.js —— 渲染层（第四层：把相空间画出来）
 *
 * 这一层只做一件事：把 core.js 算出来的量映射成像素。
 * 所有函数都接受显式的 view / camera 对象，不读全局状态，方便在浏览器里被自检脚本单独调用。
 *
 * 参考图的视觉约定（沿用）：
 *   · 深色底 + 细网格 + 轴刻度按 π 标注
 *   · 向量场画成一格一支箭头，箭头方向 = 状态变化方向
 *   · 箭头颜色 = 向量模 |f| 的大小（青绿 → 黄 → 橙 → 红），这就是"变化快慢"的直观编码
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 色标
  var STOPS = [
    [0.00, 22, 160, 158],
    [0.22, 62, 196, 120],
    [0.42, 150, 214, 62],
    [0.58, 226, 216, 56],
    [0.76, 240, 150, 45],
    [1.00, 228, 58, 52]
  ];
  function colormap(t) {
    if (!(t >= 0)) t = 0;
    if (t > 1) t = 1;
    for (var i = 0; i < STOPS.length - 1; i++) {
      var a = STOPS[i], b = STOPS[i + 1];
      if (t >= a[0] && t <= b[0]) {
        var f = (t - a[0]) / (b[0] - a[0] || 1);
        return [
          Math.round(a[1] + (b[1] - a[1]) * f),
          Math.round(a[2] + (b[2] - a[2]) * f),
          Math.round(a[3] + (b[3] - a[3]) * f)
        ];
      }
    }
    return [228, 58, 52];
  }
  function colorStr(t, alpha) {
    var c = colormap(t);
    return alpha === undefined || alpha >= 1
      ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
      : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
  }
  function gradientStops() {
    return STOPS.map(function (s) { return colorStr(s[0]); });
  }

  // ---------------------------------------------------------------- 刻度
  function niceStep(range, target) {
    var raw = range / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var mult = norm < 1.5 ? 1 : (norm < 3 ? 2 : (norm < 7 ? 5 : 10));
    return mult * mag;
  }
  /** 角度轴的刻度只能落在 π 的简单倍数上（π/4、π/2、π、2π、4π），否则标注出来是 0.7854 这种数 */
  function niceAngleStep(range, target) {
    var cands = [Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI, 8 * Math.PI];
    var best = cands[cands.length - 1], bestErr = Infinity;
    for (var i = 0; i < cands.length; i++) {
      var err = Math.abs(range / cands[i] - target);
      if (err < bestErr) { bestErr = err; best = cands[i]; }
    }
    return best;
  }
  /** 角度轴的特殊刻度：标注 π 的整数倍（-3π/2、π/2、2π …） */
  function formatTick(v, isAngle) {
    if (Math.abs(v) < 1e-9) return '0';
    if (isAngle) {
      var k = v / (Math.PI / 2);
      var r = Math.round(k);
      if (Math.abs(k - r) < 1e-6) {
        var num = r, den = 2;
        if (num % 2 === 0) { num /= 2; den = 1; }
        var sign = num < 0 ? '-' : '';
        num = Math.abs(num);
        if (den === 1) return sign + (num === 1 ? '\u03C0' : num + '\u03C0');
        return sign + (num === 1 ? '' : num) + '\u03C0/' + den;   // 1π/2 要写成 π/2
      }
    }
    var abs = Math.abs(v);
    if (abs >= 1000 || (abs < 0.01 && abs > 0)) return v.toExponential(1);
    return String(Math.round(v * 1e6) / 1e6);
  }
  function isAngleName(name) {
    return /theta|\u03B8|phi|\u03C6|angle|\u89D2/i.test(name || '');
  }

  // ---------------------------------------------------------------- 视图变换
  function makeView(bounds, w, h, pad) {
    pad = pad || { l: 52, r: 18, t: 18, b: 34 };
    var iw = Math.max(10, w - pad.l - pad.r);
    var ih = Math.max(10, h - pad.t - pad.b);
    var x0 = bounds[0][0], x1 = bounds[0][1], y0 = bounds[1][0], y1 = bounds[1][1];
    var sx = iw / (x1 - x0 || 1), sy = ih / (y1 - y0 || 1);
    return {
      bounds: bounds, w: w, h: h, pad: pad, iw: iw, ih: ih, sx: sx, sy: sy,
      toScreen: function (a, b) {
        return [pad.l + (a - x0) * sx, pad.t + (y1 - b) * sy];
      },
      toWorld: function (px, py) {
        return [x0 + (px - pad.l) / sx, y1 - (py - pad.t) / sy];
      },
      inside: function (px, py) {
        return px >= pad.l && px <= pad.l + iw && py >= pad.t && py <= pad.t + ih;
      }
    };
  }

  // ---------------------------------------------------------------- 基础绘制
  function drawBackground(ctx, w, h) {
    ctx.fillStyle = '#141719';
    ctx.fillRect(0, 0, w, h);
  }

  function drawGrid(ctx, view, opts) {
    opts = opts || {};
    var names = opts.names || [];
    var p = view.pad, iw = view.iw, ih = view.ih;
    var angleX = isAngleName(names[0]), angleY = isAngleName(names[1]);
    var bx = angleX ? niceAngleStep(view.bounds[0][1] - view.bounds[0][0], Math.max(2, Math.round(iw / 110)))
      : niceStep(view.bounds[0][1] - view.bounds[0][0], Math.max(2, Math.round(iw / 90)));
    var by = angleY ? niceAngleStep(view.bounds[1][1] - view.bounds[1][0], 4)
      : niceStep(view.bounds[1][1] - view.bounds[1][0], Math.max(2, Math.round(ih / 70)));

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, iw, ih);
    ctx.clip();

    ctx.strokeStyle = 'rgba(123,132,143,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var startX = Math.ceil(view.bounds[0][0] / bx) * bx;
    for (var x = startX; x <= view.bounds[0][1] + 1e-9; x += bx) {
      var sx = Math.round(view.toScreen(x, 0)[0]) + 0.5;
      ctx.moveTo(sx, p.t); ctx.lineTo(sx, p.t + ih);
    }
    var startY = Math.ceil(view.bounds[1][0] / by) * by;
    for (var y = startY; y <= view.bounds[1][1] + 1e-9; y += by) {
      var sy = Math.round(view.toScreen(0, y)[1]) + 0.5;
      ctx.moveTo(p.l, sy); ctx.lineTo(p.l + iw, sy);
    }
    ctx.stroke();

    // 坐标轴（若在视野内）
    ctx.strokeStyle = 'rgba(150,205,225,0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (view.bounds[0][0] <= 0 && view.bounds[0][1] >= 0) {
      var ax = Math.round(view.toScreen(0, 0)[0]) + 0.5;
      ctx.moveTo(ax, p.t); ctx.lineTo(ax, p.t + ih);
    }
    if (view.bounds[1][0] <= 0 && view.bounds[1][1] >= 0) {
      var ay = Math.round(view.toScreen(0, 0)[1]) + 0.5;
      ctx.moveTo(p.l, ay); ctx.lineTo(p.l + iw, ay);
    }
    ctx.stroke();
    ctx.restore();

    // 刻度
    ctx.fillStyle = 'rgba(169,178,190,0.75)';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var xv = startX; xv <= view.bounds[0][1] + 1e-9; xv += bx) {
      if (Math.abs(xv) < bx * 0.001) continue;
      var px = view.toScreen(xv, 0)[0];
      if (px < p.l - 1 || px > p.l + iw + 1) continue;
      ctx.fillText(formatTick(xv, isAngleName(names[0])), px, p.t + ih + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var yv = startY; yv <= view.bounds[1][1] + 1e-9; yv += by) {
      if (Math.abs(yv) < by * 0.001) continue;
      var py = view.toScreen(0, yv)[1];
      if (py < p.t - 1 || py > p.t + ih + 1) continue;
      ctx.fillText(formatTick(yv, isAngleName(names[1])), p.l - 7, py);
    }

    // 轴名
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    if (names[0]) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(names[0], p.l + iw, p.t + ih + 22); }
    if (names[1]) {
      ctx.save();
      ctx.translate(13, p.t);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(names[1], 0, 0);
      ctx.restore();
    }
  }

  function drawArrowScreen(ctx, x0, y0, x1, y1, color, width, headLen) {
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    var ux = dx / len, uy = dy / len;
    var hl = Math.min(headLen || 6, len * 0.5);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width || 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * hl * 0.6, y1 - uy * hl * 0.6);
    ctx.stroke();
    var px = -uy, py = ux;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * hl + px * hl * 0.45, y1 - uy * hl + py * hl * 0.45);
    ctx.lineTo(x1 - ux * hl - px * hl * 0.45, y1 - uy * hl - py * hl * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 向量场：屏幕上按格子取样，每格一支箭头。
   * 箭头长度 ∝ sqrt(|f|/参考模)，颜色 = |f|/参考模 —— 双重编码，方向和快慢分得清。
   * 参考模取样点模的 88 分位，避免个别奇点把整张图压成同一种颜色。
   */
  function drawVectorField2D(ctx, view, system, opts) {
    opts = opts || {};
    var cell = opts.cell || 34;
    var out = new Float64Array(system.dim);
    var samples = [];
    var maxLen = 0;
    var p = view.pad;
    // 点阵按"内区能放下几整格"排布，格心居中：这样每支箭头都完整落在绘图区内，
    // 不需要靠裁剪切掉半支（参考图里箭头也是整支的）
    var nx = Math.max(1, Math.floor(view.iw / cell));
    var ny = Math.max(1, Math.floor(view.ih / cell));
    var stepX = view.iw / nx, stepY = view.ih / ny;
    for (var ix = 0; ix < nx; ix++) {
      for (var iy = 0; iy < ny; iy++) {
        var px = p.l + stepX * (ix + 0.5);
        var py = p.t + stepY * (iy + 0.5);
        var wv = view.toWorld(px, py);
        system.f(Float64Array.of(wv[0], wv[1]), opts.t || 0, out);
        var m = Math.hypot(out[0], out[1]);
        if (!isFinite(m)) continue;
        samples.push({ px: px, py: py, vx: out[0], vy: out[1], m: m });
        if (m > maxLen) maxLen = m;
      }
    }
    var mags = samples.map(function (s) { return s.m; }).sort(function (a, b) { return a - b; });
    var ref = mags.length ? mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.88))] : 1;
    if (!(ref > 0)) ref = 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, view.iw, view.ih);
    ctx.clip();
    var arrows = [];
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var norm = Math.min(1, s.m / ref);
      var shade = Math.pow(norm, 0.55);
      // 屏幕方向：dx 用 sx 比例，dy 取负（屏幕 y 向下）
      var dirx = s.vx * view.sx, diry = -s.vy * view.sy;
      var dl = Math.hypot(dirx, diry);
      if (dl < 1e-12) continue;
      var drawLen = Math.min(stepX, stepY) * (0.30 + 0.42 * Math.sqrt(norm));
      var ux = dirx / dl, uy = diry / dl;
      var cx = s.px - ux * drawLen / 2, cy = s.py - uy * drawLen / 2;
      arrows.push({
        x0: cx, y0: cy, x1: cx + ux * drawLen, y1: cy + uy * drawLen,
        color: colorStr(shade, 0.94), norm: norm, m: s.m
      });
    }
    arrows.sort(function (a, b) { return a.m - b.m; });
    for (var k = 0; k < arrows.length; k++) {
      var a = arrows[k];
      drawArrowScreen(ctx, a.x0, a.y0, a.x1, a.y1, a.color, 1.6, 7);
    }
    ctx.restore();
    return { ref: ref, count: samples.length, maxLen: maxLen };
  }

  /** 零倾线：f₁=0 与 f₂=0 的等值线（marching squares）。一族的交点就是不动点。 */
  function drawNullclines2D(ctx, view, system, opts) {
    opts = opts || {};
    if (system.dim !== 2) return;
    var n = opts.grid || 140;
    var bx = view.bounds, p = view.pad, t = opts.t || 0;
    var f = new Float64Array(2);
    function sample(comp) {
      var g = new Float64Array((n + 1) * (n + 1));
      for (var i = 0; i <= n; i++) {
        var x = bx[0][0] + (bx[0][1] - bx[0][0]) * i / n;
        for (var j = 0; j <= n; j++) {
          var y = bx[1][0] + (bx[1][1] - bx[1][0]) * j / n;
          system.f(Float64Array.of(x, y), t, f);
          g[i * (n + 1) + j] = f[comp];
        }
      }
      return g;
    }
    var grids = [sample(0), sample(1)];
    var colors = ['rgba(120,225,255,0.75)', 'rgba(201,166,255,0.7)'];
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, view.iw, view.ih);
    ctx.clip();
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 4]);
    for (var c = 0; c < 2; c++) {
      var g = grids[c];
      ctx.strokeStyle = colors[c];
      ctx.beginPath();
      for (var i2 = 0; i2 < n; i2++) {
        for (var j2 = 0; j2 < n; j2++) {
          var x0 = bx[0][0] + (bx[0][1] - bx[0][0]) * i2 / n;
          var x1 = bx[0][0] + (bx[0][1] - bx[0][0]) * (i2 + 1) / n;
          var y0 = bx[1][0] + (bx[1][1] - bx[1][0]) * j2 / n;
          var y1 = bx[1][0] + (bx[1][1] - bx[1][0]) * (j2 + 1) / n;
          var v00 = g[i2 * (n + 1) + j2], v10 = g[(i2 + 1) * (n + 1) + j2];
          var v01 = g[i2 * (n + 1) + j2 + 1], v11 = g[(i2 + 1) * (n + 1) + j2 + 1];
          if (!isFinite(v00) || !isFinite(v10) || !isFinite(v01) || !isFinite(v11)) continue;
          var idx = (v00 > 0 ? 8 : 0) | (v10 > 0 ? 4 : 0) | (v11 > 0 ? 2 : 0) | (v01 > 0 ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          var e = [];
          if ((idx & 8) !== (idx & 4)) e.push([x0 + (x1 - x0) * (v00 / (v00 - v10)), y0]);
          if ((idx & 4) !== (idx & 2)) e.push([x1, y0 + (y1 - y0) * (v10 / (v10 - v11))]);
          if ((idx & 1) !== (idx & 2)) e.push([x0 + (x1 - x0) * (v01 / (v01 - v11)), y1]);
          if ((idx & 8) !== (idx & 1)) e.push([x0, y0 + (y1 - y0) * (v00 / (v00 - v01))]);
          for (var q = 0; q + 1 < e.length; q += 2) {
            var A = view.toScreen(e[q][0], e[q][1]);
            var B = view.toScreen(e[q + 1][0], e[q + 1][1]);
            ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
  }

  function pathTraj2D(ctx, view, traj, limit) {
    var dim = traj.dim;
    var upto = limit === undefined ? traj.n - 1 : Math.min(traj.n - 1, limit);
    ctx.beginPath();
    for (var i = 0; i <= upto; i++) {
      var s = view.toScreen(traj.x[i * dim], traj.x[i * dim + 1]);
      if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
    }
  }

  /** 轨迹：正向实线带辉光，反向虚线（回溯）。opts.limit 只画到第 limit 个采样点（播放用）。 */
  function drawTraj2D(ctx, view, traj, opts) {
    opts = opts || {};
    if (!traj) return;
    var p = view.pad;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, view.iw, view.ih);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (opts.backwardTraj) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(150,190,215,0.55)';
      ctx.lineWidth = 1.4;
      pathTraj2D(ctx, view, opts.backwardTraj, opts.backwardLimit);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts.glow !== false) {
      ctx.strokeStyle = 'rgba(120,235,255,0.16)';
      ctx.lineWidth = 7;
      pathTraj2D(ctx, view, traj, opts.limit);
      ctx.stroke();
    }
    ctx.strokeStyle = opts.color || '#ffffff';
    ctx.lineWidth = opts.width || 2.1;
    pathTraj2D(ctx, view, traj, opts.limit);
    ctx.stroke();
    ctx.restore();
  }

  /** 相流：框选区域内的点随时间的整体运动 + 变形后的区域边界 */
  function drawEnsemble2D(ctx, view, ens, step, opts) {
    opts = opts || {};
    if (!ens) return;
    var dim = ens.dim, count = ens.count, p = view.pad;
    var boundaryCount = opts.boundaryCount || 0;
    var interior = count - boundaryCount;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, view.iw, view.ih);
    ctx.clip();

    if (opts.ghostBounds) {
      var g0 = view.toScreen(opts.ghostBounds[0][0], opts.ghostBounds[1][1]);
      var g1 = view.toScreen(opts.ghostBounds[0][1], opts.ghostBounds[1][0]);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(g0[0], g0[1], g1[0] - g0[0], g1[1] - g0[1]);
      ctx.setLineDash([]);
    }

    if (boundaryCount > 0) {
      ctx.beginPath();
      for (var b = 0; b < boundaryCount; b++) {
        var s = view.toScreen(ens.x[(step * count + interior + b) * dim], ens.x[(step * count + interior + b) * dim + 1]);
        if (b === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      ctx.closePath();
      ctx.fillStyle = opts.fill || 'rgba(110,220,255,0.10)';
      ctx.fill();
      ctx.strokeStyle = opts.stroke || 'rgba(150,240,255,0.9)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    var tmp = new Float64Array(dim);
    for (var i = 0; i < interior; i++) {
      var q = view.toScreen(ens.x[(step * count + i) * dim], ens.x[(step * count + i) * dim + 1]);
      var r = 1.6;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = opts.pointColor || 'rgba(87,224,255,0.85)';
      ctx.fill();
    }
    void tmp;
    ctx.restore();
  }

  /** 不动点：稳定实心、不稳定空心、鞍点菱形 */
  function drawEquilibria2D(ctx, view, eqs, opts) {
    if (!eqs || !eqs.length) return;
    ctx.save();
    for (var i = 0; i < eqs.length; i++) {
      var e = eqs[i];
      var s = view.toScreen(e.x[0], e.x[1]);
      if (s[0] < 0 || s[1] < 0 || s[0] > view.w || s[1] > view.h) continue;
      var stable = e.classification && e.classification.stable;
      var isSaddle = e.classification && e.classification.type === '\u978D\u70B9';
      ctx.lineWidth = 2;
      ctx.strokeStyle = stable === true ? '#3ddc97' : (isSaddle ? '#ffb454' : '#ff6b6b');
      ctx.fillStyle = stable === true ? 'rgba(125,251,160,0.30)' : 'rgba(0,0,0,0)';
      if (isSaddle) {
        ctx.beginPath();
        ctx.moveTo(s[0], s[1] - 6); ctx.lineTo(s[0] + 6, s[1]);
        ctx.lineTo(s[0], s[1] + 6); ctx.lineTo(s[0] - 6, s[1]);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(s[0], s[1], 5.5, 0, Math.PI * 2);
        if (stable === true) ctx.fill();
        ctx.stroke();
      }
      if (opts && opts.labels !== false) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(e.classification ? e.classification.type : '', s[0] + 9, s[1] - 6);
      }
    }
    ctx.restore();
  }

  function drawMarker(ctx, view, xy, color, radius, label) {
    var s = view.toScreen(xy[0], xy[1]);
    ctx.save();
    ctx.beginPath();
    ctx.arc(s[0], s[1], (radius || 5) + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s[0], s[1], radius || 5, 0, Math.PI * 2);
    ctx.fillStyle = color || '#fff';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s[0] + 10, s[1] - 12);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 一维相线
  function drawPhaseLine1D(ctx, canvasW, canvasH, system, opts) {
    opts = opts || {};
    var bounds = opts.bounds || [[-2, 2]];
    var pad = { l: 56, r: 28 };
    var y = Math.round(canvasH * 0.42);
    var x0 = pad.l, x1 = canvasW - pad.r;
    var a = bounds[0][0], b = bounds[0][1];
    var toX = function (v) { return x0 + (v - a) / (b - a) * (x1 - x0); };
    var toV = function (px) { return a + (px - x0) / (x1 - x0) * (b - a); };

    drawBackground(ctx, canvasW, canvasH);
    ctx.strokeStyle = 'rgba(150,205,225,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();

    // 刻度
    var stepv = niceStep(b - a, 10);
    ctx.fillStyle = 'rgba(169,178,190,0.75)';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var start = Math.ceil(a / stepv) * stepv;
    for (var v = start; v <= b + 1e-9; v += stepv) {
      var px = toX(v);
      ctx.beginPath();
      ctx.moveTo(px, y - 4); ctx.lineTo(px, y + 4);
      ctx.strokeStyle = 'rgba(150,205,225,0.5)';
      ctx.stroke();
      ctx.fillText(formatTick(v, isAngleName(system.varNames[0])), px, y + 8);
    }

    // 向量场：沿线的箭头
    var out = new Float64Array(1);
    var count = 30;
    var mags = [];
    for (var i = 0; i <= count; i++) {
      var vv = a + (b - a) * i / count;
      system.f(Float64Array.of(vv), opts.t || 0, out);
      mags.push(Math.abs(out[0]));
    }
    var ref = mags.slice().sort(function (p, q) { return p - q; })[Math.floor(mags.length * 0.88)] || 1;
    for (var k = 0; k <= count; k++) {
      var v2 = a + (b - a) * k / count;
      system.f(Float64Array.of(v2), opts.t || 0, out);
      var m = Math.abs(out[0]);
      if (m < 1e-9) continue;
      var norm = Math.min(1, m / ref);
      var w = out[0] > 0 ? 1 : -1;
      var len = (x1 - x0) / count * (0.35 + 0.45 * Math.sqrt(norm));
      var cx = toX(v2);
      drawArrowScreen(ctx, cx - w * len / 2, y, cx + w * len / 2, y, colorStr(Math.pow(norm, 0.55), 0.95), 2, 7);
    }

    // 不动点
    if (opts.equilibria) {
      for (var e = 0; e < opts.equilibria.length; e++) {
        var eq = opts.equilibria[e];
        var ex = toX(eq.x[0]);
        var stable = eq.classification && eq.classification.stable;
        ctx.beginPath();
        ctx.arc(ex, y, 6, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = stable === true ? '#3ddc97' : '#ff6b6b';
        ctx.fillStyle = stable === true ? 'rgba(61,220,151,0.35)' : 'rgba(0,0,0,0)';
        if (stable === true) ctx.fill();
        ctx.stroke();
      }
    }

    // 轨迹：随时间在一维相空间里滑动
    if (opts.traj && opts.step !== undefined) {
      var tr = opts.traj, dim = tr.dim;
      ctx.beginPath();
      for (var s = 0; s <= opts.step; s++) {
        var sx = toX(tr.x[s * dim]);
        if (s === 0) ctx.moveTo(sx, y + 20); else ctx.lineTo(sx, y + 20);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      var cur = toX(tr.x[opts.step * dim]);
      ctx.beginPath();
      ctx.arc(cur, y + 20, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cur, y + 14); ctx.lineTo(cur, y - 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (opts.marker) {
      var mx = toX(opts.marker[0]);
      ctx.beginPath();
      ctx.arc(mx, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#57e0ff';
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(system.varNames[0], x1, y - 22);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(160,200,215,0.75)';
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillText('\u4E00\u7EF4\u76F8\u7A7A\u95F4\uFF1A\u72B6\u6001\u53EA\u6709\u4E00\u4E2A\u5C5E\u6027\uFF0C\u76F8\u70B9\u5728\u76F4\u7EBF\u4E0A\u6ED1\u52A8', pad.l, canvasH - 14);
  }

  // ---------------------------------------------------------------- 随机模式：概率密度与功率谱
  /**
   * 把概率密度直方图变成 RGBA 像素（纯函数，可在 Node 里直接断言）。
   * 用**对数色标**：否则少数几个峰会把整张图压成一片黑——随机响应里"概率差几个数量级"是常态。
   * 色带与向量场那条（青绿→橙红）刻意区分开：那条编码 |f|，这条编码"待得久不久"。
   */
  var DENSITY_RAMP = [
    [0.00, 6, 10, 26],
    [0.22, 18, 60, 140],
    [0.45, 20, 150, 190],
    [0.65, 70, 215, 160],
    [0.82, 235, 220, 90],
    [1.00, 255, 250, 235]
  ];
  function densityColor(t) {
    if (!(t >= 0)) t = 0;
    if (t > 1) t = 1;
    for (var i = 0; i < DENSITY_RAMP.length - 1; i++) {
      var a = DENSITY_RAMP[i], b = DENSITY_RAMP[i + 1];
      if (t >= a[0] && t <= b[0]) {
        var f = (t - a[0]) / (b[0] - a[0] || 1);
        return [
          Math.round(a[1] + (b[1] - a[1]) * f),
          Math.round(a[2] + (b[2] - a[2]) * f),
          Math.round(a[3] + (b[3] - a[3]) * f)
        ];
      }
    }
    return [255, 250, 235];
  }
  /** 直方图 → RGBA 像素。索引布局与 core.monteCarlo 一致：idx = (iz*ny+iy)*nx+ix */
  function densityImage(dens, nx, ny, opts) {
    opts = opts || {};
    var data = new Uint8ClampedArray(nx * ny * 4);
    var maxD = 0;
    for (var i = 0; i < dens.length; i++) if (dens[i] > maxD) maxD = dens[i];
    var gain = opts.gain || 300;
    var logBase = Math.log(1 + gain);
    for (var iy = 0; iy < ny; iy++) {
      for (var ix = 0; ix < nx; ix++) {
        var d = dens[ix + iy * nx];
        var t = maxD > 0 ? Math.log(1 + (d / maxD) * gain) / logBase : 0;
        var c = densityColor(t);
        var o = ((ny - 1 - iy) * nx + ix) * 4;   // 画布 y 向下、直方图 y 向上 → 翻转
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
        data[o + 3] = d > 0 ? (opts.alpha === undefined ? 235 : opts.alpha) : 0;
      }
    }
    return { width: nx, height: ny, data: data, maxDensity: maxD };
  }
  /**
   * 把密度图按世界坐标铺到画布上（一次 drawImage，而不是每格一个矩形）。
   * `opts.bounds` 必须是**统计时那个视窗**，不是当前视窗：概率密度是相空间里一个固定区域的属性，
   * 按当前视窗铺的话，一拖动画面它就被拉伸着钉在屏幕上（看着像"云拖不动"）。
   */
  function drawDensity2D(ctx, view, img, opts) {
    opts = opts || {};
    var bounds = opts.bounds || view.bounds, p = view.pad;
    var a = view.toScreen(bounds[0][0], bounds[1][1]);
    var b = view.toScreen(bounds[0][1], bounds[1][0]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, view.iw, view.ih);
    ctx.clip();
    ctx.imageSmoothingEnabled = !!opts.smooth;
    var src = img && img.canvas ? img.canvas : img;
    if (ctx.drawImage) ctx.drawImage(src, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  }
  function densityRampStops() {
    return [0, 0.2, 0.4, 0.6, 0.8, 1].map(function (t) {
      var c = densityColor(t);
      return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    });
  }

  /**
   * 功率谱曲线（双对数）。两条线对照着看才有意义：
   *   细线 = 输入（外因）的谱 S(ω)，粗线 = 响应（状态）的谱 —— 后者是前者乘上系统的 |H|²。
   * 于是在固有频率附近鼓起来的那一块，就是"外因通过内因起作用"最直观的样子。
   */
  function drawPSD(ctx, w, h, opts) {
    opts = opts || {};
    drawBackground(ctx, w, h);
    // 内边距随画布大小自适应：这块面板本来就不高，固定 48/24 的边距会把曲线挤成一条缝
    var small = h < 130;
    var p = small ? { l: 40, r: 8, t: 12, b: 14 } : { l: 48, r: 12, t: 16, b: 24 };
    var iw = w - p.l - p.r, ih = h - p.t - p.b;
    var resp = opts.response, exc = opts.excitation;
    if (iw <= 4 || ih <= 4) return;
    var wMin = Math.max(1e-3, opts.wMin || 0.2), wMax = opts.wMax || 30;
    function lx(wv) {
      return p.l + (Math.log(Math.max(wv, wMin)) - Math.log(wMin)) / (Math.log(wMax) - Math.log(wMin)) * iw;
    }
    var maxY = 0, minY = Infinity;
    function scan(ps) {
      if (!ps) return;
      for (var i = 1; i < ps.psd.length; i++) {
        var wv = ps.freq[i];
        if (wv < wMin || wv > wMax) continue;
        var v = ps.psd[i];
        if (!isFinite(v) || v <= 0) continue;
        if (v > maxY) maxY = v;
        if (v < minY) minY = v;
      }
    }
    scan(resp); scan(exc);
    if (!(maxY > 0)) { maxY = 1; minY = 1e-6; }
    if (!isFinite(minY) || minY <= 0) minY = maxY * 1e-6;
    // 顶部留余量：按纵向跨度的 10% 留（不能用乘性余量 —— 动态范围一大它就近乎为零，
    // 峰值仍旧贴在框上，看起来像被裁掉了）
    var lo = Math.log(minY), hi0 = Math.log(maxY);
    var hi = hi0 + Math.max((hi0 - lo) * 0.10, 0.05);
    function ly(v) { return p.t + ih - (Math.log(Math.max(v, minY)) - lo) / (hi - lo) * ih; }
    ctx.strokeStyle = 'rgba(123,132,143,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var dec = Math.ceil(Math.log10(wMin)); Math.pow(10, dec) <= wMax; dec++) {
      var x = lx(Math.pow(10, dec));
      ctx.moveTo(x, p.t); ctx.lineTo(x, p.t + ih);
    }
    ctx.stroke();
    function trace(ps) {
      var started = false;
      ctx.beginPath();
      for (var i = 1; i < ps.psd.length; i++) {
        var wv = ps.freq[i];
        if (wv < wMin || wv > wMax) continue;
        var v = ps.psd[i];
        if (!isFinite(v) || v <= 0) continue;
        var X = lx(wv), Y = ly(v);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      return started;
    }
    if (exc && trace(exc)) { ctx.strokeStyle = 'rgba(150,200,225,0.75)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    if (resp && trace(resp)) {
      ctx.lineTo(lx(wMax), p.t + ih);
      ctx.lineTo(lx(wMin), p.t + ih);
      ctx.closePath();
      ctx.fillStyle = 'rgba(242,153,74,0.14)';
      ctx.fill();
      if (trace(resp)) { ctx.strokeStyle = '#57e0ff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (opts.markW) {
      var mx = lx(opts.markW);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(125,251,160,0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(mx, p.t); ctx.lineTo(mx, p.t + ih); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(61,220,151,0.95)';
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('\u03C9\u2080', mx, p.t + 1);
    }
    ctx.fillStyle = 'rgba(169,178,190,0.7)';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(small ? '\u03C9' : '\u03C9 /(rad/s)', p.l, h - 2);
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(87,224,255,0.9)';
    ctx.fillText('\u54CD\u5E94\u5CF0\u503C ' + maxY.toExponential(1), p.l + 2, p.t + 1);
    // 「细线=输入谱 / 粗线=响应谱」已经写在这块面板的标题里了（HTML），
    // 矮面板里就不在画布内重复 —— 那一行会正好压在横轴上，看起来像被裁掉
  }

  // ---------------------------------------------------------------- 时间序列
  function drawTimeSeries(ctx, w, h, traj, opts) {
    opts = opts || {};
    drawBackground(ctx, w, h);
    if (!traj) return;
    var dim = traj.dim;
    var pad = { l: 56, r: 18, t: 14, b: 26 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var back = opts.backwardTraj || null;
    // 时间轴覆盖两支（回溯支在负半轴）："往前推演"与"往回追溯"落在同一条时间线上。
    // 以前回溯支是各自画一条、且时间轴由 t[0]→t[n-1] 决定，而回溯的 t 是递减的，
    // 于是曲线在图上是从右往左长出来的——本轮把它修成一条统一时间轴。
    var tMin = Infinity, tMax = -Infinity;
    function span(tr) {
      if (!tr || !tr.n) return;
      tMin = Math.min(tMin, tr.t[0], tr.t[tr.n - 1]);
      tMax = Math.max(tMax, tr.t[0], tr.t[tr.n - 1]);
    }
    span(traj); span(back);
    if (!isFinite(tMin) || !isFinite(tMax) || tMax - tMin < 1e-12) { tMin = 0; tMax = 1; }
    var lo = Infinity, hi = -Infinity;
    function range(tr, upto) {
      if (!tr) return;
      var last = upto === undefined ? tr.n - 1 : Math.min(tr.n - 1, upto);
      for (var i = 0; i <= last; i++) {
        for (var d = 0; d < dim; d++) {
          var v = tr.x[i * dim + d];
          if (!isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    range(traj, opts.step);
    if (back) range(back, opts.backwardLimit);
    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    var m = (hi - lo) * 0.12;
    lo -= m; hi += m;
    var toX = function (t) { return pad.l + (t - tMin) / (tMax - tMin) * iw; };
    var toY = function (v) { return pad.t + (hi - v) / (hi - lo) * ih; };

    ctx.strokeStyle = 'rgba(123,132,143,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var ystep = niceStep(hi - lo, 4);
    var sy0 = Math.ceil(lo / ystep) * ystep;
    for (var yv = sy0; yv <= hi; yv += ystep) {
      var py = Math.round(toY(yv)) + 0.5;
      ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + iw, py);
    }
    ctx.stroke();
    if (lo <= 0 && hi >= 0) {
      ctx.strokeStyle = 'rgba(169,178,190,0.35)';
      ctx.beginPath();
      var zy = Math.round(toY(0)) + 0.5;
      ctx.moveTo(pad.l, zy); ctx.lineTo(pad.l + iw, zy);
      ctx.stroke();
    }
    if (tMin < 0 && tMax > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      var zx = Math.round(toX(0)) + 0.5;
      ctx.moveTo(zx, pad.t); ctx.lineTo(zx, pad.t + ih);
      ctx.stroke();
    }

    var colors = ['#4f9cf9', '#f2994a', '#2fbf8f', '#ef5350', '#c9a6ff'];  // --s1…--s5（数据系列色）
    function curve(tr, upto, alpha) {
      if (!tr) return;
      var last = upto === undefined ? tr.n - 1 : Math.min(tr.n - 1, upto);
      for (var d = 0; d < dim; d++) {
        ctx.beginPath();
        for (var s = 0; s <= last; s++) {
          var px = toX(tr.t[s]), pyv = toY(tr.x[s * dim + d]);
          if (s === 0) ctx.moveTo(px, pyv); else ctx.lineTo(px, pyv);
        }
        ctx.strokeStyle = colors[d % colors.length];
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (back) curve(back, opts.backwardLimit, 0.45);
    curve(traj, opts.step, 1);

    if (opts.step !== undefined || opts.tCurrent !== undefined) {
      var tc = opts.tCurrent !== undefined
        ? opts.tCurrent
        : traj.t[Math.min(opts.step === undefined ? 0 : opts.step, traj.n - 1)];
      var cx = toX(tc);
      if (cx >= pad.l - 1 && cx <= pad.l + iw + 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, pad.t); ctx.lineTo(cx, pad.t + ih);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(169,178,190,0.75)';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatTick(hi, false), pad.l - 6, pad.t + 6);
    ctx.fillText(formatTick(lo, false), pad.l - 6, pad.t + ih - 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(123,132,143,0.7)';
    var cur = opts.tCurrent !== undefined ? opts.tCurrent
      : (opts.step !== undefined ? traj.t[Math.min(opts.step, traj.n - 1)] : traj.t[0]);
    ctx.fillText('t = ' + cur.toFixed(2), pad.l + 4, pad.t + 2);
    ctx.textAlign = 'right';
    for (var d3 = 0; d3 < dim; d3++) {
      ctx.fillStyle = colors[d3 % colors.length];
      ctx.fillText(traj.varNames ? traj.varNames[d3] : ('x' + d3), pad.l + iw - 6, pad.t + 2 + d3 * 13);
    }
    if (back) {
      ctx.fillStyle = 'rgba(123,132,143,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText('\u865A\u7EBF\uFF1A\u56DE\u6EAF\u652F t<0', pad.l + 4, pad.t + ih - 12);
    }
  }

  // ---------------------------------------------------------------- 三维
  function makeCamera(opts) {
    opts = opts || {};
    return {
      yaw: opts.yaw === undefined ? -0.62 : opts.yaw,
      pitch: opts.pitch === undefined ? 0.42 : opts.pitch,
      scale: opts.scale || 1,
      center: opts.center || [0, 0, 0],
      panX: 0, panY: 0,
      dist: opts.dist || 3.2
    };
  }
  /**
   * 正交投影 + 手写旋转（不引三维库：file:// 下要能离线双击运行）。
   * 返回屏幕坐标与深度（深度用于排序与明暗，让云状吸引子有层次）。
   * cam.panX / cam.panY 是**屏幕像素**平移量：这样 shift+拖动平移在三维里
   * 不需要改动注视点，也就不会与"相机注视视窗中心"互相打架。
   */
  function project3(cam, x, y, z, w, h, span) {
    var cx = x - cam.center[0], cy = y - cam.center[1], cz = z - cam.center[2];
    var cy1 = Math.cos(cam.yaw), sy1 = Math.sin(cam.yaw);
    var X = cx * cy1 - cy * sy1;
    var Y = cx * sy1 + cy * cy1;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var Y2 = Y * cp - cz * sp;
    var Z2 = Y * sp + cz * cp;
    var s = Math.min(w, h) * 0.42 / (span || 1) * cam.scale;
    return [w / 2 + X * s + (cam.panX || 0), h / 2 - Z2 * s + (cam.panY || 0), Y2];
  }

  /**
   * 反投影：给定屏幕坐标与该点的深度，反解出世界坐标。
   * 三维视图里"点一下就把状态放在这里"需要它——深度取当前状态点的深度，
   * 即"在与当前状态等深的平面上取点"，这是一个定义明确、可复现的操作（而不是随手猜一个 z）。
   */
  function unproject3(cam, sx, sy, depth, w, h, span) {
    var s = Math.min(w, h) * 0.42 / (span || 1) * cam.scale;
    var X = (sx - (cam.panX || 0) - w / 2) / s;
    var Z2 = (h / 2 - (sy - (cam.panY || 0))) / s;
    var Y2 = depth;
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var Y = Y2 * cp + Z2 * sp;
    var cz = -Y2 * sp + Z2 * cp;
    var cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw);
    var cx = X * cyw + Y * syw;
    var cyv = -X * syw + Y * cyw;
    return [cam.center[0] + cx, cam.center[1] + cyv, cam.center[2] + cz];
  }

  function draw3D(ctx, w, h, system, cam, opts) {
    opts = opts || {};
    var bounds = opts.bounds;
    var span = Math.max(
      bounds[0][1] - bounds[0][0],
      bounds[1][1] - bounds[1][0],
      bounds[2][1] - bounds[2][0]
    ) / 2;
    drawBackground(ctx, w, h);

    function P(x, y, z) { return project3(cam, x, y, z, w, h, span); }

    // 包围盒
    var corners = [];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
      corners.push([bounds[0][i], bounds[1][j], bounds[2][k]]);
    }
    var edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
    ctx.strokeStyle = 'rgba(123,132,143,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var e = 0; e < edges.length; e++) {
      var a = P.apply(null, corners[edges[e][0]]);
      var b = P.apply(null, corners[edges[e][1]]);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();

    // 坐标轴（从中心出发）
    var axes = [
      [[bounds[0][0], cam.center[1], cam.center[2]], [bounds[0][1], cam.center[1], cam.center[2]], system.varNames[0], '#57e0ff'],
      [[cam.center[0], bounds[1][0], cam.center[2]], [cam.center[0], bounds[1][1], cam.center[2]], system.varNames[1], '#57e0ff'],
      [[cam.center[0], cam.center[1], bounds[2][0]], [cam.center[0], cam.center[1], bounds[2][1]], system.varNames[2], '#2fbf8f']
    ];
    for (var ax = 0; ax < 3; ax++) {
      var A = P.apply(null, axes[ax][0]), B = P.apply(null, axes[ax][1]);
      ctx.strokeStyle = axes[ax][3];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = axes[ax][3];
      ctx.font = '600 12px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(axes[ax][2], B[0], B[1] - 10);
    }

    // 向量场：粗格点，按深度排序后绘制
    if (opts.field !== false) {
      var N = opts.fieldGrid || 5;
      var out = new Float64Array(3);
      var items = [];
      var mags = [];
      for (var ix = 0; ix < N; ix++) {
        for (var iy = 0; iy < N; iy++) {
          for (var iz = 0; iz < N; iz++) {
            var xv = bounds[0][0] + (bounds[0][1] - bounds[0][0]) * (ix + 0.5) / N;
            var yv = bounds[1][0] + (bounds[1][1] - bounds[1][0]) * (iy + 0.5) / N;
            var zv = bounds[2][0] + (bounds[2][1] - bounds[2][0]) * (iz + 0.5) / N;
            system.f(Float64Array.of(xv, yv, zv), opts.t || 0, out);
            var mag = Math.hypot(out[0], out[1], out[2]);
            if (!isFinite(mag)) continue;
            mags.push(mag);
            items.push({ p: [xv, yv, zv], v: [out[0], out[1], out[2]], m: mag });
          }
        }
      }
      mags.sort(function (p, q) { return p - q; });
      var ref = mags.length ? mags[Math.floor(mags.length * 0.88)] : 1;
      if (!(ref > 0)) ref = 1;
      var scaleLen = span * 0.42;
      var drawn = [];
      for (var it = 0; it < items.length; it++) {
        var o = items[it];
        var mm = o.m;
        var nl = Math.min(1, mm / ref);
        var L = scaleLen * (0.25 + 0.5 * Math.sqrt(nl));
        var ux = o.v[0] / mm, uy = o.v[1] / mm, uz = o.v[2] / mm;
        var p0 = P(o.p[0], o.p[1], o.p[2]);
        var p1 = P(o.p[0] + ux * L, o.p[1] + uy * L, o.p[2] + uz * L);
        drawn.push({ p0: p0, p1: p1, depth: (p0[2] + p1[2]) / 2, color: colorStr(Math.pow(nl, 0.55), 0.85), m: mm });
      }
      drawn.sort(function (p, q) { return q.depth - p.depth; });
      for (var q2 = 0; q2 < drawn.length; q2++) {
        drawArrowScreen(ctx, drawn[q2].p0[0], drawn[q2].p0[1], drawn[q2].p1[0], drawn[q2].p1[1], drawn[q2].color, 1.5, 6);
      }
    }

    // 轨迹：按深度分段的折线
    if (opts.traj) {
      var tr = opts.traj, dim = tr.dim;
      var stepTo = opts.step === undefined ? tr.n - 1 : Math.min(tr.n - 1, opts.step);
      ctx.lineWidth = 1.9;
      ctx.lineJoin = 'round';
      for (var s = 0; s < stepTo; s++) {
        var A2 = P(tr.x[s * dim], tr.x[s * dim + 1], tr.x[s * dim + 2]);
        var B2 = P(tr.x[(s + 1) * dim], tr.x[(s + 1) * dim + 1], tr.x[(s + 1) * dim + 2]);
        var depth = (A2[2] + B2[2]) / 2;
        var alpha = 0.35 + 0.6 * (1 - Math.min(1, Math.max(0, (depth / span + 1) / 2)));
        ctx.strokeStyle = 'rgba(120,240,255,' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(A2[0], A2[1]);
        ctx.lineTo(B2[0], B2[1]);
        ctx.stroke();
      }
      if (opts.step !== undefined && tr.n > 0) {
        var cur = P(tr.x[stepTo * dim], tr.x[stepTo * dim + 1], tr.x[stepTo * dim + 2]);
        ctx.beginPath();
        ctx.arc(cur[0], cur[1], 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cur[0], cur[1], 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill();
      }
    }

    // 相流云（三维区域）。opts.boxes 画"初始盒子"与"当前盒子"的线框：
    // 盒子怎么被拉长、压扁、扭斜，一眼就能看出来——这是三维版的"面积比"。
    if (opts.boxes) {
      for (var bx = 0; bx < opts.boxes.length; bx++) {
        var box = opts.boxes[bx];
        var bb = box.bounds, corners2 = [];
        for (var i2 = 0; i2 < 2; i2++) for (var j2 = 0; j2 < 2; j2++) for (var k2 = 0; k2 < 2; k2++) {
          corners2.push([bb[0][i2], bb[1][j2], bb[2][k2]]);
        }
        var E2 = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
        ctx.save();
        if (box.dash) ctx.setLineDash([5, 4]);
        ctx.strokeStyle = box.color || 'rgba(255,255,255,0.4)';
        ctx.lineWidth = box.width || 1.3;
        ctx.beginPath();
        for (var e2 = 0; e2 < E2.length; e2++) {
          var pA = P.apply(null, corners2[E2[e2][0]]);
          var pB = P.apply(null, corners2[E2[e2][1]]);
          ctx.moveTo(pA[0], pA[1]); ctx.lineTo(pB[0], pB[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (opts.pca && opts.pca.axes) {
      var ax = opts.pca;
      var dirs = ax.dirs || null;      // 没有特征向量时只画质心
      ctx.save();
      ctx.strokeStyle = 'rgba(61,220,151,0.8)';
      ctx.lineWidth = 1.6;
      for (var a2 = 0; dirs && a2 < dirs.length; a2++) {
        var L2 = ax.axes[a2];
        var d3 = dirs[a2];
        var p1 = P(ax.center[0] - d3[0] * L2, ax.center[1] - d3[1] * L2, ax.center[2] - d3[2] * L2);
        var p2 = P(ax.center[0] + d3[0] * L2, ax.center[1] + d3[1] * L2, ax.center[2] + d3[2] * L2);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      }
      ctx.restore();
    }
    if (opts.ensemble) {
      var ens = opts.ensemble, dim2 = ens.dim;
      var st = opts.ensStep || 0;
      for (var pi = 0; pi < ens.count; pi++) {
        var pp = P(
          ens.x[(st * ens.count + pi) * dim2],
          ens.x[(st * ens.count + pi) * dim2 + 1],
          ens.x[(st * ens.count + pi) * dim2 + 2]
        );
        ctx.beginPath();
        ctx.arc(pp[0], pp[1], 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(87,224,255,0.8)';
        ctx.fill();
      }
    }

    // 初值标记
    if (opts.marker) {
      var m3 = P(opts.marker[0], opts.marker[1], opts.marker[2]);
      ctx.beginPath();
      ctx.arc(m3[0], m3[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = '#57e0ff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(150,195,215,0.7)';
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('\u62D6\u52A8\u65CB\u8F6C\u00B7\u6EDA\u8F6E\u7F29\u653E\uFF08\u4E09\u7EF4\u76F8\u7A7A\u95F4\uFF1A\u4E09\u4E2A\u5C5E\u6027\uFF09', 12, h - 10);
  }

  // ---------------------------------------------------------------- 抽象示意图（左上角内嵌）
  function drawSchematic(ctx, w, h, dim, state, deriv, names) {
    drawBackground(ctx, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2 + 6);
    var R = Math.min(w, h) * 0.3;
    var axisColor = ['#57e0ff', '#4f9cf9', '#c9a6ff'];   // --accent-2 / --s1 / --s5（三个坐标轴各一色）
    var normal = [];
    if (dim === 1) {
      ctx.strokeStyle = axisColor[0];
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
      drawArrowScreen(ctx, R - 12, 0, R, 0, axisColor[0], 1.4, 7);
      normal = [[1, 0]];
    } else if (dim === 2) {
      ctx.strokeStyle = axisColor[0]; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
      drawArrowScreen(ctx, R - 12, 0, R, 0, axisColor[0], 1.4, 7);
      ctx.strokeStyle = axisColor[1];
      ctx.beginPath(); ctx.moveTo(0, R); ctx.lineTo(0, -R); ctx.stroke();
      drawArrowScreen(ctx, 0, -R + 12, 0, -R, axisColor[1], 1.4, 7);
      normal = [[1, 0], [0, 1]];
    } else {
      ctx.strokeStyle = axisColor[0]; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, R * 0.15); ctx.stroke();
      drawArrowScreen(ctx, R - 10, R * 0.15 - 3, R, R * 0.15, axisColor[0], 1.4, 7);
      ctx.strokeStyle = axisColor[1];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-R * 0.5, R * 0.42); ctx.stroke();
      drawArrowScreen(ctx, -R * 0.5 + 5, R * 0.42 - 5, -R * 0.5, R * 0.42, axisColor[1], 1.4, 7);
      ctx.strokeStyle = axisColor[2];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -R); ctx.stroke();
      drawArrowScreen(ctx, 0, -R + 12, 0, -R, axisColor[2], 1.4, 7);
      normal = [[0.93, 0.14], [-0.5, 0.42], [0, -1]];
    }
    // 状态点 + 当前变化方向
    var mx = 0, my = 0;
    for (var i = 0; i < dim; i++) {
      var s = state ? (state[i] || 0) : 0;
      var dscale = R * 0.55 / (1 + Math.abs(s));
      mx += normal[i][0] * Math.tanh(s * 0.5) * R * 0.7;
      my += normal[i][1] * Math.tanh(s * 0.5) * R * 0.7;
      void dscale;
    }
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    if (deriv && deriv.length) {
      var vx = 0, vy = 0;
      var mag = Math.hypot.apply(null, Array.from(deriv)) || 1;
      for (var j = 0; j < dim; j++) {
        vx += normal[j][0] * (deriv[j] / mag) * R * 0.55;
        vy += normal[j][1] * (deriv[j] / mag) * R * 0.55;
      }
      drawArrowScreen(ctx, mx, my, mx + vx, my + vy, 'rgba(255,255,255,0.85)', 1.6, 7);
    }
    if (names) {
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (dim === 1) ctx.fillText(names[0], R + 16, 0);
      if (dim === 2) { ctx.fillText(names[0], R + 16, 0); ctx.fillText(names[1], 0, -R - 12); }
      if (dim === 3) { ctx.fillText(names[0], R + 8, R * 0.15); ctx.fillText(names[1], -R * 0.5 - 8, R * 0.42 + 8); ctx.fillText(names[2], 0, -R - 12); }
    }
    ctx.restore();
  }

  function drawLegend(ctx, x, y, w, h) {
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    var stops = gradientStops();
    for (var i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  return {
    colormap: colormap,
    colorStr: colorStr,
    gradientStops: gradientStops,
    niceStep: niceStep,
    formatTick: formatTick,
    isAngleName: isAngleName,
    makeView: makeView,
    drawBackground: drawBackground,
    drawGrid: drawGrid,
    drawArrowScreen: drawArrowScreen,
    drawVectorField2D: drawVectorField2D,
    drawNullclines2D: drawNullclines2D,
    drawTraj2D: drawTraj2D,
    drawEnsemble2D: drawEnsemble2D,
    drawEquilibria2D: drawEquilibria2D,
    drawMarker: drawMarker,
    drawPhaseLine1D: drawPhaseLine1D,
    drawTimeSeries: drawTimeSeries,
    makeCamera: makeCamera,
    project3: project3,
    unproject3: unproject3,
    draw3D: draw3D,
    drawSchematic: drawSchematic,
    drawLegend: drawLegend,
    densityColor: densityColor,
    densityImage: densityImage,
    densityRampStops: densityRampStops,
    drawDensity2D: drawDensity2D,
    drawPSD: drawPSD
  };
});
