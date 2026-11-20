#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""像素街机厅 · HTML 分享包同步器（tools/sync_packages.py）

将 .trae-html-share-packages/ 下的分享包与仓库源文件重建为一致：
  - <page>.html.zip × N（每个根页面一个）：全站快照
    （根目录非点文件平铺 + docs/、tests/ 一级目录全部文件，不递归子目录；
    不含分享包自身与临时产物）
  - tests/<page>.html.zip × N（每个 tests 页面一个）：tests 目录快照

zip 采用确定性输出（条目固定时间戳 + 固定顺序）：源文件不变时重复执行产出
字节相同的 zip，不产生 git 无意义抖动。完成后 tests/check.py 的「分享包一致」
检查项应转绿。

用法（项目根目录或任意目录均可）：
    python tools/sync_packages.py

退出码：0 = 全部重建成功。
"""
import zipfile
from pathlib import Path

# ---------- 路径基准：项目根 = 本脚本目录的上一级 ----------
ROOT = Path(__file__).resolve().parent.parent
PKG_DIR = ROOT / ".trae-html-share-packages"


def snapshot_items():
    """收集全站快照文件清单：(zip 内相对路径, 源文件) 列表。

    规则：根目录全部非点文件平铺收录；docs/ 与 tests/ 目录内全部文件收录
    （zip 内路径带目录前缀）。根目录点文件（如 .gitignore）按现有分享包
    约定不打包；点目录（.git/.trae 等）为目录天然不参与收集。

    返回:
        (zip 内相对路径, 源文件 Path) 列表，按路径排序保证顺序稳定
    """
    items = []
    for f in sorted(ROOT.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            items.append((f.name, f))
    for d in ("docs", "tests"):
        base = ROOT / d
        if base.is_dir():
            for f in sorted(base.iterdir()):
                if f.is_file():
                    items.append((f"{d}/{f.name}", f))
    return items


def tests_items():
    """收集 tests 目录快照文件清单（tests/smoke.html.zip 的内容）。

    返回:
        (带 tests/ 前缀的 zip 内路径, 源文件 Path) 列表
    """
    items = []
    base = ROOT / "tests"
    if base.is_dir():
        for f in sorted(base.iterdir()):
            if f.is_file():
                items.append((f"tests/{f.name}", f))
    return items


def build_zip(zip_path, items):
    """确定性重建单个 zip：先写临时文件再原子替换，失败不破坏旧包。

    条目固定时间戳（1980-01-01）与权限位（0644），配合固定顺序与 zlib
    确定性压缩，保证同输入必产出同字节。

    参数:
        zip_path: 目标 zip 路径
        items: (zip 内相对路径, 源文件 Path) 列表
    """
    # 写包前确保目标父目录存在（首次运行只建了分享包根目录，tests 子目录缺失会写 .tmp 崩溃）
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.parent / (zip_path.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arc, src in items:
            info = zipfile.ZipInfo(arc, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, src.read_bytes())
    tmp.replace(zip_path)
    print(f"[ OK ] {zip_path.relative_to(ROOT)}（{len(items)} 个文件）")


def main():
    """主流程：重建 .trae-html-share-packages 下全部分享包。

    返回:
        0 = 成功
    """
    if not PKG_DIR.is_dir():
        PKG_DIR.mkdir()
        print("已创建分享包目录 .trae-html-share-packages/")
    snaps = snapshot_items()
    pages = sorted(ROOT.glob("*.html"))
    for page in pages:
        build_zip(PKG_DIR / f"{page.name}.zip", snaps)
    test_pages = sorted((ROOT / "tests").glob("*.html"))
    for page in test_pages:
        build_zip(PKG_DIR / "tests" / f"{page.name}.zip", tests_items())
    print(f"完成：{len(pages)} 个页面快照 + {len(test_pages)} 个 tests 快照")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
