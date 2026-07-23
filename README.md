# zthxxx-skills

A collection of personal [Claude Code](https://claude.ai/code) extensions — skills (auto-triggered) and commands (user-invoked).

## Install Skills

```bash
npx skills add zthxxx/zthxxx-skills
```

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
