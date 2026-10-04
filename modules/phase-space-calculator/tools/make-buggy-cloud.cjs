/**
 * 把"概率云"这一处故障原样装回去，看 verify-app.mjs 会不会红。
 * 复现的是人系统报的两个现象（必须按**旧的两分支结构**写，嵌套式 if 复现不出来）：
 *   ① 旧结构： if (img && !pathsOnly) { 铺图 } else { 逐格画 }
 *      —— 勾上「只画路径」时条件为假，于是掉进"逐格画"的退路，云以另一种方式冒出来
 *   ② 逐格画的退路按**当前视窗**铺 —— 一拖动画面，云被拉伸着钉在屏幕上（"拖不动"）
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let s = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

const i0 = s.indexOf('    var img = S.mc.img;');
const i1 = s.indexOf('    // 样本路径（同一初值、不同实现）');
if (i0 < 0 || i1 < 0 || i1 <= i0) { console.error('找不到锚点，负对照无效'); process.exit(1); }

const buggy = `    var img = S.mc.img;
    if (img && !S.mc.pathsOnly) {
      RD.drawDensity2D(ctx, view, img, { smooth: true });
    } else {
      // 旧版的退路：逐格画。它同时兜住了"没有离屏画布"与"勾了只画路径"两种情况
      var p = view.pad;
      ctx.save();
      ctx.beginPath(); ctx.rect(p.l, p.t, view.iw, view.ih); ctx.clip();
      for (var iy = 0; iy < img.height; iy++) {
        for (var ix = 0; ix < img.width; ix++) {
          var o = ((img.height - 1 - iy) * img.width + ix) * 4;
          if (img.data[o + 3] === 0) continue;
          var fx0 = view.bounds[0][0] + (view.bounds[0][1] - view.bounds[0][0]) * ix / img.width;
          var fx1 = view.bounds[0][0] + (view.bounds[0][1] - view.bounds[0][0]) * (ix + 1) / img.width;
          var fy0 = view.bounds[1][0] + (view.bounds[1][1] - view.bounds[1][0]) * iy / img.height;
          var fy1 = view.bounds[1][0] + (view.bounds[1][1] - view.bounds[1][0]) * (iy + 1) / img.height;
          var fa = view.toScreen(fx0, fy1), fb = view.toScreen(fx1, fy0);
          ctx.fillStyle = 'rgb(' + img.data[o] + ',' + img.data[o + 1] + ',' + img.data[o + 2] + ')';
          ctx.fillRect(fa[0], fa[1], Math.max(1, fb[0] - fa[0]), Math.max(1, fb[1] - fa[1]));
        }
      }
      ctx.restore();
    }
`;
fs.writeFileSync(path.join(root, 'tools', 'app-buggy-cloud.js'), s.slice(0, i0) + buggy + s.slice(i1));
console.log('已写出 tools/app-buggy-cloud.js（概率云故障版：逐格退路 + 按当前视窗铺）');
