#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素街机厅 · 一键全量验证器（tools/verify_all.py）

把「分享包重建 → 静态检查 → 无头冒烟 → 无头行为回归」四步验证串成单命令，
纯 Python 3 标准库零依赖（无头浏览器按常见安装路径自动探测本机 Chrome / Edge）。

用法（项目根目录或任意目录均可）：
    python tools/verify_all.py

四步流水（任一步失败立即中止，非零码退出）：
  1. 分享包重建   —— tools/sync_packages.py（快照包与源文件逐条目一致）
  2. 静态一致性   —— tests/check.py（十项检查全绿）
  3. 无头冒烟     —— tests/smoke.html（document.title 输出「冒烟通过 p/t」）
  4. 无头行为回归 —— tests/behavior.html（document.title 输出「行为通过 p/t」）

无头运行要点：
  - 虚拟时间预算固定 30000ms（两测试页超时 TIMEOUT_MS=9000 必须小于该值，
    阈值约定详见 tests/smoke.html 头部注释）；--dump-dom 后从 <title> 解析
    结论，判据为「通过前缀 + p == t + t > 0」——场景数增减无需改本脚本
  - 本地静态服务器以随机空闲端口在守护线程内自起自停（不占用 8765 常服端口）
  - 浏览器以一次性临时 user-data-dir 启动，不触碰用户默认配置文件

退出码：0 = 四步全绿；1 = 存在失败步（打印失败明细与修复提示）。
"""
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------- 路径基准：项目根 = 本脚本目录的上一级 ----------
ROOT = Path(__file__).resolve().parent.parent

# 无头虚拟时间预算（毫秒）：须大于两测试页的 TIMEOUT_MS=9000（smoke.html 头部注释约定 ≥20000）
VIRTUAL_TIME_BUDGET_MS = 30000
# 无头进程真实时钟硬超时（秒）：虚拟时间通常数秒内跑完预算，超时即视为挂死
REAL_TIMEOUT_S = 180

# 无头浏览器探测清单：显式常见安装路径优先，末尾裸命令名交给 shutil.which 在 PATH 找（命中即用）
BROWSER_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    str(Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "Application" / "chrome.exe"),
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    str(Path.home() / "AppData" / "Local" / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
    "chrome", "msedge", "chromium",
]

# 测试页结论标题正则：「冒烟通过 18/18」/「行为通过 34/34」（失败标题前缀不同，天然判负）
TITLE_PASS_RE = re.compile(r"^(冒烟通过|行为通过)\s+(\d+)/(\d+)$")
# dump-dom 输出中提取 <title> 文本
TITLE_TAG_RE = re.compile(r"<title>([^<]*)</title>")


class QuietHandler(SimpleHTTPRequestHandler):
    """静默版静态文件处理器：屏蔽逐请求访问日志，保持验证输出干净。"""

    def log_message(self, fmt, *args):
        pass


def find_browser():
    """按探测清单定位本机可用的无头浏览器。

    返回:
        可执行文件路径字符串；全部落空返回 None
    """
    for cand in BROWSER_CANDIDATES:
        if Path(cand).drive:
            # 绝对路径形态：直接探测文件存在
            if Path(cand).is_file():
                return cand
        else:
            # 裸命令名形态：交给 PATH 查找
            found = shutil.which(cand)
            if found:
                return found
    return None


def run_py_step(label, script_rel):
    """以当前解释器子进程运行一个项目脚本（输出直通控制台）。

    参数:
        label: 步骤名（打印横幅用）
        script_rel: 相对项目根的脚本路径
    返回:
        子进程退出码（0 = 通过）
    """
    print(f"\n==== {label}（python {script_rel}）====")
    proc = subprocess.run([sys.executable, str(ROOT / script_rel)], cwd=str(ROOT))
    return proc.returncode


def start_server():
    """在随机空闲端口起本地静态服务器（守护线程托管，服务目录为项目根）。

    返回:
        ThreadingHTTPServer 实例（用毕须 shutdown + server_close），端口经 server_address[1] 取
    """
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start()
    return server


def run_headless(browser, url):
    """无头加载测试页，虚拟时间跑满预算后返回页面 <title> 结论文本。

    参数:
        browser: 浏览器可执行文件路径
        url: 测试页地址（临时服上）
    返回:
        (title, error) 二元组——title 为解析出的标题（解析失败为 None）；
        error 为失败原因描述（成功为 None）
    """
    profile_dir = tempfile.mkdtemp(prefix="arcade_headless_")
    argv = [
        browser, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        f"--user-data-dir={profile_dir}",
        f"--virtual-time-budget={VIRTUAL_TIME_BUDGET_MS}",
        "--dump-dom", url,
    ]
    try:
        # 显式 utf-8 解码：无头输出为 UTF-8，Windows 默认 GBK 本地编码会乱码中文标题
        proc = subprocess.run(argv, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=REAL_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, f"真实时钟超 {REAL_TIMEOUT_S}s 未退出（虚拟预算 {VIRTUAL_TIME_BUDGET_MS}ms 通常数秒跑完，疑似挂死）"
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)
    m = TITLE_TAG_RE.search(proc.stdout)
    if not m:
        return None, "DOM 中未找到 <title>（页面加载失败？stderr: " + proc.stderr.strip()[:200] + "）"
    return m.group(1).strip(), None


def judge_title(title):
    """按「通过前缀 + p == t + t > 0」判据裁决标题结论。

    参数:
        title: 测试页 document.title 文本
    返回:
        (ok, passed, total) 三元组——ok 为判据结果；passed/total 为解析计数
        （标题不匹配时均为 -1）
    """
    m = TITLE_PASS_RE.match(title)
    if not m:
        return False, -1, -1
    passed, total = int(m.group(2)), int(m.group(3))
    return passed == total and total > 0, passed, total


def main():
    """串行执行四步验证，任一步失败即中止并报告。

    返回:
        退出码（0 = 四步全绿；1 = 存在失败步）
    """
    print("像素街机厅 · 一键全量验证")
    # 第 1 步：分享包重建
    if run_py_step("第 1 步 / 共 4 步：分享包重建", "tools/sync_packages.py") != 0:
        print("\n[FAIL] 分享包重建失败，中止后续步骤")
        return 1
    # 第 2 步：静态十项检查
    if run_py_step("第 2 步 / 共 4 步：静态一致性检查（十项）", "tests/check.py") != 0:
        print("\n[FAIL] 静态检查存在失败项，中止后续步骤")
        return 1
    # 无头浏览器前置探测（第 3/4 步共用）
    browser = find_browser()
    if not browser:
        print("\n[FAIL] 未找到 Chrome / Edge——请安装后重跑，或把浏览器可执行文件路径加入 PATH")
        return 1
    print(f"\n无头浏览器：{browser}")
    server = start_server()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        # 第 3/4 步：无头冒烟 + 无头行为回归
        for label, path_name, prefix in (
            ("第 3 步 / 共 4 步：无头冒烟", "/tests/smoke.html", "冒烟通过"),
            ("第 4 步 / 共 4 步：无头行为回归", "/tests/behavior.html", "行为通过"),
        ):
            print(f"\n==== {label}（{path_name}，虚拟时间预算 {VIRTUAL_TIME_BUDGET_MS}ms）====")
            title, err = run_headless(browser, base + path_name)
            if err:
                print(f"[FAIL] {err}")
                return 1
            ok, passed, total = judge_title(title)
            if not ok:
                print(f"[FAIL] 结论标题不符预期：「{title}」（期望「{prefix} p/t」且 p == t > 0）")
                return 1
            print(f"[ OK ] {prefix} {passed}/{total}")
    finally:
        server.shutdown()
        server.server_close()
    print("\n==============================================")
    print("一键验证：4/4 步全绿")
    return 0


if __name__ == "__main__":
    sys.exit(main())
