#!/usr/bin/env bun
/**
 * 恢复(resume)已归档 session: `archive/sessions/<时间戳>-<name>/` → `sessions/<name>/`；
 * 恢复已归档的仓库级 issue: `archive/issues/<file>` → `issues/<file>`(文件名不变)
 *
 * 需求：
 * - archive/ 默认不可修改；用户明确要求继续修改某个已归档 session 时，
 *   先把它移回顶层 sessions/ 再改(见 ../SKILL.md#恢复)；仓库级 issue 同理
 *
 * 定义 / 行为：
 * - 输入裸 session 名(在 archive/sessions/ 中按 `<时间戳>-<name>` 精确匹配)或完整归档目录名；
 *   也接受路径写法(自动归一)；可一次传多个
 * - 无参数且在终端里运行 → 进多选列表(space 勾选、enter 恢复，见 prompt.ts)，只列 session，
 *   候选按目录内最新改动时间倒序、回传完整归档目录名；非 TTY 仍是帮助 + 退出 1，契约不变
 * - 裸名匹配到多个归档(同名多次归档) → 报错列出候选，要求传完整归档目录名
 * - 移动时去掉时间戳前缀；目标 `sessions/<name>/` 已存在 → 报错退出；
 *   一次恢复多个时先整体校验再移动，任一不合法都不动任何条目
 * - `--issue <file>…` 恢复仓库级 issue；`<file>` 接受裸文件名或 `archive/issues/<file>` 路径写法，原名移回 `issues/`
 * - 只做 mv，不碰 git：纯移动应先单独 commit，之后才开始修改内容
 *
 * 用法(--help / 无参数时显示)：
 *   bun .agents/skills/use-collab-session/scripts/resume.ts
 *   bun .agents/skills/use-collab-session/scripts/resume.ts <session-name | 完整归档目录名> [...]
 *   bun .agents/skills/use-collab-session/scripts/resume.ts --issue <file> [<file> ...]
 *
 * 单测隔离: resumeSession() / resumeSessions() / resumeIssues() 的目录可经 options 注入，
 * 测试用临时目录替换生产的 sessions/、archive/sessions/、issues/、archive/issues/(见 zthxxx-skills 仓库的 tests/collab-session/use-collab-session/session.test.ts)
 */

import type { IssuePaths, SessionPaths } from './lib'
import fs from 'node:fs'
import path from 'node:path'
import {
  archivedPrefixRe,
  defaultIssuePaths,
  defaultPaths,
  listSessionDirs,
  moveEntries,
  normalizeName,
  printMove,
  runCli,
} from './lib'
import { pickSessions } from './prompt'

export type ResumeOptions = Partial<SessionPaths>

/** 把输入(裸名 / 完整归档目录名)解析成 archive/sessions/ 下确实存在的目录名 */
function resolveArchivedName(input: string, archiveDir: string): string {
  if (archivedPrefixRe.test(input)) {
    // 已带时间戳前缀 → 视为完整归档目录名
    if (!fs.existsSync(path.join(archiveDir, input))) {
      throw new Error(`archive 中不存在该归档目录: ${path.join(archiveDir, input)}`)
    }
    return input
  }
  const candidates = (
    fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir, { withFileTypes: true }) : []
  )
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter((entryName) => {
      const prefix = entryName.match(archivedPrefixRe)
      return prefix !== null && entryName.slice(prefix[0].length) === input
    })
    .sort()
  if (candidates.length === 0) {
    throw new Error(`archive 中找不到名为「${input}」的 session: ${archiveDir}`)
  }
  if (candidates.length > 1) {
    throw new Error(`同名归档有多个，请传完整归档目录名：\n  ${candidates.join('\n  ')}`)
  }
  return candidates[0]!
}

/** 批量恢复；先整体校验(解析归档名、源存在、目标不存在)，任何一项不合法都不动任何目录 */
export function resumeSessions(names: readonly string[], options: ResumeOptions = {}): Array<{ from: string, to: string }> {
  const { sessionsDir, archiveDir } = { ...defaultPaths, ...options }
  const moves = names.map((name) => {
    const archivedName = resolveArchivedName(normalizeName(name), archiveDir)
    return {
      from: path.join(archiveDir, archivedName),
      to: path.join(sessionsDir, archivedName.replace(archivedPrefixRe, '')),
    }
  })
  return moveEntries(moves)
}

export function resumeSession(name: string, options: ResumeOptions = {}): { from: string, to: string } {
  return resumeSessions([name], options)[0]!
}

/** 批量恢复仓库级 issue：`archive/issues/<file>` → `issues/<file>`，文件名不变；先整体校验再移动 */
export function resumeIssues(files: readonly string[], options: Partial<IssuePaths> = {}): Array<{ from: string, to: string }> {
  const { issuesDir, archiveIssuesDir } = { ...defaultIssuePaths, ...options }
  const moves = files.map((file) => {
    const name = normalizeName(file, 'issue 文件名')
    return { from: path.join(archiveIssuesDir, name), to: path.join(issuesDir, name) }
  })
  return moveEntries(moves, 'file')
}

/** 无参数 + TTY 时的交互入口：列出 archive/sessions/ 下候选，多选后一次性恢复 */
async function pickAndResume(): Promise<void> {
  const entries = listSessionDirs(defaultPaths.archiveDir)
  if (entries.length === 0) {
    console.log('archive/sessions/ 下没有可恢复的 session')
    return
  }
  const picked = await pickSessions(
    '选择要恢复的 session(archive/sessions/ → sessions/)',
    // 直接用完整归档目录名做标签与回传值：时间戳前缀常驻可见，
    // 同名多次归档也能一眼分辨，且不会撞上「请传完整归档目录名」
    entries.map(({ name }) => ({ value: name, label: name })),
  )
  if (picked === null) {
    throw new Error('已取消，未恢复任何 session')
  }
  if (picked.length === 0) {
    console.log('未选择任何 session')
    return
  }
  resumeSessions(picked).forEach(printMove)
}

const HELP = `恢复(resume)已归档 session: archive/sessions/<时间戳>-<name>/ → sessions/<name>/
恢复已归档的仓库级 issue: archive/issues/<file> → issues/<file>(文件名不变)

用法：
  bun .agents/skills/use-collab-session/scripts/resume.ts                    终端下进多选列表，勾选后一次性恢复 session
  bun .agents/skills/use-collab-session/scripts/resume.ts <session-name>…    按裸名匹配，可传多个
  bun .agents/skills/use-collab-session/scripts/resume.ts <完整归档目录名>…  如 2607091408-xxx；同名归档有多个时用这种写法
  bun .agents/skills/use-collab-session/scripts/resume.ts --issue <file>…    恢复仓库级 issue，可传多个；接受 archive/issues/<file> 写法
  bun .agents/skills/use-collab-session/scripts/resume.ts --help             显示本帮助

多选键位(候选按目录内最新改动时间倒序)：
  ↑↓ 移动 · space 勾选 · a 全选 · i 反选 · enter 确认 · Ctrl-C/Esc 取消
  非 TTY(管道/CI)下无参数仍是打印帮助并退出 1

行为：
  - session 移动时去掉时间戳前缀；同名归档有多个时报错列出候选
  - issue 原名移回 issues/，不改文件名
  - 一次恢复多个时先整体校验再移动，任一不合法都不动任何条目
  - 只做 mv、不碰 git；纯移动应先单独 commit，之后才开始修改内容`

if (import.meta.main) {
  await runCli(
    HELP,
    (args) => {
      const flags = args.filter(arg => arg.startsWith('-'))
      const names = args.filter(arg => !arg.startsWith('-'))
      const unknown = flags.filter(flag => flag !== '--issue')
      if (unknown.length > 0) {
        throw new Error(`未知参数: ${unknown.join(' ')}(--help 查看用法)`)
      }
      if (flags.includes('--issue')) {
        if (names.length === 0) {
          throw new Error('--issue 后需要至少一个 issue 文件名(--help 查看用法)')
        }
        resumeIssues(names).forEach(printMove)
        return
      }
      resumeSessions(names).forEach(printMove)
    },
    { interactive: pickAndResume },
  )
}
