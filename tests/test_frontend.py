"""前端静态一致性检查。

前端不引入测试框架，这里只用 Python 标准库做三类容易在重构中失手的静态校验：

1. app.js 里用到的 ``#id`` 选择器，必须在 index.html 中存在；
2. app.js 里生成或切换的 class，必须在 style.css 中有对应样式（JS 专用状态钩子除外）；
3. style.css 的大括号必须配对，避免某条规则写坏后吞掉后面的样式。

运行方式：python3 -m unittest discover tests
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "public" / "style.css").read_text(encoding="utf-8")
JS = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

# 只在 JS 里当作状态钩子、本身不需要样式的 class
UNSTYLED_HOOKS = frozenset()


def html_ids():
    return set(re.findall(r'id="([^"]+)"', HTML))


class SelectorTest(unittest.TestCase):
    def test_js_id_selectors_exist_in_html(self):
        used = set(re.findall(r"\$\('#([\w-]+)'\)", JS))
        self.assertTrue(used, "没有解析到任何 $('#id') 选择器，检查 app.js 是否改动")
        self.assertEqual(used - html_ids(), set())

    def test_aria_references_exist_in_html(self):
        referenced = set()
        for attr in ("aria-labelledby", "aria-describedby", "aria-controls"):
            referenced |= set(re.findall(attr + r'="([^"]+)"', HTML))
        self.assertEqual(referenced - html_ids(), set())


class ClassNameTest(unittest.TestCase):
    def test_js_class_names_are_styled(self):
        groups = set(re.findall(r"className = '([^']+)'", JS))
        groups |= set(re.findall(r"classList\.(?:add|remove|toggle)\('([\w-]+)'", JS))
        self.assertTrue(groups, "没有解析到任何 class 名，检查 app.js 是否改动")

        unstyled = {
            token
            for group in groups
            for token in group.split()
            if token not in CSS and token not in UNSTYLED_HOOKS
        }
        self.assertEqual(unstyled, set())


class CssSyntaxTest(unittest.TestCase):
    def test_braces_balanced(self):
        self.assertEqual(CSS.count("{"), CSS.count("}"))

    def test_custom_properties_are_declared(self):
        used = set(re.findall(r"var\((--[\w-]+)\)", CSS))
        declared = set(re.findall(r"^\s*(--[\w-]+):", CSS, flags=re.MULTILINE))
        self.assertEqual(used - declared, set())


if __name__ == "__main__":
    unittest.main()
