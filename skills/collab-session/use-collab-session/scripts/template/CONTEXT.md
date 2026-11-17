---
claude-code-session-id: {{ClaudeCodeSessionId}}
codex-session-id: {{CodexSessionId}}
---

# {{SessionTitle}}

## 原始需求 Requirement
> 原始用户输入内容；用户原始说什么本节内就原样写什么内容；通常可能包含想要什么、背景是什么、一些大致的约束等；用户有后续对话改动/补充需求时，此处一并改动/补充

```markdown
```


## 定义与目标 Definition/Goal
> 为什么做、怎样算 done (稍微具体的几句话描述)



## 特殊术语解释 Glossary
> 仅动态列举并解释本 session 里出现的特殊术语、缩写、概念。**不写常规词汇、常见缩写、默认共识的词汇**；如果没有特殊词汇，本条无需编写
> 不写「xx是xx的简称」这种显而易见的解释 (这些直接在文档中首次出现时跟随文档就可以写)


## 方案骨架 Approach
> 领域模型、关键抽象、关键定义；SOLID 等原则下定的关键决策(粗粒度，不是细 TODO，不写变量函数名)；写当前方案与约束，需求细节引用 spec、决策依据引用 ADR，执行细节以实际产物为准
> 比如可以写技术栈，可以写一些关键的算法(包括要用什么样的算法)，或者定下一些模型、关键变量
>
> 但是真正的细节应该直接放到实现里面。比如：
> 1. 实现是代码，就直接写代码 (scripts/ 或 playground/)
> 2. 实现是文档，就直接写文档 (docs/)
> 3. 实现是媒体素材，就直接写入素材目录 (assets/)



## 关键事项进展 Progress
> 抽象大体思路与关键事项 checklist，一眼看出什么执行完了、什么还没，粒度是关键事项级别、不是原子步骤；可 link 上面的方案骨架或下面的决策与事实
> 只在关键阶段边界更新，不为频繁更新 checklist 打断执行；细粒度进展由 session 里实际长出来的产物与 git commit 体现



## 关键事实与决策 Facts/Decisions
> 已核实的事实、仍有效的限制及一手来源；决策依据写入本 session 的 adr/，此处引用结论



## 关联 Refs
> 本 session 的 docs/、scripts/、playground/、assets/、artifacts/ (相对路径引用)；相关 MR、外部文档
