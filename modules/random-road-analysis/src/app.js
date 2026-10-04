/* ============================================================
 * app.js —— 主逻辑：路面 → 频率占比 → 内因响应 → 综合影响 → 改进建议
 * ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // 频段划分（Hz），用于“占比图”
  const BANDS = [0.1, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 25];
  const BAND_LABELS = BANDS.slice(0, -1).map(v => (v < 1 ? v.toFixed(1) : String(v)));

  // ISO 8601 路面等级（由平到差），用于"等级 → 影响"扫描
  const CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const SIM = { N: 8192, fs: 200, welchSeg: 1024, welchOverlap: 0.5, fmin: 0.1, fmax: 25 };
  const DEFAULTS = { classKey: 'C', speedKmh: 72, w: 2.0, seed: 20261004, m: 300, c: 1500, k: 20000, travel: 3.0 };

  const state = Object.assign({}, DEFAULTS);

  /* ---------------- 图表实例 ---------------- */
  const charts = {
    road: new PlotLib.Plot($('cvRoad'), {}),
    psd: new PlotLib.Plot($('cvPSD'), {}),
    psdBars: new PlotLib.Plot($('cvPSDBars'), {}),
    resp: new PlotLib.Plot($('cvH'), {}),
    out: new PlotLib.Plot($('cvOut'), {}),
    outBars: new PlotLib.Plot($('cvOutBars'), {}),
    classes: new PlotLib.Plot($('cvClasses'), {}),
    phase: new PlotLib.Heatmap($('cvPhase'), {})
  };
  let lastData = null;

  /* ---------------- 工具 ---------------- */
  // 数据系列色一律取主题 token 的值（--s1…--s5 / --danger），语义随仓库统一（橙=路面、蓝=位移…）
  const C = {
    road:    '#f2994a',   // --s2 橙：路面位移 x(t)
    psd:     '#f2994a',   // --s2 同源：路面功率谱（Welch）
    theory:  '#7b848f',   // --fg-mute 灰：理论路面谱（参考）
    bars:    '#f2994a',   // --s2 输入频段占比
    respD:   '#4f9cf9',   // --s1 蓝：位移传递 |H_d|
    respA:   '#c9a6ff',   // --s5 紫：加速度传递 |H_a|
    out:     '#2fbf8f',   // --s3 绿：综合影响 S_a
    outBars: '#2fbf8f',   // --s3 影响频段占比
    fn:      '#ff6b6b'    // --danger 红：固有频率 / 当前等级标线
  };

  function logPairs(f, S, lo, hi) {
    const out = [];
    for (let i = 0; i < f.length; i++) {
      if (f[i] < lo || f[i] > hi || S[i] <= 0) continue;
      out.push([f[i], S[i]]);
    }
    return out;
  }
  function fmtHz(v) { return v < 1 ? v.toFixed(2) : v.toFixed(1); }

  /* ---------------- 缓存与性能探针 ---------------- */
  // 结构不变量探针：验收时读它，判断“单帧工作量”是否被换层而非在同一层调参
  const perf = { roadHit: 0, roadMiss: 0, phaseRuns: 0, adviceRuns: 0, optimizeRuns: 0 };
  window.__perf = perf;

  const caches = { road: { key: null, road: null, wl: null } };
  const optCache = { key: null, val: null };
  let lastPhase = null, phaseKeyCached = null;

  // 路面 + Welch 只依赖外因（等级/车速/谱指数/种子），与内因 m,c,k 无关 —— 拖内因时复用
  function roadKey() {
    const st = state;
    return st.classKey + '|' + st.speedKmh + '|' + st.w + '|' + st.seed;
  }
  function phaseKey() { return roadKey() + '|' + state.m + '|' + state.c + '|' + state.k; }
  function optKey() { return roadKey() + '|' + state.m + '|' + state.travel; }

  function getRoad() {
    const key = roadKey();
    if (caches.road.key === key) { perf.roadHit++; return caches.road; }
    const road = Road.generate({
      N: SIM.N, fs: SIM.fs, speed: state.speedKmh / 3.6,
      Gd0: Road.ISO_CLASSES[state.classKey], w: state.w, seed: state.seed,
      fmin: SIM.fmin, fmax: SIM.fmax
    });
    const wl = FFT.welch(road.x, road.fs, SIM.welchSeg, SIM.welchOverlap);
    caches.road = { key: key, road: road, wl: wl };
    perf.roadMiss++;
    return caches.road;
  }

  /* ---------------- 快路径：内因响应 → 指标 → y(t) ---------------- */
  function computeFast() {
    const st = state;
    const rc = getRoad();
    const road = rc.road, wl = rc.wl, f = road.f, Sx = road.Sx;

    // 内因频率响应 H_d / H_a
    const Hd = new Float64Array(f.length), Ha = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) {
      if (f[i] <= 0) continue;
      const h = Susp.Hd(f[i], st.m, st.c, st.k);
      Hd[i] = h.mag;
      Ha[i] = (2 * Math.PI * f[i]) * (2 * Math.PI * f[i]) * h.mag;
    }

    // 综合影响：输出谱
    const Sy = Susp.outputPSD(f, Sx, st.m, st.c, st.k, 'disp');
    const Sa = Susp.outputPSD(f, Sx, st.m, st.c, st.k, 'acc');
    const Sv = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const w = 2 * Math.PI * f[i];
      Sv[i] = w * w * Hd[i] * Hd[i] * Sx[i];
    }

    // 指标
    const sigmaX = Susp.rms(f, Sx, SIM.fmin, SIM.fmax);
    const sigmaY = Susp.rms(f, Sy, SIM.fmin, SIM.fmax);
    const sigmaA = Susp.rms(f, Sa, SIM.fmin, SIM.fmax);
    const sigmaV = Susp.rms(f, Sv, SIM.fmin, SIM.fmax);
    const fn = Susp.naturalFreq(st.m, st.k);
    const zeta = Susp.dampingRatio(st.m, st.c, st.k);

    // 频段占比
    const bandsIn = Susp.bandAggregate(f, Sx, BANDS);
    const bandsOut = Susp.bandAggregate(f, Sa, BANDS);
    let domIdx = 0;
    for (let i = 1; i < bandsIn.share.length; i++) if (bandsIn.share[i] > bandsIn.share[domIdx]) domIdx = i;

    const resoLo = fn / 1.5, resoHi = fn * 1.5;
    const resoShare = Susp.bandVariance(f, Sa, resoLo, resoHi) / (Susp.bandVariance(f, Sa, SIM.fmin, SIM.fmax) || 1);

    // 车身位移轨迹 y(t)（含初值暂态）
    const traj = Susp.trajectory(road, st.m, st.c, st.k, 0, 0, st.seed);

    // 相空间为重路径：首次同步算一次，之后一律去抖（拖动时先保留上一帧）
    if (!lastPhase) recomputePhase(sigmaY, sigmaV);

    return {
      road: road, traj: traj, wl: wl, Hd: Hd, Ha: Ha, Sy: Sy, Sa: Sa,
      sigmaX, sigmaY, sigmaA, sigmaV, fn, zeta,
      bandsIn, bandsOut, domIdx, resoShare, resoLo, resoHi,
      phase: lastPhase, speed: road.speed
    };
  }

  /** 相空间重算（重路径）：仅在去抖回调中调用 */
  function recomputePhase(sigmaY, sigmaV) {
    lastPhase = buildPhase(state, sigmaY, sigmaV);
    phaseKeyCached = phaseKey();
    perf.phaseRuns++;
  }

  /** 相空间：N 条随机路面下 (y, ẏ) 的重复演化 */
  function buildPhase(st, sigmaY, sigmaV) {
    const REPS = 12, N = 1024, fs = SIM.fs;
    const xmax = Math.max(3.5 * sigmaY, 1e-6);
    const ymax = Math.max(3.5 * sigmaV, 1e-6);
    const xs = [], ys = [], paths = [];
    const baseSeed = st.seed >>> 0;
    for (let r = 0; r < REPS; r++) {
      const seed = (baseSeed + r * 7919) >>> 0;
      const g = Road.generate({
        N: N, fs: fs, speed: st.speedKmh / 3.6, Gd0: Road.ISO_CLASSES[st.classKey],
        w: st.w, seed: seed, fmin: SIM.fmin, fmax: SIM.fmax
      });
      const sim = Susp.trajectory(g, st.m, st.c, st.k, 0, 0, seed);
      const burn = Math.floor(N * 0.3);
      const path = [];
      for (let i = burn; i < N; i++) {
        xs.push(sim.y[i]); ys.push(sim.v[i]);
        if (r < 6 && i % 2 === 0) path.push([sim.y[i], sim.v[i]]);
      }
      if (r < 6) paths.push(path);
    }
    const dens = Susp.density2D(xs, ys, -xmax, xmax, -ymax, ymax, 96, 80);
    return { dens: dens, xmax: xmax, ymax: ymax, paths: paths };
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll(d) {
    const st = state, f = d.road.f;
    // 等级只等比缩放幅度：kToC = 当前等级 → C 级的幅值比 = √(Gd0_C/Gd0_当前)
    const kToC = Math.sqrt(Road.ISO_CLASSES.C / Road.ISO_CLASSES[st.classKey]);

    // ① 时域
    const tEnd = 10;
    const xData = [], yData = [];
    for (let i = 0; i < d.road.N; i++) {
      if (d.road.t[i] > tEnd) break;
      xData.push([d.road.t[i], d.road.x[i] * 1000]);
      yData.push([d.road.t[i], d.traj.y[i] * 1000]);
    }
    // 纵轴 = symlog（近零线性、远处对数压缩）+ 固定量程。
    // 两件事缺一不可：线性轴容不下 A→H 的 128 倍；而只要量程还跟着数据自动定标，
    // 峰值就永远顶在画面边缘、八级照样一样。故把压缩拐点锚在 C 级 σ、量程锚在 H 级：
    // 两者都由「当前内因 + 车速 + 种子」决定、与等级无关，于是换等级时波形高度逐级变化且永不裁切。
    const sigC = Math.max(d.sigmaX, d.sigmaY) * 1000 * kToC;                  // C 级 σ（mm）
    const spanH = Math.sqrt(Road.ISO_CLASSES.H / Road.ISO_CLASSES.C);         // H/C 幅值比 = 32
    const yRange = 4 * sigC * spanH;                                          // 量程覆盖到 H 级（4σ 余量）
    charts.road.config = {
      xLabel: '时间 t (s)', yLabel: '位移 (mm，压缩刻度)', yScale: 'symlog',
      yFormat: v => v.toFixed(0), linThresh: sigC, yMin: -yRange, yMax: yRange,
      series: [
        { name: '路面 x(t)', color: C.road, type: 'line', data: xData, width: 1.1 },
        { name: '车身 y(t)', color: C.respD, type: 'line', data: yData, width: 1.6 }
      ]
    };

    // ② 频率占比图：柱状占比与等级无关（正确）；曲线电平会随等级整体升降，
    // 故加一条固定的「C 级参考谱」当标尺 —— 曲线相对它的高度差就是等级差（功率比 = kToC²）。
    const refSx = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) refSx[i] = d.road.Sx[i] * kToC * kToC;
    charts.psd.config = {
      xLabel: '频率 f (Hz)', yLabel: 'PSD (m²/Hz)', xScale: 'log', yScale: 'log',
      series: [
        { name: 'Welch 统计', color: C.psd, type: 'line', data: logPairs(d.wl.f, d.wl.P, SIM.fmin, SIM.fmax), width: 1.3 },
        { name: '理论路面谱', color: C.theory, type: 'line', data: logPairs(f, d.road.Sx, SIM.fmin, SIM.fmax), width: 1.2, dash: [5, 4] },
        { name: 'C 级参考谱（固定）', color: C.fn, type: 'line', data: logPairs(f, refSx, SIM.fmin, SIM.fmax), width: 1.2, dash: [2, 3] }
      ]
    };
    charts.psdBars.config = bandBarConfig(d.bandsIn.share, C.bars, '频段占比', d);

    // ③ 内因响应
    charts.resp.config = {
      xLabel: '频率 f (Hz)', yLabel: '传递函数幅值 |H(f)|', xScale: 'log', yScale: 'log',
      vlines: [{ x: d.fn, color: C.fn, dash: [4, 4], label: 'f_n=' + d.fn.toFixed(2) + 'Hz' }],
      series: [
        { name: '|H_d| 位移传递', color: C.respD, type: 'line', data: logPairs(f, d.Hd, SIM.fmin, SIM.fmax), width: 1.6 },
        { name: '|H_a| 加速度传递', color: C.respA, type: 'line', data: logPairs(f, d.Ha, SIM.fmin, SIM.fmax), width: 1.6 }
      ]
    };

    // ④ 综合影响
    charts.out.config = {
      xLabel: '频率 f (Hz)', yLabel: 'S_a (m²/s⁴/Hz)', xScale: 'log', yScale: 'log',
      vlines: [{ x: d.fn, color: C.fn, dash: [4, 4], label: 'f_n' }],
      series: [
        { name: 'S_a = |H_a|²·S_x 输出', color: C.out, type: 'line', data: logPairs(f, d.Sa, SIM.fmin, SIM.fmax), width: 1.6, fill: true }
      ]
    };
    charts.outBars.config = bandBarConfig(d.bandsOut.share, C.outBars, '影响占比', d);

    // ⑤ 相空间
    charts.phase.config = phaseConfig(d.phase);

    // ⑥ 等级 → 影响：等级只等比缩放 Sx，故 σ ∝ √Gd0，可直接解析外推（零额外计算）
    const curGd = Road.ISO_CLASSES[st.classKey];
    const sweep = [];
    for (let i = 0; i < CLASSES.length; i++) {
      sweep.push([i, d.sigmaA * Math.sqrt(Road.ISO_CLASSES[CLASSES[i]] / curGd)]);
    }
    charts.classes.config = {
      xLabel: '路面等级（由平到差）', yLabel: '车身 RMS 加速度 σa (m/s²)',
      yScale: 'log', xMin: -0.4, xMax: CLASSES.length - 0.6,
      xticks: CLASSES.map((c, i) => ({ v: i, label: c })),
      vlines: [{ x: CLASSES.indexOf(st.classKey), color: C.fn, dash: [4, 4], label: '当前 ' + st.classKey }],
      series: [{ name: 'σa 随等级', color: C.out, type: 'line', data: sweep, width: 2 }]
    };
  }

  function phaseConfig(p) {
    return {
      xLabel: '位移 y (m)', yLabel: '速度 ẏ (m/s)',
      xmin: -p.xmax, xmax: p.xmax,
      ymin: -p.ymax, ymax: p.ymax,
      nx: p.dens.nx, ny: p.dens.ny,
      bins: p.dens.bins, max: p.dens.max,
      paths: p.paths
    };
  }

  function bandBarConfig(share, color, name, d) {
    const data = [];
    for (let i = 0; i < share.length; i++) data.push([i, share[i] * 100]);
    // 刻度两行：首行频段左端，次行该频段带宽 —— 占比是 ∫S df，带宽就是权重，
    // 12 个频段宽度从 0.4 Hz 到 10 Hz 相差 25 倍，不标出来必然被误读。
    const xticks = [];
    for (let i = 0; i < BAND_LABELS.length; i++) {
      const wd = BANDS[i + 1] - BANDS[i];
      xticks.push({ v: i, label: BAND_LABELS[i] + '\n' + (wd < 1 ? wd.toFixed(1) : String(wd)) + 'Hz' });
    }
    return {
      xLabel: '频段左端 (Hz)｜下行 = 带宽', yLabel: '占比 (%)',
      yScale: 'linear', yMin: 0, xMin: -0.6, xMax: BAND_LABELS.length - 0.4,
      padB: 54,
      yFormat: v => v.toFixed(0) + '%',
      xticks: xticks,
      series: [{ name: name, color: color, type: 'bar', data: data }]
    };
  }

  /* ---------------- 指标与建议 ---------------- */
  function comfortLevel(a) {
    if (a < 0.315) return { t: '很舒适', cls: 'good' };
    if (a < 0.63) return { t: '舒适', cls: 'good' };
    if (a < 1.0) return { t: '一般', cls: '' };
    if (a < 1.6) return { t: '不舒适', cls: 'warn' };
    if (a < 2.5) return { t: '很不舒适', cls: 'bad' };
    return { t: '极不舒适', cls: 'bad' };
  }

  function updateMetrics(d) {
    const b0 = BANDS[d.domIdx], b1 = BANDS[d.domIdx + 1];
    $('mSigmaX').textContent = (d.sigmaX * 1000).toFixed(2) + ' mm';
    $('mSigmaY').textContent = (d.sigmaY * 1000).toFixed(2) + ' mm';
    $('mSigmaA').textContent = d.sigmaA.toFixed(3) + ' m/s²';
    $('mTravel').textContent = (d.sigmaY * 3 * 100).toFixed(1) + ' cm';
    $('mDomBand').textContent = fmtHz(b0) + '–' + fmtHz(b1) + ' Hz';
    $('mReso').textContent = (d.resoShare * 100).toFixed(0) + '%';
    $('outFn').textContent = d.fn.toFixed(2) + ' Hz';
    $('outZeta').textContent = d.zeta.toFixed(3);

    // ① 面板动态说明：等级只等比缩放幅度（同一 seed 下波形形状逐点相同），纵轴用压缩刻度后仍然可见
    const kToC = Math.sqrt(Road.ISO_CLASSES.C / Road.ISO_CLASSES[state.classKey]);
    $('capRatio').textContent = ' 当前 ' + state.classKey + ' 级：σx = ' + (d.sigmaX * 1000).toFixed(2) +
      ' mm、σy = ' + (d.sigmaY * 1000).toFixed(2) + ' mm，为 C 级的 ×' + (1 / kToC).toFixed(2) +
      '（等级只改变幅度、不改变波形形状）。纵轴为压缩刻度、量程锚定到 H 级，故换等级时波形高度逐级变化且不会溢出画面。';

    // ② 面板动态说明：柱状占比与等级无关，会随等级变的是 PSD 电平（相对固定 C 级参考谱）
    $('capPsd').textContent = ' 当前 ' + state.classKey + ' 级：PSD 电平为 C 级的 ×' +
      (1 / (kToC * kToC)).toFixed(2) + '（幅值 ×' + (1 / kToC).toFixed(2) + '）——曲线随之整体升降，柱状占比不变。';

    // ④ 面板动态说明：占比同样与等级无关，随等级变的是总量 σa
    $('capOut').textContent = ' 当前 ' + state.classKey + ' 级：σa = ' + d.sigmaA.toFixed(3) +
      ' m/s²（C 级 ×' + (1 / kToC).toFixed(2) + '）——占比不变，变的是总量。';
  }

  function updateAdvice(d) {
    perf.adviceRuns++;
    const st = state;
    const items = [];
    const domLo = BANDS[d.domIdx], domHi = BANDS[d.domIdx + 1];
    const cl = comfortLevel(d.sigmaA);

    // 1) 影响总判断
    items.push({
      cls: cl.cls,
      html: '<b>该路面作用于当前悬挂的影响：</b>车身 RMS 加速度 <span class="kv">' +
        d.sigmaA.toFixed(3) + ' m/s²</span>（' + cl.t +
        '，未计权、仅供相对比较），车身位移 <span class="kv">' + (d.sigmaY * 1000).toFixed(1) +
        ' mm</span>，峰值行程约 <span class="kv">' + (d.sigmaY * 3 * 100).toFixed(1) + ' cm</span>。'
    });

    // 2) 哪些频率影响最大
    const outTop = [];
    const idx = Array.from(d.bandsOut.share.keys()).sort((a, b) => d.bandsOut.share[b] - d.bandsOut.share[a]);
    for (let i = 0; i < 3; i++) outTop.push(fmtHz(BANDS[idx[i]]) + '–' + fmtHz(BANDS[idx[i] + 1]) + 'Hz(' + (d.bandsOut.share[idx[i]] * 100).toFixed(0) + '%)');
    items.push({
      cls: 'good',
      html: '<b>哪些频率影响最大：</b>路面主能量带在 <span class="kv">' + fmtHz(domLo) + '–' + fmtHz(domHi) +
        ' Hz</span>，但经内因加权后，真正的影响集中在 <span class="kv">' + outTop.join('、') +
        '</span>；共振频带（f_n 附近）贡献 <span class="kv">' + (d.resoShare * 100).toFixed(0) + '%</span>。'
    });

    // 3) 内因（阻尼）建议
    if (d.zeta < 0.25) {
      items.push({ cls: 'warn', html: '<b>内因·阻尼：</b>阻尼比 ζ = <span class="kv">' + d.zeta.toFixed(2) + '</span> 偏低，共振峰突出（|H_d| 峰值约 ' + (1 / (2 * d.zeta)).toFixed(1) + ' 倍）。建议增大阻尼系数 c，抑制共振。' });
    } else if (d.zeta > 0.8) {
      items.push({ cls: 'warn', html: '<b>内因·阻尼：</b>阻尼比 ζ = <span class="kv">' + d.zeta.toFixed(2) + '</span> 偏高，虽共振被压住，但高频隔振变差（高频段 |H_a| 随 ζ 增大约 2ζ/r）。可适当减小 c。' });
    } else {
      items.push({ cls: 'good', html: '<b>内因·阻尼：</b>阻尼比 ζ = <span class="kv">' + d.zeta.toFixed(2) + '</span> 在较优区间（约 0.2–0.7），兼顾共振抑制与高频隔振。' });
    }

    // 4) 固有频率与路面能量带的匹配
    if (d.fn > domLo * 0.75 && d.fn < domHi * 1.3) {
      items.push({ cls: 'bad', html: '<b>内因·固有频率：</b>f_n = <span class="kv">' + d.fn.toFixed(2) + ' Hz</span> 正落在路面主能量带 <span class="kv">' + fmtHz(domLo) + '–' + fmtHz(domHi) + ' Hz</span> 内，共振风险高。可调整刚度 k 使 f_n 移出该带（f_n = √(k/m)/2π）。' });
    } else {
      items.push({ cls: 'good', html: '<b>内因·固有频率：</b>f_n = <span class="kv">' + d.fn.toFixed(2) + ' Hz</span> 避开了路面主能量带，共振风险较低。' });
    }

    // 5) 优化建议（结果只依赖 路面/m/行程，由 scheduleOptimize 去抖维护）
    const opt = currentOptimize(d.road);
    if (opt) {
      const drop = d.sigmaA > 0 ? (1 - opt.sigmaA / d.sigmaA) * 100 : 0;
      items.push({
        cls: 'good',
        html: '<b>内因优化（约束 σ_y ≤ ' + st.travel.toFixed(1) + ' cm）：</b>建议 c = <span class="kv">' +
          Math.round(opt.c) + '</span> N·s/m，k = <span class="kv">' + Math.round(opt.k) + '</span> N/m（f_n=' +
          Susp.naturalFreq(st.m, opt.k).toFixed(2) + 'Hz, ζ=' + Susp.dampingRatio(st.m, opt.c, opt.k).toFixed(2) +
          '），预计 RMS 加速度 ' + opt.sigmaA.toFixed(3) + ' m/s²，较当前' +
          (drop >= 0 ? '下降 ' : '上升 ') + Math.abs(drop).toFixed(0) + '%。'
      });
    }

    // 6) 外因建议（车速）
    const sweep = Susp.speedSweep(d.road, st.m, st.c, st.k, [0.7, 0.85, 1.15], { fmin: SIM.fmin, fmax: SIM.fmax });
    const s70 = sweep.find(s => s.ratio === 0.7), s115 = sweep.find(s => s.ratio === 1.15);
    const drop70 = d.sigmaA > 0 ? (1 - s70.sigmaA / d.sigmaA) * 100 : 0;
    const rise115 = d.sigmaA > 0 ? (s115.sigmaA / d.sigmaA - 1) * 100 : 0;
    items.push({
      cls: '',
      html: '<b>外因改进（改变输入）：</b>同一路面上，车速降至 ' + Math.round(s70.speed * 3.6) + ' km/h 时 RMS 加速度约降 <span class="kv">' +
        drop70.toFixed(0) + '%</span>；升至 ' + Math.round(s115.speed * 3.6) + ' km/h 时约升 <span class="kv">' +
        rise115.toFixed(0) + '%</span>。降低车速或提升路面等级，是从外因侧减小影响的直接手段。'
    });

    $('advice').innerHTML = items.map(it => '<div class="item ' + it.cls + '">' + it.html + '</div>').join('');
  }

  /** 取当前最优解：命中即用；首次同步算一次；其余先用旧值，等去抖刷新 */
  function currentOptimize(road) {
    const key = optKey();
    if (optCache.key === key) return optCache.val;
    if (optCache.val == null) {
      perf.optimizeRuns++;
      optCache.val = Susp.optimize(road, state.m, state.travel / 100, { fmin: SIM.fmin, fmax: SIM.fmax });
      optCache.key = key;
    }
    return optCache.val;
  }

  /* ---------------- 调度：快路径每帧，重路径去抖 ---------------- */
  let raf = 0, phaseTimer = 0, optTimer = 0;

  function render() {
    const d = computeFast();
    lastData = d;
    renderAll(d);
    updateMetrics(d);
    updateAdvice(d);
    schedulePhase();
    scheduleOptimize();
  }

  function refresh() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }

  // 相空间：去抖 110ms，拖动停止后才重算，且只重绘该面板
  function schedulePhase() {
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => {
      if (!lastData || phaseKeyCached === phaseKey()) return;
      recomputePhase(lastData.sigmaY, lastData.sigmaV);
      charts.phase.config = phaseConfig(lastPhase);
    }, 110);
  }

  // 内因优化：去抖 200ms，拖动 c,k 不触发（其结果与 c,k 无关）
  function scheduleOptimize() {
    clearTimeout(optTimer);
    optTimer = setTimeout(() => {
      if (!lastData) return;
      const key = optKey();
      if (optCache.key === key) return;
      perf.optimizeRuns++;
      optCache.val = Susp.optimize(lastData.road, state.m, state.travel / 100, { fmin: SIM.fmin, fmax: SIM.fmax });
      optCache.key = key;
      updateAdvice(lastData);
    }, 200);
  }

  /* ---------------- 事件绑定 ---------------- */
  function syncLabels() {
    $('valSpeed').textContent = state.speedKmh;
    $('valW').textContent = state.w.toFixed(2);
    $('valM').textContent = state.m;
    $('valC').textContent = state.c;
    $('valK').textContent = state.k;
    $('valTravel').textContent = state.travel.toFixed(1);
  }

  let bound = false;
  function bind() {
    $('selClass').value = state.classKey;
    $('rngSpeed').value = state.speedKmh;
    $('rngW').value = state.w;
    $('inpSeed').value = state.seed;
    $('rngM').value = state.m;
    $('rngC').value = state.c;
    $('rngK').value = state.k;
    $('rngTravel').value = state.travel;
    syncLabels();
    if (bound) return;   // 监听只绑一次：否则每次“重置”都会累积一份 handler，输入事件被重复触发
    bound = true;

    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

    on('selClass', 'change', e => { state.classKey = e.target.value; refresh(); });
    on('rngSpeed', 'input', e => { state.speedKmh = +e.target.value; syncLabels(); refresh(); });
    on('rngW', 'input', e => { state.w = +e.target.value; syncLabels(); refresh(); });
    on('inpSeed', 'input', e => { state.seed = (+e.target.value) >>> 0; refresh(); });
    on('btnSeed', 'click', () => {
      const s = (Math.random() * 0x7fffffff) >>> 0;
      state.seed = s; $('inpSeed').value = s; refresh();
    });
    on('rngM', 'input', e => { state.m = +e.target.value; syncLabels(); refresh(); });
    on('rngC', 'input', e => { state.c = +e.target.value; syncLabels(); refresh(); });
    on('rngK', 'input', e => { state.k = +e.target.value; syncLabels(); refresh(); });
    on('rngTravel', 'input', e => { state.travel = +e.target.value; syncLabels(); refresh(); });
    on('btnReset', 'click', () => {
      Object.assign(state, DEFAULTS);
      bind();
      refresh();
    });
    on('btnOptimize', 'click', () => {
      if (!lastData) return;
      const opt = Susp.optimize(lastData.road, state.m, state.travel / 100, { fmin: SIM.fmin, fmax: SIM.fmax });
      if (!opt) return;
      state.c = Math.round(opt.c / 20) * 20;
      state.k = Math.round(opt.k / 250) * 250;
      state.c = Math.min(6000, Math.max(200, state.c));
      state.k = Math.min(60000, Math.max(8000, state.k));
      $('rngC').value = state.c; $('rngK').value = state.k;
      syncLabels();
      refresh();
    });

    window.addEventListener('resize', () => {
      for (const key in charts) charts[key].render();
    });
  }

  bind();
  render();   // 首帧同步渲染：不依赖 rAF，避免标签页不可见时 rAF 停摆导致白屏
})();
