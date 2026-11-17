/**
 * session 目录与仓库级 issue 文件移动的共享配置与工具 —— 被 archive.ts / resume.ts 复用
 *
 * 定义：
 * - 生产环境目录：仓库顶层 `sessions/`(活跃 session)与 `archive/sessions/`(已归档 session)，
 *   仓库级 issue 在顶层 `issues/` 与 `archive/issues/`；
 *   仓库根取当前工作目录所在 git 仓库的顶层(`git rev-parse --show-toplevel`)：脚本随 skill 装在
 *   `.agents/skills/` 或用户级目录时，自身位置推不出项目根；首次读取 defaultPaths 时才求值，
 *   不在 git 仓库里时 `--help` 仍可用
 * - 归档目录名 = `<YYMMDDHHmm>-<session-name>`(本地时间，年取后两位)
 * - 仓库级 issue 文件名自带 `YYMMDDHHmm-` 前缀，归档与恢复都不改文件名
 * - 移动一律「先整体校验再动手」(moveEntries)：多选 / 多参数一次处理若干条目，
 *   半截失败的现场比整批重来贵得多
 * - 候选列表(listSessionDirs)按目录树内最新 mtime 倒序：刚动过的排最前，
 *   多选列表与 `--all` 共用同一份枚举与顺序
 * - 目录与时间戳都从函数入参可替换(defaultPaths 只是默认值)，
 *   单测在临时目录中构造同构环境注入替换，与生产环境隔离(见 zthxxx-skills 仓库的 tests/use-session/session.test.ts)
 */

import fs from 'node:fs'
import path from 'node:path'

export interface SessionPaths {
  /** 活跃 session 根目录，默认 <repo>/sessions */
  sessionsDir: string
  /** 归档根目录，默认 <repo>/archive/sessions */
  archiveDir: string
}

export interface IssuePaths {
  /** 仓库级 issue 目录，默认 <repo>/issues */
  issuesDir: string
  /** 仓库级 issue 的归档目录，默认 <repo>/archive/issues */
  archiveIssuesDir: string
}

let cachedRepoRoot: string | undefined

function repoRoot(): string {
  if (cachedRepoRoot !== undefined)
    return cachedRepoRoot
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stderr: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(`当前目录不在 git 仓库内，无法确定仓库根: ${process.cwd()}`)
  }
  cachedRepoRoot = result.stdout.toString().trim()
  return cachedRepoRoot
}

export const defaultPaths: SessionPaths = {
  get sessionsDir() {
    return path.join(repoRoot(), 'sessions')
  },
  get archiveDir() {
    return path.join(repoRoot(), 'archive', 'sessions')
  },
}

export const defaultIssuePaths: IssuePaths = {
  get issuesDir() {
    return path.join(repoRoot(), 'issues')
  },
  get archiveIssuesDir() {
    return path.join(repoRoot(), 'archive', 'issues')
  },
}

/** 归档目录名的时间戳前缀 YYMMDDHHmm- */
export const archivedPrefixRe = /^\d{10}-/

/** Date → YYMMDDHHmm(本地时间，年取后两位)，如 2026-07-09 14:08 → "2607091408" */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    pad(date.getFullYear() % 100)
    + pad(date.getMonth() + 1)
    + pad(date.getDate())
    + pad(date.getHours())
    + pad(date.getMinutes())
  )
}

const trailingSlashesRe = /\/+$/

/** 把 CLI 传入的参数归一成裸名：去尾部斜杠、去 `sessions/` `archive/sessions/` `issues/` 等路径前缀 */
export function normalizeName(input: string, label = 'session 名'): string {
  const base = input.replace(trailingSlashesRe, '').split('/').pop() ?? ''
  if (!base || base === '.' || base === '..') {
    throw new Error(`无效的 ${label}: ${JSON.stringify(input)}`)
  }
  return base
}

/** 被移动的条目类型：session 是目录，仓库级 issue 是单个文件 */
export type EntryKind = 'dir' | 'file'

/** 校验源是已存在的对应类型条目、目标不存在；只校验不动手，供批量场景「先整体校验再移动」使用 */
export function assertMovable(from: string, to: string, kind: EntryKind = 'dir'): void {
  const stat = fs.existsSync(from) ? fs.statSync(from) : null
  if (!stat || (kind === 'dir' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`源不存在或不是${kind === 'dir' ? '目录' : '文件'}: ${from}`)
  }
  if (fs.existsSync(to)) {
    throw new Error(`目标已存在，拒绝覆盖: ${to}`)
  }
}

/** 校验后整体 rename；只做 mv，不碰 git */
export function moveEntry(from: string, to: string, kind: EntryKind = 'dir'): { from: string, to: string } {
  assertMovable(from, to, kind)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  return { from, to }
}

/**
 * 批量移动：先整体校验(源存在、目标不存在、目标互不重复)，任何一项不合法都不动任何条目 ——
 * 半截批量留下的一半已移动、一半没移动的状态，人还得自己对账，代价远高于整批重来
 */
export function moveEntries(moves: ReadonlyArray<{ from: string, to: string }>, kind: EntryKind = 'dir'): Array<{ from: string, to: string }> {
  const targets = new Set<string>()
  for (const { from, to } of moves) {
    assertMovable(from, to, kind)
    if (targets.has(to)) {
      throw new Error(`多个来源指向同一目标，拒绝覆盖: ${to}`)
    }
    targets.add(to)
  }
  return moves.map(({ from, to }) => moveEntry(from, to, kind))
}

/** 目录树内所有条目(含目录自身)的最新 mtime 毫秒数；不跟随符号链接，读不到的条目跳过 */
export function latestMtimeMs(dir: string): number {
  let latest = 0
  const pending = [dir]
  while (pending.length > 0) {
    const current = pending.pop()!
    try {
      const stat = fs.lstatSync(current)
      latest = Math.max(latest, stat.mtimeMs)
      if (!stat.isDirectory())
        continue
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        pending.push(path.join(current, entry.name))
      }
    }
    catch {
      continue
    }
  }
  return latest
}

export interface SessionDirEntry {
  name: string
  /** 目录树内最新改动时间(毫秒)，用于排序与展示 */
  mtimeMs: number
}

/**
 * 列出 root 下的 session 目录(跳过 `.` 开头目录与普通文件)，按目录内最新改动时间倒序 ——
 * 刚动过的排最前，正是要归档 / 恢复的那些；同时间用名字兜底保证顺序稳定
 */
export function listSessionDirs(root: string): SessionDirEntry[] {
  return (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [])
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, mtimeMs: latestMtimeMs(path.join(root, entry.name)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
}

/** 打印一条移动结果 */
export function printMove({ from, to }: { from: string, to: string }): void {
  console.log(`${from}\n  → ${to}`)
}

/** 交互式选择是否可用：读键走 stdin、画面走 stderr，两端都得是 TTY */
export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stderr.isTTY)

/**
 * CLI 入口的公共外壳：
 * `--help` / `-h` → 帮助到 stdout 退出 0；无参数 → 交给 interactive(仅在 TTY 下)，
 * 没有 interactive 或非 TTY 则帮助到 stderr 退出 1 —— 非交互环境的契约不变；
 * 其余交给 run(已过滤掉 help flag)，抛错则打印原因并以 1 退出
 */
export async function runCli(help: string, run: (args: string[]) => void | Promise<void>, options: { interactive?: () => Promise<void> } = {}): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help)
    process.exit(0)
  }
  if (args.length === 0 && !(options.interactive && isInteractive())) {
    console.error(help)
    process.exit(1)
  }
  try {
    await (args.length === 0 ? options.interactive!() : run(args))
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
