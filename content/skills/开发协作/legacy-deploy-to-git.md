---
intro: 把一个「已上线、但还不是 git 仓库」的服务器部署目录，安全迁移到 git 版本管理，并建立「本地 push → 服务器 pull」的部署链路，保证数据库等运行时数据零丢失。
---

# 旧部署目录迁移到 git 部署

## 何时用

服务器上跑着的代码是 rsync / scp / FTP 传上去的，不是 git 仓库，且目录里混着
**不能丢的运行时数据**（数据库、历史快照、缓存、虚拟环境）。目标：纳入 git 版本管理，
改成 `本地 push → 服务器 pull` 部署，且数据一个字节都不能少。

## 先回答用户「可不可行」

可行，但真正的价值通常不是"同步"（rsync 本来就能同步），而是**版本历史、可回滚、可 diff**。
把这个价值说清楚，用户才知道为什么值得做。

给用户做方案对比时，主动指出**服务器 pull vs CI 推送**的关键差异：

| | 服务器 pull | CI（GitHub Actions）推送 |
|---|---|---|
| SSH 私钥 | 只在本机 | 要存 CI Secrets |
| 服务器 22 端口 | 保持现状 | 需对 CI IP 段或公网开放 |
| 部署时机 | 可控 | push 即上线 |

**CI 方案并不解决"服务器要能访问远端仓库"这个硬问题**（workflow 里通常还是得 pull），
却多出两个新风险。除非有多人协作/多环境需求，否则推荐服务器 pull。

## 执行流程

### 1. 盘家底——找出会被误提交的大文件（必做，且最容易被忽略）

```bash
du -sh <数据目录>/*          # 看体积分布
cat .gitignore               # 逐行核对是否真的覆盖了上面的大目录
```

**典型陷阱**（真实踩过）：
- `.gitignore` 写了 `crawl/data/house_crawl.db`，但目录里还有 `house_crawl.db.bak`(240MB)、
  `house_crawl.db.bak-pruned`(196MB) —— **后缀不匹配就漏了**。要整目录忽略 + `*.db*` 兜底。
- 忽略行**处于注释状态**（行首有 `#`）根本没生效，肉眼很容易看漏。
- 结果：一次 `git add .` 就把近 800MB 塞进仓库。

修完后**必须验证**再提交：

```bash
git add -A
git diff --cached --name-only | wc -l
git diff --cached --name-only | while read f; do [ -f "$f" ] && s=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f") && [ "$s" -gt 500000 ] && echo "大文件: $f"; done
```

> ⚠️ **改 `.gitignore` 本身也有风险**：用 Edit 做大段替换时，容易把区间内原有的规则
> （如 `.workbuddy/`）一起吞掉。改完必须复查暂存清单，发现混入就
> `git rm -r --cached <目录>` 修正。

### 2. 本地建库并推首个提交

```bash
git init && git add -A && git commit -m "chore: 初始化版本库"
git remote add origin <远端地址> && git push -u origin main
```

远端仓库**建私有的、完全空白**（不勾 README/LICENSE，否则首次 push 要处理冲突）。

### 3. 服务器一次性改造：旧目录 → git 工作副本

核心原理：**git 从不删除未跟踪文件**。所以 `git init` + `git checkout -f` 之后，
数据库 / `.venv` / 历史快照原地保留，只有被 git 跟踪的文件会被覆盖。

> ⚠️ **动手前先 `pwd`**：`git init` 必须在**项目目录内**执行。常见部署布局是
> `/data/apps/{.env, <项目>/, <项目>-data/}`——若在 `/data/apps` 建库，数据目录会被纳入仓库树，
> 之后一次 `git add -A` 就把它带进版本库，`git clean` 甚至会删库。宁可多敲一条 `pwd`。
>
> ⚠️ 若服务器上**已有运行中的代码**（非空目录），`git init` 后**不要直接 `git pull`**
> （未跟踪文件会与远端冲突或历史不相关而失败）。正确顺序：
> `git init -b main` → `git remote add` → `git fetch origin <branch>` →
> `git checkout -f -B <branch> origin/<branch>`（覆盖被跟踪文件，未跟踪的 venv/dist/日志原地保留）。

脚本骨架（`deploy/git_setup_server.sh`）：

```bash
set -euo pipefail
APP_DIR=...; PARENT_DIR="$(dirname "$APP_DIR")"   # 备份目录跟随项目目录，别硬编码 /data/apps

# 1) 前置检查：磁盘余量、数据库大小、venv 是否存在
# 2) 实测远端连通性（不通就提前退出，给出镜像/rsync 退路）
git ls-remote --exit-code "$REPO_URL" "refs/heads/$BRANCH" >/dev/null 2>&1 || exit 1
# 3) 变更预览：列出将被移走的旧文件、将被覆盖的文件，等用户确认（FORCE=1 跳过）
# 4) 把旧版本残留文件「移动」到 $PARENT_DIR/legacy_<时间戳>/  ——移动，不是删除
# 5) git init + remote add + git checkout -f -B main origin/main
# 6) 校验：数据库大小未变、关键目录存在、模块可导入
```

旧文件用**精确白名单**匹配（只列文件名常量），不要用通配符，避免误伤数据目录。

> ⚠️ **写部署脚本时的一个静默杀手**：脚本里若开了 `set -e` + `pipefail`，像
> `PORT="$(sed -n 's/^FLASK_PORT=//p' "$ENV_FILE" | tail -1)"` 这种赋值，
> 在 `$ENV_FILE` 不存在时 sed 会失败，**整条语句非零退出 → 脚本在毫无输出的情况下静默中止**，
> 排查时极易误判成「脚本没生效」。正解：先 `[ -f "$ENV_FILE" ]` 判断再读，不要指望 `2>/dev/null`。
> 调试此类问题时直接 `bash -x script.sh` 定位，比读代码快得多。

### 4. 服务器日常部署脚本（`deploy/pull_deploy.sh`）

三条铁律：
1. **只用 `git pull --ff-only`** —— 服务器有本地改动就失败停下，不悄悄覆盖。
2. **绝不执行 `git clean`** —— 数据库/venv/快照都是未跟踪文件，clean 会物理删除。
3. **pull 后校验数据** —— 数据库还在且大小合理，异常立即中止并打印回滚命令。

另外：仅在 `requirements.txt` 变更时才重装依赖；用 `logs/deploy.log` 记录每次部署的
前后 SHA 与提交标题，回滚时才知道该退到哪。

### 4.5 定时自动同步：先看项目形态，别照抄别的项目的 cron

用户常会拿自己另一个项目的 cron 当模板。**先判断形态差异再定频率**：

| | 静态站点（构建产物） | 常驻服务 / 有后台任务 |
|---|---|---|
| pull 后 | 跑 build 脚本重建 | 必须 `systemctl restart` 才生效 |
| 典型频率 | 每 5 分钟合理 | **不合适** |
| 风险 | 低 | 重启会断开在线用户；未测完的 push 直接进生产 |

对「常驻服务 + 后台任务」的项目，除降频（建议每小时，错开整点）外，还要加
**任务进行中跳过部署**的保护：检测项目的锁文件/进程，命中就跳过、下轮重试，
`--force` 留作紧急通道。

> ⚠️ 该判断要放在 `--check` 分支**之后**——`--check` 只读不改，不该被任务锁拦截。
> 放错位置会导致预检在任务运行期间看不到待部署内容。
>
> ⚠️ 锁文件带 pid 时必须**验证 pid 存活**：进程异常退出留下的僵尸锁会让部署永远被跳过。

配套三条：
- **专用 deploy key**：`ssh-keygen -f ~/.ssh/<proj>_deploy`，GitHub Deploy keys 只勾只读；
  cron 里用 `GIT_SSH_COMMAND='ssh -i <key> -o IdentitiesOnly=yes'`。
- **远端地址必须是 SSH 形式**（`git@github.com:...`），配成 `https://` 的话 deploy key 不参与鉴权。
- `flock -n` 防自身并发；cron 默认静默，**务必重定向日志**，否则出错无人知晓。

### 5. 本地一键脚本（`deploy/push_and_deploy.sh`）

提交 → 推送 → `ssh` 触发远程 `pull_deploy.sh`。支持 `--dry-run` / `--no-commit` / `--no-deploy`。
服务器地址放 `deploy/deploy.conf`（**写进 .gitignore**），配 `deploy.conf.example` 做模板。

> **`deploy.conf` 丢失是设计使然，别当成 bug**：它含服务器地址，必须被 `.gitignore` 排除，
> 所以换机器 / 重新 clone 后必然没有，此时 `push_and_deploy.sh` 会打印模板提示并退出 1。
> 重建顺序：
> ① 从 `~/.ssh/known_hosts` 与 shell 历史还原真实地址 ——
> `grep -aE '<项目名>|/data/apps' ~/.zsh_history` 通常能**同时**拿到 `SERVER` 与 `APP_DIR` 两个值
> （历史里的 `scp ... root@x.x.x.x:/data/apps/<项目>` 就是铁证）；
> ② 写好后跑 `bash deploy/push_and_deploy.sh --dry-run` 验证：它打印将执行的
> `git push` 与 `ssh ... pull_deploy.sh` 后退出 0，**既不推送也不连服务器**；
> ③ `git check-ignore -v deploy/deploy.conf` 确认仍被忽略。
> **绝不凭印象猜地址**：地址写错的后果是「一键部署」把代码推到别人的机器。

### 6. 端到端验证（不要跳过）

在 `/tmp` 造模拟服务器目录：假数据库（`dd` 造几 MB 即可）+ 历史快照 + 旧代码 + 假 venv，
跑完整链路，然后**逐字节校验数据指纹**：

```bash
shasum -a 256 <db> > before.sha      # 改造前
# ... 跑改造 + 部署 ...
shasum -a 256 <db>                    # 与 before.sha 比对
```

同时确认：`--check` 模式不改动代码、快照/venv 完好、旧文件 0 残留且已归档。
测完清理 `/tmp` 测试目录，移除临时 remote。

## 踩坑清单

| 坑 | 症状 | 解法 |
|---|---|---|
| bash 3.2 变量边界 | `echo "$VAR（中文）"` 报 `VAR\uFFFD: unbound variable` | 一律写 `${VAR}`；macOS 自带 bash 3.2 会把多字节字符吞进变量名 |
| stat 方言 | GNU `-c%s` / BSD `-f%z` 互不兼容 | `stat -c%s "$1" 2>/dev/null \|\| stat -f%z "$1"` |
| 备份目录硬编码 | 写死 `/data/apps/...`，换部署路径就 mkdir 失败 | 用 `$(dirname "$APP_DIR")` |
| git fetch 进度刷屏 | 几百行 `Counting objects: 1%` | `git fetch -q ... 2>/dev/null` |
| 国内服务器连不上 GitHub | `git ls-remote` 超时 | 代理 / 镜像（`url."https://ghfast.top/https://github.com/".insteadOf`） / 退回 rsync |
| 造活进程测锁 | `sh -c 'sleep 60 & echo $!'` 的 sleep 随 sh 退出被杀，误判为「脚本没生效」 | 直接 `sleep 60 &` 再取 `$!` |
| curl 通但 git 不通 | 误判连通性 | 必须用 `git ls-remote` 实测，curl 只验证了 HTTPS 没验证 git 协议 |
| **`Permission denied (publickey)`** | 服务器上没有一把被 GitHub 认可的密钥。**注意区分**：这是「连得上、没凭据」，与 `Connection timed out`（22 端口被墙，需改走 `ssh.github.com:443`）是两回事，别混着排查 | 用执行 git 的账号生成专用 deploy key → 加到仓库 Settings → Deploy keys（**不勾** write access）→ `~/.ssh/config` 里 `IdentityFile` + `IdentitiesOnly yes`。诊断用 `ssh -vT git@github.com` 看 `Offering public key` 与 `Authentications that can continue`（有 Offering 但被拒 = 这把 key 没绑到该仓库；一行都没有 = 没有可用密钥）。`ssh -T` 成功时退出码仍是 1，属正常 |
| deploy key 加到仓库却没生效 | ① 远端地址是 `https://` 而非 `git@github.com:`；② 私钥/目录权限太松（`Permissions 0644 ... are too open`）；③ 非交互环境卡在首次连接的 `Are you sure?` | 分别用 `git remote -v` 核对、`chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*`、`ssh-keyscan github.com >> ~/.ssh/known_hosts`。另注意 GitHub 上**一把 deploy key 只能绑一个仓库**，多仓库要各配一把或用 Host 别名区分（`Host github-<项目>` + `git@github-<项目>:owner/repo.git`） |
| 远端配成 https | deploy key 配了却不生效 | deploy key 只对 `git@github.com:...` 生效；`git remote set-url` 改回 SSH |
| **在项目目录的上级执行 git init** | 数据目录（如 `/data/apps/techer-llm-data/`）与 `.env` 一起被纳入仓库树，后续 `git add -A` 会连带提交/暴露数据，`git clean` 更会删库 | `git init` 前先 `pwd` 确认**就在项目目录内**；部署布局常见为 `/data/apps/{.env, <项目>/, <项目>-data/}`，务必只对 `<项目>/` 建库 |
| **`not a git repository`** | 服务器上 `git pull` 报 `fatal: not a git repository` | 先分清是「目录走错」还是「部署目录从来不是仓库」：`pwd` + `ls -la \| head` + `find /data -maxdepth 3 -name .git -type d`。前者 `cd` 过去即可；后者走本技能的初始化流程（先备份，旧文件移动而非删除） |
| **`.gitignore` 把自己忽略了** | 文件里有一行 `.gitignore`（常与 `.dockerignore` 一起被模板带入），导致该文件**永远无法入库**；服务器 clone/pull 后拿不到任何忽略规则，`git status` 一片红，且一次 `git add -A` 就会误提交 venv/依赖/日志 | `git log --all -- .gitignore` 为空即坐实。删掉那一行、提交入库，并用 `git check-ignore` 逐项复验 |
| **轮转日志漏出忽略规则** | `.gitignore` 只写了 `x.log`，没写 `x.log.*`；按日轮转出的 `x.log.<date>` 在服务器上以未跟踪文件不断堆积 | 写成 `x.log*`；凡「按日期/序号轮转」的文件都要用通配覆盖 |
| **对齐分支时删掉了运行时文件** | 服务器目录曾被 `git add -A` 提交过，venv/dist 进了本地提交；`git checkout -f -B <branch> origin/<branch>` 后这些**被跟踪**的运行时文件随对齐一起消失（未跟踪文件不受影响，实测保留） | 对齐前先 `tar czf` 备份，或先确认 `git ls-files server/venv` 为空；纯粹 `git init` 未提交过的目录可放心对齐 |

## 交付前检查

- [ ] `.gitignore` 覆盖全部大目录，暂存区无 >500KB 文件
- [ ] 远端仓库为**私有**且空白
- [ ] 改造脚本对旧文件是**移动**到备份目录，不是删除
- [ ] pull 脚本只用 `--ff-only`，全脚本搜不到 `git clean`
- [ ] 端到端跑过，数据指纹逐字节一致
- [ ] 用户已知晓「服务器必须能访问远端仓库」这一前置条件及不通时的退路
