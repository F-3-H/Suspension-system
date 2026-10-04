# 汽车悬挂系统 · 综合可视化项目

一套汽车悬挂系统，四个视角。四个模块各自独立、都能单独打开，但共用**同一套配色、字体与页面外壳**——
点进任何一个模块，你都知道自己还在同一个项目里。

| 视角 | 模块 | 看什么 | 依赖 | 入口 |
|---|---|---|---|---|
| VIEW 01 | 麦弗逊式独立前悬挂系统 | 3D 教学模型：整车前悬挂总成、零件高亮、爆炸拆解 | three.js（CDN） | [`modules/macpherson-3d-model.html`](modules/macpherson-3d-model.html) |
| VIEW 02 | 悬挂系统控制理论实验平台 | 调 m/k/c 与激励，看时域响应、Bode 频域与相平面 | Plotly（CDN） | [`modules/suspension-control-lab.html`](modules/suspension-control-lab.html) |
| VIEW 03 | 弹簧轮胎系统 · 竖向振动 | 弹簧—轮胎—簧载质量的竖向振动与能量传递 | 零依赖 | [`modules/spring-tire-vibration.html`](modules/spring-tire-vibration.html) |
| VIEW 04 | 相空间可视化计算器 | 把任意微分方程变成相图：一/二/三维、向量场、相流、不动点；随机路面下的概率密度与功率谱 | 零依赖 | [`modules/phase-space-calculator/index.html`](modules/phase-space-calculator/index.html) |

导航首页：**[`index.html`](index.html)**

## 运行

- **VIEW 03 / 04：双击即可打开**（完全离线自足，`file://` 下功能完整）。
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
modules/macpherson-3d-model.html        单文件模块
modules/suspension-control-lab.html     单文件模块
modules/spring-tire-vibration.html      单文件模块
modules/phase-space-calculator/         多文件项目
  index.html  styles.css  src/  tests/  tools/  docs/  README.md
```

## 风格统一怎么保证

配色与排版只有 `assets/theme.css` 一处定义；页面外壳（顶栏 + 页脚）四页一致；子项目自己的样式表**不再出现十六进制界面色**。
这些不是靠约定，而是靠脚本判定：

```powershell
node tools/verify-repo-style.cjs
```

它检查：共享主题是否被引用、顶栏能否回到导航页、页脚与 `zh-CN` 是否齐备、**是否残留并入前的旧配色**、
CSS 里是否还硬写主题色、导航页与磁盘上的模块是否双向一致、以及离线自足项目里复制的那份 token 是否与主题同步。
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

- **VIEW 01 / 02 / 03** 目前靠人工目视与浏览器控制台检查（这三个模块是既有的单文件页面，
  本轮只统一了外观，没有改动其内部逻辑与数值实现）。

## 说明

- 四个模块的物理模型各自独立：VIEW 01 关注结构几何，VIEW 02 关注控制理论，VIEW 03 关注竖向振动能量传递，
  VIEW 04 关注相空间与随机振动。它们共用同一套参数记法（m 质量、k 刚度、c 阻尼、x 路面、y 车身位移），
  以便互相印证。
- 浏览器要求：Chrome / Edge 等现代浏览器。VIEW 04 另需 `requestAnimationFrame` 与 Canvas 2D。
