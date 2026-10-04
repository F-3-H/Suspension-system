/*!
 * expr.js —— 微分方程表达式的解析与编译（相空间可视化计算器 / 第一层：语言）
 *
 * 设计约束（来自工具系统内因，而非偏好）：
 *  1. 交付形态是"双击即可运行的本地 HTML"，必须能走 file:// 加载 —— 因此不能依赖打包器、
 *     不能用 ES module（file:// 下 module 脚本受 CORS 限制），只能用经典 <script>。
 *  2. 同一份代码要能在 Node 里被 require 做机械断言（tests/verify-core.mjs）—— 因此写成 UMD：
 *     浏览器挂到 globalThis.PSExpr，Node 走 module.exports。一份源码，两条验证路径。
 *  3. 不用 new Function / eval：表达式由用户输入，构造函数式方案既难给出行列级错误定位，
 *     也让"编译产物是否可审计"变得不可能。这里编译成闭包树，牺牲一点速度换取可验证性。
 *
 * 语法（面向使用者）：
 *   参数/常数：   g = 9.8            L = 1
 *   状态方程：    theta' = omega       omega' = -(g/L)*sin(theta)
 *   可用函数：sin cos tan asin acos atan sinh cosh tanh exp ln log log10 sqrt abs sign
 *             floor ceil round min max atan2 pow hypot mod clamp step
 *   可用常数：pi π e tau phi
 *   自变量：t（出现即标记为非自治系统）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSExpr = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 归一化
  var CHAR_MAP = {
    '\uFF0B': '+', '\uFF0D': '-', '\uFF0A': '*', '\uFF0F': '/', '\uFF1D': '=',
    '\uFF0C': ',', '\uFF08': '(', '\uFF09': ')', '\uFF1B': '\n',
    '\u2212': '-', '\u2013': '-', '\u2014': '-', '\u00D7': '*',
    '\u00B7': '*', '\u2217': '*', '\u00F7': '/',
    '\u2032': "'", '\u02B9': "'", '\u2019': "'",
    '\uFF1C': '<', '\uFF1E': '>'
  };
  function normalize(src) {
    var out = '';
    var inComment = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (ch === '\n') { inComment = false; out += ch; continue; }
      if (inComment) { out += ch; continue; }   // 注释内原样保留，否则注释里的全角分号会把注释截断
      if (ch === '#') { inComment = true; out += ch; continue; }
      var code = ch.charCodeAt(0);
      // 全角 ASCII（U+FF01..U+FF5E）统一折半：＇ｘ ＝ －１＊ｘ → 'x = -1*x
      if (code >= 0xFF01 && code <= 0xFF5E) ch = String.fromCharCode(code - 0xFEE0);
      if (ch === '\u3000') ch = ' ';
      if (ch === ';') { out += '\n'; continue; }  // 分号也当语句分隔
      // ẋ / θ̇ ——"字母 + 组合点"是学生最常用的导数写法，折成 dθ/dt 交给同一套语法处理
      if (src.charCodeAt(i + 1) === 0x0307) { out += 'd' + ch + '/dt'; i++; continue; }
      out += (CHAR_MAP[ch] !== undefined ? CHAR_MAP[ch] : ch);
    }
    return out.replace(/\*\*/g, '^');
  }

  var CONSTS = {
    pi: Math.PI, PI: Math.PI, '\u03C0': Math.PI, Pi: Math.PI,
    e: Math.E, E: Math.E, tau: Math.PI * 2, '\u03C4': Math.PI * 2,
    phi: (1 + Math.sqrt(5)) / 2
  };

  var FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2,
    atan2: Math.atan2, pow: Math.pow, hypot: Math.hypot, min: Math.min, max: Math.max,
    sq: function (a) { return a * a; },
    mod: function (a, b) { return ((a % b) + b) % b; },
    clamp: function (a, lo, hi) { return a < lo ? lo : (a > hi ? hi : a); },
    step: function (a) { return a >= 0 ? 1 : 0; },
    gauss: function (a) { return Math.exp(-a * a); }
  };
  // 内置函数元数（min/max/hypot 变长）
  var ARITY = {
    sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, sinh: 1, cosh: 1, tanh: 1,
    exp: 1, sqrt: 1, abs: 1, sign: 1, floor: 1, ceil: 1, round: 1,
    log: 1, ln: 1, log10: 1, log2: 1, sq: 1, step: 1, gauss: 1,
    atan2: 2, pow: 2, mod: 2, clamp: 3
  };
  var VARIADIC = { min: true, max: true, hypot: true };

  /**
   * 外部输入（随机外因）。它们不是数学函数，而是"这一时刻外界给了多少"：
   *   x(t) / road(t)  = 路面位移（随机过程的这一次实现）
   *   xV(t) / roadV(t)= 路面速度（同一次实现的导数）
   * 由第 4 个求值参数 u 提供（u = {rand, randV}），所以**同一条方程换一次实现就能重算**，
   * 编译产物本身不含随机性——随机性只存在于 u 里。这样蒙特卡洛可复现、可断言。
   *
   * 命名纪律：别名只保留"不像普通物理量"的那些。曾经把 `w` 也列进来（想当 ω 用），
   * 结果把用户方程里名为 w 的参数（`w = 2`）整个吞掉了——参数值恒为 0，雅可比、特征值、
   * 非自治判定全线错，而界面上只是"看起来没反应"。外部名不得侵占常用变量名。
   *
   * `x` 是特例：人系统写的悬挂方程就是 `mÿ + cẏ + ky = cẋ + kx`，其中 x 是路面。
   * 它只以**调用形式**（`x(t)`）参与解析；裸写 `x` 时，若用户自己定义了状态变量/参数 x，
   * 仍然是用户的定义优先（见 parsePrimary 的 ident 分支）。
   */
  var EXTERNALS = {
    x: 'rand', road: 'rand', xi: 'rand', rand: 'rand', noise: 'rand',
    xV: 'randV', roadV: 'randV', xdot: 'randV', dx: 'randV',
    xiV: 'randV', randV: 'randV', noiseV: 'randV', droad: 'randV'
  };
  function isExternal(name) { return EXTERNALS[name] !== undefined; }

  function ParseError(message, line, col) {
    this.name = 'ParseError';
    this.message = message;
    this.line = line;
    this.col = col;
  }
  ParseError.prototype = Object.create(Error.prototype);

  // ---------------------------------------------------------------- 词法
  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function isIdentStart(ch) {
    if (!ch) return false;
    if (/[A-Za-z_]/.test(ch)) return true;
    return ch.charCodeAt(0) > 127; // 允许希腊字母等 Unicode 标识符（θ ω μ 等）
  }
  function isIdentPart(ch) {
    if (!ch) return false;
    if (/[A-Za-z0-9_]/.test(ch)) return true;
    return ch.charCodeAt(0) > 127;
  }

  function tokenize(src) {
    var tokens = [];
    var i = 0, line = 1, lineStart = 0;
    function push(type, value, start) {
      tokens.push({ type: type, value: value, line: line, col: start - lineStart + 1, start: start, end: i });
    }
    while (i < src.length) {
      var ch = src[i];
      if (ch === '\n') { i++; push('nl', '\n', i - 1); line++; lineStart = i; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
      if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
        var s = i;
        while (i < src.length && (isDigit(src[i]) || src[i] === '.')) i++;
        if (src[i] === 'e' || src[i] === 'E') {
          var save = i; i++;
          if (src[i] === '+' || src[i] === '-') i++;
          if (isDigit(src[i])) { while (i < src.length && isDigit(src[i])) i++; }
          else i = save;
        }
        var text = src.slice(s, i);
        var num = parseFloat(text);
        if (!isFinite(num)) throw new ParseError('\u65E0\u6CD5\u8BC6\u522B\u7684\u6570\u5B57\u201C' + text + '\u201D', line, s - lineStart + 1);
        push('num', num, s);
        continue;
      }
      if (isIdentStart(ch)) {
        var s2 = i;
        while (i < src.length && isIdentPart(src[i])) i++;
        push('ident', src.slice(s2, i), s2);
        continue;
      }
      if ('+-*/^%(),=\''.indexOf(ch) >= 0) { i++; push(ch, ch, i - 1); continue; }
      throw new ParseError('\u4E0D\u8BA4\u8BC6\u7684\u5B57\u7B26\u201C' + ch + '\u201D', line, i - lineStart + 1);
    }
    tokens.push({ type: 'eof', value: '', line: line, col: i - lineStart + 1, start: i, end: i });
    return tokens;
  }

  // ---------------------------------------------------------------- 语法
  // 优先级：= 最低；+ - ；* / % ；一元 - + ；^ （右结合，比一元更紧）
  function Parser(tokens, src) {
    this.toks = tokens;
    this.pos = 0;
    this.src = src;
  }
  Parser.prototype.peek = function () { return this.toks[this.pos]; };
  Parser.prototype.next = function () { return this.toks[this.pos++]; };
  Parser.prototype.expect = function (type, hint) {
    var t = this.peek();
    if (t.type !== type) {
      throw new ParseError('\u671F\u671B\u201C' + (hint || type) + '\u201D\uFF0C\u5B9E\u9645\u662F\u201C' + (t.value || '\u884C\u5C3E') + '\u201D', t.line, t.col);
    }
    return this.next();
  };

  Parser.prototype.parseExpr = function () { return this.parseAdd(); };

  Parser.prototype.parseAdd = function () {
    var node = this.parseMul();
    for (;;) {
      var t = this.peek();
      if (t.type === '+' || t.type === '-') {
        this.next();
        node = { type: 'bin', op: t.type, a: node, b: this.parseMul(), line: t.line, col: t.col };
      } else return node;
    }
  };
  Parser.prototype.parseMul = function () {
    var node = this.parseUnary();
    for (;;) {
      var t = this.peek();
      if (t.type === '*' || t.type === '/' || t.type === '%') {
        this.next();
        node = { type: 'bin', op: t.type, a: node, b: this.parseUnary(), line: t.line, col: t.col };
      } else return node;
    }
  };
  Parser.prototype.parseUnary = function () {
    var t = this.peek();
    if (t.type === '-') { this.next(); return { type: 'un', op: '-', a: this.parseUnary(), line: t.line, col: t.col }; }
    if (t.type === '+') { this.next(); return this.parseUnary(); }
    return this.parsePower();
  };
  Parser.prototype.parsePower = function () {
    var base = this.parsePrimary();
    var t = this.peek();
    if (t.type === '^') {
      this.next();
      return { type: 'bin', op: '^', a: base, b: this.parseUnary(), line: t.line, col: t.col };
    }
    return base;
  };
  Parser.prototype.parsePrimary = function () {
    var t = this.next();
    if (t.type === 'num') return { type: 'num', v: t.value, line: t.line, col: t.col };
    if (t.type === '(') {
      var inner = this.parseExpr();
      this.expect(')', ')');
      return inner;
    }
    if (t.type === 'ident') {
      if (this.peek().type === '(') {
        this.next();
        var args = [];
        if (this.peek().type !== ')') {
          args.push(this.parseExpr());
          while (this.peek().type === ',') { this.next(); args.push(this.parseExpr()); }
        }
        this.expect(')', ')');
        if (!FUNCS[t.value] && !isExternal(t.value)) {
          throw new ParseError('\u672A\u77E5\u51FD\u6570\u201C' + t.value + '\u201D\uFF08\u53EF\u7528\uFF1A' + Object.keys(FUNCS).join(' ') +
            '\uFF1B\u968F\u673A\u5916\u56E0\uFF1A' + Object.keys(EXTERNALS).join(' ') + '\uFF09', t.line, t.col);
        }
        if (isExternal(t.value)) {
          // 外部输入的参数只是书写形式（表示"此刻"），不参与求值
          return { type: 'call', name: t.value, args: args, line: t.line, col: t.col };
        }
        if (ARITY[t.value] !== undefined && args.length !== ARITY[t.value]) {
          throw new ParseError('\u51FD\u6570\u201C' + t.value + '\u201D\u9700\u8981 ' + ARITY[t.value] + ' \u4E2A\u53C2\u6570\uFF0C\u5B9E\u9645\u7ED9\u4E86 ' + args.length + ' \u4E2A', t.line, t.col);
        }
        if (VARIADIC[t.value] && args.length === 0) {
          throw new ParseError('\u51FD\u6570\u201C' + t.value + '\u201D\u81F3\u5C11\u9700\u8981 1 \u4E2A\u53C2\u6570', t.line, t.col);
        }
        return { type: 'call', name: t.value, args: args, line: t.line, col: t.col };
      }
      return { type: 'ident', name: t.value, line: t.line, col: t.col };
    }
    throw new ParseError('\u8868\u8FBE\u5F0F\u4E0D\u5B8C\u6574\uFF1A\u5728\u8FD9\u91CC\u671F\u671B\u4E00\u4E2A\u6570\u5B57\u3001\u53D8\u91CF\u6216\u62EC\u53F7\uFF0C\u5B9E\u9645\u662F\u201C' + (t.value || '\u884C\u5C3E') + '\u201D', t.line, t.col);
  };

  // ---------------------------------------------------------------- 编译为闭包
  // 所有闭包的求值签名统一为 (x, p, t, u)：
  //   x = 状态向量，p = 参数向量，t = 时刻，u = 外部输入（随机外因）{rand, randV}
  function compileNode(node, ctx) {
    switch (node.type) {
      case 'num': { var v = node.v; return function () { return v; }; }
      case 'un': {
        var a = compileNode(node.a, ctx);
        return function (x, p, t, u) { return -a(x, p, t, u); };
      }
      case 'bin': {
        var l = compileNode(node.a, ctx), r = compileNode(node.b, ctx);
        switch (node.op) {
          case '+': return function (x, p, t, u) { return l(x, p, t, u) + r(x, p, t, u); };
          case '-': return function (x, p, t, u) { return l(x, p, t, u) - r(x, p, t, u); };
          case '*': return function (x, p, t, u) { return l(x, p, t, u) * r(x, p, t, u); };
          case '/': return function (x, p, t, u) { return l(x, p, t, u) / r(x, p, t, u); };
          case '%': return function (x, p, t, u) { return l(x, p, t, u) % r(x, p, t, u); };
          case '^': return function (x, p, t, u) { return Math.pow(l(x, p, t, u), r(x, p, t, u)); };
        }
        break;
      }
      case 'call': {
        if (isExternal(node.name)) {
          // 外部输入：参数只作书写用（road(t) 的 t 表示"此刻"），实际由 u 提供
          ctx.usesRandom = true;
          var slot = EXTERNALS[node.name];
          return function (x, p, t, u) {
            if (!u || !u[slot]) return 0;
            return u[slot](t);
          };
        }
        var fn = FUNCS[node.name];
        var as = node.args.map(function (n) { return compileNode(n, ctx); });
        if (as.length === 1) { var a0 = as[0]; return function (x, p, t, u) { return fn(a0(x, p, t, u)); }; }
        if (as.length === 2) {
          var b0 = as[0], b1 = as[1];
          return function (x, p, t, u) { return fn(b0(x, p, t, u), b1(x, p, t, u)); };
        }
        return function (x, p, t, u) {
          var argv = new Array(as.length);
          for (var i = 0; i < as.length; i++) argv[i] = as[i](x, p, t, u);
          return fn.apply(null, argv);
        };
      }
      case 'ident': {
        if (CONSTS[node.name] !== undefined) { var c = CONSTS[node.name]; return function () { return c; }; }
        if (node.name === 't') return function (x, p, t) { return t; };
        if (ctx.varSlot[node.name] !== undefined) { var s = ctx.varSlot[node.name]; return function (x) { return x[s]; }; }
        if (ctx.paramSlot[node.name] !== undefined) { var k = ctx.paramSlot[node.name]; return function (x, p) { return p[k]; }; }
        // 外部输入也可以不带括号写（road 就等于 road(t)）；但**用户自己定义的名字优先**，
        // 所以这一支放在状态变量与参数之后——否则 `w = 2` 这样的参数会被同名的外部别名吞掉
        if (isExternal(node.name)) {
          ctx.usesRandom = true;
          var slot2 = EXTERNALS[node.name];
          return function (x, p, t, u) { return (u && u[slot2]) ? u[slot2](t) : 0; };
        }
        throw new ParseError('\u672A\u5B9A\u4E49\u7684\u91CF\u201C' + node.name + '\u201D\uFF08\u5B83\u65E2\u4E0D\u662F\u72B6\u6001\u53D8\u91CF\u3001\u4E5F\u6CA1\u6709\u5728\u7B49\u5F0F\u91CC\u8D4B\u503C\uFF09', node.line, node.col);
      }
    }
    throw new ParseError('\u5185\u90E8\u9519\u8BEF\uFF1A\u672A\u77E5\u8282\u70B9\u7C7B\u578B ' + node.type, node.line, node.col);
  }

  function collectIdents(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (node.type === 'ident') out[node.name] = true;
    if (node.args) node.args.forEach(function (n) { collectIdents(n, out); });
    if (node.a) collectIdents(node.a, out);
    if (node.b) collectIdents(node.b, out);
    return out;
  }

  // ---------------------------------------------------------------- 顶层
  function parseProgram(src) {
    var norm = normalize(src);
    var toks = tokenize(norm);
    var p = new Parser(toks, norm);
    var statements = [];
    var errors = [];
    for (;;) {
      while (p.peek().type === 'nl') p.next();
      if (p.peek().type === 'eof') break;
      var startIdx = p.pos;
      try {
        var t = p.peek();
        if (t.type !== 'ident') {
          throw new ParseError('\u6BCF\u4E00\u884C\u8981\u4E48\u662F\u5DF2\u77E5\u91CF\uFF08\u5982 \u201Cg = 9.8\u201D\uFF09\uFF0C\u8981\u4E48\u662F\u5FAE\u5206\u65B9\u7A0B\uFF08\u5982 \u201Cd\u03B8/dt = \u03C9\u201D\uFF09', t.line, t.col);
        }
        var nameTok = p.next();
        var isDeriv = false;
        // 学生写法。注意词法层的事实：`dθ` 会被**整体**读成一个标识符（θ 是标识符字符），
        // 所以 "dθ/dt" 的 token 是 [dθ][/][dt]，而不是 [d][θ][/][dt]。
        // 三种等价写法都要认：dθ/dt、d θ/dt、d/dt θ。
        var v0 = nameTok.value;
        if ((v0 === 'd' || v0 === 'D') && p.peek().type === '/') {
          p.next();                                  // 吃掉 '/'
          var dtT = p.next();
          if (!(dtT.type === 'ident' && (dtT.value === 'dt' || dtT.value === 't'))) {
            throw new ParseError('\u201Cd/\u2026\u201D\u7684\u5206\u6BCD\u5E94\u662F dt\uFF08\u5982 d/dt x\uFF09', dtT.line, dtT.col);
          }
          var nmx = p.next();
          if (nmx.type !== 'ident') {
            throw new ParseError('\u201Cd/dt\u201D\u540E\u9762\u5E94\u8DDF\u88AB\u6C42\u5BFC\u7684\u53D8\u91CF\u540D\uFF08\u5982 d/dt x\uFF09', nmx.line, nmx.col);
          }
          nameTok = nmx; isDeriv = true;
        } else if ((v0 === 'd' || v0 === 'D') && p.peek().type === 'ident') {
          var nmMid = p.next();                       // d θ /dt（d 与 θ 之间有空格）
          p.expect('/', '/');
          var dtT2 = p.next();
          if (!(dtT2.type === 'ident' && (dtT2.value === 'dt' || dtT2.value === 't'))) {
            throw new ParseError('\u201Cd' + nmMid.value + '/\u2026\u201D\u7684\u5206\u6BCD\u5E94\u662F dt\uFF08\u5982 d' + nmMid.value + '/dt\uFF09', dtT2.line, dtT2.col);
          }
          nameTok = nmMid; isDeriv = true;
        } else if (v0.length > 1 && (v0.charAt(0) === 'd' || v0.charAt(0) === 'D') && p.peek().type === '/') {
          p.next();                                   // 吃掉 '/'
          var dtT3 = p.next();
          if (!(dtT3.type === 'ident' && (dtT3.value === 'dt' || dtT3.value === 't'))) {
            throw new ParseError('\u201C' + v0 + '/\u2026\u201D\u7684\u5206\u6BCD\u5E94\u662F dt\uFF08\u5982 ' + v0 + '/dt\uFF09', dtT3.line, dtT3.col);
          }
          nameTok = { type: 'ident', value: v0.slice(1), line: nameTok.line, col: nameTok.col };
          isDeriv = true;
        } else if (p.peek().type === '\'') {
          p.next();
          isDeriv = true;
        }
        var lhsEndTok = p.peek();          // 此刻正是 '='，用它切出左端原文（用于回显"你写的那一行"）
        var lhsText = norm.slice(toks[startIdx].start, lhsEndTok.start).replace(/\s+/g, ' ').trim();
        p.expect('=', '=');
        var rhsStart = p.peek();          // 取右端表达式的起点，不能从语句头切片
        var rhs = p.parseExpr();
        var rhsEnd = p.toks[p.pos - 1].end;
        var rhsText = norm.slice(rhsStart.start, rhsEnd).replace(/\s+/g, ' ').trim();
        if (p.peek().type !== 'nl' && p.peek().type !== 'eof') {
          var bad = p.peek();
          throw new ParseError('\u8BED\u53E5\u672B\u5C3E\u6709\u591A\u4F59\u5185\u5BB9\u201C' + bad.value + '\u201D', bad.line, bad.col);
        }
        void startIdx;
        statements.push({
          kind: isDeriv ? 'deriv' : 'param',
          name: nameTok.value,
          lhsText: lhsText,
          expr: rhs,
          rhsText: rhsText,
          line: nameTok.line,
          col: nameTok.col
        });
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        errors.push({ line: e.line, col: e.col, message: e.message });
        while (p.peek().type !== 'nl' && p.peek().type !== 'eof') p.next();
      }
    }
    return { statements: statements, errors: errors };
  }

  function compile(source) {
    var parsed, errors = [];
    try {
      parsed = parseProgram(source);
    } catch (e) {
      return { ok: false, errors: [{ line: e.line || 1, col: e.col || 1, message: e.message }], source: source };
    }
    errors = parsed.errors.slice();
    var stmts = parsed.statements;

    var derivs = stmts.filter(function (s) { return s.kind === 'deriv'; });
    var params = stmts.filter(function (s) { return s.kind === 'param'; });
    var varNames = derivs.map(function (s) { return s.name; });
    var paramNames = params.map(function (s) { return s.name; });

    // 重名检查
    var seen = {};
    varNames.concat(paramNames).forEach(function (n) {
      if (seen[n]) errors.push({ line: 1, col: 1, message: '\u540D\u5B57\u201C' + n + '\u201D\u91CD\u590D\u5B9A\u4E49' });
      seen[n] = true;
    });
    varNames.forEach(function (n) {
      if (CONSTS[n] !== undefined) errors.push({ line: 1, col: 1, message: '\u72B6\u6001\u53D8\u91CF\u4E0D\u80FD\u53EB\u201C' + n + '\u201D\uFF08\u5DF2\u662F\u5185\u7F6E\u5E38\u6570\uFF09' });
    });
    // 保留名检查：t 是自变量，函数名是调用语法。若允许同名，表达式里的 t 会静默地指向时间而不是状态变量，
    // 方程写得出来、图也画得出来，只是含义被换掉了 —— 这类"安静的错误"必须在编译期拒绝。
    varNames.concat(paramNames).forEach(function (n) {
      if (n === 't') errors.push({ line: 1, col: 1, message: '\u201Ct\u201D\u662F\u81EA\u53D8\u91CF\u7684\u4FDD\u7559\u540D\uFF0C\u4E0D\u80FD\u7528\u4F5C\u72B6\u6001\u53D8\u91CF\u6216\u53C2\u6570\u540D\uFF08\u5EFA\u8BAE\u6539\u7528 theta / tau / tt \u7B49\uFF09' });
      if (FUNCS[n]) errors.push({ line: 1, col: 1, message: '\u201C' + n + '\u201D\u662F\u5185\u7F6E\u51FD\u6570\u540D\uFF0C\u4E0D\u80FD\u7528\u4F5C\u53D8\u91CF\u540D' });
    });
    if (varNames.length === 0 && errors.length === 0) {
      errors.push({ line: 1, col: 1, message: '\u6CA1\u6709\u4EFB\u4F55\u5FAE\u5206\u65B9\u7A0B\uFF08\u5F62\u5982 \u201Cd\u03B8/dt = \u03C9\u201D \u6216 \u201Cx\' = \u2026\u201D\uFF09\uFF0C\u65E0\u6CD5\u6784\u6210\u76F8\u7A7A\u95F4' });
    }
    if (errors.length) return { ok: false, errors: errors, source: source };

    var ctx = { varSlot: {}, paramSlot: {}, usesRandom: false };
    varNames.forEach(function (n, i) { ctx.varSlot[n] = i; });
    paramNames.forEach(function (n, i) { ctx.paramSlot[n] = i; });

    // 参数依赖（参数可引用参数），做拓扑排序，检测环
    var paramExprs = {}, paramDeps = {};
    try {
      params.forEach(function (s, i) {
        var ids0 = collectIdents(s.expr, {});
        var ext = Object.keys(ids0).filter(isExternal);
        if (ext.length) {
          throw new ParseError('\u53C2\u6570\u201C' + s.name + '\u201D\u4E0D\u80FD\u4F9D\u8D56\u5916\u90E8\u8F93\u5165\u201C' + ext[0] + '\u201D\uFF08\u53C2\u6570\u662F\u5E38\u6570\uFF0C\u968F\u673A\u5916\u56E0\u53EA\u80FD\u5199\u5728\u5FAE\u5206\u65B9\u7A0B\u91CC\uFF09', s.line, s.col);
        }
        // 参数也不能依赖状态变量：参数是常数，随状态变的量必须写成微分方程。
        // 若放行，求值时会对着 null 取下标（在编译期就抛异常），而且"参数"这个说法本身就失真了。
        var bad = Object.keys(ids0).filter(function (k) { return ctx.varSlot[k] !== undefined; });
        if (bad.length) {
          throw new ParseError('\u53C2\u6570\u201C' + s.name + '\u201D\u4E0D\u80FD\u4F9D\u8D56\u72B6\u6001\u53D8\u91CF\u201C' + bad[0] +
            '\u201D\uFF08\u53C2\u6570\u662F\u5E38\u6570\uFF1B\u968F\u72B6\u6001\u53D8\u5316\u7684\u91CF\u8981\u5199\u6210\u5FAE\u5206\u65B9\u7A0B\uFF09', s.line, s.col);
        }
        paramExprs[s.name] = compileNode(s.expr, ctx);
        paramDeps[s.name] = Object.keys(ids0).filter(function (k) { return ctx.paramSlot[k] !== undefined; });
        void i;
      });
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, errors: [{ line: e.line, col: e.col, message: e.message }], source: source };
      throw e;
    }
    var order = [];
    var state = {};
    var cyclic = null;
    // 注意：这里必须是函数声明而不是 (function visit(){})() —— 括号包裹的函数表达式不提升，
    // 下一行的 forEach 会抛 "visit is not defined"（此坑在 tools-web-frontend.md 已记录，本轮再次踩中）
    function visit(n, stack) {
      if (state[n] === 2) return;
      if (state[n] === 1) { cyclic = stack.concat([n]).join(' \u2192 '); return; }
      state[n] = 1;
      paramDeps[n].forEach(function (d) { if (!cyclic) visit(d, stack.concat([n])); });
      state[n] = 2;
      order.push(n);
    }
    paramNames.forEach(function (n) { if (!cyclic) visit(n, []); });
    if (cyclic) return { ok: false, errors: [{ line: 1, col: 1, message: '\u53C2\u6570\u4E92\u76F8\u5F15\u7528\u6210\u73AF\uFF1A' + cyclic }], source: source };

    var derivFns = [], usesTime = false;
    try {
      derivs.forEach(function (s) {
        derivFns.push(compileNode(s.expr, ctx));
        if (collectIdents(s.expr, {})['t']) usesTime = true;
      });
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, errors: [{ line: e.line, col: e.col, message: e.message }], source: source };
      throw e;
    }

    var defaults = {};
    (function evalDefaults() {
      var pv = new Float64Array(paramNames.length);
      order.forEach(function (n) {
        var val = paramExprs[n](null, pv, 0);
        pv[ctx.paramSlot[n]] = isFinite(val) ? val : 0;
      });
      paramNames.forEach(function (n, i) { defaults[n] = pv[i]; });
    })();

    /**
     * 派生参数 = RHS 里引用了别的参数（如 w0 = sqrt(k/m)、zeta = c/(2*sqrt(k*m))）。
     * 它们**必须由依赖它们的参数重新算出来**，不能由外部赋值。
     *
     * 这是人系统报障的根因：原先 makeSystem 的规则是"外部给了值就用外部值"，
     * 而界面会给每个参数都塞一个值（取自 paramDefaults，即编译时算出的那一次），
     * 于是 w0 被永久冻在默认值上 —— 拖动 k、m 滑杆时方程其实一点没变，
     * 界面上却只表现为"调参数相图不动"，没有任何报错。
     */
    var derived = {};
    paramNames.forEach(function (n) { derived[n] = paramDeps[n].length > 0; });

    var compiled = {
      ok: true,
      errors: [],
      source: source,
      dim: varNames.length,
      varNames: varNames,
      paramNames: paramNames,
      paramDefaults: defaults,
      paramOrder: order,
      /** 哪些参数是"推导出来的"（界面不该给它们装滑杆：拖它没有意义，它跟着别人走） */
      paramDerived: derived,
      /** 当前参数值 → 各派生量的取值（读数用） */
      evalParams: function (paramValues) {
        var pv = new Float64Array(paramNames.length);
        order.forEach(function (n) {
          if (derived[n]) {
            var val = paramExprs[n](null, pv, 0);
            pv[ctx.paramSlot[n]] = isFinite(val) ? val : defaults[n];
            return;
          }
          var raw = (paramValues && paramValues[n] !== undefined) ? paramValues[n] : defaults[n];
          pv[ctx.paramSlot[n]] = isFinite(raw) ? raw : defaults[n];
        });
        var out = {};
        paramNames.forEach(function (n, i) { out[n] = pv[i]; });
        return out;
      },
      usesTime: usesTime,
      usesRandom: ctx.usesRandom,
      derivTexts: derivs.map(function (s) { return { name: s.name, lhsText: s.lhsText, text: s.rhsText, line: s.line }; }),
      /** 用给定参数值与外部输入构造可调用的向量场 f(x, t, out)。aux = {rand, randV} */
      makeSystem: function (paramValues, aux) {
        var pv = new Float64Array(paramNames.length);
        order.forEach(function (n) {
          if (derived[n]) {
            // 派生参数：忽略外部给的值，用**当前**的依赖值重算（order 已保证依赖先算）
            var val = paramExprs[n](null, pv, 0);
            pv[ctx.paramSlot[n]] = isFinite(val) ? val : defaults[n];
            return;
          }
          var raw = (paramValues && paramValues[n] !== undefined) ? paramValues[n] : defaults[n];
          pv[ctx.paramSlot[n]] = isFinite(raw) ? raw : defaults[n];
        });
        var dim = varNames.length;
        var f = function (x, t, out) {
          if (!out) out = new Float64Array(dim);
          for (var i = 0; i < dim; i++) {
            var v = derivFns[i](x, pv, t || 0, aux);
            out[i] = isFinite(v) ? v : 0;
          }
          return out;
        };
        return {
          dim: dim,
          varNames: varNames.slice(),
          paramNames: paramNames.slice(),
          paramValues: pv,
          usesTime: usesTime,
          usesRandom: ctx.usesRandom,
          aux: aux || null,
          f: f
        };
      }
    };
    return compiled;
  }

  return {
    compile: compile,
    normalize: normalize,
    tokenize: tokenize,
    FUNCS: FUNCS,
    CONSTS: CONSTS,
    EXTERNALS: EXTERNALS,
    isExternal: isExternal,
    ParseError: ParseError
  };
});
