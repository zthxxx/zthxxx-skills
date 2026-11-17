---
name: setup-collab-session
description: "让当前仓库接入 use-collab-session：检查环境，写入常驻指引，处理与现有规范、第三方 skills 的冲突，迁移文件。首次接入、`use-collab-session` 更新后，或第三方 skills 的 setup 重跑之后运行"
disable-model-invocation: true
---

# setup-collab-session

目标：跑完后，当前仓库就是 `use-collab-session` 的结构，Claude Code 与 Codex 都常驻加载它，项目在用的约定都有定义

下面写的是原则，具体改法由你结合项目现状推出

## 1. 了解现状

- 先通读 `.agents/skills/use-collab-session/SKILL.md`，它就是这次接入要达到的规范
  - 读不到说明 `use-collab-session` 没有装在仓库级：请用户在仓库根运行 `npx skills add zthxxx/zthxxx-skills --skill use-collab-session --skill setup-collab-session --agent claude-code --agent codex`，装好再继续
- 环境：当前目录在 git 仓库里 (脚本以 git 顶层为仓库根)，`bun --version` 可用 (脚本只依赖 Bun)。缺哪个就告诉用户，装好再继续
- 读项目的 Agent 指令文件 (`AGENTS.md`、`CLAUDE.md` 及它们导入的文件)、其中引用的 docs 规则，以及现有的目录结构
- 查第三方 skills：Agent 可用的 skills 列表、`skills-lock.json`、`.agents/skills/`。下列系列装着，或仓库里留有它的产物时，读对应的 reference：
  - Matt Pocock 系列 (`setup-matt-pocock-skills` 等)：[references/matt-pocock-skills.md](references/matt-pocock-skills.md)

完成标准：能逐条说出项目现有的规则、目录与第三方 skills 的约定，哪些和 `use-collab-session` 一致、哪些冲突、哪些 `use-collab-session` 没有定义

## 2. 提出改法，与用户确认

按以下原则拟出改法，整理成一份清单交给用户确认：

- 冲突处按 `use-collab-session` 执行：建议删掉项目规则里的冲突项；第三方 skills 的约定由 `use-collab-session` 覆盖，并在适配文件里写明覆盖了它的哪条约定
- 项目的 Agent 指令文件只留指向 `use-collab-session` 的指引，不复述它的内容
- 不留未定义的约定：项目在用、`use-collab-session` 又没有定义的约定，包括删掉冲突项或第三方适配文件后失去定义的，不提来源，独立写进 `AGENTS.md`
- 按 `use-collab-session` 需要移动的目录与文件，逐个列出原路径与新路径；被 git 忽略的目录 (如日志、截图输出) 也算在内

完成标准：清单的每一项用户都确认过 (同意、修改或放弃)

## 3. 执行

- 常驻指引：写进项目里 Claude Code 与 Codex 都常驻加载的 Agent 指令文件。`@` 导入让 Claude Code 常驻加载，Codex 按前面的文字读取：

  ```markdown
  **任何任务开始前，先读 `.agents/skills/use-collab-session/SKILL.md` 并遵循**：要不要建 session、怎么命名与创建、内部放什么、怎么交付，仓库级与 session 级的术语表、issue、ADR，交接与接手、归档与恢复，都以它为准；它扩展本项目的协作约定，并覆盖其他 skills 的部分约定 @.agents/skills/use-collab-session/SKILL.md
  ```

- skill 链接：两个 Agent 要读到同一份 skill。`.claude/skills` 不存在时，建指向 `../.agents/skills` 的目录软链；已是装着其他 skill 的真实目录时不替换，只确认 `use-collab-session`、`setup-collab-session` 各自的软链存在
- `.gitignore`：加入 `.logs/`，不带前导 `/`，session 目录里的同样忽略
- 按清单改规则文件、写第三方适配、移动文件。移动单独成一个 commit，下一个 commit 再更新现行文件里指向它们的引用；`archive/` 下的内容不改

完成标准：清单每一项都已执行并 commit

## 4. 验证与收尾

- 在仓库根运行 `bun .agents/skills/use-collab-session/scripts/new.ts --help` 正常输出
- `.claude/skills/use-collab-session/SKILL.md` 与指引里导入的路径都能读到
- 在 Agent 指令文件、docs 与代码注释里搜一遍被删除、被移动的路径，没有断掉的引用
- 告诉用户改了什么。`use-collab-session` 更新后，或第三方 skills 的 setup (如 `setup-matt-pocock-skills`) 之后再跑、把适配文件改回去时，再运行一次 `setup-collab-session`
