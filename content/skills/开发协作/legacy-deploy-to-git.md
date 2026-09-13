---
intro: 把已上线但没有版本管理的服务器目录安全迁入 git，建立本地推送、服务器拉取的部署链路。
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
| 远端配成 https | deploy key 配了却不生效 | deploy key 只对 `git@github.com:...` 生效；`git remote set-url` 改回 SSH |

## 交付前检查

- [ ] `.gitignore` 覆盖全部大目录，暂存区无 >500KB 文件
- [ ] 远端仓库为**私有**且空白
- [ ] 改造脚本对旧文件是**移动**到备份目录，不是删除
- [ ] pull 脚本只用 `--ff-only`，全脚本搜不到 `git clean`
- [ ] 端到端跑过，数据指纹逐字节一致
- [ ] 用户已知晓「服务器必须能访问远端仓库」这一前置条件及不通时的退路
