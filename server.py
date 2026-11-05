"""街机厅本地开发服务器（端口 8765）。

在 SimpleHTTPRequestHandler 基础上为所有响应追加禁缓存头，
确保浏览器每次访问都向服务器验证文件新鲜度，杜绝"改了代码浏览器仍跑旧版"的问题。
启动方式：python server.py（需在本目录下执行）
"""

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
    """IPv6 双栈服务器：单端口同时接受 IPv6（::1）与 IPv4（127.0.0.1）连接。

    Windows 下浏览器把 localhost 优先解析为 ::1，纯 IPv4 绑定会导致
    http://localhost:8765 主文档加载被拒（net::ERR_ABORTED）；改用 AF_INET6
    并关闭 IPV6_V6ONLY 后，::1 与 IPv4 映射地址（::ffff:127.0.0.1）均由此
    同一 socket 服务，localhost / 127.0.0.1 两种访问方式全部可达。
    """

    address_family = socket.AF_INET6

    def server_bind(self):
        # 关闭 v6-only：允许 IPv4 连接以 ::ffff:x.x.x.x 映射形式进入同一端口；
        # 极少数系统不支持该选项时忽略，保持平台默认行为（至少 IPv6 仍可用）
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


def run_startup_check():
    """启动期自动运行 tests/check.py 静态一致性检查器（一次性，毫秒级，不进请求路径）。

    消除「检查器需手动触发」的遗漏：日常 python server.py 起服即检七项站点约定。
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
    # 起服前先跑一遍静态一致性检查（引用/指纹/加载序/危险模式/存储兜底/入口/兼容前缀）
    run_startup_check()
    # ThreadingHTTPServer 系：多线程并发响应页面/脚本/图片等并行请求；
    # 双栈绑定空主机名（'' = :: 全接口）优先，无 IPv6 栈的环境回退纯 IPv4 全接口
    try:
        server = DualStackServer(("", PORT), NoCacheHandler)
    except OSError:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler)
    print(f"街机厅开发服务器运行中：http://localhost:{PORT}/index.html （禁缓存模式）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")  # Ctrl+C 友好退出，不打印 KeyboardInterrupt 堆栈
