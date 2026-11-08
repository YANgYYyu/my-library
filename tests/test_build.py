"""build.py 的单元测试。运行方式：python3 -m unittest discover tests"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build


class ParseFrontmatterTest(unittest.TestCase):
    def test_normal_fields(self):
        fields, body = build.parse_frontmatter(
            "---\ntitle: 翻译助手\nintro: 简介\n---\n正文第一行\n正文第二行\n"
        )
        self.assertEqual(fields, {"title": "翻译助手", "intro": "简介"})
        self.assertEqual(body, "正文第一行\n正文第二行\n")

    def test_missing_delimiters(self):
        self.assertEqual(build.parse_frontmatter("title: 无分隔符\n"), (None, None))
        self.assertEqual(build.parse_frontmatter("---\ntitle: 只有起始\n"), (None, None))
        self.assertEqual(build.parse_frontmatter(""), (None, None))

    def test_crlf_supported(self):
        fields, body = build.parse_frontmatter(
            "---\r\ntitle: 标题\r\n---\r\n正文\r\n"
        )
        self.assertEqual(fields, {"title": "标题"})
        self.assertEqual(body, "正文\n")


class RelativePathTest(unittest.TestCase):
    def test_id_and_category_for_top_level_file(self):
        kind_dir = Path("/repo/content/prompts")
        path = kind_dir / "翻译助手.md"
        self.assertEqual(build.relative_id(path, kind_dir), "翻译助手")
        self.assertEqual(build.relative_category(path, kind_dir), "")

    def test_id_and_category_for_nested_file(self):
        kind_dir = Path("/repo/content/prompts")
        path = kind_dir / "学习" / "写作" / "议论文.md"
        self.assertEqual(build.relative_id(path, kind_dir), "学习/写作/议论文")
        self.assertEqual(build.relative_category(path, kind_dir), "学习/写作")


class CollectTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.content = Path(self._tmp.name) / "content"

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, kind, name, text):
        path = self.content / kind / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_prompt_title_comes_from_filename(self):
        self.write("prompts", "翻译助手.md", "你是一名专业的翻译。\n第二行正文\n")
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        prompt = data["prompts"][0]
        self.assertEqual(prompt["title"], "翻译助手")
        self.assertEqual(prompt["intro"], "你是一名专业的翻译。")
        self.assertEqual(prompt["body"], "你是一名专业的翻译。\n第二行正文\n")

    def test_prompt_intro_skips_leading_blank_lines(self):
        self.write("prompts", "翻译助手.md", "\n\n你是一名专业的翻译。\n第二行\n")
        data, _ = build.collect(self.content)
        self.assertEqual(data["prompts"][0]["intro"], "你是一名专业的翻译。")

    def test_prompt_intro_strips_heading_marker(self):
        self.write("prompts", "人生设计术.md", "# Role：人生设计师\n\n正文\n")
        data, _ = build.collect(self.content)
        self.assertEqual(data["prompts"][0]["intro"], "Role：人生设计师")
        self.assertEqual(data["prompts"][0]["body"], "# Role：人生设计师\n\n正文\n")

    def test_prompt_empty_body_gives_empty_intro(self):
        self.write("prompts", "b.md", "\n")
        data, _ = build.collect(self.content)
        prompt = data["prompts"][0]
        self.assertEqual(prompt["intro"], "")
        self.assertEqual(prompt["body"], "\n")

    def test_prompt_with_leftover_frontmatter_reports_error(self):
        path = self.write("prompts", "旧格式.md", "---\ntitle: 旧格式\n---\n正文\n")
        data, errors = build.collect(self.content)
        self.assertEqual(data["prompts"], [])
        self.assertTrue(any(str(path) in error for error in errors))
        self.assertTrue(any("frontmatter" in error for error in errors))

    def test_skill_fields_output(self):
        self.write(
            "skills",
            "grill-me.md",
            "---\nintro: 简介\nurl: https://github.com/x\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(
            data["skills"][0],
            {
                "id": "grill-me",
                "title": "grill-me",
                "category": "",
                "intro": "简介",
                "url": "https://github.com/x",
                "body": "",
            },
        )

    def test_skill_body_output(self):
        self.write(
            "skills",
            "a.md",
            "---\nintro: 简介\nurl: https://github.com/x\n---\n# 标题\n\n正文\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(data["skills"][0]["body"], "# 标题\n\n正文\n")

    def test_skill_url_optional_for_self_made_skills(self):
        self.write("skills", "自研.md", "---\nintro: 简介\n---\n正文\n")
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(data["skills"][0]["url"], "")
        self.assertEqual(data["skills"][0]["body"], "正文\n")

    def test_skill_title_comes_from_filename_not_frontmatter(self):
        self.write(
            "skills",
            "写作助手.md",
            "---\ntitle: 被忽略的标题\nintro: 简介\nurl: https://github.com/x\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(data["skills"][0]["title"], "写作助手")

    def test_skill_unknown_key_ignored_in_output(self):
        self.write(
            "skills",
            "a.md",
            "---\nintro: 简介\nurl: https://github.com/x\nurl2: 忽略\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(
            data["skills"][0],
            {
                "id": "a",
                "title": "a",
                "category": "",
                "intro": "简介",
                "url": "https://github.com/x",
                "body": "",
            },
        )

    def test_skill_missing_required_field_skips_file(self):
        path = self.write("skills", "bad.md", "---\nurl: https://github.com/x\n---\n")
        data, errors = build.collect(self.content)
        self.assertEqual(data["skills"], [])
        self.assertTrue(any(str(path) in error for error in errors))
        self.assertTrue(any("intro" in error for error in errors))

    def test_skill_invalid_frontmatter_reports_error(self):
        path = self.write("skills", "bad.md", "没有 frontmatter\n")
        data, errors = build.collect(self.content)
        self.assertEqual(data["skills"], [])
        self.assertTrue(any(str(path) in error for error in errors))

    def test_prompts_in_subdirectories_are_collected(self):
        self.write("prompts", "决策/a.md", "正文 A\n")
        self.write("prompts", "学习/b.md", "正文 B\n")
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(len(data["prompts"]), 2)

    def test_category_is_subdirectory_name(self):
        self.write("prompts", "决策/a.md", "正文 A\n")
        data, _ = build.collect(self.content)
        self.assertEqual(data["prompts"][0]["category"], "决策")

    def test_nested_subdirectory_gives_nested_category(self):
        self.write("prompts", "学习/写作/a.md", "正文 A\n")
        data, _ = build.collect(self.content)
        prompt = data["prompts"][0]
        self.assertEqual(prompt["category"], "学习/写作")
        self.assertEqual(prompt["id"], "学习/写作/a")
        self.assertEqual(prompt["title"], "a")

    def test_top_level_file_has_empty_category(self):
        self.write("prompts", "a.md", "正文 A\n")
        data, _ = build.collect(self.content)
        self.assertEqual(data["prompts"][0]["category"], "")

    def test_same_filename_in_different_categories_both_kept(self):
        self.write("prompts", "决策/第一性原理.md", "决策版正文\n")
        self.write("prompts", "学习/第一性原理.md", "学习版正文\n")
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(
            [item["id"] for item in data["prompts"]],
            ["决策/第一性原理", "学习/第一性原理"],
        )

    def test_skills_in_subdirectories_are_collected(self):
        self.write(
            "skills",
            "工具/a.md",
            "---\nintro: 简介\nurl: https://github.com/x\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(data["skills"][0]["category"], "工具")

    def test_duplicate_id_across_kinds_reported(self):
        self.write("prompts", "x.md", "正文\n")
        self.write(
            "skills",
            "x.md",
            "---\nintro: 简介\nurl: https://github.com/x\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(len(data["prompts"]), 1)
        self.assertEqual(data["skills"], [])
        self.assertTrue(any("ID 重复" in error for error in errors))

    def test_empty_kind_dir_reports_error(self):
        (self.content / "prompts").mkdir(parents=True)
        data, errors = build.collect(self.content)
        self.assertEqual(data["prompts"], [])
        self.assertTrue(any("没有找到任何 Markdown 文件" in e for e in errors))

    def test_missing_content_dir_reports_error(self):
        data, errors = build.collect(self.content / "不存在")
        self.assertEqual(data, {"prompts": [], "skills": []})
        self.assertTrue(any("内容目录不存在" in e for e in errors))

    def test_content_without_kind_dirs_reports_error(self):
        self.content.mkdir()
        data, errors = build.collect(self.content)
        self.assertEqual(data, {"prompts": [], "skills": []})
        self.assertTrue(any("没有 prompts 或 skills 目录" in e for e in errors))


class MainTest(unittest.TestCase):
    """main() 的失败关闭：有错误时不覆盖已发布的 data.json。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.content = self.root / "content"
        self.out = self.root / "public" / "data.json"

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, kind, name, text):
        path = self.content / kind / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def run_main(self, content_dir=None):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return build.main(content_dir or self.content, self.out)

    def test_success_writes_data(self):
        self.write("prompts", "a.md", "正文\n")
        self.assertEqual(self.run_main(), 0)
        data = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(len(data["prompts"]), 1)

    def test_error_does_not_overwrite_existing_data(self):
        self.write("prompts", "bad.md", "---\ntitle: 旧格式\n---\n正文\n")
        self.out.parent.mkdir(parents=True)
        self.out.write_text("旧产物", encoding="utf-8")
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.out.read_text(encoding="utf-8"), "旧产物")

    def test_missing_content_dir_does_not_overwrite(self):
        self.out.parent.mkdir(parents=True)
        self.out.write_text("旧产物", encoding="utf-8")
        self.assertEqual(self.run_main(self.root / "不存在"), 1)
        self.assertEqual(self.out.read_text(encoding="utf-8"), "旧产物")

    def test_content_without_kind_dirs_does_not_write(self):
        self.content.mkdir()
        self.assertEqual(self.run_main(), 1)
        self.assertFalse(self.out.exists())


class WriteDataTest(unittest.TestCase):
    def test_data_json_utf8_without_ascii_escape(self):
        data = {
            "prompts": [
                {
                    "id": "翻译",
                    "title": "翻译",
                    "category": "",
                    "intro": "简介",
                    "body": "正文",
                }
            ],
            "skills": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "public" / "data.json"
            build.write_data(data, out)
            raw = out.read_bytes()
            self.assertIn("翻译".encode("utf-8"), raw)
            self.assertNotIn(b"\\u", raw)
            decoded = json.loads(raw.decode("utf-8"))
            self.assertEqual(decoded, data)


if __name__ == "__main__":
    unittest.main()
