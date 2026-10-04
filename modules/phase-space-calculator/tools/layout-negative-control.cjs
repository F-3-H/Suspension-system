/**
 * layout-negative-control.cjs —— 布局修复的反向对照
 *
 * 用法：
 *   node tools/layout-negative-control.cjs broken    # 把 styles.css 还原成"人系统报障时"的那套规则
 *   node tools/layout-negative-control.cjs fixed     # 从 tools/styles-fixed.bak.css 恢复修复版
 *   node tools/layout-negative-control.cjs check     # 只比对当前文件与备份是否一致
 *
 * 目的与帧循环那次一样：一条断言若"改坏了也不报错"，它就不算数。
 * 这里只改回四条规则：#center 不允收缩、#stage min-height 240、#seriesWrap 固定 168、
 * 没有矮窗口的媒体查询 —— 也就是"副图被挤出窗口"的那个版本。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const live = path.join(root, 'styles.css');
const fixed = path.join(__dirname, 'styles-fixed.bak.css');
const mode = process.argv[2] || 'check';

if (!fs.existsSync(fixed)) { console.error('缺少备份 ' + fixed); process.exit(2); }

function makeBroken(css) {
  let out = css;
  const subs = [
    ['#center { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: #04070a; }',
      '#center { display: flex; flex-direction: column; min-width: 0; background: #04070a; }'],
    ['#stage { position: relative; flex: 1 1 auto; min-height: 150px; }',
      '#stage { position: relative; flex: 1; min-height: 240px; }'],
    ['#series { flex: 1 1 auto; min-height: 0; width: 100%; display: block; }',
      '#series { flex: 1; width: 100%; display: block; }'],
    ['.seriesTitle { font-size: 11px; color: var(--dim); padding: 4px 10px 0; flex: 0 0 auto; }',
      '.seriesTitle { font-size: 11px; color: var(--dim); padding: 4px 10px 0; }']
  ];
  for (const [from, to] of subs) {
    if (!out.includes(from)) { console.error('未找到待替换的规则（源码结构已变？）：' + from.slice(0, 48)); process.exit(2); }
    out = out.replace(from, to);
  }
  out = out.replace(/#seriesWrap \{[^}]*\}/, '#seriesWrap { height: 168px; border-top: 1px solid var(--line); display: flex; flex-direction: column; }');
  out = out.replace(/\/\* 窗口很矮时[\s\S]*?\n\}\n/, '');
  return out;
}

if (mode === 'broken') {
  fs.writeFileSync(live, makeBroken(fs.readFileSync(fixed, 'utf8')));
  console.log('styles.css 已置为"故障版"（副图会被挤出窗口）');
} else if (mode === 'fixed') {
  fs.copyFileSync(fixed, live);
  console.log('styles.css 已从备份恢复为修复版');
} else {
  const same = fs.readFileSync(live, 'utf8') === fs.readFileSync(fixed, 'utf8');
  console.log(same ? 'styles.css 与修复版备份一致' : 'styles.css 与修复版备份**不一致**');
  process.exit(same ? 0 : 1);
}
