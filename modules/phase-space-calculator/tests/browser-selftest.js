/**
 * browser-selftest.js —— 在真实浏览器里对"画出来的东西"做断言
 *
 * 为什么不是在 Node 里测：core 的数学已经在 tests/verify-core.mjs 里被钉死了，
 * 浏览器里剩下的风险全是"界面这一侧"的：脚本没挂上、画布是空的、点击没落到正确坐标、
 * 方程改了维度没跟着变、错误方程把上一张图弄崩了。这些只有进入那个页面才能问出来。
 *
 * 断言取材原则（与 skill 留言板一致）：只读**被作用系统自己吐出来的量**——
 * 画布的像素、DOM 的文本、应用自报的状态，而不是"我以为它做了什么"。
 *
 * 本文件刻意**不依赖 rAF 与计时器**：页面若在后台标签页打开，浏览器会把 rAF 完全停掉、
 * 把计时器降到分钟级，验收就会莫名其妙地卡住（本轮已实测踩中）。
 * 因此所有推进都走 px.advance() / px.renderNow() 这两条同步路径。
 *
 * 触发：index.html?selftest=1
 */
(function () {
  'use strict';
  var px = window.__psx;
  var results = [];

  function ok(cond, label, detail) {
    results.push({ pass: !!cond, label: label, detail: detail === undefined ? '' : String(detail) });
  }
  /** 明确记成"没验证"而不是"通过"："0 组通过"必须被读成没验证 */
  function skip(label, why) {
    results.push({ pass: true, skipped: true, label: label, detail: '\u672A\u9A8C\u8BC1\uFF1A' + why });
  }
  function eq(a, b, label) { ok(a === b, label, '\u5B9E\u6D4B ' + JSON.stringify(a) + ' \u671F\u671B ' + JSON.stringify(b)); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pointer(type, el, x, y, extra) {
    var r = el.getBoundingClientRect();
    var ev = new PointerEvent(type, Object.assign({
      clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1
    }, extra || {}));
    el.dispatchEvent(ev);
  }
  function clickAt(x, y) {
    pointer('pointerdown', px.els.view, x, y);
    pointer('pointerup', px.els.view, x, y);
  }
  function dragRect(x0, y0, x1, y1) {
    pointer('pointerdown', px.els.view, x0, y0);
    pointer('pointermove', px.els.view, (x0 + x1) / 2, (y0 + y1) / 2);
    pointer('pointermove', px.els.view, x1, y1);
    pointer('pointerup', px.els.view, x1, y1);
  }
  /** 同步渲染一次 + 让出微任务：不碰 rAF、不碰计时器 */
  function settle() { px.renderNow(); return Promise.resolve(); }

  var summary = function () { return px.getSummary(); };

  async function run() {
    // ---------------------------------------------------------- 0. 就绪
    var ready = false;
    for (var i = 0; i < 400 && !ready; i++) {
      ready = !!(window.__psxReady && px && px.els && px.els.view);
      if (!ready) await wait(25);
    }
    ok(ready, '\u5E94\u7528\u5DF2\u5B8C\u6210\u88C5\u914D\uFF08__psxReady \u4E14 els.view \u5B58\u5728\uFF09');
    if (!ready) { finish(); return; }

    // ---------------------------------------------------------- 1. 装配
    ok(!!window.PSExpr && !!window.PSPhase && !!window.PSRender && !!window.PSPresets,
      '\u56DB\u4E2A\u6A21\u5757\u5168\u90E8\u6302\u8F7D\uFF08expr / core / presets / render\uFF09');
    ok(px.els.view.width > 0 && px.els.view.height > 0, '\u4E3B\u753B\u5E03\u5DF2\u6309\u5C4F\u5E55\u50CF\u7D20\u6BD4\u8BBE\u7F6E\u5C3A\u5BF8',
      px.els.view.width + 'x' + px.els.view.height);

    // ---------------------------------------------------------- 2. 真的画出来了
    await settle();
    var s1 = px.canvasStats(px.els.view);
    ok(s1.ratio > 0.02, '\u4E3B\u56FE\u975E\u7A7A\u50CF\u7D20\u5360\u6BD4 > 2%\uFF08\u771F\u7684\u753B\u4E86\uFF0C\u4E0D\u662F\u7A7A\u767D\uFF09',
      (s1.ratio * 100).toFixed(2) + '%');
    ok(s1.distinctColors >= 6, '\u77E2\u5934\u989C\u8272\u81F3\u5C11 6 \u79CD\uFF08\u989C\u8272\u786E\u5B9E\u5728\u7F16\u7801 |f|\uFF09',
      'distinctColors=' + s1.distinctColors);

    // ---------------------------------------------------------- 2b. 帧循环：界面必须自己会重绘
    // 关键纪律：这一段**不许调用 renderNow**。上一版自检每步之后都替应用渲染一次，
    // 结果把"帧循环断了、界面永远冻在第一帧"这个缺陷整整齐齐地盖住了（人系统实测报障才发现）。
    {
      var rv = px.els.view.getBoundingClientRect();
      var rc0 = summary().renderCount;
      var px0 = px.canvasStats(px.els.view);
      clickAt(rv.width * 0.38, rv.height * 0.42);
      ok(summary().dirty === true, '\u70B9\u51FB\u540E\u7F6E\u4E86\u201C\u8BE5\u91CD\u7ED8\u201D\u6807\u5FD7');
      px.frameNow();          // 与 rAF 调的是同一个帧函数体，但不依赖 rAF
      ok(summary().renderCount > rc0, '\u4EC5\u63A8\u8FDB\u4E00\u5E27\uFF08\u4E0D\u8C03 renderNow\uFF09\uFF0C\u754C\u9762\u5C31\u81EA\u5DF1\u91CD\u7ED8\u4E86',
        `renderCount ${rc0} \u2192 ${summary().renderCount}`);
      var px1 = px.canvasStats(px.els.view);
      ok(Math.abs(px1.nonBg - px0.nonBg) > 0 || px1.ratio > 0.02, '\u91CD\u7ED8\u786E\u5B9E\u843D\u5230\u4E86\u50CF\u7D20\u4E0A', 'nonBg ' + px0.nonBg + ' \u2192 ' + px1.nonBg);

      if (document.visibilityState === 'visible') {
        var rc1 = summary().renderCount;
        clickAt(rv.width * 0.62, rv.height * 0.58);
        await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
        ok(summary().renderCount > rc1, '\u771F\u5B9E rAF \u5E27\u4E0B\u754C\u9762\u81EA\u5DF1\u91CD\u7ED8\uFF08\u65E0\u4EBA\u4EE3\u52B3\uFF09',
          `renderCount ${rc1} \u2192 ${summary().renderCount}`);
      } else {
        skip('\u771F\u5B9E rAF \u5E27\u4E0B\u754C\u9762\u81EA\u5DF1\u91CD\u7ED8',
          '\u9875\u9762\u5F53\u524D\u4E0D\u5728\u524D\u53F0\uFF0C\u6D4F\u89C8\u5668\u4F1A\u628A rAF \u5B8C\u5168\u505C\u6389\uFF0C\u8FD9\u4E00\u9879\u65E0\u6CD5\u9A8C\u8BC1');
      }
    }

    // ---------------------------------------------------------- 2c. 副图必须真的看得见
    // 人系统报障："状态分量随时间 t 的变化"那个坐标图看不见。
    // 根因是布局溢出被 body{overflow:hidden} 裁掉 —— 所以断言必须问"它在不在窗口里"，
    // 而不是"它有没有被渲染"（渲染了但被裁掉，画布尺寸照样是对的）。
    {
      var vRect = px.els.view.getBoundingClientRect();
      var sRect = px.els.series.getBoundingClientRect();
      var vh = window.innerHeight, vw = window.innerWidth;
      ok(vRect.height >= 100, '\u4E3B\u56FE\u9AD8\u5EA6\u8DB3\u591F', vRect.height.toFixed(0) + 'px');
      ok(sRect.height >= 40, '\u65F6\u95F4\u5E8F\u5217\u526F\u56FE\u6709\u81EA\u5DF1\u7684\u9AD8\u5EA6\uFF08\u6CA1\u88AB\u538B\u6210 0\uFF09', sRect.height.toFixed(0) + 'px');
      ok(sRect.bottom <= vh + 1, '\u65F6\u95F4\u5E8F\u5217\u526F\u56FE\u6574\u4F53\u5728\u7A97\u53E3\u5185\uFF08\u6CA1\u6709\u88AB\u88C1\u6389\uFF09',
        `bottom=${sRect.bottom.toFixed(0)} \u7A97\u53E3\u9AD8=${vh}`);
      ok(vRect.bottom <= vh + 1, '\u4E3B\u56FE\u6574\u4F53\u5728\u7A97\u53E3\u5185',
        `bottom=${vRect.bottom.toFixed(0)} \u7A97\u53E3\u9AD8=${vh}`);
      ok(vw > 0 && vRect.width >= 300, '\u4E3B\u56FE\u5BBD\u5EA6\u8DB3\u591F', vRect.width.toFixed(0) + 'px');
      var s2 = px.canvasStats(px.els.series);
      ok(s2.total > 0, '\u526F\u56FE\u753B\u5E03\u5DF2\u5206\u914D\u5230\u4E86\u771F\u5B9E\u50CF\u7D20', 'total=' + s2.total);
    }

    px.loadPreset('pendulum-2d');
    await settle();
    var sum = summary();
    eq(sum.dim, 2, '\u9884\u8BBE\u5355\u6446\uFF1A\u76F8\u7A7A\u95F4\u7EF4\u5EA6 = 2');
    // 方程回显：现在是"学生手写"的真分数形式（dθ/dt），不是代码形式（theta' = …）。
    // 这一条以前断言的是 "theta' = omega"，本轮显示方式改了，断言跟着改——
    // 断言必须跟着"交付物该长什么样"走，而不是跟着旧实现的字符串走。
    var insetTxt = px.els.insetEq.textContent.replace(/\s+/g, '');
    // 方程回显现在是"点号写法 + 等价二阶形式"（学生手写的样子，也是参考图的写法）
    ok(insetTxt.indexOf('\u03B8\u00B7') >= 0 && insetTxt.indexOf('\u03C9\u00B7') >= 0,
      '\u65B9\u7A0B\u56DE\u663E\u4E3A\u70B9\u53F7\u5199\u6CD5\uFF08\u03B8\u0307 = \u03C9\u3001\u03C9\u0307 = \u2026\uFF09', insetTxt.slice(0, 48));
    ok(insetTxt.indexOf('\u03B8\u00B7\u00B7') >= 0, '\u5355\u6446\u7ED9\u51FA\u4E86\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F \u03B8\u0308', insetTxt.slice(0, 60));
    ok(insetTxt.indexOf("'=") < 0 && insetTxt.indexOf('theta') < 0,
      '\u4E0D\u518D\u51FA\u73B0\u4EE3\u7801\u5F62\u5F0F\uFF08\u6492\u53F7\u3001theta \u8FD9\u79CD ASCII \u540D\uFF09', insetTxt.slice(0, 48));

    var rect = px.els.view.getBoundingClientRect();
    var cx = rect.width * 0.5, cy = rect.height * 0.5;
    clickAt(cx + 90, cy - 60);
    await settle();
    var init1 = summary().init;
    var PAD = { l: 56, r: 20, t: 20, b: 36 };
    var iw = rect.width - PAD.l - PAD.r, ih = rect.height - PAD.t - PAD.b;
    var b = summary().bounds;
    var expX = b[0][0] + ((cx + 90) - PAD.l) / iw * (b[0][1] - b[0][0]);
    var expY = b[1][1] - ((cy - 60) - PAD.t) / ih * (b[1][1] - b[1][0]);
    // 容差按"屏幕像素"折算：界面把画布 CSS 尺寸四舍五入到整数像素，因此 1 像素内的偏差是量化的必然结果
    var pxX = (b[0][1] - b[0][0]) / iw, pxY = (b[1][1] - b[1][0]) / ih;
    var errPx = Math.max(Math.abs(init1[0] - expX) / pxX, Math.abs(init1[1] - expY) / pxY);
    ok(errPx < 1.0,
      '\u70B9\u51FB\u4F4D\u7F6E\u4E0E\u72EC\u7ACB\u590D\u7B97\u7684\u4E16\u754C\u5750\u6807\u4E00\u81F4\uFF08\u8BEF\u5DEE < 1 \u4E2A\u5C4F\u5E55\u50CF\u7D20\uFF09',
      '\u8BEF\u5DEE ' + errPx.toFixed(3) + ' px\uFF08' + pxX.toFixed(4) + ' \u4E16\u754C\u5355\u4F4D/\u50CF\u7D20\uFF09 \u5B9E\u6D4B ' +
      JSON.stringify(init1.map(function (v) { return +v.toFixed(4); })) + ' \u590D\u7B97 ' + JSON.stringify([+expX.toFixed(4), +expY.toFixed(4)]));
    clickAt(cx - 90, cy + 60);
    await settle();
    var init2 = summary().init;
    ok(init2[0] < init1[0] && init2[1] < init1[1], '\u5411\u5DE6\u4E0B\u70B9\u51FB \u2192 \u521D\u59CB\u72B6\u6001\u4E24\u4E2A\u5206\u91CF\u90FD\u53D8\u5C0F\uFF08\u65B9\u5411\u672A\u7FFB\u8F6C\uFF09',
      JSON.stringify([init1.map(function (v) { return +v.toFixed(4); }), init2.map(function (v) { return +v.toFixed(4); })]));
    clickAt(cx - 90, cy + 60);
    await settle();
    ok(summary().init[0] === init2[0], '\u540C\u4E00\u4F4D\u7F6E\u70B9\u4E24\u6B21\uFF0C\u7ED3\u679C\u76F8\u540C\uFF08\u65E0\u968F\u673A\u6027\uFF09');

    // ---------------------------------------------------------- 4. 时间演化与回溯（用同步推进，不依赖 rAF）
    px.loadPreset('damped-pendulum-2d');
    await settle();
    eq(summary().curF, 0, '\u521A\u52A0\u8F7D\u65F6\u65F6\u95F4\u6E38\u6807\u5728 t=0');
    px.startPlay('f');
    px.advance(120);
    await settle();
    var after = summary();
    ok(after.curF > 5 && after.t > 0, '\u6B63\u5411\u6F14\u5316\uFF1At \u589E\u5927\u4E14\u8F68\u8FF9\u5728\u63A8\u8FDB',
      'curF=' + after.curF.toFixed(1) + ' t=' + after.t.toFixed(3));
    ok(after.state.every(function (v) { return isFinite(v); }), '\u63A8\u8FDB\u4E2D\u72B6\u6001\u5168\u90E8\u6709\u9650\uFF08\u65E0 NaN\uFF09', JSON.stringify(after.state.map(function (v) { return +v.toFixed(3); })));
    px.stopPlay();
    px.loadPreset('damped-pendulum-2d');
    await settle();
    px.startPlay('b');
    px.advance(120);
    await settle();
    var back = summary();
    ok(back.curB > 5 && back.t < 0, '\u53CD\u5411\u56DE\u6EAF\uFF1At \u53D8\u4E3A\u8D1F\u503C\u4E14\u8F68\u8FF9\u5728\u63A8\u8FDB',
      'curB=' + back.curB.toFixed(1) + ' t=' + back.t.toFixed(3));
    px.stopPlay();
    await settle();
    var s2 = px.canvasStats(px.els.view);
    ok(s2.ratio > 0.02, '\u6F14\u5316\u4E0E\u56DE\u6EAF\u540E\u753B\u9762\u4ECD\u6B63\u5E38', (s2.ratio * 100).toFixed(2) + '%');

    // ---------------------------------------------------------- 5. 相流（框选区域）
    px.loadPreset('van-der-pol-2d');
    await settle();
    dragRect(rect.width * 0.30, rect.height * 0.55, rect.width * 0.55, rect.height * 0.80);
    await settle();
    var fl = summary();
    eq(fl.ensCount, 217, '\u76F8\u6D41\u533A\u57DF\u72B6\u6001\u6570 = 11\u00D711 \u5185\u90E8 + 96 \u8FB9\u754C = 217');
    eq(fl.ensBoundary, 96, '\u8FB9\u754C\u591A\u8FB9\u5F62\u9876\u70B9\u6570 = 96\uFF08\u9762\u79EF\u5F62\u53D8\u53EF\u7B97\uFF09');
    ok(/[0-9]/.test(px.els.flowNote.textContent), '\u754C\u9762\u4E0A\u51FA\u73B0\u4E86\u76F8\u6D41\u533A\u57DF\u7684\u53D6\u503C\u8303\u56F4', px.els.flowNote.textContent.slice(0, 42));
    px.startPlay('f');
    px.advance(120);
    await settle();
    var fl2 = summary();
    px.stopPlay();
    ok(fl2.curF > 3, '\u76F8\u6D41\u968F\u65F6\u95F4\u6D41\u52A8\uFF08\u65F6\u95F4\u6E38\u6807\u524D\u8FDB\uFF09', 'curF=' + fl2.curF.toFixed(1));
    ok(px.els.readout.textContent.indexOf('\u76F8\u6D41\u9762\u79EF\u6BD4') >= 0, '\u53F3\u680F\u8BFB\u51FA\u4E86\u76F8\u6D41\u7684\u9762\u79EF\u6BD4\uFF08\u53EF\u91CF\u5316\u7684\u76F8\u4F53\u79EF\u53D8\u5316\uFF09');

    // ---------------------------------------------------------- 5b. 一维图：滚轮缩放 / Shift 平移（真实事件）
    // 人系统报障："一维图放不大缩不小"。根因是一维的世界坐标换算走了二维函数。
    // 这一节用**真实的 WheelEvent 与 PointerEvent** 再验一遍，作为应用层断言的第二路证据。
    {
      var sel = px.els.presetSelect;
      sel.value = 'logistic-1d';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      eq(summary().dim, 1, '\u5207\u6362\u5230\u4E00\u7EF4\u9884\u8BBE logistic-1d');
      var rv2 = px.els.view.getBoundingClientRect();
      var cw = rv2.width * 0.5, chh = rv2.height * 0.5;
      var width0 = summary().bounds[0][1] - summary().bounds[0][0];
      px.els.view.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240, clientX: rv2.left + cw, clientY: rv2.top + chh, bubbles: true, cancelable: true
      }));
      await settle();
      var width1 = summary().bounds[0][1] - summary().bounds[0][0];
      ok(width1 < width0 * 0.95, '\u4E00\u7EF4\u56FE\uFF1A\u771F\u5B9E\u6EDA\u8F6E\u4E8B\u4EF6\u5411\u4E0A \u2192 \u653E\u5927',
        `\u5BBD\u5EA6 ${width0.toFixed(3)} \u2192 ${width1.toFixed(3)}`);
      px.els.view.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 400, clientX: rv2.left + cw, clientY: rv2.top + chh, bubbles: true, cancelable: true
      }));
      await settle();
      var width2 = summary().bounds[0][1] - summary().bounds[0][0];
      ok(width2 > width1 * 1.05, '\u4E00\u7EF4\u56FE\uFF1A\u771F\u5B9E\u6EDA\u8F6E\u4E8B\u4EF6\u5411\u4E0B \u2192 \u7F29\u5C0F', `\u5BBD\u5EA6 ${width1.toFixed(3)} \u2192 ${width2.toFixed(3)}`);

      var ctr0 = (summary().bounds[0][0] + summary().bounds[0][1]) / 2;
      pointer('pointerdown', px.els.view, cw, chh, { shiftKey: true });
      pointer('pointermove', px.els.view, cw + 80, chh, { shiftKey: true });
      pointer('pointerup', px.els.view, cw + 80, chh, { shiftKey: true });
      await settle();
      var ctr1 = (summary().bounds[0][0] + summary().bounds[0][1]) / 2;
      ok(ctr1 < ctr0, '\u4E00\u7EF4\u56FE\uFF1AShift+\u62D6\u52A8\u53EF\u4EE5\u5E73\u79FB',
        `\u4E2D\u5FC3 ${ctr0.toFixed(3)} \u2192 ${ctr1.toFixed(3)}`);
      px.els.btnResetView.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      ok(Math.abs((summary().bounds[0][1] - summary().bounds[0][0]) - width0) < 1e-9, '\u91CD\u7F6E\u89C6\u91CE\u628A\u4E00\u7EF4\u56FE\u653E\u56DE\u9884\u8BBE\u8303\u56F4');
    }

    // ---------------------------------------------------------- 5c. 拖拽不该把画面重置（真实事件）
    // 人系统报障："在拖拽后可视画面会重置"。根因是 onPointerUp 末尾一句无条件 resetPlayback()。
    // 这里用真实的 Shift+拖动、PointerEvent 与 WheelEvent 再验一遍，并在暂停状态下要求"时间一字不动"。
    {
      var rv3 = px.els.view.getBoundingClientRect();
      var mx = rv3.width * 0.5, my = rv3.height * 0.5;
      px.loadPreset('van-der-pol-2d');
      await settle();
      px.startPlay('f');
      px.advance(150);
      await settle();
      var nb0 = summary();
      ok(nb0.curF > 20, '\u6F14\u5316\u5230 t>0', 'curF=' + nb0.curF.toFixed(1));
      pointer('pointerdown', px.els.view, mx, my, { shiftKey: true });
      pointer('pointermove', px.els.view, mx + 40, my + 20, { shiftKey: true });
      pointer('pointerup', px.els.view, mx + 40, my + 20, { shiftKey: true });
      await settle();
      var nb1 = summary();
      ok(nb1.bounds[0][0] !== nb0.bounds[0][0], 'Shift+\u62D6\u52A8\u786E\u5B9E\u642C\u4E86\u89C6\u7A97',
        `x0 ${nb0.bounds[0][0].toFixed(3)} \u2192 ${nb1.bounds[0][0].toFixed(3)}`);
      ok(nb1.curF >= nb0.curF, '\u5E73\u79FB\u540E\u65F6\u95F4\u6CA1\u6709\u56DE\u9000\uFF08\u753B\u9762\u4E0D\u91CD\u7F6E\uFF09',
        `curF ${nb0.curF} \u2192 ${nb1.curF}`);
      ok(nb1.playing === 'f', '\u5E73\u79FB\u4E0D\u6253\u65AD\u64AD\u653E', 'playing=' + nb1.playing);

      px.stopPlay();
      await settle();
      var frozenF = summary().curF;
      dragRect(rv3.width * 0.30, rv3.height * 0.55, rv3.width * 0.55, rv3.height * 0.80);
      await settle();
      ok(summary().ensCount === 217, '\u6846\u9009\u5EFA\u7ACB\u4E86\u76F8\u6D41\u533A\u57DF', 'ensCount=' + summary().ensCount);
      ok(summary().curF === frozenF, '\u6682\u505C\u540E\u6846\u9009\uFF1A\u65F6\u95F4\u4E00\u5B57\u4E0D\u52A8', `curF ${frozenF} \u2192 ${summary().curF}`);
      px.els.view.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -200, clientX: rv3.left + mx, clientY: rv3.top + my, bubbles: true, cancelable: true
      }));
      await settle();
      ok(summary().curF === frozenF, '\u6682\u505C\u540E\u7F29\u653E\uFF1A\u65F6\u95F4\u4E00\u5B57\u4E0D\u52A8', 'curF=' + summary().curF);
    }

    // ---------------------------------------------------------- 6b. 学生写法的方程回显
    {
      ok(px.setSource('g = 9.8\nL = 1\nd\u03B8/dt = \u03C9\nd\u03C9/dt = -(g/L)*sin(\u03B8)'), '\u5B66\u751F\u5199\u6CD5 d\u03B8/dt \u7F16\u8BD1\u6210\u529F');
      await settle();
      eq(summary().dim, 2, 'd\u03B8/dt \u5199\u6CD5 \u2192 \u4E8C\u7EF4\u76F8\u7A7A\u95F4');
      var eqh = px.els.insetEq.innerHTML;
      ok(eqh.indexOf('<span class="dv">\u03B8<span class="dvdot">') >= 0 &&
        eqh.indexOf('<span class="dv">\u03B8<span class="dvdot2">') >= 0,
        '\u65B9\u7A0B\u56DE\u663E\u7528\u70B9\u53F7\uFF08\u4E00\u9636 \u03B8\u0307 + \u4E8C\u9636 \u03B8\u0308\uFF09\uFF0C\u70B9\u7531 CSS \u753B\u51FA', eqh.slice(0, 90));
      ok(eqh.indexOf('\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F') >= 0, '\u6807\u51FA\u4E86\u201C\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F\u201D', eqh.slice(-120));
      ok(eqh.indexOf('\u00B7') >= 0, '\u4E58\u53F7\u663E\u793A\u4E3A\u4E2D\u95F4\u70B9', eqh.slice(0, 110));
    }

    // ---------------------------------------------------------- 6c. 随机外因模式
    {
      px.loadPreset('suspension-random-2d');
      await settle();
      eq(summary().mode, 'det', '\u52A0\u8F7D\u542B\u968F\u673A\u5916\u56E0\u7684\u9884\u8BBE \u2192 \u9ED8\u8BA4\u505C\u5728\u786E\u5B9A\u6027\u6A21\u5F0F\uFF08\u5148\u770B\u8DEF\u5F84\uFF09');
      ok(summary().usesRandom === true, '\u65B9\u7A0B\u88AB\u6807\u8BB0\u4E3A\u542B\u968F\u673A\u5916\u56E0');
      ok(summary().hasAux === true, '\u786E\u5B9A\u6027\u6A21\u5F0F\u4E0B\u8DEF\u9762\u88AB\u56FA\u5B9A\u6210\u4E00\u6B21\u5B9E\u73B0\uFF08\u4E0D\u662F\u6052\u4E3A 0\uFF09');
      ok(!px.els.mcPanel.classList.contains('show'), '\u968F\u673A\u9762\u677F\u9ED8\u8BA4\u4E0D\u5C55\u5F00');
      eq(px.state.compiled.paramNames.join(','), 'm,c,k', '\u53C2\u6570\u53EA\u6709 m\u3001c\u3001k\uFF08\u6CA1\u6709\u591A\u4F59\u7684\u63A8\u5BFC\u91CF\uFF09');
      // 相图上确实画着"路径"：相图区有内容（不是空坐标框）
      var st0 = px.canvasStats(px.els.view);
      ok(st0.ratio > 0.02, '\u786E\u5B9A\u6027\u6A21\u5F0F\u4E0B\u76F8\u56FE\u4E0A\u6709\u8F68\u8FF9', (st0.ratio * 100).toFixed(1) + '%');
      // 主动切到随机模式，再跑一次蒙特卡洛
      px.els.modeRandom.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      eq(summary().mode, 'random', '\u70B9\u300C\u968F\u673A\u5916\u56E0\u300D\u624D\u5207\u8FC7\u53BB');
      ok(px.els.mcPanel.classList.contains('show'), '\u968F\u673A\u9762\u677F\u5DF2\u5C55\u5F00');
      ok(px.els.psdWrap.classList.contains('show'), '\u529F\u7387\u8C31\u9762\u677F\u5DF2\u5C55\u5F00');
      px.state.mc.runs = 16;
      px.state.mc.tMax = 8;
      px.state.mc.chunk = 999;          // 一次跑完，省得等分片
      px.els.btnMC.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      var sr = summary();
      ok(sr.mcCount > 1000, '\u8499\u7279\u5361\u7F57\u7D2F\u8BA1\u5230\u4E86\u5927\u91CF\u91C7\u6837\u70B9', 'count=' + sr.mcCount);
      ok(sr.psdReady === true, '\u529F\u7387\u8C31\u5DF2\u7B97\u51FA');
      ok(px.els.readout.textContent.indexOf('\u5B9E\u73B0\u6B21\u6570') >= 0, '\u53F3\u680F\u6539\u6210\u4E86\u968F\u673A\u6A21\u5F0F\u7684\u8BFB\u6570');
      ok(px.els.mcNote.textContent.indexOf('16') >= 0, '\u9762\u677F\u4E0B\u65B9\u62A5\u51FA\u4E86\u5B9E\u73B0\u6B21\u6570', px.els.mcNote.textContent.slice(0, 40));
      var st1 = px.canvasStats(px.els.view);
      ok(st1.distinctColors >= 12, '\u4E3B\u56FE\u4E0A\u51FA\u73B0\u4E86\u5BC6\u5EA6\u70ED\u56FE\u7684\u8272\u9636', 'colors=' + st1.distinctColors);
      var psc = px.canvasStats(px.els.psd);
      ok(psc.ratio > 0.01, '\u529F\u7387\u8C31\u5B50\u56FE\u5DF2\u7ED8\u5236', (psc.ratio * 100).toFixed(2) + '%');
      // 功率谱框必须**整体在窗口内**，而且与时间序列并排（人系统报障"功率谱密度框看不全"）
      var sR = px.els.series.getBoundingClientRect();
      var pR = px.els.psd.getBoundingClientRect();
      var vh2 = window.innerHeight;
      ok(pR.height >= 60, '\u529F\u7387\u8C31\u5B50\u56FE\u6709\u8DB3\u591F\u7684\u9AD8\u5EA6\uFF08\u4E0D\u662F\u88AB\u6324\u6210\u4E00\u6761\u7F1D\uFF09', pR.height.toFixed(0) + 'px');
      ok(sR.height >= 60, '\u65F6\u95F4\u5E8F\u5217\u5B50\u56FE\u4E5F\u6709\u8DB3\u591F\u7684\u9AD8\u5EA6', sR.height.toFixed(0) + 'px');
      ok(pR.bottom <= vh2 + 1, '\u529F\u7387\u8C31\u5B50\u56FE\u6574\u4F53\u5728\u7A97\u53E3\u5185\uFF08\u6CA1\u88AB\u88C1\u6389\uFF09',
        `bottom=${pR.bottom.toFixed(0)} \u7A97\u53E3\u9AD8=${vh2}`);
      ok(sR.bottom <= vh2 + 1, '\u65F6\u95F4\u5E8F\u5217\u5B50\u56FE\u4E5F\u5728\u7A97\u53E3\u5185', `bottom=${sR.bottom.toFixed(0)}`);
      var sW = px.els.seriesWrap.getBoundingClientRect();
      var pW = px.els.psdWrap.getBoundingClientRect();
      ok(Math.abs(pW.top - sW.top) < 3 && pW.left > sW.left + 100, '\u4E24\u5757\u5B50\u56FE\u5E76\u6392\uFF08\u62FF\u5BBD\u5EA6\u6362\u9AD8\u5EA6\uFF09',
        `series.left=${sW.left.toFixed(0)} psd.left=${pW.left.toFixed(0)} top\u5DEE=${(pW.top - sW.top).toFixed(1)}`);
      ok(Math.abs(pR.top - sR.top) < 3, '\u4E24\u5757\u5B50\u56FE\u7684\u753B\u5E03\u9AD8\u5EA6\u5BF9\u9F50\uFF08\u6807\u9898\u884C\u6570\u4E00\u81F4\uFF09',
        `series.top=${sR.top.toFixed(0)} psd.top=${pR.top.toFixed(0)}`);
      var fp1 = summary().mcFingerprint;
      // 「只画路径」：勾上之后状态里确实切过去了，而且**颜色数明显减少**（云真的没画）。
      // 人系统报的是"勾了只画路径，一拖动画云反而冒出来"——所以这条要在真实像素上看。
      px.els.mcPathsOnly.checked = false;
      px.els.mcPathsOnly.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      var cWith = px.canvasStats(px.els.view);
      px.els.mcPathsOnly.checked = true;
      px.els.mcPathsOnly.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      ok(summary().pathsOnly === true, '\u52FE\u4E0A\u300C\u53EA\u753B\u8DEF\u5F84\u300D\u540E\u72B6\u6001\u5207\u6362\u6210\u529F');
      var stP = px.canvasStats(px.els.view);
      ok(stP.ratio > 0.01, '\u53EA\u753B\u8DEF\u5F84\u65F6\u76F8\u56FE\u4E0A\u4ECD\u6709\u8F68\u8FF9', (stP.ratio * 100).toFixed(2) + '%');
      // 用"非底色像素数"比：概率云是一大片填充，路径只是细线。
      // 阈值放得很松（5%）：向量场的箭头本身就占了大量像素，云只占其中一成上下；
      // 精确判据（0 个格子、0 次 drawImage）在 verify-app.mjs 里，这里是真实像素上的冒烟检查。
      ok(stP.nonBg < cWith.nonBg * 0.95, '\u53EA\u753B\u8DEF\u5F84\u65F6\u975E\u5E95\u8272\u50CF\u7D20\u51CF\u5C11\uFF08\u6982\u7387\u4E91\u786E\u5B9E\u6CA1\u753B\uFF09',
        `\u6709\u4E91 ${cWith.nonBg} px \u2192 \u65E0\u4E91 ${stP.nonBg} px`);
      // 平移画面：云锚在相空间上，不该被拉伸着钉在屏幕上
      var vBefore = px.state.bounds.map(function (r) { return r.slice(); });
      px.els.mcPathsOnly.checked = false;
      px.els.mcPathsOnly.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      var beforePan = px.canvasStats(px.els.view).centroidY;
      px.state.bounds = [[px.state.bounds[0][0] + 0.08, px.state.bounds[0][1] + 0.08],
        [px.state.bounds[1][0] + 0.3, px.state.bounds[1][1] + 0.3]];
      await settle();
      var afterPan = px.canvasStats(px.els.view).centroidY;
      ok(Math.abs(afterPan - beforePan) > 0.5, '\u5E73\u79FB\u753B\u9762\u540E\u56FE\u50CF\u5185\u5BB9\u786E\u5B9E\u53D1\u751F\u4E86\u4F4D\u79FB\uFF08\u4E91\u6CA1\u88AB\u9489\u4F4F\uFF09',
        `\u8D28\u5FC3 y: ${Number(beforePan).toFixed(1)} \u2192 ${Number(afterPan).toFixed(1)}`);
      px.state.bounds = vBefore;
      await settle();
      px.els.btnMC.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      ok(summary().mcFingerprint === fp1, '\u540C\u4E00\u79CD\u5B50 \u2192 \u9010\u683C\u76F8\u540C\u7684\u5BC6\u5EA6\u56FE\uFF08\u53EF\u590D\u7B97\uFF09');
      px.els.btnMcSeed.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      ok(summary().mcFingerprint !== fp1, '\u6362\u4E00\u6279\u79CD\u5B50 \u2192 \u53E6\u4E00\u5F20\u56FE');
    }

    // ---------------------------------------------------------- 6d. 三维相流工具
    {
      px.loadPreset('lorenz-3d');
      await settle();
      eq(summary().mode, 'det', '\u56DE\u5230\u786E\u5B9A\u6027\u6A21\u5F0F');
      px.els.flow3dN.value = '4';
      px.els.flow3dN.dispatchEvent(new Event('input', { bubbles: true }));
      px.els.btn3DFlow.dispatchEvent(new Event('click', { bubbles: true }));
      await settle();
      eq(summary().ensCount, 64, '\u5EFA\u7ACB\u4E86 4\u00B3 = 64 \u4E2A\u70B9\u7684\u4E09\u7EF4\u76F8\u6D41\u4E91');
      ok(px.els.dynamics.textContent.indexOf('\u4E3B\u65B9\u5411\u62C9\u4F38') >= 0, '\u8BFB\u6570\u7ED9\u51FA\u4E86\u4E3B\u65B9\u5411\u62C9\u4F38\u500D\u6570');
    }

    // ---------------------------------------------------------- 6e. 书写工具（左栏）与"浮层不再挡图"
    {
      // 方程回显搬到左栏之后，画布上不该再有那个框
      var ins = px.els.inset.getBoundingClientRect();
      var stage = px.els.view.parentElement.getBoundingClientRect();
      ok(px.els.inset.querySelector('#insetEq') === null, '\u753B\u5E03\u4E0A\u7684\u65B9\u7A0B\u6D6E\u5C42\u5DF2\u5220\u9664');
      ok(ins.height < 130, '\u793A\u610F\u56FE\u53EA\u5360\u4E00\u5C0F\u5757\uFF08\u4E0D\u518D\u906E\u4F4F\u76F8\u56FE\uFF09', ins.height.toFixed(0) + 'px');
      // 判据用"占相图的面积比"，而不是"占宽度的比例"：窄窗口下 176–208px 的示意图
      // 在 500 多像素宽的相图里本来就占三成左右（那不是缺陷）；真在意的是"它有没有遮掉正图"。
      // 相图很矮时示意图会整块隐藏（width=0），也应当算通过。
      var insArea = ins.width * ins.height, stArea = stage.width * stage.height;
      ok(ins.width === 0 || insArea / stArea < 0.30,
        '\u6D6E\u5C42\u53EA\u5360\u76F8\u56FE\u5DE6\u4E0A\u89D2\u4E00\u89D2\uFF08\u9762\u79EF\u5360\u6BD4 < 30%\uFF09',
        `\u9762\u79EF\u5360\u6BD4 ${(insArea / stArea * 100).toFixed(1)}%${ins.width === 0 ? '\uFF08\u5DF2\u9690\u85CF\uFF09' : ''}`);
      var eqP = px.els.insetEq.getBoundingClientRect();
      var leftP = document.getElementById('left').getBoundingClientRect();
      ok(eqP.left >= leftP.left - 1 && eqP.right <= leftP.right + 1 && eqP.width > 100,
        '\u65B9\u7A0B\u9884\u89C8\u5728\u5DE6\u680F\u91CC\uFF08\u800C\u4E0D\u662F\u6D6E\u5728\u56FE\u4E0A\uFF09',
        `eq.left=${eqP.left.toFixed(0)} \u5DE6\u680F=[${leftP.left.toFixed(0)},${leftP.right.toFixed(0)}]`);

      // 符号盘：点一下就往编辑器里插入
      px.setSource('# \u7A7A\u767D\u8D77\u6B65\n');
      var ed = px.els.editor;
      function pal(sel) { var b = document.querySelector(sel); if (!b) throw new Error('缺按钮 ' + sel); b.click(); }
      pal('.palette .sym[data-ins="\u03B8"]');
      ok(ed.value.indexOf('\u03B8') >= 0, '\u5E26\u03B8\u7684\u6309\u94AE\u80FD\u63D2\u5165 \u03B8', JSON.stringify(ed.value.slice(0, 20)));
      // HTML 里写 \u03B8 只是六个普通字符（不是转义）——这条断言盯的就是这种"看着像转义"的坑
      ok(ed.value.indexOf('\\u') < 0, '\u63D2\u5165\u7684\u662F\u771F\u5B57\u7B26\uFF0C\u4E0D\u662F \\uXXXX \u5B57\u9762\u4E32', JSON.stringify(ed.value.slice(0, 24)));
      pal('.palette .sym[data-ins="sin("]');
      ok(ed.value.indexOf('sin(') >= 0, '\u51FD\u6570\u6309\u94AE\u80FD\u63D2\u5165 sin(', JSON.stringify(ed.value.slice(0, 24)));
      pal('.palette .sym[data-ins="^2"]');
      ok(ed.value.indexOf('^2') >= 0, '\u5E42\u6309\u94AE\u63D2\u5165 ^2', JSON.stringify(ed.value.slice(0, 24)));
      pal('.palette .sym[data-ins="road(t)"]');
      ok(ed.value.indexOf('road(t)') >= 0, '\u968F\u673A\u5916\u56E0\u6309\u94AE\u63D2\u5165 road(t)');
      // 插入的是**可编译**的内容：θ、sin( 这些片段不该把上一次可用的相图打坏
      ok(px.state.compiled !== null, '\u63D2\u5165\u7B26\u53F7\u540E\u4ECD\u6709\u53EF\u7528\u7684\u7F16\u8BD1\u7ED3\u679C');

      // 整段模板：一键给出能跑的骨架
      px.els.tplSelect.value = 'pendulum';
      px.els.tplSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      eq(summary().dim, 2, '\u63D2\u5165\u201C\u5355\u6446\u201D\u6A21\u677F \u2192 \u4E8C\u7EF4\u76F8\u7A7A\u95F4');
      ok(ed.value.indexOf('d\u03B8/dt = \u03C9') >= 0, '\u6A21\u677F\u7528\u5B66\u751F\u5199\u6CD5\uFF08d\u03B8/dt = \u03C9\uFF09', ed.value.slice(0, 40));
      px.els.tplSelect.value = 'lorenz';
      px.els.tplSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      eq(summary().dim, 3, '\u63D2\u5165\u201C\u6D1B\u4F26\u5179\u201D\u6A21\u677F \u2192 \u4E09\u7EF4\u76F8\u7A7A\u95F4');
      ok(px.els.flow3dPanel.classList.contains('show'), '\u4E09\u7EF4\u65F6\u624D\u51FA\u73B0\u300C\u4E09\u7EF4\u76F8\u6D41\u5DE5\u5177\u300D\u9762\u677F');
      px.els.tplSelect.value = 'susp';
      px.els.tplSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      ok(summary().usesRandom === true, '\u63D2\u5165\u201C\u968F\u673A\u60AC\u6302\u201D\u6A21\u677F \u2192 \u88AB\u6807\u8BB0\u4E3A\u542B\u968F\u673A\u5916\u56E0');

      // 错误行可点：直接跳到编辑器里那一段
      ed.value = 'g = 9.8\nd\u03B8/dt = \u03C9\nd\u03C9/dt = -(g/L)*sin(\u03B8)';
      px.applyNow();
      await settle();
      ok(px.els.errors.classList.contains('show'), '\u672A\u5B9A\u4E49\u7684 L \u4F1A\u62A5\u9519', px.els.errors.textContent.slice(0, 40));
      var firstErr = px.els.errors.querySelector('.errline');
      ok(!!firstErr, '\u9519\u8BEF\u884C\u53EF\u70B9\uFF08\u6709\u53EF\u70B9\u51FB\u7684\u9519\u8BEF\u6761\u76EE\uFF09');
      if (firstErr) {
        firstErr.click();
        var selText = ed.value.slice(ed.selectionStart, ed.selectionEnd);
        ok(selText.indexOf('d\u03C9/dt') >= 0, '\u70B9\u9519\u8BEF\u884C \u2192 \u5149\u6807\u5B9A\u4F4D\u5230\u51FA\u95EE\u9898\u7684\u90A3\u4E00\u884C',
          JSON.stringify(selText));
      }
      // Ctrl+Enter = 应用
      ed.value = 'k = 1\ndx/dt = -k*x';
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      await settle();
      eq(summary().dim, 1, 'Ctrl+Enter \u80FD\u5E94\u7528\u65B9\u7A0B');
    }

    // ---------------------------------------------------------- 6. 方程即维度
    ok(px.setSource("x' = -x + cos(t)"), '\u6539\u6210\u4E00\u884C\u65B9\u7A0B\uFF1A\u7F16\u8BD1\u6210\u529F');
    await settle();
    eq(summary().dim, 1, '\u4E00\u884C\u65B9\u7A0B \u2192 \u4E00\u7EF4\u76F8\u7A7A\u95F4');
    eq(px.els.dimTabs.querySelector('button.active').getAttribute('data-dim'), '1', '\u9876\u680F\u7EF4\u5EA6\u5207\u6362\u5668\u8DDF\u7740\u53D8\u6210\u4E00\u7EF4');
    var s3 = px.canvasStats(px.els.view);
    ok(s3.ratio > 0.01, '\u4E00\u7EF4\u76F8\u7A7A\u95F4\uFF08\u76F8\u7EBF\uFF09\u5DF2\u7ED8\u5236', (s3.ratio * 100).toFixed(2) + '%');

    ok(px.setSource("x' = y\ny' = -x\nz' = -0.5*z"), '\u6539\u6210\u4E09\u884C\u65B9\u7A0B\uFF1A\u7F16\u8BD1\u6210\u529F');
    await settle();
    eq(summary().dim, 3, '\u4E09\u884C\u65B9\u7A0B \u2192 \u4E09\u7EF4\u76F8\u7A7A\u95F4');
    eq(px.els.dimTabs.querySelector('button.active').getAttribute('data-dim'), '3', '\u9876\u680F\u7EF4\u5EA6\u5207\u6362\u5668\u8DDF\u7740\u53D8\u6210\u4E09\u7EF4');
    var s4 = px.canvasStats(px.els.view);
    ok(s4.ratio > 0.02, '\u4E09\u7EF4\u76F8\u7A7A\u95F4\uFF08\u6295\u5F71\uFF09\u5DF2\u7ED8\u5236', (s4.ratio * 100).toFixed(2) + '%');

    // ---------------------------------------------------------- 7. 错误方程不摧毁上一张相图
    var beforeErr = summary();
    var okCompile = px.setSource("y' = z");
    await settle();
    var afterErr = summary();
    ok(!okCompile && afterErr.errors > 0, '\u5F15\u7528\u672A\u5B9A\u4E49\u91CF\u7684\u65B9\u7A0B\u88AB\u62D2\u7EDD\u5E76\u62A5\u9519');
    eq(afterErr.dim, beforeErr.dim, '\u62A5\u9519\u540E\u4ECD\u7136\u4FDD\u7559\u4E0A\u4E00\u4E2A\u53EF\u7528\u7684\u76F8\u56FE\uFF08\u7EF4\u5EA6\u4E0D\u53D8\uFF09');
    ok(px.els.errors.classList.contains('show'), '\u754C\u9762\u4E0A\u771F\u7684\u5F39\u51FA\u4E86\u9519\u8BEF\u63D0\u793A');
    var s5 = px.canvasStats(px.els.view);
    ok(s5.ratio > 0.02, '\u62A5\u9519\u72B6\u6001\u4E0B\u753B\u5E03\u4ECD\u5728\u6B63\u5E38\u7ED8\u5236', (s5.ratio * 100).toFixed(2) + '%');

    // ---------------------------------------------------------- 8. 结构分析落到 DOM 上
    px.loadPreset('damped-pendulum-2d');
    await settle();
    var struct = px.els.structure.textContent;
    ok(struct.indexOf('\u7A33\u5B9A') >= 0, '\u7ED3\u6784\u9762\u677F\u5217\u51FA\u4E86\u7A33\u5B9A\u4E0D\u52A8\u70B9', struct.slice(0, 48));
    ok(struct.indexOf('\u978D\u70B9') >= 0, '\u7ED3\u6784\u9762\u677F\u5217\u51FA\u4E86\u978D\u70B9\uFF08\u5355\u6446\u7684\u5012\u7ACB\u5E73\u8861\uFF09');
    var readTxt = px.els.readout.textContent;
    ok(readTxt.indexOf('\u76F8\u4F53\u79EF\u6536\u7F29') >= 0, '\u963B\u5C3C\u5355\u6446\uFF1A\u6563\u5EA6\u8BFB\u6570\u5224\u4E3A\u76F8\u4F53\u79EF\u6536\u7F29\uFF08\u0394\u00B7f = -b\uFF09', readTxt.replace(/\s+/g, ' ').slice(0, 72));

    // ---------------------------------------------------------- 9. 时间序列
    var s6 = px.canvasStats(px.els.series);
    ok(s6.ratio > 0.005, '\u65F6\u95F4\u5E8F\u5217\u5B50\u56FE\u5DF2\u7ED8\u5236', (s6.ratio * 100).toFixed(2) + '%');

    // ---------------------------------------------------------- 10. 预设库全员可加载
    var ids = window.PSPresets.list.map(function (p) { return p.id; });
    var bad = [];
    for (var k = 0; k < ids.length; k++) {
      px.loadPreset(ids[k]);
      await settle();
      var s = summary();
      var st = px.canvasStats(px.els.view);
      if (s.dim !== window.PSPresets.byId(ids[k]).dim || s.errors || st.ratio < 0.01) {
        bad.push(ids[k] + '(dim=' + s.dim + ',err=' + s.errors + ',px=' + st.ratio.toFixed(3) + ')');
      }
    }
    eq(bad.length, 0, '\u5168\u90E8 ' + ids.length + ' \u4E2A\u9884\u8BBE\u5728\u6D4F\u89C8\u5668\u91CC\u90FD\u80FD\u6B63\u5E38\u6E32\u67D3', bad.join(' '));

    finish();
  }

  function finish() {
    var skipped = results.filter(function (r) { return r.skipped; }).length;
    var pass = results.filter(function (r) { return r.pass && !r.skipped; }).length;
    var fail = results.length - pass - skipped;
    var box = document.createElement('div');
    box.id = 'selftestBox';
    box.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:999;' +
      'background:rgba(4,8,12,.97);border:1px solid #24405a;border-radius:8px;padding:10px 14px;' +
      'max-width:1120px;max-height:92vh;overflow:auto;font:12px/1.55 ui-monospace,Consolas,monospace;color:#cfe6f2;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.7)';
    var html = '<div style="font-size:14px;font-weight:700;color:' + (fail ? '#ff8a8a' : '#7dfba0') + ';margin-bottom:6px">' +
      '\u6D4F\u89C8\u5668\u5185\u81EA\u68C0\uFF1A\u901A\u8FC7 ' + pass + ' / \u5931\u8D25 ' + fail +
      (skipped ? ' / \u672A\u9A8C\u8BC1 ' + skipped : '') + '</div>';
    results.forEach(function (r) {
      var mark = r.skipped ? '\u25CB' : (r.pass ? '\u2713' : '\u2717');
      var color = r.skipped ? '#e8d68a' : (r.pass ? '#9fe8bd' : '#ff9a9a');
      html += '<div style="color:' + color + '">' + mark + ' ' + r.label +
        (r.detail ? ' <span style="color:#7f9cb0">\u2192 ' + String(r.detail).replace(/</g, '&lt;') + '</span>' : '') + '</div>';
    });
    box.innerHTML = html;
    document.body.appendChild(box);
    window.__selftest = { pass: pass, fail: fail, skipped: skipped, results: results };
    // 服务端可读的回传（用 file:// 打开时没有服务端，跳过）
    if (/^https?:/.test(location.protocol)) {
      // 失败项连同**具体数值**一起回传：只回一个标题，等于把"为什么失败"留在页面里取不出来
      var failed = results.filter(function (r) { return !r.pass; })
        .map(function (r) { return r.label + (r.detail ? ' {\u5B9E\u6D4B: ' + r.detail + '}' : ''); })
        .join(' | ').slice(0, 900);
      var skippedLabels = results.filter(function (r) { return r.skipped; })
        .map(function (r) { return r.label; }).join(' | ');
      try {
        fetch('/__report?pass=' + pass + '&fail=' + fail + '&skip=' + skipped +
          '&skipped=' + encodeURIComponent(skippedLabels) +
          '&failed=' + encodeURIComponent(failed), { cache: 'no-store' });
      } catch (e) { /* 回传失败不影响断言结果本身 */ }
    }
  }

  run().catch(function (err) {
    ok(false, '\u81EA\u68C0\u8FC7\u7A0B\u629B\u51FA\u5F02\u5E38', err && err.message);
    finish();
  });
})();
