/**
 * verify-app.mjs —— 把**真正的 app.js** 放进一个假 DOM 里跑，断言"界面自己会重绘"
 *
 * 为什么必须有这一层（本轮人系统报障的直接产物）：
 *   相图渲染得好好的，但**任何操作都没反应、画面永远不变**。
 *   根因是启动时那个帧循环写错了：
 *       requestAnimationFrame(function loop(){ if (S.dirty) render(); tick(); });
 *       function tick(){ stepPlayback(1); requestAnimationFrame(tick); }
 *   第一帧由 loop 渲染一次，随后 loop 把接力棒交给 tick，而 tick 排的是它自己 ——
 *   于是 `if (S.dirty) render()` 再也不会执行：markDirty() 设的标志没人读，画面冻在第一帧。
 *
 * 而当时 37 项浏览器内自检**全部通过**，因为它们每一步之后都调用 px.renderNow() 帮应用渲染了一次：
 * 自检自己替被测系统干了那件事，于是把缺陷盖住了。
 *
 * 因此这一层只做一件事：**不许帮忙**。断言必须以"帧"为单位推进——
 * 交互之后只允许 rAF 帧往前走，然后检查画面调用序列有没有变化。
 *
 * 运行：node tests/verify-app.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const srcDir = path.join(root, 'src');

let pass = 0, fail = 0, group = '';
const failures = [];
function section(n) { group = n; console.log('\n== ' + n + ' =='); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; failures.push(group + ' / ' + label + (detail ? '  \u2192 ' + detail : '')); console.log('  \u2717 ' + label + (detail ? '  \u2192 ' + detail : '')); }
}

// ---------------------------------------------------------------- 记录型画布
function makeCanvasContext() {
  const ops = [];
  const ctx = {
    canvas: null,
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, lineJoin: '', lineCap: '',
    save() { ops.push(['save']); }, restore() { ops.push(['restore']); },
    beginPath() { ops.push(['beginPath']); }, closePath() { ops.push(['closePath']); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); }, lineTo(x, y) { ops.push(['lineTo', x, y]); },
    arc(x, y, r) { ops.push(['arc', x, y, r]); },
    rect(x, y, w, h) { ops.push(['rect', x, y, w, h]); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h]); },
    strokeRect(x, y, w, h) { ops.push(['strokeRect', x, y, w, h]); },
    clip() { ops.push(['clip']); },
    stroke() { ops.push(['stroke', this.strokeStyle, this.lineWidth]); },
    fill() { ops.push(['fill', this.fillStyle]); },
    fillText(t, x, y) { ops.push(['fillText', String(t), x, y]); },
    setLineDash(a) { ops.push(['setLineDash', (a || []).slice()]); },
    translate(x, y) { ops.push(['translate', x, y]); }, rotate(a) { ops.push(['rotate', a]); },
    scale(x, y) { ops.push(['scale', x, y]); }, setTransform() { ops.push(['setTransform']); },
    drawImage(img, x, y, w, h) { ops.push(['drawImage', img, x, y, w, h]); },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { ops.push(['putImageData']); },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText(t) { return { width: String(t).length * 6 }; },
    getImageData() { throw new Error('\u5047\u753B\u5E03\u4E0D\u505A\u5149\u6805\u5316\uFF1A\u50CF\u7D20\u7EA7\u65AD\u8A00\u8BF7\u7528\u6D4F\u89C8\u5668\u5185\u81EA\u68C0'); }
  };
  return { ops, ctx };
}

// ---------------------------------------------------------------- 假 DOM
const SIZES = { view: [900, 520], series: [900, 168], schematic: [234, 92], legend: [132, 36] };

function makeEl(tag, attrs, id) {
  const rec = makeCanvasContext();
  const el = {
    tagName: String(tag).toUpperCase(),
    id: id || '',
    attrs: attrs || {},
    style: {},
    children: [],
    listeners: {},
    _innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    title: '',
    className: (attrs && attrs.class) || '',
    _ops: rec.ops,
    _ctx: rec.ctx,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; if (v) this._s.add(c); else this._s.delete(c); return v; }
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    getBoundingClientRect() {
      const s = SIZES[this.id] || [600, 400];
      return { left: 0, top: 0, width: s[0], height: s[1], right: s[0], bottom: s[1] };
    },
    getContext() { return this._ctx; },
    querySelectorAll(sel) {
      const all = [];
      (function walk(n) { n.children.forEach(c => { all.push(c); walk(c); }); })(this);
      return all.filter(e => matches(e, sel));
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    dispatch(type, ev) {
      // 真 DOM 的事件会冒泡：#params 上挂的监听器要能收到子元素 input 发的事件，
      // 否则"拖滑杆"这条路径在假 DOM 里根本走不通（本轮就踩了这个：见下方参数滑杆断言）
      const base = {
        type, target: this, preventDefault() {}, stopPropagation() {}, shiftKey: false,
        button: 0, buttons: 1, pointerId: 1
      };
      const event = Object.assign(base, ev);
      let node = this;
      while (node) {
        (node.listeners[type] || []).forEach(fn => fn(event));
        node = node.parent || null;
      }
    }
  };
  el.width = (SIZES[el.id] || [600, 400])[0];
  el.height = (SIZES[el.id] || [600, 400])[1];
  rec.ctx.canvas = el;
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = String(v);
      el.children = parseChildren(el._innerHTML);
      el.children.forEach(c => { c.parent = el; });
      // 真 DOM 里 textContent 与 innerHTML 是同一份内容的两种读法；
      // 假 DOM 若只存 innerHTML，用 textContent 写的断言就会全部落空（本轮踩过）
      el.textContent = el._innerHTML.replace(/<[^>]*>/g, '');
    }
  });
  return el;
}
function matches(el, sel) {
  // 支持三种选择器：`tag`、`[attr]`、`tag[attr="value"]` —— 够本套件用，
  // 而且"属性选择器"必须支持**值**比较：`[data-param="k"]` 与 `[data-param="m"]` 要能区分开，
  // 否则断言会悄悄拿了另一个滑杆（这正是"假 DOM 的部分保真替断言决定成败"那一类坑）
  const m = /^([a-zA-Z]*)\s*(?:\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\])?$/.exec(sel.trim());
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  if (m[2] !== undefined) {
    if (el.attrs[m[2]] === undefined) return false;
    const want = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
    if (want !== undefined && String(el.attrs[m[2]]) !== String(want)) return false;
  }
  return true;
}
/** 只解析出"可被 querySelectorAll 找到"的元素，够用即可（内联 input/button/option/span） */
function parseChildren(html) {
  const out = [];
  const re = /<(input|button|option|span|div)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    // 自闭合/无内容的 span 也要能被选中（派生量读数是 <span class="derivedval" data-derived="w0">）
    const el = makeEl(m[1], attrs, attrs.id);
    const tagEnd = html.indexOf('>', m.index);
    const close = html.indexOf('</' + m[1] + '>', tagEnd);
    if (close > tagEnd) el.textContent = html.slice(tagEnd + 1, close).replace(/<[^>]*>/g, '');
    out.push(el);
  }
  return out;
}

// ---------------------------------------------------------------- 从 index.html 建注册表
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const registry = new Map();
{
  const re = /<([a-zA-Z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    registry.set(m[3], makeEl(m[1], attrs, m[3]));
  }
  // select 的默认选中项：按 HTML 里的 selected 决定，别在测试里写死
  for (const sel of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const el = registry.get(sel[1]);
    if (!el) continue;
    const opts = [...sel[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(o => {
      const v = /value="([^"]*)"/.exec(o[1]);
      return { value: v ? v[1] : o[2].trim(), selected: /\bselected\b/.test(o[1]) };
    });
    const chosen = opts.find(o => o.selected) || opts[0];
    if (chosen) el.value = chosen.value;
  }
  // 静态子元素：维度切换器的三个按钮、开关复选框
  const dimTabs = registry.get('dimTabs');
  if (dimTabs) [1, 2, 3].forEach(d => dimTabs.children.push(makeEl('button', { 'data-dim': String(d) }, '')));
  // 复选框的 checked 初值按 HTML 的 checked 属性
  for (const cb of html.matchAll(/<input\b([^>]*type="checkbox"[^>]*)>/g)) {
    const id = /id="([^"]+)"/.exec(cb[1]);
    if (id && registry.has(id[1])) registry.get(id[1]).checked = /\bchecked\b/.test(cb[1]);
  }
}

// ---------------------------------------------------------------- 假 window
const rafQueue = [];
let rafScheduled = 0;
const doc = {
  readyState: 'complete',
  addEventListener() {},
  getElementById(id) { return registry.get(id) || null; },
  querySelectorAll() { return []; },
  createElement(tag, attrs) { return makeEl(tag, attrs || {}, ''); }
};
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.location = { search: '', protocol: 'file:', href: 'file:///index.html' };
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); rafScheduled++; return rafQueue.length; };
// window === globalThis，所以 window.addEventListener 就是 globalThis.addEventListener
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.devicePixelRatio = 1;
// Node 24 的 navigator 是只读 getter，不能覆盖；app.js 也不用它，故跳过
globalThis.PointerEvent = function () {};

const PSExpr = require(path.join(srcDir, 'expr.js'));
const PSPhase = require(path.join(srcDir, 'core.js'));
const PSPresets = require(path.join(srcDir, 'presets.js'));
const PSRender = require(path.join(srcDir, 'render.js'));
const PSRandom = require(path.join(srcDir, 'random.js'));
void PSExpr; void PSPhase; void PSPresets; void PSRender; void PSRandom;

/** 只推进"帧"，绝不替应用渲染 */
function runFrames(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) return i;
    cb(i * 16.7);
  }
  return n;
}

console.log('\n== \u88C5\u914D\uFF08\u771F\u5B9E app.js + \u5047 DOM\uFF09 ==');
// PSX_APP 可指向副本：反向对照用它来确认"改坏了这套断言真的会红"
const appPath = process.env.PSX_APP || path.join(srcDir, 'app.js');
console.log('\u53D7\u6D4B\u6587\u4EF6\uFF1A' + appPath);
require(appPath);
const px = globalThis.__psx;

section('\u542F\u52A8\u4E0E\u5C31\u7EEA');
ok(!!px && !!globalThis.__psxReady, 'app.js \u5728\u5047 DOM \u91CC\u5B8C\u6210\u88C5\u914D\u5E76\u53D1\u51FA\u5C31\u7EEA\u4FE1\u53F7');
ok(px.els && px.els.view && px.els.view.getContext, '\u81EA\u68C0\u63A5\u53E3\u80FD\u62FF\u5230\u6D3B\u7684 els\uFF08\u53D6\u503C\u5668\u751F\u6548\uFF09');
const missing = [];
['view', 'series', 'schematic', 'legend', 'editor', 'errors', 'params', 'applyBtn', 'presetSelect', 'dimTabs',
  'dimNote', 'readout', 'structure', 'dynamics', 'note', 'insetEq', 'initBox', 'flowNote', 'btnPlayF', 'btnPlayB',
  'btnStop', 'btnStepF', 'btnStepB', 'speed', 'speedVal', 'dtSel', 'methodSel', 'horizon', 'horizonVal',
  'btnFit', 'btnAnalyze', 'btnClearFlow', 'btnSeed3D', 'fatal'].forEach(id => { if (!registry.has(id)) missing.push(id); });
ok(missing.length === 0, 'app.js \u9700\u8981\u7684\u6BCF\u4E00\u4E2A id \u5728 index.html \u91CC\u90FD\u771F\u7684\u5B58\u5728', missing.join(','));
ok(rafScheduled === 1 && rafQueue.length === 1, '\u542F\u52A8\u65F6\u6070\u597D\u6392\u4E86 1 \u5E27', 'scheduled=' + rafScheduled);

section('\u5E27\u5FAA\u73AF\uFF1A\u754C\u9762\u5FC5\u987B\u81EA\u5DF1\u4F1A\u91CD\u7ED8\uFF08\u672C\u8F6E\u6545\u969C\u7684\u56DE\u5F52\u6D4B\u8BD5\uFF09');
const sum = () => px.getSummary();
{
  const before = sum();
  runFrames(1);
  const after1 = sum();
  ok(after1.renderCount === before.renderCount + 1, '\u7B2C 1 \u5E27\u6E32\u67D3\u4E86\u4E00\u6B21\uFF08S.dirty \u521D\u503C\u4E3A true\uFF09',
    `renderCount ${before.renderCount} \u2192 ${after1.renderCount}`);
  ok(after1.frame === before.frame + 1, '\u7B2C 1 \u5E27\u628A\u5E27\u8BA1\u6570 +1');
  ok(rafQueue.length === 1, '\u7B2C 1 \u5E27\u7ED3\u675F\u540E\u53C8\u6392\u4E0B\u4E86 1 \u5E27\uFF08\u5FAA\u73AF\u672A\u65AD\u94FE\uFF09', 'pending=' + rafQueue.length);
  ok(after1.dirty === false, '\u6E32\u67D3\u5B8C\u6210\u540E dirty \u88AB\u6E05\u6389');
  ok(px.els.view._ops.length > 100, '\u4E3B\u753B\u5E03\u6536\u5230\u4E86\u5927\u91CF\u7ED8\u5236\u8C03\u7528', 'ops=' + px.els.view._ops.length);

  // 关键回归：交互之后**不许帮忙**，只推进帧，画面调用序列必须变化
  px.els.view._ops.length = 0;
  const r0 = sum().renderCount;
  px.els.view.dispatch('pointerdown', { clientX: 620, clientY: 180 });
  px.els.view.dispatch('pointerup', { clientX: 620, clientY: 180 });
  ok(sum().dirty === true, '\u70B9\u51FB\u540E\u7F6E\u4E86\u201C\u8BE5\u91CD\u7ED8\u201D\u6807\u5FD7');
  runFrames(2);
  const r1 = sum().renderCount;
  ok(r1 > r0, '\u4EC5\u4EC5\u63A8\u8FDB\u5E27\uFF08\u4E0D\u8C03 renderNow\uFF09\uFF0C\u754C\u9762\u5C31\u81EA\u5DF1\u91CD\u7ED8\u4E86',
    `renderCount ${r0} \u2192 ${r1}`);
  ok(px.els.view._ops.length > 100, '\u91CD\u7ED8\u771F\u7684\u5199\u5230\u4E86\u753B\u5E03\u4E0A\uFF08\u4E0D\u662F\u53EA\u6539\u72B6\u6001\uFF09', 'ops=' + px.els.view._ops.length);
  const st = sum();
  ok(Math.abs(st.init[0] - st.bounds[0][0] - (620 - 56) / (900 - 76) * (st.bounds[0][1] - st.bounds[0][0])) < 1e-9,
    '\u70B9\u51FB\u843D\u5230\u4E86\u5B83\u8BE5\u843D\u7684\u4E16\u754C\u5750\u6807\u4E0A', JSON.stringify(st.init.map(v => +v.toFixed(4))));
}

section('\u64AD\u653E\uFF1A\u65F6\u95F4\u5FC5\u987B\u81EA\u5DF1\u8D70');
{
  const r0 = sum().renderCount;
  px.els.btnPlayF.dispatch('click', {});
  runFrames(90);
  const s1 = sum();
  ok(s1.curF > 5, '\u6B63\u5411\u6F14\u5316\uFF1A\u65F6\u95F4\u6E38\u6807\u81EA\u5DF1\u524D\u8FDB\uFF08\u65E0\u4EBA\u4EE3\u52B3\uFF09', 'curF=' + s1.curF.toFixed(1));
  ok(s1.renderCount > r0 + 5, '\u6F14\u5316\u8FC7\u7A0B\u4E2D\u5E27\u5E27\u90FD\u5728\u91CD\u7ED8', `renderCount ${r0} \u2192 ${s1.renderCount}`);
  ok(s1.state.every(Number.isFinite), '\u63A8\u8FDB\u4E2D\u72B6\u6001\u6709\u9650', JSON.stringify(s1.state.map(v => +v.toFixed(3))));
  px.els.btnPlayF.dispatch('click', {});
  px.els.btnStop.dispatch('click', {});
  runFrames(2);
  ok(sum().curF === 0, '\u56DE\u5230\u521D\u503C\u540E\u65F6\u95F4\u6E38\u6807\u5F52\u96F6');

  // 反向回溯
  px.els.btnPlayB.dispatch('click', {});
  runFrames(60);
  const s2 = sum();
  ok(s2.curB > 3 && s2.t < 0, '\u53CD\u5411\u56DE\u6EAF\uFF1A\u65F6\u95F4\u8D70\u5411\u8D1F\u503C', 'curB=' + s2.curB.toFixed(1) + ' t=' + s2.t.toFixed(3));
  px.els.btnStop.dispatch('click', {});
  runFrames(2);
}

section('\u5176\u4ED6\u4EA4\u4E92\u4E5F\u5FC5\u987B\u81EA\u5DF1\u91CD\u7ED8');
{
  // 开关元素不挂在 els 上（app.js 里用 $('tgField') 现取），故直接按 id 取。
  // 注意：帧循环"只在 dirty 时渲染"，所以每个状态的调用数都必须紧跟一次交互之后再测。
  const tg = registry.get('tgField');
  tg.checked = false;
  tg.dispatch('change', {});
  px.els.view._ops.length = 0;
  runFrames(2);
  const off = px.els.view._ops.length;
  tg.checked = true;
  tg.dispatch('change', {});
  px.els.view._ops.length = 0;
  runFrames(2);
  const on = px.els.view._ops.length;
  ok(off > 20 && on > off * 3, '\u5173\u6389\u201C\u5411\u91CF\u573A\u201D\u540E\u7BAD\u5934\u771F\u7684\u4ECE\u753B\u5E03\u4E0A\u6D88\u5931\uFF0C\u6253\u5F00\u53C8\u56DE\u6765',
    `off=${off} on=${on}`);

  // 参数滑杆：改阻尼，向量场必须跟着变
  const slider = px.els.params.querySelectorAll('input[data-param]')[0];
  ok(!!slider, '\u53C2\u6570\u6ED1\u6746\u5DF2\u6E32\u67D3\u5230\u9762\u677F\u4E0A');
  if (slider) {
    const r0 = sum().renderCount;
    slider.value = String(Number(slider.value) * 1.5);
    slider.dispatch('input', { target: slider });
    runFrames(2);
    ok(sum().renderCount > r0, '\u62D6\u53C2\u6570\u6ED1\u6746\u540E\u754C\u9762\u81EA\u5DF1\u91CD\u7ED8', `renderCount ${r0} \u2192 ${sum().renderCount}`);
  }

  // 方程编辑（走输入事件 + 防抖计时器的那条路：这里直接调 setSource，等价于防抖到点后执行）
  const r1 = sum().renderCount;
  px.setSource("x' = y\ny' = -x\nz' = -0.5*z");
  runFrames(2);
  ok(sum().dim === 3 && sum().renderCount > r1, '\u6539\u6210\u4E09\u884C\u65B9\u7A0B\u540E\u7EF4\u5EA6\u4E0E\u91CD\u7ED8\u90FD\u8DDF\u4E0A\u4E86');
  px.setSource("x' = y\ny' = -x*(1 + 0.1*x^2)");
  runFrames(2);
  ok(sum().dim === 2, '\u6539\u56DE\u4E24\u884C\u65B9\u7A0B\uFF0C\u56DE\u5230\u4E8C\u7EF4\u76F8\u5E73\u9762');

  // 框选区域 → 相流
  px.els.view.dispatch('pointerdown', { clientX: 300, clientY: 400 });
  px.els.view.dispatch('pointermove', { clientX: 360, clientY: 330 });
  px.els.view.dispatch('pointermove', { clientX: 430, clientY: 250 });
  px.els.view.dispatch('pointerup', { clientX: 430, clientY: 250 });
  runFrames(2);
  ok(sum().ensCount === 217, '\u62D6\u51FA\u77E9\u5F62\u540E\u76F8\u6D41\u533A\u57DF\u5EFA\u7ACB', 'ensCount=' + sum().ensCount);
  const r2 = sum().renderCount;
  px.els.btnPlayF.dispatch('click', {});
  runFrames(60);
  px.els.btnPlayF.dispatch('click', {});
  ok(sum().renderCount > r2 + 5, '\u76F8\u6D41\u968F\u65F6\u95F4\u6D41\u52A8\u65F6\u4E5F\u5728\u91CD\u7ED8', `renderCount ${r2} \u2192 ${sum().renderCount}`);
}

section('\u4E0D\u5E94\u51FA\u73B0\u7684\u4E1C\u897F');
{
  ok(registry.get('fatal').style.display !== 'block', '\u6CA1\u6709\u89E6\u53D1\u81F4\u547D\u9519\u8BEF\u6A2A\u5E45',
    String(registry.get('fatal').textContent).slice(0, 120));
  ok(/^0\.0\d+$|^0\.005$|^0\.01$/.test(String(px.state.dt)), '\u6B65\u957F\u53D6\u5230\u4E86 select \u91CC\u7684\u9ED8\u8BA4\u9009\u4E2D\u9879\uFF08\u800C\u4E0D\u662F NaN\uFF09', String(px.state.dt));
  ok(px.state.method === 'rk4', '\u79EF\u5206\u65B9\u6CD5\u53D6\u5230\u4E86\u9ED8\u8BA4\u503C', px.state.method);
}

section('\u4E00\u7EF4\u76F8\u7A7A\u95F4\u7684\u4EA4\u4E92\uFF08\u4EBA\u7CFB\u7EDF\u62A5\u969C\uFF1A\u4E00\u7EF4\u56FE\u653E\u4E0D\u5927\u7F29\u4E0D\u5C0F\uFF09');
{
  // 一维的 bounds 只有一段 [[a,b]]。此前世界坐标换算走的是二维的 makeView，
  // 读 bounds[1][0] 会抛异常 —— 于是滚轮、点击在一维里全部失效。这一节专门盯住它。
  px.loadPreset('logistic-1d');
  runFrames(2);
  ok(sum().dim === 1, '\u5DF2\u5207\u5230\u4E00\u7EF4\u76F8\u7A7A\u95F4', 'dim=' + sum().dim);
  var w1 = sum().bounds[0][1] - sum().bounds[0][0];

  var threw = null;
  try {
    px.els.view.dispatch('wheel', { deltaY: -240, clientX: 400, clientY: 250 });
  } catch (e) { threw = e; }
  runFrames(2);
  ok(!threw, '\u4E00\u7EF4\u56FE\u6EDA\u8F6E\u7F29\u653E\u4E0D\u518D\u629B\u5F02\u5E38', threw && threw.message);
  var w2 = sum().bounds[0][1] - sum().bounds[0][0];
  ok(w2 < w1 * 0.95, '\u4E00\u7EF4\u56FE\u6EDA\u8F6E\u5411\u4E0A\u771F\u7684\u653E\u5927\u4E86\uFF08\u89C6\u7A97\u53D8\u7A84\uFF09',
    `\u5BBD\u5EA6 ${w1.toFixed(3)} \u2192 ${w2.toFixed(3)}`);

  px.els.view.dispatch('wheel', { deltaY: 400, clientX: 400, clientY: 250 });
  runFrames(2);
  var w3 = sum().bounds[0][1] - sum().bounds[0][0];
  ok(w3 > w2 * 1.05, '\u4E00\u7EF4\u56FE\u6EDA\u8F6E\u5411\u4E0B\u771F\u7684\u7F29\u5C0F\u4E86', `\u5BBD\u5EA6 ${w2.toFixed(3)} \u2192 ${w3.toFixed(3)}`);

  // shift+拖动平移（三个维度都要管用）
  var c0 = (sum().bounds[0][0] + sum().bounds[0][1]) / 2;
  px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250, shiftKey: true });
  px.els.view.dispatch('pointermove', { clientX: 480, clientY: 250, shiftKey: true });
  px.els.view.dispatch('pointerup', { clientX: 480, clientY: 250, shiftKey: true });
  runFrames(2);
  var c1 = (sum().bounds[0][0] + sum().bounds[0][1]) / 2;
  ok(c1 < c0, '\u4E00\u7EF4\u56FE Shift+\u62D6\u52A8\u53EF\u4EE5\u5E73\u79FB\uFF08\u5411\u53F3\u62D6 \u2192 \u4E16\u754C\u5411\u5DE6\u79FB\uFF09',
    `\u4E2D\u5FC3 ${c0.toFixed(3)} \u2192 ${c1.toFixed(3)}`);

  // 点击落点：与独立复算的一维换算对照（边距与 drawPhaseLine1D 同源：l=56, r=28）
  var b1 = sum().bounds[0];
  var clickX = 520;
  var expectV = b1[0] + (clickX - 56) / (900 - 28 - 56) * (b1[1] - b1[0]);
  px.els.view.dispatch('pointerdown', { clientX: clickX, clientY: 250 });
  px.els.view.dispatch('pointerup', { clientX: clickX, clientY: 250 });
  runFrames(2);
  ok(Math.abs(sum().init[0] - expectV) < 1e-9, '\u4E00\u7EF4\u56FE\u70B9\u51FB\u843D\u5230\u4E86\u4E16\u754C\u5750\u6807\u4E0A\uFF08\u4E0E\u72EC\u7ACB\u590D\u7B97\u4E00\u81F4\uFF09',
    `\u5B9E\u6D4B ${sum().init[0].toFixed(6)} \u590D\u7B97 ${expectV.toFixed(6)}`);

  // 复位
  px.els.btnResetView.dispatch('click', {});
  runFrames(2);
  ok(Math.abs((sum().bounds[0][1] - sum().bounds[0][0]) - w1) < 1e-9, '\u201C\u91CD\u7F6E\u89C6\u91CE\u201D\u80FD\u628A\u4E00\u7EF4\u56FE\u653E\u56DE\u9884\u8BBE\u8303\u56F4',
    '\u5BBD\u5EA6=' + (sum().bounds[0][1] - sum().bounds[0][0]).toFixed(3));
}

section('\u4E8C\u7EF4\u56FE\u7684 Shift+\u62D6\u52A8\u5E73\u79FB');
{
  px.loadPreset('pendulum-2d');
  runFrames(2);
  var b0 = sum().bounds.map(r => r.slice());
  px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250, shiftKey: true });
  px.els.view.dispatch('pointermove', { clientX: 480, clientY: 300, shiftKey: true });
  px.els.view.dispatch('pointerup', { clientX: 480, clientY: 300, shiftKey: true });
  runFrames(2);
  var b1 = sum().bounds;
  var spanX = b0[0][1] - b0[0][0], spanY = b0[1][1] - b0[1][0];
  ok(Math.abs((b1[0][0] - b0[0][0]) + 80 * spanX / 824) < 1e-6, 'x \u65B9\u5411\u5E73\u79FB\u91CF\u4E0E\u50CF\u7D20\u4E00\u81F4',
    `\u0394x=${(b1[0][0] - b0[0][0]).toFixed(4)} \u671F\u671B ${(-80 * spanX / 824).toFixed(4)}`);
  ok(Math.abs((b1[1][0] - b0[1][0]) - 50 * spanY / 464) < 1e-6, 'y \u65B9\u5411\u5E73\u79FB\u91CF\u4E0E\u50CF\u7D20\u4E00\u81F4',
    `\u0394y=${(b1[1][0] - b0[1][0]).toFixed(4)} \u671F\u671B ${(50 * spanY / 464).toFixed(4)}`);
  ok(b1[0][1] - b1[0][0] === spanX && b1[1][1] - b1[1][0] === spanY, '\u5E73\u79FB\u4E0D\u6539\u53D8\u89C6\u7A97\u5C3A\u5BF8\uFF08\u53EA\u642C\u4E0D\u7F29\uFF09');
  px.els.btnResetView.dispatch('click', {});
  runFrames(2);
  ok(Math.abs((sum().bounds[0][1] - sum().bounds[0][0]) - spanX) < 1e-9, '\u91CD\u7F6E\u89C6\u91CE\u6062\u590D\u9884\u8BBE\u89C6\u7A97');
}

section('\u4E09\u7EF4\u56FE\u7684\u5E73\u79FB\u4E0E\u7F29\u653E');
{
  px.loadPreset('lorenz-3d');
  runFrames(2);
  var cam0 = { panX: px.state.cam.panX, panY: px.state.cam.panY, scale: px.state.cam.scale };
  px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250, shiftKey: true });
  px.els.view.dispatch('pointermove', { clientX: 460, clientY: 220, shiftKey: true });
  px.els.view.dispatch('pointerup', { clientX: 460, clientY: 220, shiftKey: true });
  runFrames(2);
  ok(px.state.cam.panX === cam0.panX + 60 && px.state.cam.panY === cam0.panY - 30,
    '\u4E09\u7EF4\u56FE Shift+\u62D6\u52A8\u5E73\u79FB\uFF08\u4E0D\u6539\u6CE8\u89C6\u70B9\uFF0C\u907F\u514D\u4E0E\u81EA\u52A8\u5BF9\u4E2D\u6253\u67B6\uFF09',
    `pan=(${px.state.cam.panX},${px.state.cam.panY})`);
  px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250 });
  px.els.view.dispatch('pointerup', { clientX: 400, clientY: 250 });
  runFrames(2);
  ok(px.state.cam.panX === cam0.panX + 60, '\u4E09\u7EF4\u4E0B\u4E0D\u6309 Shift \u7684\u70B9\u51FB\u4E0D\u4F1A\u628A\u5E73\u79FB\u91CF\u5F52\u96F6\uFF08\u4E24\u8005\u4E92\u4E0D\u5E72\u6270\uFF09');
  px.els.btnResetView.dispatch('click', {});
  runFrames(2);
  ok(px.state.cam.panX === 0 && px.state.cam.scale === 1, '\u91CD\u7F6E\u89C6\u91CE\u628A\u4E09\u7EF4\u5E73\u79FB\u4E0E\u7F29\u653E\u4E00\u5E76\u5F52\u4F4D');
}

section('\u62D6\u62FD\u4E4B\u540E\u4E0D\u8BE5\u628A\u753B\u9762\u51B2\u56DE\u521D\u59CB\u72B6\u6001\uFF08\u4EBA\u7CFB\u7EDF\u62A5\u969C\uFF09');
{
  // 报障原话："在拖拽后可视画面不会进行重置"（希望如此）。
  // 根因：onPointerUp 末尾有一句无条件的 resetPlayback()，平移/旋转/框选一松手时间就回 0，
  // 已经演化出来的轨迹与相流整个作废。
  // 断言分两种情形，免得把"播放中时间本来就在走"误判成重置：
  //   暂停状态下 —— 时间必须**一字不动**；
  //   播放状态下 —— 时间只能向前，且绝不能被打断。
  function panBy40() {
    px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250, shiftKey: true });
    px.els.view.dispatch('pointermove', { clientX: 440, clientY: 275, shiftKey: true });
    px.els.view.dispatch('pointerup', { clientX: 440, clientY: 275, shiftKey: true });
  }

  // (a) 播放中平移：不回退、不打断
  px.loadPreset('van-der-pol-2d');
  px.els.btnPlayF.dispatch('click', {});
  runFrames(150);
  var playing0 = sum();
  ok(playing0.curF > 20 && playing0.playing === 'f', '\u6F14\u5316\u5230 t>0 \u4E14\u4ECD\u5728\u64AD\u653E', 'curF=' + playing0.curF.toFixed(1));
  var bounds0 = playing0.bounds[0][0];
  panBy40();
  runFrames(2);
  var playing1 = sum();
  ok(playing1.bounds[0][0] !== bounds0, '\u5E73\u79FB\u786E\u5B9E\u628A\u89C6\u7A97\u642C\u4E86',
    `x0 ${bounds0.toFixed(3)} \u2192 ${playing1.bounds[0][0].toFixed(3)}`);
  ok(playing1.curF >= playing0.curF, '\u64AD\u653E\u4E2D\u5E73\u79FB\uFF1A\u65F6\u95F4\u53EA\u5411\u524D\uFF0C\u4E0D\u56DE\u9000\uFF08\u6CA1\u6709\u91CD\u7F6E\uFF09',
    `curF ${playing0.curF} \u2192 ${playing1.curF}`);
  ok(playing1.playing === 'f', '\u5E73\u79FB\u4E0D\u6253\u65AD\u64AD\u653E', 'playing=' + playing1.playing);

  // 暂停下来，之后每一次交互都要求"时间一字不动"
  px.els.btnPlayF.dispatch('click', {});
  runFrames(2);
  var frozen = sum();
  ok(frozen.playing === null, '\u5DF2\u6682\u505C', 'playing=' + frozen.playing);

  // (b) 平移
  panBy40();
  runFrames(3);
  ok(sum().curF === frozen.curF, '\u6682\u505C\u540E\u5E73\u79FB\uFF1A\u65F6\u95F4\u4E00\u5B57\u4E0D\u52A8', `curF ${frozen.curF} \u2192 ${sum().curF}`);

  // (c) 滚轮缩放
  px.els.view.dispatch('wheel', { deltaY: -200, clientX: 400, clientY: 250 });
  runFrames(3);
  ok(sum().curF === frozen.curF, '\u6682\u505C\u540E\u7F29\u653E\uFF1A\u65F6\u95F4\u4E00\u5B57\u4E0D\u52A8', 'curF=' + sum().curF);

  // (d) 框选相流
  px.els.view.dispatch('pointerdown', { clientX: 300, clientY: 400 });
  px.els.view.dispatch('pointermove', { clientX: 380, clientY: 320 });
  px.els.view.dispatch('pointerup', { clientX: 380, clientY: 320 });
  runFrames(3);
  var afterRegion = sum();
  ok(afterRegion.ensCount === 217, '\u76F8\u6D41\u533A\u57DF\u5DF2\u5EFA\u7ACB', 'ensCount=' + afterRegion.ensCount);
  ok(afterRegion.curF === frozen.curF, '\u6846\u9009\u533A\u57DF\u4E0D\u628A\u65F6\u95F4\u51B2\u56DE 0', `curF ${frozen.curF} \u2192 ${afterRegion.curF}`);

  // (e) 参数滑杆
  var slider2 = px.els.params.querySelectorAll('input[data-param]')[0];
  slider2.value = String(Number(slider2.value) * 1.3);
  slider2.dispatch('input', { target: slider2 });
  runFrames(3);
  ok(sum().curF === frozen.curF, '\u62D6\u53C2\u6570\u6ED1\u6746\uFF1A\u65F6\u523B\u4E0D\u88AB\u51B2\u6389', `curF ${frozen.curF} \u2192 ${sum().curF}`);

  // (f) 换步长：同一条时间轴换分辨率，时刻照搬（t 不变）
  var tBefore = sum().t;
  px.els.dtSel.value = '0.005';
  px.els.dtSel.dispatch('change', {});
  runFrames(3);
  ok(Math.abs(sum().t - tBefore) < 1e-9, '\u6362\u6B65\u957F\u540E\u505C\u5728\u540C\u4E00\u4E2A\u65F6\u523B', `t ${tBefore} \u2192 ${sum().t}`);

  // (g) 暂停下单击换初始状态：时间**应当**回 0（另一条轨迹的起点）
  px.els.view.dispatch('pointerdown', { clientX: 520, clientY: 220 });
  px.els.view.dispatch('pointerup', { clientX: 520, clientY: 220 });
  runFrames(3);
  ok(sum().curF <= 2, '\u6362\u521D\u59CB\u72B6\u6001\u540E\u65F6\u95F4\u56DE\u5230 0\uFF08\u65B0\u8F68\u8FF9\u7684\u8D77\u70B9\uFF09', 'curF=' + sum().curF);

  // (h) 播放中单击换初始状态：从 0 重新走，但"在播放"这件事不打断
  px.els.btnPlayF.dispatch('click', {});
  runFrames(30);
  ok(sum().playing === 'f' && sum().curF > 3, '\u64AD\u653E\u4E2D', 'curF=' + sum().curF.toFixed(1));
  var beforeClick = sum().curF;
  px.els.view.dispatch('pointerdown', { clientX: 560, clientY: 200 });
  px.els.view.dispatch('pointerup', { clientX: 560, clientY: 200 });
  runFrames(2);
  ok(sum().playing === 'f', '\u6362\u521D\u59CB\u72B6\u6001\u4E0D\u6253\u65AD\u64AD\u653E\uFF08\u53EF\u4EE5\u8FB9\u653E\u8FB9\u6BD4\u8F83\u4E0D\u540C\u521D\u503C\uFF09', 'playing=' + sum().playing);
  // 不清回 0 就不是"新轨迹"了；只要远小于点击前的位置即可（播放中它会立刻继续往前走几帧）
  ok(sum().curF < beforeClick / 4, '\u65B0\u8F68\u8FF9\u4ECE\u8D77\u70B9\u91CD\u65B0\u5F00\u59CB',
    `curF ${beforeClick.toFixed(0)} \u2192 ${sum().curF}`);
  runFrames(40);
  ok(sum().curF > 4, '\u4E4B\u540E\u7EE7\u7EED\u81EA\u5DF1\u5F80\u524D\u8D70', 'curF=' + sum().curF.toFixed(1));

  // (i) 三维旋转：也不重置时间
  px.loadPreset('lorenz-3d');
  runFrames(2);
  px.els.btnPlayF.dispatch('click', {});
  runFrames(120);
  var beforeRot = sum();
  ok(beforeRot.curF > 10, '\u4E09\u7EF4\u4E0B\u5DF2\u63A8\u8FDB', 'curF=' + beforeRot.curF.toFixed(1));
  px.els.view.dispatch('pointerdown', { clientX: 400, clientY: 250 });
  px.els.view.dispatch('pointermove', { clientX: 440, clientY: 270 });
  px.els.view.dispatch('pointerup', { clientX: 440, clientY: 270 });
  runFrames(2);
  ok(sum().curF >= beforeRot.curF && sum().playing === 'f', '\u4E09\u7EF4\u65CB\u8F6C\u4E5F\u4E0D\u91CD\u7F6E\u65F6\u95F4',
    `curF ${beforeRot.curF} \u2192 ${sum().curF}`);
  px.els.btnStop.dispatch('click', {});
  runFrames(2);
  ok(sum().curF === 0 && sum().playing === null, '\u201C\u56DE\u5230\u521D\u503C\u201D\u4ECD\u7136\u662F\u786C\u590D\u4F4D\uFF08t=0 \u4E14\u505C\u6B62\uFF09');
}

section('\u5B66\u751F\u5199\u6CD5\uFF1A\u65B9\u7A0B\u56DE\u663E\uFF08\u70B9\u53F7 + \u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F\uFF09\u4E0E\u7B26\u53F7\u5DE5\u5177\u6761');
{
  px.setSource('g = 9.8\nL = 1\nd\u03B8/dt = \u03C9\nd\u03C9/dt = -(g/L)*sin(\u03B8)');
  runFrames(2);
  var eqHtml = px.els.insetEq.innerHTML;
  // 点号写法（ẋ / θ̇）：字母 + 一个用 CSS 定位在上方的点（不靠 Unicode 组合点）
  ok(eqHtml.indexOf('<span class="dv">\u03B8<span class="dvdot">') >= 0 &&
    eqHtml.indexOf('<span class="dv">\u03C9<span class="dvdot">') >= 0,
    '\u4E00\u9636\u7EC4\u7528\u70B9\u53F7\u5199\u6CD5\uFF08\u03B8\u0307 = \u03C9\u3001\u03C9\u0307 = \u2026\uFF0C\u70B9\u7528 CSS \u753B\uFF09', eqHtml.slice(0, 110));
  // 等价二阶形式：θ̈ = -(g/L)·sin(θ)（双点）
  ok(eqHtml.indexOf('<span class="dv">\u03B8<span class="dvdot2">') >= 0 && eqHtml.indexOf('\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F') >= 0,
    '\u5355\u6446\u81EA\u52A8\u7ED9\u51FA\u7B49\u4EF7\u4E8C\u9636\u5F62\u5F0F \u03B8\u0308 = -(g/L)\u00B7sin(\u03B8)', eqHtml.slice(-150));
  ok(eqHtml.indexOf('= -(g/L) \u00B7 sin(\u03B8)') >= 0, '\u4E8C\u9636\u5F62\u5F0F\u7684\u53F3\u7AEF\u4E0E\u4E66\u5199\u4E00\u81F4', eqHtml.slice(-150));
  ok(eqHtml.indexOf('\u00B7') >= 0, '\u4E58\u53F7\u663E\u793A\u4E3A\u4E2D\u95F4\u70B9\uFF08\u800C\u4E0D\u662F *\uFF09', eqHtml.slice(0, 120));
  ok(eqHtml.indexOf('\u5DF2\u77E5\u91CF') >= 0, '\u53C2\u6570\u5217\u4E3A\u201C\u5DF2\u77E5\u91CF\u201D', eqHtml.slice(-90));

  // 悬挂方程：二阶形式里 v 必须被换成"位移的点号"（此时位移叫 y，所以是 ẏ），而 xV( 不受影响
  px.loadPreset('suspension-random-2d');
  runFrames(2);
  var susHtml = px.els.insetEq.innerHTML;
  var soPart = susHtml.slice(susHtml.indexOf('class="eqline so"'));
  ok(soPart.indexOf('<span class="dv">y<span class="dvdot2">') >= 0,
    '\u4E8C\u9636\u5F62\u5F0F\u7684\u5DE6\u7AEF\u662F \u00FF\uFF08\u4F4D\u79FB\u53EB y\uFF09', soPart.slice(0, 120));
  ok(soPart.indexOf('<span class="dv">y<span class="dvdot">') >= 0 && soPart.indexOf('<span class="dv">v<span class="dvdot">') === -1,
    '\u5F3A\u8868\u8FBE\u5F0F\u91CC\u7684 v \u5DF2\u6362\u6210 \u1E8F\uFF08\u800C\u4E0D\u662F\u628A v \u81EA\u5DF1\u70B9\u4E00\u4E0B\uFF09', soPart.slice(0, 200));
  ok(soPart.indexOf('<span class="dv">x<span class="dvdot">') >= 0,
    '\u8DEF\u9762\u901F\u5EA6\u663E\u793A\u4E3A \u1E8B(t)\uFF08\u800C\u4E0D\u662F xV(t)\uFF09\u2014\u2014\u8FD9\u6837\u624D\u8BFB\u5F97\u51FA m\u00FF + c\u1E8F + ky = c\u1E8B + kx',
    soPart.slice(0, 220));
  // 断言"没有多余的推导量"应当盯**参数表**，而不是盯字符串格式（后者会被排版细节绊倒）
  ok(px.state.compiled.paramNames.join(',') === 'm,c,k' &&
    soPart.indexOf('w0') < 0 && soPart.indexOf('\u03B6') < 0 && soPart.indexOf('zeta') < 0,
    '\u53F3\u7AEF\u53EA\u7528 m\u3001c\u3001k \u4E09\u4E2A\u53C2\u6570\uFF08\u6CA1\u6709 \u03C9\u2080/\u03B6 \u8FD9\u79CD\u63A8\u5BFC\u91CF\uFF09',
    px.state.compiled.paramNames.join(',') + ' | ' + soPart.slice(0, 150));
  ok(susHtml.indexOf('\u5DF2\u77E5\u91CF\uFF1Am = 240\u3001c = 1200\u3001k = 16000') >= 0,
    '\u5DF2\u77E5\u91CF\u5217\u53EA\u5217 m\u3001c\u3001k', susHtml.slice(-160));

  // 符号工具条：点一下把符号插进编辑器并重编译
  var ed = px.els.editor;
  ed.value = 'dx/dt = -k*x';
  ok(px.setSource('dx/dt = -k*x\nk = 1'), '\u7B26\u53F7\u63D2\u5165\u540E\u91CD\u65B0\u7F16\u8BD1\u6210\u529F');
  runFrames(2);
  ok(sum().dim === 1, '\u63D2\u5165\u540E\u7EF4\u5EA6\u8DDF\u7740\u53D8', 'dim=' + sum().dim);
}

section('\u62D6 m/c/k \u5FC5\u987B\u80FD\u91CD\u5851\u76F8\u56FE\uFF08\u4EBA\u7CFB\u7EDF\u62A5\u969C\u7684\u6839\u56E0\uFF09');
{
  px.loadPreset('suspension-random-2d');
  runFrames(2);
  ok(px.state.compiled.paramNames.join(',') === 'm,c,k',
    '\u53C2\u6570\u53EA\u6709 m\u3001c\u3001k', px.state.compiled.paramNames.join(','));
  ok(px.state.compiled.paramDerived.m === false && px.state.compiled.paramDerived.k === false,
    'm\u3001c\u3001k \u90FD\u662F\u72EC\u7ACB\u53C2\u6570\uFF08\u4E0D\u662F\u63A8\u5BFC\u91CF\uFF09');
  // 确定性模式下"含随机外因的方程"要有一次固定实现：否则路面恒为 0，轨迹会一路收敛到原点
  ok(px.state.system.aux !== null && typeof px.state.system.aux.rand === 'function',
    '\u786E\u5B9A\u6027\u6A21\u5F0F\u4E0B\uFF0C\u968F\u673A\u5916\u56E0\u88AB\u56FA\u5B9A\u6210\u4E00\u6B21\u5B9E\u73B0\uFF08\u770B\u5230\u7684\u662F\u8DEF\u5F84\uFF09');

  function trajSig() {
    var t = px.state.trajF, s = 0;
    for (var i = 0; i < t.n; i++) s += Math.abs(t.x[i * t.dim]);
    return s;
  }
  var sig0 = trajSig();
  ok(sig0 > 1e-3, '\u521D\u59CB\u8F68\u8FF9\u975E\u5E73\u51E1\uFF08\u8DEF\u9762\u786E\u5B9E\u5728\u52A8\uFF09', sig0.toFixed(4));
  // 拖 k 滑杆：向量场、轨迹、结构都该跟着变
  var kInput = px.els.params.querySelector ? px.els.params.querySelector('[data-param="k"]') : null;
  ok(!!kInput, '\u53C2\u6570\u9762\u677F\u91CC\u6709 k \u7684\u6ED1\u6746');
  if (kInput) {
    kInput.value = String(px.state.paramValues.k * 4);
    kInput.dispatch('input', { target: kInput });
    runFrames(2);
    ok(px.state.paramValues.k === 64000, 'k \u88AB\u62D6\u5230 4 \u500D', String(px.state.paramValues.k));
    ok(Math.abs(trajSig() - sig0) / sig0 > 0.05,
      '\u62D6 k \u4E4B\u540E\u8F68\u8FF9\u786E\u5B9E\u53D8\u4E86\uFF08\u800C\u4E0D\u662F\u201C\u62D6\u4E86\u6CA1\u53CD\u5E94\u201D\uFF09',
      `\u8F68\u8FF9\u6307\u6807 ${sig0.toFixed(4)} \u2192 ${trajSig().toFixed(4)}`);
    // 同一状态点上的加速度也变（向量场真的跟着参数走）
    var acc = new Float64Array(2);
    px.state.system.f(Float64Array.of(0.1, 0), 0, acc);
    ok(Math.abs(acc[1]) > 0.5, '\u540C\u4E00\u72B6\u6001\u70B9\u4E0A\u7684\u52A0\u901F\u5EA6\u4E5F\u968F k \u53D8\u5316', acc[1].toFixed(3));
  }
  // 派生参数：写成读数而不是滑杆
  px.setSource('m = 240\nk = 16000\nw0 = sqrt(k/m)\ndx/dt = v\ndv/dt = -w0^2*x');
  runFrames(2);
  ok(px.els.params.querySelector('[data-derived="w0"]') !== null, '\u63A8\u5BFC\u91CF w0 \u4EE5\u8BFB\u6570\u5F62\u5F0F\u7ED9\u51FA');
  var w0row = px.els.params.querySelector('[data-derived="w0"]');
  ok(w0row && Math.abs(parseFloat(w0row.textContent) - 8.165) < 0.01, '\u8BFB\u6570\u503C\u6B63\u786E\uFF08sqrt(16000/240) = 8.165\uFF09',
    w0row ? w0row.textContent : '');
}

section('\u968F\u673A\u5916\u56E0\u6A21\u5F0F\uFF08\u99C2\u7279\u5361\u7F57 + \u6982\u7387\u5BC6\u5EA6 + \u8C31\uFF09');
{
  // 切到悬挂预设：应当自动进入随机模式、并把预设的激励谱搬进面板
  px.loadPreset('suspension-random-2d');
  runFrames(2);
  // 含随机外因的预设**默认停在确定性模式**：先让人看见一条路径；概率云要主动切过去看
  ok(px.state.mode === 'det', '\u52A0\u8F7D\u542B\u968F\u673A\u5916\u56E0\u7684\u9884\u8BBE \u2192 \u9ED8\u8BA4\u505C\u5728\u786E\u5B9A\u6027\u6A21\u5F0F\uFF08\u5148\u770B\u8DEF\u5F84\uFF09');
  ok(!px.els.mcPanel.classList.contains('show'), '\u968F\u673A\u9762\u677F\u9ED8\u8BA4\u4E0D\u5C55\u5F00');
  ok(px.els.note.innerHTML.indexOf('\u8DEF\u5F84') >= 0, '\u9884\u8BBE\u8BF4\u660E\u91CC\u63D0\u4E86\u201C\u8DEF\u5F84\u201D\u4E0E\u79CD\u5B50', px.els.note.textContent.slice(0, 60));
  ok(!px.els.flow3dPanel.classList.contains('show'), '\u4E8C\u7EF4\u89C6\u56FE\u91CC\u4E0D\u51FA\u73B0\u300C\u4E09\u7EF4\u76F8\u6D41\u5DE5\u5177\u300D\uFF08\u5B83\u5728\u4E8C\u7EF4\u91CC\u6CA1\u610F\u4E49\uFF09');
  ok(px.state.compiled.usesRandom === true, '\u65B9\u7A0B\u88AB\u6807\u8BB0\u4E3A\u542B\u968F\u673A\u5916\u56E0');
  // 主动切到随机模式再看概率云
  px.els.modeRandom.dispatch('click', {});
  runFrames(2);
  ok(px.state.mode === 'random', '\u70B9\u300C\u968F\u673A\u5916\u56E0\u300D\u624D\u5207\u8FC7\u53BB');
  ok(px.els.mcPanel.classList.contains('show'), '\u968F\u673A\u9762\u677F\u5C55\u5F00');
  // 同步跑一遍（把分片大小调大，等价于"一次跑完"）
  px.state.mc.runs = 24;
  px.state.mc.tMax = 8;
  px.state.mc.chunk = 999;
  px.els.btnMC.dispatch('click', {});
  runFrames(2);
  var r = px.state.mc.result;
  ok(!!r && r.runs === 24, '\u8499\u7279\u5361\u7F57\u8DD1\u5B8C 24 \u6B21\u5B9E\u73B0', r ? ('runs=' + r.runs) : 'no result');
  var mcDiag = r ? ('count=' + r.count + ' outside=' + r.outside + ' nx=' + r.nx + 'x' + r.ny +
    ' bounds=' + JSON.stringify(r.bounds) + ' S0=' + px.state.randSpec.intensity +
    ' dt=' + px.state.mc.dt + ' tMax=' + px.state.mc.tMax + ' init=' + JSON.stringify(Array.from(px.state.init))) : '';
  ok(r && r.count > 1000, '\u7D2F\u8BA1\u5230\u4E86\u5927\u91CF\u91C7\u6837\u70B9', mcDiag);
  ok(r && r.std[0] > 0 && isFinite(r.std[0]), '\u7EDF\u8BA1\u51FA\u4E86\u975E\u96F6\u7684\u6807\u51C6\u5DEE', r ? String(r.std[0].toExponential(2)) : '');
  ok(!!px.state.mc.psdResp && !!px.state.mc.psdExc, '\u8F93\u5165\u8C31\u4E0E\u54CD\u5E94\u8C31\u90FD\u7B97\u51FA\u6765\u4E86');
  ok(!!px.state.mc.img && px.state.mc.img.width === px.state.mc.result.nx, '\u5BC6\u5EA6\u56FE\u5DF2\u751F\u6210', px.state.mc.img ? (px.state.mc.img.width + 'x' + px.state.mc.img.height) : '');
  ok(px.els.readout.textContent.indexOf('\u5B9E\u73B0\u6B21\u6570') >= 0, '\u53F3\u680F\u6539\u6210\u4E86\u968F\u673A\u6A21\u5F0F\u7684\u8BFB\u6570', px.els.readout.textContent.replace(/\s+/g, ' ').slice(0, 60));
  ok(px.els.mcNote.textContent.indexOf('24') >= 0, '\u9762\u677F\u4E0B\u65B9\u62A5\u51FA\u4E86\u5B9E\u73B0\u6B21\u6570\u4E0E\u91C7\u6837\u70B9', px.els.mcNote.textContent.slice(0, 48));
  // 画布上真的铺了密度图。
  // 这里显式调 renderNow()：本组断言问的是"画了什么"，不是"会不会自己重绘"——
  // 后者已由上面「帧循环」那一组独立断言过，两者不要混在一起。
  px.els.view._ops.length = 0;
  px.renderNow();
  var dimg = px.els.view._ops.filter(o => o[0] === 'drawImage').length;
  ok(dimg >= 1, '\u4E3B\u56FE\u4E0A\u771F\u7684\u94FA\u4E86\u6982\u7387\u5BC6\u5EA6\uFF08drawImage\uFF09', 'drawImage=' + dimg);
  // 「只画路径」：勾上之后不再铺概率云，但路径还在（人系统明确说过"不该有这个概率云"）
  ok(px.state.mc.samples.length >= 2, '\u4FDD\u7559\u4E86\u591A\u6761\u6837\u672C\u8DEF\u5F84', String(px.state.mc.samples.length));
  px.els.mcPathsOnly.checked = true;
  px.els.mcPathsOnly.dispatch('change', { target: px.els.mcPathsOnly });
  px.els.view._ops.length = 0;
  px.renderNow();
  var dimg2 = px.els.view._ops.filter(o => o[0] === 'drawImage').length;
  // 光看 drawImage 不够：还有一条"逐格画"的退路，它同样会画出概率云。
  // 人系统报的正是这个：勾了"只画路径"，一拖动画面云反而冒出来了。
  // 阈值式断言在这里不够：悬挂的响应只占几十个格子，"< 40" 会让退路蒙混过关（本轮真踩了）。
  // 只画路径时，主图上**一个格子都不该填**；整屏底色（fillRect 覆盖全画布）不算格子。
  var allRects = px.els.view._ops.filter(o => o[0] === 'fillRect');
  var cw = px.els.view.width, chh = px.els.view.height;
  var cloudCells = allRects.filter(o => o[3] * o[4] < cw * chh * 0.1).length;
  ok(dimg2 === 0, '\u52FE\u4E0A\u300C\u53EA\u753B\u8DEF\u5F84\u300D\u540E\u4E0D\u518D\u94FA\u6982\u7387\u4E91\uFF08drawImage\uFF09', 'drawImage=' + dimg2);
  ok(cloudCells === 0, '\u4E5F\u4E0D\u8D70\u201C\u9010\u683C\u753B\u201D\u90A3\u6761\u9000\u8DEF\uFF08\u5426\u5219\u4E91\u4F1A\u4EE5\u53E6\u4E00\u79CD\u65B9\u5F0F\u5192\u51FA\u6765\uFF09',
    '\u683C\u5B50\u6570=' + cloudCells + '\uFF0C\u603B fillRect=' + allRects.length);
  ok(px.els.view._ops.filter(o => o[0] === 'stroke').length > 0, '\u4F46\u8DEF\u5F84\u4ECD\u7136\u753B\u7740', 'strokes=' + px.els.view._ops.filter(o => o[0] === 'stroke').length);
  px.els.mcPathsOnly.checked = false;
  px.els.mcPathsOnly.dispatch('change', { target: px.els.mcPathsOnly });
  // 概率云必须锚在"统计时那个视窗"上：平移画面之后，它覆盖的世界区域不变（而不是被拉伸着钉在屏幕上）
  px.els.view._ops.length = 0;
  px.renderNow();
  function cloudRect() {
    var d = px.els.view._ops.filter(o => o[0] === 'drawImage')[0];
    return d ? [d[2], d[3], d[4], d[5]] : null;
  }
  var rectA = cloudRect();
  ok(!!rectA, '\u6982\u7387\u4E91\u5DF2\u94FA\u4E0A', JSON.stringify(rectA));
  var v0 = px.state.bounds;
  px.state.bounds = [[v0[0][0] + 0.1, v0[0][1] + 0.1], [v0[1][0] + 0.2, v0[1][1] + 0.2]];   // 平移视窗
  px.els.view._ops.length = 0;
  px.renderNow();
  var rectB = cloudRect();
  ok(!!rectB && Math.abs(rectB[0] - rectA[0]) > 5,
    '\u5E73\u79FB\u89C6\u7A97\u540E\uFF0C\u6982\u7387\u4E91\u8DDF\u7740\u76F8\u7A7A\u95F4\u4E00\u8D77\u79FB\u52A8\uFF08\u800C\u4E0D\u662F\u9489\u5728\u5C4F\u5E55\u4E0A\uFF09',
    `\u5E73\u79FB\u524D x=${rectA && rectA[0].toFixed(0)}\uFF0C\u5E73\u79FB\u540E x=${rectB && rectB[0].toFixed(0)}`);
  // 覆盖的世界区域必须仍是统计时的那个视窗
  var rb = px.state.mc.runBounds;
  ok(rb && Math.abs(rb[0][0] - v0[0][0]) < 1e-12 && Math.abs(rb[1][0] - v0[1][0]) < 1e-12,
    '\u8BB0\u4E0B\u4E86\u7EDF\u8BA1\u65F6\u7684\u89C6\u7A97\uFF08\u4F9B\u951A\u5B9A\u7528\uFF09', JSON.stringify(rb));
  px.state.bounds = v0;
  px.renderNow();
  // 复算：同种子同结果；换种子换一张图（用密度的加权指纹比，别只比总数）
  function densFingerprint() {
    var d = px.state.mc.result.dens, s = 0;
    for (var i = 0; i < d.length; i++) s += d[i] * (i + 1);
    return s;
  }
  var fp1 = densFingerprint();
  px.els.btnMC.dispatch('click', {});
  runFrames(2);
  ok(densFingerprint() === fp1, '\u540C\u4E00\u79CD\u5B50 \u2192 \u9010\u683C\u76F8\u540C\u7684\u5BC6\u5EA6\u56FE\uFF08\u53EF\u590D\u7B97\uFF09',
    String(fp1));
  px.els.btnMcSeed.dispatch('click', {});
  runFrames(2);
  ok(densFingerprint() !== fp1, '\u6362\u4E00\u6279\u79CD\u5B50 \u2192 \u786E\u5B9E\u662F\u53E6\u4E00\u5F20\u56FE', String(densFingerprint()) + ' vs ' + String(fp1));
}

section('\u4E09\u7EF4\u76F8\u6D41\u5DE5\u5177');
{
  px.loadPreset('lorenz-3d');
  runFrames(2);
  ok(px.state.mode === 'det', '\u56DE\u5230\u786E\u5B9A\u6027\u6A21\u5F0F', px.state.mode);
  ok(px.els.flow3dPanel.classList.contains('show'), '\u4E09\u7EF4\u89C6\u56FE\u91CC\u624D\u51FA\u73B0\u300C\u4E09\u7EF4\u76F8\u6D41\u5DE5\u5177\u300D\u9762\u677F');
  px.els.flow3dN.value = '4';
  px.els.flow3dN.dispatch('input', {});
  px.els.btn3DFlow.dispatch('click', {});
  runFrames(2);
  var ens = px.state.ensF;
  ok(!!ens && ens.count === 64, '\u5EFA\u7ACB\u4E86 4\u00B3 = 64 \u4E2A\u72B6\u6001\u70B9\u7684\u4E09\u7EF4\u76F8\u6D41\u4E91', ens ? String(ens.count) : 'null');
  px.els.view._ops.length = 0;
  px.renderNow();
  var boxes = px.els.view._ops.filter(o => o[0] === 'lineTo').length;
  ok(boxes > 60, '\u4E09\u7EF4\u56FE\u4E0A\u753B\u51FA\u4E86\u5305\u56F4\u76D2\u7EBF\u6846\u4E0E\u4E91\u56E2', 'lineTo=' + boxes);
  var dyn = px.els.dynamics.textContent;
  ok(dyn.indexOf('\u4E3B\u65B9\u5411\u62C9\u4F38') >= 0, '\u8BFB\u6570\u91CC\u7ED9\u51FA\u4E86\u4E3B\u65B9\u5411\u62C9\u4F38\u500D\u6570', dyn.replace(/\s+/g, ' ').slice(0, 60));
  // 把每轴点数改成 3 → 云团变成 27 个点
  px.els.flow3dN.value = '3';
  px.els.flow3dN.dispatch('input', {});
  runFrames(2);
  ok(px.state.ensF.count === 27, '\u6539\u70B9\u6570\u540E\u4E91\u56E2\u91CD\u5EFA\u4E3A 27 \u4E2A\u70B9', String(px.state.ensF.count));
  px.els.btn3DClear.dispatch('click', {});
  runFrames(2);
  ok(px.state.ensF === null, '\u6E05\u9664\u540E\u4E91\u56E2\u4E0D\u518D\u5B58\u5728');
}

section('\u56DE\u6EAF\u652F\uFF1A\u663E\u793A\u8DDF\u968F\u4E0E\u53D1\u6563\u622A\u65AD');
{
  px.loadPreset('damped-oscillator-2d');
  runFrames(2);
  px.els.btnPlayB.dispatch('click', {});
  runFrames(30);
  px.els.btnPlayB.dispatch('click', {});      // 暂停
  runFrames(2);
  ok(px.state.branch === 'b', '\u56DE\u6EAF\u540E\u663E\u793A\u8DDF\u968F\u56DE\u6EAF\u652F', 'branch=' + px.state.branch);
  ok(sum().t < 0, '\u65F6\u95F4\u4ECD\u5728\u8D1F\u534A\u8F74\uFF08\u6682\u505C\u540E\u4E0D\u8DF3\u56DE\u6B63\u5411\u652F\uFF09', String(sum().t));
  var stB = sum().state;
  ok(stB.every(Number.isFinite), '\u56DE\u6EAF\u652F\u72B6\u6001\u6709\u9650', JSON.stringify(stB.map(v => +v.toFixed(4))));
  // 耗散系统的逆流会发散：必须被截断，而不是一路飞到 1e30
  var diverg = px.state.trajB;
  ok(diverg.stopped === true, '\u53D1\u6563\u7684\u56DE\u6EAF\u652F\u88AB\u5982\u5B9E\u622A\u65AD\u5E76\u6807\u8BB0', diverg.stopReason + ' @ t=' + diverg.stopT.toFixed(2));
  var maxAbs = 0;
  for (var i = 0; i < diverg.n * diverg.dim; i++) maxAbs = Math.max(maxAbs, Math.abs(diverg.x[i]));
  ok(maxAbs < 1e6, '\u622A\u65AD\u540E\u4E0D\u4F1A\u51FA\u73B0\u5929\u6587\u6570\u5B57\u7684\u72B6\u6001\u503C', maxAbs.toExponential(2));
  // 时间序列：两支共用一条轴（回溯支在负半轴）
  px.els.series._ops.length = 0;
  px.renderNow();
  var serOps = px.els.series._ops;
  ok(serOps.filter(o => o[0] === 'lineTo').length > 100, '\u65F6\u95F4\u5E8F\u5217\u540C\u65F6\u753B\u4E86\u6B63\u5411\u4E0E\u56DE\u6EAF\u4E24\u652F',
    'lineTo=' + serOps.filter(o => o[0] === 'lineTo').length);
  px.els.btnStop.dispatch('click', {});
  runFrames(2);
  ok(px.state.branch === 'f' && sum().t === 0, '\u201C\u56DE\u5230\u521D\u503C\u201D\u628A\u663E\u793A\u5207\u56DE\u6B63\u5411\u652F');
}

console.log('\n' + '='.repeat(60));
console.log(`\u901A\u8FC7 ${pass} \u9879\uFF0C\u5931\u8D25 ${fail} \u9879`);
if (fail) { console.log('\n\u5931\u8D25\u6E05\u5355\uFF1A'); failures.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
