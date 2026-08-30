"""build.py 的单元测试。运行方式：python3 -m unittest discover tests"""

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


class CollectTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.content = Path(self._tmp.name) / "content"
        (self.content / "prompts").mkdir(parents=True)
        (self.content / "skills").mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, kind, name, text):
        path = self.content / kind / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_prompt_intro_is_first_line(self):
        self.write(
            "prompts",
            "a.md",
            "---\ntitle: 翻译助手\n---\n第一行简介\n第二行正文\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        prompt = data["prompts"][0]
        self.assertEqual(prompt["title"], "翻译助手")
        self.assertEqual(prompt["intro"], "第一行简介")
        self.assertEqual(prompt["body"], "第一行简介\n第二行正文\n")

    def test_prompt_intro_skips_blank_line_after_frontmatter(self):
        self.write(
            "prompts",
            "d.md",
            "---\ntitle: 翻译助手\n---\n\n你是一名专业的翻译。\n第二行\n",
        )
        data, _ = build.collect(self.content)
        prompt = data["prompts"][0]
        self.assertEqual(prompt["intro"], "你是一名专业的翻译。")
        self.assertEqual(prompt["body"], "\n你是一名专业的翻译。\n第二行\n")

    def test_prompt_empty_body_gives_empty_intro(self):
        self.write("prompts", "b.md", "---\ntitle: 空正文\n---\n\n")
        data, _ = build.collect(self.content)
        prompt = data["prompts"][0]
        self.assertEqual(prompt["intro"], "")
        self.assertEqual(prompt["body"], "\n")

    def test_missing_required_field_skips_file(self):
        path = self.write("skills", "bad.md", "---\ntitle: 缺字段\n---\n")
        data, errors = build.collect(self.content)
        self.assertEqual(data["skills"], [])
        self.assertTrue(any(str(path) in error for error in errors))

    def test_skill_fields_output(self):
        self.write(
            "skills",
            "grill.md",
            "---\ntitle: grill-me\nintro: 简介\nurl: https://github.com/x\n---\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(
            data["skills"][0],
            {
                "id": "grill",
                "title": "grill-me",
                "intro": "简介",
                "url": "https://github.com/x",
            },
        )

    def test_unknown_key_ignored_in_output(self):
        self.write(
            "prompts",
            "c.md",
            "---\ntitle: 标题\nurl: https://example.com\n---\n正文\n",
        )
        data, errors = build.collect(self.content)
        self.assertEqual(errors, [])
        self.assertEqual(
            data["prompts"][0],
            {"id": "c", "title": "标题", "intro": "正文", "body": "正文\n"},
        )

    def test_invalid_frontmatter_reports_error(self):
        path = self.write("prompts", "bad.md", "没有 frontmatter\n")
        data, errors = build.collect(self.content)
        self.assertEqual(data["prompts"], [])
        self.assertTrue(any(str(path) in error for error in errors))


class WriteDataTest(unittest.TestCase):
    def test_data_json_utf8_without_ascii_escape(self):
        data = {
            "prompts": [{"id": "翻译", "title": "翻译", "intro": "简介", "body": "正文"}],
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
