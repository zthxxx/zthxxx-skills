#!/usr/bin/env bun
/**
 * 归档 session: `sessions/<name>/` → `archive/sessions/<YYMMDDHHmm>-<name>/`；
 * 归档仓库级 issue: `issues/<file>` → `archive/issues/<file>`(文件名不变)
 *
 * 需求：
 * - session 完成后 Agent 只 commit 不归档，归档由用户确认后手动执行(见 ../SKILL.md#完成后提交与推送)；
 *   归档是「纯目录移动 + 加时间戳前缀」，统一走本脚本，避免手工 mv 拼错时间戳格式
 * - 仓库级 issue 完成后同样由用户确认后归档(见 ../SKILL.md#归档)；
 *   issue 文件名创建时已带 `YYMMDDHHmm-` 前缀，归档只是原名平移
 *
 * 定义 / 行为：
 * - 输入裸 session 名，可一次传多个；也接受 `sessions/<name>/` 这类 tab 补全出来的路径写法(自动归一)
 * - 无参数且在终端里运行 → 进多选列表(space 勾选、enter 归档，见 prompt.ts)，只列 session，
 *   候选按目录内最新改动时间倒序；非 TTY(管道、CI、Agent 调用)仍是帮助 + 退出 1，契约不变
 * - `--all` 归档 sessions/ 下所有 session 目录(跳过 `.` 开头目录与文件)，与 <session-name> 互斥；
 *   每个 session 各自按 git 推导时间戳，且先整体校验再移动，不做半截批量
 * - `--issue <file>…` 归档仓库级 issue；`<file>` 接受裸文件名或 `issues/<file>` 路径写法；
 *   与 <session-name>、`--all` 互斥(带 `--issue` 时其余位置参数都按 issue 文件处理)
 * - 时间戳默认从 git 推导，格式 YYMMDDHHmm(本地时间，年取后两位) ——
 *   归档名要反映「这件事实际完成的时刻」，而非归档动作执行的时刻(归档往往滞后于完成)：
 *   - 目录工作区干净 → 最后一次触及该目录的 commit 时间
 *   - 目录有未提交改动 → 所有被 git 追踪文件的最新 mtime(改动未进 commit，commit 时间会偏早)
 *   - 既无 commit 也无追踪文件 → 报错(先 commit 再归档，见 ../SKILL.md#完成后提交与推送)
 * - 源不存在、目标已存在、session 名本身已带时间戳前缀 → 报错退出，不做半截操作
 * - mv 之后把移动过的条目(源与目标)精确 `git add` 进 stage —— 只传这些路径的 pathspec，
 *   不动仓库里其他改动；源已不存在但仍有 index 记录，git 会记成删除并与目标配对成 rename。
 *   不做 commit：末尾打印一段建议的 `git commit` 命令(subject 固定、body 逐行列名字)，由调用方执行
 *
 * 用法(--help / 无参数时显示)：
 *   bun .agents/skills/use-session/scripts/archive.ts
 *   bun .agents/skills/use-session/scripts/archive.ts <session-name> [<session-name> ...]
 *   bun .agents/skills/use-session/scripts/archive.ts --all
 *   bun .agents/skills/use-session/scripts/archive.ts --issue <file> [<file> ...]
 *
 * 单测隔离: archiveSession() / archiveSessions() / archiveAllSessions() / archiveIssues() 只做 mv，
 * 目录与时间戳都可经 options 注入，测试用临时目录替换生产的 sessions/、archive/sessions/、issues/、archive/issues/；
 * git add 独立成 stageMoves()，由 CLI 层在 mv 之后调用，单测在 git init 过的临时仓库里验证(见 zthxxx-skills 仓库的 tests/use-session/session.test.ts)
 */

import type { IssuePaths, SessionPaths } from './lib'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  archivedPrefixRe,
  defaultIssuePaths,
  defaultPaths,
  formatTimestamp,
  listSessionDirs,
  moveEntries,
  normalizeName,
  printMove,
  runCli,
} from './lib'
import { pickSessions } from './prompt'

export interface ArchiveOptions extends Partial<SessionPaths> {
  /** 归档时间戳(YYMMDDHHmm)，默认从 git 推导(见文件头)；单测与特殊场景传固定值覆盖 */
  timestamp?: string
}

/** 建议 commit 的固定 subject：session 归档与 issue 归档各一条 */
export const SESSION_COMMIT_SUBJECT = 'chore: batch archive finished sessions'
export const ISSUE_COMMIT_SUBJECT = 'chore: archive finished issues'

/** 在指定目录下执行 git 并返回 stdout；失败时抛出带 stderr 的可读错误 */
function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }
  catch (error) {
    const stderr
      = error instanceof Object && 'stderr' in error ? String(error.stderr).trim() : String(error)
    throw new Error(`git ${args.join(' ')} 失败(cwd: ${cwd}): ${stderr}`)
  }
}

/**
 * 从 git 推导 session 目录的归档时间戳(规则见文件头「行为」)：
 * 干净 → 最后触及该目录的 commit 时间；有未提交改动 → 所有追踪文件的最新 mtime
 */
export function resolveGitTimestamp(sessionDir: string): string {
  if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
    throw new Error(`源不存在或不是目录: ${sessionDir}`)
  }
  const dirty = git(sessionDir, 'status', '--porcelain', '--', '.').trim() !== ''
  if (!dirty) {
    const epoch = git(sessionDir, 'log', '-1', '--format=%ct', '--', '.').trim()
    if (epoch !== '')
      return formatTimestamp(new Date(Number(epoch) * 1000))
  }
  const mtimes = git(sessionDir, 'ls-files', '-z')
    .split('\0')
    .filter(Boolean)
    .map(file => path.join(sessionDir, file))
    .filter(file => fs.existsSync(file))
    .map(file => fs.statSync(file).mtimeMs)
  if (mtimes.length === 0) {
    throw new Error(
      `无法从 git 推导归档时间戳(目录既无 commit 记录、也无被 git 追踪的文件，先 commit 再归档): ${sessionDir}`,
    )
  }
  return formatTimestamp(new Date(Math.max(...mtimes)))
}

const timestampRe = /^\d{10}$/

function resolveTimestamp(sessionDir: string, options: ArchiveOptions): string {
  const timestamp = options.timestamp ?? resolveGitTimestamp(sessionDir)
  if (!timestampRe.test(timestamp)) {
    throw new Error(`时间戳格式应为 YYMMDDHHmm: ${timestamp}`)
  }
  return timestamp
}

/** 批量归档；先整体校验所有源与目标(含逐个推导时间戳)，任何一项不合法都不动任何目录 */
export function archiveSessions(names: readonly string[], options: ArchiveOptions = {}): Array<{ from: string, to: string }> {
  const { sessionsDir, archiveDir } = { ...defaultPaths, ...options }
  const moves = names.map((name) => {
    const bareName = normalizeName(name)
    if (archivedPrefixRe.test(bareName)) {
      throw new Error(`session 名不应自带时间戳前缀(时间戳由本脚本添加): ${bareName}`)
    }
    const from = path.join(sessionsDir, bareName)
    const timestamp = resolveTimestamp(from, options)
    return { from, to: path.join(archiveDir, `${timestamp}-${bareName}`) }
  })
  return moveEntries(moves)
}

export function archiveSession(name: string, options: ArchiveOptions = {}): { from: string, to: string } {
  return archiveSessions([name], options)[0]!
}

/** 归档 sessions/ 下所有 session 目录(顺序即列表顺序: 最近改动的在前) */
export function archiveAllSessions(options: ArchiveOptions = {}): Array<{ from: string, to: string }> {
  const { sessionsDir } = { ...defaultPaths, ...options }
  return archiveSessions(
    listSessionDirs(sessionsDir).map(entry => entry.name),
    options,
  )
}

/** 批量归档仓库级 issue：`issues/<file>` → `archive/issues/<file>`，文件名不变；先整体校验再移动 */
export function archiveIssues(files: readonly string[], options: Partial<IssuePaths> = {}): Array<{ from: string, to: string }> {
  const { issuesDir, archiveIssuesDir } = { ...defaultIssuePaths, ...options }
  const moves = files.map((file) => {
    const name = normalizeName(file, 'issue 文件名')
    return { from: path.join(issuesDir, name), to: path.join(archiveIssuesDir, name) }
  })
  return moveEntries(moves, 'file')
}

/**
 * 把一批已完成的移动精确 git add 进 stage：pathspec 只列每条移动的源与目标，
 * 源已不在工作区但 index 里还有记录，git 记成删除并与目标配对成 rename。
 * 一次 git 调用 —— 任一 pathspec 不匹配(如源从未被 git 追踪)则 git 整批拒绝、stage 原样不动
 */
export function stageMoves(moves: ReadonlyArray<{ from: string, to: string }>): void {
  if (moves.length === 0)
    return
  try {
    // 目标可能是文件(issue)，git 的 cwd 取目标所在目录
    git(path.dirname(moves[0]!.to), 'add', '-A', '--', ...moves.flatMap(({ from, to }) => [from, to]))
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`已移动完成，但 git add 到 stage 失败，请手动 git add 后再 commit：\n${reason}`)
  }
}

/** 建议的 commit 命令：subject 固定，body 每行一个名字；名字放在单引号里，内含 ' 时按 shell 规则转义 */
export function formatCommitHint(names: readonly string[], subject: string = SESSION_COMMIT_SUBJECT): string {
  const message = `${subject}\n\n${names.map(name => `- ${name}`).join('\n')}\n`
  return `如果要 git commit 提交这些改动，可以使用以下命令：\n\ngit commit -m '${message.replaceAll(`'`, `'\\''`)}'`
}

/** CLI 收尾：打印移动结果 → 精确 git add → 打印建议的 commit 命令 */
function finishArchive(moves: ReadonlyArray<{ from: string, to: string }>, subject: string = SESSION_COMMIT_SUBJECT): void {
  moves.forEach(printMove)
  stageMoves(moves)
  console.log(`\n已将以上 ${moves.length} 个条目的移动 git add 到 stage\n`)
  console.log(formatCommitHint(moves.map(({ from }) => path.basename(from)), subject))
}

/** 无参数 + TTY 时的交互入口：列出 sessions/ 下候选，多选后一次性归档 */
async function pickAndArchive(): Promise<void> {
  const entries = listSessionDirs(defaultPaths.sessionsDir)
  if (entries.length === 0) {
    console.log('sessions/ 下没有可归档的 session')
    return
  }
  const picked = await pickSessions(
    '选择要归档的 session(sessions/ → archive/sessions/)',
    entries.map(({ name, mtimeMs }) => ({
      value: name,
      label: name,
      hint: formatTimestamp(new Date(mtimeMs)),
    })),
  )
  if (picked === null) {
    throw new Error('已取消，未归档任何 session')
  }
  if (picked.length === 0) {
    console.log('未选择任何 session')
    return
  }
  finishArchive(archiveSessions(picked))
}

const HELP = `归档 session: sessions/<name>/ → archive/sessions/<YYMMDDHHmm>-<name>/
归档仓库级 issue: issues/<file> → archive/issues/<file>(文件名不变)

用法：
  bun .agents/skills/use-session/scripts/archive.ts                  终端下进多选列表，勾选后一次性归档 session
  bun .agents/skills/use-session/scripts/archive.ts <session-name>…  归档指定 session，可传多个
  bun .agents/skills/use-session/scripts/archive.ts --all            归档 sessions/ 下所有 session 目录(跳过 . 开头)
  bun .agents/skills/use-session/scripts/archive.ts --issue <file>…  归档仓库级 issue，可传多个；接受 issues/<file> 写法
  bun .agents/skills/use-session/scripts/archive.ts --help           显示本帮助

多选键位(候选按目录内最新改动时间倒序)：
  ↑↓ 移动 · space 勾选 · a 全选 · i 反选 · enter 确认 · Ctrl-C/Esc 取消
  非 TTY(管道/CI)下无参数仍是打印帮助并退出 1

行为：
  - <session-name>、--all、--issue 三者互斥，只能传其一
  - 时间戳从 git 推导(YYMMDDHHmm，本地时间，年取后两位)：目录干净取最后一次触及
    该目录的 commit 时间；有未提交改动时取所有被 git 追踪文件的最新 mtime
  - issue 文件名创建时已带时间戳，归档时原名平移，不再加前缀
  - 一次归档多个时先整体校验再移动，任一不合法都不动任何条目
  - 移动完成后只把这些条目(源与目标)精确 git add 进 stage，不动仓库其他改动、不 commit；
    末尾打印一段建议的 git commit 命令，由调用方执行`

if (import.meta.main) {
  await runCli(
    HELP,
    (args) => {
      const flags = args.filter(arg => arg.startsWith('-'))
      const names = args.filter(arg => !arg.startsWith('-'))
      const unknown = flags.filter(flag => flag !== '--all' && flag !== '--issue')
      if (unknown.length > 0) {
        throw new Error(`未知参数: ${unknown.join(' ')}(--help 查看用法)`)
      }
      if (flags.includes('--issue')) {
        if (flags.includes('--all')) {
          throw new Error('--issue 与 --all 互斥，只能传其一(--help 查看用法)')
        }
        if (names.length === 0) {
          throw new Error('--issue 后需要至少一个 issue 文件名(--help 查看用法)')
        }
        finishArchive(archiveIssues(names), ISSUE_COMMIT_SUBJECT)
        return
      }
      if (flags.includes('--all')) {
        if (names.length > 0) {
          throw new Error('--all 与 <session-name> 互斥，只能传其一(--help 查看用法)')
        }
        const moves = archiveAllSessions()
        if (moves.length === 0) {
          console.log('sessions/ 下没有可归档的 session')
          return
        }
        finishArchive(moves)
        return
      }
      finishArchive(archiveSessions(names))
    },
    { interactive: pickAndArchive },
  )
}
