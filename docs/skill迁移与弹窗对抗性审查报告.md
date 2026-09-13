# 对抗性审查报告：skill 迁移与详情弹窗

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-09-13 |
| 范围 | 本次 skill 迁移引入的改动（`build.py` 正文字段、`public/app.js` 与 `public/style.css` 的 skill 弹窗、`content/skills/` 迁移结果） |
| 方式 | 逐条追问「这段新代码依赖了什么前提、哪种输入会让它静默失败」，并对每个修复做反向验证 |
| 结论 | 发现 1 个 P1 测试覆盖缺口、1 个 P2 体验缺陷、1 个 P3 静默失败，均已修复；3 项已知取舍维持现状 |

---

## 1. P1 弹窗逻辑完全没有被测试覆盖

**缺陷**：`tests/dom_stub.js` 注册了 `modal`、`modal-body`、`modal-actions` 这些 id，
但**从未点击过任何卡片**。也就是说 `openModal()` 在测试里一次都没执行过。
本次改动给 skill 弹窗加了三条分支（有没有正文、有没有 url、要不要给复制按钮），
全部落在零覆盖区域。

**为什么之前没暴露**：桩的重点一直是瀑布流分列（那里踩过 P0），列表渲染测得很密，
弹窗则长期靠手工验收。代码看上去一切正常——因为根本没人跑过。

**修复**：补四组断言，覆盖组合而不是「渲染出来了」：

| 用例 | 断言要点 |
| --- | --- |
| Prompt | 正文渲染 + 只有复制按钮 |
| Skill 有正文有链接（grill-me） | 简介 + 正文 + 复制 + 打开 GitHub |
| Skill 有正文无链接（legacy-deploy-to-git） | 只有复制按钮，不出现跳转 |
| Skill 无正文（学术写作助手） | 不渲染正文区、不给复制按钮 |

> 后续变更：上表后两行依赖的 `legacy-deploy-to-git`（自研、无上游仓库）与
> `学术写作助手`（只有 example 占位链接）两条已被删除，对应的两组断言改为
> 「数据里存在该类条目才验证」，避免测试因内容删减而失效。

**反向验证过**：把 `if (item.url)` 改成 `if (true)`，自研 skill 那组立刻红；
把正文判断取反，无正文那组立刻红。测试不是恒真的装饰。

### 1.1 补测试时连带暴露的两个桩缺陷

- **`El` 没有 `contains()`**：`hideModal()` 里 `document.body.contains(lastFocused)`
  一执行就抛错。说明弹窗的**关闭路径**此前从未被走到——打开都没测过，更别说关。
- **`eq()` 对元素用 `JSON.stringify`**：元素是双向链表（`parent` ↔ `children`），
  一旦断言里出现元素，真实信息会被吞成一句 `Converting circular structure to JSON`。
  已改为元素输出 `DIV.skill-detail` 这样的描述，失败信息恢复成
  「期望 null，实际 DIV.skill-detail」。

---

## 2. P2 长正文下「复制 / 打开 GitHub」沉到滚动区最底部

**缺陷**：`.modal-box` 是 `max-height: min(80vh, 720px)` + `overflow-y: auto`，
而 `.modal-actions` 排在内容流最后。迁移前 prompt 正文只有几百字，弹窗不滚动，
按钮自然可见；迁移后 skill 正文动辄上万字——`neat-freak` 渲染出 31 KB HTML、
`tech-doc-style-chinese` 18 KB——要点「复制」得先滚很久。

这不是理论问题：复制是收藏站的核心动作，而它恰好落在最长的内容后面。

**修复**：`.modal-box` 改 `flex-direction: column; overflow: hidden`，
`.modal-body` 取 `flex: 1 1 auto; min-height: 0; overflow-y: auto`，
`.modal-actions` 加 `flex: none`。正文自己滚，操作区固定在底部。
短内容（prompt）不受影响——没有溢出时 flex 布局与原来等价。

---

## 3. P3 `marked.parse` 遇 `undefined` 不报错，直接渲染出 "undefined"

**缺陷**：`appendMarkdown(el, text)` 原样把 `item.body` 交给 marked。
marked 对 `undefined` **不抛异常**，而是产出字符串 `"undefined"`，
于是 catch 分支也不会触发，用户会看到正文区孤零零写着 undefined。

触发条件：新版 `app.js` 配旧版 `data.json`（构建前先刷新页面即可复现）。
服务器上 cron 每 5 分钟重建，窗口很短，但失败模式是**静默的错误内容**而非报错，
值得一行兜住。

**修复**：`const source = text || '';` 后再渲染。

---

## 4. 维持现状的取舍

| 项 | 判断 |
| --- | --- |
| 弹窗内出现 `h1`，与弹窗标题 `h3` 层级倒挂 | **既有问题，非本次引入**：`prompts/人生设计术`、`挖掘隐藏天赋` 正文里早有 h1。CSS 已把 h1–h3 统一成 16px，视觉无差异。真要修得做 markdown 标题降级，而 `tech-doc-style-chinese` 正文有 81 处行首 `#`，其中 12 处在代码块里是 shell/Python 注释，朴素正则必然误伤——收益（读屏标题层级）不抵风险，等有真正的 a11y 需求再连同降级方案一起做。 |
| `data.json` 涨到 108 KB，nginx 未开 gzip | 首次加载要下载全部正文。加 `gzip on; gzip_types application/json;` 约可降到 25 KB 量级。属服务器配置，不在本仓库，未改。真觉得慢了再开。 |
| 复制的是「正文 + 附录」全文 | 附录是内联进来的参考文件，一起复制才自洽。想只拿 skill 本体，复制后自行截断到「## 附录」之前。 |
| 站点副本与本地 skill 会各自演进 | 迁移是一次性拷贝，上游更新不会自动同步。这是「收藏站」的定位决定的：本站存的是某个时点的可用快照。 |

---

## 5. 方法论小结

这次最有价值的发现不是某段代码写错了，而是**「没被执行过」本身就是一种缺陷状态**：

- 弹窗打开路径零覆盖，于是任何改动都只能靠肉眼验收；
- 顺着补测试，立刻撞出 `contains` 缺失——这反过来证明关闭路径也从未被执行；
- 桩里的 `eq` 对元素会抛循环引用，把真实断言信息吞掉，
  说明**断言工具自己也需要被验证**：一个能红但红得看不懂的测试，调试价值接近零。

另外一条与代码无关：本次差点漏掉 8 处 `references/*.md` 相对引用——
沙箱里 Bash 的 `grep` 对它们返回空且退出码为 0，看上去就像「没有引用」。
涉及判定「存不存在」的结论，必须用第二种手段交叉验证，不能只信一条命令的输出。
