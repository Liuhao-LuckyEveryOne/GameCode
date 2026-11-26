#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动版本号脚本：扫描 html 中的 <script src="xxx.js?v=YYYYMMDD-N"> 引用，
对比 js 文件内容 hash 与上次记录（tools/.js-versions.json），
不一致则自动改写所有 html 中该 js 的版本号（消除手动 bump 的遗漏风险）。

版本号规则：YYYYMMDD-N；当日已有版本则 N 递增，跨日则重置为 1。

卡片入口同步规则：大厅 index.html 的卡片入口引用形如 <a href="snake.html?v=...">，
其版本不得落后于同目录同名业务 js（snake.js）的当前版本——js 因内容变更 bump 后，
入口引用自动升至 js 同值；入口领先（如 html 本体单独变更后）合法不回退（只升不降）。
同步基于当前引用而非 hash 基线，seed 模式下同样执行（可修复历史遗留的落后入口）。

用法：
    python tools/bump-versions.py          # 检测变更并 bump
    python tools/bump-versions.py --seed   # 首次运行/重置基线：仅记录当前 hash，不 bump
    python tools/bump-versions.py --check  # 门禁校验：只检测不改写（存在待 bump js、
                                           # 待同步入口或缺失 js 即退出码 1），供 CI/verify_all 使用
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
ENTRY_RE = re.compile(rb'([\w./-]+\.html)\?v=([\w-]+)')
COMMENT_RE = re.compile(rb'<!--.*?-->', re.S)  # HTML 注释区间：其中的示例引用不参与替换


def parse_ver(v):
    """把 YYYYMMDD-N 版本号解析为可比较的元组；不可解析返回 None（调用方须跳过不强升，防覆盖手写版本）"""
    m = re.match(r'(\d{8})-(\d+)$', v)
    return (int(m.group(1)), int(m.group(2))) if m else None


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
    check = '--check' in sys.argv
    htmls = collect_htmls()
    if not htmls:
        print('未找到任何 html 文件')
        return 1

    # 扫描全部引用：{js 文件名: 当前版本号}（同一 js 多处引用取首个版本号，bump 时全文替换）
    refs = {}       # {js 引用名: 版本号}
    ref_owner = {}  # {js 引用名: 首次引用它的 html 所在目录}，相对路径按此解析
    all_vs = {}     # {js 解析后绝对路径: [各处引用版本号]}，bump 基准取最大值防版本漂移
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
            all_vs.setdefault((html.parent / key).resolve(), []).append(ver.decode('utf-8'))

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

    # js 物理路径 -> 当前最新版本号（初始化取各处引用的最大可解析版本，bump 后同步更新；
    # 卡片入口同步以此为准，保证入口对齐到 js bump 之后的最新版本。
    # 多页引用版本漂移时取最大值，避免入口同步以偏旧的"最后引用"为基准造成进一步分裂）
    cur_v = {}
    for vpath, vlist in all_vs.items():
        best = None
        for v in vlist:
            pv = parse_ver(v)
            if pv is not None and (best is None or pv > best[0]):
                best = (pv, v)
        cur_v[vpath] = best[1] if best else vlist[0]

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

        # 内容有变：计算新版本号（当日递增 N，跨日重置为 1）。
        # bump 基准取该 js 全部引用中可解析的最大版本：同一 js 多页引用版本漂移时，
        # 保证新版本不低于任一已有引用，避免只升部分页面、漂移被固化
        old_v = refs[name]
        top = None
        for v in all_vs.get(path.resolve(), []):
            pv = parse_ver(v)
            if pv is not None and (top is None or pv > top):
                top = pv
        if top is not None and top[0] == int(today):
            n = top[1] + 1
        else:
            n = 1
        new_v = '%s-%d' % (today, n)

        # 全量替换所有 html 中的引用（按字节操作，避免换行符被改写）：对每个引用
        # 独立解析版本，凡低于新版本的统一升到新版本——不再依赖首引用逐字匹配，
        # 避免同 js 多页引用版本不一致时仅精确匹配旧值的页面被更新而残留旧版
        new_ver = parse_ver(new_v)
        js_abs = path.resolve()
        count = 0
        manual = []
        for html, data in html_bytes.items():
            hits = []
            # 注释区间按当前数据现算：前序 bump 可能已改变本页字节长度，坐标必须对齐现值
            spans = [m.span() for m in COMMENT_RE.finditer(data)]

            def upgrade(m, owner=html.parent, hits=hits, spans=spans):
                if any(s <= m.start() < e for s, e in spans):
                    return m.group(0)  # HTML 注释中的示例引用不参与替换
                rname, rver = m.group(1).decode('utf-8'), m.group(2).decode('utf-8')
                if (owner / rname).resolve() != js_abs:
                    return m.group(0)  # 其它 js 的引用不动
                r_parsed = parse_ver(rver)
                if r_parsed is None:
                    # 手写非标版本（非 YYYYMMDD-N）：不覆盖，收集后统一提示
                    manual.append('%s（%s?v=%s）' % (html.relative_to(ROOT), rname, rver))
                    return m.group(0)
                if r_parsed < new_ver:
                    hits.append(1)
                    return ('%s?v=%s' % (rname, new_v)).encode('utf-8')
                return m.group(0)

            upgraded = REF_RE.sub(upgrade, data)
            if hits:
                html_bytes[html] = upgraded
                count += 1
        if not check:
            cache[name] = h  # --check 门禁模式不刷新基线（保持基线只读）
        bumped.append('%s  %s -> %s （%d 个 html）' % (name, old_v, new_v, count))
        if manual:
            print('提示：%s 存在手写非标版本引用，未自动覆盖：%s' % (name, '、'.join(manual)))
        cur_v[js_abs] = new_v

    # ---------- 卡片入口同步：入口 html 引用版本不得落后于同名业务 js ----------
    # 扫描全部 html 中的 X.html?v= 入口引用（如大厅卡片 <a href="snake.html?v=...">），
    # 同一入口多路径引用按解析后路径去重；仅当入口页存在且同目录同名 stem.js 有版本
    # 记录时参与同步——与上方 js 引用升级同法：对每处引用独立解析版本，凡低于 js
    # 当前版本的统一升到同值，入口持平或领先合法不回退（只升不降），
    # 不再依赖首引用逐字匹配；手写非标版本不覆盖，由 check.py 检查项 12 报红兜底
    entry_seen = {}     # {入口 html 解析后绝对路径: (引用名, 首次引用它的 html 所在目录)}
    for html, data in html_bytes.items():
        for ename, _ver in ENTRY_RE.findall(data):
            key = ename.decode('utf-8')
            entry_seen.setdefault((html.parent / key).resolve(), (key, html.parent))

    entry_synced = []
    for epath, (ename, owner) in entry_seen.items():
        page = owner / ename
        jsname = page.stem + '.js'
        js_key = (owner / jsname).resolve()
        if not page.is_file() or js_key not in cur_v:
            continue  # 非卡片入口形态（同名业务 js 不存在）或该 js 无版本记录，跳过
        js_v = cur_v[js_key]
        jv = parse_ver(js_v)
        if jv is None:
            continue  # js 侧版本非标（理论不可能，防御跳过）
        new_ref = ('%s?v=%s' % (ename, js_v)).encode('utf-8')
        manual = []
        count = 0
        for html, data in html_bytes.items():
            hits = []
            spans = [m.span() for m in COMMENT_RE.finditer(data)]  # 注释区间现算，坐标对齐当前数据

            def upgrade_entry(m, epath=epath, owner=html.parent, hits=hits, spans=spans):
                if any(s <= m.start() < e for s, e in spans):
                    return m.group(0)  # HTML 注释中的示例引用不参与替换
                rname, rver = m.group(1).decode('utf-8'), m.group(2).decode('utf-8')
                if (owner / rname).resolve() != epath:
                    return m.group(0)  # 其它入口的引用不动
                ev = parse_ver(rver)
                if ev is None:
                    # 手写非标版本（非 YYYYMMDD-N）：不覆盖，收集后统一提示
                    manual.append('%s（%s?v=%s）' % (html.relative_to(ROOT), rname, rver))
                    return m.group(0)
                if ev < jv:
                    hits.append(1)
                    return new_ref
                return m.group(0)

            upgraded = ENTRY_RE.sub(upgrade_entry, data)
            if hits:
                html_bytes[html] = upgraded
                count += 1
        if count:
            entry_synced.append('%s -> %s （对齐 %s，%d 个 html）' % (ename, js_v, jsname, count))
        if manual:
            print('提示：入口 %s 存在手写非标版本引用，未自动覆盖：%s' % (ename, '、'.join(manual)))

    # --check 门禁：只校验不写盘不改基线，凡存在缺失 js 或待改写项（js bump / 入口同步）即失败退出
    if check:
        if missing:
            print('校验失败：%d 个 js 文件缺失（核对引用或恢复文件）：%s' % (len(missing), ', '.join(missing)))
            for name in missing:
                print('  ! 缺失 ' + name)
            return 1
        if bumped or entry_synced:
            print('校验失败：%d 个 js 待 bump、%d 处入口待同步（运行 python tools/bump-versions.py 修复）' % (len(bumped), len(entry_synced)))
            for line in bumped + entry_synced:
                print('  ! ' + line)
            return 1
        if seeded:
            print('提示：%d 个 js 尚无 hash 基线（建档不产生改写，不影响校验结果）' % len(seeded))
        print('校验通过：所有版本号均为最新')
        return 0

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
    if entry_synced:
        print('卡片入口同步 %d 处：' % len(entry_synced))
        for line in entry_synced:
            print('  -> ' + line)
    if not seeded and not bumped and not entry_synced:
        print('无变更，所有版本号均为最新')
    if missing:
        print('警告：以下 js 文件缺失：%s' % ', '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
