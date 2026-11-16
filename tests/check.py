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
  8. 风格红线     —— 松散相等 ==、var 声明、console.log 调试残留零容忍（去噪后行级匹配，
                     注释/字符串里的「提及」不误判）
  9. 分享包一致   —— .trae-html-share-packages 下分享包与源文件逐条目字节一致
                     （缺失/过期/多余/越根均报错；重建命令 tools/sync_packages.py）
  10. 去噪自检    —— strip_js_noise 行级状态机 doctest 回归（转义引号/跨行注释/模板串）

用法（项目根目录或任意目录均可）：
    python tests/check.py

退出码：0 = 全部通过；1 = 存在失败项（逐条打印明细）。
"""
import doctest
import re
import sys
import zipfile
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

# 风格红线目标模式（检查项 8，在去噪代码骨架上匹配）：
#   松散相等 ==：负向断言排除 ===（后随 =）、!==（前置 !）、<=/>=（前置 < >）等合法形态
#   var 声明：\b 词边界避免误伤标识符子串；应使用 const/let
#   console.log：调试残留零容忍（用户可见输出仅允许 warn/error）
LOOSE_EQ_RE = re.compile(r"(?<![=!<>])==(?!=)")
VAR_DECL_RE = re.compile(r"\bvar\s")
DEBUG_LOG_RE = re.compile(r"\bconsole\.log\s*\(")

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


def scan_targets():
    """统一扫描目标收集：每个文件只读一次原文并去噪一次生成骨架。

    供危险模式扫描（用原文 raw）、存储兜底（用骨架 skel，二次去噪幂等）、
    风格红线（用骨架 skel）三项检查复用，替代各自重复读盘与重复去噪。

    返回:
        [(name, raw, skel)] 列表——name 为报告用文件名（HTML 内联脚本带
        「（内联脚本）」后缀），raw 为 js 全文或 HTML 内联脚本块拼接原文，
        skel 为 raw 经 strip_js_code 去噪后的代码骨架
    """
    targets = []
    for js in js_files():
        raw = js.read_text(encoding="utf-8")
        targets.append((js.name, raw, strip_js_code(raw)))
    for page in html_files():
        raw = script_chunks(page.read_text(encoding="utf-8"))
        targets.append((f"{page.name}（内联脚本）", raw, strip_js_code(raw)))
    return targets


def check_dangerous_problems(targets):
    """检查项 4：全站 js 与 HTML 内联脚本扫描危险模式，要求零命中。

    参数:
        targets: scan_targets() 产出的 (name, raw, skel) 列表（本项按原文扫描，
                 注释/字符串里的「提及」也计入——保守策略，与历史口径一致）
    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for name, raw, _skel in targets:
        for pat, label in DANGEROUS_PATTERNS:
            if pat in raw:
                problems.append(f"{name} 命中危险模式: {label}")
    return problems


def strip_js_noise(line, state):
    r"""剥离一行 JS 中的注释与字符串/模板串内容，仅保留代码骨架。

    行级 try 追踪的前置去噪：注释里「提及」的 localStorage / try、字符串字面量里的
    花括号等噪声不得干扰大括号深度与 try 状态机。块注释（/* */）与模板串（`）允许
    跨行，扫描状态经 state 字典跨行传递。

    参数:
        line: 原始行文本
        state: 跨行扫描状态字典 {"block": 是否处于块注释内, "tmpl": 是否处于模板串内}
    返回:
        (清理后的代码文本, state)——state 原地更新并原样返回

    示例（doctest 自检，第 10 项检查运行）：
    >>> strip_js_noise("const s = 'a\\'b'; f()", {"block": False, "tmpl": False})
    ('const s = ; f()', {'block': False, 'tmpl': False})
    >>> strip_js_noise("x(`a{b}c`)", {"block": False, "tmpl": False})
    ('x()', {'block': False, 'tmpl': False})
    >>> strip_js_noise("a /* c", {"block": False, "tmpl": False})
    ('a ', {'block': True, 'tmpl': False})
    >>> strip_js_noise("b */ c", {"block": True, "tmpl": False})
    (' c', {'block': False, 'tmpl': False})
    >>> strip_js_noise("f() // { localStorage", {"block": False, "tmpl": False})
    ('f() ', {'block': False, 'tmpl': False})
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


def strip_js_code(text):
    """全文去噪：逐行剥离注释与字符串/模板串内容，返回拼接后的纯代码骨架。

    复用 strip_js_noise 的行级状态机（块注释与模板串允许跨行），供风格红线等
    全文正则扫描使用；输出按原行序以换行拼接，行号与原文一一对应。

    参数:
        text: JS 全文，或 HTML 内联脚本块拼接文本
    返回:
        去噪后的代码骨架文本
    """
    state = {"block": False, "tmpl": False}
    lines = []
    for raw in text.split("\n"):
        code, state = strip_js_noise(raw, state)
        lines.append(code)
    return "\n".join(lines)


def storage_line_problems(name, text):
    """行级存储兜底检测：每一处 localStorage 直接读写都必须位于 try 块内。

    以「去噪 + 大括号深度 + try 体深度栈」逐字符扫描：try 的 { 使其体深度入栈，
    配对的 } 出栈；某调用点只要存在任一栈内体深度 ≤ 当前深度即视为处于该 try
    体内（含体内嵌套 if/for 等更深块）。同文件其它位置有无 catch 不再影响判定——
    修复文件级粗检「文件里有任意 catch 即整文件放行」放过单处裸调用的漏洞。

    参数:
        name: 文件名（报告用，形如 bee.js 或 index.html（内联脚本））
        text: JS 全文，或 HTML 内联脚本块拼接文本；也可传入已去噪骨架
              （strip_js_noise 幂等——骨架无引号/注释标记，重复剥离无副作用）
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


def check_storage_problems(targets):
    """检查项 5：直接调用 localStorage 读写的每一处必须逐处位于 try 块内（行级检测）。

    本站约定为「直接调用 + try-catch 逐处包裹」（技术文档 §5）。原文件级粗检
    （同文件存在任意 catch 即放行）曾放过单处裸调用（bee.js 顶层读取，2026-11-05
    审查修复），故升级为行级：仅当调用点本身处于未闭合 try 块体内才视为有兜底。

    参数:
        targets: scan_targets() 产出的 (name, raw, skel) 列表（本项用骨架 skel，
                 storage_line_problems 内部二次去噪幂等，结果与传原文一致）
    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for name, _raw, skel in targets:
        problems.extend(storage_line_problems(name, skel))
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


def check_style_problems(targets):
    """检查项 8：风格红线——松散相等 / var 声明 / console.log 调试残留零容忍。

    对全部 js 文件与 HTML 内联脚本做行级扫描（在去噪骨架上匹配，注释与字符串
    字面量中的「提及」不误判）。本项目不引入 ESLint/Node 工具链（2026-11 方案 B
    决策），由本检查承担其最有价值的三条正确性/风格规则。

    参数:
        targets: scan_targets() 产出的 (name, raw, skel) 列表（本项直接枚举骨架行）
    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for name, _raw, skel in targets:
        for lineno, line in enumerate(skel.split("\n"), 1):
            if LOOSE_EQ_RE.search(line):
                problems.append(f"{name}:L{lineno} 松散相等 ==（应使用 ===/!==）")
            if VAR_DECL_RE.search(line):
                problems.append(f"{name}:L{lineno} var 声明（应使用 const/let）")
            if DEBUG_LOG_RE.search(line):
                problems.append(f"{name}:L{lineno} console.log 调试残留（仅允许 warn/error）")
    return problems


def check_packages_problems():
    """检查项 9：HTML 分享包与源文件逐条目字节一致。

    约定：.trae-html-share-packages 下每个根页面一个 <page>.html.zip（全站快照）、
    每个 tests 页面一个 tests/<page>.zip。判定规则与 tools/sync_packages.py 的
    产出形态对齐（但不耦合其打包细节）：
      a. 期望包必须存在（新游戏 / 新 tests 页面漏打包即红）
      b. 包内条目必须逐个映射到仓库真实源文件且字节一致（源码改后忘同步即红）
      c. 条目不得越出仓库根（防临时产物 / 绝对路径混入）
      d. 不得存在期望之外的孤儿 zip（页面删除后遗留即红）

    返回:
        失败明细列表（空列表 = 通过）
    """
    pkg = ROOT / ".trae-html-share-packages"
    if not pkg.is_dir():
        return [".trae-html-share-packages 目录缺失（运行 tools/sync_packages.py 生成）"]
    # 期望包集合：根页面 × 1 + tests 页面 × 1
    expected = {f"{p.name}.zip" for p in ROOT.glob("*.html")}
    expected |= {f"tests/{p.name}.zip" for p in (ROOT / "tests").glob("*.html")}
    # 实际包集合（含 tests/ 子目录，zip 内路径统一正斜杠）
    actual = {str(z.relative_to(pkg)).replace("\\", "/") for z in pkg.rglob("*.zip")}
    problems = []
    for miss in sorted(expected - actual):
        problems.append(f"缺少分享包 {miss}（运行 tools/sync_packages.py 生成）")
    for orphan in sorted(actual - expected):
        problems.append(f"多余分享包 {orphan}（对应页面已不存在，请删除后重跑 tools/sync_packages.py）")
    for rel in sorted(actual & expected):
        with zipfile.ZipFile(pkg / rel) as zf:
            for name in zf.namelist():
                # 规则 c：越根条目（绝对路径 / 上跳）直接拒绝
                if name.startswith(("/", "\\")) or ".." in Path(name).parts:
                    problems.append(f"{rel} 条目越出仓库根: {name}")
                    continue
                src = ROOT / name
                # 规则 b：源文件已不存在 = 包内容过期
                if not src.is_file():
                    problems.append(f"{rel} 条目无对应源文件: {name}")
                    continue
                if zf.read(name) != src.read_bytes():
                    problems.append(f"{rel} 条目与源文件不一致: {name}")
    return problems


def check_doctest_problems():
    """检查项 10：strip_js_noise 行级状态机 doctest 回归。

    以 doctest 重放去噪函数 docstring 中的样例（转义引号 / 模板串花括号 /
    跨行块注释两条 / 行注释吞噪声），守护行级检测的地基不被重构破坏；
    失败明细由 doctest 自动打印到 stdout。

    返回:
        失败明细列表（空列表 = 通过）
    """
    result = doctest.testmod()
    if result.failed:
        return [f"doctest 失败 {result.failed}/{result.attempted} 例（明细见上方输出）"]
    return []


def main():
    """主流程：依次运行十项检查，汇总结果并按退出码约定返回。"""
    targets = scan_targets()  # 每文件只读一次/去噪一次：第 4/5/8 项共用同一份目标
    checks = [
        ("引用完整性", check_refs_problems),
        ("缓存指纹(?v=)", check_version_problems),
        ("公共库加载序", check_lib_order_problems),
        ("危险模式扫描", lambda: check_dangerous_problems(targets)),
        ("存储兜底", lambda: check_storage_problems(targets)),
        ("游戏入口完整", check_games_problems),
        ("兼容性前缀", check_compat_problems),
        ("风格红线", lambda: check_style_problems(targets)),
        ("分享包一致", check_packages_problems),
        ("去噪自检", check_doctest_problems),
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
