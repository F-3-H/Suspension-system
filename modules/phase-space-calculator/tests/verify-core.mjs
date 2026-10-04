/**
 * verify-core.mjs —— 数学内核的机械断言（无浏览器、无 DOM、确定性）
 *
 * 为什么先做这一层：相空间计算器"能画出来"与"画得对"是两件事。
 * 渲染只能在浏览器里看，但向量场、积分器、散度、不动点、周期、Lyapunov 这些量
 * 全部可以对着**解析已知的答案**去核对。因此把可核对的先钉死，浏览器里只剩下"画出来"。
 *
 * 运行：node tests/verify-core.mjs       （退出码 0 = 全过）
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

const PSExpr = require(path.join(srcDir, 'expr.js'));
const PSPhase = require(path.join(srcDir, 'core.js'));
const PSPresets = require(path.join(srcDir, 'presets.js'));
const PSRandom = require(path.join(srcDir, 'random.js'));

// ------------------------------------------------------------------ 断言框架
let pass = 0, fail = 0, group = '';
const failures = [];
function section(name) { group = name; console.log('\n== ' + name + ' =='); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else {
    fail++; failures.push(group + ' / ' + label + (detail ? '  \u2192 ' + detail : ''));
    console.log('  \u2717 ' + label + (detail ? '  \u2192 ' + detail : ''));
  }
}
function close(a, b, tol, label) {
  const d = Math.abs(a - b);
  ok(d <= tol, label, `\u5B9E\u6D4B ${a} \u671F\u671B ${b} \u504F\u5DEE ${d.toExponential(3)} > \u5BB9\u5DEE ${tol}`);
}
function closeArr(a, b, tol, label) {
  let worst = 0, idx = -1;
  for (let i = 0; i < b.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > worst) { worst = d; idx = i; } }
  ok(worst <= tol, label, `\u6700\u5DEE\u5206\u91CF #${idx}: \u5B9E\u6D4B ${a[idx]} \u671F\u671B ${b[idx]} \u504F\u5DEE ${worst.toExponential(3)}`);
}

// ------------------------------------------------------------------ 1. 表达式层
section('\u8868\u8FBE\u5F0F\u89E3\u6790\u4E0E\u7F16\u8BD1');
{
  const c = PSExpr.compile("k = 2\nx' = -k*x + 1");
  ok(c.ok, '\u57FA\u672C\u65B9\u7A0B\u7F16\u8BD1\u6210\u529F', JSON.stringify(c.errors));
  ok(c.dim === 1, '\u7EF4\u5EA6\u63A8\u5BFC = 1', 'dim=' + c.dim);
  ok(c.varNames[0] === 'x' && c.paramNames[0] === 'k', '\u53D8\u91CF/\u53C2\u6570\u540D\u8BC6\u522B\u6B63\u786E');
  const sys = c.makeSystem(null);
  const out = new Float64Array(1);
  sys.f(Float64Array.of(3), 0, out);
  close(out[0], -5, 1e-12, "f(3) = -2*3+1 = -5");
  const sys2 = c.makeSystem({ k: 10 });
  sys2.f(Float64Array.of(3), 0, out);
  close(out[0], -29, 1e-12, '\u53C2\u6570\u8986\u76D6\u751F\u6548 f(3) = -10*3+1 = -29');
}
{
  const src = [
    '# \u5355\u6446', 'g = 9.8', 'L = 1',
    "theta' = omega",
    "omega' = -(g/L)*sin(theta)"
  ].join('\n');
  const c = PSExpr.compile(src);
  ok(c.ok, '\u5355\u6446\u65B9\u7A0B\u7F16\u8BD1\u6210\u529F', JSON.stringify(c.errors));
  ok(c.dim === 2, '\u4E24\u4E2A\u5C5E\u6027 \u2192 \u4E8C\u7EF4\u76F8\u7A7A\u95F4', 'dim=' + c.dim);
  ok(c.varNames.join(',') === 'theta,omega', '\u72B6\u6001\u53D8\u91CF\u987A\u5E8F = \u4E66\u5199\u987A\u5E8F', c.varNames.join(','));
  ok(c.derivTexts[0].text === 'omega' && c.derivTexts[1].text === '-(g/L)*sin(theta)',
    '\u65B9\u7A0B\u56DE\u663E\u6587\u672C\u53EA\u542B\u53F3\u7AEF\u8868\u8FBE\u5F0F\uFF08\u4E0D\u80FD\u628A "theta\' =" \u4E5F\u7B97\u8FDB\u53BB\uFF09',
    JSON.stringify(c.derivTexts.map(function (d) { return d.text; })));
  const sys = c.makeSystem(null);
  const out = new Float64Array(2);
  sys.f(Float64Array.of(0, 0), 0, out);
  closeArr(out, [0, 0], 1e-12, '\u5E73\u8861\u70B9 (\u03B8=0,\u03C9=0) \u5904 f = 0');
  sys.f(Float64Array.of(Math.PI / 2, 0), 0, out);
  closeArr(out, [0, -9.8], 1e-12, 'f(\u03C0/2, 0) = [0, -9.8]');
}
{
  const c = PSExpr.compile('g = 9.8\nL = g/9.8\nx\' = -L*x');
  ok(c.ok && Math.abs(c.paramDefaults.L - 1) < 1e-12, '\u53C2\u6570\u53EF\u4F9D\u8D56\u53C2\u6570\uFF08L = g/9.8 = 1\uFF09', JSON.stringify(c.paramDefaults));
}
{
  const c = PSExpr.compile('a = b\nb = a\nx\' = a*x');
  ok(!c.ok && /u6210\u73AF|\u6210环/.test(c.errors[0].message), '\u53C2\u6570\u5FAA\u73AF\u4F9D\u8D56\u88AB\u62D2\u7EDD', c.ok ? 'ok=true' : c.errors[0].message);
}
{
  const c = PSExpr.compile("y' = q\nz' = y");
  ok(!c.ok, '\u5F15\u7528\u672A\u5B9A\u4E49\u91CF q \u88AB\u62D2\u7EDD', c.ok ? 'ok=true' : '');
  ok(!c.ok && c.errors[0].line === 1, '\u9519\u8BEF\u5B9A\u4F4D\u5230\u884C\u53F7 line=1', JSON.stringify(c.errors[0]));
}
{
  // x / xV 是"路面位移 / 路面速度"的别名（人系统的悬挂方程 mÿ+cẏ+ky = cẋ+kx 里 x 就是路面）。
  // 三条规矩要同时成立：裸写可用、用户自定义优先、调用形式不被抢占。
  const bare = PSExpr.compile('m = 1\nc = 1\nk = 1\ndy/dt = v\ndv/dt = -(k/m)*(y - x) - (c/m)*(v - xV)');
  ok(bare.ok && bare.usesRandom === true, '\u88F8\u5199\u7684 x / xV \u5C31\u662F\u968F\u673A\u5916\u56E0\uFF08\u8DEF\u9762\u4F4D\u79FB\u4E0E\u901F\u5EA6\uFF09',
    bare.ok ? '' : JSON.stringify(bare.errors));
  const shadow = PSExpr.compile("x' = v\nv' = -x");
  ok(shadow.ok && shadow.usesRandom === false && shadow.varNames[0] === 'x',
    '\u7528\u6237\u81EA\u5DF1\u5B9A\u4E49\u4E86 x \u65F6\uFF0C\u88F8\u5199 x \u4F18\u5148\u5F53\u72B6\u6001\u53D8\u91CF\uFF08\u522B\u540D\u4E0D\u5F97\u541E\u6389\u7528\u6237\u7684\u540D\u5B57\uFF09',
    shadow.ok ? JSON.stringify(shadow.varNames) : JSON.stringify(shadow.errors));
  const called = PSExpr.compile('a = 1\ndy/dt = v\ndv/dt = -a*y + x(t)');
  ok(called.ok && called.usesRandom === true, 'x(t) \u7684\u8C03\u7528\u5F62\u5F0F\u6C38\u8FDC\u662F\u968F\u673A\u5916\u56E0',
    called.ok ? '' : JSON.stringify(called.errors));
}
{
  // 派生参数必须跟着依赖它的参数重新算 —— 这是"拖 m/k/c 相图不动"的根因
  const c = PSExpr.compile('m = 240\nk = 16000\nw0 = sqrt(k/m)\ndx/dt = v\ndv/dt = -w0^2*x');
  ok(c.ok && c.paramDerived.w0 === true && c.paramDerived.k === false,
    '\u6D3E\u751F\u53C2\u6570\u88AB\u6807\u8BB0\uFF08w0 \u662F\u63A8\u5BFC\u91CF\uFF0Ck/m \u662F\u72EC\u7ACB\u91CF\uFF09', JSON.stringify(c.paramDerived));
  const s1 = c.makeSystem({ m: 240, k: 16000 });
  const s2 = c.makeSystem({ m: 240, k: 64000 });     // k 变 4 倍
  const i0 = c.paramNames.indexOf('w0');
  ok(Math.abs(s2.paramValues[i0] - 2 * s1.paramValues[i0]) < 1e-9,
    'k \u53D8 4 \u500D \u2192 w0 \u53D8 2 \u500D\uFF08\u6D3E\u751F\u91CF\u786E\u5B9E\u91CD\u7B97\u4E86\uFF09',
    `w0: ${s1.paramValues[i0].toFixed(4)} \u2192 ${s2.paramValues[i0].toFixed(4)}`);
  const f1 = new Float64Array(2), f2 = new Float64Array(2);
  s1.f(Float64Array.of(1, 0), 0, f1);
  s2.f(Float64Array.of(1, 0), 0, f2);
  ok(Math.abs(f2[1] - 4 * f1[1]) < 1e-9 && f1[1] !== 0,
    '\u540C\u4E00\u4E2A\u72B6\u6001\u70B9\u4E0A\uFF0Ck \u53D8 4 \u500D \u2192 \u6062\u590D\u529B\u4E5F\u53D8 4 \u500D\uFF08\u5411\u91CF\u573A\u771F\u7684\u53D8\u4E86\uFF09',
    `f[1]: ${f1[1].toFixed(3)} \u2192 ${f2[1].toFixed(3)}`);
  ok(Math.abs(c.evalParams({ m: 240, k: 64000 }).w0 - 16.3299) < 1e-3,
    'evalParams \u7ED9\u51FA\u7684\u8BFB\u6570\u4E0E\u7CFB\u7EDF\u5B9E\u9645\u7528\u7684\u503C\u4E00\u81F4',
    String(c.evalParams({ m: 240, k: 64000 }).w0));
  const bad = PSExpr.compile('a = 2*x\ndx/dt = -a*x');
  ok(!bad.ok, '\u53C2\u6570\u4F9D\u8D56\u72B6\u6001\u53D8\u91CF\u88AB\u62D2\u7EDD\uFF08\u53C2\u6570\u662F\u5E38\u6570\uFF09',
    bad.ok ? 'ok=true' : bad.errors[0].message);
}
{
  const c = PSExpr.compile('x = 1\nx\' = 2*x');
  ok(!c.ok, '\u72B6\u6001\u53D8\u91CF\u4E0E\u53C2\u6570\u540C\u540D\u88AB\u62D2\u7EDD');
}
{
  // 保留名 t：若放行，f 里的 t 会静默指向"时间"而不是"状态变量"，方程看着对、意思被换掉
  const c = PSExpr.compile("t' = w\nw' = -t");
  ok(!c.ok && /\u4FDD\u7559\u540D/.test(c.errors[0].message), '\u72B6\u6001\u53D8\u91CF\u540D\u4E3A t \u88AB\u62D2\u7EDD\uFF08\u907F\u514D\u4E0E\u81EA\u53D8\u91CF\u9759\u9ED8\u51B2\u7A81\uFF09', c.ok ? '' : c.errors[0].message);
  const c2 = PSExpr.compile("sin' = 1");
  ok(!c2.ok && /\u5185\u7F6E\u51FD\u6570\u540D/.test(c2.errors[0].message), '\u53D8\u91CF\u540D\u4E0E\u51FD\u6570\u540D\u51B2\u7A81\u88AB\u62D2\u7EDD', c2.ok ? '' : c2.errors[0].message);
}
{
  const c = PSExpr.compile('\u03B8\' = \u03C9\n\u03C9\' = -sin(\u03B8)');
  ok(c.ok && c.dim === 2 && c.varNames[0] === '\u03B8', 'Unicode \u5E0C\u814A\u5B57\u6BCD\u53D8\u91CF\u53EF\u7528', JSON.stringify(c.errors));
}
{
  const c = PSExpr.compile('\uFF58\uFF07 \uFF1D -\uFF11\uFF0A\uFF58');
  ok(c.ok && c.dim === 1 && c.varNames[0] === 'x', '\u5168\u89D2\u5B57\u7B26\u4E0E\u5168\u89D2\u6492\u53F7\u81EA\u52A8\u5F52\u4E00\u5316', JSON.stringify(c.errors));
}
{
  const c = PSExpr.compile("x' = y\ny' = -x");
  ok(c.usesTime === false, '\u81EA\u6CBB\u7CFB\u7EDF\u88AB\u6B63\u786E\u5224\u5B9A\uFF08usesTime=false\uFF09');
  const c2 = PSExpr.compile("x' = -x + cos(t)");
  ok(c2.usesTime === true, '\u975E\u81EA\u6CBB\u7CFB\u7EDF\u88AB\u6B63\u786E\u5224\u5B9A\uFF08usesTime=true\uFF09');
}
{
  const c = PSExpr.compile("x' = 2x");
  ok(!c.ok, '\u7701\u7565\u4E58\u53F7\u7684 2x \u4E0D\u88AB\u9759\u9ED8\u63A5\u53D7\uFF08\u907F\u514D\u6B67\u4E49\uFF09', c.ok ? '' : c.errors[0].message);
}
{
  const c = PSExpr.compile("x' = sin(x, 1)");
  ok(!c.ok && /\u9700\u8981 1 \u4E2A\u53C2\u6570/.test(c.errors[0].message), '\u51FD\u6570\u53C2\u6570\u4E2A\u6570\u6821\u9A8C', c.ok ? '' : c.errors[0].message);
}

// ------------------------------------------------------------------ 2. 积分器
section('\u79EF\u5206\u5668\uFF08\u63A8\u6F14\u4E0E\u56DE\u6EAF\uFF09');
{
  const c = PSExpr.compile('k = 1\nx\' = -k*x');
  const sys = c.makeSystem(null);
  const traj = PSPhase.integrate(sys, Float64Array.of(1), 0, 0.001, 1000, 'rk4');
  close(traj.x[traj.n * 1 - 1], Math.exp(-1), 1e-9, 'RK4 \u79EF\u5206 ẋ=-x \u4E00\u4E2A\u65F6\u95F4\u5355\u4F4D\uFF0C\u8BEF\u5DEE<1e-9');
  const euler = PSPhase.integrate(sys, Float64Array.of(1), 0, 0.1, 10, 'euler');
  const rk4 = PSPhase.integrate(sys, Float64Array.of(1), 0, 0.1, 10, 'rk4');
  const exact = Math.exp(-1);
  const eulerErr = Math.abs(euler.x[10] - exact), rk4Err = Math.abs(rk4.x[10] - exact);
  ok(eulerErr > 100 * rk4Err, '\u540C\u6B65\u957F\u4E0B Euler \u8BEF\u5DEE\u8FDC\u5927\u4E8E RK4\uFF08\u7A81\u51FA\u65B9\u6CD5\u9009\u62E9\u7684\u610F\u4E49\uFF09',
    `eulerErr=${eulerErr.toExponential(2)} rk4Err=${rk4Err.toExponential(2)}`);
}
{
  const c = PSExpr.compile("x' = y\ny' = -x");
  const sys = c.makeSystem(null);
  const energy = (x, y) => 0.5 * (x * x + y * y);
  const traj = PSPhase.integrate(sys, Float64Array.of(1, 0), 0, 0.01, 6283, 'rk4');
  let maxDev = 0;
  for (let i = 0; i <= traj.n - 1; i++) maxDev = Math.max(maxDev, Math.abs(energy(traj.x[i * 2], traj.x[i * 2 + 1]) - 0.5));
  ok(maxDev < 1e-6, 'RK4 \u4FDD\u80FD\uFF1A\u7B80\u8C10\u632F\u5B50 10 \u4E2A\u5468\u671F\u540E\u80FD\u91CF\u6F02\u79FB < 1e-6', 'maxDev=' + maxDev.toExponential(3));

  const fwd = PSPhase.integrate(sys, Float64Array.of(0.7, -1.3), 0, 0.01, 500, 'rk4');
  const endIdx = (fwd.n - 1) * 2;
  const back = PSPhase.integrate(sys, fwd.x.subarray(endIdx, endIdx + 2), fwd.t[fwd.n - 1], -0.01, 500, 'rk4');
  const bEnd = (back.n - 1) * 2;
  closeArr([back.x[bEnd], back.x[bEnd + 1]], [0.7, -1.3], 1e-6, '\u6B63\u5411 t=5 \u540E\u53CD\u5411\u79EF\u5206 = \u56DE\u6EAF\u5230\u51FA\u53D1\u70B9');
}
{
  const c = PSExpr.compile("x' = y\ny' = -x");
  const sys = c.makeSystem(null);
  const traj = PSPhase.integrate(sys, Float64Array.of(1, 0), 0, 0.1, 10, 'rk4');
  const s = PSPhase.stateAt(traj, 0.55, new Float64Array(2));
  const exact = [Math.cos(0.55), -Math.sin(0.55)];
  const linErr = Math.max(...[0, 1].map(k => Math.abs(s[k] - exact[k])));
  closeArr(s, exact, 2e-3, '\u7EBF\u6027\u63D2\u503C\u8BEF\u5DEE\u4E0E dt\u00B2 \u540C\u9636\uFF08dt=0.1 \u65F6 ~1e-3\uFF0C\u8FD9\u662F\u64AD\u653E\u5361\u987F\u7684\u6839\u6E90\uFF09');
  const s2 = PSPhase.stateAt(traj, 0.55, new Float64Array(2), sys);
  const hermErr = Math.max(...[0, 1].map(k => Math.abs(s2[k] - exact[k])));
  ok(hermErr < 1e-5 && hermErr < linErr / 50,
    'Hermite \u63D2\u503C\uFF08\u5E26\u5411\u91CF\u573A\u5BFC\u6570\uFF09\u6BD4\u7EBF\u6027\u63D2\u503C\u597D\u4E24\u4E2A\u6570\u91CF\u7EA7',
    `hermErr=${hermErr.toExponential(2)} linErr=${linErr.toExponential(2)}`);
}

// ------------------------------------------------------------------ 3. 局部结构量
section('\u6563\u5EA6\u3001\u96C5\u53EF\u6BD4\u4E0E\u7279\u5F81\u503C');
{
  const sys = PSExpr.compile("x' = y\ny' = -x").makeSystem(null);
  close(PSPhase.divergence(sys, Float64Array.of(0.3, 0.7), 0), 0, 1e-8, '\u7B80\u8C10\u632F\u5B50 \u2207\u00B7f = 0\uFF08\u76F8\u4F53\u79EF\u5B88\u6052\uFF09');
  const dp = PSExpr.compile('b = 0.5\n' + "x' = y\ny' = -(9.8)*sin(x) - b*y").makeSystem(null);
  close(PSPhase.divergence(dp, Float64Array.of(1.1, -0.4), 0), -0.5, 1e-8, '\u963B\u5C3C\u5355\u6446 \u2207\u00B7f = -b = -0.5');
  const lz = PSExpr.compile('sigma = 10\nrho = 28\nbeta = 2.6666667\n' +
    "x' = sigma*(y - x)\ny' = x*(rho - z) - y\nz' = x*y - beta*z").makeSystem(null);
  close(PSPhase.divergence(lz, Float64Array.of(3, -2, 19), 0), -(10 + 1 + 2.6666667), 1e-6, '\u6D1B\u4F26\u5179 \u2207\u00B7f = -(\u03C3+1+\u03B2)');
}
{
  const sys = PSExpr.compile('a = 0.6\nw = 2\n' + "x' = -a*x + w*y\ny' = -w*x - a*y").makeSystem(null);
  const J = PSPhase.jacobian(sys, Float64Array.of(1.3, -0.8), 0);
  closeArr(J, [-0.6, 2, -2, -0.6], 1e-6, '\u96C5\u53EF\u6BD4\u77E9\u9635\u4E0E\u89E3\u6790\u503C\u4E00\u81F4');
  const cls = PSPhase.classify2(J);
  ok(cls.type === '\u7A33\u5B9A\u7126\u70B9', '\u5206\u7C7B = \u7A33\u5B9A\u7126\u70B9', cls.type);
  close(cls.eigenvalues[0].re, -0.6, 1e-9, '\u7279\u5F81\u503C\u5B9E\u90E8 = -0.6');
  close(Math.abs(cls.eigenvalues[0].im), 2, 1e-9, '\u7279\u5F81\u503C\u865A\u90E8 = \u00B12');
}
{
  const J = Float64Array.of(-1, 0, 0, 0, -2, 0, 0, 0, -0.5);
  const eig = PSPhase.eigen3(J);
  const real = eig.map(e => e.re).sort((a, b) => a - b);
  closeArr(real, [-2, -1, -0.5], 1e-9, '3\u00D73 \u5BF9\u89D2\u9635\u7279\u5F81\u503C = {-2,-1,-0.5}');
  const Jc = Float64Array.of(0, -1, 0, 1, 0, 0, 0, 0, -3);
  const e2 = PSPhase.eigen3(Jc);
  const hasImag = e2.some(e => Math.abs(Math.abs(e.im) - 1) < 1e-6);
  ok(hasImag, '3\u00D73 \u542B\u65CB\u8F6C\u5206\u91CF\u65F6\u80FD\u7ED9\u51FA \u00B1i \u5171\u8F6D\u590D\u6839', JSON.stringify(e2.map(e => [e.re, e.im])));
}

// ------------------------------------------------------------------ 4. 不动点与稳定性
section('\u4E0D\u52A8\u70B9\u3001\u7A33\u5B9A\u6027\u4E0E\u76F8\u56FE\u7ED3\u6784');
{
  const sys = PSExpr.compile('r = 1.2\nK = 1\n' + "x' = r*x*(1 - x/K)").makeSystem(null);
  const eqs = PSPhase.solveEquilibria(sys, [[-0.5, 1.6]], {});
  const xs = eqs.map(e => e.x[0]).sort((a, b) => a - b);
  ok(eqs.length === 2, '\u903B\u8F91\u65AF\u8C1B\uFF1A\u6070\u597D\u627E\u5230 2 \u4E2A\u4E0D\u52A8\u70B9', 'count=' + eqs.length + ' xs=' + JSON.stringify(xs));
  closeArr(xs, [0, 1], 1e-6, '\u4E0D\u52A8\u70B9\u4F4D\u7F6E = {0, 1}');
  const at0 = eqs.find(e => Math.abs(e.x[0]) < 1e-6);
  const at1 = eqs.find(e => Math.abs(e.x[0] - 1) < 1e-6);
  ok(at0 && at0.classification.stable === false, 'x=0 \u4E0D\u7A33\u5B9A', at0 && at0.classification.type);
  ok(at1 && at1.classification.stable === true, 'x=K \u7A33\u5B9A', at1 && at1.classification.type);
}
{
  const sys = PSExpr.compile('b = 0.5\n' + "theta' = omega\nomega' = -(9.8)*sin(theta) - b*omega").makeSystem(null);
  const eqs = PSPhase.solveEquilibria(sys, [[-4, 4], [-4, 4]], { grid: 40 });
  // 期望：原点附近稳定焦点；(±π, 0) 鞍点
  const near0 = eqs.find(e => Math.hypot(e.x[0], e.x[1]) < 1e-3);
  const nearPi = eqs.find(e => Math.abs(Math.abs(e.x[0]) - Math.PI) < 1e-2 && Math.abs(e.x[1]) < 1e-2);
  ok(!!near0 && near0.classification.stable === true, '\u963B\u5C3C\u5355\u6446\uFF1A(\u00B12k\u03C0, 0) \u662F\u7A33\u5B9A\u7126\u70B9', near0 && near0.classification.type + ' @ ' + Array.from(near0.x));
  ok(!!nearPi && nearPi.classification.type === '\u978D\u70B9', '\u963B\u5C3C\u5355\u6446\uFF1A(\u00B1\u03C0, 0) \u662F\u978D\u70B9', nearPi ? nearPi.classification.type + ' @ ' + Array.from(nearPi.x).map(v => v.toFixed(4)) : 'not found');
  ok(eqs.length >= 3 && eqs.length <= 5, '\u4E0D\u52A8\u70B9\u4E2A\u6570\u5728\u5408\u7406\u533A\u95F4\uFF08\u542B\u53BB\u91CD\uFF09', 'count=' + eqs.length);
}
{
  const sys = PSExpr.compile("x' = 1").makeSystem(null);
  const eqs = PSPhase.solveEquilibria(sys, [[-1, 1]], {});
  ok(eqs.length === 0, '\u65E0\u4E0D\u52A8\u70B9\u7684\u7CFB\u7EDF\u8FD4\u56DE\u7A7A\u5217\u8868\uFF08\u800C\u4E0D\u662F\u4F2A\u9020\u4E00\u4E2A\uFF09', 'count=' + eqs.length);
}

// ------------------------------------------------------------------ 5. 相流：面积、周期、Lyapunov
section('\u76F8\u6D41\uFF1A\u9762\u79EF\u5F62\u53D8\u3001\u6781\u9650\u73AF\u3001\u674E\u96C5\u666E\u8BFA\u592B');
{
  const pts = PSPhase.sampleRegion([[0, 1], [0, 1]], 3, 3, 8);
  const boundary = pts.slice(3 * 3);
  close(PSPhase.polygonArea(boundary), 1, 1e-9, 'Shoelace \u9762\u79EF\uFF1A\u5355\u4F4D\u6B63\u65B9\u5F62 = 1');
}
{
  // 线性系统 ẋ=-a x + w y, ẏ=-w x - a y 的散度 = -2a，故相面积按 e^{-2at} 收缩（解析可预期）
  const a = 0.6, w = 2;
  const sys = PSExpr.compile(`a = ${a}\nw = ${w}\nx' = -a*x + w*y\ny' = -w*x - a*y`).makeSystem(null);
  const bounds = [[-1, 1], [-1, 1]];
  const pts = PSPhase.sampleRegion(bounds, 5, 5, 64);
  const boundaryCount = 64;
  const ens = PSPhase.integrateEnsemble(sys, pts, 0, 0.005, 600, 'rk4');
  const T = 3.0;
  const step = Math.round(T / 0.005);
  const poly = [];
  for (let k = 0; k < boundaryCount; k++) {
    const idx = pts.length - boundaryCount + k;
    poly.push(PSPhase.ensembleGet(ens, step, idx));
  }
  const area0 = PSPhase.polygonArea(pts.slice(pts.length - boundaryCount));
  const areaT = PSPhase.polygonArea(poly);
  const predicted = area0 * Math.exp(-2 * a * T);
  const relErr = Math.abs(areaT - predicted) / predicted;
  ok(relErr < 0.02, `\u76F8\u9762\u79EF\u6309 e^{-2at} \u6536\u7F29\uFF08T=${T}\uFF0C\u76F8\u5BF9\u8BEF\u5DEE ${(relErr * 100).toFixed(2)}% < 2%\uFF09`, `area0=${area0} areaT=${areaT} predicted=${predicted}`);
  ok(pts.length === 25 + boundaryCount, '\u533A\u57DF\u91C7\u6837 = \u5185\u90E8\u7F51\u683C + \u8FB9\u754C\u591A\u8FB9\u5F62', 'pts=' + pts.length);
}
{
  const mu = 1.0;
  const sys = PSExpr.compile(`mu = ${mu}\nx' = y\ny' = mu*(1 - x^2)*y - x`).makeSystem(null);
  const lc = PSPhase.detectLimitCycle(sys, Float64Array.of(2, 0), 60, 0.005, { warmup: 25 });
  ok(!!lc, '\u8303\u5FB7\u6CE2\u5C14\uFF08\u03BC=1\uFF09\u68C0\u51FA\u6781\u9650\u73AF', JSON.stringify(lc));
  if (lc) close(lc.period, 6.6633, 0.15, '\u6781\u9650\u73AF\u5468\u671F \u2248 6.663\uFF08\u6587\u732E\u503C\uFF09', 'period=' + lc.period);
  const osc = PSExpr.compile("x' = y\ny' = -x").makeSystem(null);
  const lc2 = PSPhase.detectLimitCycle(osc, Float64Array.of(1, 0), 40, 0.005, { warmup: 0, closeTol: 1e-4 });
  ok(!!lc2 && Math.abs(lc2.period - 2 * Math.PI) < 0.02, '\u7B80\u8C10\u632F\u5B50\uFF1A\u6240\u6709\u8F68\u8FF9\u90FD\u662F\u95ED\u5408\u7684\uFF0C\u5468\u671F = 2\u03C0', lc2 ? 'period=' + lc2.period : 'null');
}
{
  const lz = PSExpr.compile('sigma = 10\nrho = 28\nbeta = 2.6666667\n' +
    "x' = sigma*(y - x)\ny' = x*(rho - z) - y\nz' = x*y - beta*z").makeSystem(null);
  const lam = PSPhase.lyapunovMax(lz, Float64Array.of(1, 1, 20), 60, 0.002, { d0: 1e-8 });
  ok(lam > 0.7 && lam < 1.1, '\u6D1B\u4F26\u5179\u6700\u5927 Lyapunov \u6307\u6570 \u2248 0.906\uFF08\u6587\u732E\u503C\uFF09', '\u03BB=' + lam.toFixed(4));
  const osc = PSExpr.compile("x' = y\ny' = -x").makeSystem(null);
  const lam2 = PSPhase.lyapunovMax(osc, Float64Array.of(1, 0), 40, 0.002, { d0: 1e-8 });
  ok(Math.abs(lam2) < 0.02, '\u7B80\u8C10\u632F\u5B50\uFF1A\u4E0D\u53D1\u6563\uFF0C\u03BB \u2248 0', '\u03BB=' + lam2.toFixed(5));
}
{
  const sys = PSExpr.compile("x' = y\ny' = -x").makeSystem(null);
  const traj = PSPhase.integrate(sys, Float64Array.of(1, 0), 0, 0.001, 6283, 'rk4');
  const st = PSPhase.trajectoryStats(traj);
  ok(st.returnsToStart, '\u8F68\u8FF9\u7EDF\u8BA1\uFF1A\u8FD4\u56DE\u51FA\u53D1\u70B9\u88AB\u6B63\u786E\u8BC6\u522B', 'endDistance=' + st.endDistance.toExponential(3));
  const damped = PSExpr.compile('b=0.5\n' + "x' = y\ny' = -x - b*y").makeSystem(null);
  const t2 = PSPhase.integrate(damped, Float64Array.of(1, 0), 0, 0.01, 2000, 'rk4');
  ok(!PSPhase.trajectoryStats(t2).returnsToStart, '\u963B\u5C3C\u7CFB\u7EDF\u4E0D\u8FD4\u56DE\u51FA\u53D1\u70B9\u88AB\u6B63\u786E\u8BC6\u522B');
}
{
  // 发散保护：ẋ = x^2 会在有限时间爆破，积分器必须停在有限值而不是把 NaN 画到画布上
  const sys = PSExpr.compile("x' = x^2").makeSystem(null);
  const traj = PSPhase.integrate(sys, Float64Array.of(1), 0, 0.1, 200, 'rk4');
  let allFinite = true;
  for (let i = 0; i < traj.n; i++) if (!isFinite(traj.x[i])) allFinite = false;
  ok(allFinite, '\u7206\u7834\u65B9\u7A0B\uFF08\u1E8B=x\u00B2\uFF09\u4E0D\u4F1A\u4EA7\u751F NaN', 'maxAbs=' + PSPhase.trajectoryStats(traj).maxAbs.toExponential(2));
}

// ------------------------------------------------------------------ 6. 预设库契约
section('\u9884\u8BBE\u5E93\u5951\u7EA6\uFF08\u6BCF\u4E2A\u9884\u8BBE\u90FD\u9010\u4E00\u7F16\u8BD1\u3001\u9010\u4E00\u79EF\u5206\uFF09');
{
  const list = PSPresets.list;
  let compiledCount = 0, integratedCount = 0, dimOk = 0, boundsOk = 0;
  const problems = [];
  for (const p of list) {
    const c = PSExpr.compile(p.source);
    if (!c.ok) { problems.push(`${p.id}: \u7F16\u8BD1\u5931\u8D25 ${JSON.stringify(c.errors)}`); continue; }
    compiledCount++;
    if (c.dim === p.dim) dimOk++; else problems.push(`${p.id}: \u58F0\u660E ${p.dim} \u7EF4\uFF0C\u5B9E\u9645 ${c.dim} \u7EF4`);
    if (p.bounds.length === c.dim) boundsOk++; else problems.push(`${p.id}: \u89C6\u7A97\u7EF4\u6570 ${p.bounds.length} \u2260 \u7EF4\u5EA6 ${c.dim}`);
    if (p.init.length !== c.dim) problems.push(`${p.id}: \u521D\u503C\u7EF4\u6570\u4E0D\u5339\u914D`);
    const sys = c.makeSystem(null);
    const traj = PSPhase.integrate(sys, Float64Array.from(p.init), 0, 0.005, 400, 'rk4');
    let finite = true;
    for (let i = 0; i < traj.n * traj.dim; i++) if (!isFinite(traj.x[i])) finite = false;
    if (finite) integratedCount++; else problems.push(`${p.id}: \u79EF\u5206\u51FA NaN`);
  }
  ok(compiledCount === list.length, `\u5168\u90E8 ${list.length} \u4E2A\u9884\u8BBE\u53EF\u7F16\u8BD1`, problems.join(' | '));
  ok(dimOk === list.length, `\u5168\u90E8 ${list.length} \u4E2A\u9884\u8BBE\u7684\u58F0\u660E\u7EF4\u5EA6\u4E0E\u65B9\u7A0B\u5B9E\u9645\u7EF4\u5EA6\u4E00\u81F4`, problems.join(' | '));
  ok(boundsOk === list.length, '\u89C6\u7A97\u7EF4\u6570\u4E0E\u65B9\u7A0B\u7EF4\u5EA6\u4E00\u81F4', problems.join(' | '));
  ok(integratedCount === list.length, `\u5168\u90E8 ${list.length} \u4E2A\u9884\u8BBE\u4ECE\u7ED9\u5B9A\u521D\u503C\u79EF\u5206\u4E0D\u51FA NaN`, problems.join(' | '));
  const dims = { 1: 0, 2: 0, 3: 0 };
  list.forEach(p => { dims[p.dim]++; });
  ok(dims[1] >= 2 && dims[2] >= 2 && dims[3] >= 2, '\u4E00/\u4E8C/\u4E09\u7EF4\u5747\u6709\u9884\u8BBE\u53EF\u9009', JSON.stringify(dims));
}

// ------------------------------------------------------------------ 7. 学生写法的微分方程
section('\u5B66\u751F\u5199\u6CD5\u7684\u5FAE\u5206\u65B9\u7A0B\uFF08d\u03B8/dt \u7B49\uFF09');
{
  const forms = [
    ['d\u03B8/dt = \u03C9\nd\u03C9/dt = -sin(\u03B8)', 'd\u03B8/dt'],
    ['d \u03B8/dt = \u03C9\nd \u03C9/dt = -sin(\u03B8)', 'd \u03B8/dt'],
    ['d/dt \u03B8 = \u03C9\nd/dt \u03C9 = -sin(\u03B8)', 'd/dt \u03B8'],
    ['\u03B8\u0307 = \u03C9\n\u03C9\u0307 = -sin(\u03B8)', 'd\u03B8/dt'],
    ["\u03B8' = \u03C9\n\u03C9' = -sin(\u03B8)", "\u03B8'"]
  ];
  let okAll = 0;
  const bad = [];
  for (const [src, lhs] of forms) {
    const c = PSExpr.compile(src);
    if (c.ok && c.dim === 2 && c.varNames.join(',') === '\u03B8,\u03C9' && c.derivTexts[0].lhsText === lhs) okAll++;
    else bad.push(JSON.stringify(src.slice(0, 14)) + ' -> ' + (c.ok ? c.derivTexts.map(d => d.lhsText).join('|') : JSON.stringify(c.errors)));
  }
  ok(okAll === forms.length, `5 \u79CD\u7B49\u4EF7\u5199\u6CD5\uFF08d\u03B8/dt\u3001d \u03B8/dt\u3001d/dt \u03B8\u3001\u03B8\u0307\u3001\u03B8'\uFF09\u5168\u90E8\u8BC6\u522B`, bad.join(' ; '));
  const c2 = PSExpr.compile('d\u03B8/dt = \u03C9\nd\u03C9/dt = -sin(\u03B8)');
  const sys2 = c2.makeSystem(null, null);
  const out2 = new Float64Array(2);
  sys2.f(Float64Array.of(Math.PI / 2, 1), 0, out2);
  closeArr(out2, [1, -1], 1e-12, 'd\u03B8/dt \u5199\u6CD5\u7684\u53F3\u7AEF\u6C42\u503C\u6B63\u786E');
  const cErr = PSExpr.compile('dx/dy = 1');
  ok(!cErr.ok && /\u5206\u6BCD\u5E94\u662F dt/.test(cErr.errors[0].message), '\u5206\u6BCD\u5199\u9519\uFF08dx/dy\uFF09\u7ED9\u51FA\u9488\u5BF9\u6027\u7684\u9519\u8BEF\u63D0\u793A', cErr.ok ? '' : cErr.errors[0].message);
  const cPair = PSExpr.compile('dw/dt = -w');
  ok(cPair.ok && cPair.varNames[0] === 'w', '\u53D8\u91CF\u540D\u53EA\u8981\u4E0D\u662F\u88AB\u8BEF\u541E\u7684\u90A3\u4E2A\u522B\u540D\u5C31\u6B63\u5E38\uFF08w \u53EF\u4F5C\u72B6\u6001\u53D8\u91CF\uFF09', JSON.stringify(cPair.ok ? cPair.varNames : cPair.errors));
  const cParamW = PSExpr.compile('w = 2\ndx/dt = -x + w*y\ndy/dt = -w*x');
  const sysW = cParamW.ok ? cParamW.makeSystem(null, null) : null;
  const outW = new Float64Array(2);
  if (sysW) sysW.f(Float64Array.of(1, 1), 0, outW);
  ok(cParamW.ok && Math.abs(outW[0] - 1) < 1e-12 && Math.abs(outW[1] + 2) < 1e-12,
    '\u540D\u4E3A w \u7684\u53C2\u6570\u4E0D\u4F1A\u88AB\u5916\u90E8\u8F93\u5165\u522B\u540D\u541E\u6389\uFF08value = 2 \u771F\u7684\u751F\u6548\uFF09',
    cParamW.ok ? JSON.stringify(Array.from(outW)) : JSON.stringify(cParamW.errors));
}

// ------------------------------------------------------------------ 8. 随机外因：过程、频谱、蒙特卡洛
section('\u968F\u673A\u5916\u56E0\uFF08\u8C31\u8868\u793A\u6CD5 / PSD / \u8499\u7279\u5361\u7F57\uFF09');
{
  // 可复现性：同一种子 → 逐点相同
  const spec = { kind: 'band', wMin: 0.5, wMax: 20, components: 64, intensity: 0.02 };
  const grid = { t0: 0, dt: 0.005, n: 4000 };
  const a1 = PSRandom.makeRealization(spec, grid, PSRandom.mulberry32(12345));
  const a2 = PSRandom.makeRealization(spec, grid, PSRandom.mulberry32(12345));
  const a3 = PSRandom.makeRealization(spec, grid, PSRandom.mulberry32(54321));
  let same = true, diff = 0;
  for (let i = 0; i < grid.n; i++) {
    if (a1.y[i] !== a2.y[i]) same = false;
    if (Math.abs(a1.y[i] - a3.y[i]) > 1e-12) diff++;
  }
  ok(same, '\u540C\u4E00\u79CD\u5B50 \u2192 \u9010\u70B9\u76F8\u540C\u7684\u5B9E\u73B0\uFF08\u968F\u673A\u6A21\u5F0F\u53EF\u590D\u7B97\uFF09');
  ok(diff > grid.n * 0.9, '\u4E0D\u540C\u79CD\u5B50 \u2192 \u786E\u5B9E\u662F\u53E6\u4E00\u6B21\u5B9E\u73B0', diff + '/' + grid.n + ' \u70B9\u4E0D\u540C');

  // 谱表示法的自洽：时间均方 ≈ ∫S(ω)dω
  const rms = PSRandom.stats(a1.y).variance;
  const area = 0.02 * (20 - 0.5);
  ok(Math.abs(rms - area) / area < 0.15, '\u5B9E\u73B0\u7684\u65B9\u5DEE \u2248 \u76EE\u6807\u8C31\u7684\u79EF\u5206 \u222BS d\u03C9\uFF08\u5B9E\u73B0\u7684\u53E3\u5F84\u5BF9\u4E0D\u5BF9\uFF09',
    `\u65B9\u5DEE=${rms.toFixed(4)} \u222BS d\u03C9=${area.toFixed(4)}`);

  // PSD 估计的归一化：单频信号的谱积分应等于它的方差
  const N = 8192, dt = 0.005;
  const tone = new Float64Array(N);
  for (let i = 0; i < N; i++) tone[i] = 2 * Math.sin(3 * i * dt);
  const pt = PSRandom.psdEstimate(tone, dt, { segments: 4 });
  let ptArea = 0;
  for (let k = 0; k < pt.psd.length; k++) ptArea += pt.psd[k] * pt.df;
  const toneVar = PSRandom.stats(tone).variance;
  ok(Math.abs(ptArea - toneVar) / toneVar < 0.02, 'PSD \u5F52\u4E00\u5316\uFF1A\u222BS d\u03C9 = \u65B9\u5DEE\uFF08\u5355\u9891\u4FE1\u53F7\uFF0C\u8BEF\u5DEE < 2%\uFF09',
    `\u222BS d\u03C9=${ptArea.toFixed(4)} \u65B9\u5DEE=${toneVar.toFixed(4)}`);

  // 一阶系统在带限白噪声下的解析方差：Var = ∫ S(ω)/(a²+ω²) dω
  const a = 1.5;
  let ana = 0;
  for (let w = 0.5; w < 20; w += 0.001) ana += 0.02 / (a * a + w * w) * 0.001;
  const c1 = PSExpr.compile('a = ' + a + '\ndx/dt = -a*x + xi(t)');
  ok(c1.ok && c1.usesRandom === true, '\u542B\u5916\u56E0\u7684\u65B9\u7A0B\u88AB\u6807\u8BB0 usesRandom', c1.ok ? '' : JSON.stringify(c1.errors));
  // 用 60 次实现的**总体平均**去对解析值 —— 单次实现的方差估计噪声很大，这不是走捷径而是口径
  const acc = PSPhase.densityAccumulator([[-1, 1]], 64, 1);
  let varSum = 0;
  const rng = PSRandom.mulberry32(999);
  const g2 = { t0: 0, dt: 0.01, n: 3001 };
  for (let r = 0; r < 60; r++) {
    const real = PSRandom.makeRealization(spec, g2, rng);
    const sys = c1.makeSystem(null, { rand: real.sample });
    const tr = PSPhase.integrate(sys, Float64Array.of(0), 0, 0.01, 3000, 'rk4');
    const sig = new Float64Array(tr.n);
    for (let i = 0; i < tr.n; i++) sig[i] = tr.x[i];
    varSum += PSRandom.stats(sig.subarray(0, tr.n)).variance;
    acc.add(tr, 0.3);
  }
  const varMean = varSum / 60;
  ok(Math.abs(varMean - ana) / ana < 0.12, '\u4E00\u9636\u7CFB\u7EDF\u65B9\u5DEE\uFF1A60 \u6B21\u5B9E\u73B0\u7684\u5E73\u5747 \u2248 \u89E3\u6790\u503C \u222BS/(a\u00B2+\u03C9\u00B2)d\u03C9',
    `\u5B9E\u6D4B=${varMean.toFixed(5)} \u89E3\u6790=${ana.toFixed(5)}`);
  ok(acc.count > 100000, '\u76F4\u65B9\u56FE\u7D2F\u52A0\u5668\u786E\u5B9E\u6536\u4E0B\u4E86\u5927\u91CF\u91C7\u6837\u70B9', 'count=' + acc.count);
  const norm = PSPhase.normalizeDensity(acc.dens, [[-1, 1]], 64, 1);
  let vol = 0;
  for (let i = 0; i < norm.length; i++) vol += norm[i] * (2 / 64);
  ok(Math.abs(vol - 1) < 1e-9, '\u5F52\u4E00\u5316\u540E\u7684\u6982\u7387\u5BC6\u5EA6\u79EF\u5206 = 1', vol);

  // 悬挂：响应谱峰值应落在理论峰值频率附近（位移传递率的峰在 r=√(√(1+8ζ²)-1)/(2ζ)）
  const m = 240, k = 16000, cc = 1200;
  const w0 = Math.sqrt(k / m), z = cc / (2 * Math.sqrt(k * m));
  const rPeak = Math.sqrt(Math.sqrt(1 + 8 * z * z) - 1) / (2 * z);
  const sus = PSExpr.compile('m = 240\nk = 16000\nc = 1200\nw0 = sqrt(k/m)\nzeta = c/(2*sqrt(k*m))\ndx/dt = v\ndv/dt = -w0^2*(x - road(t)) - 2*zeta*w0*(v - roadV(t))');
  ok(sus.ok && sus.usesRandom, '\u60AC\u6302\u65B9\u7A0B\uFF08\u542B road/roadV\uFF09\u7F16\u8BD1\u6210\u529F', sus.ok ? '' : JSON.stringify(sus.errors));
  const g3 = { t0: 0, dt: 0.005, n: 16001 };
  const real3 = PSRandom.makeRealization(spec, g3, PSRandom.mulberry32(11));
  const sys3 = sus.makeSystem(null, { rand: real3.sample, randV: real3.sampleV });
  const tr3 = PSPhase.integrate(sys3, Float64Array.of(0, 0), 0, 0.005, 16000, 'rk4');
  const sig3 = new Float64Array(tr3.n);
  for (let i = 0; i < tr3.n; i++) sig3[i] = tr3.x[i * 2];
  const p3 = PSRandom.psdEstimate(sig3, 0.005, { segments: 6 });
  let bi = 2;
  for (let i = 3; i < p3.psd.length; i++) if (p3.psd[i] > p3.psd[bi]) bi = i;
  ok(Math.abs(p3.freq[bi] - w0 * rPeak) < 1.0, '\u54CD\u5E94\u8C31\u5CF0\u503C\u843D\u5728\u7406\u8BBA\u5CF0\u503C\u9891\u7387\u9644\u8FD1\uFF08\u4E00\u4E2A\u5206\u8FA8\u7387\u4EE5\u5185\uFF09',
    `\u5B9E\u6D4B \u03C9=${p3.freq[bi].toFixed(3)} \u7406\u8BBA=${(w0 * rPeak).toFixed(3)}`);

  // 应用里用的那套频谱口径：集平均 + 丢暂态 + segments=3，时长与界面默认一致（15 s）
  {
    const dt2 = 0.01, n2 = 1501;                     // 15 s
    const rng3 = PSRandom.mulberry32(4242);
    let sum = null, freqR = null, m = 0;
    for (let r = 0; r < 12; r++) {
      const rl = PSRandom.makeRealization(spec, { t0: 0, dt: dt2, n: n2 }, rng3);
      const sy = sus.makeSystem(null, { rand: rl.sample, randV: rl.sampleV });
      const tr = PSPhase.integrate(sy, Float64Array.of(0, 0), 0, dt2, n2 - 1, 'rk4');
      const sg = new Float64Array(tr.n);
      for (let i = 0; i < tr.n; i++) sg[i] = tr.x[i * 2];
      const pe = PSRandom.psdEstimate(sg, dt2, { segments: 3, trim: 0.3 });
      if (!sum) { sum = new Float64Array(pe.psd.length); freqR = pe.freq; }
      for (let i = 0; i < pe.psd.length; i++) sum[i] += pe.psd[i];
      m++;
    }
    for (let i = 0; i < sum.length; i++) sum[i] /= m;
    let bi2 = 2;
    for (let i = 3; i < sum.length; i++) if (sum[i] > sum[bi2]) bi2 = i;
    const target = w0 * rPeak;
    ok(Math.abs(freqR[bi2] - target) < 1.6,
      '\u96C6\u5E73\u5747 + \u4E22\u6682\u6001\u540E\uFF0C\u54CD\u5E94\u8C31\u5CF0\u503C\u843D\u5728\u7406\u8BBA\u5CF0\u503C\u9891\u7387\u9644\u8FD1\uFF08\u8FD9\u662F\u754C\u9762\u8BFB\u6570\u7684\u65B0\u53E3\u5F84\uFF09',
      `\u5B9E\u6D4B \u03C9=${freqR[bi2].toFixed(3)} \u7406\u8BBA=${target.toFixed(3)}`);

    // 反面：把口径换回**改之前的样子** —— segments=6 触发 nperseg 下限 128，
    // 频率格宽达 4.9 rad/s：ω₀=8.165 处的峰只能被报成 4.9 或 9.8，界面上就读成了 4.909。
    // 这条断言盯的是"分辨率"，因为根因就是分辨率（不是"次数不够"）。
    const rl0 = PSRandom.makeRealization(spec, { t0: 0, dt: dt2, n: n2 }, PSRandom.mulberry32(1000));
    const sy0 = sus.makeSystem(null, { rand: rl0.sample, randV: rl0.sampleV });
    const tr0 = PSPhase.integrate(sy0, Float64Array.of(0, 0), 0, dt2, n2 - 1, 'rk4');
    const sg0 = new Float64Array(tr0.n);
    for (let i = 0; i < tr0.n; i++) sg0[i] = tr0.x[i * 2];
    const p0 = PSRandom.psdEstimate(sg0, dt2, { segments: 6 });
    let b0 = 2;
    for (let i = 3; i < p0.psd.length; i++) if (p0.psd[i] > p0.psd[b0]) b0 = i;
    const errOld = Math.abs(p0.freq[b0] - target);
    const errNew = Math.abs(freqR[bi2] - target);
    ok(p0.df > 4 && errOld > errNew + 1.0,
      '\u53CD\u9762\uFF1A\u65E7\u53E3\u5F84\uFF08segments=6 \u2192 \u9891\u683C\u5BBD 4.9 rad/s\uFF09\u628A\u5CF0\u503C\u91CF\u5316\u5230\u9519\u7684\u9891\u70B9\u4E0A',
      `\u65E7 \u03C9=${p0.freq[b0].toFixed(2)}\uFF08\u8BEF\u5DEE ${errOld.toFixed(2)}\uFF0C\u683C\u5BBD ${p0.df.toFixed(2)}\uFF09 vs \u65B0 \u03C9=${freqR[bi2].toFixed(2)}\uFF08\u8BEF\u5DEE ${errNew.toFixed(2)}\uFF0C\u683C\u5BBD ${(freqR[1] - freqR[0]).toFixed(2)}\uFF09`);
  }

  // 蒙特卡洛一次跑完的版本与分片累加器结果一致
  const mk = (s) => sus.makeSystem(null, { rand: s.sample, randV: s.sampleV });
  const reals = [];
  const rng2 = PSRandom.mulberry32(7);
  for (let r = 0; r < 6; r++) reals.push(PSRandom.makeRealization(spec, { t0: 0, dt: 0.01, n: 1001 }, rng2));
  const mc = PSPhase.monteCarlo({
    dim: 2, bounds: [[-0.2, 0.2], [-2, 2]], nx: 20, ny: 20, x0: Float64Array.of(0, 0),
    t0: 0, dt: 0.01, steps: 1000, method: 'rk4', runs: 6, burnIn: 0.25,
    makeSystem: (i) => mk(reals[i])
  });
  let mcSum = 0;
  for (let i = 0; i < mc.dens.length; i++) mcSum += mc.dens[i];
  ok(mc.runs === 6 && mcSum === mc.count && mc.count > 0, '\u8499\u7279\u5361\u7F57\uFF1A\u516D\u6B21\u5B9E\u73B0\u7684\u76F4\u65B9\u56FE\u603B\u6570 = count', `${mcSum} vs ${mc.count}`);
  ok(isFinite(mc.mean[0]) && isFinite(mc.std[0]) && mc.std[0] > 0, '\u8499\u7279\u5361\u7F57\u7ED9\u51FA\u4E86\u6709\u6548\u7684\u5747\u503C\u4E0E\u6807\u51C6\u5DEE',
    `mean=${mc.mean[0].toExponential(2)} std=${mc.std[0].toExponential(2)}`);

  // 点云统计（三维相流"被拉成什么形状"）
  const cube = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let q = 0; q < 2; q++) cube.push(Float64Array.of(i ? 1 : -1, j ? 2 : -2, q ? 0.5 : -0.5));
  const cs = PSPhase.cloudStats(cube);
  closeArr(cs.axes.slice().sort((x, y) => y - x), [2, 1, 0.5], 1e-9, '\u4E09\u7EF4\u70B9\u4E91\u7684\u4E3B\u534A\u8F74 = \u5404\u8F74\u534A\u5BBD\uFF08PCA \u6B63\u786E\uFF09');
  close(PSPhase.boxVolume([[-1, 1], [-2, 2], [-0.5, 0.5]]), 8, 1e-12, '\u5305\u56F4\u76D2\u4F53\u79EF = 8');
}

// ------------------------------------------------------------------ 9. 人系统的悬挂方程
section('\u60AC\u6302\u7CFB\u7EDF\uFF1A\u9AA8\u67B6\u5FC5\u987B\u5C31\u662F m\u00FF + c\u1E8F + ky = c\u1E8B + kx');
{
  // 界面里给的骨架（只有 m、c、k 三个参数；y = 车身位移，x(t) = 路面随机过程）
  const c = PSExpr.compile('m = 240\nc = 1200\nk = 16000\ndy/dt = v\ndv/dt = -(k/m)*(y - x(t)) - (c/m)*(v - xV(t))');
  ok(c.ok && c.paramNames.join(',') === 'm,c,k', '\u53C2\u6570\u53EA\u6709 m\u3001c\u3001k\uFF08\u6CA1\u6709 \u03C9\u2080/\u03B6 \u8FD9\u79CD\u63A8\u5BFC\u91CF\uFF09',
    c.ok ? c.paramNames.join(',') : JSON.stringify(c.errors));
  ok(c.usesRandom === true && c.varNames.join(',') === 'y,v', '\u72B6\u6001\u662F (y, v)\uFF0C\u8DEF\u9762\u4ECE x(t)/xV(t) \u8FDB\u6765', c.varNames.join(','));

  const spec2 = { kind: 'band', wMin: 0.5, wMax: 20, components: 64, intensity: 0.0002 };
  const real = PSRandom.makeRealization(spec2, { t0: 0, dt: 0.01, n: 3001 }, PSRandom.mulberry32(20261003));
  const sys = c.makeSystem(null, { rand: real.sample, randV: real.sampleV });
  const tr = PSPhase.integrate(sys, Float64Array.of(0, 0), 0, 0.01, 3000, 'rk4');

  // 逐点检查残差：R(t) = m*y'' + c*y' + k*y - c*x' - k*x 必须恒为 0。
  // y'' 用系统自己的 f 给（不是差分），y/x/x' 都是精确值 —— 于是这条断言等价于"骨架 = 那个方程"。
  const m = 240, cc = 1200, kk = 16000;
  let maxR = 0, scale = 0;
  for (let i = 0; i < tr.n; i++) {
    const t = tr.t[i], y = tr.x[i * 2], v = tr.x[i * 2 + 1];
    const acc = new Float64Array(2);
    sys.f(Float64Array.of(y, v), t, acc);
    const xr = real.sample(t), xv = real.sampleV(t);
    const R = m * acc[1] + cc * v + kk * y - cc * xv - kk * xr;
    maxR = Math.max(maxR, Math.abs(R));
    scale = Math.max(scale, Math.abs(kk * y), Math.abs(cc * xv));
  }
  ok(maxR / scale < 1e-9, '\u9010\u70B9\u6EE1\u8DB3 m\u00FF + c\u1E8F + ky = c\u1E8B + kx\uFF08\u6B8B\u5DEE\u5F52\u4E00\u540E < 1e-9\uFF09',
    `\u6700\u5927\u6B8B\u5DEE ${maxR.toExponential(2)}\uFF0C\u91CF\u7EA7 ${scale.toExponential(2)}`);

  // 拖 c 必须真的改变响应（人系统报的"调 m/c/k 相图不动"）
  function rms(cv) {
    const s2 = c.makeSystem({ m, c: cv, k: kk }, { rand: real.sample, randV: real.sampleV });
    const t2 = PSPhase.integrate(s2, Float64Array.of(0, 0), 0, 0.01, 3000, 'rk4');
    let sum = 0, n = 0;
    for (let i = 1000; i < t2.n; i++) { sum += t2.x[i * 2] * t2.x[i * 2]; n++; }
    return Math.sqrt(sum / n);
  }
  const r1 = rms(1200), r4 = rms(4800), rQuarter = rms(300);
  ok(r4 < r1 && rQuarter > r1 && r1 > 0,
    '\u963B\u5C3C\u8D8A\u5927\u54CD\u5E94\u8D8A\u5C0F\uFF08c \u00D74 \u2192 \u54CD\u5E94\u53D8\u5C0F\uFF0Cc \u00D70.25 \u2192 \u54CD\u5E94\u53D8\u5927\uFF09',
    `RMS: c=300 \u2192 ${rQuarter.toFixed(4)}, c=1200 \u2192 ${r1.toFixed(4)}, c=4800 \u2192 ${r4.toFixed(4)}`);
  function rmsK(kv) {
    const s2 = c.makeSystem({ m, c: cc, k: kv }, { rand: real.sample, randV: real.sampleV });
    const t2 = PSPhase.integrate(s2, Float64Array.of(0, 0), 0, 0.01, 3000, 'rk4');
    let sum = 0, n = 0;
    for (let i = 1000; i < t2.n; i++) { sum += t2.x[i * 2] * t2.x[i * 2]; n++; }
    return Math.sqrt(sum / n);
  }
  const k1 = rmsK(16000), k4 = rmsK(64000);
  ok(Math.abs(k4 - k1) / k1 > 0.1, '\u521A\u5EA6\u53D8\u5316\u4E5F\u4F1A\u6539\u53D8\u54CD\u5E94\u5E45\u5EA6\uFF08k \u00D74\uFF09',
    `RMS: k=16000 \u2192 ${k1.toFixed(4)}, k=64000 \u2192 ${k4.toFixed(4)}`);
  // m 对"位移响应幅度"影响本来就弱：路面激励的频率段里，响应在低频部分 ≈ 路面位移本身，
  // 与质量无关（这是物理，不是 bug）。但拖 m 必须**看得见变化** —— 所以比较轨迹本身与加速度。
  function run(mv) {
    const s2 = c.makeSystem({ m: mv, c: cc, k: kk }, { rand: real.sample, randV: real.sampleV });
    return PSPhase.integrate(s2, Float64Array.of(0, 0), 0, 0.01, 3000, 'rk4');
  }
  const tA = run(240), tB = run(480);
  let rmsY = 0, diff = 0, accA = 0, accB = 0, n = 0;
  for (let i = 1000; i < tA.n; i++) {
    const yA = tA.x[i * 2], yB = tB.x[i * 2];
    rmsY += yA * yA;
    diff = Math.max(diff, Math.abs(yA - yB));
    const a2 = new Float64Array(2);
    c.makeSystem({ m: 240, c: cc, k: kk }, { rand: real.sample, randV: real.sampleV }).f(Float64Array.of(yA, tA.x[i * 2 + 1]), tA.t[i], a2);
    accA += a2[1] * a2[1];
    c.makeSystem({ m: 480, c: cc, k: kk }, { rand: real.sample, randV: real.sampleV }).f(Float64Array.of(yB, tB.x[i * 2 + 1]), tB.t[i], a2);
    accB += a2[1] * a2[1];
    n++;
  }
  rmsY = Math.sqrt(rmsY / n);
  const accRmsA = Math.sqrt(accA / n), accRmsB = Math.sqrt(accB / n);
  ok(diff / rmsY > 0.15, 'm \u00D72 \u2192 \u8F68\u8FF9\u672C\u8EAB\u660E\u663E\u4E0D\u540C\uFF08\u62D6 m \u770B\u5F97\u89C1\u53D8\u5316\uFF09',
    `\u6700\u5927\u504F\u5DEE / RMS = ${(diff / rmsY).toFixed(3)}`);
  ok(Math.abs(accRmsB - accRmsA) / accRmsA > 0.2, 'm \u00D72 \u2192 \u52A0\u901F\u5EA6\u5747\u65B9\u6839\u660E\u663E\u4E0D\u540C',
    `a_RMS: m=240 \u2192 ${accRmsA.toFixed(4)}, m=480 \u2192 ${accRmsB.toFixed(4)}`);
}

// ------------------------------------------------------------------ 汇总
console.log('\n' + '='.repeat(60));
console.log(`\u901A\u8FC7 ${pass} \u9879\uFF0C\u5931\u8D25 ${fail} \u9879`);
if (fail) {
  console.log('\n\u5931\u8D25\u6E05\u5355\uFF1A');
  failures.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
