# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal Claude Code extensions repository containing **skills**, stored as `skills/<name>/SKILL.md` — markdown files with YAML frontmatter (`name`, `description`, etc.). A family of skills that work together is grouped under `skills/<group>/<name>/SKILL.md`.

A skill is either auto-triggered when Claude detects a matching context, or (with `disable-model-invocation: true` in frontmatter) invoked explicitly by the user via `/<name>`.

## Tech Stack

- **Runtime:** Bun (for executing TypeScript scripts)
- **Language:** TypeScript (strict type safety, type-first modeling, declare-before-implement)
- **TSConfig:** Extends `@zthxxx/tsconfig/tsconfig.json`
- **Linting:** ESLint ([@antfu/eslint-config](https://github.com/antfu/eslint-config), config written in TypeScript) with codeframe formatter
- **Spell check:** CSpell (custom project dictionary in `dict/project-words.txt`)
- **Git hooks:** Husky + lint-staged (pre-commit: eslint --fix on *.{ts,js}, cspell on *.{ts,md})
- **Package management:** pnpm

## Code Standards (for scripts)

- Strict TypeScript type modeling: declare types/interfaces first, then implement
- Layered design: separate concerns across layers
- Decoupling and extensibility: design for composition, not monoliths

## Dev Commands

```bash
# Install dependencies
pnpm install

# Lint (check)
npm run lint

# Lint (auto-fix)
npm run format

# Spell check
npm run spell

# Run a script
bun run <script-path>

# Test skill scripts
bun test tests/
```

## Repository Structure

```
skills/          # Skills (SKILL.md per skill dir, optional references/, agents/ and scripts/); a skill family shares a group dir
tests/           # Tests for skill scripts, mirroring the skills/ layout, kept outside skills/ so they are not installed
dict/            # CSpell custom dictionaries
package.json     # Dependency management for the repo
```

## Maintenance Rules

When creating or modifying a skill:

1. Place it as `skills/<name>/SKILL.md`; a skill that belongs to a family goes under the family's group dir, `skills/<group>/<name>/SKILL.md`
2. Update `README.md` — add it to the skills listing with a brief description
3. Update this `CLAUDE.md` — add it to the catalog below

## Catalog

### Skills

- **say-it-pro** — 工作场景写作与对话风格规范：文档、方案、commit/PR、群消息如何取舍内容、排版、用词、标点，以及要主动避开的 AI 味写法。Auto-triggered；references 按需加载
- **collab-session/use-collab-session** — Agent 与人协作的 session 规范：何时建 session、目录结构与 `CONTEXT.md` 主记录、仓库级与 session 级的术语表/issue/ADR、交接接手、归档恢复。Agent-invoked only (`user-invocable: false`), always loaded via the project's `@.agents/skills/use-collab-session/SKILL.md` import; Bun scripts in `scripts/`, tests in `tests/collab-session/use-collab-session/`
- **collab-session/setup-collab-session** — 让仓库接入 use-collab-session：检查环境、写入常驻指引、`.claude/skills` 链接与 `.gitignore`，处理冲突与第三方 skills 适配 (`references/` 按系列各一份)，迁移文件。User-invoked via `/setup-collab-session`
- **tuning** — Processes `/// fix:`, `/// refactor:`, `/// ??:` revision directives from user code review. Rigid 7-phase workflow: project context → discover → read all → cross-reference & plan → execute with checkpoints → verify → final review & summary. User-invoked via `/tuning`
