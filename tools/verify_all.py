#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素街机厅 · 一键全量验证器（tools/verify_all.py）

把「分享包重建 → 静态检查 → 无头冒烟 → 无头行为回归」四步验证串成单命令，
纯 Python 3 标准库零依赖（无头浏览器按常见安装路径自动探测本机 Chrome / Edge）。

用法（项目根目录或任意目录均可）：
    python tools/verify_all.py

四步流水（任一步失败立即中止，非零码退出）：
  1. 分享包重建   —— tools/sync_packages.py（快照包与源文件逐条目一致）
  2. 静态一致性   —— tests/check.py（十五项检查全绿）
  3. 无头冒烟     —— tests/smoke.html（document.title 输出「冒烟通过 p/t」）
  4. 无头行为回归 —— tests/behavior.html（document.title 输出「行为通过 p/t」）

无头运行要点：
  - CDP 实时驱动：--remote-debugging-port=0 启动无头浏览器，从临时 profile 内
    DevToolsActivePort 文件拿调试端口，/json/list 定位测试页 target，以标准库
    手写的最小 WebSocket 客户端每 0.5s Runtime.evaluate 轮询 document.title，
    出现「通过/失败」结论标题即收——与两测试页「真实浏览器运行 + 自动化可读
    document.title」的原生模式语义一致，测试页零特殊适配
  - 弃用 --virtual-time-budget + --dump-dom 管线的原因：Chrome 132+ 新无头在
    rAF 密集页（本测试台内嵌 7 款游戏 iframe 各自持续动画）上虚拟时间永不空闲，
    预算永不耗尽、dump 永不触发（157 实测结构性挂死），--timeout 兜底同样无效
  - 结论判据为「通过前缀 + p == t + t > 0」——场景数增减无需改本脚本；
    失败前缀标题（冒烟失败/行为失败）同样收作结论，明确报告失败明细
  - 页内看门狗 TIMEOUT_MS=9000（tests/behavior.html）必先于本工具 REAL_TIMEOUT_S
    到期出结论，真实时钟单步上限仅作异常兜底
  - 本地静态服务器以随机空闲端口在守护线程内自起自停（不占用 8765 常服端口）
  - 浏览器以一次性临时 user-data-dir 启动，不触碰用户默认配置文件；收尾整树
    杀进程（chrome 含多个子进程），杜绝孤儿进程与端口残留

退出码：0 = 四步全绿；1 = 存在失败步（打印失败明细与修复提示）。
"""
import base64
import json
import os
import queue
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# ---------- 路径基准：项目根 = 本脚本目录的上一级 ----------
ROOT = Path(__file__).resolve().parent.parent

# 无头单步真实时钟硬超时（秒）：测试页自身 9s 看门狗必先到期出结论，此值仅为异常兜底
REAL_TIMEOUT_S = 180
# CDP 轮询 document.title 的间隔（秒）：远小于页内 9s 看门狗，结论出现即刻可收
POLL_INTERVAL_S = 0.5
# 等待 CDP 调试通道就绪（DevToolsActivePort 写出 + target 注册）的上限（秒）
DEVTOOLS_WAIT_S = 15

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

# 测试页结论标题正则：「冒烟通过 18/18」/「行为通过 34/34」（判据 p == t 且 t > 0）
TITLE_PASS_RE = re.compile(r"^(冒烟通过|行为通过)\s+(\d+)/(\d+)$")
# 测试页自报失败的标题前缀：「冒烟失败 3/18」/「行为失败 5/7（未上报: xxx）」
TITLE_FAIL_RE = re.compile(r"^(冒烟失败|行为失败)")


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
            # 裸命令名形态：交给 PATH 查找，命中返回解析后的全路径（打印形态与绝对路径分支一致）
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


# ---------- 最小 WebSocket 客户端原语（仅覆盖 CDP 单连接文本消息场景，RFC 6455 子集） ----------

def _recv_exact(sock, n):
    """从 socket 精确读满 n 字节（底层 recv 可能短读，循环补齐）。

    参数:
        sock: 已连接的 TCP socket
        n: 需要读取的字节数
    返回:
        恰好 n 字节的 bytes
    异常:
        连接关闭（读到 0 字节）时抛 OSError
    """
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise OSError("websocket 连接已关闭")
        buf += chunk
    return buf


def _ws_connect(host, port, path, timeout=10):
    """建立 WebSocket 连接并完成 HTTP 升级握手。

    不发送 Origin 头，配合浏览器侧 --remote-allow-origins=* 双保险放开来源校验。

    参数:
        host: 调试服务主机（恒为本机回环）
        port: DevToolsActivePort 给出的调试端口
        path: target 的 webSocketDebuggerUrl 路径部分
        timeout: 连接与握手的超时秒数
    返回:
        完成握手的 socket
    异常:
        握手被拒（非 101）或连接中断时抛 OSError
    """
    sock = socket.create_connection((host, port), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode("ascii"))
    # 读响应头至空行；校验状态行 101 Switching Protocols（被拒即放弃，不留半开连接）
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(4096)
        if not chunk:
            raise OSError("websocket 握手连接中断")
        resp += chunk
    status_line = resp.split(b"\r\n\r\n", 1)[0].decode("latin-1").splitlines()[0]
    if " 101 " not in status_line:
        sock.close()
        raise OSError("websocket 握手被拒绝：" + status_line)
    return sock


def _ws_send(sock, text):
    """发送一条客户端文本帧（RFC 6455：客户端帧必须掩码）。

    参数:
        sock: 已完成握手的 socket
        text: 待发送的 UTF-8 文本（CDP JSON 请求）
    """
    payload = text.encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])  # FIN + 文本帧 opcode
    n = len(payload)
    # 长度三档编码：7 位内直接写 / 16 位扩至 126 标记 / 64 位扩至 127 标记
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header += struct.pack(">H", n)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", n)
    header += mask
    # 4 字节掩码循环 XOR 混淆载荷
    header += bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    sock.sendall(bytes(header))


def _ws_recv(sock):
    """接收一条完整消息（自动处理分片累积与服务端 ping）。

    参数:
        sock: 已完成握手的 socket
    返回:
        消息文本（UTF-8 解码）；收到 close 帧返回 None
    异常:
        连接中断时抛 OSError
    """
    frags = []
    while True:
        b1, b2 = _recv_exact(sock, 2)
        fin, opcode = b1 & 0x80, b1 & 0x0F
        masked, length = b2 & 0x80, b2 & 0x7F
        # 扩展长度：126 → 后随 16 位 / 127 → 后随 64 位
        if length == 126:
            length = struct.unpack(">H", _recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack(">Q", _recv_exact(sock, 8))[0]
        mask = _recv_exact(sock, 4) if masked else None
        data = _recv_exact(sock, length) if length else b""
        if mask:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        if opcode == 8:
            return None  # close 帧：通道关闭
        if opcode == 9:
            # ping → 原样回 pong（无掩码，服务端帧不掩码；载荷 <126 字节足够）
            pong = bytearray([0x8A, len(data)]) + data
            sock.sendall(bytes(pong))
            continue
        # 文本/二进制/续帧：累积到 FIN 置位合为完整消息
        frags.append(data)
        if fin:
            return b"".join(frags).decode("utf-8", errors="replace")


def run_headless(browser, url):
    """无头实时驱动测试页，经 CDP 轮询 document.title 直到出现结论标题。

    启动链：临时 profile + 随机调试端口拉起浏览器 → 等 DevToolsActivePort 就绪 →
    /json/list 定位测试页 target → 建 WebSocket → 后台线程收帧，主循环每
    POLL_INTERVAL_S 发一次 Runtime.evaluate，识别到「通过/失败」结论即收；
    收尾整树杀进程并清理临时 profile。

    参数:
        browser: 浏览器可执行文件路径
        url: 测试页地址（临时服上）
    返回:
        (title, error) 二元组——title 为结论标题（通过/失败前缀均收）；
        error 为失败原因描述（成功为 None）
    """
    profile_dir = tempfile.mkdtemp(prefix="arcade_headless_")
    argv = [
        browser, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        # 端口 0 = 由系统分配并在 DevToolsActivePort 落盘；放开来源校验配合无 Origin 握手
        "--remote-debugging-port=0", "--remote-allow-origins=*",
        f"--user-data-dir={profile_dir}", url,
    ]
    proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sock = None
    try:
        # 等 DevToolsActivePort（首行为调试端口）；浏览器提前退出即报错
        port_file = Path(profile_dir) / "DevToolsActivePort"
        deadline = time.monotonic() + DEVTOOLS_WAIT_S
        port = None
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                return None, f"浏览器提前退出（exit={proc.returncode}），无法建立 CDP 调试通道"
            if port_file.is_file():
                try:
                    port = int(port_file.read_text(encoding="ascii").splitlines()[0].strip())
                    break
                except (ValueError, IndexError):
                    pass  # 文件尚在写入中，下轮重读
            time.sleep(0.2)
        if port is None:
            return None, f"等待 DevToolsActivePort 超时（{DEVTOOLS_WAIT_S}s），CDP 调试通道未就绪"

        # /json/list 定位测试页 target（页面导航注册可能稍晚，小步重试）
        ws_path = None
        deadline = time.monotonic() + DEVTOOLS_WAIT_S
        while time.monotonic() < deadline and ws_path is None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as resp:
                    for t in json.loads(resp.read().decode("utf-8")):
                        if t.get("type") == "page" and t.get("url", "").split("#")[0] == url:
                            ws_path = urlparse(t["webSocketDebuggerUrl"]).path
                            break
            except (OSError, ValueError):
                pass  # HTTP 服务偶发未就绪，重试
            if ws_path is None:
                time.sleep(0.3)
        if ws_path is None:
            return None, "CDP 目标列表中未找到测试页 target"

        # 建 WebSocket + 后台收帧线程（None 哨兵表示通道断开）
        sock = _ws_connect("127.0.0.1", port, ws_path)
        frames = queue.Queue()

        def _pump():
            try:
                while True:
                    frames.put(_ws_recv(sock))
            except Exception:
                frames.put(None)

        threading.Thread(target=_pump, daemon=True).start()

        # 轮询 document.title：出现「通过/失败」结论即收（页内 9s 看门狗自限）
        probe_id = 1
        deadline = time.monotonic() + REAL_TIMEOUT_S
        next_poll = 0.0
        while True:
            now = time.monotonic()
            if now >= deadline:
                return None, (f"真实时钟超 {REAL_TIMEOUT_S}s 未出现结论标题"
                              "（测试页 9s 看门狗本应先到期，疑似页面异常）")
            if now >= next_poll:
                _ws_send(sock, json.dumps({
                    "id": probe_id, "method": "Runtime.evaluate",
                    "params": {"expression": "document.title", "returnByValue": True},
                }))
                next_poll = now + POLL_INTERVAL_S
            # 阻塞等下一帧，但不超过下一次轮询时刻（保证轮询节拍不被慢帧拖住）
            remain = min(next_poll, deadline) - time.monotonic()
            try:
                msg = frames.get(timeout=max(remain, 0.05))
            except queue.Empty:
                continue
            if msg is None:
                return None, "CDP 通道断开（浏览器退出或连接被关闭）"
            data = json.loads(msg)
            if data.get("id") == probe_id and "result" in data:
                probe_id += 1
                value = data["result"].get("result", {}).get("value")
                # 通过判据命中或失败前缀命中 → 拿到结论（失败明细交由调用方报告）
                if isinstance(value, str) and (judge_title(value)[0] or TITLE_FAIL_RE.match(value)):
                    return value, None
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        # 整树收割无头浏览器（chrome 含 GPU/网络等多个子进程，Windows 须 /T 连带杀）
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)


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
    # 第 2 步：静态十五项检查
    if run_py_step("第 2 步 / 共 4 步：静态一致性检查（十五项）", "tests/check.py") != 0:
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
            print(f"\n==== {label}（{path_name}，CDP 实时轮询 {POLL_INTERVAL_S}s / 超时 {REAL_TIMEOUT_S}s）====")
            title, err = run_headless(browser, base + path_name)
            if err:
                print(f"[FAIL] {err}")
                return 1
            # 失败结论标题（冒烟失败/行为失败）先拦截，给出比「不符预期」更明确的报告
            if TITLE_FAIL_RE.match(title):
                print(f"[FAIL] 测试页自报失败：「{title}」")
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
