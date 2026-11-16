#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动版本号脚本：扫描 html 中的 <script src="xxx.js?v=YYYYMMDD-N"> 引用，
对比 js 文件内容 hash 与上次记录（tools/.js-versions.json），
不一致则自动改写所有 html 中该 js 的版本号（消除手动 bump 的遗漏风险）。

版本号规则：YYYYMMDD-N；当日已有版本则 N 递增，跨日则重置为 1。

用法：
    python tools/bump-versions.py          # 检测变更并 bump
    python tools/bump-versions.py --seed   # 首次运行/重置基线：仅记录当前 hash，不 bump
"""
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / '.js-versions.json'
REF_RE = re.compile(rb'([\w./-]+\.js)\?v=([\w-]+)')


def sha1(path):
    """计算文件内容的 SHA1，作为变更检测指纹"""
    return hashlib.sha1(path.read_bytes()).hexdigest()


def collect_htmls():
    """收集根目录与 tests/ 下全部 html 文件"""
    htmls = sorted(ROOT.glob('*.html'))
    tests = ROOT / 'tests'
    if tests.is_dir():
        htmls += sorted(tests.glob('*.html'))
    return htmls


def main():
    # Windows 控制台可能为 GBK，统一为 UTF-8 输出避免中文打印崩溃
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

    seed = '--seed' in sys.argv
    htmls = collect_htmls()
    if not htmls:
        print('未找到任何 html 文件')
        return 1

    # 扫描全部引用：{js 文件名: 当前版本号}（同一 js 多处引用取首个版本号，bump 时全文替换）
    refs = {}       # {js 引用名: 版本号}
    ref_owner = {}  # {js 引用名: 首次引用它的 html 所在目录}，相对路径按此解析
    html_bytes = {}   # 内存中的最新内容
    html_orig = {}    # 磁盘原始内容，用于写回时判断是否有变化
    for html in htmls:
        data = html.read_bytes()
        html_bytes[html] = data
        html_orig[html] = data
        for name, ver in REF_RE.findall(data):
            key = name.decode('utf-8')
            if key not in refs:
                refs[key] = ver.decode('utf-8')
                ref_owner[key] = html.parent

    cache = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text(encoding='utf-8'))

    # 同一物理文件可能以不同相对路径被引用（根页 fx.js 与 tests 页 ../fx.js）：
    # 按解析后的绝对路径去重，仅保留首个引用名参与比对；其余引用因共享 ?v= 子串会被一并替换
    seen_paths = {}
    for name in refs:
        seen_paths.setdefault((ref_owner[name] / name).resolve(), name)
    process = {n for n in refs if seen_paths[(ref_owner[n] / n).resolve()] == n}

    today = date.today().strftime('%Y%m%d')
    bumped, seeded, missing = [], [], []

    for name in sorted(process):
        path = ref_owner[name] / name
        if not path.is_file():
            missing.append(name)
            continue
        h = sha1(path)
        old = cache.get(name)
        if old is None or seed:
            # 新引用或 seed 模式：仅建档/刷新基线，不 bump
            cache[name] = h
            if old != h:
                seeded.append(name)
            continue
        if old == h:
            continue  # 内容未变

        # 内容有变：计算新版本号（当日递增 N，跨日重置为 1）
        old_v = refs[name]
        if old_v.startswith(today + '-'):
            try:
                n = int(old_v.rsplit('-', 1)[1]) + 1
            except ValueError:
                n = 1
        else:
            n = 1
        new_v = '%s-%d' % (today, n)

        # 全量替换所有 html 中的引用（按字节操作，避免换行符被改写）
        old_ref = ('%s?v=%s' % (name, old_v)).encode('utf-8')
        new_ref = ('%s?v=%s' % (name, new_v)).encode('utf-8')
        count = 0
        for html, data in html_bytes.items():
            if old_ref in data:
                html_bytes[html] = data.replace(old_ref, new_ref)
                count += 1
        cache[name] = h
        bumped.append('%s  %s -> %s （%d 个 html）' % (name, old_v, new_v, count))

    # 写回 html（仅写入内容有变化的文件，按字节写避免换行符被改写）
    for html, data in html_bytes.items():
        if data != html_orig[html]:
            html.write_bytes(data)

    CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding='utf-8')

    if seeded:
        print('基线建档 %d 个：' % len(seeded))
        for n in seeded:
            print('  + ' + n)
    if bumped:
        print('版本号已更新 %d 个：' % len(bumped))
        for line in bumped:
            print('  * ' + line)
    if not seeded and not bumped:
        print('无变更，所有版本号均为最新')
    if missing:
        print('警告：以下 js 文件缺失：%s' % ', '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
