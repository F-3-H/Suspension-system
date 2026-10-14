# -*- coding: utf-8 -*-
"""
gen-parts-state.py —— VIEW 06（零件网络）的独立参考实现。

为什么要有这一份：
    modules/parts-network.html 里的退化模型是用 JavaScript 写的；
    这一份是用 Python **各写一遍**——公式各写各的、λ 反解各写各的，不共用一行代码。
    两者能对到浮点下限，才说明"我以为是哪组式子"和"页面里真正跑的"是同一组。
    互证的价值来自**路径的独立性**：如果把同一份代码复制两遍，那种相等什么也证明不了。

模型（四分之一车，只看簧上共振这个最烈工况）：
    簧载质量 m = 300 kg，路面激励幅值 X = 0.05 m，作用频率取当前固有频率 ωn = √(k_eff/m)

    弹簧支路等效刚度   k_eff = 1 / (1/k_弹簧 + 1/k_顶胶)
    相对位移幅值       A     = X·√(k_eff·m) / c
    弹簧力幅值         Fk    = k_eff·A
    阻尼力幅值         Fc    = c·ωn·A
    总成合力幅值       Fs    = √(Fk² + Fc²)        （＝传到车身的动态轮荷）
    每周期耗散能量     W     = π·c·ωn·A²
    阻尼比 / 共振峰     ζ = c/(2√(k_eff·m))， Q ≈ 1/(2ζ)

    其余箭头的作用量按固定的分担系数分配（**示意的几何系数，非实测**）：
    下控制臂支路 F_arm = 0.45·Fs ；横向稳定杆 F_bar = 0.30·F_arm

退化（"慢的外因经由零件自己的内因起作用"）：
    dh/dt = −λ·(驱动/驱动₀)
    弹簧、顶胶、衬套、球头、转向节、稳定杆、副车架、车身：驱动＝行程幅值 A
    减震器：驱动＝它自己耗散的功率 W
    轮毂轴承：驱动＝累计里程（随时间线性）
    λ 由"8 年后的健康度"反解，故 8 年的落点是设定的、路径是算出来的。

关键：A 与 W 都出现在 k_eff、c 的式子里，而 k_eff、c 又由零件决定
      → 一件坏，另一件的驱动就变大 → 互相推着坏。

用法：
    python tools/gen-parts-state.py            打印 0–8 年逐年表格
    python tools/gen-parts-state.py --json     输出机器可读的 JSON（供 verify-parts-state.cjs 比对）

无第三方依赖，只需 Python 3。
"""
import json
import math
import sys

M = 300.0
X = 0.05
T_END = 8.0
DT = 0.002
YEARS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

# key, 名称, 量名, 单位, 新件值, 8年值, 8年健康度, 驱动
PARTS = [
    ("body",    "车身 · 减震塔",        "局部刚度", "N/mm",  25000.0, 24700.0, 0.96, "A"),
    ("mount",   "顶胶 / 上支座",        "等效刚度", "N/mm",   2500.0,  3200.0, 0.55, "A"),
    ("spring",  "螺旋弹簧",             "刚度 k",   "N/m",   20000.0, 13700.0, 0.69, "A"),
    ("damper",  "减震器",               "阻尼 c",   "N·s/m",  1500.0,   700.0, 0.47, "W"),
    ("knuckle", "转向节（羊角）",        "定位偏差", "mm",       0.00,    0.35, 0.80, "A"),
    ("arm",     "下控制臂 ＋ 球头",      "球头间隙", "mm",       0.05,    0.55, 0.30, "A"),
    ("bush",    "衬套",                 "等效刚度", "N/mm",   3000.0,  3900.0, 0.62, "A"),
    ("bar",     "横向稳定杆 ＋ 连接杆",   "扭转刚度", "N·m/°",  1200.0,   820.0, 0.70, "A"),
    ("sub",     "副车架",               "连接刚度", "N/mm",   8000.0,  6300.0, 0.85, "A"),
    ("hub",     "车轮 / 轮毂轴承",       "轴向游隙", "mm",       0.020,   0.085, 0.40, "L"),
]
KEYS = [p[0] for p in PARTS]
P = {p[0]: p for p in PARTS}

ARM_SHARE = 0.45      # 下控制臂支路分担的动态载荷比例（示意几何系数）
STAB_SHARE = 0.30     # 连接杆/稳定杆分担的比例（示意几何系数）


def value(key, h):
    """由健康度 h 反推零件当前显示值（线性，两端锚定在 新件值 / 8年值）。"""
    _, _, _, _, v0, v8, h8, _ = P[key]
    return v0 + (v8 - v0) * (1.0 - h) / (1.0 - h8)


def state(h, t):
    k_spring = value("spring", h["spring"])
    c = value("damper", h["damper"])
    k_mount = value("mount", h["mount"]) * 1000.0        # N/mm -> N/m
    k_eff = 1.0 / (1.0 / k_spring + 1.0 / k_mount)
    wn = math.sqrt(k_eff / M)
    amp = X * math.sqrt(k_eff * M) / c
    Fk = k_eff * amp
    Fc = c * wn * amp
    Fs = math.hypot(Fk, Fc)
    W = math.pi * c * wn * amp * amp
    zeta = c / (2.0 * math.sqrt(k_eff * M))
    gap = value("arm", h["arm"]) + 2.0 * value("hub", h["hub"]) + value("knuckle", h["knuckle"])
    return dict(
        t=t,
        k=k_eff, kSpring=k_spring, c=c, mount=value("mount", h["mount"]),
        wn=wn, amp=amp, Fk=Fk, Fc=Fc, Fs=Fs, W=W,
        zeta=zeta, peak=1.0 / (2.0 * zeta),
        Fwheel=Fs, Farm=ARM_SHARE * Fs, Fbar=STAB_SHARE * ARM_SHARE * Fs,
        gap=gap, roll=value("bar", h["bar"]),
    )


def simulate(lam=None):
    """lam=None：只累加驱动积分（用来反解 λ）。否则按 λ 真正退化。"""
    h = {k: 1.0 for k in KEYS}
    acc = {k: 0.0 for k in KEYS}
    n = int(round(T_END / DT))
    s0 = state(h, 0.0)
    a0, w0 = s0["amp"], s0["W"]
    out = {0: dict(s0, h=dict(h), v={k: value(k, h[k]) for k in KEYS})}
    for i in range(1, n + 1):
        t = i * DT
        s = state(h, t)
        for k in KEYS:
            d = P[k][7]
            drv = (s["amp"] / a0) if d == "A" else ((s["W"] / w0) if d == "W" else (t / T_END))
            acc[k] += drv * DT
            if lam is not None:
                h[k] -= lam[k] * drv * DT
        for yr in YEARS:
            if yr not in out and abs(t - yr) < DT / 2:
                out[yr] = dict(state(h, yr), h=dict(h), v={k: value(k, h[k]) for k in KEYS})
    return out, acc


def solve():
    """λ 反解：驱动本身会随退化而变大（这正是耦合），一次反解会对不准，所以迭代到落点吻合。"""
    _, acc1 = simulate(None)
    lam = {k: (1.0 - P[k][6]) / acc1[k] for k in KEYS}
    for _ in range(40):
        out, _ = simulate(lam)
        err = max(abs(out[8]["h"][k] - P[k][6]) for k in KEYS)
        if err < 1e-12:
            break
        for k in KEYS:
            want = 1.0 - P[k][6]
            got = 1.0 - out[8]["h"][k]
            if got > 1e-15:
                lam[k] *= want / got
    return out, lam


FIELDS = ("k", "c", "wn", "amp", "Fk", "Fc", "Fs", "W", "zeta", "peak",
          "Fwheel", "Farm", "Fbar", "gap", "roll")


def to_json():
    out, lam = solve()
    return dict(
        m=M, X=X, tEnd=T_END, armShare=ARM_SHARE, stabShare=STAB_SHARE,
        parts=[dict(key=p[0], name=p[1], qty=p[2], unit=p[3],
                    v0=p[4], v8=p[5], h8=p[6], driver=p[7], lam=lam[p[0]]) for p in PARTS],
        years=[dict(year=y,
                    **{kk: out[y][kk] for kk in FIELDS},
                    h=out[y]["h"], v=out[y]["v"]) for y in YEARS],
    )


def main():
    argv = sys.argv[1:]
    if "--json" in argv:
        sys.stdout.write(json.dumps(to_json(), ensure_ascii=False))
        return

    out, lam = solve()
    print("m=%g kg  X=%gm  弹簧 k0=%g N/m  减震器 c0=%g N·s/m"
          % (M, X, P["spring"][4], P["damper"][4]))
    print("分担系数（示意）：下控制臂支路 %.2f·Fs，稳定杆 %.2f·F_arm\n" % (ARM_SHARE, STAB_SHARE))
    print("%-4s %8s %8s %7s %7s %8s %8s %8s %8s %7s %7s"
          % ("年", "k", "c", "ωn", "ζ", "共振峰", "行程cm", "弹簧力", "阻尼力", "轮荷", "间隙mm"))
    print("-" * 96)
    for yr in YEARS:
        r = out[yr]
        print("%-4d %8.0f %8.0f %7.3f %7.4f %8.2f %8.2f %8.0f %8.0f %7.0f %7.3f"
              % (yr, r["k"], r["c"], r["wn"], r["zeta"], r["peak"], r["amp"] * 100,
                 r["Fk"], r["Fc"], r["Fwheel"], r["gap"]))

    print("\n各零件（健康度 / 显示值）：")
    print("%-22s %-10s %10s %10s %8s  %s" % ("零件", "量", "新件", "8年", "8年健康度", "驱动"))
    print("-" * 74)
    for k in KEYS:
        _, nm, qn, un, v0, v8, h8, drv = P[k]
        print("%-22s %-10s %10s %10s %8.2f  %s"
              % (nm, qn + "(" + un + ")", "%.3f" % v0, "%.3f" % out[8]["v"][k], out[8]["h"][k], drv))


if __name__ == "__main__":
    main()
