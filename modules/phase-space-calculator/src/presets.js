/*!
 * presets.js —— 预设方程库（第三层：领域内容）
 *
 * 方程一律写成**学生熟悉的微分方程形式**：
 *     dθ/dt = ω            （而不是 theta' = omega）
 *     dω/dt = -(g/L)·sin θ
 * 等价写法都认：dθ/dt、d θ/dt、d/dt θ、θ̇、θ'。乘号可以写 *，也可以写 ·。
 *
 * 每个预设给出四样东西：
 *   source  微分方程（唯一决定相空间维度的东西）
 *   bounds  相空间视窗
 *   init    一个具体的初始状态点
 *   note    这个系统在系统科学上"看什么"
 *   random  可选：该预设用于随机外因模式时的激励谱参数（路面激励等）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PRESETS = [
    // ------------------------------------------------------------ 一维相空间
    {
      id: 'decay-1d',
      name: '\u6307\u6570\u8870\u51CF\uFF08\u4E00\u7EF4\uFF09',
      dim: 1, group: '1D',
      source: [
        '# \u4E00\u7EF4\u76F8\u7A7A\u95F4\uFF1A\u53EA\u7528\u4E00\u4E2A\u5C5E\u6027\u5C31\u80FD\u63A8\u51FA\u672A\u6765',
        'k = 1',
        'dx/dt = -k*x'
      ].join('\n'),
      bounds: [[-2, 2]],
      init: [1.5],
      note: '\u552F\u4E00\u4E0D\u52A8\u70B9 x=0 \u5168\u5C40\u7A33\u5B9A\uFF1A\u4EFB\u4F55\u521D\u59CB\u72B6\u6001\u90FD\u88AB\u540C\u4E00\u4E2A\u5438\u5F15\u5B50\u6536\u8D70\u3002'
    },
    {
      id: 'logistic-1d',
      name: '\u903B\u8F91\u65AF\u8C1B\u589E\u957F\uFF08\u4E00\u7EF4\uFF09',
      dim: 1, group: '1D',
      source: [
        '# \u6709\u9650\u8D44\u6E90\u4E0B\u7684\u79CD\u7FA4\u589E\u957F\uFF1A\u589E\u957F\u7387\u672C\u8EAB\u968F\u72B6\u6001\u53D8\u5316',
        'r = 1.2',
        'K = 1',
        'dx/dt = r*x*(1 - x/K)'
      ].join('\n'),
      bounds: [[-0.5, 1.6]],
      init: [0.05],
      note: '\u4E24\u4E2A\u4E0D\u52A8\u70B9\uFF1Ax=0 \u4E0D\u7A33\u5B9A\uFF0Cx=K \u7A33\u5B9A\uFF08\u73AF\u5883\u627F\u8F7D\u529B\uFF09\u3002'
    },
    {
      id: 'cusp-1d',
      name: '\u53CC\u7A33\u6001\uFF08\u4E00\u7EF4\uFF0C\u4E09\u4E0D\u52A8\u70B9\uFF09',
      dim: 1, group: '1D',
      source: [
        '# \u52BF\u80FD V(x)=x\u2074/4 - x\u00B2/2 \u7684\u8FC7\u963B\u5C3C\u52A8\u529B\u5B66\uFF1A\u4E24\u4E2A\u7A33\u5B9A\u6001\u88AB\u4E00\u4E2A\u4E0D\u7A33\u5B9A\u6001\u5206\u5F00',
        'a = 1',
        'b = 1',
        'dx/dt = a*x - b*x^3'
      ].join('\n'),
      bounds: [[-1.8, 1.8]],
      init: [0.01],
      note: '\u4E0D\u52A8\u70B9 x=0 \u4E0D\u7A33\u5B9A\u3001x=\u00B11 \u7A33\u5B9A\u3002\u521D\u59CB\u72B6\u6001\u843D\u5728\u54EA\u4E00\u4FA7\u5C31\u51B3\u5B9A\u7ED3\u5C40\uFF08\u8DEF\u5F84\u4F9D\u8D56\uFF09\u3002'
    },
    {
      id: 'forced-1d',
      name: '\u53D7\u8FEB\u4E00\u7EF4\uFF08\u975E\u81EA\u6CBB\uFF09',
      dim: 1, group: '1D',
      source: [
        '# \u542B t \u7684\u65B9\u7A0B\uFF1A\u5411\u91CF\u573A\u968F\u65F6\u95F4\u53D8\u5316\uFF0C\u4E25\u683C\u8BF4\u5B83\u7684\u76F8\u7A7A\u95F4\u5E94\u52A0\u4E0A t \u8FD9\u4E00\u8F74',
        'A = 1',
        'w = 1.3',
        'dx/dt = -x + A*cos(w*t)'
      ].join('\n'),
      bounds: [[-2, 2]],
      init: [0],
      note: '\u201C\u975E\u81EA\u6CBB\u201D\u63D0\u9192\uFF1A\u56FE\u4E0A\u7684\u7BAD\u5934\u5728\u52A8\uFF0C\u56E0\u4E3A\u5411\u91CF\u573A\u672C\u8EAB\u53D6\u51B3\u4E8E t\u3002'
    },

    // ------------------------------------------------------------ 二维相空间
    {
      id: 'oscillator-2d',
      name: '\u7B80\u8C10\u632F\u5B50\uFF08\u4E2D\u5FC3\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u65E0\u963B\u5C3C\u7EBF\u6027\u632F\u5B50\uFF1A\u80FD\u91CF\u5B88\u6052\uFF0C\u76F8\u4F53\u79EF\u4E0D\u53D8',
        'w = 1',
        'dx/dt = v',
        'dv/dt = -w^2*x'
      ].join('\n'),
      bounds: [[-3, 3], [-3, 3]],
      init: [2, 0],
      note: '\u539F\u70B9\u662F\u4E2D\u5FC3\uFF0C\u8F68\u8FF9\u662F\u4E00\u65CF\u95ED\u5408\u692D\u5706\u3002\u6563\u5EA6 \u2207\u00B7f = 0\uFF1A\u76F8\u4F53\u79EF\u5B88\u6052\u3002'
    },
    {
      id: 'pendulum-2d',
      name: '\u5355\u6446\uFF08\u65E0\u963B\u5C3C\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u5355\u6446\uFF1A\u72B6\u6001 = (\u89D2\u5EA6 \u03B8, \u89D2\u901F\u5EA6 \u03C9)',
        'g = 9.8',
        'L = 1',
        'd\u03B8/dt = \u03C9',
        'd\u03C9/dt = -(g/L)*sin(\u03B8)'
      ].join('\n'),
      bounds: [[-3.5, 3.5], [-4, 4]],
      init: [2.2, 0],
      note: '\u6BCF\u9694 2\u03C0 \u91CD\u590D\u51FA\u73B0\u7684\u978D\u70B9\u628A\u76F8\u5E73\u9762\u5207\u6210\u201C\u6446\u52A8\u201D\u4E0E\u201C\u8F6C\u52A8\u201D\u4E24\u79CD\u8FD0\u52A8\u5F62\u5F0F\u3002'
    },
    {
      id: 'damped-pendulum-2d',
      name: '\u963B\u5C3C\u5355\u6446\uFF08\u7126\u70B9\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u52A0\u4E0A\u963B\u5C3C\uFF1A\u76F8\u4F53\u79EF\u4F1A\u88AB\u538B\u7F29\uFF0C\u8F68\u8FF9\u5411\u4E0B\u6C89',
        'g = 9.8',
        'L = 1',
        'b = 0.5',
        'd\u03B8/dt = \u03C9',
        'd\u03C9/dt = -(g/L)*sin(\u03B8) - b*\u03C9'
      ].join('\n'),
      bounds: [[-3.5, 3.5], [-4, 4]],
      init: [2.6, 0],
      note: '\u6563\u5EA6 \u2207\u00B7f = -b < 0\uFF1A\u76F8\u9762\u79EF\u6309 e^{-bt} \u8870\u51CF\uFF1B\u4EFB\u4F55\u521D\u6001\u6700\u7EC8\u843D\u5230 (\u00B12k\u03C0, 0)\u3002'
    },
    {
      id: 'van-der-pol-2d',
      name: '\u8303\u5FB7\u6CE2\u5C14\u632F\u5B50\uFF08\u6781\u9650\u73AF\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u975E\u7EBF\u6027\u963B\u5C3C\uFF1A\u5C0F\u5E45\u65F6\u4F9B\u80FD\u3001\u5927\u5E45\u65F6\u8017\u80FD',
        'mu = 1.2',
        'dx/dt = v',
        'dv/dt = mu*(1 - x^2)*v - x'
      ].join('\n'),
      bounds: [[-3.5, 3.5], [-3.5, 3.5]],
      init: [0.2, 0.2],
      note: '\u65E0\u8BBA\u4ECE\u54EA\u91CC\u51FA\u53D1\uFF0C\u6700\u7EC8\u90FD\u5377\u5165\u540C\u4E00\u6761\u5C01\u95ED\u8F68\u9053\u2014\u2014\u6781\u9650\u73AF\u3002'
    },
    {
      id: 'lotka-volterra-2d',
      name: '\u6355\u98DF\u2014\u88AB\u6355\u98DF\uFF08\u4E2D\u5FC3\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u4E24\u4E2A\u7269\u79CD\u7684\u6570\u91CF\u4F5C\u4E3A\u4E24\u4E2A\u5C5E\u6027',
        'alpha = 1.1',
        'beta = 0.4',
        'delta = 0.1',
        'gamma = 0.4',
        'dx/dt = alpha*x - beta*x*y',
        'dy/dt = delta*x*y - gamma*y'
      ].join('\n'),
      bounds: [[-0.5, 6], [-0.5, 6]],
      init: [4, 1],
      note: '\u5171\u5B58\u5E73\u8861\u70B9\u662F\u4E2D\u5FC3\uFF0C\u6570\u91CF\u6B64\u6D88\u5F7C\u6DA8\u5730\u73AF\u7ED5\uFF1B\u6539\u521D\u503C\u53EA\u6539\u5E45\u5EA6\u3001\u4E0D\u6539\u5468\u671F\u3002'
    },
    {
      id: 'damped-oscillator-2d',
      name: '\u963B\u5C3C\u632F\u5B50\uFF08\u7A33\u5B9A\u7126\u70B9\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u6700\u5E38\u89C1\u7684\u7EBF\u6027\u7CFB\u7EDF\uFF1A\u8F68\u8FF9\u662F\u5411\u5185\u65CB\u8F6C\u7684\u87BA\u65CB\u7EBF',
        'a = 0.6',
        'w = 2',
        'dx/dt = -a*x + w*y',
        'dy/dt = -w*x - a*y'
      ].join('\n'),
      bounds: [[-3, 3], [-3, 3]],
      init: [2.5, 2.5],
      note: '\u7EBF\u6027\u7CFB\u7EDF\u7684\u76F8\u56FE\u5B8C\u5168\u7531\u96C5\u53EF\u6BD4\u77E9\u9635\u7279\u5F81\u503C\u51B3\u5B9A\uFF1A\u5B9E\u90E8 -0.6\u3001\u865A\u90E8 \u00B12\u3002'
    },
    {
      id: 'bistable-2d',
      name: '\u53CC\u52BF\u9631\uFF08\u978D\u70B9\u5206\u6C34\u5CAD\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u4E24\u4E2A\u7A33\u5B9A\u70B9\u4E2D\u95F4\u5939\u4E00\u4E2A\u978D\u70B9',
        'gamma = 0.3',
        'dx/dt = v',
        'dv/dt = -gamma*v + x - x^3'
      ].join('\n'),
      bounds: [[-2.2, 2.2], [-2.2, 2.2]],
      init: [-1.2, 0.6],
      note: '\u978D\u70B9\u7684\u7A33\u5B9A\u6D41\u5F62\u6784\u6210\u5206\u6C34\u5CAD\uFF1B\u4E5F\u662F\u9A8C\u8BC1\u201C\u53CD\u5411\u79EF\u5206 = \u56DE\u6EAF\u201D\u7684\u597D\u4F8B\u5B50\u3002'
    },

    // ------------------------------------------------------------ 随机外因（悬挂 / 路面）
    {
      id: 'suspension-random-2d',
      name: '\u60AC\u6302\u7CFB\u7EDF\uFF08\u968F\u673A\u8DEF\u9762\uFF09',
      dim: 2, group: '2D',
      source: [
        '# \u60AC\u6302\u7CFB\u7EDF\uFF08\u56DB\u5206\u4E4B\u4E00\u8F66\u8F86\uFF09\uFF1A m*y\'\' + c*y\' + k*y = c*x\' + k*x',
        '#   y = \u60AC\u6302\u7CFB\u7EDF\u9876\u90E8\uFF08\u8F66\u8EAB\uFF09\u7EB5\u5411\u4F4D\u79FB \u2014\u2014 \u72B6\u6001\u53D8\u91CF',
        '#   x = \u8DEF\u9762\u7EB5\u5411\u4F4D\u79FB \u2014\u2014 \u968F\u673A\u8FC7\u7A0B\uFF0C\u5199\u6210 x(t)\uFF08\u4F4D\u79FB\uFF09\u4E0E xV(t)\uff08\u901F\u5EA6\uff09',
        '#   \u53EF\u8C03\u53C2\u6570\u53EA\u6709\u4E09\u4E2A\uFF1Am\uFF08\u8D28\u91CF\uFF09\u3001c\uFF08\u963B\u5C3C\uFF09\u3001k\uFF08\u521A\u5EA6\uFF09',
        '# \u4E0B\u9762\u4E24\u884C\u5C31\u662F\u628A\u4E0A\u9762\u90A3\u4E2A\u65B9\u7A0B\u89E3\u51FA y\'\'\uFF1Am*y\'\' = -k*(y - x) - c*(y\' - x\')',
        'm = 240',
        'c = 1200',
        'k = 16000',
        'dy/dt = v',
        'dv/dt = -(k/m)*(y - x(t)) - (c/m)*(v - xV(t))'
      ].join('\n'),
      bounds: [[-0.35, 0.35], [-2.5, 2.5]],
      init: [0, 0],
      random: { kind: 'band', wMin: 0.5, wMax: 20, components: 64, intensity: 0.0002 },
      note: '\u5916\u56E0\uFF08\u8DEF\u9762 x(t)\uFF09\u662F\u968F\u673A\u7684\uFF1A\u540C\u4E00\u4E2A\u521D\u59CB\u72B6\u6001\u6BCF\u6B21\u8D70\u51FA\u4E0D\u540C\u8DEF\u5F84\u3002' +
        '\u9ED8\u8BA4\u663E\u793A\u7684\u662F\u201C\u56FA\u5B9A\u4E00\u6B21\u8DEF\u9762\u5B9E\u73B0\u201D\u4E0B\u7684\u4E00\u6761\u8DEF\u5F84\uFF08\u60F3\u6362\u8DEF\u9762\u5C31\u6362\u79CD\u5B50\uFF09\uFF1B' +
        '\u5207\u5230\u201C\u968F\u673A\u5916\u56E0\u201D\u6A21\u5F0F\u624D\u4F1A\u91CD\u590D\u8DD1 N \u6B21\u3001\u770B\u505C\u7559\u6982\u7387\u4E0E\u529F\u7387\u8C31\u3002' +
        '\u53C2\u6570\u53EA\u6709 m\u3001c\u3001k \u4E09\u4E2A\uFF0C\u62D6\u5B83\u4EEC\uFF0C\u76F8\u56FE\u3001\u54CD\u5E94\u5E45\u5EA6\u4E0E\u54CD\u5E94\u8C31\u90FD\u4F1A\u8DDF\u7740\u53D8\u3002'
    },
    {
      id: 'suspension-random-1d',
      name: '\u4E00\u9636\u968F\u673A\u54CD\u5E94\uFF08\u53EF\u5BF9\u89E3\u6790\u503C\uFF09',
      dim: 1, group: '1D',
      source: [
        '# \u4E00\u9636\u7CFB\u7EDF\u5728\u968F\u673A\u5916\u56E0\u4E0B\u7684\u6781\u7B80\u7248\uFF1A\u53EA\u770B\u4E00\u4E2A\u5C5E\u6027',
        'a = 1.5',
        'dy/dt = -a*y + xi(t)'
      ].join('\n'),
      bounds: [[-0.6, 0.6]],
      init: [0],
      random: { kind: 'band', wMin: 0.5, wMax: 20, components: 64, intensity: 0.02 },
      note: '\u65B9\u5DEE\u6709\u89E3\u6790\u503C\uFF1AVar = \u222B S(\u03C9)/(a\u00B2+\u03C9\u00B2) d\u03C9\uFF08\u672C\u4F8B \u2248 0.0157\uFF09\u2014\u2014' +
        '\u8499\u7279\u5361\u7F57\u7ED3\u679C\u53EF\u4EE5\u76F4\u63A5\u62FF\u53BB\u5BF9\u8D26\uFF0C\u8FD9\u662F\u9A8C\u8BC1\u968F\u673A\u6A21\u5F0F\u672C\u8EAB\u5BF9\u4E0D\u5BF9\u7684\u5E95\u724C\u3002'
    },

    // ------------------------------------------------------------ 三维相空间
    {
      id: 'lorenz-3d',
      name: '\u6D1B\u4F26\u5179\u5438\u5F15\u5B50',
      dim: 3, group: '3D',
      source: [
        '# \u4E09\u4E2A\u5C5E\u6027 \u2192 \u4E09\u7EF4\u76F8\u7A7A\u95F4',
        'sigma = 10',
        'rho = 28',
        'beta = 2.6666667',
        'dx/dt = sigma*(y - x)',
        'dy/dt = x*(rho - z) - y',
        'dz/dt = x*y - beta*z'
      ].join('\n'),
      bounds: [[-25, 25], [-30, 30], [0, 55]],
      init: [1, 1, 20],
      note: '\u6563\u5EA6 = -(\u03C3+1+\u03B2) < 0\uFF1A\u76F8\u4F53\u79EF\u6052\u5B9A\u6536\u7F29\uFF0C\u4F46\u8F68\u8FF9\u53D1\u6563\u2014\u2014\u786E\u5B9A\u6027\u4E2D\u7684\u4E0D\u53EF\u9884\u6D4B\u3002'
    },
    {
      id: 'rossler-3d',
      name: '\u7F57\u65AF\u52D2\u5438\u5F15\u5B50',
      dim: 3, group: '3D',
      source: [
        '# \u6BD4\u6D1B\u4F26\u5179\u66F4\u5BB9\u6613\u770B\u6E05\u7684\u4E00\u6761\u201C\u62C9\u9762\u201D\u8F68\u8FF9',
        'a = 0.2',
        'b = 0.2',
        'c = 5.7',
        'dx/dt = -y - z',
        'dy/dt = x + a*y',
        'dz/dt = b + z*(x - c)'
      ].join('\n'),
      bounds: [[-14, 14], [-14, 14], [-2, 20]],
      init: [0, 1, 0.1],
      note: '\u5E73\u9762\u4E0A\u4E00\u5708\u4E00\u5708\u5730\u7ED5\uFF0C\u7136\u540E\u7A81\u7136\u629B\u5230\u53E6\u4E00\u5C42\uFF1B\u7ED3\u6784\u4E0D\u518D\u662F\u70B9\u6216\u7EBF\uFF0C\u800C\u662F\u4E00\u5F20\u9762\u3002'
    },
    {
      id: 'stable-node-3d',
      name: '\u4E09\u7EF4\u7EBF\u6027\u7A33\u5B9A\u8282\u70B9',
      dim: 3, group: '3D',
      source: [
        '# \u4E09\u4E2A\u65B9\u5411\u4E0A\u5404\u81EA\u6307\u6570\u8870\u51CF\uFF1A\u7BAD\u5934\u5168\u6307\u5411\u539F\u70B9',
        'dx/dt = -1.0*x',
        'dy/dt = -2.0*y',
        'dz/dt = -0.5*z'
      ].join('\n'),
      bounds: [[-3, 3], [-3, 3], [-3, 3]],
      init: [2, 2, 2],
      note: '\u7279\u5F81\u503C\u5168\u4E3A\u8D1F\u5B9E\u6570 \u2192 \u5168\u7A7A\u95F4\u6536\u655B\uFF1B\u5404\u8F74\u8870\u51CF\u901F\u7387\u4E0D\u540C\uFF0C\u76F8\u4F53\u88AB\u62C9\u6210\u4E00\u4E2A\u6241\u957F\u7684\u9525\u3002'
    }
  ];

  function byId(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }
  /** 确定性模式可选的预设（随机外因的那几个单独列） */
  function byDim(dim) {
    return PRESETS.filter(function (p) { return p.dim === dim && !p.random; });
  }
  function randomOnes() {
    return PRESETS.filter(function (p) { return !!p.random; });
  }

  return { list: PRESETS, byId: byId, byDim: byDim, randomOnes: randomOnes };
});
