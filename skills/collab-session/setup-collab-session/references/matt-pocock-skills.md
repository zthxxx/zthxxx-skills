# Matt Pocock 系列 skills 的适配

Matt 系列的 skills 从常驻加载的 `## Agent skills` 块找到 `docs/agents/` 下的配置文件 (由 `setup-matt-pocock-skills` 生成)，再按其中写的位置读写 issue、术语表与 ADR。适配要让它们读写的都是 `use-collab-session` 的位置与命名

## Matt 的约定与 use-collab-session 的覆盖

| Matt 的约定 | use-collab-session |
|---|---|
| 本地 issue：一个 feature 一个 `.scratch/<feature>/`，spec 是其中的 `spec.md`，issue 是 `issues/<NN>-<slug>.md`，`Blocked by` 写编号 | 一件事一个 session：spec 在 `sessions/<name>/docs/spec.md`；issue 在所属 context 根的 `issues/YYMMDDHHmm-<名字>.md`，`Blocked by` 写文件名 |
| 术语表：根目录 `CONTEXT.md`；多上下文时根目录 `CONTEXT-MAP.md` 指向各上下文的 `CONTEXT.md` | `GLOSSARY.md` 与 `GLOSSARY-MAP.md`；`CONTEXT.md` 是 session 主记录 |
| ADR：`docs/adr/NNNN-<名>.md`；多上下文时还有 `src/<context>/docs/adr/` | context 根的 `adr/YYMMDDHHmm-<名>.md` |

issue 的 `Status:` 取值 (`triage-labels.md`) 不由 `use-collab-session` 定义，不覆盖

## 装着 Matt 的 skills 时

- `docs/agents/issue-tracker.md` 与 `docs/agents/domain.md`：以 Matt setup 的本地模板 (`setup-matt-pocock-skills/issue-tracker-local.md`、`domain.md`) 的各节为骨架，逐节改为 `use-collab-session` 的位置与命名
  - 位置、命名、层次路由指向 `use-collab-session` 的对应章节，不复述
  - 只写 `use-collab-session` 没有定义、Matt skills 又需要的内容：「publish to the issue tracker」「fetch the relevant ticket」与 wayfinding 的各项操作落到哪个文件，`Status:` 取值，`## Comments`
  - 末尾逐条写明覆盖了 Matt 的哪条约定。Matt 的 setup 重跑时会先读已有的 `docs/agents/`，能看到这些覆盖
- `docs/agents/triage-labels.md` 不动
- Agent 指令文件里的 `## Agent skills` 块保留，Matt 的 skills 靠它找到 `docs/agents/`。删掉与 `use-collab-session` 冲突的摘要 (如「根目录 `CONTEXT.md` 加 `docs/adr/`」)，每个小节只留一句话指向对应文件

## 已卸载、只留下产物时

`docs/agents/` 下的文件与 `## Agent skills` 块已经没有读者，建议删掉。其中项目仍在用、`use-collab-session` 没有定义的约定 (如 issue 的 `Status:` 取值、`## Comments`)，不提 Matt，独立写进 `AGENTS.md`

## 迁移 Matt 的产物

装着还是已卸载都要迁移。逐项列进清单，用户确认后执行：

- 术语表：先确认根目录的 `CONTEXT.md` 确实是术语表，再移为 `GLOSSARY.md`；`CONTEXT-MAP.md` 移为 `GLOSSARY-MAP.md`，各上下文的 `CONTEXT.md` 在原目录移为 `GLOSSARY.md`，MAP 里的路径随之更新
- ADR：`docs/adr/NNNN-<名>.md` 移为 `adr/YYMMDDHHmm-<名>.md`，决策内容不改。时间戳取该文件首次加入 git 的提交时间：

  ```sh
  git log --follow --diff-filter=A --format=%ad --date=format-local:%y%m%d%H%M -- <file> | tail -1
  ```

  多上下文的 `src/<context>/docs/adr/` 放到哪里 `use-collab-session` 没有定义，和用户确认
- `.scratch/<feature>/`：一个 feature 就是一件事，移为 `sessions/<feature>/`，目录名按 `use-collab-session` 的命名规则
  - `spec.md` 移为 `docs/spec.md`，`map.md` 留在 session 根
  - `issues/<NN>-<slug>.md` 移为 `issues/YYMMDDHHmm-<slug>.md`，时间戳同样取首次加入 git 的提交时间；`Blocked by` 里的编号改为文件名
  - feature 的 issue 都已关闭时，迁移后由用户决定是否归档这个 session
- 引用：现行文件 (Agent 指令文件、docs、代码注释、ADR 之间的链接) 里指向旧路径或 `ADR-NNNN` 编号的引用，改为新路径或新文件名
