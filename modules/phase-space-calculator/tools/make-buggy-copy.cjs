/**
 * make-buggy-copy.cjs —— 反向对照：把已修复的故障原样装回去，看验收能不能抓住它
 *
 * 一条断言如果"改坏了也不报错"，它就等于没有。这里把 src/app.js 复制一份，
 * 按 mode 把某一次真实故障装回去，再让 tests/verify-app.mjs 去跑它：
 *
 *   node tools/make-buggy-copy.cjs frame   → tools/app-buggy-copy.js
 *       帧循环还原成"渲染一次就把接力棒交给 tick"：
 *         requestAnimationFrame(function loop(){ if (S.dirty) render(); tick(); });
 *         function tick(){ stepPlayback(1); requestAnimationFrame(tick); }
 *       期望：7 项报错（renderCount 1 → 1，界面冻在第一帧）
 *
 *   node tools/make-buggy-copy.cjs reset   → tools/app-buggy-reset.js
 *       onPointerUp 末尾还原成无条件的 resetPlayback()：
 *       平移/旋转/框选一松手，时间就回 t=0（人系统报障"拖拽后可视画面会重置"）
 *       期望：若干项"时间一字不动 / 不回退"的断言报错
 *
 *   node tools/make-buggy-copy.cjs all     → 两个副本都生成
 *
 * 用法示例：
 *   node tools/make-buggy-copy.cjs all
 *   $env:PSX_APP="tools\app-buggy-reset.js"; node tests/verify-app.mjs; Remove-Item Env:\PSX_APP
 *   （路径按相对本文件解析，故 PSX_APP 也可写绝对路径）
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'app.js');
const code0 = fs.readFileSync(src, 'utf8');
const mode = process.argv[2] || 'frame';

function makeFrameBug() {
  let code = code0;
  // 1) 帧函数体恢复成"只推进、不重绘"的 tick
  code = code.replace(
    /  function frame\(\) \{\n    frameBody\(\);\n    requestAnimationFrame\(frame\);\n  \}/,
    '  function tick() {\n    stepPlayback(1);\n    S.frame++;\n    requestAnimationFrame(tick);\n  }'
  );
  // 2) 启动处恢复成"渲染一次就把接力棒交给 tick"
  code = code.replace(
    /    requestAnimationFrame\(frame\);\n    window\.addEventListener\('error'/,
    "    requestAnimationFrame(function loop() { if (S.dirty) { try { render(); } catch (err) { showFatal(err); } } tick(); });\n    window.addEventListener('error'"
  );
  if (code === code0) return null;
  return { code: code, file: path.join(__dirname, 'app-buggy-copy.js') };
}

function makeResetBug() {
  let code = code0;
  // onPointerUp 末尾那段注释是唯一的锚点：把它连同其后的 markDirty() 换回无条件复位
  const anchor = /    \/\/ 这里曾经无条件调用 resetPlayback[\s\S]*?\n    markDirty\(\);\n  \}/;
  if (!anchor.test(code)) return null;
  code = code.replace(anchor, '    resetPlayback();\n    markDirty();\n  }');
  return { code: code, file: path.join(__dirname, 'app-buggy-reset.js') };
}

const jobs = [];
if (mode === 'frame' || mode === 'all') jobs.push(['frame（帧循环断了）', makeFrameBug()]);
if (mode === 'reset' || mode === 'all') jobs.push(['reset（拖拽即重置）', makeResetBug()]);

let bad = false;
for (const [name, made] of jobs) {
  if (!made) {
    console.error('❌ ' + name + '：未能改写（源码结构已变？请更新本脚本的替换规则）');
    bad = true;
    continue;
  }
  fs.writeFileSync(made.file, made.code);
  console.log('已生成反向对照副本（' + name + '）：' + made.file);
  console.log('  运行：$env:PSX_APP="' + made.file + '"; node tests/verify-app.mjs');
}
process.exit(bad ? 2 : 0);
