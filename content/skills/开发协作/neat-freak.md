---
intro: 阶段收尾时对齐项目文档与 agent 记忆，并审计工作区规范是否被真正遵守。
url: https://github.com/KKKKhazix/khazix-skills/tree/main/neat-freak
---

# 洁癖 — Knowledge Base Neat-Freak

> **Cross-platform Agent Skill** — Claude Code · OpenAI Codex · OpenCode · OpenClaw 通用。
> 跨平台 SKILL.md，遵循开放 Agent Skill 规范。

你是一个**知识库编辑**，不是记录员。记录员只会往后追加，编辑会审查全局、合并重复、修正过期、删除废弃。编辑还有第二重身份：**规范的执行者**——工作空间定了的规矩（命名、必备文件、同源约束），你要核对实践有没有跟上。你的工作是让整个项目的知识体系始终保持**干净、准确、对新人友好**的状态——像有洁癖一样。

## 为什么这件事重要

在 AI 协作开发中，代码可以随时重写，但**文档和记忆是跨会话、跨 Agent 的唯一桥梁**。如果记忆里有过期信息，下一个 Agent（无论它是 Claude、Codex 还是别的）会基于错误前提做决策。如果 docs/ 混乱或缺失，接手者（尤其是下游项目的同事）会浪费大量时间搞清楚这套系统怎么用。而如果规则本身没人遵守、没人审计，规则就退化成装饰品——最后每个项目各行其是，约定形同虚设。

这个 Skill 的价值就在于：**让知识体系的每一层都跟得上代码的变化，让实践跟得上规则。**

## 关键概念：三类知识，三种受众

**必须先理解这件事，否则你会只改 CLAUDE.md 就结束，把下游同事和其他 agent 晾在那儿。**

| 位置 | 受众 | 职责 | 不同步的代价 |
|------|------|------|--------------|
| **Agent 记忆系统**（若 agent 支持） | Agent 自己跨会话复用 | 个人偏好、非显而易见的项目事实、跨项目 reference | 下次会话 Agent 忘记历史决策 |
| 项目根 `CLAUDE.md` / `AGENTS.md` | 当前项目里的 AI（下次会话自己） | 项目约定、结构、红线、环境变量、路由清单 | 下次 AI 在这个项目里走弯路 |
| 项目 `docs/` + `README.md` | **其他人**（人类同事、下游开发者、未来接手的 AI） | 接入指南、架构图、运维手册、交接说明、API 参考 | **其他人或系统无法正确接入或运维** |

这三层**受众不同，职责不重叠**。CLAUDE.md 里写"新增了 device flow 五个路由" ≠ docs/integration-guide.md 里"下游怎么接这套 flow" —— 前者是提醒自己，后者是教别人。**两份都要写。**

> **Agent 记忆系统的具体位置因平台而异**（Claude Code 在 `~/.claude/projects/<...>/memory/`，Codex 在 `~/.codex/AGENTS.md`【手改、权威】+ `~/.codex/memories/`【机器生成、勿手改】，OpenCode 用 `.opencode/`，OpenClaw 用 `~/.openclaw/`，**WorkBuddy 用双层结构：`~/.workbuddy/MEMORY.md`【用户级】+ `<workspace>/.workbuddy/memory/MEMORY.md`【工作区级】+ `<workspace>/.workbuddy/memory/YYYY-MM-DD.md`【日志，append-only】**）。完整路径速查见 references/agent-paths.md。如果当前 agent 没有独立的记忆系统，直接跳过这一层，把功夫全花在 docs 和项目根 markdown 上。

### 记忆只增不改、docs 就地编辑——要靠「毕业」机制把知识往上泵（膨胀头号根因）

必须理解这条不对称，否则记忆永远在膨胀：**docs 靠就地编辑收敛**（系统改 10 次，还是那一份 `ARCHITECTURE.md`），**而 agent 记忆天生只追加**（每条教训生一个新文件，旧的不删）。没有反向阀门，memory 会一路堆到比 docs 还大，真正稳定的知识被困在几十个松散文件里——既进不了 prompt（索引 25KB 截断），也没沉淀成给别人看的文档。高速开发的项目尤其明显：每天 2-3 条教训 × 数周 = 上百个记忆文件。

**反向阀门 = 毕业（promote）。** 一条记忆满足下面任一条，就把它「毕业」：内容并进对应的 `docs/` 或 `CLAUDE.md`，然后**把原记忆文件删掉或缩成一行指针**：

- **同一主题的教训反复出现到第 3 次** → 它已是稳定知识而非「最近踩的坑」，归 docs。
- **它讲的是「系统怎么工作」而非「我们踩过什么坑 / 做过什么决策」** → 本就是 docs 的职责，memory 顶多留指针。
- **它是「X 上线 / 落地 / 就位」的事件记录** → 现役事实进 docs，过程进 git log / `docs/CHANGES.md`，memory 不留常驻文件。

判据一句话：**「下一个接手的人（不只是我自己）需要知道这件事吗？」需要 → 它属于 docs，不是 memory。**

**效用信号辅助毕业/淘汰判断**：同步时给本次会话实际引用过的记忆条目在索引行补「最后引用 `YYYY-MM-DD`」；连续多次同步未被引用且非 `reference_` 类的条目列为淘汰候选。记忆的价值在被用到——实证研究表明「只增不删」的记忆库会直接拖低任务成功率，长期没人引用的记忆是负资产。

> 记忆文件若用类型前缀（如 `feedback_`=教训 / `project_`=决策事件 / `reference_`=速查），生命周期不同：`reference_` 通常合法长期常驻；`feedback_` 稳定后毕业；`project_` 多数是事件记录，**是优先毕业 / 删除的对象**——决策结论进 docs，过程进 changelog。`reference_` 类视为**只读参考层**：日常会话不动它，变更只经由本 skill 的同步流程。
>
> **毕业的去向只有两个：docs/ 或 CLAUDE.md。本 skill 永远不把记忆毕业成 skill，也永远不新建任何 skill——这是用户的明确约定，任何情况下不要提议突破。**

### CLAUDE.md / AGENTS.md 是规则手册，不是变更日志（重要）

最常见的 skill 翻车模式：每次开发完都在 CLAUDE.md 顶部加一段 blockquote 历史叙事——"2026-05-08 X 功能上线，详见 docs/Y.md"。一次很爽，半年后顶部就是 200 行 blockquote 把真正的规则推到看不见。**这种叙事不属于 CLAUDE.md**，它的归宿是 git log / `/changelog` 页 / `docs/CHANGES.md`。

判断一条信息该不该进 CLAUDE.md，问一句：**下次 AI 写代码时如果没看到这条，会不会犯错？**

| 例子 | 进 CLAUDE.md？ | 理由 |
|---|---|---|
| "Prisma 查询只写在 `modules/**/data/`" | ✅ | 违反就是边界破坏，AI 必须看到 |
| "rsync 单文件部署必须用完整 target 路径" | ✅ | 踩坑警示，会再次踩 |
| "禁止裸跑 systemctl stop aihot-worker" | ✅ | 红线，事故级 |
| "2026-05-08 timelineAt 上线，详见 docs/ARCHITECTURE.md §5.4" | ❌ | 详细机制在 docs；AI 改到这块自然会读 docs；「深入文档」指针表已做这件事 |
| "2026-04-30 起公网开放，匿名可访 /、/all" | ❌ | 既是历史也是事实，但事实归 docs/ARCHITECTURE.md §8 + 项目概览一句话足矣 |
| "5/8 修了 X bug 的复盘细节" | ❌ | 单次事故记忆，归 memory 或干脆删 |

✅ 该进 CLAUDE.md 的内容：硬边界规则、禁止事项、命令速查、权限模型、协作流程、深入文档指针表、踩坑警示。
❌ 不该进的：历史叙事（"X 时刻起 Y 上线"）、详细机制说明、单次事故复盘、bug fix 流水账、"详见 docs/Z.md" 的指针句子（这个角色已经被「深入文档」指针表占掉了）。

### 规则层也是知识——它同样会烂

全局指令、工作空间 CLAUDE.md、项目 CLAUDE.md 构成一个层级规则体系。规则不是只读背景：它引用的项目会被删掉（死引用）、它定的约定会被后来的实践悄悄违反（漂移）、上下两级会互相打架（矛盾）。没人审计的规则会退化成装饰品。

处理规则层有一条铁律：**规则的真身永远在层级 CLAUDE.md 里，本 skill 不复制任何具体规则内容**——复制会制造两处真相，规则一改副本就烂，这正是洁癖要消灭的头号病。所以你的做法永远是：**现场读规则 → 提取可核验项 → 核对实践 → 处置**（具体流程在第二步）。

## 执行流程

### 第零步：尺寸体检（防膨胀）

任何同步动作之前，先 `wc -l` 关键文件：

| 文件 | 上限 | 超过怎么办 |
|---|---|---|
| `CLAUDE.md` / `AGENTS.md` | ~300 行 / ~15KB（软） | 先精简：扫顶部 blockquote / 历史叙事段 → 删 / 迁 docs；项目概览只留 1-3 行 + 速查表，不做"提醒下次会话"用。（CLAUDE.md 每会话全量常驻加载，不会被截断，但它占用的是最贵的注意力预算——只配放普遍适用的内容，这也是 Anthropic 官方判据） |
| 记忆索引 `MEMORY.md` | **≤200 行 且 ≤25KB（硬）** | Claude Code 只加载 `MEMORY.md` 的前 200 行或前 25KB（先到先算），**超出部分在会话开始时静默不加载——等于没记**。务必压在 ~150 行 / ~18KB 留缓冲。压法不是硬删，是下面的「毕业」机制：详细机制提升进 docs、索引只留一行指针 |
| 单条 memory 文件 | ~100 行（软） | 通常在塞多件事 / 写成事故复盘 → 拆 / 删；**若是稳定机制说明，提升进 docs 再把记忆缩成 reference 指针** |
| `docs/<single>.md` | ~1500 行（软） | 切分成多文件，加目录索引 |

**额外做一次「体量倒挂」体检**：`du -sh <memory 目录>` 对比 `du -sh docs/`。**健康态是 docs 厚、memory 薄**——docs 是沉淀的权威层，memory 是流动的「最近教训 + 指针」层。若 memory 反而比 docs 大，几乎一定是「本该毕业进 docs 的稳定知识还赖在松散记忆文件里」，按「毕业」机制往上泵，别只在 memory 内部挪。

**超尺寸是这个 skill 的最高优先级，大于"补本次会话漏掉的同步"。** 原因：`MEMORY.md` 超 25KB 的部分根本不进上下文（静默丢失），超尺寸的 CLAUDE.md 让真正的规则被叙事段挤出 adherence——两种情况下，同步再补都徒劳。

**执行顺序**：先精简（破除膨胀）→ 再做本次会话增量同步（补漏）。两件事不能合并——精简时心态是"什么不该在这"，补漏时心态是"什么该补到这"，混着做会两头不到位。

体检读数（行数 / 字节数 / 距上限百分比）记下来，最后要进变更摘要——用户看不到读数，就永远不知道自己离静默截断有多近。

### 第一步：盘点现状（强制机械式枚举，不能跳过）

**先做 ls，再做判断。**

0. **平台探测**：`ls -d ~/.claude ~/.codex ~/.config/opencode ~/.openclaw ~/.workbuddy 2>/dev/null`——只盘点真实存在的平台，不存在的平台整层跳过（别按想象中的路径空跑）。WorkBuddy 存在时，记忆层要同时查用户级 `~/.workbuddy/MEMORY.md` 和当前工作区 `.workbuddy/memory/` 两层。
1. 列出 agent 的记忆文件（如有）：
   - Claude Code：`ls ~/.claude/projects/<...>/memory/` 并读 `MEMORY.md` 及所有被引用的 `.md`
   - Codex / OpenCode / 其他：找该 agent 的等价位置（见 references/agent-paths.md）
2. 对本次对话涉及的**每一个项目**：
   - `ls <project-root>/` → 确认根目录结构
   - `ls <project-root>/docs/ 2>/dev/null` → **枚举所有 docs**（缺失也要确认）
   - `find <project-root> -maxdepth 2 -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*"` → 兜底抓散落的 .md
   - 读 `README.md`、`CLAUDE.md` / `AGENTS.md`、每一个 `docs/*.md`
3. **向上收集规则文件**：从项目根往上走到工作空间根（如 `~/code`），把沿途每一级的 `CLAUDE.md` / `AGENTS.md` 都读了，再读全局配置（`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`，若存在）。这些是第二步规范审计的依据。
4. 回顾本次对话全部内容

**输出一张文件清单**（内部用，不用给用户看），对每个文件标：「评估过 / 要改 / 不用改」。**漏一个不行**——这是这个 skill 最容易翻车的地方。

### 第二步：规范执行审计（规则 → 实践）

拿着第一步收集的层级规则文件，做两个方向的审计。范围默认是**当前项目 + 它的直接上级工作空间**；用户明确说「审全部」才做全仓扫描。

**方向一：实践有没有跟上规则。** 从规则文件里提取「可机械核验的约定」——特征是谈论文件、目录、命名、必备内容的祈使句。常见类别（以现场读到的规则为准，不要背这张清单）：

- **命名约定**：如目录必须 kebab-case → `ls` 核对当前项目及同级项目名
- **必备文件**：如每个项目必须有 CLAUDE.md、线上项目必须在顶部声明 URL → 检查存在性和内容
- **同源约束**：如 AGENTS.md 必须是指向 CLAUDE.md 的软链 → `readlink` 核对
- **红线**：如 `.gitignore` 必须含 `.env*`、密钥不进代码 → grep 核对
- **目录纪律**：如根目录不允许裸放文件 → `ls` 核对

**处置分级**（关键，别一把梭）：

| 类型 | 例子 | 处置 |
|---|---|---|
| 安全、可逆、纯补齐 | 补 AGENTS.md 软链；给缺 CLAUDE.md 的项目按模板建脚手架；`.gitignore` 补 `.env` 条目 | **直接修**，摘要里报告 |
| 破坏性、有外部影响 | 目录重命名（会破坏 git remote、部署脚本、Syncthing 路径、他人引用）；删除文件；合并两份内容不一致的 CLAUDE.md/AGENTS.md（要先人工确认哪边是权威） | **不动手**，列入摘要「待你拍板」，附影响说明和建议 |

**同类违规反复出现 → 建议 hook 化**：同一条规则在多个项目或多次同步中反复被违反，说明散文规则挡不住它——散文规则是建议性的，hook 是确定性的。在「待你拍板」里建议用户把这条规则转成 hook（事中强制拦截），从「每次事后修」升级为「一次性根治」。本 skill 只建议，不代配 hook。

**方向二：规则文件本身有没有烂。** 规则也是文档，用同样的洁癖标准审它：

- **死引用**：规则里提到的路径 / 项目 / 命令还存在吗？（grep 出路径 → `ls` 核验）项目确认已删的，把引用清掉；拿不准的列「待你拍板」
- **矛盾**：上下两级规则打架、规则与 skill 的指引打架、同一文件内自相矛盾 → 能判断哪边是现行事实的直接改，判断不了的列出来
- **漂移**：规则说 X，但所有项目实际都在做 Y 且运转良好 → 这可能是规则过时而非实践错误，列「待你拍板」建议改规则

**对全局配置（`~/.claude/CLAUDE.md` 等）的克制要分清方向**：克制的是**新增内容**——日常项目细节绝不写进全局；但**清理是减法**，死引用、过期事实、矛盾照样要修或上报，别拿「克制」当不审计的借口。

### 第三步：识别变更——用"变更影响矩阵"思考

**不要只看对话增量有什么新事实，要看新事实会波及哪些文档层级。**

常见模式速览：
- 新增 API / 路由 → CLAUDE.md 路由清单 + integration-guide + architecture 的 Routes
- 新增 / 改名 环境变量 → CLAUDE.md 环境变量表 + runbook + 下游 integration-guide
- 新增数据库表 → CLAUDE.md + architecture 的 Data Model
- 新增大特性（跨多文件） → 以上全部 + architecture 新章节 + handoff 已完成清单
- 跨项目改动 → 上下游两边的 docs **都要对齐**（最常见的漏改场景）
- **退役 / 改名 / 下线** → `git show <删除 commit> --stat` 取被删的路由/导出符号/字段/枚举名，对每个跑 `grep -rn '<symbol>' docs/ <本 agent 记忆目录>`（Codex 还要 grep `~/.codex/AGENTS.md` + `~/.codex/memories/skills/`），**在同一次同步里清掉非载荷引用（示例代码/历史案例/枚举列举）**，别留到事后的「补漏」commit。死 skill 目录整个删。
- 记忆层面：相对时间→绝对日期、过期事实→改、重复→合并、已完成待办→删
- **过期开放项扫描**：grep 记忆里同时带「开放项标记（待办/未决/暂缓/搁置/待评估/仍未/观察期再评估/TODO）」**且**「绝对日期早于今天」的行（别裸扫日期——绝对日期满天飞、大多是正确历史；marker 同行才是信号）。每条强制处置：① 已落地→链接 commit 并删；② 没落地→从「计划」降级为「未决，未排期，触发条件=X」，别让它再冒充已排期承诺；③ 已放弃→删。**写「已完成」前先对照真实代码与产物核实**，别假设已上线。

完整映射表（覆盖更多变更类型与对应文档）见 **references/sync-matrix.md**——遇到不确定的改动先查这张表。

**关键检查**：这次对话是不是**跨项目**的？如果改了项目 A 且项目 B 依赖它（通过 SDK、API、子域、环境变量），**项目 B 的 docs 也要改**。这是历次同步最常翻的车。

### 第四步：实际修改（用工具，不只是描述）

你必须**真的用 Edit 修改现有文件、用 Write 创建新文件、用删除命令清理废弃文件**。"我会怎么改"的描述不算完成。

**顺序建议**：先改 docs/（改错影响外部）→ 再改 CLAUDE.md/AGENTS.md → 最后理记忆。先动外部优先级最高的，即使中途被打断，读者看到的也是对齐的最新状态。

**编辑原则**：

- **减优于加**（最重要）：每次同步动作结束后，CLAUDE.md / AGENTS.md 净涨幅 > 30 行就是红灯——很可能在写历史叙事而不是补规则。回头审：这条加的是"下次 AI 写代码时必须看到"的规则，还是"上次会话告诉下次会话发生了什么"的便条？后者就是病。能删的先删，不能删的迁去 docs，最后剩下的才是规则。
- **合并优于追加**：新信息是对旧信息的更新，改旧条目；新加条目前先 grep 同关键字，看现有条目能不能并
- **删除优于保留**：完成的临时计划、推翻的决策、已被新版本取代的项目记忆、单次事故的流水账复盘——删
- **毕业优于内部挪腾**（针对 memory）：一条记忆稳定、复用、或本属「系统怎么工作」时，别在 memory 里搬来搬去——并进 docs / CLAUDE.md，原文件缩成一行指针或删。这是把 memory 压回「薄」的唯一治本手段（见上「毕业」机制）
- **精确优于冗长**：一条记忆说清楚一件事，别塞三件
- **绝对时间**：永远 `2026-04-29`，不写"今天"、"最近"
- **面向读者**：docs/ 的读者是"第一次接触这个项目的外部人"，写的时候想象对方只有 5 分钟能看完
- **受众不混**：CLAUDE.md 里不抄 docs/ 的全文，docs/ 里不写"我记得上次……"——这是记忆的事
- **指针不重复**：同一条事实如果 docs/ 里已详写，CLAUDE.md 只在「深入文档」指针表里出现一次，不在概览段再叙事一次
- **同源不分叉**：CLAUDE.md 与 AGENTS.md 必须同源（软链，CLAUDE.md 为真身）。永远只编辑 CLAUDE.md；发现两份独立文件，按第二步的处置分级走

**docs/ 编辑要点**——新增一个能力的文档变更通常要四处都补：
1. **integration-guide** 或对应"外部视角"文档：加**怎么用**（curl / SDK 示例 / 错误码表）
2. **architecture**：加**怎么工作**（数据流、状态机、设计取舍）
3. **runbook**：加**怎么运维**（冒烟命令、故障排查、环境变量）
4. **handoff** 或 CHANGELOG：加**已完成**

API 速查表、环境变量表、术语表是高频查询的结构化信息，**必须保持"所见即最新"**。

### 第五步：自检清单（必须逐项过一遍）

这一步同时防止"漏改 docs" + "误把叙事塞进 CLAUDE.md" + "规范审计走过场"。改完后逐条检查：

**尺寸 / 反膨胀（先查这组，不达标的话回头先精简）**：
- [ ] CLAUDE.md / AGENTS.md 净涨幅 ≤ 30 行（超了就是塞了历史叙事，回去删 / 迁 docs）
- [ ] 没新增 "X 起 Y 上线，详见 docs/Z.md" 这种 blockquote 历史叙事条目
- [ ] 没在 CLAUDE.md 里抄 docs/ 已有的详细机制说明
- [ ] 单条 memory 文件没超 ~100 行（超了拆 / 删 / 改成 reference）
- [ ] **记忆索引 `MEMORY.md` ≤ 25KB 且 ≤ 200 行**（`wc -c` 实测；超出部分会话开始时静默不加载 = 等于没记）
- [ ] **体量没倒挂**：`du memory` 不应大于 `du docs/`；倒挂了说明有该毕业进 docs 的知识赖在 memory，回去毕业

**规范执行（第二步的产出核对）**：
- [ ] 层级规则文件从项目根读到了工作空间根 + 全局
- [ ] 可核验约定逐条核对过：每条违规要么已修（安全类），要么进了摘要「待你拍板」（破坏类）——没有第三种"看见了但没记录"
- [ ] AGENTS.md 与 CLAUDE.md 同源（软链完好，没有内容分叉的两份文件）
- [ ] 规则文件里引用的路径 / 项目在现实中存在（死引用已清或已上报）

**完整性 / 反漏改（再查这组）**：
- [ ] 第一步列出的每个文件，都判断了"不用改"或"已改"
- [ ] 记忆索引（若有）里的每个链接指向存在的文件
- [ ] 每个记忆文件的 description 和内容对得上
- [ ] 记忆之间没有互相矛盾
- [ ] **没有过期开放项冒充活计划**：带「待办/未决/暂缓」且日期早于今天的行，都已核实落地与否并处置（链 commit 删 / 降级为未决 / 删）
- [ ] **退役类改动**：被删 symbol 在 docs/ + 记忆（含 Codex `~/.codex/`）里的非载荷引用已清，死 skill 目录已删
- [ ] CLAUDE.md / AGENTS.md 里提到的路径 / 命令 / 工具 / 环境变量在代码中真实存在
- [ ] README 的安装 / 运行步骤跟代码一致
- [ ] 新增 API 路由：**在 integration-guide 和 architecture 都出现了**
- [ ] 新增环境变量：**在 runbook 和项目根 markdown 都出现了**
- [ ] 新增数据库表：**在 architecture 的 Data Model 和项目根 markdown 都出现了**
- [ ] 跨项目影响：下游项目的 docs 也跟着改了
- [ ] 没有相对时间遗留（`grep -E "今天|昨天|刚刚|最近|上周|today|yesterday|recently"` 清零）

哪条打不了勾，**回去补**。不要因为"差不多了"就跳过这一步——这是这个 skill 的灵魂。

### 第六步：变更摘要

在所有文件修改完之后（不是之前），给用户简洁摘要：

```
## 同步完成

### 记忆变更
- 更新：xxx（原因）
- 新增：xxx
- 删除：xxx（原因）

### 文档变更（按项目分组，每个项目列全改动的文件）
- <项目 A>/CLAUDE.md — xxx
- <项目 A>/docs/integration-guide.md — xxx
- <项目 B>/docs/<integration>.md — xxx

### 规范审计
- 自动修复：xxx（如：补了 AGENTS.md 软链）
- 待你拍板：xxx（为什么破坏性 / 建议怎么处理）

### 体检读数（仅在逼近上限时列出）
- <项目> MEMORY.md：N 行 / N KB —— 已达上限的 N%，建议毕业 xxx

### 未处理
- xxx（为什么没处理）
```

只列有实际变更 / 需要行动的条目。没改的不写；体检读数只在超过上限 70% 时展示（低于就静默）——摘要是行动引导，不是巡检日志。

## 特殊情况

**项目还没有 README 或 CLAUDE.md/AGENTS.md**：判断项目是不是到了"有可运行代码"的阶段。是 → 创建（工作空间规则有模板就按模板）。还在 vibe 阶段 → 跳过，但在摘要里提一句。

**对话没有产生新事实**：审查现有记忆和文档有没有过期 / 冲突 / 相对时间，并跑一遍第二步规范审计——审查本身就有价值。

**需要用户介入的情况只有两类**：① 记忆 / 规则之间出现无法自动判断的矛盾；② 破坏性的规范修复（重命名、删除、合并分叉文件）。这两类列进「待你拍板」，其他都自己拍板。

**跨项目改动**：本次对话改了多个项目，每个项目都要跑一次完整的第一步（ls + 读 docs）。不要假设一个项目的 docs 改了，另一个就不用。尤其是上游-下游对接文档（集成指南 / SDK 说明 / API 协议），两边都要对齐。

**发现之前的同步漏了东西**：修掉。不要说"那不是这次对话的事"——你就是这个项目的持续编辑，过去的漏洞也归你管。

## 参考资料

- **references/sync-matrix.md** — 完整的"变更类型 → 要改哪些文件"映射表
- **references/governance.md** — 规范执行审计的可核验约定类别与处置细则
- **references/agent-paths.md** — Claude Code / Codex / OpenCode / OpenClaw 各自的记忆与配置路径速查

---

## 附录：原始 skill 包的参考文件

以下内容来自本地 skill 包的 `references/` 目录，迁移时内联以保持单文件自洽；正文中出现的 `references/*.md` 均对应下方同名小节。

### references/sync-matrix.md

# 变更影响矩阵

遇到不确定"这次改动要同步哪些文件"时查这张表。**两个方向都要查**：补漏（加到哪些文件）+ 防膨胀（应该从哪些文件删）。

## 反向：哪些信息该从 CLAUDE.md / 记忆里删除

CLAUDE.md / AGENTS.md 不是变更日志。下面这些反模式发现了就删 / 迁：

| 反模式 | 处理 |
|---|---|
| "X 时刻起 Y 功能上线，详见 docs/Z.md" 形式的 blockquote | 删除——指针角色已经被「深入文档」指针表占掉，叙事归 git log / `/changelog` / `docs/CHANGES.md` |
| 在 CLAUDE.md 里抄 docs/ 已有的详细机制 / 数据流 / 评分公式 | 删除——AI 改到这块自然会读 docs，CLAUDE.md 只留"边界规则" |
| 已经稳定 ≥ 7 天的"新功能上线"叙事 | 该融入项目概览的融入；纯历史的删 |
| 一次性事故的复盘细节（"X 时 Y 服务挂了 30min 因为 Z"） | 留 1 行红线规则（"不要再裸跑 systemctl stop X"），事故详情归 docs/PLAYBOOK.md 或删 |
| 已被新版本取代的"中间态"叙事（"5/6 改了 X，5/8 又改成 Y"） | 只留最终态规则；中间历史删 |
| 单条 memory > 100 行 + 全是事故复盘 | 提炼成一条 ≤ 30 行的"规则 + Why + How to apply"；多余的删 |
| 记忆条目里"已被 X 取代" / "已废弃" / "保留作历史" 字样 | 99% 真的可以删，docs 已经是权威 |

判断标准：**这条信息在下次 AI 写代码时如果没看到，会犯错吗？** 不会就删 / 迁。

## 代码层变更 → 文档层变更

| 本次对话发生的事 | 要改的文件(按受众) |
|---|---|
| 新增 API / 路由 | 项目根 markdown 路由清单 · `docs/integration-guide.md` API 速查表 · `docs/architecture.md` Routes 小节 |
| 新增 / 改名 环境变量 | 项目根 markdown 环境变量表 · `docs/operator-runbook.md` 环境变量章节 · `docs/integration-guide.md`(如果下游要配) |
| 新增数据库表 / 列 | 项目根 markdown 数据库表 · `docs/architecture.md` Data Model |
| 新增 / 改动 用户流程 | 项目根 markdown 用户流程 · README 相关命令行示例 · `docs/handoff.md` What Exists Today |
| 新增大特性(能跨多文件) | 以上全部 + `docs/architecture.md` 新增章节 + `docs/handoff.md` 已完成清单 |
| 新增术语 / 改命名 | `docs/integration-guide.md` 术语表(如果有)+ 全局搜索旧术语替换 |
| 部署参数 / 基础设施变化 | `docs/operator-runbook.md` · 项目根 markdown 部署章节 |
| 下游项目接入方式变化 | 下游项目的 `docs/<integration>.md` · 上游项目的 `integration-guide.md` |

## 记忆层变更

| 情况 | 处理方式 |
|---|---|
| 过期事实 | 改记忆文件,同时更新索引(如 MEMORY.md)的 description |
| 相对时间("今天"、"最近") | 全部转成绝对日期(`2026-04-29` 而非"今天") |
| 重复记录(多条说同一件事) | 合并为一条,改索引 |
| 已完成的待办 | 删除——知识库不是历史档案 |
| 推翻的决策 | 删除旧条目,留新决策 |
| 跨会话只用一次的临时上下文 | 删除 |
| 本次会话引用过的记忆条目 | 索引行更新「最后引用 YYYY-MM-DD」 |
| 连续多次同步未被引用且非 reference 类 | 列为淘汰候选:毕业进 docs 或删除(膨胀的记忆库实测拖低任务成功率) |

## 规范违规 → 处置

规范执行审计（SKILL.md 第二步）发现的违规,处置速查（细则见 governance.md）:

| 发现 | 处置 |
|---|---|
| AGENTS.md 缺失或不是软链(但 CLAUDE.md 在) | 直接补 `ln -s CLAUDE.md AGENTS.md` |
| CLAUDE.md 与 AGENTS.md 两份独立且内容不一致 | 待用户拍板——合并需要确认哪边权威 |
| 有可运行代码但缺 CLAUDE.md | 按工作空间模板建脚手架 |
| 目录命名违反工作空间约定 | 待用户拍板——重命名有外部影响(Syncthing / 脚本 / 引用) |
| .gitignore 缺红线条目(.env 等) | 直接补 |
| 规则文件引用了已删除的项目/路径 | `ls` 核实确已删除 → 清引用;拿不准(可能在别的设备) → 待用户拍板 |
| 上下级规则矛盾 | 能从现状判断现行版本的直接改,不能的待用户拍板 |

## 跨项目影响检查

最容易漏改的场景:

- **上游 API 变了 → 下游 SDK 文档**:协议变化必须两边对齐
- **共享子域 / 路由 / 环境变量改了 → 所有 consumer 项目的 setup 文档**
- **认证中台变更 → 所有接入应用的 integration guide**
- **公共组件 / 基础设施 升级 → 各项目的 operator-runbook 提及版本号的地方**

判断方法:这次改的东西有没有 SDK、子域、共享配置、跨进程协议?有就要在所有依赖项目里搜一遍提到这件事的文档。

## 文档结构通用约定

新增一个能力(API、flow、特性)的标准动作是**四处都补**:

1. **integration-guide / 外部视角文档**:怎么用(curl / SDK 示例 / 错误码)
2. **architecture**:怎么工作(数据流、状态机、设计取舍)
3. **runbook**:怎么运维(冒烟命令、故障排查、环境变量)
4. **handoff / CHANGELOG**:已完成

API 速查表、环境变量表、术语表是高频查询的结构化信息,**必须保持"所见即最新"**。

### references/governance.md

# 规范执行审计细则

SKILL.md 第二步的展开。核心铁律再说一遍：**规则的真身在层级 CLAUDE.md 里，本文件不复制任何具体规则内容**——这里只有「怎么提取、怎么核验、怎么处置」的方法。规则改了，这套方法不用改。

## 提取：什么算「可机械核验的约定」

读层级规则文件时，找**谈论文件、目录、命名、必备内容的祈使句**。判断标准：能不能写成一条 shell 命令来核验？能 → 提取；不能（如"沟通要结论先行"）→ 跳过，那是行为约定不是结构约定。

| 类别 | 规则句式特征 | 核验手段 |
|---|---|---|
| 命名约定 | "文件夹名必须 X"、"禁止 Y 前缀/后缀" | `ls` + 逐个名字比对 |
| 必备文件 | "每个项目必须有 X"、"顶部必须声明 Y" | 存在性检查 + 读文件头 |
| 同源约束 | "A 必须软链到 B"、"永远只编辑 B" | `readlink`、`file` |
| 红线 | ".gitignore 必须含 X"、"密钥不进代码" | `grep` |
| 目录纪律 | "根目录不允许裸放文件"、"X 只能放在 Y 下" | `ls` + 类型判断 |
| 声明一致 | "CLAUDE.md 里写的启动命令/URL/路径必须真实" | 对照代码与配置核验 |

提取时**引用原文出处**（哪个文件哪一节），处置时用户才知道依据是什么。

## 核验范围

- 默认：当前项目 + 直接上级工作空间的同级项目**名字层面**（名字核验是 `ls` 一眼的事，成本为零；同级项目的**内容**不审）
- 用户说「审全部」/「整个工作空间」：逐项目跑存在性与同源检查，仍不逐个读同级项目全文
- 全局配置文件：只做方向二（死引用 / 矛盾），不做新增

## 处置分级（完整版）

判断一个修复动作属于哪级，问一个问题：**改错了能不能一步撤销、会不会影响项目目录以外的东西？**

### 直接修（安全、可逆、纯补齐）

- 补 `AGENTS.md → CLAUDE.md` 软链
- 给缺 CLAUDE.md 且已有可运行代码的项目建最小脚手架（工作空间规则有模板就按模板）
- `.gitignore` 补红线条目（`.env`、`.env.local` 等）
- 规则文件里指向**确认已删除**项目的引用：清掉（清理前 `ls` 核实项目真的不在了）
- 规则文件内的相对时间、明显笔误

### 待你拍板（破坏性 / 有外部影响 / 需要权威判断）

- **目录重命名**（命名违规的修复）：会破坏 git remote 对应关系、部署脚本路径、Syncthing 同步状态、其他文档里的引用。列出违规项 + 建议名 + 受影响面
- **删除文件 / 目录**：除非规则明文授权（如"发现 X 直接删"）
- **合并两份内容不一致的 CLAUDE.md / AGENTS.md**：需要人工确认哪边是权威、哪些差异是有意的
- **规则漂移**：规则说 X，但所有项目实际做 Y 且运转良好——可能该改的是规则。列证据，建议改规则还是改实践
- **规则矛盾**：上下级打架且无法从现状判断哪边现行
- **反复违规的规则**：同一条规则跨项目/跨会话反复被违反——建议 hook 化（转成事中强制拦截），附违规次数证据；本 skill 只建议、不代配 hook

### 摘要格式

```
### 规范审计
- 自动修复：
  - readclip 补 AGENTS.md 软链（依据：全局 CLAUDE.md「同源」节）
- 待你拍板：
  - FIFA_World_Cup 目录名违反 kebab-case（依据：code/CLAUDE.md 命名约定）。
    建议改为 fifa-world-cup；影响：git remote 不受影响（本地目录名与 remote 无关），
    但 Syncthing 会视为删除+新建，同步端需注意。
```

每条违规都带**依据出处**和**影响说明**——用户拍板需要的是判断材料，不是待办清单。

## 常见误判提醒

- **`work/` 下沿用公司既定名称的项目不算命名违规**——先看规则原文有没有例外条款，再报违规
- **sandbox / 一次性目录**通常被工作空间规则明确豁免（如"对 sandbox/ 放宽"），豁免的不报
- **规则引用的路径在另一台机器上**（多设备同步场景）：`ls` 不在 ≠ 已删除，拿不准就列「待你拍板」而不是直接清
- 报告违规前**重读一遍规则原文**——很多"违规"是你记岔了规则，不是实践错了

### references/agent-paths.md

# Agent 记忆与配置路径速查

不同 agent 平台的记忆系统和项目配置文件位置不一样。执行第一步盘点时按你正在使用的平台查这张表。

## Claude Code

| 用途 | 路径 |
|---|---|
| 跨会话记忆(全局) | `~/.claude/projects/<encoded-project-path>/memory/` |
| 记忆索引文件 | `~/.claude/projects/<...>/memory/MEMORY.md` |
| 全局指令 | `~/.claude/CLAUDE.md` |
| 项目级指令 | 项目根 `CLAUDE.md`(可层级嵌套) |
| Skills 目录 | `~/.claude/skills/<name>/SKILL.md` |

记忆文件用 YAML frontmatter:`name`、`description`、`type`(user / feedback / project / reference)。

## OpenAI Codex

| 用途 | 路径 |
|---|---|
| 跨会话指令(全局，手改、权威) | `~/.codex/AGENTS.md` 或 `$CODEX_HOME/AGENTS.md` |
| 项目级指令 | 项目根 `AGENTS.md`(可层级嵌套；常软链到 `CLAUDE.md`) |
| 项目级 override | `AGENTS.override.md`(若存在,覆盖同目录 AGENTS.md) |
| 自动记忆库(机器生成) | `~/.codex/memories/`(git 仓)：`MEMORY.md` 索引 + `memory_summary.md` + `raw_memories.md` + `rollout_summaries/` |
| 全局 Skills | `~/.codex/skills/<name>/SKILL.md` |
| 钉住的记忆型 Skill | `~/.codex/memories/skills/<name>/SKILL.md` |
| 项目内 Skills | 项目内 `.codex/skills/<name>/` |

**纠正旧说法**：Codex **有**独立记忆库 `~/.codex/memories/`，但它是**机器自动生成**的——由会话 rollout 经 Chronicle 管线蒸馏（`rollout_summaries/` → `raw_memories.md` → `MEMORY.md`）。所以同步时分两层处理：

- **手改、权威的跨会话事实** → 写进 `~/.codex/AGENTS.md`（全局）或项目根 `AGENTS.md`（项目级，aihot 即软链 CLAUDE.md）。这是 neat-freak 真正要对齐的目标。
- **`~/.codex/memories/` 里的 rollout 派生文件（MEMORY.md / raw_memories.md / memory_summary.md）不要手改**——它们是「某次会话里做过 X」的历史记录，会按 rollout 重新生成，手删等于白删。把功夫花在 AGENTS.md。
- **唯一该手动清的**：`~/.codex/memories/skills/<feature>/` 与 `~/.codex/skills/<feature>/` 下的**死 skill**（指向已退役功能的、不会自动重生）。退役一个功能时一并删掉对应 skill 目录（在 memories git 仓里 commit，可审计）。

发现项目里有 `TEAM_GUIDE.md` 或 `.agents.md` 也要看——这是 Codex 的 fallback 文件名。

## OpenClaw

| 用途 | 路径 |
|---|---|
| 用户级 skills | `~/.openclaw/skills/<name>/SKILL.md`（首次运行自动创建） |
| 项目级 skills | `.openclaw/skills/<name>/SKILL.md`（仓库根目录下） |
| Workspace skills | 当前 workspace 的 `skills/` 目录 |

**加载优先级**：workspace > project-agent > personal-agent > managed/local > bundled > extra dirs。同名 skill 高优先级覆盖低优先级。

OpenClaw 没有独立的"记忆文件 + 索引"机制，跨会话信息可放在项目根的 markdown（CLAUDE.md / AGENTS.md / 等价文件）里，参照 Codex 的做法。frontmatter 支持 `metadata.openclaw` 字段做加载时的 gating（按 OS、环境变量、二进制依赖筛选），但不是 neat-freak 必需的。

## OpenCode

| 用途 | 路径 |
|---|---|
| 全局配置 | `~/.config/opencode/` |
| 项目配置 | `.opencode/` |
| Skills 目录(项目) | `.opencode/skills/`、`.claude/skills/`、`.codex/skills/` 都会被扫描 |
| Skills 目录(全局) | `~/.config/opencode/skills/`、`~/.claude/skills/`、`~/.codex/skills/` |

OpenCode 同时读取 Claude Code 和 Codex 的目录,所以同一个 skill 装在 `~/.claude/skills/` 下的话三家都能识别。OpenClaw 走自己的 `~/.openclaw/skills/`，需要单独装一份（或用符号链接）。

## WorkBuddy（本机实测）

WorkBuddy 的记忆是**双层结构**，两层都要盘点，漏了工作区层就等于没同步。

| 用途 | 路径 |
|---|---|
| 用户级长期记忆（跨项目） | `~/.workbuddy/MEMORY.md` |
| 工作区长期记忆（提炼过的项目约定） | `<workspace>/.workbuddy/memory/MEMORY.md` |
| 工作区日志（每日追加，append-only） | `<workspace>/.workbuddy/memory/YYYY-MM-DD.md` |
| 项目级指令 | 项目根 `CLAUDE.md` / `AGENTS.md` |
| 用户级 Skills | `~/.workbuddy/skills/<name>/SKILL.md` |
| 项目级 Skills | `<workspace>/.workbuddy/skills/<name>/SKILL.md` |

要点：

- **写日志是 append-only**——今天没有 `<workspace>/.workbuddy/memory/YYYY-MM-DD.md` 就新建，有就**追加**，绝不覆盖。
- **日志不是记忆**：日志是流水（"做了什么"），`MEMORY.md` 是提炼（"约定是什么"）。稳定下来的事实要从日志毕业进 `MEMORY.md` 或 `docs/`，否则工作区记忆目录会一路膨胀。
- **容量约束**：`MEMORY.md` 用户级限 4000 字符/次、工作区级限 3000 字符/次。超了就精简，跟 SKILL.md 第零步的尺寸体检同一个道理。
- **`.workbuddy/` 目录是项目数据，不是缓存**——清理磁盘或做 tidy 时**绝不删这个目录**。
- 平台探测时把 `~/.workbuddy` 加进第一步的 `ls -d` 列表里。

## 如果当前 agent 没有独立记忆系统

跳过"记忆"那一层,把功夫全花在:
- 项目根 markdown(CLAUDE.md / AGENTS.md / 本平台等价文件)
- README.md
- docs/

仍然是有效的同步——记忆是锦上添花,docs 才是项目知识的最低保障。

## 跨平台共存策略

如果一个项目同时被 Claude Code 用户和 Codex 用户使用:

- **`CLAUDE.md` 是真身,`AGENTS.md` 是指向它的软链**(`ln -s CLAUDE.md AGENTS.md`),永远只编辑 CLAUDE.md
- **绝不允许两份独立维护**——两处真相必然分叉,分叉必然有一边烂。发现两份内容不一致的独立文件,按 SKILL.md 第二步的处置分级走:合并需要人工确认哪边是权威,列「待你拍板」
- 若工作空间层级规则对同源机制另有声明,以工作空间规则为准
- docs/ 和 README 是平台中立的,不需要分两份
