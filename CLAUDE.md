# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal skills repository — a flat collection of Claude Code skills stored in the `skills/` directory. Skills are standalone markdown files that define reusable workflows, patterns, and automation for Claude Code.

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

## Commands

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
skills/          # All skills live here as flat .md files
dict/            # CSpell custom dictionaries
package.json     # Dependency management for the repo
```

## Maintenance Rules

When creating or modifying a skill:

1. Place the skill file in `skills/` as a `.md` file
2. Update `README.md` — add the skill to the skills listing with a brief description
3. Update this `CLAUDE.md` — add the skill to the skills catalog below if it affects how this repo is maintained or has cross-cutting concerns

## Skills Catalog

_(Empty — skills will be listed here as they are created)_
