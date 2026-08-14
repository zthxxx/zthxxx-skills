# zthxxx-skills

A collection of personal [Claude Code](https://claude.ai/code) extensions — skills (auto-triggered) and commands (user-invoked).


## Install Skills

```bash
npx skills add zthxxx/zthxxx-skills
```


## Skills


### [say-it-pro](./skills/say-it-pro/)

像一个专业人士一样写作与对话风格，包含写文档、方案、说明、commit/PR、群消息、或组织聊天回复时需要遵循的风格规范，让产出读起来像有品味的专业人士写的、而非一眼能感觉到 AI 味。

它管内容取舍、排版呼吸、中英混排标点，并给出一份具体的 AI 味禁用清单 (各类黑话、认证式夸奖、「不是…，而是…」这种听吐的结构) 及其替换写法


### [tuning](./skills/tuning/)

Code review 批注的批量执行器，用 `/tuning` 手动调用

Review 时在代码里留下 `/// fix:` `/// refactor:` `/// ??:` 行内批注，运行后 Agent 扫描全部批注、通读上下文、列出计划待确认，再逐条修改并跑 lint/测试验证，最后清理批注标记；批注里带的领域知识会保留成代码注释或写进 spec


## Development

Requires [pnpm](https://pnpm.io/) for package management and [Bun](https://bun.sh/) as the script runtime.

```bash
pnpm install
npm run lint
```


### Dev Symlink

Requires [go-task](https://taskfile.dev/) (`brew install go-task`).

```bash
# Clone the repo
git clone https://github.com/zthxxx/zthxxx-skills.git
cd zthxxx-skills

# Hard link all commands and skills into ~/.claude/
task update
```

This hard links all commands into `~/.claude/commands/` and all skills into `~/.claude/skills/`, making them globally available. Run `task update` again after pulling new changes.


## License

MIT
