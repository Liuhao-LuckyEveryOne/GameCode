"""街机厅本地开发服务器（端口 8765）。

在 SimpleHTTPRequestHandler 基础上为所有响应追加禁缓存头，
确保浏览器每次访问都向服务器验证文件新鲜度，杜绝"改了代码浏览器仍跑旧版"的问题。
启动方式：python server.py（需在本目录下执行）
"""

import errno
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 监听端口：与原 python -m http.server 8765 保持一致，用户书签/习惯访问不受影响
PORT = 8765


class NoCacheHandler(SimpleHTTPRequestHandler):
    """为每个响应追加 Cache-Control: no-store 的静态文件处理器。"""

    def end_headers(self):
        # no-store：浏览器不得存储任何副本；no-cache + must-revalidate：双保险强制逐次验证
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class DualStackServer(ThreadingHTTPServer):
    """IPv6 环回服务器：绑定 ::1（仅本机回环），服务 localhost 的 IPv6 访问。

    Windows 下浏览器把 localhost 优先解析为 ::1，纯 IPv4 绑定会导致
    http://localhost:8765 主文档加载被拒（net::ERR_ABORTED）；故优先走
    AF_INET6 环回。仅绑定回环地址，开发服务不暴露到局域网/公网接口
    （旧版双栈通配 :: + 关闭 IPV6_V6ONLY 会同时监听外网接口，已弃用）；
    无 IPv6 栈的环境由 __main__ 回退 ThreadingHTTPServer(("127.0.0.1", PORT))，
    回退路径下 127.0.0.1 与 localhost 均可访问。
    """

    address_family = socket.AF_INET6

    def server_bind(self):
        # 关闭 v6-only 尽量保留 IPv4 映射兼容（实际仅 ::1 被监听，IPv4 直连
        # 在本路径不可达；极少数系统不支持该选项时忽略，至少 IPv6 环回可用）
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


def run_startup_check():
    """启动期自动运行 tests/check.py 静态一致性检查器（一次性，毫秒级，不进请求路径）。

    消除「检查器需手动触发」的遗漏：日常 python server.py 起服即检十七项站点约定。
    检查失败仅打印醒目警告、不阻断起服——服务器仍需起来供修复调试；
    tests 目录不在位时（import 失败）静默降级，不影响服务器本身。

    返回:
        无（检查结果直接打印到控制台）
    """
    try:
        # tests 为命名空间包：python 以任意 cwd 启动本脚本时 sys.path[0] 均为脚本所在目录，导入稳定
        from tests import check as checker
    except ImportError:
        print("（tests/check.py 不在位，跳过启动期静态检查）")
        return
    if checker.main() != 0:
        print("=" * 46)
        print("警告：静态检查存在失败项，建议修复后重启验证（服务器已照常启动）")
        print("=" * 46)


if __name__ == "__main__":
    # 起服前先跑一遍静态一致性检查（十七项，检查项明细见 tests/check.py 头部说明）
    run_startup_check()
    # ThreadingHTTPServer 系：多线程并发响应页面/脚本/图片等并行请求；
    # 两条绑定路径均仅监听本机回环（::1 / 127.0.0.1），开发服务不暴露到局域网/公网
    try:
        server = DualStackServer(("::1", PORT), NoCacheHandler)
    except OSError as e:
        # 端口被占用（如重复起服）时双栈与 IPv4 回退都绑不上，直接给友好提示退出而非裸抛堆栈
        if e.errno == errno.EADDRINUSE:
            print(f"启动失败：端口 {PORT} 已被占用——可能有另一个街机厅服务器正在运行，请先关闭它或更换 PORT")
            raise SystemExit(1) from e
        # 无 IPv6 栈等场景回退纯 IPv4 环回
        server = ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)
    print(f"街机厅开发服务器运行中：http://localhost:{PORT}/index.html （禁缓存模式，仅本机可访问）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")  # Ctrl+C 友好退出，不打印 KeyboardInterrupt 堆栈
