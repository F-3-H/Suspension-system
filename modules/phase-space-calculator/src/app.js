/*!
 * app.js —— 界面装配（第五层：把内核与渲染接到人手上）
 *
 * 三层信息在这里汇合：
 *   左上  示意图：状态=点、属性=坐标轴、点在往哪走（抽象概念的可视化）
 *   中间  相空间：向量场 + 轨迹 + 相流（这一张图就是"系统的全部可能"）
 *   下方  时间序列：同一个点在真实时间 t 中的样子（把抽象坐标轴落回物理时间）
 * 右上  读数与结构：t、状态、变化率、散度、不动点、极限环、Lyapunov
 *
 * 所有随机性都被排除：同样的方程 + 同样的初值 = 同样的图。
 */
(function () {
  'use strict';
  var EXPR = window.PSExpr, PH = window.PSPhase, RD = window.PSRender, PRE = window.PSPresets,
    PSRandom = window.PSRandom;

  // ------------------------------------------------------------------ 全局状态
  var S = {
    source: '',
    compiled: null,
    system: null,
    dim: 2,
    paramValues: {},
    bounds: [[-3, 3], [-3, 3]],
    init: new Float64Array([2, 0]),
    trajF: null, trajB: null,
    ensF: null, ensB: null, ensBounds: null, ensBoundaryCount: 0, ensSeedMode: '',
    curF: 0, curB: 0,
    playing: null,          // null | 'f' | 'b'
    acc: 0,
    opts: {
      field: true, nullcline: false, equilibria: true, grid: true,
      trail: true, backward: true, flow: true, labels: true
    },
    method: 'rk4',
    dt: 0.01,
    horizon: 20,
    backHorizon: 12,
    speed: 1,
    cam: RD.makeCamera(),
    analysis: { equilibria: [], limitCycle: null, lyapunov: null, ms: 0 },
    draftByDim: {},
    presetId: null,
    // ---- 模式：确定性 / 随机外因（蒙特卡洛） ----
    mode: 'det',
    branch: 'f',            // 显示跟随哪一支：'f' 正向 / 'b' 回溯（修过：以前靠猜，回溯一结束就跳回去）
    randSpec: { kind: 'band', wMin: 0.5, wMax: 20, components: 64, intensity: 0.02, wg: 3.0, zg: 0.6 },
    mc: {
      runs: 100, tMax: 20, dt: 0.01, nx: 220, ny: 170, burnIn: 0.25, keep: 8,
      running: false, done: 0, total: 0, result: null, img: null,
      psdResp: null, psdExc: null, seed: 20260923, ms: 0, pathsOnly: false, runBounds: null
    },
    flow3d: { centerOnInit: true, hf: 0.18, n: 4 },
    dirty: true,
    frame: 0,
    renderCount: 0,
    lastError: null,
    dragging: null,
    viewOverride: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  // ------------------------------------------------------------------ 小工具
  function fmt(v, digits) {
    if (!isFinite(v)) return String(v);
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-4)) return v.toExponential(2);
    var s = v.toFixed(digits === undefined ? 3 : digits);
    return s.replace(/\.?0+$/, '') || '0';
  }
  function fmtVec(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) out.push(fmt(v[i]));
    return '[' + out.join(', ') + ']';
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fitCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var r = canvas.getBoundingClientRect();
    var w = Math.max(120, Math.round(r.width));
    var h = Math.max(80, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  // ------------------------------------------------------------------ 方程装载
  function applySource(src, opts) {
    opts = opts || {};
    var c = EXPR.compile(src);
    if (!c.ok) {
      S.lastError = c.errors;
      renderErrors(c.errors);
      return false;
    }
    renderErrors([]);
    var prevDim = S.dim;
    var prevNames = S.compiled ? S.compiled.paramNames : [];
    var nextVals = {};
    c.paramNames.forEach(function (n) {
      if (!opts.resetParams && prevNames.indexOf(n) >= 0 && S.paramValues[n] !== undefined) nextVals[n] = S.paramValues[n];
      else nextVals[n] = c.paramDefaults[n];
    });
    S.source = src;
    S.compiled = c;
    S.dim = c.dim;
    S.paramValues = nextVals;
    S.draftByDim[c.dim] = src;
    S.system = c.makeSystem(S.paramValues);   // 随机外因的实现在下面 rebuildTrajectories→refreshSystem 里接上
    S.lastError = null;

    var dimChanged = prevDim !== c.dim;
    if (opts.bounds) S.bounds = cloneBounds(opts.bounds);
    else if (dimChanged) S.bounds = defaultBounds(c.dim);
    if (opts.init) S.init = Float64Array.from(opts.init);
    else if (dimChanged || S.init.length !== c.dim) S.init = defaultInit(c.dim);

    // 一维系统的相线视窗与初值
    S.viewOverride = null;
    S.ensF = null; S.ensB = null; S.ensBounds = null; S.ensSeedMode = '';
    // 时刻与"是否在播放"都是使用者手上的东西：改方程/改参数不该把它们清掉。
    // 换预设或维度变了才回到起点（opts.hardReset / 维度不同）。
    var wasPlaying = S.playing;
    var tBefore = currentPlaybackTime();
    rebuildTrajectories();
    if (opts.hardReset) resetPlayback();
    else if (dimChanged) restoreTime(0, wasPlaying);
    else restoreTime(tBefore, wasPlaying);
    renderParams();
    renderDimTabs();
    renderEquationBox();
    renderInitControls();
    scheduleAnalysis();
    markDirty();
    return true;
  }
  function cloneBounds(b) { return b.map(function (r) { return [r[0], r[1]]; }); }
  function defaultBounds(dim) {
    if (dim === 1) return [[-3, 3]];
    if (dim === 2) return [[-4, 4], [-4, 4]];
    return [[-4, 4], [-4, 4], [-4, 4]];
  }
  function defaultInit(dim) {
    var a = [];
    for (var i = 0; i < dim; i++) a.push(i === 0 ? 1 : 0);
    return Float64Array.from(a);
  }

  // ------------------------------------------------------------------ 轨迹与相流
  /**
   * 确定性模式下若方程含随机外因：**固定一次实现**（同一个种子必然得到同一条"路面"）。
   * 于是默认看到的是**路径**——一个状态点在一条具体路面下的走法；
   * 概率云只在"随机外因"模式里出现（那才是"重复 N 次看停留次数"的场合）。
   * 这也是人系统的意见：一进来就丢给他一片概率云，而他要看的是路径。
   */
  function detAux() {
    if (!S.compiled || !S.compiled.usesRandom || !PSRandom) return null;
    var span = S.horizon + S.backHorizon + 2;
    var n = Math.max(2, Math.round(span / S.dt) + 1);
    var spec = Object.assign({}, S.randSpec);
    var real = PSRandom.makeRealization(spec, { t0: -(S.backHorizon + 1), dt: S.dt, n: n },
      PSRandom.mulberry32(S.mc.seed));
    S.detReal = real;
    return { rand: real.sample, randV: real.sampleV };
  }
  /** 重建 S.system：把"当前这一次随机外因实现"接进去（无外因时就是普通系统） */
  function refreshSystem() {
    if (!S.compiled) return;
    S.system = S.compiled.makeSystem(S.paramValues, detAux());
  }

  function rebuildTrajectories() {
    if (!S.system) return;
    refreshSystem();
    var stepsF = Math.max(2, Math.round(S.horizon / S.dt));
    var stepsB = Math.max(2, Math.round(S.backHorizon / S.dt));
    S.trajF = PH.integrate(S.system, S.init, 0, S.dt, stepsF, S.method);
    S.trajF.varNames = S.system.varNames;
    // 回溯支给一个"发散就停"的边界：耗散系统的逆流不稳定，不设边界就会一路飞到 1e30，
    // 画面上表现为"一按回溯就飞掉"。截断并如实告知，比硬画一条无意义的线诚实。
    var pad = [];
    for (var d = 0; d < S.dim; d++) {
      var lo = S.bounds[d][0], hi = S.bounds[d][1];
      var span = Math.max(1e-9, hi - lo);
      pad.push([lo - span * 30, hi + span * 30]);
    }
    S.trajB = PH.integrate(S.system, S.init, 0, -S.dt, stepsB, S.method, { stopBox: pad });
    S.trajB.varNames = S.system.varNames;
    S.curF = Math.min(S.curF, S.trajF.n - 1);
    S.curB = Math.min(S.curB, S.trajB.n - 1);
  }
  function rebuildEnsemble(bounds, seedMode) {
    if (S.dim === 1) return;
    S.ensBounds = cloneBounds(bounds);
    S.ensSeedMode = seedMode || 'region';
    var stepsF = Math.max(2, Math.round(S.horizon / S.dt));
    var stepsB = Math.max(2, Math.round(S.backHorizon / S.dt));
    if (S.dim === 2) {
      var pts = PH.sampleRegion(bounds, 11, 11, 96);
      S.ensBoundaryCount = 96;
      S.ensF = PH.integrateEnsemble(S.system, pts, 0, S.dt, stepsF, S.method);
      S.ensB = PH.integrateEnsemble(S.system, pts, 0, -S.dt, stepsB, S.method);
    } else {
      // 三维：以当前状态为中心撒一簇状态（球状/立方点阵），看这团状态如何被相流搬运
      var pts3 = [];
      var n = 4;
      var r = (bounds[0][1] - bounds[0][0]) * 0.12;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) for (var k = 0; k < n; k++) {
        pts3.push(Float64Array.of(
          S.init[0] + (i / (n - 1) - 0.5) * 2 * r,
          S.init[1] + (j / (n - 1) - 0.5) * 2 * r,
          S.init[2] + (k / (n - 1) - 0.5) * 2 * r
        ));
      }
      S.ensBoundaryCount = 0;
      S.ensF = PH.integrateEnsemble(S.system, pts3, 0, S.dt, stepsF, S.method);
      S.ensB = null;
    }
  }
  /** 硬复位：回到 t=0 并停止播放（只有"回到初值"这类明确动作才该用它） */
  function resetPlayback() { S.curF = 0; S.curB = 0; S.acc = 0; S.playing = null; updatePlayButtons(); }
  /** 当前"使用者正看在哪个时刻" */
  function currentPlaybackTime() {
    return S.playing === 'b' ? -S.curB * S.dt : S.curF * S.dt;
  }
  /**
   * 重算轨迹之后，把使用者所在的时刻放回去，并保留"是否正在播放"。
   *
   * 这条是被人系统实测逼出来的：拖拽（平移/旋转/框选）之后可视画面会整个弹回初始状态。
   * 根因是 onPointerUp 末尾有一句无条件的 resetPlayback() —— 于是"我只是想挪一下画面"
   * 也把时间冲回了 t=0，已经演化出来的轨迹与相流全部作废。
   * 原则：**时间位置属于使用者，不属于实现**；只有"初始状态真的换了"才需要回到 0，
   * 而"换采样密度/改参数/挪画面"都应当留在原处。
   */
  function restoreTime(t, playing) {
    var dt = S.dt || 0.01;
    var nF = S.trajF ? S.trajF.n - 1 : 0;
    var nB = S.trajB ? S.trajB.n - 1 : 0;
    S.curF = clamp(Math.round(t / dt), 0, nF);
    S.curB = clamp(Math.round(-t / dt), 0, nB);
    S.acc = 0;
    S.playing = playing || null;
    updatePlayButtons();
  }
  /** 包住"重算轨迹"的调用：先记住时刻，算完放回去 */
  function keepTime(fn) {
    var t = currentPlaybackTime(), playing = S.playing;
    fn();
    restoreTime(t, playing);
  }

  // ------------------------------------------------------------------ 播放
  var scratch = null;
  function currentState() {
    if (!S.system) return new Float64Array(S.dim);
    if (!scratch || scratch.length !== S.dim) scratch = new Float64Array(S.dim);
    // 跟随 S.branch（而不是"猜"）：以前判据是"playing==='b' 或（没在播放且 curB>0 且 curF===0）"，
    // 于是回溯播放一结束（playing 变 null）显示就跳回正向支的末端——看起来像"回溯完就跳回去了"。
    if (S.branch === 'b' && S.trajB) {
      return PH.stateAt(S.trajB, -S.curB * S.dt, scratch, S.system);
    }
    return PH.stateAt(S.trajF, S.curF * S.dt, scratch, S.system);
  }
  function activeTraj() { return (S.branch === 'b' && S.trajB) ? S.trajB : S.trajF; }
  function activeStep() { return (S.branch === 'b' && S.trajB) ? Math.floor(S.curB) : Math.floor(S.curF); }

  /**
   * 播放推进被拆成"按帧推进"的纯函数：rAF 只负责按帧调用它。
   * 这样做的直接原因是它更好测——后台标签页里浏览器会把 rAF 降到分钟级甚至完全停掉，
   * 把推进逻辑绑在 rAF 上，等于把"能不能验收"交给了浏览器调度器。
   */
  function stepPlayback(frames) {
    for (var f = 0; f < (frames || 1); f++) {
      if (!S.playing) break;
      S.acc += S.speed / 60 / S.dt;   // speed = 每秒推进的"模型时间"
      var whole = Math.floor(S.acc);
      if (whole <= 0) continue;
      S.acc -= whole;
      if (S.playing === 'f') {
        S.curF = Math.min(S.trajF.n - 1, S.curF + whole);
        if (S.curF >= S.trajF.n - 1) { S.playing = null; updatePlayButtons(); }
      } else {
        S.curB = Math.min(S.trajB.n - 1, S.curB + whole);
        if (S.curB >= S.trajB.n - 1) { S.playing = null; updatePlayButtons(); }
      }
      markDirty();
    }
  }
  /**
   * 唯一的帧函数：先"该画就画"，再"推进时间"，然后排下一帧。
   *
   * 这里曾经有一个把整个界面冻住的写法（人系统实测报障：中间的图完全没反应、什么都不变）：
   *   requestAnimationFrame(function loop(){ if (S.dirty) render(); tick(); });
   *   function tick(){ stepPlayback(1); requestAnimationFrame(tick); }
   * 第一帧由 loop 渲染一次，但它随后调用 tick()，而 tick 排的是**自己**——
   * 于是 `if (S.dirty) render()` 从此再也不会执行：markDirty() 设的标志没有任何人读，
   * 相图永远停在第一帧，读数停在 t=0。
   * 教训：一个循环里"谁负责重绘"必须只有一处，且必须与"谁负责推进"在同一条链上，
   * 否则链条一交接，重绘就静默地掉队了（不报错、不异常，只是永远不动）。
   */
  function frameBody() {
    if (S.dirty) {
      try {
        render();
      } catch (err) {
        showFatal(err);
      }
    }
    stepPlayback(1);
    S.frame++;
  }
  function frame() {
    frameBody();
    requestAnimationFrame(frame);
  }
  function markDirty() { S.dirty = true; }

  // ------------------------------------------------------------------ 渲染
  function render() {
    if (!S.system) { S.dirty = false; return; }
    S.renderCount++;
    var main = fitCanvas(els.view);
    var ctx = main.ctx, w = main.w, h = main.h;

    if (S.dim === 1) {
      if (S.mode === 'random') {
        drawRandom1D(ctx, w, h);
      } else {
        RD.drawPhaseLine1D(ctx, w, h, S.system, {
          bounds: S.bounds,
          traj: activeTraj(),
          step: activeStep(),
          marker: S.init,
          equilibria: S.analysis.equilibria,
          t: currentTime()
        });
      }
      drawOverlayHud(ctx, w, h);
    } else if (S.dim === 2) {
      var view = RD.makeView(S.bounds, w, h, { l: 56, r: 20, t: 20, b: 36 });
      RD.drawBackground(ctx, w, h);
      if (S.opts.grid) RD.drawGrid(ctx, view, { names: S.system.varNames });
      if (S.opts.field) RD.drawVectorField2D(ctx, view, S.system, { cell: 36, t: currentTime() });
      if (S.opts.nullcline) RD.drawNullclines2D(ctx, view, S.system, { t: currentTime() });
      if (S.mode === 'random') {
        drawRandom2D(ctx, view);
      } else {
        if (S.opts.trail) {
          RD.drawTraj2D(ctx, view, S.trajF, {
            limit: Math.floor(S.curF),
            backwardTraj: S.opts.backward ? S.trajB : null,
            backwardLimit: Math.floor(S.curB),
            color: '#ffffff'
          });
        }
        if (S.opts.flow && S.ensF) drawEnsembleWithTrails(ctx, view);
      }
      if (S.opts.equilibria) RD.drawEquilibria2D(ctx, view, S.analysis.equilibria, { labels: S.opts.labels });
      RD.drawMarker(ctx, view, currentState(), '#57e0ff', 5, '');
      RD.drawMarker(ctx, view, S.init, 'rgba(87,224,255,0.35)', 3, '');
      drawStageFrame(ctx, w, h);
      drawOverlayHud(ctx, w, h);
    } else {
      // 三维相机的注视点必须跟着视窗中心走：Lorenz 的 z ∈ [0,55]，若相机盯着原点，
      // 整个吸引子会被投影到画布之外（本轮的结构断言抓到过这一点）
      S.cam.center = [
        (S.bounds[0][0] + S.bounds[0][1]) / 2,
        (S.bounds[1][0] + S.bounds[1][1]) / 2,
        (S.bounds[2][0] + S.bounds[2][1]) / 2
      ];
      RD.draw3D(ctx, w, h, S.system, S.cam, {
        bounds: S.bounds,
        traj: S.trajF,
        step: Math.floor(S.curF),
        ensemble: S.opts.flow ? S.ensF : null,
        ensStep: Math.floor(S.curF),
        boxes: flowBoxes3D(),
        marker: S.init,
        field: S.opts.field,
        fieldGrid: 5,
        t: currentTime()
      });
      drawStageFrame(ctx, w, h);
      drawOverlayHud(ctx, w, h);
    }

    // 时间序列：**两条支画在同一条时间轴上**（负半轴是回溯）。
    // 以前回溯时只画回溯支、而它的 t 是递减的，曲线在图上从右往左长——看着就是"出问题"。
    var ser = fitCanvas(els.series);
    if (activeTraj()) {
      RD.drawTimeSeries(ser.ctx, ser.w, ser.h, S.trajF, {
        step: Math.floor(S.curF),
        backwardTraj: S.trajB,
        backwardLimit: S.trajB ? S.trajB.n - 1 : undefined,
        tCurrent: currentTime()
      });
    }

    // 功率谱面板（只在随机模式下显示）：输入谱 vs 响应谱
    if (S.mode === 'random' && els.psd) {
      var ps = fitCanvas(els.psd);
      RD.drawPSD(ps.ctx, ps.w, ps.h, {
        response: S.mc.psdResp, excitation: S.mc.psdExc,
        wMin: Math.max(0.15, S.randSpec.wMin * 0.25), wMax: Math.max(1, S.randSpec.wMax * 1.4),
        markW: naturalFreq()
      });
    }

    // 示意图
    var sch = fitCanvas(els.schematic);
    RD.drawSchematic(sch.ctx, sch.w, sch.h, S.dim, currentState(), S.system.f(currentState(), currentTime()), S.system.varNames);

    // 图例：确定性模式说明箭头颜色（|f|）的读法；随机模式改用画布上的密度色带
    var leg = fitCanvas(els.legend);
    RD.drawBackground(leg.ctx, leg.w, leg.h);
    if (S.mode === 'det') {
      RD.drawLegend(leg.ctx, 8, 8, leg.w - 16, 8);
      leg.ctx.fillStyle = 'rgba(169,178,190,0.85)';
      leg.ctx.font = '10px ui-sans-serif, system-ui';
      leg.ctx.textAlign = 'left';
      leg.ctx.textBaseline = 'top';
      leg.ctx.fillText('\u5411\u91CF\u6A21 |f| \u5C0F', 8, 20);
      leg.ctx.textAlign = 'right';
      leg.ctx.fillText('\u5927', leg.w - 8, 20);
    }

    updateReadouts();
    S.dirty = false;
  }

  function currentTime() {
    return S.branch === 'b' ? -S.curB * S.dt : S.curF * S.dt;
  }

  /** 模式切换：确定性 ⇄ 随机外因。放在模块作用域，好让 loadPreset 也能直接调用
   *  （不要用 els.modeRandom.click() 去"模拟用户点击"——那不是应用内部应当走的路径） */
  function setMode(m) {
    S.mode = m;
    if (els.modeDet) els.modeDet.classList.toggle('active', m === 'det');
    if (els.modeRandom) els.modeRandom.classList.toggle('active', m === 'random');
    if (els.mcPanel) els.mcPanel.classList.toggle('show', m === 'random');
    if (els.psdWrap) els.psdWrap.classList.toggle('show', m === 'random');
    if (m === 'random') {
      els.dimNote.innerHTML = '<b>\u968F\u673A\u5916\u56E0\u6A21\u5F0F</b>\uFF1A\u76F8\u7A7A\u95F4\u7684\u4E00\u4E2A\u70B9\u5728\u968F\u673A\u5916\u56E0\u4E0B\u91CD\u590D\u6F14\u5316\uFF0C' +
        '\u770B\u5B83\u5728\u54EA\u513F\u5F85\u5F97\u4E45\uFF08\u6982\u7387\u5BC6\u5EA6\uFF09';
      mcNote();
    } else {
      renderDimTabs();
    }
    markDirty();
  }

  // ================================================================== 随机外因模式
  function mcGrid() {
    return { t0: 0, dt: S.mc.dt, n: Math.max(2, Math.round(S.mc.tMax / S.mc.dt) + 1) };
  }
  /**
   * 蒙特卡洛：同一个初始点，用**同一条谱、不同实现**的随机外因重复演化 N 次，
   * 把访问过的状态点累加成概率密度。分片执行（每次 8 条），界面不会卡住。
   * 随机数由种子决定 → 同一个种子必然复现同一张图，否则无法验收。
   */
  function startMonteCarlo() {
    if (!S.system || S.mc.running) return;
    if (!S.compiled.usesRandom) {
      els.mcNote.innerHTML = '<b>\u8FD9\u4E2A\u65B9\u7A0B\u91CC\u6CA1\u6709\u968F\u673A\u5916\u56E0</b>\uFF1A' +
        '\u8BF7\u5728\u65B9\u7A0B\u91CC\u5199\u4E0A <code>road(t)</code>\u3001<code>roadV(t)</code>\u3001<code>xi(t)</code>\u3001<code>rand(t)</code> \u4E4B\u4E00\uFF08\u5916\u56E0\uFF09\u3002';
      return;
    }
    if (S.dim > 2) {
      els.mcNote.innerHTML = '<b>\u968F\u673A\u6A21\u5F0F\u76EE\u524D\u652F\u6301 1\u20132 \u7EF4</b>\uFF1A' +
        '\u4E09\u7EF4\u7684\u6982\u7387\u5BC6\u5EA6\u9700\u8981\u5207\u7247\u6216\u4F53\u7ED3\u6784\uFF0C\u672C\u8F6E\u6CA1\u505A\uFF08\u8FD9\u662F\u5DF2\u77E5\u8FB9\u754C\uFF0C\u4E0D\u4F2A\u88C5\u6210\u505A\u4E86\uFF09\u3002';
      return;
    }
    S.mode = 'random';
    setMode('random');       // 直接改 S.mode 不会让面板显示出来，模式切换要走同一个入口
    S.mc.runBounds = cloneBounds(S.bounds);   // 概率云属于这个区域，拖动画面时要锚住它
    var grid = mcGrid();
    var steps = grid.n - 1;
    var acc = PH.densityAccumulator(S.bounds, S.mc.nx, S.mc.ny);
    var rng = PSRandom.mulberry32(S.mc.seed);
    var spec = Object.assign({}, S.randSpec);
    S.mc.running = true;
    S.mc.done = 0;
    S.mc.total = S.mc.runs;
    S.mc.result = null;
    S.mc.img = null;
    S.mc.psdResp = null;
    S.mc.psdExc = null;
    S.mc.samples = [];
    S.mc.lastReal = null;
    S.mc.lastTraj = null;
    S.mc.psdSum = null;      // 响应谱：对各次实现的周期图做**集平均**
    S.mc.psdN = 0;
    S.mc.freqR = null;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    els.btnMC.disabled = true;
    markDirty();

    function chunk() {
      var todo = Math.min(S.mc.chunk || 8, S.mc.runs - S.mc.done);
      for (var k = 0; k < todo; k++) {
        var real = PSRandom.makeRealization(spec, grid, rng);
        var sys = S.compiled.makeSystem(S.paramValues, { rand: real.sample, randV: real.sampleV });
        var traj = PH.integrate(sys, S.init, 0, S.mc.dt, steps, S.method);
        acc.add(traj, S.mc.burnIn);
        if (S.mc.samples.length < S.mc.keep) S.mc.samples.push(traj);
        // 频谱：单个实现的周期图噪声很大（峰值会在相邻频点之间乱跳），
        // 而且从静止出发的前几秒是暂态。这里对多次实现做集平均，并丢掉前 30% 的暂态——
        // 谱是**系统属性**，不该由某一次实现的抖动决定。
        var sig = new Float64Array(traj.n);
        for (var i2 = 0; i2 < traj.n; i2++) sig[i2] = traj.x[i2 * traj.dim];
        var pe = PSRandom.psdEstimate(sig, S.mc.dt, { segments: 3, trim: 0.3 });
        if (!S.mc.psdSum) { S.mc.psdSum = new Float64Array(pe.psd.length); S.mc.freqR = pe.freq; }
        for (var q3 = 0; q3 < pe.psd.length && q3 < S.mc.psdSum.length; q3++) S.mc.psdSum[q3] += pe.psd[q3];
        S.mc.psdN++;
        S.mc.lastReal = real;
        S.mc.lastTraj = traj;
        S.mc.done++;
      }
      markDirty();
      if (S.mc.done < S.mc.runs) { setTimeout(chunk, 0); return; }
      // 收尾：密度图 + 频谱
      var densImg = RD.densityImage(acc.dens, acc.nx, acc.ny, { gain: 300 });
      var canvas = null;
      try {
        if (typeof document !== 'undefined' && document.createElement) {
          canvas = document.createElement('canvas');
          canvas.width = acc.nx; canvas.height = acc.ny;
          var c2 = canvas.getContext('2d');
          if (c2.createImageData && c2.putImageData) {
            var im = c2.createImageData(acc.nx, acc.ny);
            im.data.set(densImg.data);
            c2.putImageData(im, 0, 0);
          } else canvas = null;
        }
      } catch (err) { canvas = null; }
      S.mc.img = { canvas: canvas, width: acc.nx, height: acc.ny, data: densImg.data, maxDensity: densImg.maxDensity };
      // 响应谱：集平均后的周期图；输入谱：最后一次实现的 S(ω)（它是解析的目标谱，本就无噪声）
      if (S.mc.psdSum && S.mc.psdN > 0) {
        var avg = new Float64Array(S.mc.psdSum.length);
        for (var i3 = 0; i3 < avg.length; i3++) avg[i3] = S.mc.psdSum[i3] / S.mc.psdN;
        S.mc.psdResp = { freq: S.mc.freqR, psd: avg };
        var nf = avg.length;
        var pe2 = new Float64Array(nf);
        for (var q4 = 0; q4 < nf; q4++) pe2[q4] = S.mc.lastReal.psd(S.mc.freqR[q4]);
        S.mc.psdExc = { freq: S.mc.freqR, psd: pe2 };
      }
      S.mc.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      S.mc.result = {
        dim: acc.dim, nx: acc.nx, ny: acc.ny, dens: acc.dens, bounds: acc.bounds,
        count: acc.count, outside: acc.outside, runs: acc.runs,
        mean: acc.mean(), std: acc.std()
      };
      S.mc.running = false;
      els.btnMC.disabled = false;
      mcNote();
      markDirty();
    }
    chunk();
  }
  function mcNote() {
    var r = S.mc.result;
    if (!r) { els.mcNote.textContent = '\u5728\u76F8\u7A7A\u95F4\u91CC\u6807\u4E00\u4E2A\u70B9\uFF0C\u7136\u540E\u70B9\u201C\u5F00\u59CB\u6A21\u62DF\u201D\uFF1A\u8FD9\u4E2A\u70B9\u4F1A\u5728\u968F\u673A\u5916\u56E0\u4E0B\u91CD\u590D\u8D70 N \u6B21\u3002'; return; }
    var loss = r.count + r.outside > 0 ? (r.outside / (r.count + r.outside) * 100) : 0;
    els.mcNote.innerHTML = '\u5171 <b>' + r.runs + '</b> \u6B21\u5B9E\u73B0\u3001' + r.count.toLocaleString() +
      ' \u4E2A\u91C7\u6837\u70B9\u843D\u5728\u89C6\u7A97\u5185' +
      (loss > 1 ? '\uFF08' + loss.toFixed(1) + '% \u843D\u5728\u89C6\u7A97\u5916\uFF0C\u5EFA\u8BAE\u653E\u5927\u89C6\u7A97\uFF09' : '') +
      '\uFF0C\u8017\u65F6 ' + S.mc.ms.toFixed(0) + ' ms\u3002<div class="muted">\u989C\u8272 = \u6BCF\u4E2A\u72B6\u6001\u70B9\u88AB\u8BBF\u95EE\u7684\u6B21\u6570' +
      '\uFF08\u8D8A\u4EAE\u8D8A\u5E38\u53BB\uFF09\uFF1B\u767D\u7EBF = ' + S.mc.samples.length + ' \u6761\u5177\u4F53\u8DEF\u5F84\u3002' +
      '\u4E0D\u60F3\u770B\u6982\u7387\u4E91\u5C31\u52FE\u201C\u53EA\u753B\u8DEF\u5F84\u201D\u3002</div>';
  }
  /** 二维随机模式：概率密度热图 + 若干条样本路径 + 初值点 */
  function drawRandom2D(ctx, view) {
    var r = S.mc.result;
    if (!r || (!S.mc.img && !S.mc.samples.length)) {
      if (S.mc.running) {
        ctx.fillStyle = 'rgba(169,178,190,0.8)';
        ctx.font = '13px ui-sans-serif, system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('\u6B63\u5728\u6A21\u62DF\u2026 ' + S.mc.done + ' / ' + S.mc.total, view.w / 2, view.h / 2);
      }
      return;
    }
    var img = S.mc.img;
    // 概率云是**属于相空间某个固定区域**的东西：它必须锚在"统计时那个视窗"上，
    // 不能按当前视窗铺 —— 否则一拖动画面，云就被拉伸着钉在屏幕上（看着像"拖不动"）。
    var rB = S.mc.runBounds || (r && r.bounds) || view.bounds;
    if (!S.mc.pathsOnly) {
      if (img && img.canvas) {
        RD.drawDensity2D(ctx, view, img, { smooth: true, bounds: rB });
      } else if (img) {
        // 没有离屏画布（例如无浏览器环境）时的退路：逐格画，慢但结果一样
        var p = view.pad;
        ctx.save();
        ctx.beginPath(); ctx.rect(p.l, p.t, view.iw, view.ih); ctx.clip();
        for (var iy = 0; iy < img.height; iy++) {
          for (var ix = 0; ix < img.width; ix++) {
            var o = ((img.height - 1 - iy) * img.width + ix) * 4;
            if (img.data[o + 3] === 0) continue;
            var x0 = rB[0][0] + (rB[0][1] - rB[0][0]) * ix / img.width;
            var x1 = rB[0][0] + (rB[0][1] - rB[0][0]) * (ix + 1) / img.width;
            var y0 = rB[1][0] + (rB[1][1] - rB[1][0]) * iy / img.height;
            var y1 = rB[1][0] + (rB[1][1] - rB[1][0]) * (iy + 1) / img.height;
            var a = view.toScreen(x0, y1), b = view.toScreen(x1, y0);
            ctx.fillStyle = 'rgb(' + img.data[o] + ',' + img.data[o + 1] + ',' + img.data[o + 2] + ')';
            ctx.fillRect(a[0], a[1], Math.max(1, b[0] - a[0]), Math.max(1, b[1] - a[1]));
          }
        }
        ctx.restore();
      }
      // 把"统计覆盖的范围"画出来：视窗挪开之后，人一眼就知道云为什么在那边
      if (S.mc.result) {
        var c0 = view.toScreen(rB[0][0], rB[1][0]), c1 = view.toScreen(rB[0][1], rB[1][1]);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(87,224,255,0.45)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(c0[0], c1[1], c1[0] - c0[0], c0[1] - c1[1]);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    // 样本路径（同一初值、不同实现）——说明"同样的点每次走法都不同"。
    // 只画路径时把它们画得更亮更粗：这时它们就是画面的主角，不是概率云的陪衬。
    if (S.mc.samples && S.mc.samples.length) {
      var only = !!S.mc.pathsOnly;
      ctx.save();
      ctx.beginPath(); ctx.rect(view.pad.l, view.pad.t, view.iw, view.ih); ctx.clip();
      for (var s = 0; s < S.mc.samples.length; s++) {
        var tr = S.mc.samples[s], dim = tr.dim;
        ctx.beginPath();
        for (var i = 0; i < tr.n; i++) {
          var pt = view.toScreen(tr.x[i * dim], tr.x[i * dim + 1]);
          if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
        }
        ctx.strokeStyle = only
          ? 'rgba(' + (150 + s * 12) + ',' + (235 - s * 8) + ',255,' + Math.max(0.35, 0.9 - s * 0.07) + ')'
          : 'rgba(255,255,255,' + Math.max(0.12, 0.30 - s * 0.03) + ')';
        ctx.lineWidth = only ? 1.6 : 1.1;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (!S.mc.pathsOnly) drawDensityLegend(ctx, view);
    else {
      ctx.fillStyle = 'rgba(169,178,190,0.85)';
      ctx.font = '10.5px ui-sans-serif, system-ui';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('\u53EA\u753B\u8DEF\u5F84\uFF1A' + S.mc.samples.length + ' \u6761\u540C\u521D\u503C\u3001\u4E0D\u540C\u8DEF\u9762\u5B9E\u73B0\u7684\u8F68\u8FF9',
        view.pad.l + 8, view.pad.t + 12);
    }
    RD.drawMarker(ctx, view, S.init, '#57e0ff', 5, '');
  }
  /** 一维随机模式：沿相线的概率密度柱状图（横着长） */
  function drawRandom1D(ctx, w, h) {
    var r = S.mc.result;
    RD.drawBackground(ctx, w, h);
    var pad = { l: 56, r: 28 };
    var y = Math.round(h * 0.5);
    var x0 = pad.l, x1 = Math.max(pad.l + 10, w - pad.r);
    var a = S.bounds[0][0], b = S.bounds[0][1];
    var toX = function (v) { return x0 + (v - a) / (b - a) * (x1 - x0); };
    if (r) {
      // 密度柱：高度按对数压缩，否则一个峰吃满整幅
      var maxD = 0;
      for (var i = 0; i < r.dens.length; i++) if (r.dens[i] > maxD) maxD = r.dens[i];
      if (maxD > 0) {
        for (var k = 0; k < r.nx; k++) {
          var d = r.dens[k];
          if (d <= 0) continue;
          var t = Math.log(1 + (d / maxD) * 300) / Math.log(301);
          var vb = a + (b - a) * k / r.nx, vt = a + (b - a) * (k + 1) / r.nx;
          var px = toX(vb), pw = Math.max(1, toX(vt) - px);
          var bh = t * (h * 0.36);
          var c = RD.densityColor(t);
          ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
          ctx.fillRect(px, y - bh, pw, bh);
          ctx.fillRect(px, y, pw, bh * 0.5);
        }
      }
    }
    // 相线 + 箭头 + 不动点（确定性部分照样显示，用来对照）
    RD.drawPhaseLine1D(ctx, w, h, S.system, {
      bounds: S.bounds, marker: S.init, equilibria: S.analysis.equilibria, t: 0, overlay: true
    });
    if (S.mc.running) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '12px ui-sans-serif, system-ui';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('\u6A21\u62DF\u4E2D ' + S.mc.done + '/' + S.mc.total, x0, 8);
    }
  }
  function drawDensityLegend(ctx, view) {
    var lw = 150, lh = 9;
    var lx = view.pad.l + view.iw - lw - 12, ly = view.pad.t + 10;
    var stops = RD.densityRampStops();
    ctx.fillStyle = 'rgba(20,23,25,0.72)';
    ctx.fillRect(lx - 6, ly - 13, lw + 12, lh + 30);
    for (var i = 0; i < stops.length; i++) {
      ctx.fillStyle = stops[i];
      ctx.fillRect(lx + lw * i / stops.length, ly, lw / stops.length + 1, lh);
    }
    ctx.fillStyle = 'rgba(169,178,190,0.85)';
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('\u505C\u7559\u6982\u7387', lx, ly + lh + 2);
    ctx.textAlign = 'right';
    ctx.fillText('\u4F4E \u2192 \u9AD8\uFF08\u5BF9\u6570\uFF09', lx + lw, ly + lh + 2);
  }

  // ================================================================== 三维相流工具
  function flowBox3D() {
    var c = [];
    for (var d = 0; d < 3; d++) {
      var mid = S.flow3d.centerOnInit ? S.init[d] : (S.bounds[d][0] + S.bounds[d][1]) / 2;
      var half = (S.bounds[d][1] - S.bounds[d][0]) * S.flow3d.hf;
      c.push([mid - half, mid + half]);
    }
    return c;
  }
  /** 当前步的云团包围盒（线框要跟着相流一起变形，才看得出"被拉成什么样"） */
  function cloudBounds(ens, step) {
    if (!ens) return null;
    var dim = ens.dim, n = ens.count;
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < n; i++) {
      for (var d = 0; d < dim; d++) {
        var v = ens.x[(step * n + i) * dim + d];
        if (!isFinite(v)) continue;
        if (v < lo[d]) lo[d] = v;
        if (v > hi[d]) hi[d] = v;
      }
    }
    if (!isFinite(lo[0])) return null;
    return [[lo[0], hi[0]], [lo[1], hi[1]], [lo[2], hi[2]]];
  }
  function flowBoxes3D() {
    if (S.dim !== 3 || !S.opts.flow || !S.ensF) return null;
    var out = [{ bounds: flowBox3D(), color: 'rgba(255,255,255,0.30)', dash: true }];
    var cur = cloudBounds(S.ensF, Math.floor(S.curF));
    if (cur) out.push({ bounds: cur, color: 'rgba(87,224,255,0.85)' });
    return out;
  }
  function build3DFlow() {
    if (S.dim !== 3) return;
    var box = flowBox3D();
    var n = S.flow3d.n;
    var pts = [];
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        for (var k = 0; k < n; k++) {
          pts.push(Float64Array.of(
            box[0][0] + (box[0][1] - box[0][0]) * (n === 1 ? 0.5 : i / (n - 1)),
            box[1][0] + (box[1][1] - box[1][0]) * (n === 1 ? 0.5 : j / (n - 1)),
            box[2][0] + (box[2][1] - box[2][0]) * (n === 1 ? 0.5 : k / (n - 1))
          ));
        }
      }
    }
    var stepsF = Math.max(2, Math.round(S.horizon / S.dt));
    S.ensF = PH.integrateEnsemble(S.system, pts, 0, S.dt, stepsF, S.method);
    S.ensB = null;
    S.ensBoundaryCount = 0;
    S.ensBounds = box;
    S.flow3d.initialStats = PH.cloudStats(pts);
    S.flow3d.initialVolume = PH.boxVolume(box);
    els.flowNote.textContent = '\u4E09\u7EF4\u76F8\u6D41\uFF1A' + n + '\u00B3 = ' + pts.length +
      ' \u4E2A\u72B6\u6001\u70B9\uFF08\u767D\u8272\u865A\u7EBF\u6846 = \u521D\u59CB\u533A\u57DF\uFF0C\u9752\u8272\u5B9E\u7EBF\u6846 = \u5F53\u524D\u4F4D\u7F6E\uFF09';
    resetPlayback();
    markDirty();
  }

  /** 固有频率：方程里有 w0 就用它；否则若同时有 k 与 m，就取 sqrt(k/m)（质量—弹簧系统的自然频率） */
  function naturalFreq() {
    var c = S.compiled, pv = S.system ? S.system.paramValues : null;
    if (!c || !pv) return 0;
    var i0 = c.paramNames.indexOf('w0');
    if (i0 >= 0) return pv[i0];
    var ik = c.paramNames.indexOf('k'), im = c.paramNames.indexOf('m');
    if (ik >= 0 && im >= 0 && pv[im] > 0) return Math.sqrt(pv[ik] / pv[im]);
    return 0;
  }

  function drawEnsembleWithTrails(ctx, view) {
    var step = Math.floor(S.curF);
    RD.drawEnsemble2D(ctx, view, S.ensF, step, {
      boundaryCount: S.ensBoundaryCount,
      ghostBounds: S.ensBounds,
      pointColor: 'rgba(87,224,255,0.85)'
    });
    if (S.opts.backward && S.ensB) {
      RD.drawEnsemble2D(ctx, view, S.ensB, Math.floor(S.curB), {
        boundaryCount: S.ensBoundaryCount,
        pointColor: 'rgba(160,200,230,0.5)',
        stroke: 'rgba(150,190,215,0.5)',
        fill: 'rgba(120,170,200,0.05)'
      });
    }
  }

  function drawStageFrame(ctx, w, h) {
    ctx.strokeStyle = 'rgba(123,132,143,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  function drawOverlayHud(ctx, w, h) {
    if (S.dragging && S.dragging.mode === 'region' && S.dragging.cur) {
      var a = S.dragging.start, b = S.dragging.cur;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(150,240,255,0.9)';
      ctx.lineWidth = 1.4;
      ctx.fillStyle = 'rgba(120,220,255,0.10)';
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(a.x - b.x), rh = Math.abs(a.y - b.y);
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x + 0.5, y + 0.5, rw, rh);
      ctx.restore();
    }
    if (S.dim === 3) {
      ctx.fillStyle = 'rgba(160,200,215,0.75)';
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      var txt = ['\u62D6\u52A8=\u65CB\u8F6C\u00B7\u6EDA\u8F6E=\u7F29\u653E\u00B7\u5355\u51FB=\u5728\u7B49\u6DF1\u5EA6\u5E73\u9762\u4E0A\u653E\u7F6E\u72B6\u6001'];
      if (S.lastError) txt.push('\u65B9\u7A0B\u6709\u8BEF\uFF0C\u4ECD\u663E\u793A\u4E0A\u4E00\u4E2A\u53EF\u7528\u76F8\u56FE');
      for (var i = 0; i < txt.length; i++) {
        ctx.fillStyle = i === 0 ? 'rgba(160,200,215,0.75)' : 'rgba(242,153,74,0.95)';
        ctx.fillText(txt[i], 12, h - 24 + i * 14);
      }
    }
  }

  // ------------------------------------------------------------------ 读数与面板
  function updateReadouts() {
    if (!S.system) return;
    if (S.mode === 'random') { updateReadoutsRandom(); return; }
    var st = currentState();
    var f = S.system.f(st, currentTime());
    var mag = PH.vecNorm(f);
    var div = PH.divergence(S.system, st, currentTime());

    var html = '';
    html += row('t', fmt(currentTime()) + '  (dt=' + S.dt + ', ' + S.method.toUpperCase() + ')');
    html += row('\u72B6\u6001 (' + S.system.varNames.join(', ') + ')', fmtVec(st));
    html += row('\u53D8\u5316\u7387 f', fmtVec(f));
    html += row('|f| \u53D8\u5316\u5FEB\u6162', fmt(mag));
    html += row('\u6563\u5EA6 \u2207\u00B7f', fmt(div) + '  <span class="tag ' + (div < -1e-9 ? 'ok' : (div > 1e-9 ? 'warn' : '')) + '">' +
      (div < -1e-9 ? '\u76F8\u4F53\u79EF\u6536\u7F29' : (div > 1e-9 ? '\u76F8\u4F53\u79EF\u81A8\u80C0' : '\u76F8\u4F53\u79EF\u5B88\u6052')) + '</span>');
    if (S.ensF && S.dim === 2 && S.ensBounds) {
      var area0 = PH.polygonArea(boundaryOf(S.ensF, 0));
      var areaT = PH.polygonArea(boundaryOf(S.ensF, Math.floor(S.curF)));
      html += row('\u76F8\u6D41\u9762\u79EF\u6BD4', fmt(areaT / (area0 || 1), 4) + '  <span class="tag">' + fmt(area0, 3) + ' \u2192 ' + fmt(areaT, 3) + '</span>');
    }
    els.readout.innerHTML = html;

    // 结构
    var sh = '';
    var eqs = S.analysis.equilibria;
    if (!eqs.length) sh += '<div class="muted">\u5728\u5F53\u524D\u89C6\u7A97\u5185\u672A\u627E\u5230\u4E0D\u52A8\u70B9\uFF08f=0 \u7684\u70B9\uFF09</div>';
    else {
      for (var i = 0; i < Math.min(eqs.length, 10); i++) {
        var e = eqs[i];
        var cls = e.classification.stable === true ? 'stable' : (e.classification.stable === false ? 'unstable' : 'neutral');
        sh += '<div class="eqitem"><span class="dot ' + cls + '"></span><b>' + fmtVec(e.x) + '</b> ' +
          '<span class="tag">' + e.classification.type + '</span>';
        if (S.dim === 2) {
          var ev = e.classification.eigenvalues;
          sh += '<div class="muted">\u03BB = ' + ev.map(function (v) {
            return fmt(v.re, 3) + (Math.abs(v.im) > 1e-9 ? (v.im > 0 ? '+' : '-') + fmt(Math.abs(v.im), 3) + 'i' : '');
          }).join(', ') + '</div>';
        }
        sh += '</div>';
      }
      if (eqs.length > 10) sh += '<div class="muted">\u2026\u5171 ' + eqs.length + ' \u4E2A</div>';
    }
    if (S.analysis.ms) sh += '<div class="muted">\u5206\u6790\u8017\u65F6 ' + S.analysis.ms.toFixed(0) + ' ms</div>';
    els.structure.innerHTML = sh;

    var dh = '';
    if (S.analysis.limitCycle) dh += '<div class="row"><span>\u6781\u9650\u73AF\u5468\u671F</span><b>' + fmt(S.analysis.limitCycle.period, 4) + '</b></div>';
    if (S.analysis.lyapunov !== null && S.analysis.lyapunov !== undefined) {
      dh += '<div class="row"><span>\u6700\u5927 Lyapunov \u6307\u6570</span><b>' + fmt(S.analysis.lyapunov, 4) + '</b></div>';
      dh += '<div class="muted">' + (S.analysis.lyapunov > 0.01
        ? '\u6B63\u503C\uFF1A\u76F8\u90BB\u72B6\u6001\u6307\u6570\u5206\u79BB\u2014\u2014\u5BF9\u521D\u503C\u654F\u611F\u4F9D\u8D56'
        : '\u8FD1\u4F3C\u4E3A\u96F6\uFF1A\u76F8\u90BB\u72B6\u6001\u4E0D\u88AB\u62C9\u5F00\uFF08\u975E\u6DF7\u6C8C\uFF09') + '</div>';
    }
    // 三维相流：云团被拉成什么形状（主半轴之比就是三个方向的拉伸因子）
    if (S.dim === 3 && S.ensF && S.flow3d.initialStats) {
      var pts = [];
      var cnt = S.ensF.count, st3 = Math.floor(S.curF);
      for (var pi = 0; pi < cnt; pi++) {
        pts.push(Float64Array.of(
          S.ensF.x[(st3 * cnt + pi) * 3], S.ensF.x[(st3 * cnt + pi) * 3 + 1], S.ensF.x[(st3 * cnt + pi) * 3 + 2]
        ));
      }
      if (pts.length) {
        var cs = PH.cloudStats(pts);
        var i0 = S.flow3d.initialStats;
        var ratio = cs.axes.map(function (v, ii) { return i0.axes[ii] > 1e-12 ? v / i0.axes[ii] : NaN; });
        dh += row('\u4E3B\u65B9\u5411\u62C9\u4F38', ratio.map(function (v) { return fmt(v, 2) + '\u00D7'; }).join(' / '));
        dh += '<div class="muted">\u4E09\u4E2A\u4E3B\u65B9\u5411\u7684\u534A\u8F74\u957F\u4E4B\u6BD4\uFF08\u5F53\u524D / \u521D\u59CB\uFF09\uFF1B' +
          '\u4E58\u79EF\u5C31\u662F\u76F8\u4F53\u79EF\u7684\u53D8\u5316\u500D\u6570\uFF08\u692D\u7403\u8FD1\u4F3C\uFF09\u3002</div>';
      }
    }
    els.dynamics.innerHTML = dh;
  }
  /** 随机模式下的读数：把"概率密度"这件抽象的东西翻译成几个可读的数 */
  function updateReadoutsRandom() {
    var r = S.mc.result;
    var h = '';
    h += row('\u6A21\u5F0F', '\u968F\u673A\u5916\u56E0\uFF08\u8499\u7279\u5361\u7F57\uFF09');
    h += row('\u5B9E\u73B0\u6B21\u6570', S.mc.done + ' / ' + S.mc.runs + (S.mc.running ? ' \u2026' : ''));
    if (r) {
      h += row('\u91C7\u6837\u70B9\u6570', r.count.toLocaleString() + ' \uFF08\u89C6\u7A97\u5185\uFF09');
      var m = r.mean, sd = r.std;
      h += row('\u5747\u503C \u00B1 \u6807\u51C6\u5DEE', fmtVec(Array.prototype.slice.call(m)) + ' \u00B1 ' + fmtVec(Array.prototype.slice.call(sd)));
      // 峰值密度位置 = "最可能待的地方"
      var best = -1, bestV = -1;
      for (var i = 0; i < r.dens.length; i++) if (r.dens[i] > bestV) { bestV = r.dens[i]; best = i; }
      if (best >= 0 && bestV > 0) {
        var ix = best % r.nx, iy = Math.floor(best / r.nx);
        var cx = r.bounds[0][0] + (r.bounds[0][1] - r.bounds[0][0]) * (ix + 0.5) / r.nx;
        var cy = r.bounds[1][0] + (r.bounds[1][1] - r.bounds[1][0]) * (iy + 0.5) / r.ny;
        h += row('\u6700\u53EF\u80FD\u505C\u7559\u5904', (r.dim >= 2 ? '[' + fmt(cx) + ', ' + fmt(cy) + ']' : '[' + fmt(cx) + ']'));
      }
      // 高概率区占视窗面积的比例（密度 > 峰值的 10%）
      var hi = 0;
      for (var k = 0; k < r.dens.length; k++) if (r.dens[k] > bestV * 0.1) hi++;
      h += row('\u9AD8\u6982\u7387\u533A\u5360\u6BD4', (hi / r.dens.length * 100).toFixed(1) + '%');
      h += row('\u8017\u65F6', S.mc.ms.toFixed(0) + ' ms\uFF08\u79CD\u5B50 ' + S.mc.seed + '\uFF09');
    }
    els.readout.innerHTML = h;

    els.structure.innerHTML = '<div class="muted">\u968F\u673A\u5916\u56E0\u4E0B\uFF0C\u4E0D\u52A8\u70B9\u4E0E\u6781\u9650\u73AF\u4E0D\u518D\u662F\u5168\u90E8\u6545\u4E8B\uFF1A</div>' +
      '<div class="muted">\u540C\u4E00\u4E2A\u521D\u59CB\u72B6\u6001\u6BCF\u6B21\u8D70\u51FA\u4E0D\u540C\u8F68\u8FF9\uFF0C\u80FD\u95EE\u7684\u662F\u201C\u5B83\u5728\u54EA\u513F\u5F85\u5F97\u4E45\u201D\u3002</div>';

    // 频谱：输入谱与响应谱对照
    var d = '';
    if (S.mc.psdResp) {
      var pk = 1;
      for (var q = 2; q < S.mc.psdResp.psd.length; q++) if (S.mc.psdResp.psd[q] > S.mc.psdResp.psd[pk]) pk = q;
      d += row('\u54CD\u5E94\u8C31\u5CF0\u503C\u9891\u7387', fmt(S.mc.psdResp.freq[pk]) + ' rad/s');
      var mark = naturalFreq();
      if (mark > 0) d += row('\u56FA\u6709\u9891\u7387 \u03C9\u2080', fmt(mark) + ' rad/s\uFF08\u5BF9\u7167\uFF09');
      d += '<div class="muted">\u54CD\u5E94\u8C31 = \u8F93\u5165\u8C31 \u00D7 \u7CFB\u7EDF\u7684 |H(\u03C9)|\u00B2\uFF1A' +
        '\u5728\u56FA\u6709\u9891\u7387\u9644\u8FD1\u9F13\u8D77\u7684\u90A3\u4E00\u5757\uFF0C\u5C31\u662F\u201C\u54EA\u4E9B\u9891\u7387\u5360\u5F97\u591A\u201D\u3002</div>';
    }
    els.dynamics.innerHTML = d;
  }
  function boundaryOf(ens, step) {
    var out = [];
    var dim = ens.dim, count = ens.count, bc = S.ensBoundaryCount;
    for (var i = count - bc; i < count; i++) {
      out.push([ens.x[(step * count + i) * dim], ens.x[(step * count + i) * dim + 1]]);
    }
    return out;
  }
  function row(k, v) { return '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>'; }

  function renderErrors(errors) {
    if (!errors.length) { els.errors.innerHTML = ''; els.errors.classList.remove('show'); return; }
    var h = '<div class="errtitle">\u65B9\u7A0B\u6709 ' + errors.length + ' \u5904\u95EE\u9898\uFF08\u4FDD\u7559\u4E0A\u4E00\u4E2A\u53EF\u7528\u76F8\u56FE\uFF09</div>';
    errors.slice(0, 6).forEach(function (e) {
      h += '<div class="errline"><span class="pos">\u7B2C ' + e.line + ' \u884C:' + e.col + '</span>' + escapeHtml(e.message) + '</div>';
    });
    h += '<div class="errhint">\u63D0\u793A\uFF1A\u70B9\u4E0B\u9762\u7684\u9519\u8BEF\u884C\u53EF\u4EE5\u76F4\u63A5\u8DF3\u5230\u7F16\u8F91\u5668\u91CC\u90A3\u4E00\u884C\u3002</div>';
    els.errors.innerHTML = h;
    els.errors.classList.add('show');
    // 错误行可以直接点：把光标定位到出问题的那一行（写方程时最烦的就是找哪一行错了）
    var lines = [].slice.call(els.errors.querySelectorAll('.errline'));
    lines.forEach(function (el, i) {
      var e = errors[i];
      if (!e) return;
      el.setAttribute('data-line', String(e.line));
      el.addEventListener('click', function () { focusEditorLine(e.line, e.col); });
    });
  }
  /** 把编辑器光标放到第 line 行第 col 列（并滚动过去） */
  function focusEditorLine(line, col) {
    var ed = els.editor;
    if (!ed || ed.value === undefined) return;
    var rows = String(ed.value).split('\n');
    var start = 0;
    for (var i = 0; i < Math.min(line - 1, rows.length); i++) start += rows[i].length + 1;
    var end = start + (rows[line - 1] !== undefined ? rows[line - 1].length : 0);
    if (ed.focus) ed.focus();
    if (ed.setSelectionRange) ed.setSelectionRange(start, end);
    // 估算行高，把这一行滚到可见区域（textarea 没有 scrollIntoView）
    if (ed.scrollTop !== undefined) {
      var lh = 18;
      ed.scrollTop = Math.max(0, (line - 3) * lh);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
  }

  function renderParams() {
    var c = S.compiled;
    var h = '';
    if (!c.paramNames.length) h = '<div class="muted">\u6CA1\u6709\u53C2\u6570\uFF08\u53EF\u5728\u65B9\u7A0B\u91CC\u5199 a = 1 \u8FD9\u6837\u7684\u884C\uFF09</div>';
    var derivedNames = [];
    c.paramNames.forEach(function (n) {
      var v = S.paramValues[n];
      // 派生量（如 w0 = sqrt(k/m)）不给滑杆：它不由使用者直接决定，而是跟着 k、m 走。
      // 以前给它装了滑杆，拖它既奇怪又掩盖了"派生值根本没重算"这个真 bug。
      if (c.paramDerived && c.paramDerived[n]) {
        derivedNames.push(n);
        h += '<div class="prow prod"><label>' + escapeHtml(n) + '</label>' +
          '<span class="derivedval" data-derived="' + escapeHtml(n) + '">' + fmt(v, 4) + '</span>' +
          '<span class="palhint">\u63A8\u5BFC\u91CF\uFF08\u8DDF\u7740\u4E0A\u9762\u7684\u53C2\u6570\u81EA\u52A8\u53D8\uFF09</span></div>';
        return;
      }
      var span = Math.max(1, Math.abs(v) * 2);
      var lo = v - span, hi = v + span;
      var step = span / 100;
      h += '<div class="prow"><label>' + escapeHtml(n) + '</label>' +
        '<input type="range" data-param="' + escapeHtml(n) + '" min="' + lo + '" max="' + hi + '" step="' + step + '" value="' + v + '">' +
        '<input type="number" data-paramnum="' + escapeHtml(n) + '" step="' + step + '" value="' + v + '">' +
        '</div>';
    });
    els.params.innerHTML = h;
    void derivedNames;
  }
  /** 基础参数一动，把派生量的读数刷新（不重建面板：重建会打断滑杆的拖动） */
  function updateDerivedReadouts() {
    if (!els.params || !S.compiled || !S.compiled.evalParams) return;
    var rows = els.params.querySelectorAll ? els.params.querySelectorAll('[data-derived]') : [];
    if (!rows.length) return;
    var vals = S.compiled.evalParams(S.paramValues);
    [].forEach.call(rows, function (el) {
      var n = el.getAttribute('data-derived');
      if (vals[n] !== undefined) {
        el.textContent = fmt(vals[n], 4);
        S.paramValues[n] = vals[n];        // 读数与系统用的值保持一致
      }
    });
  }

  function renderInitControls() {
    var h = '';
    for (var i = 0; i < S.dim; i++) {
      var b = S.bounds[i] || [-5, 5];
      h += '<div class="prow"><label>' + escapeHtml(S.system.varNames[i]) + '</label>' +
        '<input type="range" data-init="' + i + '" min="' + b[0] + '" max="' + b[1] + '" step="' + ((b[1] - b[0]) / 400) + '" value="' + S.init[i] + '">' +
        '<input type="number" data-initnum="' + i + '" step="' + ((b[1] - b[0]) / 400) + '" value="' + fmt(S.init[i], 4) + '">' +
        '</div>';
    }
    els.initBox.innerHTML = h;
  }
  function renderInitValues() {
    [].forEach.call(els.initBox.querySelectorAll('input[data-init]'), function (el) {
      el.value = S.init[+el.getAttribute('data-init')];
    });
    [].forEach.call(els.initBox.querySelectorAll('input[data-initnum]'), function (el) {
      el.value = fmt(S.init[+el.getAttribute('data-initnum')], 4);
    });
  }

  function renderDimTabs() {
    [].forEach.call(els.dimTabs.querySelectorAll('button'), function (b) {
      var d = +b.getAttribute('data-dim');
      b.classList.toggle('active', d === S.dim);
      b.title = d === S.dim ? '\u5F53\u524D\u65B9\u7A0B\u5C31\u662F ' + d + ' \u7EF4' : '\u5207\u6362\u5230 ' + d + ' \u7EF4\u65B9\u7A0B';
    });
    els.dimNote.innerHTML = '\u5F53\u524D\u65B9\u7A0B\u542B <b>' + S.dim + '</b> \u4E2A\u5FAE\u5206\u65B9\u7A0B\uFF08' +
      S.system.varNames.join(', ') + '\uFF09\u2192 \u76F8\u7A7A\u95F4 ' + S.dim + ' \u7EF4' +
      (S.compiled.usesTime ? ' <span class="tag warn">\u975E\u81EA\u6CBB\uFF1A\u542B t</span>' : '');
    // 三维相流工具只在三维视图里出现（二维里它没有可框的东西，白占左栏）
    if (els.flow3dPanel) els.flow3dPanel.classList.toggle('show', S.dim === 3);
  }

  /**
   * 方程回显：写成**学生手写的微分方程形式**，而不是代码。
   *   dθ       dω
   *   ── = ω   ── = -(g/L)·sin θ
   *   dt       dt
   * 变量名里的 theta/omega/… 在显示时换成希腊字母（源码里写 ASCII 也能看得舒服），
   * `*` 显示成 `·`，`^2` 显示成上标。改的是"怎么显示"，不改解析与求值。
   */
  var GREEK = {
    theta: '\u03B8', omega: '\u03C9', mu: '\u03BC', zeta: '\u03B6', alpha: '\u03B1',
    beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', sigma: '\u03C3', rho: '\u03C1',
    phi: '\u03C6', psi: '\u03C8', lambda: '\u03BB', tau: '\u03C4', epsilon: '\u03B5',
    xi: '\u03BE', eta: '\u03B7', kappa: '\u03BA', nu: '\u03BD', Omega: '\u03A9'
  };
  function greekName(n) { return GREEK[n] || n; }
  /**
   * 时间导数的显示：点号写法（ẋ / θ̇ / ẍ）——学生与教材都这么写，也正是人系统给的参考图里的写法。
   *
   * 实现上**不用 Unicode 组合点**（x + U+0307）：组合点在部分字体里会飘位甚至不显示，
   * 而 v、θ、ω 这些字母根本没有预组合字符可用。这里改成"字母 + 一个用 CSS 定位在上方的点"，
   * 渲染在哪个字体下都一致。RHS 里的代换（v → ẋ）先插入标记字符，转义之后再变成标记语言。
   */
  var DOT_MARK = '\u0001';
  function dotHtml(name, order) {
    var dots = order === 2 ? '\u00B7\u00B7' : '\u00B7';
    return '<span class="dv">' + escapeHtml(greekName(name)) +
      '<span class="' + (order === 2 ? 'dvdot2' : 'dvdot') + '">' + dots + '</span></span>';
  }
  function dotMark(name) { return DOT_MARK + name + DOT_MARK; }
  function marksToHtml(s) {
    return String(s).replace(new RegExp(DOT_MARK + '([^' + DOT_MARK + ']*)' + DOT_MARK, 'g'),
      '<span class="dv">$1<span class="dvdot">\u00B7</span></span>');
  }
  function mathText(t, aliases) {
    var s = escapeHtml(String(t));
    // 显示别名：路面速度 xV(t) 写成 ẋ(t) —— 悬挂方程就该读成 mÿ + cẏ + ky = cẋ + kx
    if (aliases) {
      Object.keys(aliases).forEach(function (k) {
        var esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp('(^|[^A-Za-z0-9_])' + esc + '(?![A-Za-z0-9_])', 'g'),
          function (m, pre) { return pre + aliases[k]; });
      });
    }
    s = s.replace(/\*/g, ' \u00B7 ')
      .replace(/\^2\b/g, '\u00B2')
      .replace(/\^3\b/g, '\u00B3')
      .replace(/[A-Za-z_][A-Za-z_0-9]*/g, function (m) { return GREEK[m] || m; });
    return marksToHtml(s);
  }
  /** 显示别名表：只有当 xV 不是用户自己的状态变量/参数时，才把它显示成 ẋ */
  function displayAliases() {
    var c = S.compiled;
    if (!c) return null;
    var taken = c.varNames.indexOf('xV') >= 0 || c.paramNames.indexOf('xV') >= 0;
    if (taken) return null;
    return { xV: dotMark('x') };
  }
  /** 把表达式里"独立的某个标识符"整体换成另一个写法（用于 v → ẋ 这种恒等代换） */
  function replaceIdent(text, name, replacement) {
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(^|[^A-Za-z0-9_\\u0370-\\u03FF])' + esc + '(?![A-Za-z0-9_\\u0370-\\u03FF])', 'g');
    return String(text).replace(re, function (m, pre) { return pre + replacement; });
  }
  /**
   * 方程回显。
   *
   * 两层写法都给：
   *   一阶组（计算真正用的形式）：   ẋ = v
   *   等价的二阶形式（学生写的形式）： ẍ = -ω₀²(x - y(t)) - 2ζω₀(ẋ - ẏ(t))
   * 二阶形式只在**可以严格推出**时才显示：第一行必须恰好是 `ẋ = v`（v 是第二个状态变量），
   * 此时 v ≡ ẋ 是恒等式，把第二行里的 v 换成 ẋ 就是原方程的二阶形式（不是"看起来像"）。
   * 于是 `mÿ + cẏ + ky = cẋ + kx` 这类式子会以 ẍ = … 的形式出现在左上角。
   */
  function secondOrderForm(c) {
    if (c.dim !== 2) return null;
    var v = c.varNames[1];
    var first = c.derivTexts[0];
    if (!first || first.text.trim() !== v) return null;      // 第一行必须恰好是 ẋ = v
    var body = c.derivTexts[1];
    if (!body) return null;
    var al = displayAliases();
    return {
      lhs: dotHtml(c.varNames[0], 2),
      // 关键：v ≡ ẏ，所以力表达式里的 v 要换成"**位移**的点号形式"（ẏ），
      // 而不是把 v 自己点一下（v̇ = ÿ 会与左边的 ÿ 重复，读起来自相矛盾）
      rhs: mathText(replaceIdent(body.text, v, dotMark(c.varNames[0])), al),
      vName: v
    };
  }
  function renderEquationBox() {
    var c = S.compiled;
    var h = '';
    var so = secondOrderForm(c);
    var al = displayAliases();
    c.derivTexts.forEach(function (d) {
      h += '<div class="eqline"><span class="lhs">' + dotHtml(d.name, 1) +
        '</span><span class="rhs">= ' + mathText(d.text, al) + '</span></div>';
    });
    if (so) {
      h += '<div class="eqline so"><span class="lhs">' + so.lhs +
        '</span><span class="rhs">= ' + so.rhs + '</span>' +
        '<span class="tagso">\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F</span></div>';
    }
    if (c.paramNames.length) {
      h += '<div class="eqparams">\u5DF2\u77E5\u91CF\uFF1A' + c.paramNames.map(function (n) {
        return escapeHtml(greekName(n)) + ' = ' + fmt(S.paramValues[n], 4);
      }).join('\u3001') + '</div>';
    }
    if (c.usesRandom) {
      h += '<div class="eqparams rand">\u5916\u56E0\uFF1Aroad(t) \u8DEF\u9762\u4F4D\u79FB\u3001roadV(t) \u8DEF\u9762\u901F\u5EA6\uFF08\u968F\u673A\uFF09</div>';
    }
    // 太长的行用小一号字，宁可小也别溢出（上一轮"看不到方程"就是因为固定宽度 + 不换行）
    var longest = 0;
    c.derivTexts.forEach(function (d) { longest = Math.max(longest, d.text.length); });
    if (so) longest = Math.max(longest, so.rhs.length);
    els.insetEq.className = longest > 34 ? 'long' : '';
    els.insetEq.innerHTML = h;
  }

  /**
   * 整段模板：写方程最费劲的是"开头那两行"，所以给几个能直接跑起来的骨架。
   * 每个模板都写成学生手写的形式（dθ/dt），并且保证解析器认得。
   */
  var TEMPLATES = {
    decay: '# \u4E00\u7EF4\u76F8\u7A7A\u95F4\uFF1A\u53EA\u7528\u4E00\u4E2A\u5C5E\u6027\u63A8\u51FA\u672A\u6765\nk = 1\ndx/dt = -k*x',
    logistic: '# \u6709\u9650\u8D44\u6E90\u4E0B\u7684\u79CD\u7FA4\u589E\u957F\nr = 1.2\nK = 1\ndx/dt = r*x*(1 - x/K)',
    cusp: '# \u53CC\u7A33\u6001\uFF1A\u4E24\u4E2A\u7A33\u5B9A\u6001\u88AB\u4E00\u4E2A\u4E0D\u7A33\u5B9A\u6001\u5206\u5F00\na = 1\nb = 1\ndx/dt = a*x - b*x^3',
    osc: '# \u7B80\u8C10\u632F\u5B50\uFF1A\u72B6\u6001\u662F (\u4F4D\u79FB x, \u901F\u5EA6 v)\nw = 1\ndx/dt = v\ndv/dt = -w^2*x',
    pendulum: '# \u5355\u6446\uFF1A\u72B6\u6001\u662F (\u89D2\u5EA6 \u03B8, \u89D2\u901F\u5EA6 \u03C9)\ng = 9.8\nL = 1\nd\u03B8/dt = \u03C9\nd\u03C9/dt = -(g/L)*sin(\u03B8)',
    damped: '# \u963B\u5C3C\u5355\u6446\uFF1A\u76F8\u4F53\u79EF\u88AB\u538B\u7F29\uFF0C\u8F68\u8FF9\u5411\u4E0B\u6C89\ng = 9.8\nL = 1\nb = 0.5\nd\u03B8/dt = \u03C9\nd\u03C9/dt = -(g/L)*sin(\u03B8) - b*\u03C9',
    vdp: '# \u8303\u5FB7\u6CE2\u5C14\uFF1A\u4E0D\u7BA1\u4ECE\u54EA\u91CC\u51FA\u53D1\u90FD\u5377\u5165\u540C\u4E00\u4E2A\u6781\u9650\u73AF\nmu = 1.2\ndx/dt = v\ndv/dt = mu*(1 - x^2)*v - x',
    lv: '# \u6355\u98DF\u2014\u88AB\u6355\u98DF\uFF1A\u4E24\u4E2A\u7269\u79CD\u6570\u91CF\u5F53\u4E24\u4E2A\u5C5E\u6027\nalpha = 1.1\nbeta = 0.4\ndelta = 0.1\ngamma = 0.4\ndx/dt = alpha*x - beta*x*y\ndy/dt = delta*x*y - gamma*y',
    susp: '# \u60AC\u6302\u7CFB\u7EDF\uFF08\u56DB\u5206\u4E4B\u4E00\u8F66\u8F86\uFF09\uFF1A m*y\'\' + c*y\' + k*y = c*x\' + k*x\n#   y = \u60AC\u6302\u9876\u90E8\uFF08\u8F66\u8EAB\uFF09\u7EB5\u5411\u4F4D\u79FB\uFF1B x = \u8DEF\u9762\u7EB5\u5411\u4F4D\u79FB\uFF08\u968F\u673A\uFF09\n#   \u53EF\u8C03\u53C2\u6570\u53EA\u6709 m\u3001c\u3001k\nm = 240\nc = 1200\nk = 16000\ndy/dt = v\ndv/dt = -(k/m)*(y - x(t)) - (c/m)*(v - xV(t))',
    lorenz: '# \u4E09\u4E2A\u5C5E\u6027 \u2192 \u4E09\u7EF4\u76F8\u7A7A\u95F4\nsigma = 10\nrho = 28\nbeta = 2.6666667\ndx/dt = sigma*(y - x)\ndy/dt = x*(rho - z) - y\ndz/dt = x*y - beta*z'
  };

  function renderPresets() {
    var dims = [1, 2, 3];
    var names = { 1: '\u4E00\u7EF4\u76F8\u7A7A\u95F4', 2: '\u4E8C\u7EF4\u76F8\u7A7A\u95F4\uFF08\u76F8\u5E73\u9762\uFF09', 3: '\u4E09\u7EF4\u76F8\u7A7A\u95F4' };
    var h = '';
    dims.forEach(function (d) {
      h += '<optgroup label="' + names[d] + '">';
      PRE.byDim(d).forEach(function (p) {
        h += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
      });
      h += '</optgroup>';
    });
    els.presetSelect.innerHTML = h;
  }

  function loadPreset(id) {
    var p = PRE.byId(id);
    if (!p) return;
    S.presetId = id;
    S.paramValues = {};
    els.editor.value = p.source;
    applySource(p.source, { resetParams: true, bounds: p.bounds, init: p.init, hardReset: true });
    S.presetId = id;
    els.presetSelect.value = id;
    // 预设自带激励谱（路面等）→ 直接搬进随机面板；并自动切到随机模式
    if (p.random) {
      S.randSpec.kind = p.random.kind || 'band';
      S.randSpec.wMin = p.random.wMin === undefined ? 0.5 : p.random.wMin;
      S.randSpec.wMax = p.random.wMax === undefined ? 20 : p.random.wMax;
      S.randSpec.intensity = p.random.intensity === undefined ? 0.02 : p.random.intensity;
      S.randSpec.components = p.random.components === undefined ? 64 : p.random.components;
      syncRandControls();
      // 含随机外因的预设**默认停在确定性模式**：先让人看见一条路径。
      // 概率云是"重复 N 次"的产物，放在「随机外因」模式里按需进入。
      if (S.mode === 'random') setMode('det');
    } else if (S.mode === 'random') {
      setMode('det');
    }
    els.note.innerHTML = '<b>' + escapeHtml(p.name) + '</b>\uFF1A' + escapeHtml(p.note) +
      (p.random ? '<div class="muted">\u5F53\u524D\u663E\u793A\u7684\u662F\u201C\u56FA\u5B9A\u4E00\u6B21\u8DEF\u9762\u5B9E\u73B0\u201D\u4E0B\u7684\u4E00\u6761**\u8DEF\u5F84**\uFF08\u79CD\u5B50 ' +
        S.mc.seed + '\uFF0C\u6362\u79CD\u5B50\u5C31\u6362\u4E00\u6761\u8DEF\u9762\uFF09\uFF1B\u60F3\u770B\u505C\u7559\u6982\u7387\u4E0E\u529F\u7387\u8C31\uFF0C\u70B9\u9876\u680F\u300C\u968F\u673A\u5916\u56E0\u300D\u3002</div>' : '');
    analyzeNow();
    markDirty();
  }
  /** 把 S.randSpec 写回控件（预设切换时用） */
  function syncRandControls() {
    if (!els.randKind) return;
    els.randKind.value = S.randSpec.kind;
    els.randIntensity.value = S.randSpec.intensity;
    els.randIntensityVal.textContent = S.randSpec.intensity;
    els.randWMin.value = S.randSpec.wMin;
    els.randWMax.value = S.randSpec.wMax;
    els.randBandVal.textContent = S.randSpec.wMin + '\u2013' + S.randSpec.wMax;
    els.randComponents.value = S.randSpec.components;
    els.randCompVal.textContent = S.randSpec.components;
  }

  // ------------------------------------------------------------------ 结构分析
  var analysisTimer = null;
  function scheduleAnalysis() {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(analyzeNow, 160);
  }
  function analyzeNow() {
    if (!S.system) return;
    var t0 = performance.now();
    var grid = S.dim === 1 ? 400 : (S.dim === 2 ? 26 : 11);
    try {
      S.analysis.equilibria = PH.solveEquilibria(S.system, S.bounds, { grid: grid });
    } catch (err) {
      S.analysis.equilibria = [];
      console.warn('\u4E0D\u52A8\u70B9\u6C42\u89E3\u5931\u8D25', err);
    }
    S.analysis.ms = performance.now() - t0;
    S.analysis.limitCycle = null;
    S.analysis.lyapunov = null;
    markDirty();
  }
  function deepAnalyze() {
    if (!S.system) return;
    els.btnAnalyze.disabled = true;
    els.btnAnalyze.textContent = '\u5206\u6790\u4E2D\u2026';
    setTimeout(function () {
      try {
        if (S.dim === 2) {
          S.analysis.limitCycle = PH.detectLimitCycle(S.system, S.init, Math.max(30, S.horizon * 3), S.dt, { warmup: S.horizon * 0.5 });
        }
        var T = S.dim === 3 ? 40 : 30;
        S.analysis.lyapunov = PH.lyapunovMax(S.system, S.init, T, S.dt, { d0: 1e-8 });
      } catch (err) {
        console.warn('analyse failed', err);
      }
      els.btnAnalyze.disabled = false;
      els.btnAnalyze.textContent = '\u6DF1\u5EA6\u5206\u6790\uFF08\u6781\u9650\u73AF / Lyapunov\uFF09';
      markDirty();
    }, 20);
  }

  // ------------------------------------------------------------------ 视野
  function fitView() {
    var lo = [], hi = [];
    for (var d = 0; d < S.dim; d++) { lo.push(Infinity); hi.push(-Infinity); }
    function feed(traj) {
      if (!traj) return;
      for (var i = 0; i < traj.n; i++) {
        for (var d2 = 0; d2 < S.dim; d2++) {
          var v = traj.x[i * S.dim + d2];
          if (!isFinite(v)) continue;
          if (v < lo[d2]) lo[d2] = v;
          if (v > hi[d2]) hi[d2] = v;
        }
      }
    }
    feed(S.trajF); feed(S.trajB); feed(S.ensF); feed(S.ensB);
    var nb = [];
    for (var k = 0; k < S.dim; k++) {
      if (!isFinite(lo[k]) || hi[k] - lo[k] < 1e-9) {
        var c = isFinite(lo[k]) ? lo[k] : 0;
        nb.push([c - 1, c + 1]);
      } else {
        var m = (hi[k] - lo[k]) * 0.12;
        nb.push([lo[k] - m, hi[k] + m]);
      }
    }
    S.bounds = nb;
    renderInitControls();
    markDirty();
  }

  // ------------------------------------------------------------------ 指针交互
  function canvasPoint(e, canvas) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  /** 一维相线的屏幕↔世界换算：必须与 drawPhaseLine1D 里的 toX/toV 用同一套边距 */
  function phaseLinePad() { return { l: 56, r: 28 }; }
  function phaseLineToX(v, w) {
    var pad = phaseLinePad(), a = S.bounds[0][0], b = S.bounds[0][1];
    var x0 = pad.l, x1 = Math.max(pad.l + 1, w - pad.r);
    return x0 + (v - a) / (b - a) * (x1 - x0);
  }
  function phaseLineToV(px, w) {
    var pad = phaseLinePad(), a = S.bounds[0][0], b = S.bounds[0][1];
    var x0 = pad.l, x1 = Math.max(pad.l + 1, w - pad.r);
    return a + (px - x0) / (x1 - x0) * (b - a);
  }
  /**
   * 屏幕坐标 → 世界坐标，按维度分派。
   * 一维以前这里直接调二维的 makeView，而一维的 bounds 只有一段 [[a,b]]：
   * 读 bounds[1][0] 抛异常 → 滚轮缩放与点击在一维相空间里全都不生效（人系统报障）。
   * 一维必须走自己的换算（与相线绘制同源）。
   */
  function screenToWorld(px, py) {
    var main = fitCanvas(els.view);
    if (S.dim === 1) return [phaseLineToV(px, main.w), 0];
    if (S.dim === 3) {
      var span = spanOf(S.bounds);
      var cur = currentState();
      var depth = RD.project3(S.cam, cur[0], cur[1], cur[2], main.w, main.h, span)[2];
      return RD.unproject3(S.cam, px, py, depth, main.w, main.h, span);
    }
    var view = RD.makeView(S.bounds, main.w, main.h, { l: 56, r: 20, t: 20, b: 36 });
    return view.toWorld(px, py);
  }
  function spanOf(b) {
    return Math.max(
      b[0][1] - b[0][0],
      b[1] ? b[1][1] - b[1][0] : 1,
      b[2] ? b[2][1] - b[2][0] : 1
    ) / 2;
  }
  /** 以某个屏幕点为不动点缩放世界坐标（二维与一维共用） */
  function zoomAbout(px, py, f) {
    if (S.dim === 1) {
      var main = fitCanvas(els.view);
      var w = phaseLineToV(px, main.w);
      S.bounds = [[w + (S.bounds[0][0] - w) * f, w + (S.bounds[0][1] - w) * f]];
      return;
    }
    var w2 = screenToWorld(px, py);
    S.bounds = [
      [w2[0] + (S.bounds[0][0] - w2[0]) * f, w2[0] + (S.bounds[0][1] - w2[0]) * f],
      [w2[1] + (S.bounds[1][0] - w2[1]) * f, w2[1] + (S.bounds[1][1] - w2[1]) * f]
    ];
  }
  function panBy(dxPx, dyPx) {
    var main = fitCanvas(els.view);
    if (S.dim === 3) {
      S.cam.panX = (S.cam.panX || 0) + dxPx;
      S.cam.panY = (S.cam.panY || 0) + dyPx;
      return;
    }
    if (S.dim === 1) {
      var pad = phaseLinePad();
      var iw1 = Math.max(1, main.w - pad.l - pad.r);
      var dx1 = dxPx * (S.bounds[0][1] - S.bounds[0][0]) / iw1;
      S.bounds = [[S.bounds[0][0] - dx1, S.bounds[0][1] - dx1]];
      return;
    }
    var iw = Math.max(1, main.w - 76), ih = Math.max(1, main.h - 56);
    var dx = dxPx * (S.bounds[0][1] - S.bounds[0][0]) / iw;
    var dy = dyPx * (S.bounds[1][1] - S.bounds[1][0]) / ih;
    S.bounds = [
      [S.bounds[0][0] - dx, S.bounds[0][1] - dx],
      [S.bounds[1][0] + dy, S.bounds[1][1] + dy]
    ];
  }
  function onPointerDown(e) {
    var p = canvasPoint(e, els.view);
    var isPan = e.shiftKey || e.button === 1;
    if (isPan) {
      S.dragging = { mode: 'pan', start: p, last: p, moved: 0 };
    } else if (S.dim === 3) {
      S.dragging = { mode: 'rotate', start: p, last: p, moved: 0, yaw: S.cam.yaw, pitch: S.cam.pitch };
    } else {
      S.dragging = { mode: 'decide', start: p, cur: p, moved: 0 };
    }
    if (els.view.setPointerCapture) { try { els.view.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有真实指针 */ } }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!S.dragging) return;
    var p = canvasPoint(e, els.view);
    var d = S.dragging;
    d.moved = Math.max(d.moved, Math.hypot(p.x - d.start.x, p.y - d.start.y));
    if (d.mode === 'rotate') {
      S.cam.yaw = d.yaw + (p.x - d.start.x) * 0.01;
      S.cam.pitch = clamp(d.pitch + (p.y - d.start.y) * 0.01, -1.4, 1.4);
      d.last = p;
      markDirty();
    } else if (d.mode === 'pan') {
      panBy(p.x - d.last.x, p.y - d.last.y);
      d.last = p;
      markDirty();   // 初值滑杆的范围要等松手后再重建：拖动中每帧重建 DOM 没必要
    } else if (d.mode === 'decide') {
      if (d.moved > 6 && S.dim === 2) d.mode = 'region';
      d.cur = p;
      markDirty();
    } else if (d.mode === 'region') {
      d.cur = p;
      markDirty();
    }
  }
  function onPointerUp(e) {
    var d = S.dragging;
    S.dragging = null;
    if (!d) return;
    var p = canvasPoint(e, els.view);
    if (d.mode === 'decide' && d.moved <= 6) {
      placeStateAt(p);
    } else if (d.mode === 'region') {
      var x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x);
      var y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
      if (x1 - x0 > 8 && y1 - y0 > 8) {
        var a = screenToWorld(x0, y1), b = screenToWorld(x1, y0);
        rebuildEnsemble([[Math.min(a[0], b[0]), Math.max(a[0], b[0])], [Math.min(a[1], b[1]), Math.max(a[1], b[1])]], 'region');
        els.flowNote.textContent = '\u76F8\u6D41\u533A\u57DF\uFF1A' + fmt(S.ensBounds[0][0], 2) + '\u2264' + S.system.varNames[0] + '\u2264' + fmt(S.ensBounds[0][1], 2) +
          '\uFF0C' + fmt(S.ensBounds[1][0], 2) + '\u2264' + S.system.varNames[1] + '\u2264' + fmt(S.ensBounds[1][1], 2) +
          '\uFF08' + (S.ensF.count - S.ensBoundaryCount) + ' \u4E2A\u5185\u90E8\u72B6\u6001 + ' + S.ensBoundaryCount + ' \u4E2A\u8FB9\u754C\u72B6\u6001\uFF09';
      }
    } else if (d.mode === 'pan') {
      // 平移只搬画面：视窗变了，所以重算一次结构；但**不碰时间**
      renderInitControls();
      scheduleAnalysis();
    }
    // 这里曾经无条件调用 resetPlayback()：于是平移、旋转、框选一松手，时间就回到 t=0，
    // 已经演化出来的轨迹与相流整个作废（人系统实测报障："拖拽后可视画面会重置"）。
    // 时间位置是使用者的，视图操作不该动它；只有 placeStateAt（换了初始状态）才回到 0。
    markDirty();
  }
  function placeStateAt(p) {
    if (S.dim === 3) {
      // 三维：在与当前状态等深的平面上取点（反投影），定义明确、可复现
      S.init = Float64Array.from(screenToWorld(p.x, p.y));
    } else if (S.dim === 1) {
      S.init = Float64Array.of(screenToWorld(p.x, p.y)[0]);
    } else {
      S.init = Float64Array.from(screenToWorld(p.x, p.y));
    }
    // 换了初始状态：时间必须回到 0（这是另一条轨迹的起点），
    // 但"正在播放"这件事不打断 —— 于是可以一边放着一边点来点去比较不同初值
    var wasPlaying = S.playing;
    S.branch = 'f';
    rebuildTrajectories();
    restoreTime(0, wasPlaying);
    renderInitValues();
    scheduleAnalysis();
    if (S.mode === 'random' && S.mc.result) { /* 旧的密度图对应旧初值，提示重跑 */ els.mcNote.innerHTML = '\u521D\u59CB\u72B6\u6001\u5DF2\u6539\uFF1A\u70B9\u201C\u5F00\u59CB\u6A21\u62DF\u201D\u91CD\u65B0\u7EDF\u8BA1\u3002'; }
    markDirty();
  }
  function onWheel(e) {
    e.preventDefault();
    var p = canvasPoint(e, els.view);
    var f = Math.pow(1.0016, e.deltaY);
    if (S.dim === 3) {
      // 三维是正交投影，缩放只改比例，不牵扯坐标范围
      S.cam.scale = clamp(S.cam.scale / f, 0.15, 12);
    } else {
      zoomAbout(p.x, p.y, f);
      renderInitControls();
    }
    markDirty();
  }
  function resetView() {
    S.cam = RD.makeCamera({ center: S.cam.center.slice(), yaw: S.cam.yaw, pitch: S.cam.pitch });
    S.cam.scale = 1;
    var p = S.presetId ? PRE.byId(S.presetId) : null;
    S.bounds = p ? cloneBounds(p.bounds) : defaultBounds(S.dim);
    renderInitControls();
    markDirty();
  }

  // ------------------------------------------------------------------ 播放按钮
  function updatePlayButtons() {
    els.btnPlayF.classList.toggle('on', S.playing === 'f');
    els.btnPlayB.classList.toggle('on', S.playing === 'b');
    els.btnPlayF.textContent = S.playing === 'f' ? '\u23F8 \u6B63\u5411\u6F14\u5316' : '\u25B6 \u6B63\u5411\u6F14\u5316 (t\u2191)';
    els.btnPlayB.textContent = S.playing === 'b' ? '\u23F8 \u53CD\u5411\u56DE\u6EAF' : '\u25C0 \u53CD\u5411\u56DE\u6EAF (t\u2193)';
  }

  // ------------------------------------------------------------------ 事件绑定
  function bind() {
    var editorTimer = null;
    els.editor.addEventListener('input', function () {
      if (editorTimer) clearTimeout(editorTimer);
      editorTimer = setTimeout(function () {
        if (applySource(els.editor.value, {})) {
          var p = PRE.list.filter(function (x) { return x.source === els.editor.value; })[0];
          els.note.innerHTML = p ? '<b>' + escapeHtml(p.name) + '</b>\uFF1A' + escapeHtml(p.note)
            : '\u81EA\u5B9A\u4E49\u65B9\u7A0B\uFF1A\u76F8\u7A7A\u95F4\u7EF4\u5EA6\u3001\u5411\u91CF\u573A\u3001\u4E0D\u52A8\u70B9\u5DF2\u6309\u65B0\u65B9\u7A0B\u91CD\u7B97';
          if (p) { S.presetId = p.id; els.presetSelect.value = p.id; }
          analyzeNow();
        }
      }, 320);
    });
    els.applyBtn.addEventListener('click', function () {
      if (applySource(els.editor.value, {})) analyzeNow();
    });
    els.presetSelect.addEventListener('change', function () { loadPreset(els.presetSelect.value); });

    [].forEach.call(els.dimTabs.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        var d = +b.getAttribute('data-dim');
        if (d === S.dim) return;
        var src = S.draftByDim[d];
        if (!src) {
          var first = PRE.byDim(d)[0];
          loadPreset(first.id);
          return;
        }
        els.editor.value = src;
        applySource(src, {});
        var p = PRE.list.filter(function (x) { return x.source === src; })[0];
        if (p) { S.presetId = p.id; els.presetSelect.value = p.id; els.note.innerHTML = '<b>' + escapeHtml(p.name) + '</b>\uFF1A' + escapeHtml(p.note); }
        analyzeNow();
      });
    });

    els.params.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var name = t.getAttribute('data-param') || t.getAttribute('data-paramnum');
      if (!name) return;
      var v = parseFloat(t.value);
      if (!isFinite(v)) return;
      S.paramValues[name] = v;
      refreshSystem();
      // 拖参数滑杆也不该把画面冲回 t=0：向量场变了、轨迹要重算，但**时刻留在原处**，
      // 播放也不打断 —— 这样才能一边放着一边看参数如何重塑整张相图
      keepTime(function () {
        if (S.ensBounds) rebuildEnsemble(S.ensBounds, S.ensSeedMode);
        rebuildTrajectories();
      });
      markDirty();
      updateParamNumbers(name, v);
      updateDerivedReadouts();
    });
    els.params.addEventListener('change', function () { scheduleAnalysis(); });

    els.initBox.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var idx = t.getAttribute('data-init') !== null ? t.getAttribute('data-init') : t.getAttribute('data-initnum');
      if (idx === null) return;
      var v = parseFloat(t.value);
      if (!isFinite(v)) return;
      S.init[+idx] = v;
      var wasPlaying = S.playing;
      rebuildTrajectories();
      restoreTime(0, wasPlaying);     // 换了初值 → 回到起点，但不打断播放
      markDirty();
      renderInitValues();
    });
    els.initBox.addEventListener('change', function () { scheduleAnalysis(); });

    els.view.addEventListener('pointerdown', onPointerDown);
    els.view.addEventListener('pointermove', onPointerMove);
    els.view.addEventListener('pointerup', onPointerUp);
    els.view.addEventListener('pointercancel', function () { S.dragging = null; markDirty(); });
    els.view.addEventListener('wheel', onWheel, { passive: false });
    els.view.addEventListener('dblclick', resetView);
    window.addEventListener('resize', markDirty);

    els.btnPlayF.addEventListener('click', function () {
      if (S.playing === 'f') { S.playing = null; } else { S.playing = 'f'; S.branch = 'f'; if (S.curF >= S.trajF.n - 1) S.curF = 0; }
      updatePlayButtons(); markDirty();
    });
    els.btnPlayB.addEventListener('click', function () {
      if (S.playing === 'b') { S.playing = null; } else { S.playing = 'b'; S.branch = 'b'; if (S.curB >= S.trajB.n - 1) S.curB = 0; }
      updatePlayButtons(); markDirty();
    });
    els.btnStop.addEventListener('click', function () { S.branch = 'f'; resetPlayback(); markDirty(); });
    els.btnStepF.addEventListener('click', function () { S.branch = 'f'; S.curF = Math.min(S.trajF.n - 1, Math.floor(S.curF) + 1); markDirty(); });
    els.btnStepB.addEventListener('click', function () { S.branch = 'b'; S.curB = Math.min(S.trajB.n - 1, Math.floor(S.curB) + 1); markDirty(); });
    els.speed.addEventListener('input', function () { S.speed = parseFloat(els.speed.value); els.speedVal.textContent = S.speed.toFixed(2) + '\u00D7'; });
    els.dtSel.addEventListener('change', function () {
      // 换采样密度只是"同一条时间轴上的分辨率变了"：把使用者所在的**时刻**搬过去，不要冲回 0
      keepTime(function () {
        S.dt = parseFloat(els.dtSel.value);
        rebuildTrajectories();
        if (S.ensBounds) rebuildEnsemble(S.ensBounds, S.ensSeedMode);
      });
      scheduleAnalysis(); markDirty();
    });
    els.methodSel.addEventListener('change', function () {
      keepTime(function () {
        S.method = els.methodSel.value;
        rebuildTrajectories();
        if (S.ensBounds) rebuildEnsemble(S.ensBounds, S.ensSeedMode);
      });
      markDirty();
    });
    els.horizon.addEventListener('input', function () {
      els.horizonVal.textContent = S.horizon.toFixed(0);
      keepTime(function () {
        S.horizon = parseFloat(els.horizon.value);
        rebuildTrajectories();
        if (S.ensBounds) rebuildEnsemble(S.ensBounds, S.ensSeedMode);
      });
      markDirty();
    });

    [
      ['tgField', 'field'], ['tgNull', 'nullcline'], ['tgEq', 'equilibria'], ['tgGrid', 'grid'],
      ['tgTrail', 'trail'], ['tgBack', 'backward'], ['tgFlow', 'flow'], ['tgLabels', 'labels']
    ].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.checked = S.opts[pair[1]];
      el.addEventListener('change', function () { S.opts[pair[1]] = el.checked; markDirty(); });
    });

    // ---------------------------------------------------------- 模式切换：确定性 / 随机外因
    els.modeDet.addEventListener('click', function () { setMode('det'); });
    els.modeRandom.addEventListener('click', function () { setMode('random'); });
    // 随机谱参数
    function readRandSpec() {
      S.randSpec.kind = els.randKind.value;
      S.randSpec.intensity = parseFloat(els.randIntensity.value);
      S.randSpec.wMin = parseFloat(els.randWMin.value);
      S.randSpec.wMax = parseFloat(els.randWMax.value);
      S.randSpec.components = parseInt(els.randComponents.value, 10);
      els.randIntensityVal.textContent = S.randSpec.intensity;
      els.randBandVal.textContent = S.randSpec.wMin + '\u2013' + S.randSpec.wMax;
      els.randCompVal.textContent = S.randSpec.components;
      markDirty();
    }
    [els.randKind, els.randIntensity, els.randWMin, els.randWMax, els.randComponents].forEach(function (el) {
      el.addEventListener('input', readRandSpec);
      el.addEventListener('change', readRandSpec);
    });
    [els.mcRuns, els.mcTMax].forEach(function (el) {
      el.addEventListener('input', function () {
        S.mc.runs = parseInt(els.mcRuns.value, 10);
        S.mc.tMax = parseFloat(els.mcTMax.value);
        els.mcRunsVal.textContent = S.mc.runs;
        els.mcTMaxVal.textContent = S.mc.tMax;
      });
    });
    els.mcSeed.addEventListener('change', function () { S.mc.seed = parseInt(els.mcSeed.value, 10) || 1; });
    els.btnMcSeed.addEventListener('click', function () {
      S.mc.seed = (S.mc.seed * 1103515245 + 12345) % 2147483647;
      els.mcSeed.value = S.mc.seed;
      if (S.mode === 'random') startMonteCarlo();
    });
    els.btnMC.addEventListener('click', startMonteCarlo);
    if (els.mcPathsOnly) {
      els.mcPathsOnly.addEventListener('change', function () {
        S.mc.pathsOnly = els.mcPathsOnly.checked;
        markDirty();
      });
    }

    // ---------------------------------------------------------- 三维相流工具
    els.btn3DFlow.addEventListener('click', build3DFlow);
    els.btn3DClear.addEventListener('click', function () {
      S.ensF = null; S.ensB = null; S.ensBounds = null;
      els.flowNote.textContent = '\u4E09\u7EF4\u76F8\u6D41\u5DF2\u6E05\u9664';
      markDirty();
    });
    // 方程预览已经搬到左栏，这里不再需要"放大浮层"的按钮（浮层本身也删了）
    [els.flow3dHF, els.flow3dN].forEach(function (el) {
      el.addEventListener('input', function () {
        S.flow3d.hf = parseFloat(els.flow3dHF.value);
        S.flow3d.n = parseInt(els.flow3dN.value, 10);
        els.flow3dHFVal.textContent = (S.flow3d.hf * 100).toFixed(0) + '%';
        els.flow3dNVal.textContent = S.flow3d.n + '\u00B3 = ' + Math.pow(S.flow3d.n, 3);
        if (S.ensF && S.dim === 3) build3DFlow();
        markDirty();
      });
    });
    els.flow3dCenter.addEventListener('change', function () {
      S.flow3d.centerOnInit = els.flow3dCenter.checked;
      if (S.ensF && S.dim === 3) build3DFlow();
      markDirty();
    });

    // ---------------------------------------------------------- 书写工具：符号盘 / 模板 / 快捷键
    function insertIntoEditor(text, opts) {
      opts = opts || {};
      var ed = els.editor;
      var value = ed.value === undefined ? '' : ed.value;
      var start = ed.selectionStart === undefined ? value.length : ed.selectionStart;
      var end = ed.selectionEnd === undefined ? start : ed.selectionEnd;
      var before = value.slice(0, start), after = value.slice(end);
      // 整段模板：先另起一行，插完把光标放到末尾
      if (opts.newline && before && before.charAt(before.length - 1) !== '\n') before += '\n';
      ed.value = before + text + after;
      var caret = opts.selectEnd ? ed.value.length : before.length + text.length;
      if (ed.setSelectionRange) ed.setSelectionRange(opts.selectEnd ? before.length : caret, caret);
      if (applySource(ed.value, opts.hardReset ? { hardReset: true } : {})) analyzeNow();
      if (ed.focus) ed.focus();
    }
    [].forEach.call(document.querySelectorAll ? document.querySelectorAll('.sym') : [], function (b) {
      b.addEventListener('click', function () {
        insertIntoEditor(b.getAttribute('data-ins') || '');
      });
    });
    // 整段模板：一键给出一个能跑的方程组骨架（写方程最费劲的是开头那两行）
    if (els.tplSelect) {
      els.tplSelect.addEventListener('change', function () {
        var key = els.tplSelect.value;
        els.tplSelect.value = '';
        if (!key || !TEMPLATES[key]) return;
        var t = TEMPLATES[key];
        els.editor.value = '';
        insertIntoEditor(t, { selectEnd: true, hardReset: true });
        els.note.innerHTML = '<b>' + escapeHtml(key) + '</b>' +
          '\uFF1A\u5DF2\u63D2\u5165\u6A21\u677F\uFF0C\u53EF\u76F4\u63A5\u6539\u91CC\u9762\u7684\u6570\u5B57\u4E0E\u7CFB\u6570';
        markDirty();
      });
    }
    // Ctrl+Enter（macOS 上 Cmd+Enter）= 应用方程；写方程时不必离开键盘去点按钮
    els.editor.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (applySource(els.editor.value, {})) analyzeNow();
      }
    });

    els.btnFit.addEventListener('click', fitView);
    els.btnResetView.addEventListener('click', resetView);
    els.btnAnalyze.addEventListener('click', deepAnalyze);
    els.btnClearFlow.addEventListener('click', function () {
      S.ensF = null; S.ensB = null; S.ensBounds = null;
      els.flowNote.textContent = '\u5728\u56FE\u4E0A\u62D6\u51FA\u4E00\u4E2A\u77E9\u5F62\uFF0C\u91CC\u9762\u7684\u6BCF\u4E00\u4E2A\u70B9\u90FD\u662F\u4E00\u4E2A\u53EF\u80FD\u7684\u521D\u59CB\u72B6\u6001';
      markDirty();
    });
    els.btnSeed3D.addEventListener('click', function () {
      rebuildEnsemble(S.bounds, 'ball');
      els.flowNote.textContent = '\u4E09\u7EF4\u76F8\u6D41\uFF1A\u4EE5\u5F53\u524D\u72B6\u6001\u4E3A\u4E2D\u5FC3\u7684 64 \u4E2A\u76F8\u90BB\u72B6\u6001\uFF0C\u770B\u5B83\u4EEC\u5982\u4F55\u88AB\u76F8\u6D41\u642C\u8FD0';
      markDirty();
    });
  }
  function updateParamNumbers(name, v) {
    [].forEach.call(els.params.querySelectorAll('input'), function (el) {
      if (el.getAttribute('data-param') === name) el.value = v;
      if (el.getAttribute('data-paramnum') === name) el.value = fmt(v, 4);
    });
  }

  // ------------------------------------------------------------------ 启动
  function boot() {
    els = {
      view: $('view'), series: $('series'), schematic: $('schematic'), legend: $('legend'),
      editor: $('editor'), errors: $('errors'), params: $('params'), applyBtn: $('applyBtn'),
      presetSelect: $('presetSelect'), dimTabs: $('dimTabs'), dimNote: $('dimNote'),
      readout: $('readout'), structure: $('structure'), dynamics: $('dynamics'), note: $('note'),
      insetEq: $('insetEq'), initBox: $('initBox'), flowNote: $('flowNote'),
      btnPlayF: $('btnPlayF'), btnPlayB: $('btnPlayB'), btnStop: $('btnStop'),
      btnStepF: $('btnStepF'), btnStepB: $('btnStepB'),
      speed: $('speed'), speedVal: $('speedVal'), dtSel: $('dtSel'), methodSel: $('methodSel'),
      horizon: $('horizon'), horizonVal: $('horizonVal'),
      btnFit: $('btnFit'), btnAnalyze: $('btnAnalyze'), btnClearFlow: $('btnClearFlow'), btnSeed3D: $('btnSeed3D'),
      btnResetView: $('btnResetView'),
      // 模式与随机外因
      modeDet: $('modeDet'), modeRandom: $('modeRandom'), mcPanel: $('mcPanel'), psdWrap: $('psdWrap'),
      psd: $('psd'), mcNote: $('mcNote'), btnMC: $('btnMC'),
      mcRuns: $('mcRuns'), mcRunsVal: $('mcRunsVal'), mcTMax: $('mcTMax'), mcTMaxVal: $('mcTMaxVal'),
      mcSeed: $('mcSeed'), btnMcSeed: $('btnMcSeed'), mcPathsOnly: $('mcPathsOnly'),
      randKind: $('randKind'), randIntensity: $('randIntensity'), randIntensityVal: $('randIntensityVal'),
      randWMin: $('randWMin'), randWMax: $('randWMax'), randBandVal: $('randBandVal'),
      randComponents: $('randComponents'), randCompVal: $('randCompVal'),
      // 三维相流
      flow3dHF: $('flow3dHF'), flow3dHFVal: $('flow3dHFVal'), flow3dN: $('flow3dN'), flow3dNVal: $('flow3dNVal'),
      flow3dCenter: $('flow3dCenter'), btn3DFlow: $('btn3DFlow'), btn3DClear: $('btn3DClear'),
      flow3dPanel: $('flow3dPanel'),
      btnEqBig: $('btnEqBig'), inset: $('inset'),
      tplSelect: $('tplSelect'),
      seriesWrap: $('seriesWrap'), psdWrap: $('psdWrap')
    };
    renderPresets();
    bind();
    var urlPreset = (location.search.match(/preset=([\w-]+)/) || [])[1];
    loadPreset(urlPreset && PRE.byId(urlPreset) ? urlPreset : 'pendulum-2d');
    updatePlayButtons();
    requestAnimationFrame(frame);
    window.addEventListener('error', function (ev) { showFatal(ev.error || ev.message); });
    // ?demo=1：自动框一片区域并开始正向演化。用途是"人一眼就能看出时间在走"——
    // 打开 http://…/?demo=1 等十秒，图上的区域已经变形、轨迹已经画出来，不需要任何操作。
    if (/demo/.test(location.search)) {
      setTimeout(function () {
        if (S.compiled && S.compiled.usesRandom) {
          // 随机外因的演示：切到随机模式并直接跑一遍蒙特卡洛，打开就能看到概率密度与频谱
          // （注意：预设**默认**停在确定性模式看路径，所以这里必须显式切过去）
          setMode('random');
          els.mcRuns.value = '60'; S.mc.runs = 60;
          els.mcTMax.value = '15'; S.mc.tMax = 15;
          startMonteCarlo();
          return;
        }
        if (S.dim === 2) {
          var c0 = (S.bounds[0][0] + S.bounds[0][1]) / 2, c1 = (S.bounds[1][0] + S.bounds[1][1]) / 2;
          var w = (S.bounds[0][1] - S.bounds[0][0]) * 0.16, h = (S.bounds[1][1] - S.bounds[1][0]) * 0.16;
          rebuildEnsemble([[S.init[0] - w, S.init[0] + w], [S.init[1] - h, S.init[1] + h]], 'region');
          els.flowNote.textContent = '\u6F14\u793A\u6A21\u5F0F\uFF1A\u5DF2\u6846\u4E00\u7247\u72B6\u6001\u533A\u57DF\uFF0C\u770B\u5B83\u88AB\u76F8\u6D41\u62C9\u6210\u4EC0\u4E48\u6837\u5B50';
        }
        void c0; void c1;
        S.playing = 'f';
        updatePlayButtons();
        markDirty();
      }, 400);
    }
    // 自检脚本可能在 boot 完成之前就跑起来（它是动态插入的 <script>），
    // 必须给外部一个明确的"已就绪"信号，否则外部读到的是半成品状态
    window.__psxReady = true;
  }
  function showFatal(err) {
    var box = $('fatal');
    if (!box) return;
    box.style.display = 'block';
    box.textContent = '\u8FD0\u884C\u65F6\u9519\u8BEF\uFF1A' + (err && err.message ? err.message : String(err));
  }

  // ------------------------------------------------------------------ 对外自检接口
  window.__psx = {
    state: S,
    getSummary: function () {
      return {
        dim: S.dim,
        varNames: S.system ? S.system.varNames : [],
        paramNames: S.compiled ? S.compiled.paramNames : [],
        t: currentTime(),
        state: Array.from(currentState()),
        init: Array.from(S.init),
        trajN: S.trajF ? S.trajF.n : 0,
        backN: S.trajB ? S.trajB.n : 0,
        ensCount: S.ensF ? S.ensF.count : 0,
        ensBoundary: S.ensBoundaryCount,
        equilibria: S.analysis.equilibria.map(function (e) { return { x: Array.from(e.x), type: e.classification.type }; }),
        bounds: S.bounds,
        errors: S.lastError ? S.lastError.length : 0,
        playing: S.playing,
        curF: S.curF, curB: S.curB,
        frame: S.frame, renderCount: S.renderCount, dirty: S.dirty,
        mode: S.mode, branch: S.branch,
        usesRandom: S.compiled ? !!S.compiled.usesRandom : false,
        hasAux: !!(S.system && S.system.aux),
        mcRuns: S.mc.done, mcTotal: S.mc.runs,
        mcCount: S.mc.result ? S.mc.result.count : 0,
        mcFingerprint: (function () {
          if (!S.mc.result) return 0;
          var d = S.mc.result.dens, s = 0;
          for (var i = 0; i < d.length; i++) s += d[i] * (i + 1);
          return s;
        })(),
        psdReady: !!S.mc.psdResp,
        pathsOnly: !!S.mc.pathsOnly
      };
    },
    setSource: function (src) { els.editor.value = src; return applySource(src, {}); },
    /** 把编辑器里现在的内容应用一次（等价于点「应用方程」或 Ctrl+Enter） */
    applyNow: function () { return applySource(els.editor.value, {}); },
    loadPreset: loadPreset,
    startPlay: function (dir) { S.playing = dir || 'f'; S.branch = dir || 'f'; updatePlayButtons(); },
    stopPlay: function () { S.playing = null; updatePlayButtons(); },
    advance: function (frames) { stepPlayback(frames || 1); },
    renderNow: function () { render(); },
    /** 跑一次"真正的帧函数体"（与 rAF 调的是同一个），供自检在不驱动 rAF 时使用 */
    frameNow: function () { frameBody(); },
    deepen: deepAnalyze,
    fitView: fitView,
    render: function () { render(); },
    canvasStats: function (canvas) {
      var c = canvas || els.view;
      var ctx = c.getContext('2d');
      var data = ctx.getImageData(0, 0, c.width, c.height).data;
      var total = c.width * c.height;
      // 底色基准 = 出现最多的那个颜色（量化到 4 位），而不是写死"暗于某值算背景"。
      // 写死阈值与配色耦合：本轮把画布底色从近黑改成家族深灰（#141719 里 r=20 就超过旧阈值 16），
      // 于是整块画布都被算成"内容"，"只画路径"与"平移后位移"两条断言随之失真。
      function keyAt(i) { return (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4); }
      var hist = {};
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= 8) continue;
        var k = keyAt(i);
        hist[k] = (hist[k] || 0) + 1;
      }
      var bgKey = null, bgCount = -1;
      for (var kk in hist) { if (hist[kk] > bgCount) { bgCount = hist[kk]; bgKey = kk; } }
      var nonBg = 0, sumY = 0, colors = {};
      for (var j = 0; j < data.length; j += 4) {
        if (data[j + 3] <= 8) continue;
        var kj = keyAt(j);
        if (kj === bgKey) continue;
        nonBg++;
        sumY += Math.floor(j / 4 / c.width);
        colors[kj] = (colors[kj] || 0) + 1;
      }
      var vivid = Object.keys(colors).filter(function (k2) { return colors[k2] > 60; }).length;
      return {
        total: total, nonBg: nonBg, ratio: nonBg / total, distinctColors: vivid,
        background: bgKey, centroidY: nonBg ? sumY / nonBg : 0
      };
    },
    els: els
  };
  // boot() 会给 els 赋上真正的 DOM 引用。若这里写成 `els: els`（值拷贝），
  // 外部拿到的永远是 boot 之前那个空对象 —— 本轮自检就是这样"永远等不到就绪"的。
  // 用取值器让外部始终看到当前的那一份。
  Object.defineProperty(window.__psx, 'els', { get: function () { return els; } });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
