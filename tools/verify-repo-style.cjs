/**
 * verify-repo-style.cjs —— 仓库风格与链接的统一性检查
 *
 * "统一风格"这件事如果不落成断言，就只能靠人眼看，而人眼在五个页面之间一定会漏。
 * 这个脚本把规范里可机械判定的部分全部钉住：
 *   1) 每个页面都 <link> 了共享主题，且相对路径正确
 *   2) 每个页面都有统一顶栏（可回导航页）与统一页脚
 *   3) 页面里不再残留并入前的旧配色（各项目原来那几套十六进制值）
 *   4) 混合写法：CSS 里的界面配色必须用 var(--token)，不许再写死十六进制
 *   5) 导航页与磁盘上的模块**双向一致**（有模块没卡片、或有卡片没文件都要报）
 *   6) 离线自足项目里复制的那份 token 与 assets/theme.css 保持一致
 *
 * 用法：node tools/verify-repo-style.cjs        （退出码非 0 表示不通过）
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; fails.push(label + (detail ? '  \u2192 ' + detail : '')); console.log('  \u2717 ' + label + (detail ? '  \u2192 ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const read = (p) => fs.readFileSync(p, 'utf8');
const themePath = path.join(root, 'assets', 'theme.css');
ok(fs.existsSync(themePath), '\u5171\u4EAB\u4E3B\u9898 assets/theme.css \u5B58\u5728');
const theme = read(themePath);

/** 主题里定义的 token（名 → 值） */
function tokensOf(css) {
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css);
  const out = {};
  if (!block) return out;
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const tokens = tokensOf(theme);

// ---------------------------------------------------------------- 收集页面
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const pages = walk(root);
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

section('\u9875\u9762\u6E05\u5355');
ok(pages.length >= 5, '\u81F3\u5C11\u6709\u5BFC\u822A\u9875 + 4 \u4E2A\u5B50\u9879\u76EE\u9875\u9762', pages.map(rel).join(', '));
console.log('    ' + pages.map(rel).join('\n    '));

// ---------------------------------------------------------------- 1/2 外壳
section('\u7EDF\u4E00\u5916\u58F3\uFF08\u4E3B\u9898\u3001\u9876\u680F\u3001\u9875\u811A\u3001\u8BED\u8A00\uFF09');
// 兼容交付物的两种清单维护方式：modules\STATUS.md（风格测试）或 SKILL.md（技能仓库）
for (const p of pages) {
  const r = rel(p);
  const html = read(p);
  const depth = r.split('/').length - 1;
  const want = '../'.repeat(depth) + 'assets/theme.css';
  ok(html.includes('href="' + want + '"'),
    `${r} \u5F15\u7528\u4E86\u5171\u4EAB\u4E3B\u9898\uFF08${want}\uFF09`,
    (html.match(/href="[^"]*theme\.css"/) || ['\u672A\u5F15\u7528'])[0]);
  ok(/class="sitebar[^"]*"/.test(html), `${r} \u6709\u7EDF\u4E00\u9876\u680F .sitebar`);
  const home = depth === 0 ? 'index.html' : '../'.repeat(depth) + 'index.html';
  ok(new RegExp('class="brand"[^>]*href="' + home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(html) ||
    new RegExp('href="' + home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*class="brand"').test(html),
    `${r} \u9876\u680F\u80FD\u56DE\u5230\u5BFC\u822A\u9875\uFF08${home}\uFF09`);
  ok(/footer class="site-foot"/.test(html) || r === 'index.html' || /data-shell="app"/.test(html),
    `${r} \u6709\u7EDF\u4E00\u9875\u811A\uFF08\u6574\u5C4F\u5E94\u7528\u7C7B\u9875\u9762\u53EF\u6807 data-shell="app" \u514D\u9875\u811A\uFF09`);
  ok(/<html lang="zh-CN">/.test(html), `${r} \u8BED\u8A00\u6807\u4E3A zh-CN`);
  ok(/<title>[^<]+<\/title>/.test(html), `${r} \u6709\u6807\u9898`);
}

// ---------------------------------------------------------------- 3 旧配色残留
section('\u65E7\u914D\u8272\u6B8B\u7559\uFF08\u5E76\u5165\u524D\u5404\u9879\u76EE\u81EA\u5DF1\u90A3\u5957\uFF09');
const LEGACY = {
  '#1e1e1e': '\u5BFC\u822A\u9875/\u63A7\u5236\u53F0\u65E7\u5E95\u8272',
  '#15181c': '3D \u6A21\u5757\u65E7\u5E95\u8272',
  '#f3f6fb': '\u632F\u52A8\u6A21\u5757\u65E7\u6D45\u5E95',
  '#2563eb': '\u632F\u52A8\u6A21\u5757\u65E7\u84DD',
  '#e0721a': '\u632F\u52A8\u6A21\u5757\u65E7\u6A59',
  '#0f9d76': '\u632F\u52A8\u6A21\u5757\u65E7\u7EFF',
  '#dc2626': '\u632F\u52A8\u6A21\u5757\u65E7\u7EA2',
  '#16203a': '\u632F\u52A8\u6A21\u5757\u65E7\u58A8\u8272',
  '#5d6c86': '\u632F\u52A8\u6A21\u5757\u65E7\u6B21\u7EA7\u6587\u5B57',
  '#dce4f0': '\u632F\u52A8\u6A21\u5757\u65E7\u5206\u9694\u7EBF'
};
// 注意：--panel(#23272d)、--panel-2(#2a2f36)、--line(#363c45)、--accent(#00adb5) 这些**当前 token 的值**
// 允许出现在 <script> 里（画布/three.js/Plotly 需要字面量）；CSS 里则必须写 var(--token)（见下面第 4 项）。
for (const p of pages) {
  const r = rel(p);
  const html = read(p);
  const hits = [];
  for (const [hex, why] of Object.entries(LEGACY)) {
    const n = (html.match(new RegExp(hex, 'gi')) || []).length;
    if (n) hits.push(`${hex}\u00D7${n}\uFF08${why}\uFF09`);
  }
  ok(hits.length === 0, `${r} \u65E0\u65E7\u914D\u8272\u786C\u5199`, hits.join(', '));
}

// ---------------------------------------------------------------- 4 CSS 里不许写死界面色
section('CSS \u91CC\u7684\u754C\u9762\u914D\u8272\u5FC5\u987B\u7528 token');
/** token 定义块本来就该写十六进制，检查前先摘掉 */
function stripTokenBlock(css) { return css.replace(/:root\s*\{[\s\S]*?\}/g, ''); }
function checkCssColors(label, css) {
  const suspicious = [...stripTokenBlock(css).matchAll(/#[0-9a-fA-F]{3,6}\b/g)]
    .map(m => m[0].toLowerCase())
    .filter(h => !['#000', '#000000', '#fff', '#ffffff'].includes(h));
  ok(suspicious.length === 0, `${label} \u91CC\u6CA1\u6709\u786C\u5199\u4E3B\u9898\u8272\uFF08token \u5B9A\u4E49\u5757\u9664\u5916\uFF09`,
    [...new Set(suspicious)].slice(0, 6).join(', ') + (suspicious.length > 6 ? ` \u7B49 ${suspicious.length} \u5904` : ''));
}
for (const p of pages) {
  const r = rel(p);
  const styles = [...read(p).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  if (styles.trim()) checkCssColors(r + ' \u7684 <style>', styles);
}

// ---------------------------------------------------------------- 5 导航页双向一致
section('\u5BFC\u822A\u9875\u4E0E\u78C1\u76D8\u6A21\u5757\u53CC\u5411\u4E00\u81F4');
const hub = read(path.join(root, 'index.html'));
const moduleFiles = pages.filter(p => rel(p).startsWith('modules/') && rel(p).split('/').length === 2).map(rel);
const moduleProjects = pages.filter(p => rel(p).startsWith('modules/') && rel(p).split('/').length === 3).map(rel);
for (const m of moduleFiles.concat(moduleProjects)) {
  ok(hub.includes('"' + m + '"'), `\u5BFC\u822A\u9875\u6709\u6307\u5411 ${m} \u7684\u5361\u7247`);
}
// 反向：卡片链接的文件都存在
for (const m of hub.matchAll(/href="((?:modules|assets)\/[^"]+)"/g)) {
  const target = path.join(root, m[1]);
  ok(fs.existsSync(target), `\u5361\u7247\u94FE\u63A5\u5B58\u5728\uFF1A${m[1]}`);
}

// ---------------------------------------------------------------- 6 token 同步
section('\u79BB\u7EBF\u81EA\u8DB3\u9879\u76EE\u91CC\u590D\u5236\u7684 token \u4E0E\u4E3B\u9898\u4E00\u81F4');
const extraCss = [];
(function findCss(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findCss(p);
    else if (e.name.endsWith('.css') && p !== themePath) extraCss.push(p);
  }
})(root);
ok(extraCss.length >= 1, '\u627E\u5230\u5B50\u9879\u76EE\u81EA\u5DF1\u7684\u6837\u5F0F\u8868', extraCss.map(rel).join(', '));
for (const p of extraCss) {
  // 外链样式表同样要查硬写颜色（多文件项目的样式全在这里）
  checkCssColors(rel(p), read(p));
  const local = tokensOf(read(p));
  const keys = ['--bg', '--bg-deep', '--panel', '--line', '--fg', '--fg-dim', '--accent', '--accent-2', '--ok', '--warn', '--danger'];
  const bad = keys.filter(k => tokens[k] && local[k] && local[k] !== tokens[k]);
  const missing = keys.filter(k => tokens[k] && !local[k]);
  ok(bad.length === 0, `${rel(p)} \u91CC\u590D\u5236\u7684\u4E3B\u8272 token \u4E0E\u4E3B\u9898\u4E00\u81F4`,
    bad.map(k => `${k}: ${local[k]} \u2260 ${tokens[k]}`).join(', '));
  if (missing.length) console.log(`    \uFF08${rel(p)} \u672A\u5B9A\u4E49 ${missing.join(', ')}\uFF1A\u5C5E\u4E8E\u53EF\u9009\uFF09`);
}

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(64));
console.log(`\u901A\u8FC7 ${pass} \u9879\uFF0C\u5931\u8D25 ${fail} \u9879`);
if (fail) { console.log('\n\u5931\u8D25\u6E05\u5355\uFF1A'); fails.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
