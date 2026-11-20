#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「十七项」计数口径单元测试（tests/test_counter_text.py）

零依赖标准库 unittest：锁定 2026-11-20 文案修正批的 6 处修复点——
server.py（docstring + 注释）、tests/smoke.html（头部注释）、tools/verify_all.py
（docstring + 步骤注释 + 步骤标题字符串）的检查项计数口径为「十七项」，
并对全仓库源文件做旧计数「十五项」裸写反断言。

豁免规则：中文引号「十五项」完整引用形式为修改记录里的历史记载（描述当时
修复内容本身），不属计数滞后声明，扫描时豁免；其余裸写一律报红。

防回归目标：后续把锚定句改回旧值、或新增文件引入旧口径时，本测试即红。

运行（项目根目录或任意目录均可）：
    python tests/test_counter_text.py -v

退出码：0 = 全部通过；非 0 = 存在失败项。
"""
import re
import unittest
from pathlib import Path

# 路径基准：仓库根 = 本脚本目录的上一级（与 tests/check.py 同款）
ROOT = Path(__file__).resolve().parent.parent

# 6 处修复点的正向锚定句（子串在各自文件内出现即认定口径正确）
EXPECTED_ANCHORS = {
    "server.py": [
        "起服即检十七项站点约定",  # run_startup_check docstring
        "静态一致性检查（十七项，检查项明细见",  # __main__ 起服前注释
    ],
    "tests/smoke.html": [
        "重建分享包 → 十七项静态检查",  # 头部注释 verify_all 链句
    ],
    "tools/verify_all.py": [
        "tests/check.py（十七项检查全绿）",  # 模块 docstring 五步流水说明
        "# 第 2 步：静态十七项检查",  # main 内步骤注释
        "静态一致性检查（十七项）",  # main 内步骤标题字符串（运行时打印）
    ],
}

# 旧计数裸写模式：负向断言排除中文引号包裹的「十五项」完整引用（历史记载豁免）
STALE_PATTERN = re.compile(r"(?<!「)十五项(?!」)")

# 反断言扫描的源文件类型（含 md 文档；分享包目录随源文件判定，跳过避免重复）
SCAN_GLOBS = ("*.py", "*.js", "*.html", "*.md")
SKIP_DIRS = {".trae-html-share-packages", ".git"}
# 测试装置自身：模式定义行含「十五项」字面量，属刻意直写，豁免
SKIP_FILES = {"tests/test_counter_text.py"}


def iter_repo_sources():
    """按类型遍历仓库源文件（跳过分享包等快照目录）。

    返回:
        产出 (相对路径字符串, 全文) 的迭代器；非 UTF-8 文件静默跳过
    """
    for pattern in SCAN_GLOBS:
        for path in ROOT.rglob(pattern):
            rel_posix = path.relative_to(ROOT).as_posix()
            # 任一中间目录命中跳过清单即略过该文件
            if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts[:-1]):
                continue
            # 装置白名单：本测试自身含模式字面量，跳过
            if rel_posix in SKIP_FILES:
                continue
            try:
                yield rel_posix, path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue


class CounterTextTest(unittest.TestCase):
    """「十七项」计数口径守护测试。"""

    def test_anchors_carry_new_counter(self):
        """6 处修复点锚定句全部携带新口径「十七项」。"""
        for rel, anchors in EXPECTED_ANCHORS.items():
            text = (ROOT / rel).read_text(encoding="utf-8")
            for anchor in anchors:
                with self.subTest(file=rel, anchor=anchor):
                    self.assertIn(
                        anchor, text,
                        f"{rel} 缺少锚定句（计数口径可能被改回旧值）: {anchor}")

    def test_fixed_files_have_no_stale_counter(self):
        """6 处修复点所在文件全文不含旧计数「十五项」裸写。"""
        for rel in EXPECTED_ANCHORS:
            text = (ROOT / rel).read_text(encoding="utf-8")
            hit = STALE_PATTERN.search(text)
            self.assertIsNone(
                hit,
                f"{rel} 出现旧计数裸写「十五项」（偏移 {hit.start() if hit else -1}）")

    def test_repo_has_no_stale_counter(self):
        """全仓库源文件无旧计数「十五项」裸写（「十五项」引用形式豁免）。"""
        problems = []
        for rel, text in iter_repo_sources():
            # 逐行扫描报行号，便于直接定位残留位置
            for i, line in enumerate(text.splitlines(), 1):
                if STALE_PATTERN.search(line):
                    problems.append(f"{rel}:{i} 裸写旧计数「十五项」: {line.strip()[:60]}")
        self.assertEqual(problems, [], "\n".join(problems))


if __name__ == "__main__":
    unittest.main(verbosity=2)
