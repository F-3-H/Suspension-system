/* ============================================================
 * plot.js —— 轻量 Canvas 图表库（折线 / 柱状 / 相空间热力图）
 * 无外部依赖，支持对数坐标、坐标轴、图例与悬停读数。
 * ============================================================ */
(function (global) {
  'use strict';

  // 画布取色一律用主题 token 的值（见 assets/theme.css / styles.css）：--line-strong / --line / --fg-mute
  const AXIS = '#454c57', GRID = 'rgba(54,60,69,.45)', TEXT = '#7b848f';

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 400;
    const h = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function logTicks(min, max) {
    const out = [];
    const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
    for (let d = lo; d <= hi; d++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, d);
        if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
      }
    }
    return out;
  }

  function linTicks(min, max, count) {
    const span = max - min, step0 = span / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    let step = mag;
    if (norm >= 5) step = 5 * mag; else if (norm >= 2) step = 2 * mag; else step = mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
    if (out.length < 2) { out.length = 0; out.push(min, max); }
    return out;
  }

  // 1 位有效数字圆整（23.6 → 20，709 → 700）：只用于刻度标签，不改变变换本身
  function nice1(x) {
    const e = Math.floor(Math.log10(Math.abs(x) || 1));
    const n = Math.abs(x) / Math.pow(10, e);
    const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    return m * Math.pow(10, e);
  }

  // symlog 刻度：以压缩拐点 v0 的 {1,3}×10^k 倍取点 —— 在 symlog 下这些点近似等距，
  // 而 {1,2,5}×10^k 这类绝对圆整值会全部挤在 0 附近。
  function symlogTicks(y0, y1, v0) {
    const tmax = Math.max(Math.abs(y0), Math.abs(y1));
    const out = [0];
    if (!(tmax > 0) || !(v0 > 0)) return out;
    const base = nice1(v0);
    const pos = [];
    for (let d = 0; d < 10; d++) {
      const mag = Math.pow(10, d);
      for (const mul of [1, 3]) {
        const v = mul * mag * base;
        if (v <= tmax * 1.0001) pos.push(v);
      }
      if (mag * base > tmax * 10) break;
    }
    let keep = pos;
    if (pos.length > 5) {
      const step = Math.ceil(pos.length / 5);
      keep = pos.filter((_, i) => i % step === 0);
    }
    for (const v of keep) { out.push(v); out.push(-v); }
    return out;
  }

  function defFmt(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  class Plot {
    constructor(canvas, cfg) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cfg = cfg || {};
      this.hover = null;
      canvas.addEventListener('mousemove', (e) => this._move(e));
      canvas.addEventListener('mouseleave', () => { this.hover = null; this.render(); });
    }
    set config(c) { this.cfg = c; this.hover = null; this.render(); }
    _move(e) {
      const r = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.render();
    }
    _extent() {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of this.cfg.series || []) {
        for (const p of s.data) {
          const x = p[0], y = p[1];
          if (!isFinite(x) || !isFinite(y)) continue;
          if (this.cfg.xScale === 'log' && x <= 0) continue;
          if (this.cfg.yScale === 'log' && y <= 0) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
      if (x1 === x0) x1 = x0 + 1;
      if (y1 === y0) { y1 = y0 + 1; }
      return { x0, x1, y0, y1 };
    }
    render() {
      const c = this.cfg;
      const { ctx, w, h } = fit(this.canvas);
      if (w < 20 || h < 20) return;
      const m = { l: c.padL || 62, r: 14, t: 16, b: c.padB || 40 };
      const iw = w - m.l - m.r, ih = h - m.t - m.b;
      let e = this._extent();
      if (c.yMin != null) e.y0 = c.yMin;
      if (c.yMax != null) e.y1 = c.yMax;
      if (c.xMin != null) e.x0 = c.xMin;
      if (c.xMax != null) e.x1 = c.xMax;
      if (c.yScale === 'log') { if (e.y0 <= 0) e.y0 = Math.max(1e-12, e.y1 * 1e-4); }
      if (c.xScale === 'log') { if (e.x0 <= 0) e.x0 = Math.max(1e-9, e.x1 * 1e-4); }
      const logX = c.xScale === 'log', logY = c.yScale === 'log', symY = c.yScale === 'symlog';
      if (logY) { e.y0 = Math.pow(10, Math.floor(Math.log10(e.y0) * 1.02)); e.y1 = Math.pow(10, Math.ceil(Math.log10(e.y1) * 0.98)); }
      if (logX) { e.x0 = Math.pow(10, Math.floor(Math.log10(e.x0))); e.x1 = Math.pow(10, Math.ceil(Math.log10(e.x1))); }

      // symlog：近零处线性、远处对数压缩，量程取双向对称 —— 用于跨数量级的双极性信号
      let symF = null, symV0 = 0;
      if (symY) {
        const v0 = c.linThresh > 0 ? c.linThresh : Math.max(1e-12, Math.max(Math.abs(e.y0), Math.abs(e.y1)) * 0.01);
        symV0 = v0;
        const m1 = Math.max(Math.abs(e.y0), Math.abs(e.y1)) || 1;
        e.y0 = -m1; e.y1 = m1;
        symF = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v) / v0);
      }

      const sx = (v) => logX
        ? m.l + (Math.log10(Math.max(v, 1e-12)) - Math.log10(e.x0)) / (Math.log10(e.x1) - Math.log10(e.x0)) * iw
        : m.l + (v - e.x0) / (e.x1 - e.x0) * iw;
      const sy = symY
        ? (v) => m.t + ih - (symF(v) - symF(e.y0)) / (symF(e.y1) - symF(e.y0)) * ih
        : (logY
          ? (v) => m.t + ih - (Math.log10(Math.max(v, 1e-12)) - Math.log10(e.y0)) / (Math.log10(e.y1) - Math.log10(e.y0)) * ih
          : (v) => m.t + ih - (v - e.y0) / (e.y1 - e.y0) * ih);

      // 网格与刻度
      const xt = c.xticks ? c.xticks.map(t => t.v) : (logX ? logTicks(e.x0, e.x1) : linTicks(e.x0, e.x1, 6));
      const yt = symY ? symlogTicks(e.y0, e.y1, symV0) : (logY ? logTicks(e.y0, e.y1) : linTicks(e.y0, e.y1, 5));
      ctx.font = '11px Consolas, Menlo, monospace';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      for (const v of yt) {
        const y = sy(v);
        if (y < m.t - 1 || y > m.t + ih + 1) continue;
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + iw, y); ctx.stroke();
        ctx.fillStyle = TEXT; ctx.fillText((c.yFormat || defFmt)(v), m.l - 7, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let i = 0; i < xt.length; i++) {
        const v = xt[i];
        const x = sx(v);
        if (x < m.l - 1 || x > m.l + iw + 1) continue;
        ctx.strokeStyle = GRID;
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ih); ctx.stroke();
        ctx.fillStyle = TEXT;
        let lbl;
        if (c.xticks) lbl = c.xticks[i].label;
        else lbl = (c.xFormat || defFmt)(v);
        // 支持多行刻度标签（'\n' 分隔）：首行主标签，次行小字号标注该频段带宽
        const parts = String(lbl).split('\n');
        for (let li = 0; li < parts.length; li++) {
          ctx.font = li === 0 ? '11px Consolas, Menlo, monospace' : '9px Consolas, Menlo, monospace';
          ctx.fillText(parts[li], x, m.t + ih + 6 + li * 12);
        }
        ctx.font = '11px Consolas, Menlo, monospace';
      }
      ctx.strokeStyle = AXIS;
      ctx.strokeRect(m.l, m.t, iw, ih);

      // 参考竖线
      for (const vl of c.vlines || []) {
        const x = sx(vl.x);
        if (x < m.l || x > m.l + iw) continue;
        ctx.save();
        ctx.setLineDash(vl.dash || [4, 4]);
        ctx.strokeStyle = vl.color || '#ffb454';   // --warn
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ih); ctx.stroke();
        ctx.restore();
        if (vl.label) {
          ctx.fillStyle = vl.color || '#ffb454';   // --warn
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(vl.label, Math.min(x + 4, m.l + iw - 60), m.t + 3);
        }
      }

      // 数据
      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t, iw, ih); ctx.clip();
      for (const s of c.series || []) {
        if (s.type === 'bar') this._bars(ctx, s, sx, sy, e, iw);
        else this._line(ctx, s, sx, sy);
      }
      ctx.restore();

      // 悬停
      if (this.hover && this.hover.x >= m.l && this.hover.x <= m.l + iw) {
        this._tooltip(ctx, e, sx, sy, m, iw, ih);
      }

      // 图例
      this._legend(ctx, w, m);

      // 轴标签
      ctx.fillStyle = TEXT; ctx.font = '11px "Segoe UI",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      if (c.xLabel) ctx.fillText(c.xLabel, m.l + iw / 2, h - 2);
      if (c.yLabel) {
        ctx.save();
        ctx.translate(11, m.t + ih / 2); ctx.rotate(-Math.PI / 2);
        ctx.textBaseline = 'top'; ctx.fillText(c.yLabel, 0, 0);
        ctx.restore();
      }
    }
    _line(ctx, s, sx, sy) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      let started = false;
      for (const p of s.data) {
        const x = sx(p[0]), y = sy(p[1]);
        if (!isFinite(x) || !isFinite(y)) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (s.fill) {
        ctx.save();
        ctx.globalAlpha = 0.12; ctx.fillStyle = s.color;
        const last = s.data[s.data.length - 1], first = s.data[0];
        ctx.lineTo(sx(last[0]), sy(sy.base != null ? sy.base : 0));
        ctx.lineTo(sx(first[0]), sy(sy.base != null ? sy.base : 0));
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.setLineDash([]);
    }
    _bars(ctx, s, sx, sy, e, iw) {
      const d = s.data;
      let gap = Infinity;
      for (let i = 1; i < d.length; i++) gap = Math.min(gap, Math.abs(sx(d[i][0]) - sx(d[i - 1][0])));
      if (!isFinite(gap)) gap = 10;
      const bw = Math.max(2, gap * 0.62);
      for (const p of d) {
        const x = sx(p[0]), y = sy(p[1]);
        const y0 = sy(e.y0);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x - bw / 2, Math.min(y, y0), bw, Math.abs(y0 - y));
      }
      ctx.globalAlpha = 1;
    }
    _tooltip(ctx, e, sx, sy, m, iw, ih) {
      const logX = this.cfg.xScale === 'log';
      const t = logX
        ? Math.pow(10, Math.log10(e.x0) + (this.hover.x - m.l) / iw * (Math.log10(e.x1) - Math.log10(e.x0)))
        : e.x0 + (this.hover.x - m.l) / iw * (e.x1 - e.x0);
      ctx.save();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.moveTo(this.hover.x, m.t); ctx.lineTo(this.hover.x, m.t + ih); ctx.stroke();
      ctx.setLineDash([]);
      const lines = ['f = ' + defFmt(t)];
      for (const s of this.cfg.series || []) {
        let best = null, bd = Infinity;
        for (const p of s.data) {
          const d = Math.abs(Math.log10(p[0] / t)) || 0;
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const px = sx(best[0]), py = sy(best[1]);
          ctx.fillStyle = s.color;
          ctx.beginPath(); ctx.arc(px, py, 2.8, 0, 7); ctx.fill();
          lines.push(s.name + ': ' + defFmt(best[1]));
        }
      }
      ctx.font = '11px Consolas, monospace';
      let tw = 0;
      for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
      const bx = Math.min(this.hover.x + 10, m.l + iw - tw - 14);
      const by = m.t + 8;
      ctx.fillStyle = 'rgba(20,23,25,.92)';   // --bg-deep #141719，92% 不透明
      ctx.strokeStyle = '#363c45';            // --line
      ctx.beginPath(); ctx.rect(bx, by, tw + 16, lines.length * 15 + 10); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = i === 0 ? '#ffffff' : '#a9b2be';   // --fg / --fg-dim
        ctx.fillText(lines[i], bx + 8, by + 6 + i * 15);
      }
      ctx.restore();
    }
    _legend(ctx, w, m) {
      const ss = (this.cfg.series || []).filter(s => s.name);
      if (!ss.length) return;
      ctx.font = '11px "Segoe UI",sans-serif';
      let tw = 0;
      for (const s of ss) tw += ctx.measureText(s.name).width + 26;
      let x = w - 12 - tw;
      const y = 4;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      for (const s of ss) {
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y + 4, 12, 3);
        ctx.fillStyle = TEXT;
        ctx.fillText(s.name, x + 16, y);
        x += ctx.measureText(s.name).width + 26;
      }
    }
  }

  /* ---------------- 相空间热力图 ---------------- */
  // 概率密度色带：低=--bg-deep 系（深底）、高=--warn/近白。这是"颜色→访问次数"的连续映射，
  // 没有对应 token，故按 STYLE 第六节在此写死字面量并留注。
  const RAMP = [
    [0.0, [13, 20, 30]],
    [0.18, [24, 72, 120]],
    [0.40, [32, 150, 170]],
    [0.62, [70, 210, 175]],
    [0.80, [245, 200, 80]],
    [1.0, [255, 250, 220]]
  ];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const a = RAMP[i - 1], b = RAMP[i];
        const u = (t - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * u),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * u),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * u)
        ];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

  class Heatmap {
    constructor(canvas, cfg) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cfg = cfg || {}; }
    set config(c) { this.cfg = c; this.render(); }
    render() {
      const c = this.cfg;
      const { ctx, w, h } = fit(this.canvas);
      if (w < 20 || h < 20) return;
      const m = { l: 52, r: 14, t: 14, b: 38 };
      const iw = w - m.l - m.r, ih = h - m.t - m.b;
      const { xmin, xmax, ymin, ymax, nx, ny, bins, max } = c;
      const sx = v => m.l + (v - xmin) / (xmax - xmin) * iw;
      const sy = v => m.t + ih - (v - ymin) / (ymax - ymin) * ih;
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const v = bins[iy * nx + ix];
          if (!v) continue;
          const t = Math.pow(v / (max || 1), 0.42);
          const col = ramp(t);
          ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
          const x = sx(xmin + ix / nx * (xmax - xmin));
          const x2 = sx(xmin + (ix + 1) / nx * (xmax - xmin));
          const y = sy(ymin + (iy + 1) / ny * (ymax - ymin));
          const y2 = sy(ymin + iy / ny * (ymax - ymin));
          ctx.fillRect(x, y, x2 - x + 0.6, y2 - y + 0.6);
        }
      }
      // 轨迹线
      for (const path of (c.paths || [])) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const x = sx(path[i][0]), y = sy(path[i][1]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = AXIS;
      ctx.strokeRect(m.l, m.t, iw, ih);
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.moveTo(sx(0), m.t); ctx.lineTo(sx(0), m.t + ih);
      ctx.moveTo(m.l, sy(0)); ctx.lineTo(m.l + iw, sy(0)); ctx.stroke();
      ctx.font = '11px Consolas, monospace'; ctx.fillStyle = TEXT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const v of [xmin, 0, xmax]) {
        if (v >= xmin && v <= xmax) ctx.fillText(defFmt(v), sx(v), m.t + ih + 6);
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of [ymin, 0, ymax]) {
        if (v >= ymin && v <= ymax) ctx.fillText(defFmt(v), m.l - 7, sy(v));
      }
      ctx.fillStyle = TEXT; ctx.font = '11px "Segoe UI",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(c.xLabel || '', m.l + iw / 2, h - 2);
      ctx.save();
      ctx.translate(12, m.t + ih / 2); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top'; ctx.fillText(c.yLabel || '', 0, 0);
      ctx.restore();
    }
  }

  global.PlotLib = { Plot: Plot, Heatmap: Heatmap };
})(window);
