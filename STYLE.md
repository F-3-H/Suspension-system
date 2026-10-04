# 风格规范（STYLE）

本仓库是"一套悬挂系统、多个视角"的集合。**统一风格不是让各页面长得一模一样，而是让它们只差布局、不差长相**：
同一套配色、同一套字体与圆角、同一个页面外壳，读者点进任何一个子项目都知道自己还在同一个项目里。

## 一、唯一配色来源：`assets/theme.css`

任何子项目都**不再自己定义颜色**。先查这张表有没有现成的，没有再加：

| 用途 | token | 值 |
|---|---|---|
| 页面底色 | `--bg` | `#1a1d21` |
| 画布/凹陷底 | `--bg-deep` | `#141719` |
| 卡片面板 | `--panel` / `--panel-2` / `--panel-3` | `#23272d` / `#2a2f36` / `#313741` |
| 分隔线 | `--line` / `--line-soft` / `--line-strong` | `#363c45` / `#2c3138` / `#454c57` |
| 文字 | `--fg` / `--fg-dim` / `--fg-mute` | `#ffffff` / `#a9b2be` / `#7b848f` |
| 家族强调色 | `--accent` / `--accent-2` | `#00adb5` / `#57e0ff` |
| 语义色 | `--ok` / `--warn` / `--danger` | `#3ddc97` / `#ffb454` / `#ff6b6b` |
| 数据系列色 | `--s1` … `--s5` | 蓝 / 橙 / 绿 / 红 / 紫 |
| 圆角 | `--radius` / `--radius-sm` / `--radius-xs` | `12 / 8 / 6 px` |
| 字体 | `--font-sans` / `--font-mono` | Segoe UI + 微软雅黑 / Consolas |

**规则**：子项目里**不写十六进制颜色**（除画布绘制代码确实需要字面量时，见下）。原来各项目自己起过
`--panel` / `--card` / `--ink` / `--fg` / `--muted` 等名字，现在一律换成上表。

## 二、页面外壳（每个子项目都要有）

```html
<link rel="stylesheet" href="../assets/theme.css">   <!-- 单文件模块 -->
<link rel="stylesheet" href="../../assets/theme.css"> <!-- 多文件项目 -->

<header class="sitebar">                 <!-- 整屏画布的页面加 sitebar--fixed -->
  <a class="brand" href="../index.html">汽车悬挂系统</a>
  <span class="crumb">VIEW 03 · <b>弹簧轮胎系统</b></span>
  <span class="spacer"></span>
  <span class="tag tag--ghost">Canvas · 零依赖</span>
</header>
…
<footer class="site-foot">汽车悬挂系统 · 综合可视化项目 ｜ 三个视角，一套悬挂</footer>
```

- **顶栏必有**：它同时解决"从子页面回不去导航页"的问题（并入前三个模块都没有返回入口）。
- 顶栏右侧的 `.tag--ghost` 用来声明该模块的技术栈/依赖，与首页卡片上的标签一致。
- 页脚文字统一为上面那句。

## 三、通用组件（能用现成的就别自己写）

`.card` `.panel`（`.panel--float` 用于浮在画布上的控件）`.tag` / `.pill` `.btn`（`.btn--primary` `.btn--on`）
`.row` / `.ro` / `.stat`（键值读数）`.readouts` / `.stats` `.slider-row` / `.slider-head` `.legend` / `.legend-note`
`.notes` `#warn` / `.warn-box` `footer.site-foot` `.wrap` `.grid` `.stack` `.cluster` `.mono`

原来各项目里的 `.legend`/`.lg`、`.ro`/`.stat`、`.row`、`.card`、`.chart-card` 等**同类组件已合并**到这些类上；
模块自己的 CSS 只保留"摆在哪里"（定位、尺寸、栅格），不再重复定义颜色、圆角、字号。

## 四、目录与命名

```
index.html                         导航首页（唯一入口）
assets/theme.css                   共享设计层（唯一配色来源）
assets/…                           其他共享资源
modules/<模块名>.html              单文件模块（自包含，双击可用）
modules/<项目名>/                  多文件项目（内部保留自己的结构与测试）
  index.html  styles.css  src/  tests/  tools/  README.md
STYLE.md  README.md                本规范与仓库说明
```

- 模块标题：`<模块名> · 3D 教学模型` / `… · 控制理论实验平台` / `… · 互动可视化` 这类"名称 · 定位"格式，`<title>` 再加仓库名前缀。
- 语言：全部 `zh-CN`；文件名用小写短横线。
- **依赖要么零、要么写清楚**：用 CDN 的模块必须在首页卡片、顶栏标签与 README 三处注明"需联网"；
  零依赖模块注明"零依赖 / 双击可用"。这是**如实标注**，不是风格问题。

## 五、离线自足项目的例外

多文件项目（如 `modules/phase-space-calculator/`）要求"拷走整个目录也能双击运行"，因此它可以在自己的
`styles.css` 里**复制一份 token**，同时仍然 `<link>` 共享主题（共享主题先加载，两者取值相同）。
这类复制必须与 `assets/theme.css` 保持一致，由校验脚本兜底：

```powershell
node tools/verify-repo-style.cjs      # 扫描残留旧配色 + 校验 token 同步 + 检查链接与顶栏
```

## 六、画布与图表里的颜色

- Canvas / three.js / Plotly 需要字面量颜色时，**取 token 的同一个值**，并在紧邻的注释里写明对应 token
  （例如 `// --accent`），这样改配色时能搜到。
- 数据系列一律用 `--s1…--s5` 的值，语义固定（蓝=位移、橙=速度/路面、绿=弹簧、红=阻尼…），
  不要一个模块一个含义。
- 图表背景用 `--bg-deep`、网格线用 `--line`、坐标文字用 `--fg-mute`，与页面同一套。
