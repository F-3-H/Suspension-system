/**
 * 多尺寸布局回归：在若干个窗口尺寸下各跑一遍浏览器内自检，逐个尺寸报告通过/失败。
 *
 * 为什么要它：人系统两次报"功率谱密度框看不全"，而我每次只在**一个**尺寸下验过。
 * 布局这类缺陷与窗口尺寸强相关 —— 单尺寸绿不等于各尺寸绿。这个脚本把"尺寸"变成参数，
 * 让"看得见/看不见"变成可复跑的机械判定。
 *
 * 用法：先起服务（node tools/serve.cjs 4188 .），再 node tools/verify-sizes.cjs [尺寸...]
 *   尺寸写法 "宽x高"，默认给常见的一串（含窄窗口与矮窗口）。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOG = path.join(root, 'tools', 'server.log');
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const PORT = process.env.PSX_PORT || '4188';
const URL = `http://127.0.0.1:${PORT}/?selftest=1`;

const sizes = process.argv.slice(2).length ? process.argv.slice(2)
  : ['1400x900', '1280x800', '1180x720', '1024x680', '1024x640', '1024x600', '1024x560', '1024x500', '1024x460', '900x520'];

function reportCount() {
  try {
    const t = fs.readFileSync(LOG, 'utf8');
    return (t.match(/REPORT/g) || []).length;
  } catch (e) { return 0; }
}
function lastReport(after) {
  const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(l => l.indexOf('REPORT') >= 0);
  return lines.length > after ? lines[lines.length - 1] : null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function main() {
  if (!EDGE) { console.error('找不到 msedge.exe'); process.exit(2); }
  if (!fs.existsSync(LOG)) { console.error('找不到 tools/server.log —— 请先起 node tools/serve.cjs 4188 .'); process.exit(2); }
  const results = [];
  for (const sz of sizes) {
    const [w, h] = sz.split('x');
    const before = reportCount();
    try {
      execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
        `--user-data-dir=${path.join(process.env.TEMP || '.', 'psx-headless')}`,
        '--virtual-time-budget=30000', `--window-size=${w},${h}`, URL], { stdio: 'ignore', timeout: 120000 });
    } catch (e) { /* 无头浏览器退出码非 0 是常态，看日志 */ }
    let line = null;
    for (let i = 0; i < 20 && !line; i++) { await sleep(400); line = lastReport(before); }
    if (!line) { results.push({ sz, ok: false, note: '没有收到 REPORT（自检没跑起来）' }); continue; }
    const m = /pass=(\d+)\s+fail=(\d+)(?:\s+failed=(.*))?$/.exec(line.trim());
    if (!m) { results.push({ sz, ok: false, note: 'REPORT 解析失败: ' + line }); continue; }
    const fails = parseInt(m[2], 10);
    results.push({ sz, ok: fails === 0, pass: +m[1], fail: fails, note: (m[3] || '').trim() });
  }
  console.log('\n尺寸        结果      通过/失败   失败明细');
  console.log('-'.repeat(96));
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log(`${r.sz.padEnd(11)} ${(r.ok ? 'OK  ' : 'FAIL').padEnd(9)} ` +
      `${String(r.pass + '/' + r.fail).padEnd(11)} ${r.note.slice(0, 60)}`);
  }
  console.log('-'.repeat(96));
  console.log(bad ? `有 ${bad} 个尺寸不通过` : `全部 ${results.length} 个尺寸通过`);
  process.exit(bad ? 1 : 0);
})();
