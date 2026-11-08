---
intro: 把工作区里混在一起的多组改动，拆成若干个「语义纯净、且每个提交自身都能编译/通过测试」的提交序列，保证可 bisect。
---

# 把改动拆成语义纯净的提交序列

## 核心原则

1. **每个提交都要是「可用状态」**：能编译、测试能过。否则 `git bisect` 会在中间提交上失效。
   这一条决定了拆分的边界——被测试引用的文件改动必须和被测代码在同一个提交里。
2. **一个提交只讲一件事**：代码、测试、文档分开；功能改动与不相关的修复分开。
3. **拆分依据是「关注点」，不是「文件」**：同一个文件的改动若横跨两个关注点，优先把它放进
   更主要的那个提交并在提交信息里说明；只有当拆错会让中间提交变坏（如破坏测试）时才做切分。

## 标准流程

### 第一步：列出全部改动，按关注点归类

```bash
git status -s
git diff --stat            # 掌握改动规模
```

给每个文件打上所属提交的标签。**特别注意跨关注点的文件**（如同时含标题改名与 favicon 修复的
`index.html`、同时含两组新测试的 `test_*.py`）——它们决定后面要不要做切分。

### 第二步：判断跨关注点文件是否需要切分

判断标准只有一个：**不切的话，中间那个提交会不会坏？**

- 同一个测试文件里既有 A 功能的测试、又有 B 功能的测试：
  若两个提交都塞进同一个提交，等于把 B 的测试提前引入 → A 的提交必然红。**必须切分。**
- 一个文件里既有资源路径修复、又有文案改名：不切也不会坏，**可切可不切**（切了更干净）。

### 第三步：切分文件的技巧（关键）

不要用 `git add -p` 交互式暂存（自动化环境无法交互，且中文内容容易误判）。改用
**临时写出中间版本**的方法，简单、确定、可复现：

```bash
# 1) 快照最终版本，务必先备份
cp path/to/file /tmp/final_file

# 2) 用脚本把文件改回「属于前一提交」的形态（删掉后一提交独有的部分）
python3 - <<'PY'
import pathlib
p = pathlib.Path('path/to/file')
t = pathlib.Path('/tmp/final_file').read_text()
# 删除属于后一提交的代码块（用 class/函数边界截取，不要用正则盲替换）
start = t.index('class LaterFeatureTests')
end = t.index("if __name__ == '__main__':")
pathlib.Path('path/to/file').write_text(t[:start] + t[end:])
PY

# 3) 提交前一关注点
git add ...
git commit -F /tmp/msg1.txt

# 4) 恢复最终版本，提交后一关注点
cp /tmp/final_file path/to/file
git add ...
git commit -F /tmp/msg2.txt
```

要点：
- 每一步都用**断言**校验前提（如 `assert '关键串' in t`），避免改错文件后静默继续。
- 中间版本必须**语法正确**：删块后用 `python -m py_compile`、构建或测试过一遍。

### 第四步：验证中间提交真的是绿的（最容易被跳过的一步）

不要用工作区跑测试冒充——工作区含未提交的后续改动。用 **worktree 检出该提交**再跑：

```bash
git worktree add -q /tmp/check HEAD          # 只含已提交内容
cd /tmp/check/<子目录> && <项目自带的测试命令>
cd - && git worktree remove /tmp/check --force
```

若依赖（venv / node_modules）不在版本控制里，直接用主仓库的解释器、把 cwd 指向 worktree 即可：

```bash
cd /tmp/check/server && /path/to/main/repo/server/venv/bin/python -m unittest tests.test_x
```

### 第五步：收尾核对

```bash
git log --oneline -6                       # 提交顺序与信息
git status -s                              # 必须为空（全部改动已入库）
for c in HEAD~3 HEAD~2 HEAD~1 HEAD; do      # 每个提交的文件数与增删
  echo "$(git log --oneline -1 $c) -> $(git show --stat --format='' $c | tail -1)"
done
```

最后再跑一次完整测试，确认最终状态没被拆分过程弄坏（尤其做过文件切分时）。

## 环境坑（本机实测）

- **不要在 git 命令之间用 `&&` 串长链**：本环境曾整条被 SIGTERM 杀掉（exit 137），
  结果是 `git add` 没生效、提交漏文件却看不出来。`add`、`commit`、`log` 各跑一条。
- **提交信息用 `git commit -F <文件>`**，文件用写文件工具生成；heredoc 起始行末尾挂
  `&& 后续命令` 会被静默吞掉。
- **每次提交后用 `git show --stat HEAD` 核对内容**，不要只看命令是否成功。
- 本地无 `timeout` 命令（macOS）；`git worktree remove` 要带 `--force` 避免残留脏目录。
