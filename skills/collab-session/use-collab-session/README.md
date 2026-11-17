# use-collab-session

Agent 与人在仓库里协作的 session 规范。一件事项一个 `sessions/<name>/` 工作区，Agent 的工作过程 (思路、下载的输入、草稿、日志) 从 `/tmp` 搬进 git 仓库：人能看见、按事聚合、并行不撞、断点可恢复

## 安装

在仓库根装到仓库级，再运行 `/setup-collab-session` 接入 (见 [setup-collab-session](../setup-collab-session/))：

```bash
npx skills add zthxxx/zthxxx-skills --skill use-collab-session --skill setup-collab-session --agent claude-code --agent codex
```

## 怎么用

接入后由 Agent 常驻加载，不需要手动调用：要不要建 session、产物放哪、何时记 issue 与 ADR、怎么交接与归档，Agent 都按它执行

人常用的几个命令 (需要 [Bun](https://bun.sh/))：

```bash
bun .agents/skills/use-collab-session/scripts/new.ts <title>   # 建 session
bun .agents/skills/use-collab-session/scripts/archive.ts       # 终端里多选归档 session
bun .agents/skills/use-collab-session/scripts/resume.ts        # 终端里多选恢复已归档的 session
```

完整规范见 [SKILL.md](./SKILL.md)
