# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal Claude Code extensions repository containing **skills**, stored as `skills/<name>/SKILL.md` — markdown files with YAML frontmatter (`name`, `description`, etc.).

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
```

## Repository Structure

```
skills/          # Skills (SKILL.md per subdirectory, optional references/ and agents/)
dict/            # CSpell custom dictionaries
package.json     # Dependency management for the repo
```

## Maintenance Rules

When creating or modifying a skill:

1. Place it as `skills/<name>/SKILL.md`
2. Update `README.md` — add it to the skills listing with a brief description
3. Update this `CLAUDE.md` — add it to the catalog below

## Catalog

### Skills

- **say-it-pro** — 工作场景写作与对话风格规范：文档、方案、commit/PR、群消息如何取舍内容、排版、用词、标点，以及要主动避开的 AI 味写法。Auto-triggered；references 按需加载
- **tuning** — Processes `/// fix:`, `/// refactor:`, `/// ??:` revision directives from user code review. Rigid 7-phase workflow: project context → discover → read all → cross-reference & plan → execute with checkpoints → verify → final review & summary. User-invoked via `/tuning`
