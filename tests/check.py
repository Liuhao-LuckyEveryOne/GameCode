#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素街机厅 · 静态一致性检查器（tests/check.py）

纯 Python 3 标准库零依赖，与 server.py 同一工具链（node 不参与本项目）。
对本项目全部 *.html / *.js 做静态扫描，守护以下站点约定（详见 docs/技术文档.md §8）：

  1. 引用完整性   —— 所有 HTML 中的本地 src=/href= 引用必须指向真实存在的文件
  2. 缓存指纹     —— 本地 .js/.css/.html 引用必须携带 ?v= 版本参数（手动破缓存策略）
  3. 公共库加载序 —— 每页必须按 audio.js → fx.js → fullscreen.js → 业务 js 顺序加载三件套
  4. 危险模式扫描 —— 全站禁止 eval( / new Function( / document.write(
  5. 存储兜底     —— 直接调用 localStorage 读写的每一处必须位于 try 块内（行级检测：注释/字符串去噪 + 大括号深度追踪 try 状态机）
  6. 游戏入口完整 —— 大厅七张卡片入口与各游戏 html/js 文件一一对应齐全
  7. 兼容性前缀   —— CSS 前缀敏感属性必须 -webkit- 成对（Safari 兼容），AudioContext 必须带
                     webkitAudioContext 回退（文件级粗检；Firefox/Safari 手测清单见技术文档 §9.4）

用法（项目根目录或任意目录均可）：
    python tests/check.py

退出码：0 = 全部通过；1 = 存在失败项（逐条打印明细）。
"""
import re
import sys
from pathlib import Path

# ---------- 路径基准：项目根 = 本脚本目录的上一级 ----------
ROOT = Path(__file__).resolve().parent.parent

# 危险模式清单：纯静态站点禁用动态求值与 document.write（CSP 友好 + 避免解析阻塞）
DANGEROUS_PATTERNS = [
    ("eval(", "动态求值 eval"),
    ("new Function(", "动态函数 new Function"),
    ("document.write(", "文档流写入 document.write"),
]

# localStorage 直接读写 API（行级存储兜底检测的目标调用）
LS_API_RE = re.compile(r"localStorage\.(?:getItem|setItem|removeItem|clear)\s*\(")

# try 块开括号（try 与 { 间允许任意空白；在去噪文本上匹配，注释里「提及」的 try 不误判）
TRY_OPEN_RE = re.compile(r"\btry\s*\{")

# HTML 属性抽取：src="..." 或 href="..."（含单双引号两种写法）
ATTR_RE = re.compile(r"""\b(?:src|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)

# 三件套的标准加载顺序（业务 js 必须排在其后）
LIB_ORDER = ["audio.js", "fx.js", "fullscreen.js"]

# CSS 前缀敏感属性对：(无前缀属性正则, 要求同文件必须存在的 -webkit- 前缀形式)。
# 规则来自本站兼容策略：Safari 旧版对下列属性需 -webkit- 前缀，Firefox/Chrome 均吃无前缀
# 形式——成对书写两侧通吃。mask 简写用负向断言排除 -webkit-mask/-webkit-mask-composite 行。
CSS_PREFIX_PAIRS = [
    (re.compile(r"(?<![\w-])user-select\s*:"), "-webkit-user-select:"),
    (re.compile(r"(?<![\w-])backdrop-filter\s*:"), "-webkit-backdrop-filter:"),
    (re.compile(r"(?<![\w-])mask-composite\s*:"), "-webkit-mask-composite:"),
    (re.compile(r"(?<![\w-])mask\s*:"), "-webkit-mask:"),
]

# Web Audio 构造回退：出现 AudioContext 构造的文件必须含 webkitAudioContext 回退
# （Safari 14.1 之前仅暴露带前缀的构造器；audio.js 为「window.AudioContext || window.webkitAudioContext」写法）
AUDIO_FALLBACK_REQUIRED = "webkitAudioContext"

# 大厅七卡片对应的游戏入口（html, js）
GAMES = [
    ("snake.html", "snake.js"),
    ("tetris.html", "tetris.js"),
    ("pac.html", "pac.js"),
    ("bee.html", "bee.js"),
    ("pinball.html", "pinball.js"),
    ("klotski.html", "klotski.js"),
    ("1024.html", "1024.js"),
]


def html_files():
    """返回项目根下全部 HTML 页面文件列表（按文件名排序）。"""
    return sorted(ROOT.glob("*.html"))


def js_files():
    """返回项目根下全部 JS 文件列表（含公共库、游戏与大厅脚本）。"""
    return sorted(ROOT.glob("*.js"))


def script_chunks(html_text):
    """抽取 HTML 内联 <script>...</script> 块文本的并集。

    参数:
        html_text: HTML 全文
    返回:
        所有内联脚本块拼接后的字符串（外部 src 引用不算内联块）
    """
    blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html_text, re.IGNORECASE | re.DOTALL)
    return "\n".join(blocks)


def is_local(url):
    """判断引用是否为站内本地资源。

    参数:
        url: src/href 属性原始值
    返回:
        True = 本地相对引用需要检查；False = 外链/锚点/协议地址等跳过
    """
    u = url.strip()
    if not u or u.startswith(("#", "http://", "https://", "//", "data:", "mailto:", "javascript:")):
        return False
    return True


def strip_query(url):
    """剥去 URL 的查询串与哈希，得到纯文件路径用于存在性检查。

    参数:
        url: 原始引用
    返回:
        相对路径字符串（形如 audio.js 或 index.html）
    """
    return url.split("?", 1)[0].split("#", 1)[0]


# ---------- 各检查项 ----------

def check_refs_problems():
    """检查项 1：HTML 本地 src/href 引用完整性。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for page in html_files():
        text = page.read_text(encoding="utf-8")
        for url in ATTR_RE.findall(text):
            if not is_local(url):
                continue
            target = ROOT / strip_query(url)
            if not target.exists():
                problems.append(f"{page.name} 引用不存在: {url}")
    return problems


def check_version_problems():
    """检查项 2：本地 .js/.css/.html 引用必须带 ?v= 版本参数。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for page in html_files():
        text = page.read_text(encoding="utf-8")
        for url in ATTR_RE.findall(text):
            if not is_local(url):
                continue
            path = strip_query(url)
            # 仅约束资源型文件；后台脚本等非站内资源型引用不在此列
            if path.endswith((".js", ".css", ".html")) and "?v=" not in url:
                problems.append(f"{page.name} 本地引用缺 ?v= 版本参数: {url}")
    return problems


def check_lib_order_problems():
    """检查项 3：每页公共库三件套齐全且顺序 audio → fx → fullscreen → 业务 js。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for page in html_files():
        text = page.read_text(encoding="utf-8")
        # 依出现顺序收集本页全部本地 js 引用
        refs = []
        for url in ATTR_RE.findall(text):
            if is_local(url) and strip_query(url).endswith(".js"):
                refs.append(strip_query(url))
        # 三件套逐一核对存在性与相对顺序
        pos = []
        for lib in LIB_ORDER:
            if lib not in refs:
                problems.append(f"{page.name} 缺少公共库 {lib}")
            else:
                pos.append(refs.index(lib))
        # 顺序单调递增校验（audio < fx < fullscreen）
        if len(pos) == 3 and pos != sorted(pos):
            problems.append(f"{page.name} 公共库加载顺序错误: {refs}")
        # 业务脚本（三件套之外的首个 js）必须排在 fullscreen.js 之后
        if pos:
            biz = [i for i, r in enumerate(refs) if r not in LIB_ORDER]
            if biz and min(biz) < pos[-1]:
                problems.append(f"{page.name} 业务 js 早于 fullscreen.js 加载: {refs}")
    return problems


def check_dangerous_problems():
    """检查项 4：全站 js 与 HTML 内联脚本扫描危险模式，要求零命中。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    # 独立 js 文件全文扫描
    for js in js_files():
        text = js.read_text(encoding="utf-8")
        for pat, label in DANGEROUS_PATTERNS:
            if pat in text:
                problems.append(f"{js.name} 命中危险模式: {label}")
    # HTML 内联脚本块扫描（外置后当前各页应为空，防止未来回退）
    for page in html_files():
        chunk = script_chunks(page.read_text(encoding="utf-8"))
        for pat, label in DANGEROUS_PATTERNS:
            if pat in chunk:
                problems.append(f"{page.name} 内联脚本命中危险模式: {label}")
    return problems


def strip_js_noise(line, state):
    """剥离一行 JS 中的注释与字符串/模板串内容，仅保留代码骨架。

    行级 try 追踪的前置去噪：注释里「提及」的 localStorage / try、字符串字面量里的
    花括号等噪声不得干扰大括号深度与 try 状态机。块注释（/* */）与模板串（`）允许
    跨行，扫描状态经 state 字典跨行传递。

    参数:
        line: 原始行文本
        state: 跨行扫描状态字典 {"block": 是否处于块注释内, "tmpl": 是否处于模板串内}
    返回:
        (清理后的代码文本, state)——state 原地更新并原样返回
    """
    out = []
    i, n = 0, len(line)
    while i < n:
        if state["block"]:
            # 块注释内：找到 */ 结束；找不到则整行吞掉，状态延续下一行
            j = line.find("*/", i)
            if j < 0:
                i = n
            else:
                state["block"] = False
                i = j + 2
            continue
        if state["tmpl"]:
            # 模板串内：找到未转义的 ` 结束（\` 转义跳过）；找不到则延续下一行
            j = i
            while j < n:
                if line[j] == "\\":
                    j += 2
                elif line[j] == "`":
                    break
                else:
                    j += 1
            if j < n:
                state["tmpl"] = False
            i = j + 1
            continue
        ch = line[i]
        if ch == "/" and line[i + 1:i + 2] == "/":
            break                                   # 行注释：余下整段忽略
        if ch == "/" and line[i + 1:i + 2] == "*":
            state["block"] = True                   # 块注释开始
            i += 2
            continue
        if ch in "'\"":
            # 单双引号字符串（JS 语法不允许跨行）：行内找闭合引号，\ 转义跳过；
            # 未闭合按行尾宽松收束，避免状态错乱
            j = i + 1
            while j < n and line[j] != ch:
                j += 2 if line[j] == "\\" else 1
            i = j + 1
            continue
        if ch == "`":
            state["tmpl"] = True                    # 模板串开始（允许跨行）
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out), state


def storage_line_problems(name, text):
    """行级存储兜底检测：每一处 localStorage 直接读写都必须位于 try 块内。

    以「去噪 + 大括号深度 + try 体深度栈」逐字符扫描：try 的 { 使其体深度入栈，
    配对的 } 出栈；某调用点只要存在任一栈内体深度 ≤ 当前深度即视为处于该 try
    体内（含体内嵌套 if/for 等更深块）。同文件其它位置有无 catch 不再影响判定——
    修复文件级粗检「文件里有任意 catch 即整文件放行」放过单处裸调用的漏洞。

    参数:
        name: 文件名（报告用，形如 bee.js 或 index.html（内联脚本））
        text: JS 全文，或 HTML 内联脚本块拼接文本
    返回:
        问题明细列表（空列表 = 通过），每条带行号
    """
    problems = []
    depth = 0                 # 跨行累计的大括号深度
    try_depths = []           # 未闭合 try 块的体深度栈（同深度可重复，list 多重集语义）
    state = {"block": False, "tmpl": False}
    for lineno, raw in enumerate(text.split("\n"), 1):
        code, state = strip_js_noise(raw, state)
        # 本行内属于 try 开括号那个 { 的字符下标集合 + 本行内 API 调用点下标集合
        try_braces = {m.end() - 1 for m in TRY_OPEN_RE.finditer(code)}
        api_pos = {m.start() for m in LS_API_RE.finditer(code)}
        if not try_braces and not api_pos and "{" not in code and "}" not in code:
            continue                            # 无括号纯文本行：快速跳过
        local = depth
        for idx, ch in enumerate(code):
            if ch == "{":
                local += 1
                if idx in try_braces:
                    try_depths.append(local)    # try 体深度 = { 之后的新深度
            elif ch == "}":
                if local in try_depths:
                    try_depths.remove(local)    # 该深度 try 块在此闭合出栈
                local -= 1
            elif idx in api_pos and not any(t <= local for t in try_depths):
                problems.append(f"{name}:L{lineno} 直接调用 localStorage 但不在 try 块内（缺行级兜底）")
        depth = local
    return problems


def check_storage_problems():
    """检查项 5：直接调用 localStorage 读写的每一处必须逐处位于 try 块内（行级检测）。

    本站约定为「直接调用 + try-catch 逐处包裹」（技术文档 §5）。原文件级粗检
    （同文件存在任意 catch 即放行）曾放过单处裸调用（bee.js 顶层读取，2026-11-05
    审查修复），故升级为行级：仅当调用点本身处于未闭合 try 块体内才视为有兜底。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for js in js_files():
        problems.extend(storage_line_problems(js.name, js.read_text(encoding="utf-8")))
    for page in html_files():
        chunk = script_chunks(page.read_text(encoding="utf-8"))
        problems.extend(storage_line_problems(f"{page.name}（内联脚本）", chunk))
    return problems


def check_games_problems():
    """检查项 6：大厅七卡片入口与各游戏 html/js 齐全。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    index_text = (ROOT / "index.html").read_text(encoding="utf-8")
    for html_name, js_name in GAMES:
        # 文件对齐全
        if not (ROOT / html_name).exists():
            problems.append(f"游戏入口缺失: {html_name}")
        if not (ROOT / js_name).exists():
            problems.append(f"游戏脚本缺失: {js_name}")
        # 大厅卡片入口链接齐全且带版本
        pattern = f'href="{html_name}?v='
        if pattern not in index_text:
            problems.append(f"index.html 缺少 {html_name} 的带版本卡片入口链接")
    return problems


def check_compat_problems():
    """检查项 7：浏览器兼容前缀成对 + Web Audio 构造回退（文件级粗检）。

    扫描范围：HTML 全文（CSS 内嵌于 <style> 块与内联样式属性）+ 全部 js 文件
    （防未来 js 动态设置样式引入无前缀属性）。规则：
      a. 文本出现前缀敏感属性的无前缀形式 → 同文件必须存在对应 -webkit- 前缀形式
      b. 文本出现 AudioContext → 同文件必须存在 webkitAudioContext 回退

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []

    def audit(name, text):
        # 规则 a：前缀敏感属性无前缀形式出现时，-webkit- 前缀形式必须同文件在场
        for unprefixed_re, prefixed in CSS_PREFIX_PAIRS:
            if unprefixed_re.search(text) and prefixed not in text:
                problems.append(f"{name} 使用无前缀 {unprefixed_re.pattern} 但缺 {prefixed} 成对")
        # 规则 b：AudioContext **构造用法**须带 webkit 回退（注释提及不约束，避免误报；
        # 正则同时命中「new AudioContext」与「new (window.AudioContext …)」两种构造形态）
        if re.search(r"new\s*\(?\s*(?:window\.)?AudioContext", text) and AUDIO_FALLBACK_REQUIRED not in text:
            problems.append(f"{name} 构造 AudioContext 但缺 {AUDIO_FALLBACK_REQUIRED} 回退")

    for page in html_files():
        audit(page.name, page.read_text(encoding="utf-8"))
    for js in js_files():
        audit(js.name, js.read_text(encoding="utf-8"))
    return problems


def main():
    """主流程：依次运行七项检查，汇总结果并按退出码约定返回。"""
    checks = [
        ("引用完整性", check_refs_problems),
        ("缓存指纹(?v=)", check_version_problems),
        ("公共库加载序", check_lib_order_problems),
        ("危险模式扫描", check_dangerous_problems),
        ("存储兜底", check_storage_problems),
        ("游戏入口完整", check_games_problems),
        ("兼容性前缀", check_compat_problems),
    ]
    all_ok = True
    for label, fn in checks:
        problems = fn()
        if problems:
            all_ok = False
            print(f"[FAIL] {label}")
            for p in problems:
                print(f"       - {p}")
        else:
            print(f"[ OK ] {label}")

    print("-" * 46)
    if all_ok:
        print(f"全部通过：{len(checks)}/{len(checks)} 项检查全绿")
        return 0
    print("存在失败项，请修复后重跑")
    return 1


if __name__ == "__main__":
    sys.exit(main())
