# -*- coding: utf-8 -*-
"""
verify-parts-state.py —— VIEW 06（零件网络）的跨语言互证。

为什么要有这一份：
    modules/parts-network.html 里的模型是 JavaScript 写的，tools/gen-parts-state.py 是 Python
    **各写一遍**的同一组式子（公式各写各的、λ 反解各写各的，不共用一行代码）。
    本脚本把两条路径拉到一起逐点比：
      - JS 侧：用无头浏览器打开页面，把页面**自己算出来**并写进隐藏节点 #dump 的 0–8 年数据取回；
      - PY 侧：跑 tools/gen-parts-state.py --json。
    两边对到浮点下限，才说明"我以为是哪组式子"和"页面里真正跑的"是同一组。

    注意这是**互证**不是**复算**：把同一份实现的代码复制两遍，两边必然相等，那种相等什么也证明不了；
    互证的价值来自路径的独立性——不同语言、不同运行时、各自反解 λ。

用法：
    python tools/verify-parts-state.py           （退出码非 0 表示不通过）
    python tools/verify-parts-state.py --shots   另外在 #t=0 / 4 / 8 各出一张截图供人眼回看

需要：本机 Chrome/Edge（可用 CHROME_PATH 环境变量指定）。**页面本身零依赖**，Python 只有本脚本要用。
"""
import html
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, "modules", "parts-network.html")
REF = os.path.join(HERE, "gen-parts-state.py")

CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH"),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]

# 参与比对的主体状态量：页面 JS 字段名 -> 参考实现字段名
# （两份实现是各自命名的，这里显式对上，不做猜测式兼容）
FIELDS = [("k", "k"), ("c", "c"), ("wn", "wn"), ("A", "amp"), ("Fk", "Fk"),
          ("Fc", "Fc"), ("Fs", "Fs"), ("W", "W"), ("zeta", "zeta"), ("peak", "peak"),
          ("Fwheel", "Fwheel"), ("Farm", "Farm"), ("Fbar", "Fbar"), ("gap", "gap"),
          ("roll", "roll")]
TOL = 1e-12          # 相对差上限；实测在 1e-16 量级

pass_n = 0
fails = []


def ok(cond, label, detail=""):
    global pass_n
    if cond:
        pass_n += 1
        print("  \u2713 " + label)
    else:
        fails.append(label + ("  \u2192 " + detail if detail else ""))
        print("  \u2717 " + label + ("  \u2192 " + detail if detail else ""))


def section(t):
    print("\n== " + t + " ==")


def find_chrome():
    for c in CHROME_CANDIDATES:
        if c and os.path.exists(c):
            return c
    return None


def run_chrome(chrome, url, extra=()):
    return subprocess.run(
        [chrome, "--headless", "--disable-gpu", "--no-sandbox",
         "--virtual-time-budget=4000", *extra, url],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=180)


def read_dump(chrome):
    """无头浏览器打开页面，取回页面自己写进 #dump 的 0–8 年数据。"""
    url = "file:///" + PAGE.replace("\\", "/") + "#t=0"
    out = run_chrome(chrome, url, ("--dump-dom",))
    m = re.search(r'<div id="dump"[^>]*>(.*?)</div>', out.stdout or "", re.S)
    if not m:
        raise RuntimeError("页面里没找到 #dump（无头浏览器没能执行到模型那段脚本）")
    return json.loads(html.unescape(m.group(1)))


def read_reference():
    out = subprocess.run([sys.executable, REF, "--json"],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    if out.returncode != 0:
        raise RuntimeError("参考实现退出码 %d：%s" % (out.returncode, (out.stderr or "")[:300]))
    return json.loads(out.stdout)


def main():
    print("VIEW 06 跨语言互证：页面 JS（无头浏览器取回） \u2194 tools/gen-parts-state.py")
    print("页面：" + os.path.relpath(PAGE, ROOT).replace("\\", "/"))

    chrome = find_chrome()
    if not chrome:
        print("\n找不到 Chrome/Edge，可用 CHROME_PATH 环境变量指定。")
        return 2
    print("浏览器：" + chrome)
    print("Python：" + sys.executable + "\n")

    try:
        js = read_dump(chrome)
    except Exception as e:                                  # noqa: BLE001
        print("取页面数据失败：" + str(e))
        return 2
    try:
        ref = read_reference()
    except Exception as e:                                  # noqa: BLE001
        print("跑参考实现失败：" + str(e))
        return 2

    js_by_year = {int(r["year"]): r for r in js}
    py_by_year = {int(r["year"]): r for r in ref["years"]}
    years = list(range(0, 9))

    # ------------------------------------------------------------ 1 主体状态量
    section("主体状态量逐年比对")
    worst, worst_at, over, total = 0.0, None, [], 0
    for y in years:
        a, b = js_by_year.get(y), py_by_year.get(y)
        if a is None or b is None:
            ok(False, "第 %d 年两边都有数据" % y)
            continue
        for jf, pf in FIELDS:
            x, z = float(a[jf]), float(b[pf])
            d = abs(x - z) / max(abs(x), abs(z), 1e-300)
            total += 1
            if d > worst:
                worst, worst_at = d, "%d年·%s" % (y, jf)
            if d > TOL:
                over.append((y, jf, x, z, d))
    ok(not over, "全部 %d 项（9 年 × %d 个量）相对差 < %g" % (total, len(FIELDS), TOL),
       ", ".join("%d年·%s %.2e" % (r[0], r[1], r[4]) for r in over[:6]))
    if over:
        print("    年   字段            页面JS              参考PY          相对差")
        for r in over[:12]:
            print("    %-4d %-9s %16.8e %16.8e %10.2e" % r)
    print("    最大相对差 %.3e（%s）" % (worst, worst_at))

    # ------------------------------------------------------------ 2 零件层
    section("各零件：8 年健康度与显示值")
    worst2 = 0.0
    for p in ref["parts"]:
        k = p["key"]
        jh, rh = float(js_by_year[8]["h"][k]), float(py_by_year[8]["h"][k])
        jv, rv = float(js_by_year[8]["v"][k]), float(py_by_year[8]["v"][k])
        dh = abs(jh - rh) / max(abs(jh), abs(rh), 1e-300)
        dv = abs(jv - rv) / max(abs(jv), abs(rv), 1e-300)
        d = max(dh, dv)
        worst2 = max(worst2, d)
        ok(d <= TOL,
           "%s 健康度 %.4f / 显示值 %.4f（驱动 %s）" % (p["name"], jh, jv, p["driver"]),
           "" if d <= TOL else "相对差 %.2e" % d)
    print("    零件层最大相对差 %.3e" % worst2)

    # ------------------------------------------------------------ 3 落点自洽
    section("8 年落点是否落在设定值上（参考实现的自洽性）")
    for p in ref["parts"]:
        rh = float(py_by_year[8]["h"][p["key"]])
        ok(abs(rh - p["h8"]) < 1e-9, "%s 8 年健康度 = 设定值 %.2f" % (p["name"], p["h8"]))

    # ------------------------------------------------------------ 4 可选截图
    if "--shots" in sys.argv[1:]:
        section("渲染取证（#t=0 / 4 / 8）")
        # 文件名落在 .gitignore 已有的 tools/shot-*.png 上，验收产物不进版本库
        for t in (0, 4, 8):
            dst = os.path.join(HERE, "shot-parts-state-t%d.png" % t)
            url = "file:///" + PAGE.replace("\\", "/") + "#t=%d" % t
            run_chrome(chrome, url, ("--hide-scrollbars", "--window-size=1240,1120",
                                     "--screenshot=" + dst))
            got = os.path.exists(dst) and os.path.getsize(dst) > 20000
            ok(got, "#t=%d 截出非空 PNG" % t,
               "" if got else "文件缺失或过小")
        print("    截图：" + os.path.relpath(HERE, ROOT).replace("\\", "/") + "/shot-parts-state-t*.png")

    # ------------------------------------------------------------ 汇总
    print("\n" + "=" * 64)
    print("通过 %d 项，失败 %d 项" % (pass_n, len(fails)))
    if fails:
        print("\n失败清单：")
        for f in fails:
            print("  - " + f)
    print("=" * 64)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
