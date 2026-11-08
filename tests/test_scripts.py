"""预览脚本的静态检查：语法正确，端口只在 config.sh 定义一次。"""

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


class ScriptTest(unittest.TestCase):
    def test_bash_syntax(self):
        for name in ("config.sh", "restart.sh", "stop.sh"):
            with self.subTest(name):
                subprocess.run(
                    ["bash", "-n", str(SCRIPTS / name)],
                    capture_output=True,
                    check=True,
                )

    def test_port_defined_only_in_config(self):
        config = (SCRIPTS / "config.sh").read_text(encoding="utf-8")
        self.assertEqual(config.count("PORT=8001"), 1)

        for name in ("restart.sh", "stop.sh"):
            with self.subTest(name):
                text = (SCRIPTS / name).read_text(encoding="utf-8")
                self.assertNotIn("PORT=8001", text)
                self.assertIn('source "$SCRIPT_DIR/config.sh"', text)


if __name__ == "__main__":
    unittest.main()
