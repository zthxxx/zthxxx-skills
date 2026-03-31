# zthxxx-skills

A collection of personal [Claude Code](https://claude.ai/code) skills — reusable workflows, patterns, and automation.

## Usage

### As a dependency (recommended)

Add this repo to your project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["skill:zthxxx:*"]
  }
}
```

Or reference skills directly via the Skill tool in Claude Code conversations.

### Browsing

All skills are stored as flat markdown files in the [`skills/`](./skills/) directory. Each file is a self-contained skill with frontmatter metadata (`name`, `description`, trigger conditions, etc.).

## Skills

_(No skills yet — they will be listed here as they are created)_

## Development

Requires [pnpm](https://pnpm.io/) for package management and [Bun](https://bun.sh/) as the script runtime.

```bash
pnpm install
npm run lint
```

## License

MIT
