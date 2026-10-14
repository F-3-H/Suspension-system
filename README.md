# 汽车悬挂系统 · 综合可视化项目

一套汽车悬挂系统，六个视角。六个模块各自独立、都能单独打开，但共用**同一套配色、字体与页面外壳**——
点进任何一个模块，你都知道自己还在同一个项目里。

| 视角 | 模块 | 看什么 | 依赖 | 入口 |
|---|---|---|---|---|
| VIEW 01 | 麦弗逊式独立前悬挂系统 | 3D 教学模型：整车前悬挂总成、零件高亮、爆炸拆解 | three.js（CDN） | [`modules/macpherson-3d-model.html`](modules/macpherson-3d-model.html) |
| VIEW 02 | 悬挂系统控制理论实验平台 | 调 m/k/c 与激励，看时域响应、Bode 频域与相平面 | Plotly（CDN） | [`modules/suspension-control-lab.html`](modules/suspension-control-lab.html) |
| VIEW 03 | 弹簧轮胎系统 · 竖向振动 | 弹簧—轮胎—簧载质量的竖向振动与能量传递 | 零依赖 | [`modules/spring-tire-vibration.html`](modules/spring-tire-vibration.html) |
| VIEW 04 | 相空间可视化计算器 | 把任意微分方程变成相图：一/二/三维、向量场、相流、不动点；随机路面下的概率密度与功率谱 | 零依赖 | [`modules/phase-space-calculator/index.html`](modules/phase-space-calculator/index.html) |
| VIEW 05 | 悬挂系统随机路面分析 | 随机路面当外因：Welch 功率谱取“变中的不变”，再乘内因频率响应 H(f) 得影响谱与频段占比 | 零依赖 | [`modules/random-road-analysis/index.html`](modules/random-road-analysis/index.html) |
| VIEW 06 | 零件网络 · 现实悬挂系统的零件 | 整套麦弗逊的 10 件零件当方块、零件间的作用当流动箭头；慢的外因怎样经由零件自己的内因把它们互相推着变坏，变化写在方块自己身上（数字＋颜色） | 零依赖 | [`modules/parts-network.html`](modules/parts-network.html) |

导航首页：**[`index.html`](index.html)**

## 运行

- **VIEW 03 / 04 / 05 / 06：双击即可打开**（完全离线自足，`file://` 下功能完整）。
- **VIEW 01 / 02：需要 `http` 协议 + 联网**（three.js 与 Plotly 走 CDN）。任意静态服务器都行：

  ```powershell
  node tools/serve.cjs 4188 .        # 然后打开 http://127.0.0.1:4188/
  ```

## 目录

```
index.html                              导航首页
assets/theme.css                        共享设计层：唯一配色来源（token + 通用组件）
STYLE.md                                风格规范：token 表、页面外壳、目录与命名约定
tools/serve.cjs                         本地静态服务器（给需要 CDN 的模块用）
tools/verify-repo-style.cjs             仓库风格与链接的统一性检查
tools/gen-parts-state.py                VIEW 06 的独立参考实现（Python）
tools/verify-parts-state.py             VIEW 06 的跨语言互证（无头浏览器 ↔ 参考实现）
modules/macpherson-3d-model.html        单文件模块
modules/suspension-control-lab.html     单文件模块
modules/spring-tire-vibration.html      单文件模块
modules/parts-network.html              单文件模块
modules/phase-space-calculator/         多文件项目
  index.html  styles.css  src/  tests/  tools/  docs/  README.md
modules/random-road-analysis/           多文件项目
  index.html  styles.css  src/  README.md
```

## 风格统一怎么保证

配色与排版只有 `assets/theme.css` 一处定义；页面外壳（顶栏 + 页脚）五个页面一致；子项目自己的样式表**不再出现十六进制界面色**。
这些不是靠约定，而是靠脚本判定：

```powershell
node tools/verify-repo-style.cjs
```

它检查：共享主题是否被引用、顶栏能否回到导航页、页脚与 `zh-CN` 是否齐备、**是否残留并入前的旧配色**、
CSS 里是否还硬写主题色、导航页与磁盘上的模块是否双向一致、离线自足项目里复制的那份 token 是否与主题同步，
以及**正文（HTML/MD）里提到的 `tools/` 脚本在仓库里是否真的还存在**——最后一项是给"文件改名"用的：
文件改了名，页面正文里的引用没人跟着改，语法、数值、风格三道验收全绿也照样漏（VIEW 06 并入时真漏过一次）。
规范细节见 [`STYLE.md`](STYLE.md)。

## 各自的验收

- **VIEW 04** 自带四层自动化验收（内核 / 渲染 / 应用 / 浏览器内自检），共 300+ 项断言，
  并带三组"把故障装回去"的反向对照与多窗口尺寸回归：

  ```powershell
  cd modules/phase-space-calculator
  node tests/verify-core.mjs ; node tests/verify-render.mjs ; node tests/verify-app.mjs
  node tools/serve.cjs 4188 .      # 另开一个窗口，然后 tools/verify-sizes.cjs
  node tools/verify-sizes.cjs
  ```

- **VIEW 01 / 02 / 03 / 05 / 06** 目前靠人工目视与浏览器控制台检查（VIEW 01 / 02 / 03 是既有的单文件页面，
  本轮只统一了外观，没有改动其内部逻辑与数值实现；VIEW 05 为并入的既有项目，本轮同样只统一外观与目录结构）。

- **VIEW 06** 另有一道跨语言互证：页面里的 JS 与 `tools/gen-parts-state.py` 是**各写一份**的同一组式子
  （两语言、两运行时、不共用一行代码），页面把自算的 0–8 年数据写进隐藏节点 `#dump`，
  由脚本用无头浏览器 `--dump-dom` 取回逐点比对：

  ```powershell
  python tools/gen-parts-state.py            # 打印 0–8 年逐年表格
  python tools/verify-parts-state.py         # 互证：135 项须全部 < 1e-12（实测 2.4e-16）
  python tools/verify-parts-state.py --shots # 另在 #t=0/4/8 各出一张截图
  ```

  这一项会用到 Python 3 与本机 Chrome/Edge；**页面本身仍然是零依赖、双击可用**。

## 说明

- 六个模块的物理模型各自独立：VIEW 01 关注结构几何，VIEW 02 关注控制理论，VIEW 03 关注竖向振动能量传递，
  VIEW 04 关注相空间与随机振动，VIEW 05 关注随机路面的功率谱与悬挂频响加权，VIEW 06 关注零件级的内因退化
  与零件之间的相互推动。它们共用同一套参数记法
  （m 质量、k 刚度、c 阻尼、x 路面、y 车身位移），以便互相印证。
- 浏览器要求：Chrome / Edge 等现代浏览器。VIEW 04 / 05 另需 `requestAnimationFrame` 与 Canvas 2D；
  VIEW 06 另需 SVG 与 CSS 动画（`prefers-reduced-motion` 下自动停用流动效果）。
