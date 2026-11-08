"""关键配色的 WCAG 对比度回归检查。

浏览器 + axe 的人工复核仍是最终依据；这里把最容易回归的几组颜色固化下来，
避免以后改主题时把白字放到浅蓝底上。
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "public" / "style.css").read_text(encoding="utf-8")


def block(pattern):
    match = re.search(pattern, CSS, flags=re.S)
    if match is None:
        raise AssertionError("找不到样式块: " + pattern)
    return match.group(1)


def variables(block_text):
    return {
        name: value.strip()
        for name, value in re.findall(r"(--[\w-]+):\s*([^;]+);", block_text)
    }


LIGHT = variables(block(r"^:root\s*\{(.*?)\}",))
DARK = variables(
    block(r"@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{(.*?)\}",)
)


def channel(value):
    value = value / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    high, low = max(la, lb), min(la, lb)
    return (high + 0.05) / (low + 0.05)


def color(value):
    value = value.strip()
    if value.startswith("#"):
        value = value[1:]
        if len(value) == 3:
            value = "".join(ch * 2 for ch in value)
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    match = re.fullmatch(r"rgba?\(([^)]+)\)", value)
    if match is None:
        raise AssertionError("无法解析颜色: " + value)
    parts = [part.strip() for part in match.group(1).split(",")]
    return tuple(int(part) for part in parts[:3])


def alpha(value):
    match = re.fullmatch(r"rgba\([^)]*,\s*([0-9.]+)\)", value.strip())
    if match is None:
        raise AssertionError("无法解析透明度: " + value)
    return float(match.group(1))


def over(fg_value, bg_value, opacity):
    fg, bg = color(fg_value), color(bg_value)
    return tuple(round(opacity * f + (1 - opacity) * b) for f, b in zip(fg, bg))


class ContrastTest(unittest.TestCase):
    def assert_aa(self, label, fg, bg):
        ratio = contrast(fg, bg)
        self.assertGreaterEqual(ratio, 4.5, f"{label} 仅 {ratio:.2f}:1")

    def test_primary_button_text(self):
        for theme, values in (("light", LIGHT), ("dark", DARK)):
            with self.subTest(theme):
                self.assert_aa(
                    theme + " primary button",
                    color(values["--accent-text"]),
                    color(values["--accent-bg"]),
                )

    def test_active_navigation_text(self):
        for theme, values in (("light", LIGHT), ("dark", DARK)):
            with self.subTest(theme):
                soft = over(
                    values["--accent-soft"],
                    values["--sidebar-bg"],
                    alpha(values["--accent-soft"]),
                )
                self.assert_aa(
                    theme + " active nav",
                    color(values["--accent-on-soft"]),
                    soft,
                )

    def test_secondary_text(self):
        for theme, values in (("light", LIGHT), ("dark", DARK)):
            with self.subTest(theme):
                self.assert_aa(
                    theme + " secondary text",
                    color(values["--text-secondary"]),
                    color(values["--bg"]),
                )


if __name__ == "__main__":
    unittest.main()
