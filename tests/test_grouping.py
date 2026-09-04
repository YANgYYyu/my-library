"""app.js 分组逻辑的单元测试。

分组、排序与配色的规则都写在 app.js 的纯函数里。这里把这几个函数从 app.js
原文中抽出，拼上最小样板交给 node 执行，再对输出断言——中文排序依赖
``Intl.Collator('zh')``，Python 标准库没有对等实现，在 Python 侧重写一份
排序逻辑只会得到一份容易走样的副本。

未安装 node 时整组跳过。运行方式：python3 -m unittest discover tests
"""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JS = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
DATA_JSON = ROOT / "public" / "data.json"
NODE = shutil.which("node")

# 被测函数。改名或删除都会让 SourceContractTest 失败，提醒同步更新本文件
FUNCTIONS = ("hueFor", "compareItems", "groupItems", "isGrouped")


def extract_function(name):
    """从 app.js 中截取顶层函数的完整源码（函数以行首的 `}` 结束）。"""
    start = APP_JS.index("function " + name + "(")
    end = APP_JS.index("\n}\n", start) + len("\n}\n")
    return APP_JS[start:end]


def build_harness():
    palette = re.search(r"const GROUP_HUES = \[[^\]]*\];", APP_JS).group(0)
    parts = [
        "const fs = require('fs');",
        "const collator = new Intl.Collator('zh');",
        palette,
    ]
    parts.extend(extract_function(name) for name in FUNCTIONS)
    parts.extend(
        [
            "const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
            "const groups = groupItems(items);",
            "process.stdout.write(JSON.stringify({",
            "  grouped: isGrouped(groups),",
            "  groups: groups.map(function (group) {",
            "    return {",
            "      key: group.key,",
            "      name: group.name,",
            "      hue: group.hue,",
            "      titles: group.items.map(function (item) { return item.title; }),",
            "    };",
            "  }),",
            "}));",
        ]
    )
    return "\n".join(parts)


def run_grouping(items):
    """用 node 执行抽取出的分组逻辑，返回解析后的结果。"""
    harness = build_harness()
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "grouping.js"
        payload = Path(tmp) / "items.json"
        script.write_text(harness, encoding="utf-8")
        payload.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

        result = subprocess.run(
            [NODE, str(script), str(payload)],
            capture_output=True,
            text=True,
            check=True,
        )
    return json.loads(result.stdout)


def prompt(title, category=""):
    return {"id": title, "title": title, "category": category, "intro": "", "body": ""}


@unittest.skipIf(NODE is None, "未安装 node，跳过前端分组逻辑测试")
class SourceContractTest(unittest.TestCase):
    def test_functions_exist_in_app_js(self):
        for name in FUNCTIONS:
            self.assertIn("function " + name + "(", APP_JS)


@unittest.skipIf(NODE is None, "未安装 node，跳过前端分组逻辑测试")
class GroupItemsTest(unittest.TestCase):
    def test_no_items_gives_no_groups(self):
        result = run_grouping([])
        self.assertEqual(result["groups"], [])
        self.assertFalse(result["grouped"])

    def test_single_uncategorized_group_is_not_grouped(self):
        result = run_grouping([prompt("甲"), prompt("乙")])
        self.assertEqual(len(result["groups"]), 1)
        self.assertFalse(result["grouped"], "全是未分类内容时不应显示分组标题")
        self.assertEqual(result["groups"][0]["key"], "")

    def test_any_category_makes_it_grouped(self):
        result = run_grouping([prompt("甲", "决策")])
        self.assertTrue(result["grouped"])

    def test_nested_category_display_name_uses_spaced_slash(self):
        result = run_grouping([prompt("议论文", "学习/写作")])
        self.assertEqual(result["groups"][0]["key"], "学习/写作")
        self.assertEqual(result["groups"][0]["name"], "学习 / 写作")

    def test_group_order_follows_pinyin(self):
        result = run_grouping(
            [prompt("甲", "学习"), prompt("乙", "决策"), prompt("丙", "问清问题")]
        )
        self.assertEqual(
            [group["key"] for group in result["groups"]], ["决策", "问清问题", "学习"]
        )

    def test_items_are_sorted_within_group(self):
        result = run_grouping(
            [prompt("香蕉", "学习"), prompt("苹果", "学习"), prompt("橙子", "学习")]
        )
        self.assertEqual(result["groups"][0]["titles"], ["橙子", "苹果", "香蕉"])

    def test_uncategorized_sinks_to_the_end(self):
        result = run_grouping(
            [prompt("甲", "决策"), prompt("乙"), prompt("丙", "学习")]
        )
        self.assertEqual(
            [group["key"] for group in result["groups"]], ["决策", "学习", ""]
        )
        self.assertEqual(result["groups"][-1]["name"], "未分类")

    def test_every_item_lands_in_exactly_one_group(self):
        items = [prompt("甲", "决策"), prompt("乙"), prompt("丙", "学习"), prompt("丁", "决策")]
        result = run_grouping(items)
        grouped = [title for group in result["groups"] for title in group["titles"]]
        self.assertCountEqual(grouped, [item["title"] for item in items])

    def test_hues_are_unique_until_the_palette_runs_out(self):
        items = [prompt("条目" + str(i), "分类" + str(i)) for i in range(8)]
        hues = [group["hue"] for group in run_grouping(items)["groups"]]
        self.assertEqual(len(hues), len(set(hues)), "色板够用时不应出现同色分组")

    def test_hue_is_stable_for_the_same_category(self):
        first = run_grouping([prompt("甲", "决策")])["groups"][0]["hue"]
        second = run_grouping([prompt("乙", "决策")])["groups"][0]["hue"]
        self.assertEqual(first, second)


@unittest.skipIf(NODE is None, "未安装 node，跳过前端分组逻辑测试")
@unittest.skipUnless(DATA_JSON.exists(), "缺少 public/data.json，先运行 python3 build.py")
class RealContentTest(unittest.TestCase):
    def test_current_content_groups_as_expected(self):
        prompts = json.loads(DATA_JSON.read_text(encoding="utf-8"))["prompts"]
        result = run_grouping(prompts)
        self.assertTrue(result["grouped"])
        self.assertEqual(
            [group["key"] for group in result["groups"]],
            ["解决问题", "决策", "认识你自己", "问清问题", "学习"],
        )
        self.assertEqual(
            sum(len(group["titles"]) for group in result["groups"]), len(prompts)
        )


if __name__ == "__main__":
    unittest.main()
