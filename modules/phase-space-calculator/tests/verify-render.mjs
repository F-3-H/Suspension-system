/**
 * verify-render.mjs —— 渲染层的结构断言（不需要浏览器）
 *
 * 背景：一维相线与三维投影这两条路径，本轮的浏览器能力在中途关闭了
 * （Chromium 启动即因命名管道被拒而退出：platform_channel Check failed 拒绝访问 0x5），
 * 没法再抓屏。于是换一条路：用一个**记录型 2D 上下文**接住渲染层的所有绘图调用，
 * 再对"它请求画了什么"做几何断言。
 *
 * 这不是截图替代品（颜色、抗锯齿、观感它管不了），但它能把下面这些"安静的错"钉死：
 * 箭头画到画布外、方向反了、点阵少了一半、投影不是可逆的、轨迹少画一段、颜色与 |f| 脱钩。
 *
 * 运行：node tests/verify-render.mjs      （退出码 0 = 全过）
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

const PSExpr = require(path.join(srcDir, 'expr.js'));
const PSPhase = require(path.join(srcDir, 'core.js'));
const PSRender = require(path.join(srcDir, 'render.js'));

let pass = 0, fail = 0, group = '';
const failures = [];
function section(n) { group = n; console.log('\n== ' + n + ' =='); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; failures.push(group + ' / ' + label + (detail ? '  \u2192 ' + detail : '')); console.log('  \u2717 ' + label + (detail ? '  \u2192 ' + detail : '')); }
}

// ---------------------------------------------------------------- 记录型画布
function makeRecorder(w, h) {
  const ops = [];
  const ctx = {
    canvas: { width: w, height: h },
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, lineJoin: '', lineCap: '',
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    beginPath() { ops.push(['beginPath']); },
    closePath() { ops.push(['closePath']); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    arc(x, y, r) { ops.push(['arc', x, y, r]); },
    rect(x, y, ww, hh) { ops.push(['rect', x, y, ww, hh]); },
    fillRect(x, y, ww, hh) { ops.push(['fillRect', x, y, ww, hh]); },
    strokeRect(x, y, ww, hh) { ops.push(['strokeRect', x, y, ww, hh]); },
    clip() { ops.push(['clip']); },
    stroke() { ops.push(['stroke', this.strokeStyle, this.lineWidth]); },
    fill() { ops.push(['fill', this.fillStyle]); },
    fillText(t, x, y) { ops.push(['fillText', t, x, y]); },
    setLineDash(a) { ops.push(['setLineDash', (a || []).slice()]); },
    translate(x, y) { ops.push(['translate', x, y]); },
    rotate(a) { ops.push(['rotate', a]); },
    scale(x, y) { ops.push(['scale', x, y]); },
    setTransform() { ops.push(['setTransform']); },
    drawImage(img, x, y, w2, h2) { ops.push(['drawImage', img, x, y, w2, h2]); },
    createImageData(w2, h2) { return { width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) }; },
    putImageData() { ops.push(['putImageData']); },
    getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText(t) { return { width: String(t).length * 6 }; }
  };
  return { ctx, ops };
}
/** 一支箭头 = 10 个绘图调用的固定形状；据此把箭头从其它线条里挑出来 */
function extractArrows(ops) {
  const out = [];
  for (let i = 0; i + 9 < ops.length; i++) {
    const o = ops[i];
    if (o[0] !== 'beginPath') continue;
    if (ops[i + 1][0] !== 'moveTo' || ops[i + 2][0] !== 'lineTo' || ops[i + 3][0] !== 'stroke') continue;
    if (ops[i + 4][0] !== 'beginPath' || ops[i + 5][0] !== 'moveTo' || ops[i + 6][0] !== 'lineTo') continue;
    if (ops[i + 7][0] !== 'lineTo' || ops[i + 8][0] !== 'closePath' || ops[i + 9][0] !== 'fill') continue;
    out.push({
      x0: ops[i + 1][1], y0: ops[i + 1][2],
      x1: ops[i + 2][1], y1: ops[i + 2][2],
      color: ops[i + 3][1], width: ops[i + 3][2]
    });
    i += 9;
  }
  return out;
}
function rgbOf(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
  return m ? [+m[1], +m[2], +m[3]] : null;
}

const W = 900, H = 600;
const PAD2D = { l: 56, r: 20, t: 20, b: 36 };

// ---------------------------------------------------------------- 1. 视图变换
section('\u89C6\u56FE\u53D8\u6362\uFF08\u4E16\u754C\u2194\u5C4F\u5E55\uFF09');
{
  const bounds = [[-3.5, 3.5], [-4, 4]];
  const v = PSRender.makeView(bounds, W, H, PAD2D);
  let worst = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const x = -3.5 + 7 * i / 10, y = -4 + 8 * j / 10;
      const s = v.toScreen(x, y);
      const b = v.toWorld(s[0], s[1]);
      worst = Math.max(worst, Math.abs(b[0] - x), Math.abs(b[1] - y));
    }
  }
  ok(worst < 1e-9, 'toScreen \u4E0E toWorld \u4E92\u4E3A\u9006\u8FD0\u7B97\uFF08\u5F80\u8FD4\u8BEF\u5DEE < 1e-9\uFF09', worst.toExponential(2));
  const s0 = v.toScreen(-3.5, 4);
  ok(Math.abs(s0[0] - PAD2D.l) < 1e-9 && Math.abs(s0[1] - PAD2D.t) < 1e-9, '\u89C6\u7A97\u5DE6\u4E0A\u89D2\u6620\u5C04\u5230\u5185\u533A\u5DE6\u4E0A\u89D2');
  const s1 = v.toScreen(3.5, -4);
  ok(Math.abs(s1[0] - (W - PAD2D.r)) < 1e-9 && Math.abs(s1[1] - (H - PAD2D.b)) < 1e-9, '\u89C6\u7A97\u53F3\u4E0B\u89D2\u6620\u5C04\u5230\u5185\u533A\u53F3\u4E0B\u89D2');
  ok(v.toScreen(0, 1)[1] < v.toScreen(0, -1)[1], 'y \u8F74\u65B9\u5411\u6B63\u786E\uFF08\u6570\u503C\u5927\u5728\u5C4F\u5E55\u4E0A\u65B9\uFF09');
}

// ---------------------------------------------------------------- 2. 色标
section('\u8272\u6807\uFF08\u989C\u8272 = \u5411\u91CF\u6A21\uFF09');
{
  // 不变式应当是"由冷到暖"：(R-G) 单调不减。红分量本身在末段会略降（240→228），
  // 那是橙→红过渡的正常形状，不是错误——按红分量单调去断言会误报。
  const warmth = [];
  for (let t = 0; t <= 1.0001; t += 0.05) { const c = PSRender.colormap(t); warmth.push(c[0] - c[1]); }
  let mono = true;
  for (let i = 1; i < warmth.length; i++) if (warmth[i] < warmth[i - 1] - 2) mono = false;
  ok(mono, '\u989C\u8272\u7531\u51B7\u5230\u6696\u5355\u8C03\uFF08R-G \u5355\u8C03\u4E0D\u51CF\uFF09', warmth.join(','));
  const c0 = PSRender.colormap(0), c1 = PSRender.colormap(1);
  ok(c0[2] > c0[0] && c1[0] > c1[2], '\u4E24\u7AEF\u989C\u8272\u4E0D\u540C\uFF08\u4F4E\u7AEF\u7F16\u84DD\u7EFF\u3001\u9AD8\u7AEF\u7F16\u7EA2\uFF09');
  ok(PSRender.formatTick(Math.PI, true) === '\u03C0' &&
    PSRender.formatTick(-Math.PI / 2, true) === '-\u03C0/2' &&
    PSRender.formatTick(3 * Math.PI / 2, true) === '3\u03C0/2' &&
    PSRender.formatTick(-3 * Math.PI / 2, true) === '-3\u03C0/2' &&
    PSRender.formatTick(2 * Math.PI, true) === '2\u03C0',
    '\u89D2\u5EA6\u8F74\u523B\u5EA6\u6309 \u03C0 \u6807\u6CE8\uFF08\u4E0D\u80FD\u51FA\u73B0 "-1\u03C0/2" \u8FD9\u79CD\u5199\u6CD5\uFF09',
    [Math.PI, -Math.PI / 2, 3 * Math.PI / 2, -3 * Math.PI / 2, 2 * Math.PI].map(v => PSRender.formatTick(v, true)).join(' / '));
  ok(PSRender.formatTick(2.5, false) === '2.5', '\u666E\u901A\u8F74\u523B\u5EA6\u6309\u6570\u503C\u6807\u6CE8');
  // 角度轴要选 π 的简单倍数当步长，否则刻度落在 0.7854 这种数上（参考图是 -3π/2、π/2 这类）
  const cv = PSRender.makeView([[-3.5, 3.5], [-4, 4]], W, H, PAD2D);
  const rec = makeRecorder(W, H);
  PSRender.drawGrid(rec.ctx, cv, { names: ['theta', 'omega'] });
  const labels = rec.ops.filter(o => o[0] === 'fillText').map(o => String(o[1]));
  ok(labels.some(l => l.indexOf('\u03C0') >= 0), 'theta \u8F74\u7684\u523B\u5EA6\u786E\u5B9E\u843D\u5728 \u03C0 \u7684\u500D\u6570\u4E0A', labels.slice(0, 12).join(','));
}

// ---------------------------------------------------------------- 3. 二维向量场
section('\u4E8C\u7EF4\u5411\u91CF\u573A\uFF08\u77E2\u5934 / \u65B9\u5411 / \u989C\u8272\uFF09');
{
  const sys = PSExpr.compile('b = 0.5\n' + "theta' = omega\nomega' = -(9.8)*sin(theta) - b*omega").makeSystem(null);
  const bounds = [[-3.5, 3.5], [-4, 4]];
  const v = PSRender.makeView(bounds, W, H, PAD2D);
  const rec = makeRecorder(W, H);
  PSRender.drawBackground(rec.ctx, W, H);
  PSRender.drawGrid(rec.ctx, v, { names: ['theta', 'omega'] });
  const info = PSRender.drawVectorField2D(rec.ctx, v, sys, { cell: 36, t: 0 });
  const arrows = extractArrows(rec.ops);
  ok(arrows.length > 150 && arrows.length < 700, '\u77E2\u5934\u6570\u91CF\u5728\u5408\u7406\u533A\u95F4\uFF08\u683C\u70B9\u70B9\u9635\uFF09', 'count=' + arrows.length);
  ok(info.count >= arrows.length, '\u91C7\u6837\u70B9\u6570 \u2265 \u5B9E\u9645\u753B\u51FA\u7684\u77E2\u5934\u6570\uFF08\u96F6\u5411\u91CF\u5904\u4E0D\u753B\uFF09', info.count + ' vs ' + arrows.length);

  const pad = PAD2D;
  let outside = 0, maxLen = 0;
  for (const a of arrows) {
    for (const p of [[a.x0, a.y0], [a.x1, a.y1]]) {
      if (p[0] < pad.l - 1 || p[0] > W - pad.r + 1 || p[1] < pad.t - 1 || p[1] > H - pad.b + 1) outside++;
    }
    maxLen = Math.max(maxLen, Math.hypot(a.x1 - a.x0, a.y1 - a.y0));
  }
  ok(outside === 0, '\u6240\u6709\u7BAD\u5934\u90FD\u843D\u5728\u5185\u533A\u5185\uFF08\u6CA1\u6709\u753B\u5230\u8F74\u6807\u6CE8\u4E0A\uFF09', outside + ' \u4E2A\u8D8A\u754C');
  ok(maxLen <= 36, '\u7BAD\u5934\u957F\u5EA6\u4E0D\u8D85\u8FC7\u4E00\u4E2A\u683C\u8DDD\uFF08\u4E0D\u4F1A\u4E92\u76F8\u7A7F\u63D2\uFF09', maxLen.toFixed(2) + ' px');

  // 颜色与 |f| 的对应：把箭头中点换回世界坐标，算 |f|，比较最大与最小的红分量
  const f = new Float64Array(2);
  let best = null, worst = null;
  for (const a of arrows) {
    const mid = v.toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
    sys.f(Float64Array.of(mid[0], mid[1]), 0, f);
    const m = Math.hypot(f[0], f[1]);
    const c = rgbOf(a.color);
    if (!best || m > best.m) best = { m, c };
    if (!worst || m < worst.m) worst = { m, c };
  }
  ok(best.c[0] > worst.c[0] + 40, '\u989C\u8272\u786E\u5B9E\u7F16\u7801 |f|\uFF1A|f| \u6700\u5927\u7684\u7BAD\u5934\u6BD4\u6700\u5C0F\u7684\u660E\u663E\u504F\u7EA2',
    `max|f|=${best.m.toFixed(2)} rgb=${best.c}  min|f|=${worst.m.toFixed(3)} rgb=${worst.c}`);
  // 方向：单摆在上半平面（omega>0）时 theta' = omega > 0，箭头必须朝右（屏幕 x 增大）
  let dirBad = 0, dirChecked = 0;
  for (const a of arrows) {
    const mid = v.toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
    sys.f(Float64Array.of(mid[0], mid[1]), 0, f);
    if (Math.abs(f[0]) < 0.2) continue;
    dirChecked++;
    const screenDx = a.x1 - a.x0;
    if (Math.sign(screenDx) !== Math.sign(f[0])) dirBad++;
  }
  ok(dirChecked > 100 && dirBad === 0, 'theta\u02B9 = omega\uFF1A\u7BAD\u5934\u6C34\u5E73\u5206\u91CF\u7684\u7B26\u53F7\u4E0E\u5C4F\u5E55\u65B9\u5411\u4E00\u81F4',
    dirBad + ' / ' + dirChecked + ' \u65B9\u5411\u9519\u8BEF');

  // 不动点标记：稳定/不稳定用圆（arc），鞍点用菱形（三段 lineTo + closePath）
  const eqs = PSPhase.solveEquilibria(sys, bounds, { grid: 26 });
  const rec2 = makeRecorder(W, H);
  PSRender.drawEquilibria2D(rec2.ctx, v, eqs, { labels: true });
  const arcs = rec2.ops.filter(o => o[0] === 'arc');
  let diamonds = 0;
  for (let i = 0; i + 6 < rec2.ops.length; i++) {
    const o = rec2.ops;
    if (o[i][0] === 'beginPath' && o[i + 1][0] === 'moveTo' && o[i + 2][0] === 'lineTo' &&
      o[i + 3][0] === 'lineTo' && o[i + 4][0] === 'lineTo' && o[i + 5][0] === 'closePath' && o[i + 6][0] === 'stroke') diamonds++;
  }
  ok(eqs.length >= 3, '\u963B\u5C3C\u5355\u6446\u5728\u89C6\u7A97\u5185\u81F3\u5C11\u6709 3 \u4E2A\u4E0D\u52A8\u70B9', 'count=' + eqs.length);
  ok(arcs.length + diamonds >= eqs.length, '\u6BCF\u4E2A\u4E0D\u52A8\u70B9\u90FD\u88AB\u753B\u51FA\u6765\uFF08\u5706\u5708 + \u83F1\u5F62\uFF09',
    `arcs=${arcs.length} diamonds=${diamonds} eqs=${eqs.length}`);
  ok(diamonds >= 2, '\u4E24\u4E2A\u978D\u70B9\uFF08\u00B1\u03C0, 0\uFF09\u7528\u83F1\u5F62\u6807\u8BB0', 'diamonds=' + diamonds);
  const origin = v.toScreen(0, 0);
  const near = arcs.some(a => Math.abs(a[1] - origin[0]) < 1 && Math.abs(a[2] - origin[1]) < 1);
  ok(near, '\u539F\u70B9\u5904\u7684\u4E0D\u52A8\u70B9\u843D\u5728\u5B83\u5E94\u5728\u7684\u50CF\u7D20\u4F4D\u7F6E\u4E0A',
    `origin screen=(${origin[0].toFixed(1)},${origin[1].toFixed(1)})`);
  // 鞍点用菱形（moveTo/lineTo 三段闭合），稳定点用圆（arc）
  const rec3 = makeRecorder(W, H);
  PSRender.drawEquilibria2D(rec3.ctx, v, [{ x: Float64Array.of(0, 0), classification: { stable: false, type: '\u978D\u70B9' }, residual: 0 }], { labels: false });
  ok(rec3.ops.filter(o => o[0] === 'arc').length === 0 && rec3.ops.filter(o => o[0] === 'lineTo').length >= 3,
    '\u978D\u70B9\u7528\u83F1\u5F62\u800C\u4E0D\u662F\u5706\u5708\u6807\u8BB0');
}

// ---------------------------------------------------------------- 4. 零倾线
section('\u96F6\u503E\u7EBF\uFF08marching squares\uFF09');
{
  const sys = PSExpr.compile('b = 0.5\n' + "theta' = omega\nomega' = -(9.8)*sin(theta) - b*omega").makeSystem(null);
  const v = PSRender.makeView([[-3.5, 3.5], [-4, 4]], W, H, PAD2D);
  const rec = makeRecorder(W, H);
  PSRender.drawNullclines2D(rec.ctx, v, sys, { grid: 60 });
  const segs = rec.ops.filter(o => o[0] === 'moveTo').length;
  ok(segs > 50, '\u96F6\u503E\u7EBF\u4EA7\u751F\u4E86\u8DB3\u591F\u591A\u7684\u7EBF\u6BB5', 'segments=' + segs);
  ok(rec.ops.some(o => o[0] === 'setLineDash' && o[1].length > 0), '\u96F6\u503E\u7EBF\u7528\u865A\u7EBF\u533A\u5206\u4E8E\u5411\u91CF\u573A');
  const v1sys = PSExpr.compile("x' = 1").makeSystem(null);
  const rec2 = makeRecorder(W, H);
  PSRender.drawNullclines2D(rec2.ctx, v, v1sys, { grid: 40 });
  ok(rec2.ops.filter(o => o[0] === 'moveTo').length === 0, '\u65E0\u96F6\u503E\u7EBF\u7684\u7CFB\u7EDF\u753B\u51FA 0 \u6761\u7EBF\uFF08\u4E0D\u4F2A\u9020\uFF09');
}

// ---------------------------------------------------------------- 5. 一维相线
section('\u4E00\u7EF4\u76F8\u7EBF');
{
  const sys = PSExpr.compile('k = 1\n' + "x' = -k*x").makeSystem(null);
  const bounds = [[-2, 2]];
  const rec = makeRecorder(W, H);
  const eqs = PSPhase.solveEquilibria(sys, bounds, {});
  PSRender.drawPhaseLine1D(rec.ctx, W, H, sys, { bounds, equilibria: eqs, t: 0 });
  const arrows = extractArrows(rec.ops);
  ok(arrows.length >= 25, '\u76F8\u7EBF\u4E0A\u753B\u51FA\u4E86\u4E00\u6392\u7BAD\u5934', 'count=' + arrows.length);
  const toX = (val) => 56 + (val - bounds[0][0]) / (bounds[0][1] - bounds[0][0]) * (W - 28 - 56);
  const center = toX(0);
  let bad = 0;
  for (const a of arrows) {
    const midX = (a.x0 + a.x1) / 2;
    // x 为负的一半：f = -x > 0，箭头应朝右；正的一半朝左
    if (midX > center + 20 && a.x1 > a.x0) bad++;
    if (midX < center - 20 && a.x1 < a.x0) bad++;
  }
  ok(bad === 0, '\u1E8B = -x\uFF1A\u8D1F\u534A\u8F74\u7BAD\u5934\u5411\u53F3\u3001\u6B63\u534A\u8F74\u5411\u5DE6\uFF08\u65B9\u5411\u672A\u53CD\uFF09', bad + ' \u4E2A\u65B9\u5411\u9519\u8BEF');
  const arcs = rec.ops.filter(o => o[0] === 'arc');
  ok(arcs.some(a => Math.abs(a[1] - center) < 1), '\u4E0D\u52A8\u70B9 x=0 \u6807\u5728\u76F8\u7EBF\u7684\u4E2D\u70B9\u4E0A');
  const texts = rec.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
  ok(texts.some(t => String(t).indexOf('\u4E00\u7EF4\u76F8\u7A7A\u95F4') >= 0), '\u76F8\u7EBF\u4E0A\u6807\u6CE8\u4E86\u201C\u4E00\u7EF4\u76F8\u7A7A\u95F4\u201D\uFF08\u4E0D\u4F1A\u88AB\u8BEF\u8BA4\u4E3A\u65F6\u95F4\u5E8F\u5217\uFF09');

  // 时间依赖的一维系统：向量场必须随 t 变（否则"非自治"就只是嘴上说说）
  const sysT = PSExpr.compile('w = 1.3\n' + "x' = -x + cos(w*t)").makeSystem(null);
  const a1 = makeRecorder(W, H);
  PSRender.drawPhaseLine1D(a1.ctx, W, H, sysT, { bounds, t: 0 });
  const a2 = makeRecorder(W, H);
  PSRender.drawPhaseLine1D(a2.ctx, W, H, sysT, { bounds, t: 1.5 });
  const ar1 = extractArrows(a1.ops), ar2 = extractArrows(a2.ops);
  let diff = 0;
  for (let i = 0; i < Math.min(ar1.length, ar2.length); i++) if (Math.abs(ar1[i].x1 - ar1[i].x0 - (ar2[i].x1 - ar2[i].x0)) > 1) diff++;
  ok(diff > 3, '\u975E\u81EA\u6CBB\u7CFB\u7EDF\uFF1A\u4E0D\u540C t \u4E0B\u76F8\u7EBF\u4E0A\u7684\u7BAD\u5934\u786E\u5B9E\u4E0D\u540C', diff + ' \u4E2A\u7BAD\u5934\u53D1\u751F\u53D8\u5316');
}

// ---------------------------------------------------------------- 6. 三维投影
section('\u4E09\u7EF4\u6295\u5F71\u4E0E\u7ED8\u5236');
{
  const cam = PSRender.makeCamera({});
  let worst = 0;
  for (let i = 0; i < 50; i++) {
    const x = -3 + 6 * Math.random(), y = -3 + 6 * Math.random(), z = -3 + 6 * Math.random();
    const p = PSRender.project3(cam, x, y, z, W, H, 3);
    const back = PSRender.unproject3(cam, p[0], p[1], p[2], W, H, 3);
    worst = Math.max(worst, Math.abs(back[0] - x), Math.abs(back[1] - y), Math.abs(back[2] - z));
  }
  ok(worst < 1e-9, 'project3 \u4E0E unproject3 \u4E92\u4E3A\u9006\u8FD0\u7B97\uFF08\u5F80\u8FD4\u8BEF\u5DEE < 1e-9\uFF09', worst.toExponential(2));

  const sys = PSExpr.compile('sigma = 10\nrho = 28\nbeta = 2.6666667\n' +
    "x' = sigma*(y - x)\ny' = x*(rho - z) - y\nz' = x*y - beta*z").makeSystem(null);
  const bounds = [[-25, 25], [-30, 30], [0, 55]];
  // 相机必须注视视窗中心（否则 z∈[0,55] 的吸引子会整块投影到画布外）
  const camL = PSRender.makeCamera({ center: bounds.map(r => (r[0] + r[1]) / 2) });
  const traj = PSPhase.integrate(sys, Float64Array.of(1, 1, 20), 0, 0.01, 800, 'rk4');
  const rec = makeRecorder(W, H);
  PSRender.draw3D(rec.ctx, W, H, sys, camL, { bounds, traj, step: 400, marker: [1, 1, 20], field: true, fieldGrid: 5, t: 0 });
  const arrows = extractArrows(rec.ops);
  ok(arrows.length === 125, '\u4E09\u7EF4\u5411\u91CF\u573A\uFF1A5\u00D75\u00D75 = 125 \u652F\u7BAD\u5934', 'count=' + arrows.length);
  let outside = 0;
  for (const a of arrows) {
    for (const p of [[a.x0, a.y0], [a.x1, a.y1]]) {
      if (p[0] < -0.1 * W || p[0] > 1.1 * W || p[1] < -0.1 * H || p[1] > 1.1 * H) outside++;
    }
  }
  ok(outside === 0, '\u6240\u6709\u4E09\u7EF4\u7BAD\u5934\u90FD\u6295\u5F71\u5728\u753B\u5E03\u9644\u8FD1\u5185\uFF08\u6CA1\u6709\u98DE\u5230\u51E0\u4E07\u50CF\u7D20\u5916\uFF09', outside + ' \u4E2A\u8D8A\u754C');
  const texts = rec.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
  ok(['x', 'y', 'z'].every(n => texts.indexOf(n) >= 0), '\u4E09\u4E2A\u5750\u6807\u8F74\u540D\u90FD\u88AB\u6807\u6CE8', texts.slice(0, 8).join(','));
  // 轨迹段数：step=400 应产生 400 段折线
  const strokes = rec.ops.filter(o => o[0] === 'stroke' && /rgba\(120,240,255/.test(o[1])).length;
  ok(strokes === 400, '\u8F68\u8FF9\u6309\u6DF1\u5EA6\u5206\u6BB5\u7ED8\u5236\uFF0C\u6BB5\u6570 = \u63A8\u8FDB\u6B65\u6570', strokes + ' vs 400');
  const markerArc = rec.ops.some(o => o[0] === 'arc' && o[3] === 6);
  ok(markerArc, '\u5F53\u524D\u72B6\u6001\u70B9\u88AB\u753B\u51FA\u6765\uFF08\u5E26\u5149\u6655\u5708\uFF09');
}

// ---------------------------------------------------------------- 7. 时间序列
section('\u65F6\u95F4\u5E8F\u5217');
{
  const sys = PSExpr.compile('b = 0.5\n' + "theta' = omega\nomega' = -(9.8)*sin(theta) - b*omega").makeSystem(null);
  const traj = PSPhase.integrate(sys, Float64Array.of(2.2, 0), 0, 0.01, 2000, 'rk4');
  traj.varNames = sys.varNames;
  const rec = makeRecorder(W, H);
  PSRender.drawTimeSeries(rec.ctx, W, H, traj, { step: 1000 });
  const colors = {};
  rec.ops.filter(o => o[0] === 'stroke').forEach(o => { colors[o[1]] = (colors[o[1]] || 0) + 1; });
  const seriesColors = Object.keys(colors).filter(c => /^#/.test(c));
  ok(seriesColors.length === 2, '\u4E24\u4E2A\u72B6\u6001\u5206\u91CF\u7528\u4E24\u79CD\u989C\u8272\u5206\u522B\u7ED8\u5236', seriesColors.join(' '));
  // 每条曲线是"一条路径 + 一次 stroke"：真正要数的是 lineTo 的笔数，不是 stroke 次数
  const lineTos = rec.ops.filter(o => o[0] === 'lineTo').length;
  ok(lineTos >= 2000, '\u4E24\u6761\u66F2\u7EBF\u5171\u753B\u51FA 2000+ \u4E2A\u6298\u7EBF\u70B9\uFF08\u6BCF\u4E2A\u5206\u91CF 1000 \u6B65\uFF09', 'lineTo=' + lineTos);
  const strokesOfSeries = rec.ops.filter(o => o[0] === 'stroke' && /^#/.test(o[1])).length;
  // 每条曲线是"一条路径 + 一次 stroke"：这里数连续 lineTo 的长游程，正好两条（网格线与零线是短游程）
  const runs = [];
  let run = 0;
  for (const o of rec.ops) {
    if (o[0] === 'lineTo') run++;
    else { if (run > 0) runs.push(run); run = 0; }
  }
  const longRuns = runs.filter(r => r >= 1000);
  ok(longRuns.length === 2, '\u4E24\u6761\u66F2\u7EBF\u5404\u81EA\u662F\u4E00\u6761\u72EC\u7ACB\u8DEF\u5F84\uFF08\u957F\u6E38\u7A0B\u6070\u597D 2 \u6761\uFF09',
    'runs=' + runs.join(',') + ' longRuns=' + longRuns.length);
  ok(strokesOfSeries === 2, '\u6BCF\u4E2A\u72B6\u6001\u5206\u91CF\u53EA\u753B\u4E00\u6B21\uFF08\u4E0D\u91CD\u590D\u63CF\u8FB9\uFF09', 'seriesStrokes=' + strokesOfSeries);
  const cursor = rec.ops.filter(o => o[0] === 'stroke' && /rgba\(255,255,255/.test(o[1]));
  ok(cursor.length >= 1, '\u5F53\u524D\u65F6\u523B\u6E38\u6807\u5DF2\u7ED8\u5236');
  const texts = rec.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
  ok(texts.some(t => /^t = /.test(String(t))), '\u56FE\u4E0A\u6807\u51FA\u4E86\u5F53\u524D t', texts.filter(t => /^t = /.test(String(t))).join(''));
  ok(texts.indexOf('theta') >= 0 && texts.indexOf('omega') >= 0, '\u66F2\u7EBF\u56FE\u4F8B\u7528\u53D8\u91CF\u540D\u800C\u4E0D\u662F x0/x1');
}

// ---------------------------------------------------------------- 8. 抽象示意图
section('\u5DE6\u4E0A\u89D2\u793A\u610F\u56FE\uFF08\u72B6\u6001=\u70B9\u3001\u5C5E\u6027=\u8F74\uFF09');
{
  for (const dim of [1, 2, 3]) {
    const sys = PSExpr.compile(
      dim === 1 ? "x' = -x" : (dim === 2 ? "x' = y\ny' = -x" : "x' = y\ny' = -x\nz' = -0.5*z")
    ).makeSystem(null);
    const state = Float64Array.from({ length: dim }, (_, i) => 0.5 * (i + 1));
    const rec = makeRecorder(234, 92);
    PSRender.drawSchematic(rec.ctx, 234, 92, dim, state, sys.f(state, 0), sys.varNames);
    const texts = rec.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
    ok(texts.length >= dim, dim + ' \u7EF4\u793A\u610F\u56FE\u4E0A\u6BCF\u4E2A\u5C5E\u6027\u90FD\u6709\u8F74\u540D', texts.join(','));
    const hasDot = rec.ops.some(o => o[0] === 'arc' && o[3] === 4.5);
    ok(hasDot, dim + ' \u7EF4\u793A\u610F\u56FE\u4E0A\u6709\u201C\u72B6\u6001\u70B9\u201D');
    ok(extractArrows(rec.ops).length >= 1, dim + ' \u7EF4\u793A\u610F\u56FE\u4E0A\u6709\u201C\u72B6\u6001\u6B63\u5728\u5F80\u54EA\u8D70\u201D\u7684\u7BAD\u5934');
  }
}

// ---------------------------------------------------------------- 9. 随机模式的密度图与频谱
section('\u6982\u7387\u5BC6\u5EA6\u70ED\u56FE\u4E0E\u529F\u7387\u8C31');
{
  const PSRandom = require(path.join(srcDir, 'random.js'));
  const nx = 40, ny = 30;
  const dens = new Float64Array(nx * ny);
  dens[5 + 3 * nx] = 1;
  dens[20 + 15 * nx] = 100;
  dens[21 + 15 * nx] = 50;
  const img = PSRender.densityImage(dens, nx, ny, { gain: 300 });
  ok(img.width === nx && img.height === ny && img.data.length === nx * ny * 4,
    '\u5BC6\u5EA6\u56FE\u5C3A\u5BF8\u4E0E RGBA \u957F\u5EA6\u6B63\u786E', `${img.width}x${img.height} bytes=${img.data.length}`);
  const cell = (x, y) => {
    const o = ((ny - 1 - y) * nx + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  ok(cell(20, 15)[3] > 0 && cell(5, 3)[3] > 0, '\u6709\u683C\u5B50\u7684\u5750\u6807\u4E0A\u50CF\u7D20\u4E0D\u900F\u660E');
  ok(cell(0, 0)[3] === 0, '\u7A7A\u683C\u5B50\u5B8C\u5168\u900F\u660E\uFF08\u4E0D\u6C61\u67D3\u5E95\u56FE\uFF09');
  const lum = (c) => c[0] + c[1] + c[2];
  const hot = cell(20, 15), warm = cell(21, 15), cool = cell(5, 3);
  ok(lum(hot) > lum(warm) && lum(warm) > lum(cool), '\u989C\u8272\u968F\u5BC6\u5EA6\u5355\u8C03\u53D8\u4EAE\uFF08\u5BF9\u6570\u8272\u6807\u5F88\u91CD\u8981\uFF1A\u5426\u5219\u4E00\u4E2A\u5CF0\u5403\u6EE1\u5168\u56FE\uFF09',
    `hot=${lum(hot)} warm=${lum(warm)} cool=${lum(cool)}`);
  let maxCell = 0;
  for (let i = 0; i < dens.length; i++) if (dens[i] > dens[maxCell]) maxCell = i;
  ok(img.maxDensity === dens[maxCell], '\u56FE\u4E0A\u8BB0\u4E0B\u4E86\u5BC6\u5EA6\u5CF0\u503C', String(img.maxDensity));

  const v = PSRender.makeView([[-0.2, 0.2], [-2, 2]], W, H, PAD2D);
  const rec = makeRecorder(W, H);
  PSRender.drawDensity2D(rec.ctx, v, { canvas: { __fake: true } }, {});
  const draws = rec.ops.filter(o => o[0] === 'drawImage');
  ok(draws.length === 1, '\u5BC6\u5EA6\u56FE\u53EA\u7528\u4E00\u6B21 drawImage \u94FA\u5230\u753B\u5E03\u4E0A', 'drawImage=' + draws.length);
  ok(rec.ops.filter(o => o[0] === 'fillRect').length === 0, '\u4E0D\u9010\u683C fillRect\uFF08\u5426\u5219\u6BCF\u5E27\u4E0A\u4E07\u6B21\u8C03\u7528\uFF09');

  const dt = 0.005, NN = 4096;
  const sig = new Float64Array(NN);
  for (let i = 0; i < NN; i++) sig[i] = Math.sin(8 * i * dt) + 0.3 * Math.sin(20 * i * dt);
  const ps = PSRandom.psdEstimate(sig, dt, { segments: 4 });
  const rec2 = makeRecorder(420, 150);
  PSRender.drawPSD(rec2.ctx, 420, 150, { response: ps, excitation: ps, wMin: 1, wMax: 40, markW: 8 });
  ok(rec2.ops.filter(o => o[0] === 'stroke').length >= 2, '\u529F\u7387\u8C31\u56FE\u753B\u51FA\u4E86\u81F3\u5C11\u4E24\u6761\u66F2\u7EBF\uFF08\u8F93\u5165\u8C31 + \u54CD\u5E94\u8C31\uFF09',
    'strokes=' + rec2.ops.filter(o => o[0] === 'stroke').length);
  ok(rec2.ops.filter(o => o[0] === 'lineTo').length > 50, '\u66F2\u7EBF\u6709\u8DB3\u591F\u591A\u7684\u6298\u70B9', 'lineTo=' + rec2.ops.filter(o => o[0] === 'lineTo').length);
  const texts2 = rec2.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
  ok(texts2.some(t => String(t).indexOf('\u03C9') >= 0), '\u6A2A\u8F74\u6807\u4E86 \u03C9 /(rad/s)', texts2.join(','));
  // 峰值不能贴在框顶：贴顶看起来就像被裁掉了（本轮截图里发现）
  const lineYs = rec2.ops.filter(o => o[0] === 'lineTo').map(o => o[2]);
  const topMost = Math.min.apply(null, lineYs);
  ok(topMost >= 20, '\u54CD\u5E94\u8C31\u5CF0\u503C\u4E0D\u8D34\u6846\u9876\uFF08\u7559\u4E86\u4F59\u91CF\uFF09', 'y\u6700\u5C0F=' + topMost.toFixed(1));
  ok(texts2.some(t => String(t).indexOf('\u54CD\u5E94\u5CF0\u503C') >= 0), '\u6807\u51FA\u4E86\u54CD\u5E94\u5CF0\u503C\u6570\u503C', texts2.join(','));
  const rec3 = makeRecorder(420, 150);
  PSRender.drawPSD(rec3.ctx, 420, 150, { response: null, excitation: null });
  ok(rec3.ops.length > 3, '\u6CA1\u6709\u6570\u636E\u65F6\u4E5F\u4E0D\u629B\u9519\uFF08\u53EA\u753B\u7A7A\u767D\u6846\uFF09');
}

// ---------------------------------------------------------------- 10. 时间序列：两支同轴
section('\u65F6\u95F4\u5E8F\u5217\uFF1A\u6B63\u5411\u4E0E\u56DE\u6EAF\u540C\u4E00\u6761\u65F6\u95F4\u8F74');
{
  const sys = PSExpr.compile('b = 0.5\n' + "d\u03B8/dt = \u03C9\nd\u03C9/dt = -(9.8)*sin(\u03B8) - b*\u03C9").makeSystem(null, null);
  const trajF = PSPhase.integrate(sys, Float64Array.of(2.6, 0), 0, 0.01, 1000, 'rk4');
  trajF.varNames = sys.varNames;
  const trajB = PSPhase.integrate(sys, Float64Array.of(2.6, 0), 0, -0.01, 500, 'rk4');
  trajB.varNames = sys.varNames;
  const rec = makeRecorder(W, H);
  PSRender.drawTimeSeries(rec.ctx, W, H, trajF, { step: 500, backwardTraj: trajB, backwardLimit: 500, tCurrent: 0 });
  const texts = rec.ops.filter(o => o[0] === 'fillText').map(o => o[1]);
  ok(!texts.some(t => /NaN/.test(String(t))), '\u65F6\u95F4\u6807\u6CE8\u91CC\u6CA1\u6709 NaN', texts.slice(0, 4).join(','));
  // 折线点数 ≈（正向 500 步 + 回溯 500 步）× 2 个分量：两支都完整画了出来
  const lts = rec.ops.filter(o => o[0] === 'lineTo').length;
  ok(lts >= 1800, '\u4E24\u6761\u652F\u90FD\u6309\u5404\u81EA\u7684\u91C7\u6837\u6570\u753B\u4E86\u51FA\u6765',
    'lineTo=' + lts + '\uFF08\u671F\u671B \u2248 2000\uFF09');
  ok(rec.ops.filter(o => o[0] === 'stroke').length >= 4, '\u6B63\u5411\u4E24\u4E2A\u5206\u91CF + \u56DE\u6EAF\u4E24\u4E2A\u5206\u91CF\uFF0C\u5171 4 \u6761\u66F2\u7EBF',
    'strokes=' + rec.ops.filter(o => o[0] === 'stroke').length);
  // 时间轴必须是"从 min 到 max"而不是"从 t[0] 到 t[n-1]"：
  // 后者在回溯支上会让曲线从右往左长（这正是"回溯看起来出问题"的一个来源）
  const firstX = (() => {
    const i = rec.ops.findIndex(o => o[0] === 'lineTo');
    return i > 0 ? rec.ops[i][1] : NaN;
  })();
  ok(isFinite(firstX) && firstX >= 56 && firstX <= W - 18, '\u66F2\u7EBF\u8D77\u70B9\u843D\u5728\u56FE\u5185\u7684\u5408\u7406\u4F4D\u7F6E', String(firstX));
  const rec2 = makeRecorder(W, H);
  PSRender.drawTimeSeries(rec2.ctx, W, H, trajF, { step: 300 });
  ok(rec2.ops.length > 50, '\u53EA\u7ED9\u6B63\u5411\u652F\u65F6\u884C\u4E3A\u4E0D\u53D8\uFF08\u5411\u540E\u517C\u5BB9\uFF09');
}

console.log('\n' + '='.repeat(60));
console.log(`\u901A\u8FC7 ${pass} \u9879\uFF0C\u5931\u8D25 ${fail} \u9879`);
if (fail) { console.log('\n\u5931\u8D25\u6E05\u5355\uFF1A'); failures.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
