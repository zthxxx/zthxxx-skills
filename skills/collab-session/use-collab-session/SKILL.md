---
name: use-collab-session
description: "session 协作规范：一件事项一个 `sessions/<name>/` 工作区。开始任务、放置中间产物、记录 issue、ADR 或术语表、交接与接手、归档与恢复时使用"
user-invocable: false
---

# sessions/ —— 一个 session 做一件事

> 这份规范是 session 的完整约定：与其他 skills 的关系、何时建、命名与创建、协作方式、上下文隔离、记录原则、目录结构、主记录 `CONTEXT.md`、协作记录的仓库与事项两个层次、交接与接手、生命周期

一个 `sessions/<session-name>/` 是「一件事项」的完整工作区，**按目标划分**：可以跨多轮对话、多个模型和多次 context 压缩，换 Agent 时继续读同一个目录；
只有目标变成一件独立的事项，才新建 session。
目录里都是会被持续修改的中间过程(思路、下载的输入、草稿、日志)，和别的 session 物理隔离，多个 Agent 并行各占一个 session，天然不撞；做完后，有长期价值的成品可能由用户决定沉淀到顶层(见 [沉淀复用](#沉淀复用))，仅是临时工作的随 session 归档


## 与其他 skills 的关系

本规范不点名具体的 skill 或 skill 内的文件，因为 skill 会换。规范里的内容分三类：

- **由本规范定义或补充定义**(默认，不另外标注)：没有任何 skill 时本规范也描述完整，所以和某些 skill 的描述部分重复是有意的
- **覆盖其他 skill 的约定**(标注「覆盖其他 skill 的…约定」)：其他 skill 对同一件事另有约定时以本规范为准；具体覆盖了哪个 skill 的哪条约定，由 Agent 执行时自行判断
- **不由本规范定义**(标注「不由本规范定义」)：由其他 skill、项目级规范定义，或由 Agent 自行决定


## 何时建 session

满足任一条就建；纯问答、只读、一次改动这类没有中间产物的简单任务不建：

1. 要做比较复杂的事或长任务
2. 原以为简单，做着发现需要写材料或梳理思路
3. **要下载或生成任何中间产物**：下载文档、妙记、逐字稿、音视频，写脚本、存草稿或中间输出，把在线文档拉到本地做对比等

原因：这套结构为「过程要被看见、能恢复」服务，中间产物存放在 `$TMPDIR` 或 "scratchpad"，用户就看不见难以追溯；琐碎任务没有值得留存的过程，硬建目录只是空壳负担

**中途升级**：开头没建 session、做到一半要下载或生成中间产物时，就在那一刻补建，把产物直接放进去，别继续往 "scratchpad" 或 `$TMPDIR` 堆。判断依据是「有没有值得用户观测的中间产物」，不是「任务开头看着简不简单」


## 命名与创建

用一个总结要做什么的目标名：标题尽量中文、信息密度高，术语可用英语原文，一眼看清在做什么

- 不带空格，用 `-` 分隔；`-` 会产生歧义时才再用 `_` 做连词
- 不带时间戳，时间戳只在归档时作为 `YYMMDDHHmm-` 前缀自动加上(见 [归档](#归档))
  - 任务本身针对特定时间段(某一周的总结、某个月的进展归档等)时，名字带上任务时间段描述，尽量后置在末尾，年份写完整 4 位，和归档前缀的 2 位年份区分：`xx项目周报-20261026`、`xx项目进展-202610`
  - 写在开头会和归档时间戳前缀混淆，还会被归档工具当成已归档名拒绝
- 并行时发现已有同名 session，在末尾加 `-2` `-3` 去重名

创建需用 `bun .agents/skills/use-collab-session/scripts/new.ts <title>`：建 `sessions/<title>/` 的骨架目录等 (见 [目录结构](#目录结构))，并从模板自动生成 `CONTEXT.md`、填入标题和 session id


## User 与 Agent 怎么协作

User 提供目标、约束和影响结果的选择；Agent 查证事实、整理文件、实施并验证。环境里能查到的事实由 Agent 查，既有授权和已确定的约定直接沿用；只有缺少的决策会改变目标、范围或验收结果时，才向 User 提问

按工作量展开：

- 单轮能完成：在 `CONTEXT.md` 写清目标和验收条件，直接实施、验证
- 跨多轮完成：把共识写成 `docs/spec.md` 或 specs 系列定义，在 `CONTEXT.md` 的 Progress 列出每个都能独立验收的关键事项，逐轮推进
- 问题还没想清楚：直接跟用户提问讨论，或已经能明确提问且需要单独调查的，拆成问题/决策类 issue，用户可在 issue 文件中回答确定，之后再进入实施


## 上下文隔离

执行任务时，默认不读取当前 session 以外的 session 和 `archive/`：别的事项的中间过程与过时结论会干扰当前判断，归档内容只是留痕、不是参考；
同一个仓库级 issue 被多个 session 分头尝试不同方案时，也靠这条让各方案互不影响

只有任务本身需要跨 session 分析、或用户明确要求时，才读取它们


## 记录原则

- **SSOT 每项信息只有一个维护位置**：留两份就有同步成本，改漏时接手的 Agent 还要处理冲突。已存在于外部 issue、项目词表或 ADR 的内容直接引用，不再建同义的本地文件
- 指向其他资料时写明读取条件：资料是什么、什么情况下要读，例如「修改导出状态前，读 `GLOSSARY.md` 的导出任务定义」
- 已有产物只引用路径或 URL，未经验证的推测明确标出
- 不把看过材料当成已经验证，也不把压缩摘要当成一手资料


## 目录结构

session 的骨架目录由创建脚本生成，其余在某类内容需要独立维护或跨上下文读取时才建

内容归类存放：每类内容进对应的目录，类目录里的内容再按来源或类型分到子目录，用户追溯时顺着目录就能找到同类内容；全部平铺在一层，就难以分辨哪些属于同一类。
下面列出的子目录 (如 `artifacts/minutes/`、`.logs/.playwright-cli/`) 是预设分类示例，执行中需要别的分类时按同样方式自行安排。

按内容分类：

主要记录

- `CONTEXT.md` —— 主记录，每个 session 的入口 (见 [CONTEXT 主记录](#context-主记录))

交付结果

- `docs/` —— 文档、定义类交付：凡是要成型的产出 (样板页、文档正文、分析结论等) 直接写这里，不先写进 `CONTEXT.md` 再搬出，`CONTEXT.md` 放 ref link 过去
  - 只引用 `assets/` 中的产出素材，不引用下载素材与日志：沉淀时只有 docs 和它引用的 assets 会被带走 (见 [沉淀复用](#沉淀复用))，其他引用会断链；
    要用下载素材时，先处理成产出素材放进 `assets/`，或写成 docs 的正文
  - session spec 定义文件默认推荐 `docs/spec.md` —— 覆盖其他 skill 的 spec 位置约定
  - 仓库级与 session 级的 specs 如何组织不由本规范定义
- `scripts/` —— 本 session 写的零散脚本，以及这些脚本的测试脚本；同样直接写这里、`CONTEXT.md` 只 link
- `playground/` —— 工程原型类：需要工程化的原型，包含一次性原型；判断看它是否要作为一个整体来构建或启动 —— 有结构化组织的复杂文件或编译产物，或者是带 UI 的 App、App 扩展的一部分；
  逐个文件直接运行的脚本即使文件多、有共享模块，也放 `scripts/`
  - 按需分子目录，一个原型工程占一个子目录，同一问题的多个原型也各占一个
  - 进 git，依赖与构建产物用各原型工程自己的 `.gitignore` 排除；子目录内部如何组织不由本规范定义

对目标项目本身的改动 (包括当前仓库自己的 `scripts/` `docs/` 等) 直接改在该项目里，不放进 session；session 只记录过程，并链接对应的 commit 或 MR

素材 - 下载素材 (一次性输入，`docs/` 不引用)

- `artifacts/` —— 下载素材的位置：别人的文档、数据，下载的图片与音视频等
  - `artifacts/minutes/` —— 会议类素材：会议录屏、会议音频、飞书妙记与逐字稿；transcript 文本进 git，录屏与音频二进制应按仓库配置走 Git LFS

素材 - 产出素材 / 正式使用素材 (`docs/` 可引用)

- `assets/` —— 处理后、正式使用的图片、音视频、数据等，以及需要留存的生成结果

日志输出 (不进 git，但留在 session 目录里方便用户追溯)

- `.logs/` —— 默认的过程输出位置：之后可能被追溯、核对或用于接手的输出，如命令运行日志 (stdout/stderr)、测量原始数据、决策轨迹、交接总结 (见 [交接与接手](#交接与接手))
  - 决策轨迹是按时间记录的过程日志 (每一步做了什么选择、依据是什么)，不是决策记录：其中仍然有效的结论提炼到 `CONTEXT.md` 的 Facts/Decisions，用户确认过的决策写成 ADR (见 [ADR](#adr))
  - `.logs/.playwright-cli/` —— 浏览器操作的 console、截图等输出

协作记录

- `GLOSSARY.md` `issues/` `adr/` —— 按需拆出的协作记录 (见 [协作记录的仓库与事项两个层次](#协作记录的仓库与事项两个层次))

不放进 session 的临时文件 (系统 `$TMPDIR`)

文件放 session 还是 `$TMPDIR`，看之后有没有人需要凭本事项再找到它，不看它用完是否丢弃；其他 skill 默认写到 `/tmp`、scratchpad 等临时位置的文件同样按此判断，
属于本事项的写进 session —— 覆盖其他 skill 的临时写入位置约定

- 判断依据
  - 归属：内容属于本事项的工作过程或产出，放 session；只是工具、进程自己的运行文件，放 `$TMPDIR`
  - 追溯：结论、交接或中断恢复可能引用它，放 session
  - 生命周期：`$TMPDIR` 与 scratchpad 何时被清理不由事项决定 (scratchpad 只在当前对话有效)，session 则要跨多轮对话与多个 Agent
  - 隔离：`$TMPDIR` 全局共享，并行写入各用独立的子目录；必须与仓库上下文隔离的工作目录 (如不能读到仓库指令的盲测) 反而要放这里，结果写回 session
  - 拿不准时放 `.logs/`：误放进 `$TMPDIR` 丢掉的追溯补不回来，误放进 `.logs/` 只多一份可清理的文件
- 放 `$TMPDIR` 的典型文件：测试与沙箱的临时目录、构建缓存、lock / socket / pid 等运行时文件、即产即消费且不带结论的中转文件


## CONTEXT 主记录

主记录，是 session 的**整体上下文**：需求、目标、方案、关键事项进展与已核实的事实决策。它只写总结、链接与读取条件，细节在产物与拆出的协作记录里

- 章节标题与定义以本节为准；[CONTEXT.md 模板](scripts/template/CONTEXT.md) 是它的实现，各章怎么写的细节在模板的 blockquote 引导说明里维护。改章节时先改本节，再同步模板
- Agent 在阶段边界更新；交接与接手时的用法见 [交接与接手](#交接与接手)
- 各章节：
  - 原始需求 Requirement —— 用户的原始需求与背景
  - 定义与目标 Definition/Goal —— 为什么做、怎样算 done；拆出 `docs/spec.md` 后只留目标摘要与链接
  - 特殊术语解释 Glossary —— 本 session 的术语表(见 [术语表](#术语表))
  - 方案骨架 Approach —— 当前方案、领域模型与约束；需求细节指向当前 spec，决策依据指向相关 ADR
  - 关键事项进展 Progress —— 阶段级 checklist，一眼看出哪些关键事项完成了、哪些还没有
  - 关键事实与决策 Facts/Decisions —— 已核实的关键事实、仍有效的限制及一手来源；需要保留的决策依据写进本 session 的 `adr/`，这里引用结论
  - 关联 Refs —— 相关产物和一手资料
- 编辑时保留 blockquote 里的引导说明，章节正文与引导说明、下一标题之间留空行
- frontmatter 记录处理过本 session 的所有 Agent 会话 id，用于找回对应的对话：创建脚本写入创建者的 id，之后接手的 Agent 用接手脚本追加自己的 id (见 [交接与接手](#交接与接手))；
  - 只有一个 id 时是单值，多个时是列表，取不到的 id 保持 null


## 协作记录的仓库与事项两个层次

### 仓库与事项层次

术语表、ADR、issue、交接总结分仓库与事项两个层次，各以一个目录作为 context 根；本节与 [交接与接手](#交接与接手) 里这些记录的路径，都相对所属 context 根。
选哪个层次按下面的路由判断 —— 覆盖其他 skill 的目录约定

- **仓库级** —— 明显属于整个仓库、跨 session 通用，或用户要求记到顶层的(如仓库目录结构的调整)，context 根才是仓库根。ADR 不归档，issue 完成后单独归档(见 [归档](#归档))
  - 仓库级 `issues/` 也能放与手头 session 无关、尚无归属的新问题(见 [issue 的生命周期](#issue-的生命周期))
- **session 级(默认)** —— 事项层次对应的容器目录是 session 目录，其中的记录称 session 级：为某个事项做领域建模、澄清决策、拆分工作时，context 根是 `sessions/<name>/`；
  这些记录随 session 一起归档冻结

ADR 与 issue 的文件名都以 `YYMMDDHHmm-` 为前缀，名字部分同 session 命名规则(不带空格、`-` 分隔) —— 覆盖其他 skill 的位置与编号约定：多个 Agent 并行时各取最大序号加一会撞序号，且时间戳比序号多带了时间顺序

### 术语表

- 仓库级位置：
  - 单一业务上下文：`GLOSSARY.md` 放仓库根目录，不需要 `GLOSSARY-MAP.md`
  - 多个业务上下文：`GLOSSARY-MAP.md` 放仓库根目录，指向各个业务上下文的 `GLOSSARY.md`
- session 级写在 `CONTEXT.md` 的 Glossary 章节，放不下、需要独立维护时拆出 `GLOSSARY.md`，Glossary 章节只留指针；
  用户有明确要求才从 session 中复制或移动到仓库级不同业务的 `GLOSSARY.md` 和仓库顶层 `GLOSSARY-MAP.md`
- 只定义领域语言：已明确的词义、关系与应避免的别名，不承载进度、方案或实现细节
- User 确定领域含义，Agent 核对资料并记录；命名和写方案前按需读


### issue

issue 是一份轻量记录：一项待讨论/待决策的问题、一个想法，或一件准备要做但还没想完整的事。它的主要价值是作为与用户交互讨论的位置，用户可以直接在 issue 文件里回答

- 想清楚后，issue 也可以补成派发给 Agent 或 Subagent 的执行工单；但 session 内一般不必为了派发执行而拆 issue
- issue 只承载问题、讨论与结论。执行起来要积累上下文(写材料、生成中间产物、跨多轮推进)时，就满足 [何时建 session](#何时建-session)，由 session 承载执行
  - session 级 issue 由所在 session 承载，仓库级 issue 由认领它的 session 承载(见 [issue 的生命周期](#issue-的生命周期))
- `issues/YYMMDDHHmm-<名字>.md`，时间戳取 issue 创建的时刻
- 字段、状态与各项操作的具体写法不由本规范定义
- 依赖顺序只由 `Blocked by` 表达，写被依赖 issue 的文件名

### ADR

ADR(Architecture Decision Record)记录一项已确认的决策：决定了什么、为什么这样决定。以后的人和 Agent 读到相关内容时能知道背后的理由，不会把有意为之的做法当成问题推翻，也不必重新讨论

- 何时写：一项决定同时满足三条才写 —— 事后改主意代价大；没有背景时会让人困惑「为什么这样做」；确实在几个方案之间做了取舍。容易撤回、显而易见或没有备选的决定不写
- 文件内容：标题是决策名，正文一到三句话说清背景、决定与理由，一段话就够；以下几项只在确有价值时加
  - frontmatter 的 Status：`proposed`、`accepted`、`deprecated`，或被新决策取代后的 `superseded by …`(见下)
  - Considered Options：被否决的方案值得记住时才写
  - Consequences：有不明显的后续影响时才写
- `adr/YYMMDDHHmm-<决策名>.md`，时间戳取决策确认的时刻
- 用户确认决定后由 Agent 写；涉及同一决策时读
- 写后不改正文；决定变了就新写一条，旧条只把 Status 改为 `superseded by adr/<YYMMDDHHmm-决策名>`(相对 context 根的路径) —— 覆盖其他 skill 的 Status 写法约定


## 交接与接手

**交接总结**(handoff)：交接那一刻把当前对话压缩成一份一次性总结，只引用已有产物、不重复其内容

- session 级交接前，先把 `CONTEXT.md` 更新到当前阶段；值得保留的信息只在 `CONTEXT.md` 维护，交接总结只帮新对话起步
  - 没做完的事只写进交接总结，不在 `CONTEXT.md` 里记「下一步」：大部分事项 Agent 直接做完即可，注意力不该花在反复更新下一步记录上
- 交接总结写到所属层次 context 根的 `.logs/YYMMDDHHmm-<事项title>.handoff.md`(session 级 `sessions/<name>/.logs/`，仓库级仓库根的 `.logs/`)；
  - 其他 skill 默认写到临时位置的交接文件，也改为写到这里 (判断见 [目录结构](#目录结构) 的临时文件)

**交接完成的标准**：下一位 Agent 凭交接总结、`CONTEXT.md` 和关联资料，就能知道要交付什么、依据什么、怎样验收，以及哪些还没做完。切换上下文前按这条标准检查

**新 Agent 接手的读取顺序**：

0. 项目的 `AGENTS.md` 与本规范(通常已默认加载)
1. 目标 session 的 `CONTEXT.md`；用户给了上一份 Agent 的 handoff 文件时一并阅读；
  - 运行 `bun .agents/skills/use-collab-session/scripts/takeover.ts <session-name>` 把自己的会话 id 登记进 frontmatter (已在其中则不改动)
2. 按 `CONTEXT.md` 中的目标、验收条件与关键事项进展 Progress 判断整体进展
3. 根据当前 session 工作结果分析，读取关联的 specs、术语、ADR 等信息
4. 对照实际文件、git 状态与已有验证结果，结合交接总结里没做完的事，自行判断下一步再继续工作


## 生命周期

### session 的生命周期

session 的创建、接手登记、归档、恢复，以及仓库级 issue 的归档、恢复，统一走本 skill `scripts/` 下的脚本，不手工建目录、建 `CONTEXT.md`、改 frontmatter 会话 id 或 `mv` 拼时间戳，避免结构格式对不上

- 脚本都不 commit：`archive.ts` 只把移动过的源与目标精确 `git add` 进 stage，并在末尾打印建议的 `git commit` 命令；`new.ts`、`takeover.ts` 与 `resume.ts` 不碰 git
- 大量平移和内容改动永远不放进同一个 commit：混在一起 diff 不可读，rename 检测也会失效。归档、恢复的移动都各自单独成一个 commit
- 归档、恢复脚本无参数在终端里运行会进多选列表 (用户手动交互场景)；非 TTY 环境必须显式传名字 (Agent 使用场景)
- 时间戳推导、批量校验等具体行为看 `--help`，实现见本 skill 的 `scripts/`


### issue 的生命周期

1. **产生**：
  - 仓库级：用户或 Agent 从 session 外部提出问题或变化、或工作中发现一个与手头 session 无关的问题 时，建立仓库级 issue
  - session 级：与 session 相关的 issue 通常的建立是为了与用户并行讨论、或拆分需要与多个 Subagents 并行讨论再执行的事项
2. **分流**
  - 维护者(用户/Agent)判断它缺信息、可以交给 Agent、需要用户来做，还是不处理
  - 与 session 无关的情况只开 issue、不顺手修、交给用户判断，手头的事项继续
3. **去向**，三选一：
   - 无需独立 session，单独处理完毕后关闭 (如简单改动、讨论完毕解答了疑问但无改动)
   - 被某个 session 认领执行，issue 与该 session 的 CONTEXT.md 两边互相链接文件路径；issue 不移进 session 目录
   - 判定不处理后关闭
4. **归档**：
  - 由用户确认 issue resolved / wontfix 后，改 issue 状态表示关闭；关闭即直接归档，仓库级用脚本移到 `archive/issues/`(见 [归档](#归档))，session 级跟随 session 归档无特殊处理


### 完成后提交与推送

判断一件事做完、整体检查没问题后，把整个 session commit 并 push 到远端留痕。Agent 停下来交付时，交付的应当是一个**已完成、已 commit** 的结果；到这里 Agent 的交付就算完成，**不要自行归档**

### 沉淀复用

用户觉得有复用价值时，要求把产出 `docs/` `scripts/` **复制**一份到顶层长期维护。沉淀没有脚本，由 Agent 复制到用户指定的顶层位置；`docs/` 引用到的 `assets/` 一并复制，并改写引用路径。
沉淀内容和 session 原件脱钩，后续迭代沉淀件不会动到归档，沉淀件里也不用标来源 —— 内容本身就能搜回原始出处。沉淀件要自包含，不回指 session 里的一次性输入(`artifacts/` 等)

### 归档

用户确认收尾后通常手动执行：

- session：`bun .agents/skills/use-collab-session/scripts/archive.ts <session-name>…` 可传多个，`--all` 归档全部、与名字互斥；
  - 会把整个目录**无改动**移到 `archive/sessions/<YYMMDDHHmm>-<session-name>/`。时间戳由 git 推导，反映这件事实际完成的时刻而非归档动作执行的时刻；放在前面，归档目录按名称排序即按时间排序
- 仓库级 issue：`bun .agents/skills/use-collab-session/scripts/archive.ts --issue <issue-name>…`，从 `issues/` 移到 `archive/issues/`，文件名不变

当用户要求 Agent 执行归档时，也需要使用脚本执行

归档后默认不可再修改，除非用户明确指定要改某个已归档的 session 或 issue；要在归档内容上继续工作时按 [恢复](#恢复) 移回

### 恢复

只有用户明确要求继续修改已归档的 session 或仓库级 issue 时才恢复：

1. session 用 `bun .agents/skills/use-collab-session/scripts/resume.ts <session-name>…` 去掉时间戳前缀、移回 `sessions/<session-name>/`，同名多次归档时按报错提示传完整归档目录名；
2. 仓库级 issue 用 `bun .agents/skills/use-collab-session/scripts/resume.ts --issue <issue-name>…` 移回 `issues/`
3. git 提交这次纯移动后，再开始修改内容
4. 改完按 [完成后提交与推送](#完成后提交与推送) 再走一遍
