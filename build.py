#!/usr/bin/env python3
"""Prompt & Skills 收藏站构建脚本。

零依赖：仅使用 Python 3 标准库。
读取 content/prompts 与 content/skills 下的 Markdown 文件，
解析 frontmatter 后生成 public/data.json。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
DATA_PATH = ROOT / "public" / "data.json"

PROMPT_REQUIRED = ("title",)
SKILL_REQUIRED = ("title", "intro", "url")


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


def first_line(text: str) -> str:
    """提取正文第一行（跳过开头空行）并去除首尾空白；正文为空时返回空字符串。"""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def collect(content_dir: Path) -> tuple[dict, list[str]]:
    """读取 content 目录，返回 (data, errors)。"""
    prompts: list[dict] = []
    skills: list[dict] = []
    errors: list[str] = []

    for kind, required in (("prompts", PROMPT_REQUIRED), ("skills", SKILL_REQUIRED)):
        kind_dir = content_dir / kind
        if not kind_dir.is_dir():
            continue
        for path in sorted(kind_dir.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError as exc:
                errors.append(f"{path}: 读取失败: {exc}")
                continue

            fields, body = parse_frontmatter(text)
            if fields is None:
                errors.append(f"{path}: frontmatter 格式错误（文件前两行必须为 ---）")
                continue

            missing = [key for key in required if not fields.get(key)]
            if missing:
                errors.append(f"{path}: 缺少必填字段: {', '.join(missing)}")
                continue

            if kind == "prompts":
                prompts.append(
                    {
                        "id": path.stem,
                        "title": fields["title"],
                        "intro": first_line(body),
                        "body": body,
                    }
                )
            else:
                skills.append(
                    {
                        "id": path.stem,
                        "title": fields["title"],
                        "intro": fields["intro"],
                        "url": fields["url"],
                    }
                )

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
