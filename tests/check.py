#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素街机厅 · 静态一致性检查器（tests/check.py）

纯 Python 3 标准库零依赖，与 server.py 同一工具链（node 不参与本项目）。
对本项目全部 *.html / *.js 做静态扫描，守护以下站点约定（详见 docs/技术文档.md §8）：

  1. 引用完整性   —— 所有 HTML 中的本地 src=/href= 引用必须指向真实存在的文件
  2. 缓存指纹     —— 本地 .js/.css/.html 引用必须携带 ?v= 版本参数（手动破缓存策略）
  3. 公共库加载序 —— 每页必须按 arcade-common.js → audio.js → fx.js → fullscreen.js → 业务 js 顺序加载公共库
                     （游戏页额外要求 ach-common.js / snap-common.js / pause-common.js 三共享层齐全）
  4. 危险模式扫描 —— 全站禁止 eval( / new Function( / document.write(
  5. 存储/消息收口 —— 全站禁止绕过 Arcade 存储 API 裸调 localStorage，禁止裸写跨帧
                     消息类型字面量 arcade:*（两者仅允许 arcade-common.js 实现层/定义处
                     与 tests 测试装置白名单；实现层存储裸调仍逐处 try 行级检测，
                     消息字面量一律引用 Arcade.MSG 常量表）
  6. 游戏入口完整 —— 大厅七张卡片入口与各游戏 html/js 文件一一对应齐全
  7. 兼容性前缀   —— CSS 前缀敏感属性必须 -webkit- 成对（Safari 兼容），AudioContext 必须带
                     webkitAudioContext 回退（文件级粗检；Firefox/Safari 手测清单见技术文档 §9.4）
  8. 风格红线     —— 松散相等 ==、var 声明、console.log 调试残留零容忍（去噪后行级匹配，
                     注释/字符串里的「提及」不误判）
  9. 分享包一致   —— .trae-html-share-packages 下分享包与源文件逐条目字节一致
                     （缺失/过期/多余/越根均报错；重建命令 tools/sync_packages.py）
  10. 去噪自检    —— strip_js_noise 行级状态机 doctest 回归（转义引号/跨行注释/模板串）
  11. 成就cat完整 —— 七游戏 ACHIEVEMENTS 数组内凡含 rarity: 的条目必须带 cat: 分类
                     （成就墙锁定卡按「分类 · 尚未达成」渲染，缺失即显示 undefined）
  12. 入口版本一致 —— 大厅卡片入口 X.html?v= 版本不得落后于同名业务 js 当前版本
                     （只升不降不变量；tools/bump-versions.py 自动同步，本项兜底守护）
  13. 大厅数据同步 —— index.js 的 ACH_DEFS 成就表与 BEST_DEFS 最高分键表须与七游戏
                     js 实际定义一致（成就 id 双向比对 / 存档键 arcade_ach_* 一致 /
                     最高分键集合比对，klotski 模板拼键按 DIFF_IDS×LAYOUTS 静态展开；
                     防游戏侧增删成就或改键后大厅殿堂/角标漏同步）
  14. 冒烟白盒契约 —— tests/smoke.html 白盒面（S9~S15 七个 *Core 场景）函数体内的
                     win.X( 直调与 typeof win.X 守卫（window 内建 dispatchEvent 豁免）
                     必须在对应业务 js 中以顶层 function 声明存在（经典脚本顶层
                     声明自动挂 window，contentWindow 直调依赖该语义）；业务 js
                     重命名/删除这些函数时静态期即红，不等冒烟运行期 TypeError
  15. 全屏选择器契约 —— fullscreen.js 顶部 FIT_SELECTORS / TITLE_SELECTORS 两数组为
                     全屏缩放容器与全屏标题的候选选择器（运行期逐个 querySelector
                     取首个命中）；本项静态解析两数组字面量，对大厅 + 七游戏页
                     逐一断言至少一条候选可命中（.cls 核对 class 词表 / #id 核对
                     id 属性精确相等 / h1.cls 限定标签名核对 class 词表），页面
                     markup 重构删容器或改类名时静态期即红，不等全屏功能静默失配

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

# 跨帧消息协议字面量（检查项 5 消息侧）：arcade:* 七类型单点定义于 arcade-common.js
# 的 MSG 表，业务代码一律引用 Arcade.MSG.*，裸写即报错
MSG_LIT_RE = re.compile(r"['\"]arcade:[a-z]+['\"]")

# window message 监听注册（检查项 5 消息侧补充）：跨帧消息监听一律经
# Arcade.onTrustedMessage 统一来源守卫注册（arcade-common.js 单点实现，跨源伪造
# 报文在守卫处静默丢弃），裸 addEventListener('message') 即报错
MSG_LISTEN_RE = re.compile(r"addEventListener\(\s*['\"]message['\"]")

# 存储/消息收口白名单（检查项 5 三族规则共用）：裸调 localStorage、裸写消息类型
# 字面量与裸挂 message 监听仅允许以下文件——
#   arcade-common.js：存储原语与消息注册表唯一实现/定义处（Arcade 存储 API 族 +
#                     MSG/MSG_TARGET/onTrustedMessage），其内部存储裸调仍逐处 try
#                     行级检测；其余生产代码一律走 Arcade API / 引用 Arcade.MSG
#                     常量表 / 经 onTrustedMessage 注册监听
#   smoke/behavior 测试页内联脚本：测试装置需直连真实存储做快照/恢复/种档/黑盒断言，
#                     并以真实报文驱动跨帧消息协议做黑盒验证，属刻意直写
RAW_ALLOW_FILES = {"arcade-common.js", "smoke.html", "behavior.html"}

# try 块开括号（try 与 { 间允许任意空白；在去噪文本上匹配，注释里「提及」的 try 不误判）
TRY_OPEN_RE = re.compile(r"\btry\s*\{")

# HTML 属性抽取：src="..." 或 href="..."（含单双引号两种写法）
ATTR_RE = re.compile(r"""\b(?:src|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)

# 公共库的标准加载顺序（arcade-common 为零依赖基础库须最前，业务 js 必须排在其后）
LIB_ORDER = ["arcade-common.js", "audio.js", "fx.js", "fullscreen.js"]

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

# 游戏页专属公共库（七游戏页必须加载且排在 fullscreen.js 之后、业务 js 之前；
# 大厅 index.html 不开成就墙/无进度快照故不在此列）：
#   ach-common.js —— 成就系统共享层（存档迁移/解锁/成就墙渲染）
#   snap-common.js —— 进度快照共享层（快照存取管线/触发与失焦接线）
#   pause-common.js —— 暂停引擎共享层（守卫/遮罩/BGM/音效公共序列）
GAME_LIB_ORDER = ["ach-common.js", "snap-common.js", "pause-common.js"]
GAME_PAGES = {html for html, _js in GAMES}

# 游戏页音效分册（v3.5 audio.js 命名空间化拆分）：游戏页 → 专属分册文件。
# 每个游戏页必须加载自己的分册，位置须在 audio.js 之后、业务 js 之前
# （分册经 Object.assign(SFX, {...}) 挂载，依赖 audio.js 引擎与内部合成原语）
AUDIO_BUNDLES = {
    "snake.html": "audio-snake.js",
    "tetris.html": "audio-tetris.js",
    "pac.html": "audio-pac.js",
    "bee.html": "audio-bee.js",
    "pinball.html": "audio-pinball.js",
    "klotski.html": "audio-klotski.js",
    "1024.html": "audio-1024.js",
}

# 检查项 11：成就条目锚与分类字段（在去噪骨架上匹配，键名为标识符不受字符串剥离影响）。
# rarity: 为成就条目专属锚字段（不依赖各游戏 ACHIEVEMENTS 变量命名统一）；cat 后紧跟
# 冒号，category: 等更长标识符因词边界 + 冒号断言不误匹配
ACH_ANCHOR_RE = re.compile(r"\brarity\s*:")
ACH_CAT_RE = re.compile(r"\bcat\s*:")
ACH_DECL_RE = re.compile(r"\bconst\s+\w*ACHIEVEMENTS\w*\s*=\s*\[")

# 检查项 13：大厅两表声明锚与游戏侧提取锚。字符串字面量提取须在
# strip_comment_tails 剥注释保字符串的文本上进行（strip_js_code 会剥掉字面量内容
# 导致正则无处匹配）；数组体/条目切片与检查项 11 同技法（括号深度配对）
BEST_DEFS_DECL_RE = re.compile(r"\bconst\s+BEST_DEFS\s*=\s*\[")
ACH_DEFS_DECL_RE = re.compile(r"\bconst\s+ACH_DEFS\s*=\s*\[")
DIFF_IDS_DECL_RE = re.compile(r"\bconst\s+DIFF_IDS\s*=\s*\[([^\]]*)\]")
LAYOUTS_DECL_RE = re.compile(r"\bconst\s+LAYOUTS\s*=\s*\[")
HIGH_SCORE_LIT_RE = re.compile(r"['\"](\w*(?:HighScore|BestScore))['\"]")
ACH_KEY_LIT_RE = re.compile(r"['\"](arcade_ach_\w+)['\"]")
KLOTSKI_KEY_PREFIX_LIT = "'klotskiBest_'"

# 检查项 12：YYYYMMDD-N 版本号解析（fullmatch，用于入口/业务 js 版本元组比较）
VER_NUM_RE = re.compile(r"(\d{8})-(\d+)")


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
    """检查项 3：每页公共库齐全且顺序 arcade-common → audio → fx → fullscreen → 业务 js。

    游戏页额外要求：ach-common.js（成就共享层）、snap-common.js（快照共享层）与 pause-common.js
    （暂停共享层）必须存在且排在 fullscreen.js 之后。

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
        # 公共库逐一核对存在性与相对顺序
        pos = []
        for lib in LIB_ORDER:
            if lib not in refs:
                problems.append(f"{page.name} 缺少公共库 {lib}")
            else:
                pos.append(refs.index(lib))
        # 顺序单调递增校验（仅在本页四件套齐全时才有意义）
        if len(pos) == len(LIB_ORDER) and pos != sorted(pos):
            problems.append(f"{page.name} 公共库加载顺序错误: {refs}")
        # 业务脚本（公共库与音效分册之外的首个 js）必须排在 fullscreen.js 之后
        bundle = AUDIO_BUNDLES.get(page.name)
        if pos:
            biz = [i for i, r in enumerate(refs)
                   if r not in LIB_ORDER and r not in GAME_LIB_ORDER and r != bundle]
            if biz and min(biz) < pos[-1]:
                problems.append(f"{page.name} 业务 js 早于 fullscreen.js 加载: {refs}")
        # 游戏页专属公共库：存在性 + 必须晚于 fullscreen.js（ach-common/snap-common 依赖前置库的挂载）
        if page.name in GAME_PAGES:
            for lib in GAME_LIB_ORDER:
                if lib not in refs:
                    problems.append(f"{page.name} 缺少游戏页公共库 {lib}")
                elif pos and refs.index(lib) < pos[-1]:
                    problems.append(f"{page.name} 游戏页公共库 {lib} 未排在 fullscreen.js 之后")
            # 音效分册：存在性 + 必须在 audio.js 之后、业务 js 之前（依赖引擎原语且供业务调用）
            if bundle:
                if bundle not in refs:
                    problems.append(f"{page.name} 缺少音效分册 {bundle}")
                elif "audio.js" in refs and refs.index(bundle) < refs.index("audio.js"):
                    problems.append(f"{page.name} 音效分册 {bundle} 未排在 audio.js 之后")
                elif biz and refs.index(bundle) > min(biz):
                    problems.append(f"{page.name} 音效分册 {bundle} 晚于业务 js 加载: {refs}")
    return problems


def scan_targets():
    """统一扫描目标收集：每个文件只读一次原文并去噪一次生成骨架。

    供危险模式扫描（用原文 raw）、存储/消息收口（存储用骨架 skel 幂等；消息用原文 raw
    经 strip_comment_tails 剥注释保留字符串）、风格红线（用骨架 skel）三项检查复用，
    替代各自重复读盘与重复去噪。

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
    """检查项 5：全站 localStorage 直接调用收口于 Arcade 存储 API。

    2026-11-17 存储收口改造后的守护，替代旧「直接调用 + try-catch 逐处包裹」约定
    （旧约定曾放过文件级粗检漏洞，bee.js 顶层读取 2026-11-05 审查修复）：生产代码
    一律走 Arcade.saveRaw/loadRaw/removeRaw 与 saveJSON/loadJSON 族（兜底与告警
    下沉到 arcade-common.js 实现层），任何绕过均报错。白名单内文件另行处理：
    arcade-common.js 实现层保留原行级 try 检测自证兜底完整；tests 测试装置跳过。

    参数:
        targets: scan_targets() 产出的 (name, raw, skel) 列表（本项用骨架 skel，
                 行级状态机对骨架逐行处理，行号与原文对齐）
    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for name, _raw, skel in targets:
        base = name.split("（", 1)[0]     # 剥「（内联脚本）」后缀取文件本名
        if base == "arcade-common.js":
            # 存储原语实现层：裸调合法，但仍须逐处 try（行级兜底自检，复用旧状态机）
            problems.extend(storage_line_problems(name, skel))
        elif base in RAW_ALLOW_FILES:
            continue                      # tests 测试装置：刻意直连真实存储，放行
        else:
            # 生产代码：出现任何直接调用即违规（无论是否已包 try）
            for lineno, line in enumerate(skel.split("\n"), 1):
                if LS_API_RE.search(line):
                    problems.append(f"{name}:L{lineno} 绕过 Arcade 存储 API 裸调 localStorage"
                                    f"（应改用 Arcade.saveRaw/loadRaw/removeRaw 或 saveJSON/loadJSON 族）")
    return problems


def strip_comment_tails(line, state):
    r"""剥离一行 JS 中的注释，保留字符串/模板串字面量内容（与 strip_js_noise 反向）。

    消息类型字面量守护的前置去噪：协议字符串写在字符串字面量里，strip_js_code 会把
    字面量内容剥掉导致正则无处匹配；本函数只剥注释（行注释整段丢弃、块注释内容丢弃、
    引号字符串与模板串整体保留），让 MSG_LIT_RE 能在「保留字符串的骨架」上命中裸写
    字面量。已知局限：跨行模板串内的 ${} 表达式不二次解析，内层若有代码级裸写字面量
    属漏报不误报；字符串内的伪注释形态同理（仅漏报）。

    参数:
        line: 原始行文本
        state: 跨行扫描状态字典 {"block": 是否处于块注释内, "tmpl": 是否处于模板串内}
    返回:
        (剥注释后的文本, state)——state 原地更新并原样返回

    示例（doctest 自检，第 10 项检查运行）：
    >>> strip_comment_tails("f('arcade:save')// 大厅下发", {"block": False, "tmpl": False})
    ("f('arcade:save')", {'block': False, 'tmpl': False})
    >>> strip_comment_tails("a /* 'arcade:fs' */f('arcade:fs')", {"block": False, "tmpl": False})
    ("a f('arcade:fs')", {'block': False, 'tmpl': False})
    >>> strip_comment_tails("u('http://x')// 注释提及", {"block": False, "tmpl": False})
    ("u('http://x')", {'block': False, 'tmpl': False})
    >>> strip_comment_tails("t/* 未闭合 'arcade:fs'", {"block": False, "tmpl": False})
    ('t', {'block': True, 'tmpl': False})
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
            # 模板串内：整体保留至未转义的 ` 结束（\` 转义跳过）；找不到则延续下一行
            j = i
            while j < n:
                if line[j] == "\\":
                    j += 2
                elif line[j] == "`":
                    break
                else:
                    j += 1
            out.append(line[i:j])
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
            # 单双引号字符串：整体保留（含引号），\ 转义跳过；未闭合按行尾宽松收束
            j = i + 1
            while j < n and line[j] != ch:
                j += 2 if line[j] == "\\" else 1
            out.append(line[i:j + 1])
            i = j + 1
            continue
        if ch == "`":
            state["tmpl"] = True                    # 模板串开始（允许跨行）
            out.append(ch)
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out), state


def check_message_problems(targets):
    """检查项 5（消息侧）：全站跨帧消息字面量与监听注册双双收口。

    2026-11-17 消息收口改造后的守护，两族规则共用一套白名单：
    1) 协议指纹（arcade:* 七类型）单点定义于 arcade-common.js 的 MSG 表，发送/接收
       两侧一律引用 Arcade.MSG.*；生产代码裸写 'arcade:xxx' 字面量即报错——发/收
       两侧各自硬编码易在协议演进时静默漂移。
    2) message 监听一律经 Arcade.onTrustedMessage 统一来源守卫注册（守卫单点校验
       来源与目标窗口，跨源伪造报文静默丢弃）；裸 addEventListener('message') 即报
       错——绕过守卫的监听会把全站各窗口广播暴露给任意来源页面。
    白名单内文件另行处理：arcade-common.js 为守卫/注册表定义处；smoke/behavior
    测试装置以真实报文驱动黑盒验证，属刻意直写。

    参数:
        targets: scan_targets() 产出的 (name, raw, skel) 列表（本项用原文 raw 经
                 strip_comment_tails 剥注释保留字符串后逐行正则，行号与原文对齐）
    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for name, raw, _skel in targets:
        base = name.split("（", 1)[0]     # 剥「（内联脚本）」后缀取文件本名
        if base == "arcade-common.js" or base in RAW_ALLOW_FILES:
            continue                      # 守卫/注册表定义处 + tests 测试装置：放行
        state = {"block": False, "tmpl": False}
        for lineno, line in enumerate(raw.split("\n"), 1):
            kept, state = strip_comment_tails(line, state)
            if MSG_LIT_RE.search(kept):
                problems.append(f"{name}:L{lineno} 裸写消息类型字面量（应引用 Arcade.MSG 常量表）")
            if MSG_LISTEN_RE.search(kept):
                problems.append(f"{name}:L{lineno} 裸挂 message 监听（应经 Arcade.onTrustedMessage 统一来源守卫注册）")
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
      b. 出现 AudioContext 构造用法 → 同文件必须存在 webkitAudioContext 回退（注释提及不约束）

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


def check_ach_cat_problems():
    """检查项 11：成就定义 cat 完整性。

    成就墙锁定卡以「分类 · 尚未达成」展示（ach-common.js 渲染契约），成就条目缺
    cat 字段会在锁定态渲染出「undefined · 尚未达成」。本项做条目级断言：七游戏 js
    中 ACHIEVEMENTS 变量的数组体内，凡含 rarity: 的顶层 {...} 条目必须同时含 cat:。
    rarity 为成就条目专属锚字段，不依赖各游戏变量命名统一（ACHIEVEMENTS /
    SNAKE_ACHIEVEMENTS / KLOTSKI_ACHIEVEMENTS 并存）；数组体/条目均在去噪骨架上
    花括号深度配对切片，字符串字面量里的方括号/花括号不干扰配对。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    for _html_name, js_name in GAMES:
        path = ROOT / js_name
        if not path.exists():
            continue  # 文件缺失由检查项 6 报告，本项不重复
        skel = strip_js_code(path.read_text(encoding="utf-8"))
        for decl in ACH_DECL_RE.finditer(skel):
            # 数组体/条目切片复用检查项 13 辅助区的同技法函数（消除双份内联实现）
            body = _slice_array_body(skel, decl.end())
            if body is None:
                problems.append(f"{js_name} 成就数组未闭合: {decl.group(0)}")
                continue
            for entry in _split_top_objects(body):
                if ACH_ANCHOR_RE.search(entry) and not ACH_CAT_RE.search(entry):
                    problems.append(f"{js_name} 成就条目缺 cat 分类字段: {entry.strip()[:60]}")
    return problems


def check_entry_version_problems():
    """检查项 12：卡片入口版本一致——入口引用不得落后于同名业务 js。

    大厅卡片入口 href="X.html?v=V1" 与游戏页内业务脚本 src="X.js?v=V2" 的版本
    遵循「只升不降」不变量：入口落后于业务 js 视为同步遗漏（入口先命中旧 html
    缓存，与已更新的 js 版本脱节）。tools/bump-versions.py 已实现自动同步，本项
    兜底守护该不变量。版本按 (日期, 当日序号) 元组比较；入口领先合法不回退。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    index_text = (ROOT / "index.html").read_text(encoding="utf-8")
    for m in re.finditer(r'href="([\w./-]+\.html)\?v=([\w-]+)"', index_text):
        name, entry_v = m.group(1), m.group(2)
        page = ROOT / name
        js_path = page.with_suffix(".js")
        if not page.is_file() or not js_path.is_file():
            continue  # 入口与文件对应齐全性由检查项 6 把关
        # 文件名前只允许「"」或「/」结尾的路径段（(?:[\w./-]*/)? 非可选吞前缀会
        # 让 audio-1024.js 抢先匹配 1024.js 的版本搜索，误读分册版本）
        js_m = re.search(r'src="(?:[\w./-]*/)?' + re.escape(js_path.name) + r'\?v=([\w-]+)"',
                         page.read_text(encoding="utf-8"))
        if not js_m:
            continue  # 业务 js 引用带版本规范由检查项 2 把关
        ev, jv = VER_NUM_RE.fullmatch(entry_v), VER_NUM_RE.fullmatch(js_m.group(1))
        if ev and jv and (int(ev.group(1)), int(ev.group(2))) < (int(jv.group(1)), int(jv.group(2))):
            problems.append(
                f"index.html 入口 {name}?v={entry_v} 落后于 {js_path.name}?v={js_m.group(1)}"
                f"（重跑 tools/bump-versions.py 可自动同步）"
            )
    return problems


# ---------- 检查项 11/13 共用与第 13 项专属辅助：数组切片 + 大厅两表静态提取 ----------

def _strip_comments_keep_strings(raw):
    """整文剥注释保字符串：strip_comment_tails 的逐行状态机包装。

    参数:
        raw: js 全文
    返回:
        剥注释后的整文（字符串/模板串字面量内容保留，供字面量级正则提取）
    """
    state = {"block": False, "tmpl": False}
    return "\n".join(strip_comment_tails(line, state)[0] for line in raw.split("\n"))


def _slice_array_body(text, decl_end):
    """从数组声明结尾起方括号深度配对切片数组体（检查项 11/13 共用）。

    参数:
        text: 剥注释后的 js 文本
        decl_end: 声明 match.end()（'[' 之后的位置）
    返回:
        数组体文本（不含两端括号）；未闭合时 None
    """
    depth, i = 1, decl_end
    while i < len(text) and depth:
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
        i += 1
    return None if depth else text[decl_end:i - 1]


def _split_top_objects(body):
    """拆数组体内花括号深度 0→1→0 的顶层 {...} 条目（检查项 11/13 共用）。

    参数:
        body: 数组体文本
    返回:
        顶层条目文本列表（保持出现顺序）
    """
    entries, depth, bstart = [], 0, None
    for j, ch in enumerate(body):
        if ch == "{":
            if depth == 0:
                bstart = j
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and bstart is not None:
                entries.append(body[bstart:j + 1])
                bstart = None
    return entries


def _field_str(entry, field):
    """条目内提取 field: 'xxx' 形态的字符串字面量值（首个命中）。

    参数:
        entry: 顶层条目文本
        field: 字段名（如 id / key）
    返回:
        字段值字符串；缺失时 None
    """
    m = re.search(r"\b" + field + r"\s*:\s*['\"]([\w-]+)['\"]", entry)
    return m.group(1) if m else None


def _string_array(entry, field):
    """条目内提取 field: ['a', 'b', ...] 形态的字符串数组值。

    参数:
        entry: 顶层条目文本
        field: 字段名（BEST_DEFS 的 keys，元素全为简单字符串字面量）
    返回:
        字符串列表；字段缺失时空列表
    """
    m = re.search(r"\b" + field + r"\s*:\s*\[([^\]]*)\]", entry)
    return re.findall(r"['\"]([\w-]+)['\"]", m.group(1)) if m else []


def _photo_ids(entry):
    """成就殿堂条目内提取 photos 相片表各子数组首元素（成就 id 序列）。

    子数组五元组 [id, 名称, emoji, 稀有度, 描述] 的首元素即 id；
    从 photos: 起扫描避免条目内其它字段干扰。

    参数:
        entry: 顶层条目文本
    返回:
        成就 id 列表；条目缺 photos 字段时 None
    """
    m = re.search(r"\bphotos\s*:", entry)
    if not m:
        return None
    return re.findall(r"\[\s*['\"](\w+)['\"]\s*,", entry[m.start():])


def _diff_set(problems, left_label, left, right_label, right):
    """集合双向 diff 报错（顺序不敏感：大厅相片墙与游戏侧解锁表仅要求 id 对应），
    并对两侧序列做内部重复检测。

    参数:
        problems: 失败明细列表（原地追加）
        left_label: 左侧（大厅侧）报告标签
        left: 左侧 id 序列
        right_label: 右侧（游戏侧）报告标签
        right: 右侧 id 序列
    """
    ls, rs = set(left), set(right)
    for extra in sorted(ls - rs):
        problems.append(f"{left_label} 多出而 {right_label} 缺失: {extra}")
    for missing in sorted(rs - ls):
        problems.append(f"{right_label} 多出而 {left_label} 缺失: {missing}")
    if len(left) != len(set(left)):
        problems.append(f"{left_label} 存在重复 id")
    if len(right) != len(set(right)):
        problems.append(f"{right_label} 存在重复 id")


def _klotski_expected_keys(text, js_name, problems):
    """klotski 最高分键静态展开：DIFF_IDS × LAYOUTS 笛卡尔积 + 旧版布局键。

    klotski.js 的 bestKey 以 'klotskiBest_' + diffId + '_' + layoutId 模板拼键
    （另有旧版 'klotskiBest_' + layoutId），键名不存在字面量，须按难度与布局
    id 表展开成期望键集合再与大厅 keys 数组比对。

    参数:
        text: 剥注释后的 klotski.js 文本
        js_name: 报告用文件名
        problems: 失败明细列表（形态漂移类报错原地追加）
    返回:
        期望键集合（排序后列表）；形态超出静态解析预期时 None（已报错）
    """
    if KLOTSKI_KEY_PREFIX_LIT not in text:
        problems.append(f"{js_name} bestKey 拼键前缀 {KLOTSKI_KEY_PREFIX_LIT} 未找到"
                        f"（模板形态漂移，需同步本检查器）")
        return None
    diff_m = DIFF_IDS_DECL_RE.search(text)
    lay_m = LAYOUTS_DECL_RE.search(text)
    if not diff_m or not lay_m:
        problems.append(f"{js_name} 未找到 DIFF_IDS/LAYOUTS 声明（形态漂移，需同步本检查器）")
        return None
    lay_body = _slice_array_body(text, lay_m.end())
    if lay_body is None:
        problems.append(f"{js_name} LAYOUTS 数组未闭合")
        return None
    diffs = re.findall(r"['\"](\w+)['\"]", diff_m.group(1))
    layouts = [i for i in (_field_str(e, "id") for e in _split_top_objects(lay_body)) if i]
    if not diffs or not layouts:
        problems.append(f"{js_name} DIFF_IDS/LAYOUTS id 提取为空（形态漂移，需同步本检查器）")
        return None
    expected = {f"klotskiBest_{d}_{l}" for d in diffs for l in layouts}
    expected |= {f"klotskiBest_{l}" for l in layouts}  # 旧版（无难度维度）键：进阶档回读
    return sorted(expected)


def check_lobby_defs_problems():
    """检查项 13：大厅 ACH_DEFS/BEST_DEFS 与七游戏实际定义同步。

    大厅成就殿堂（ACH_DEFS：photos 相片表 id + 存档键 key）与卡片 BEST 角标
    （BEST_DEFS：各游戏最高分 localStorage 键）是游戏侧定义的镜像拷贝，游戏侧
    增删成就或改键后漏同步会静默劣化大厅展示（相片墙缺卡/多卡、BEST 角标
    NaN 或漏读）。本项做静态双向比对：①成就 id 集合（photos 首元素 ↔ 游戏侧
    ACHIEVEMENTS 条目 id，含两侧内部重复检测）；②存档键（游戏侧 arcade_ach_*
    字面量 ↔ 大厅 key 字段）；③最高分键（游戏侧 *HighScore/*BestScore 字面量
    ↔ 大厅 keys 数组；klotski 模板拼键按 DIFF_IDS × LAYOUTS 静态展开 18 新键
    + 6 旧版布局键核对）。

    返回:
        失败明细列表（空列表 = 通过）
    """
    problems = []
    index_path = ROOT / "index.js"
    if not index_path.exists():
        return problems  # 大厅脚本齐全性由检查项 6 把关，本项不重复
    index_text = _strip_comments_keep_strings(index_path.read_text(encoding="utf-8"))

    # ---- 大厅侧两表提取：BEST_DEFS id->键列表；ACH_DEFS id->(存档键, photos id 序列) ----
    best_decl = BEST_DEFS_DECL_RE.search(index_text)
    ach_decl = ACH_DEFS_DECL_RE.search(index_text)
    if not best_decl or not ach_decl:
        problems.append("index.js 未找到 BEST_DEFS/ACH_DEFS 声明（形态漂移，需同步本检查器）")
        return problems
    best_defs, ach_defs = {}, {}
    for entry in _split_top_objects(_slice_array_body(index_text, best_decl.end())):
        gid = _field_str(entry, "id")
        keys = _string_array(entry, "keys")
        if gid and keys:
            best_defs[gid] = keys
        else:
            problems.append(f"index.js BEST_DEFS 条目缺 id/keys 字段: {entry.strip()[:60]}")
    for entry in _split_top_objects(_slice_array_body(index_text, ach_decl.end())):
        gid = _field_str(entry, "id")
        if gid:
            ach_defs[gid] = (_field_str(entry, "key"), _photo_ids(entry))
        else:
            problems.append(f"index.js ACH_DEFS 条目缺 id 字段: {entry.strip()[:60]}")

    # ---- 逐游戏三段比对（id 集合 / 存档键 / 最高分键）----
    for _html, js_name in GAMES:
        path = ROOT / js_name
        if not path.exists():
            continue  # 文件缺失由检查项 6 报告，本项不重复
        text = _strip_comments_keep_strings(path.read_text(encoding="utf-8"))
        stem = path.stem  # 游戏 id：大厅两表键与 js 文件名同名约定

        # ① 成就 id 集合：游戏侧 ACHIEVEMENTS 条目 id 提取
        decl = ACH_DECL_RE.search(text)
        game_ids = None
        if not decl:
            problems.append(f"{js_name} 未找到 ACHIEVEMENTS 数组声明（形态漂移，需同步本检查器）")
        else:
            body = _slice_array_body(text, decl.end())
            if body is None:
                problems.append(f"{js_name} 成就数组未闭合")
            else:
                game_ids = [i for i in (_field_str(e, "id") for e in _split_top_objects(body)) if i]
                if not game_ids:
                    problems.append(f"{js_name} 成就数组条目 id 提取为空（形态漂移，需同步本检查器）")
                    game_ids = None
        hall = ach_defs.get(stem)
        if hall is None:
            problems.append(f"index.js ACH_DEFS 缺少 {stem} 条目（游戏侧成就表存在）")
        elif game_ids is not None:
            hall_key, photo_ids = hall
            if photo_ids is None:
                problems.append(f"index.js ACH_DEFS[{stem}] 缺 photos 相片表")
            else:
                _diff_set(problems, f"index.js ACH_DEFS[{stem}] photos", photo_ids,
                          f"{js_name} 成就表", game_ids)

            # ② 存档键：游戏侧 arcade_ach_* 字面量 ↔ 大厅 key 字段
            game_keys = set(ACH_KEY_LIT_RE.findall(text))
            if game_keys and hall_key:
                if game_keys != {hall_key}:
                    problems.append(f"{js_name} 存档键 {sorted(game_keys)} 与大厅 "
                                    f"ACH_DEFS[{stem}].key '{hall_key}' 不一致")
            elif not game_keys:
                problems.append(f"{js_name} 未找到 arcade_ach_* 存档键字面量")
            else:
                problems.append(f"index.js ACH_DEFS[{stem}] 缺 key 字段")

        # ③ 最高分键：游戏侧字面量 ↔ 大厅 keys 数组（klotski 静态展开）
        hall_keys = best_defs.get(stem)
        if hall_keys is None:
            problems.append(f"index.js BEST_DEFS 缺少 {stem} 条目（游戏侧最高分读写存在）")
            continue
        if stem == "klotski":
            expected = _klotski_expected_keys(text, js_name, problems)
            if expected is not None:
                _diff_set(problems, "index.js BEST_DEFS[klotski].keys", hall_keys,
                          f"{js_name} bestKey 展开键集", expected)
        else:
            game_lits = set(HIGH_SCORE_LIT_RE.findall(text))
            if not game_lits:
                problems.append(f"{js_name} 未找到 *HighScore/*BestScore 最高分键字面量")
            else:
                _diff_set(problems, f"index.js BEST_DEFS[{stem}].keys", hall_keys,
                          f"{js_name} 最高分键字面量", game_lits)
    return problems


# ---------- 检查项 14：smoke.html 白盒面契约 ----------
# S9~S15 七个 *Core 场景经 iframe.contentWindow 直调页内顶层函数断言核心逻辑
# （经典脚本顶层 function 声明自动挂 window）。业务 js 重命名/删除这些函数时
# 白盒断言要等冒烟运行期 TypeError 才变红——本项把「页内函数存在性」前移到静态期。
# 抽取范围限定七个场景函数体（S16~S21 的 win.* 属黑盒断言与装置用法，不收编）；
# rAF stub 赋值（win.requestAnimationFrame = ...）名称后无括号，调用正则天然不收。
SMOKE_PATH = ROOT / "tests" / "smoke.html"

# 白盒场景函数 → 对应业务 js 映射（场景函数重命名后须同步此表）
SMOKE_CORE_SCENES = [
    ("s9_tetrisCore", "tetris.js"),
    ("s10_pacCore", "pac.js"),
    ("s11_1024Core", "1024.js"),
    ("s12_pinballCore", "pinball.js"),
    ("s13_klotskiCore", "klotski.js"),
    ("s14_beeCore", "bee.js"),
    ("s15_snakeCore", "snake.js"),
]

# 契约引用收集：win.X( 直调 + typeof win.X 守卫（守卫同样依赖函数存在，一并收编）
SMOKE_WIN_CALL_RE = re.compile(r"\bwin\.(\w+)\s*\(")
SMOKE_WIN_TYPEOF_RE = re.compile(r"\btypeof\s+win\.(\w+)")

# window 内建方法豁免表：白盒场景以 win. 前缀直调的内建 API（非页内契约）
WIN_BUILTIN_EXEMPT = {"dispatchEvent"}

# 业务 js 顶层 function 声明（列 0 起始；嵌套/缩进声明不挂 window，不收编）
TOP_FUNC_DECL_RE = re.compile(r"(?m)^function\s+(\w+)\s*\(")


def _slice_brace_body(text, decl_end):
    """从声明 match.end() 起花括号深度配对切片函数体（检查项 14 专用）。

    与 _slice_array_body 同技法、作用对象为 {...}；输入须为去噪骨架
    （字符串/注释已剥离，内含花括号不干扰深度配对）。

    参数:
        text: 剥注释后的文本
        decl_end: 声明 match.end()（函数名后参数列表开括号之后的位置）
    返回:
        函数体文本（不含两端花括号）；找不到开括号或未闭合时 None
    """
    open_idx = text.find("{", decl_end)
    if open_idx < 0:
        return None
    depth, i = 0, open_idx
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i]
        i += 1
    return None


def check_smoke_whitebox_problems():
    """检查项 14：smoke.html 白盒面契约——S9~S15 直调/typeof 引用的页内函数
    须在对应业务 js 中以顶层 function 声明存在。

    抽取 smoke.html 内联 <script> 块的去噪骨架，逐白盒场景切函数体收集契约引用
    （win.X( 直调 + typeof win.X 守卫，window 内建豁免表扣除），逐名到对应业务 js
    骨架核对顶层函数声明；缺失即报——防业务 js 重命名/删除这些函数后白盒断言
    运行期才暴露。

    返回:
        问题清单（空列表 = 通过）
    """
    problems = []
    if not SMOKE_PATH.is_file():
        return ["tests/smoke.html 缺失（白盒契约检查无目标）"]
    # 仅取内联 <script> 块：外链 src 引用与 <style> 的 CSS 花括号不参与切片；
    # 按解析语义 </script> 不可能出现在内联脚本字符串里，首个闭标签即真实边界
    chunks = [m.group(1) for m in
              re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
                          SMOKE_PATH.read_text(encoding="utf-8"), re.S | re.I)]
    smoke_skel = strip_js_code("\n".join(chunks))
    js_skels = {}
    for scene, js_name in SMOKE_CORE_SCENES:
        decl = re.search(r"\bfunction\s+" + re.escape(scene) + r"\s*\(", smoke_skel)
        if not decl:
            problems.append(f"smoke.html 未找到白盒场景 {scene}（场景重命名后须同步 SMOKE_CORE_SCENES 映射表）")
            continue
        body = _slice_brace_body(smoke_skel, decl.end())
        if body is None:
            problems.append(f"smoke.html {scene} 函数体未闭合（骨架切片失败）")
            continue
        used = set(SMOKE_WIN_CALL_RE.findall(body)) | set(SMOKE_WIN_TYPEOF_RE.findall(body))
        used -= WIN_BUILTIN_EXEMPT
        if js_name not in js_skels:
            path = ROOT / js_name
            js_skels[js_name] = strip_js_code(path.read_text(encoding="utf-8")) if path.is_file() else ""
        declared = set(TOP_FUNC_DECL_RE.findall(js_skels[js_name]))
        for name in sorted(used - declared):
            problems.append(
                f"smoke.html {scene} 引用 win.{name}，但 {js_name} 未声明顶层函数 {name}（白盒契约破裂）")
    return problems


# ---------- 检查项 15：fullscreen.js 全屏选择器契约 ----------
# fullscreen.js 顶部 FIT_SELECTORS / TITLE_SELECTORS 两数组声明「全屏缩放容器」
# 与「全屏标题」的候选选择器，运行期逐个 querySelector 取首个命中——页面 markup
# 重构删容器/改类名后运行期会静默失配（全屏缩放与标题展示退化且无任何报错）。
# 本项把契约校验前移到静态期：解析两数组字面量，对大厅 + 七游戏页逐一断言
# 至少一条候选可命中，选择器数组与页面 markup 任一侧漂移即红。
FS_PATH = ROOT / "fullscreen.js"

# 数组字面量声明锚：const NAME = [ ... ]（一维字符串数组，取首个匹配即可）
FS_FIT_DECL_RE = re.compile(r"\bconst\s+FIT_SELECTORS\s*=\s*\[([^\]]*)\]")
FS_TITLE_DECL_RE = re.compile(r"\bconst\s+TITLE_SELECTORS\s*=\s*\[([^\]]*)\]")

# 数组元素字符串字面量提取：须保留字符串内容故直接在原文匹配
# （去噪骨架会剥掉字面量内容，与检查项 13 同技法）
FS_STR_LIT_RE = re.compile(r"""['"]([^'"]+)['"]""")

# 选择器命中判定的 markup 锚：class/id 属性值。负向断言排除 data-class/
# grid-id 等属性名尾串误命中（属性名本身词边界起匹配）
FS_CLASS_ATTR_RE = re.compile(r"""(?<![\w-])class\s*=\s*["']([^"']*)["']""")
FS_ID_ATTR_RE = re.compile(r"""(?<![\w-])id\s*=\s*["']([^"']*)["']""")


def _fs_selector_hits(html_text, selector):
    """静态判定单条全屏选择器能否命中页面源码（覆盖 fullscreen.js 契约面三形态）。

    形态与 fullscreen.js 实际用法对齐：
      .cls    —— 任一元素 class 词表含该类名即命中
      #id     —— 任一元素 id 属性值与选择器名完全相等即命中
      tag.cls —— 限定标签名的开标签内核对 class 词表（如 h1.title）

    参数:
        html_text: 页面 HTML 全文
        selector: FIT/TITLE 数组中的单条选择器
    返回:
        True = 可命中；复合选择器/伪类等超出静态判定范围的形态保守放行
        返回 True 不误报（检查器不比运行期更严）
    """
    if selector.startswith("."):
        cls = selector[1:]
        return any(cls in attrs.split() for attrs in FS_CLASS_ATTR_RE.findall(html_text))
    if selector.startswith("#"):
        ident = selector[1:]
        return any(ident == attrs for attrs in FS_ID_ATTR_RE.findall(html_text))
    m = re.match(r"^(\w+)\.([\w-]+)$", selector)
    if m:
        tag, cls = m.groups()
        # 逐开标签核对：标签名限定 + 其 class 属性词表包含目标类名
        for tag_text in re.findall(r"<" + tag + r"\b[^>]*>", html_text, re.IGNORECASE):
            cm = FS_CLASS_ATTR_RE.search(tag_text)
            if cm and cls in cm.group(1).split():
                return True
        return False
    return True


def check_fs_selectors_problems():
    """检查项 15：fullscreen.js 全屏选择器契约——FIT/TITLE 两组候选选择器
    在大厅 + 七游戏页 markup 中至少各有一条可静态命中。

    从 fullscreen.js 源码解析 FIT_SELECTORS / TITLE_SELECTORS 数组字面量，
    对 index.html 与 GAMES 七页逐一断言：fit 组至少一条命中（存在可缩放容器）、
    title 组至少一条命中（存在全屏标题）。页面删容器/改类名或选择器数组被
    改坏时即报，防止运行期静默失配。

    返回:
        问题清单（空列表 = 通过）
    """
    problems = []
    if not FS_PATH.is_file():
        return ["fullscreen.js 缺失（全屏选择器契约检查无目标）"]
    src = FS_PATH.read_text(encoding="utf-8")
    groups = {}
    for name, decl_re in (("FIT_SELECTORS", FS_FIT_DECL_RE), ("TITLE_SELECTORS", FS_TITLE_DECL_RE)):
        m = decl_re.search(src)
        if not m:
            problems.append(f"fullscreen.js 未找到 {name} 数组声明（形态漂移，需同步本检查器）")
            groups[name] = []
            continue
        selectors = FS_STR_LIT_RE.findall(m.group(1))
        if not selectors:
            problems.append(f"fullscreen.js {name} 数组为空（全屏契约失去全部候选）")
        groups[name] = selectors
    pages = ["index.html"] + [html for html, _js in GAMES]
    for page in pages:
        path = ROOT / page
        if not path.is_file():
            continue  # 页面缺失由检查项 1/6 报告，本项不重复
        html_text = path.read_text(encoding="utf-8")
        for name, selectors in groups.items():
            if selectors and not any(_fs_selector_hits(html_text, s) for s in selectors):
                problems.append(f"{page} 无任何 {name} 候选命中（候选: {selectors}）"
                                "——全屏缩放/标题契约破裂")
    return problems


# ---------- 检查项 16：难度数值校验 ----------
# 设计需求文档沉淀的难度数值（初始降速/得分链/Boss 血量/评级门槛等）是玩家
# 直接感知的调参结果，游戏 js 中的具名常量与数值被误改后无任何报错。本项按
# 「文档锚正则提取数值 → 词边界断言存在于对应游戏 js 原文 + 具名常量存在」
# 的既有字面量模式校验，防数值漂移与常量重命名。
# 稳健性：任一锚在文档中未命中即记「跳过」不计失败——文档表格改版（换措辞/
# 换列序）时本项自动降级为提示，锚同步后再恢复断言，避免文档格式变化误报。
DOC_PATH = ROOT / "docs" / "设计需求文档.md"

# 每条 spec：(游戏 js 名, [(锚正则, 锚用途说明), ...], [具名常量词边界正则, ...])
# 数值提取：捕获组优先；无捕获组时提取匹配段内全部数字 token。纯一位数字
# 过滤不参与断言（词边界下易误中、断言价值为零）
DIFF_DOC_SPECS = [
    ("snake.js", [
        (r"\|\s*(?:简单|中等|困难)\s*\|\s*(\d+)\s*ms", "三档初始降速"),
        (r"\b0\.93\b", "进食提速倍率"),
    ], [r"\bSPEED_FACTOR\b", r"\bSPEED_MIN\b", r"\bbaseSpeed\b"]),
    ("tetris.js", [
        (r"消\s*\d[^|\n]*\|\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)", "消行得分链"),
        (r"锁定延迟[^|\n]*\|\s*落地后\s*(\d+)\s*ms[^|\n]*?最多推迟\s*(\d+)\s*次", "锁定延迟与推迟上限"),
    ], [r"\bLINE_SCORES\b", r"\bLOCK_DELAY\b", r"\bDAS_DELAY\b", r"\bARR_INTERVAL\b"]),
    ("pac.js", [
        (r"400\s*/\s*800\s*/\s*1600", "幽灵连杀得分链"),
        (r"奖励命\s*\|\s*每累计\s*(\d{4,})\s*分", "奖励命门槛"),
    ], [r"\bONE_UP_SCORE\b"]),
    ("bee.js", [
        (r"Boss 血量[^|\n]*\|\s*(\d{2,})\s*\+\s*(\d+)\s*[×x]", "Boss 血量基线与每波增量"),
        (r"Boss 击破奖励[^|\n]*\|\s*(\d{3,})\s*\+\s*(\d+)", "击破奖励基线与每波增量"),
    ], [r"\bBOSS_BASE_HP\b", r"\bBOSS_HP_PER_WAVE\b", r"\bBOSS_BONUS\b", r"\bPOWERUP_DROP_CHANCE\b"]),
    ("pinball.js", [
        (r"弹柱[^|\n]*\|\s*(\d+)", "弹柱得分"),
        (r"JACKPOT[^|\n]*\|\s*(\d{3,})", "JACKPOT 大奖"),
        (r"按住蓄力（至多\s*(\d+(?:\.\d+)?)\s*秒", "弹射器蓄力时长"),
    ], [r"\bJACKPOT_SCORE\b", r"\bCHARGE_TIME\b"]),
    ("klotski.js", [
        (r"\b1\.15\b", "S 评级步数比门槛"),
        (r"\b1\.4\b", "A 评级步数比门槛"),
        (r"\b1\.8\b", "B 评级步数比门槛"),
    ], [r"\bRANK_TIERS\b"]),
    ("1024.js", [
        (r"\|\s*(?:简单|普通|困难)\s*\|\s*(\d)\s*[×x]\s*(\d)\s*\|\s*(\d)\s*次", "三档棋盘与撤销次数"),
    ], [r"\bUNDO_LIMITS\b"]),
]

_NUM_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?")


def check_diff_values_problems():
    """难度数值校验：文档提取数值逐个在游戏 js 原文断言存在，具名常量防重命名

    锚未命中记跳过（不计失败）；锚命中但数值/常量在 js 中缺失即报。
    文档文件本身缺失视为真缺口报红。

    返回:
        问题清单（空列表 = 通过）
    """
    problems = []
    skipped = []
    if not DOC_PATH.is_file():
        return [f"docs/设计需求文档.md 缺失（难度数值校验无数据源）"]
    doc = DOC_PATH.read_text(encoding="utf-8")
    for js_name, anchors, consts in DIFF_DOC_SPECS:
        path = ROOT / js_name
        if not path.is_file():
            problems.append(f"{js_name} 缺失（难度数值无处断言）")
            continue
        js = path.read_text(encoding="utf-8")
        # 具名常量断言：与数值解耦，常量缺失独立报（锚跳过不影响此断言）
        for c in consts:
            if not re.search(c, js):
                problems.append(f"{js_name} 未找到具名常量 {c.strip(chr(92) + chr(98))}（被重命名/删除即难度接线失守）")
        nums = []
        for pattern, purpose in anchors:
            m = re.search(pattern, doc)
            if not m:
                skipped.append(f"{js_name}：{purpose} 锚未命中（文档格式可能已变化，明确跳过不误报）")
                continue
            groups = m.groups()
            if groups:
                nums.extend(g for g in groups if g)
            else:
                nums.extend(_NUM_TOKEN_RE.findall(m.group(0)))
        # 一位纯数字过滤后逐个词边界断言（0.93/1.15 等小数与多位整数参与）
        for n in nums:
            if re.fullmatch(r"\d", n):
                continue
            if not re.search(r"(?<![\w.])" + re.escape(n) + r"(?![\w.])", js):
                problems.append(f"{js_name} 未找到文档数值 {n}（难度数值与设计文档漂移）")
    # 跳过仅提示不走 problems：文档改版属正常演进，人工按需同步锚
    if skipped:
        print("       [skip] " + "; ".join(skipped))
    return problems


# ---------- 检查项 17：演出要素存在性 ----------
# CRT 全屏切换 / 开关机音 / reduced-motion 演出禁用属「演出类」功能，视觉效果
# 无法静态验证，但接线与元素存在性可以。本项抓三面存在性：
# a) 大厅 + 七游戏页均有 #fullscreenToggle 切换元素（fullscreen.js 接线目标）；
# b) 共享库探测/门控口：arcade-common.js 探测口、fx.js 演出禁用门控、
#    fullscreen.js CRT 开关机音接线口；
# c) CRT 开关机音实际接线页：index.js（大厅）与 bee.js/1024.js（独立打开时
#    自行接线）——按当前实际代码结构断言，不要求全部游戏页一致。
STAGE_HTML_SPECS = ["index.html", "snake.html", "tetris.html", "pac.html",
                    "bee.html", "pinball.html", "klotski.html", "1024.html"]
STAGE_HTML_ANCHOR = re.compile(r"""\bid\s*=\s*["']fullscreenToggle["']""")
STAGE_JS_SPECS = [
    ("arcade-common.js", r"\bprefersReducedMotion\b", "reduced-motion 探测口"),
    ("fx.js", r"\bprefersReduced\b", "演出类效果禁用门控"),
    ("fullscreen.js", r"\bonCrtAudio\b", "CRT 开关机音接线口"),
    ("index.js", r"\bSFX\.crtOn\b", "大厅 CRT 开机音接线"),
    ("bee.js", r"\bFS\.onCrtAudio\b", "bee 独立打开时 CRT 音接线"),
    ("1024.js", r"\bFS\.onCrtAudio\b", "1024 独立打开时 CRT 音接线"),
]


def check_stage_presence_problems():
    """演出要素存在性：全屏切换元素、演出禁用路径、CRT 音接线逐面断言存在

    返回:
        问题清单（空列表 = 通过）
    """
    problems = []
    for page in STAGE_HTML_SPECS:
        path = ROOT / page
        if path.is_file() and not STAGE_HTML_ANCHOR.search(path.read_text(encoding="utf-8")):
            problems.append(f"{page} 缺少 id=\"fullscreenToggle\" 全屏/CRT 切换元素（演出接线目标缺失）")
    for js_name, anchor, purpose in STAGE_JS_SPECS:
        path = ROOT / js_name
        if path.is_file() and not re.search(anchor, path.read_text(encoding="utf-8")):
            problems.append(f"{js_name} 缺少 {purpose}（{anchor.strip(chr(92) + chr(98))}）——演出接线断裂")
    return problems


def main():
    """主流程：依次运行十七项检查，汇总结果并按退出码约定返回。"""
    targets = scan_targets()  # 每文件只读一次/去噪一次：第 4/5/8 项共用同一份目标
    checks = [
        ("引用完整性", check_refs_problems),
        ("缓存指纹(?v=)", check_version_problems),
        ("公共库加载序", check_lib_order_problems),
        ("危险模式扫描", lambda: check_dangerous_problems(targets)),
        ("存储/消息收口", lambda: check_storage_problems(targets) + check_message_problems(targets)),
        ("游戏入口完整", check_games_problems),
        ("兼容性前缀", check_compat_problems),
        ("风格红线", lambda: check_style_problems(targets)),
        ("分享包一致", check_packages_problems),
        ("去噪自检", check_doctest_problems),
        ("成就cat完整", check_ach_cat_problems),
        ("入口版本一致", check_entry_version_problems),
        ("大厅成就/最高分同步", check_lobby_defs_problems),
        ("冒烟白盒契约", check_smoke_whitebox_problems),
        ("全屏选择器契约", check_fs_selectors_problems),
        ("难度数值校验", check_diff_values_problems),
        ("演出要素存在性", check_stage_presence_problems),
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
