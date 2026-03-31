# zthxxx-skills

A collection of personal [Claude Code](https://claude.ai/code) extensions — skills (auto-triggered) and commands (user-invoked).

## Installation

Requires [go-task](https://taskfile.dev/) (`brew install go-task`).

```bash
# Clone the repo
git clone https://github.com/zthxxx/zthxxx-skills.git
cd zthxxx-skills

# Hard link all commands and skills into ~/.claude/
task update
```

This hard links all commands into `~/.claude/commands/` and all skills into `~/.claude/skills/`, making them globally available. Run `task update` again after pulling new changes.

## Browsing

- **Commands** — in [`commands/`](./commands/), namespaced directories with `.md` files, invoked via `/namespace:name`
- **Skills** — in [`skills/`](./skills/), subdirectories with `SKILL.md`, auto-triggered by context

## Commands

| Command | Invoke | Description |
|---------|--------|-------------|
| [`tuning`](./commands/zthxxx/tuning.md) | `/zthxxx:tuning` | Process revision directives (`/// fix:`, `/// refactor:`, `/// ??:`) left during code review |

## Skills

_(No skills yet)_

## Development

Requires [pnpm](https://pnpm.io/) for package management and [Bun](https://bun.sh/) as the script runtime.

```bash
pnpm install
npm run lint
```

## License

MIT
