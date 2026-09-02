#!/usr/bin/env python3
"""Prompt & Skills 收藏站构建脚本。

零依赖：仅使用 Python 3 标准库。
读取 content/prompts 与 content/skills 下的 Markdown 文件，生成 public/data.json。

标题一律取自文件名（不含扩展名），内容文件里不再写 title 字段：

- prompt：整个文件即正文，不使用 frontmatter；分类取自子目录名。
- skill：保留 frontmatter，只需提供 intro 与 url。

两个目录下的 Markdown 按递归方式采集，可用子目录分类，子目录名即 category，
可继续嵌套（如 ``学习/写作``）。内容 ID 取相对于分类根目录的路径（不含扩展名），
保证跨目录同名文件不会冲突。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
DATA_PATH = ROOT / "public" / "data.json"

SKILL_REQUIRED = ("intro", "url")


def parse_frontmatter(text: str) -> tuple[dict[str, str] | None, str | None]:
    """解析 Markdown 文件开头的 frontmatter。

    返回 (fields, body)。frontmatter 格式非法时返回 (None, None)。
    文件前两行必须为 ``---``，字段格式为 ``键: 值``。
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        return None, None
    end = text.find("\n---", 4)
    if end == -1:
        return None, None
    header = text[4:end]
    body = text[end + 4 :]
    if body.startswith("\n"):
        body = body[1:]

    fields: dict[str, str] = {}
    for line in header.split("\n"):
        if ": " not in line:
            continue
        key, _, value = line.partition(": ")
        fields[key.strip()] = value.strip()
    return fields, body


def relative_id(path: Path, kind_dir: Path) -> str:
    """内容 ID：相对于分类根目录的路径，不含扩展名，分隔符统一为 /。

    以相对路径作为 ID，保证不同分类下的同名文件不会互相覆盖。
    """
    return path.relative_to(kind_dir).with_suffix("").as_posix()


def relative_category(path: Path, kind_dir: Path) -> str:
    """内容分类：相对路径的父目录；直接位于分类根目录时返回空字符串。"""
    parent = path.relative_to(kind_dir).parent
    return "" if parent == Path(".") else parent.as_posix()


def first_line(text: str) -> str:
    """提取正文第一行（跳过开头空行）并去除首尾空白；正文为空时返回空字符串。"""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def collect(content_dir: Path) -> tuple[dict, list[str]]:
    """读取 content 目录，返回 (data, errors)。

    递归采集每个分类目录下的所有 Markdown 文件。出现任何解析错误、
    内容 ID 重复或分类目录为空时，都会记录到 errors 中。
    """
    prompts: list[dict] = []
    skills: list[dict] = []
    errors: list[str] = []
    seen_ids: set[str] = set()

    for kind in ("prompts", "skills"):
        kind_dir = content_dir / kind
        if not kind_dir.is_dir():
            continue

        paths = sorted(kind_dir.rglob("*.md"))
        if not paths:
            errors.append(f"{kind_dir}: 目录下没有找到任何 Markdown 文件")
            continue

        for path in paths:
            try:
                text = path.read_text(encoding="utf-8")
            except OSError as exc:
                errors.append(f"{path}: 读取失败: {exc}")
                continue

            fields, _ = parse_frontmatter(text)

            if kind == "prompts":
                if fields:
                    errors.append(
                        f"{path}: prompt 不再使用 frontmatter，标题取自文件名、分类取自子目录名"
                    )
                    continue
                entry = {
                    "id": relative_id(path, kind_dir),
                    "title": path.stem,
                    "category": relative_category(path, kind_dir),
                    "intro": first_line(text),
                    "body": text,
                }
            else:
                if fields is None:
                    errors.append(
                        f"{path}: frontmatter 格式错误（文件前两行必须为 ---）"
                    )
                    continue
                missing = [key for key in SKILL_REQUIRED if not fields.get(key)]
                if missing:
                    errors.append(f"{path}: 缺少必填字段: {', '.join(missing)}")
                    continue
                entry = {
                    "id": relative_id(path, kind_dir),
                    "title": path.stem,
                    "category": relative_category(path, kind_dir),
                    "intro": fields["intro"],
                    "url": fields["url"],
                }

            if entry["id"] in seen_ids:
                errors.append(f"{path}: 内容 ID 重复: {entry['id']}")
                continue
            seen_ids.add(entry["id"])

            if kind == "prompts":
                prompts.append(entry)
            else:
                skills.append(entry)

    return {"prompts": prompts, "skills": skills}, errors


def write_data(data: dict, data_path: Path) -> None:
    """将 data 写入 data_path，UTF-8 编码，中文不做 ASCII 转义。"""
    data_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    data_path.write_text(payload, encoding="utf-8")


def main() -> int:
    data, errors = collect(CONTENT_DIR)
    for error in errors:
        print(f"[build] {error}", file=sys.stderr)

    if errors:
        print("[build] 存在解析错误，未更新 data.json", file=sys.stderr)
        return 1

    write_data(data, DATA_PATH)
    print(
        f"[build] 已生成 {DATA_PATH}: "
        f"{len(data['prompts'])} prompts, {len(data['skills'])} skills"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
