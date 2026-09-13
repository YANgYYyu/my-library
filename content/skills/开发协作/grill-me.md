---
intro: 用连续追问把方案或设计逐层拆到没有待定项，动手前先找出隐藏假设与漏洞。
url: https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me
---

# Grill Me

## What to do

Interview the user relentlessly about every aspect of their plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

**For each question**:
1. Provide your recommended answer before asking
2. Ask the question
3. Wait for the user's response before moving to the next question

If a question can be answered by exploring the codebase, use Read/Grep to answer it yourself — don't ask the user.

**How to structure the session**:
1. Start by listing the top-level decision branches you see in the plan (3–6 items)
2. Pick the most foundational branch first (others often depend on it)
3. Walk each branch to completion before moving to the next
4. Within a branch, resolve sub-decisions in dependency order

**When to stop**: The session is complete when all branches are resolved and there are no open "it depends" answers remaining. Close with a one-paragraph summary of the key decisions made.

## Difference from grill-with-docs

**grill-me** = pure conversational interrogation of a plan. No documentation is read or updated. Use when the plan is still conceptual and you just need to think it through.

**grill-with-docs** = interrogation anchored to the project's existing domain model (CONTEXT.md, ADRs). Terminology is challenged against the glossary, and decisions that crystallise are written into CONTEXT.md / ADRs in real time. Use when the project has an established domain model that the new plan must align with.

## When to use

Invoke this skill when:
- The user wants to stress-test a plan or design decision
- The user says "grill me" or "challenge my thinking"
- You need to surface hidden assumptions or unresolved trade-offs before implementation begins
- The project does NOT yet have a domain model / CONTEXT.md (if it does, prefer grill-with-docs)
- **Chinese triggers（中文触发）**："追问我"、"拷问我"、"拷问一下"、"挑战我的想法"、"压力测试"、"压力测试方案"、"挑刺"、"质疑我的设计"、"帮我把方案问透"、"找出我计划的漏洞"、"评审一下这个方案"、"这个方案有什么问题"

> 中文用户触发后，**提问与推荐答案一律用中文回复**，不要因为 SKILL 正文是英文就改用英文。

## Tools

- **Read**: Read existing code, specs, or documentation to answer questions without asking the user
- **Grep**: Search the codebase to resolve factual questions about current behaviour
