"""app.js 渲染链路的测试，借助 tests/dom_stub.js 提供的最小 DOM 桩。

分组渲染、瀑布流分列、折叠这些逻辑一旦只靠肉眼验收，很容易在重构中悄悄退化：
列还在、卡片也在，只是全堆进了第一列。这套测试把「元素必须已经挂进文档才有高度」
这条前提固化下来，让这类缺陷能被自动拦住。

未安装 node 时整组跳过。运行方式：python3 -m unittest discover tests
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_JSON = ROOT / "public" / "data.json"
APP_JS = ROOT / "public" / "app.js"
STUB = Path(__file__).resolve().parent / "dom_stub.js"
NODE = shutil.which("node")


def run_stub():
    result = subprocess.run(
        [NODE, str(STUB), str(DATA_JSON), str(APP_JS)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError("dom_stub.js 执行失败：\n" + result.stderr)
    return json.loads(result.stdout)


@unittest.skipIf(NODE is None, "未安装 node，跳过前端渲染测试")
@unittest.skipUnless(DATA_JSON.exists(), "缺少 public/data.json，先运行 python3 build.py")
class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = run_stub()

    def test_all_checks_pass(self):
        for item in self.report["checks"]:
            with self.subTest(item["name"]):
                self.assertTrue(item["ok"], item["detail"])

    def test_stub_actually_ran_checks(self):
        self.assertGreaterEqual(len(self.report["checks"]), 10)

    def test_cards_are_spread_over_columns(self):
        """每个分组都不能出现空列——这是瀑布流有没有真正生效的判据。"""
        for name, counts in self.report["info"]["spread"].items():
            with self.subTest(name):
                non_empty = sum(1 for n in counts if n > 0)
                self.assertEqual(non_empty, min(sum(counts), len(counts)))


if __name__ == "__main__":
    unittest.main()
