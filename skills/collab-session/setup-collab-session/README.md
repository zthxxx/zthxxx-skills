# setup-collab-session

让一个仓库接入 [use-collab-session](../use-collab-session/)。用 `/setup-collab-session` 手动调用 (Codex 里用 `$setup-collab-session`)

## 安装

```bash
npx skills add zthxxx/zthxxx-skills --skill use-collab-session --skill setup-collab-session --agent claude-code --agent codex
```

## 怎么用

在仓库里运行 `/setup-collab-session`，Agent 会：

1. 检查 git 与 Bun，读项目现有的 Agent 指令文件、规则文档、目录结构和已装的第三方 skills
2. 列出和 use-collab-session 冲突的规则、需要移动的文件，交给你确认
3. 写入常驻指引、链好 `.claude/skills`、补 `.gitignore`，按确认的清单改规则、移动文件并 commit
4. 验证脚本能运行、没有断掉的引用

首次接入运行一次。之后第三方 skills 的 setup (如 `setup-matt-pocock-skills`) 重跑、把适配文件改回去时，再运行一次

目前内置的第三方适配：Matt Pocock 系列 skills，见 [references/matt-pocock-skills.md](./references/matt-pocock-skills.md)

完整流程见 [SKILL.md](./SKILL.md)
