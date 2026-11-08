"""文档一致性检查：链接可达、四类真相文件存在、章节编号不重复。"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

TRUTH_DOCS = (
    "产品设计文档.md",
    "开发文档.md",
    "部署与排障.md",
    "变更与审查记录.md",
)


class DocLinkTest(unittest.TestCase):
    def test_truth_docs_exist(self):
        for name in TRUTH_DOCS:
            with self.subTest(name):
                self.assertTrue((DOCS / name).is_file())

    def test_relative_markdown_links_exist(self):
        for path in DOCS.glob("*.md"):
            text = path.read_text(encoding="utf-8")
            for target in re.findall(r"\]\(([^)#]+\.md)(?:#[^)]*)?\)", text):
                if target.startswith(("http://", "https://")):
                    continue
                with self.subTest(doc=path.name, target=target):
                    self.assertTrue((path.parent / target).resolve().is_file())

    def test_docs_paths_in_backticks_exist(self):
        for path in DOCS.glob("*.md"):
            text = path.read_text(encoding="utf-8")
            for target in re.findall(r"`(docs/[^`]+\.md)`", text):
                with self.subTest(doc=path.name, target=target):
                    self.assertTrue((ROOT / target).is_file())


class HeadingTest(unittest.TestCase):
    def test_dev_doc_numbered_headings_are_unique(self):
        text = (DOCS / "开发文档.md").read_text(encoding="utf-8")
        numbers = re.findall(r"^### (7\.\d+)", text, flags=re.MULTILINE)
        self.assertEqual(len(numbers), len(set(numbers)))


if __name__ == "__main__":
    unittest.main()
