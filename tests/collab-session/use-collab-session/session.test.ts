/**
 * archive.ts / resume.ts / new.ts / takeover.ts / prompt.ts(纯核心) 的单元测试 —— 与生产环境隔离：
 * 每个用例在 os.tmpdir() 下 mkdtemp 构造同构的 sessions/、archive/sessions/、issues/、archive/issues/，
 * 经 options 注入替换生产默认路径、时间戳传固定值，绝不触碰仓库真实目录
 *
 * 用法: bun test tests/collab-session/use-collab-session/
 *
 * 测试风格：以 property-based 为主 —— 固定种子的 PRNG 生成随机 session 名与时间戳，
 * 断言不变量(归档命名规则 / archive→resume 往返恒等 / 内容保持)，辅以边界错误用例
 */

import type { PickerKey, SessionChoice } from '../../../skills/collab-session/use-collab-session/scripts/prompt'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  archiveAllSessions,
  archiveIssues,
  archiveSession,
  archiveSessions,
  formatCommitHint,
  ISSUE_COMMIT_SUBJECT,
  resolveGitTimestamp,
  stageMoves,
} from '../../../skills/collab-session/use-collab-session/scripts/archive'
import { formatTimestamp, latestMtimeMs, listSessionDirs } from '../../../skills/collab-session/use-collab-session/scripts/lib'
import { createSession, readSessionIds, sessionSubDirs } from '../../../skills/collab-session/use-collab-session/scripts/new'
import {
  createPickerState,
  decodeKeys,
  maxItems,
  renderPicker,
  resizePicker,
  stepPicker,
  visibleRange,
} from '../../../skills/collab-session/use-collab-session/scripts/prompt'
import { resumeIssues, resumeSession, resumeSessions } from '../../../skills/collab-session/use-collab-session/scripts/resume'
import { addSessionIds, sessionIdKeys, takeoverSession } from '../../../skills/collab-session/use-collab-session/scripts/takeover'

// ---- 隔离的临时环境 ----

interface TestEnv {
  root: string
  sessionsDir: string
  archiveDir: string
  issuesDir: string
  archiveIssuesDir: string
}

const envRoots: string[] = []

function makeEnv(): TestEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-scripts-test-'))
  envRoots.push(root)
  const env = {
    root,
    sessionsDir: path.join(root, 'sessions'),
    archiveDir: path.join(root, 'archive', 'sessions'),
    issuesDir: path.join(root, 'issues'),
    archiveIssuesDir: path.join(root, 'archive', 'issues'),
  }
  fs.mkdirSync(env.sessionsDir, { recursive: true })
  fs.mkdirSync(env.archiveDir, { recursive: true })
  fs.mkdirSync(env.issuesDir, { recursive: true })
  fs.mkdirSync(env.archiveIssuesDir, { recursive: true })
  return env
}

afterEach(() => {
  for (const root of envRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

/** 在 sessions/ 下造一个带内容的 session，主记录 CONTEXT.md 的内容即用于校验内容保持的 marker */
function seedSession(env: TestEnv, name: string, marker: string): void {
  const dir = path.join(env.sessionsDir, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), marker)
}

/** 在 issues/ 下造一个仓库级 issue 文件 */
function seedIssue(env: TestEnv, file: string, marker: string): void {
  fs.writeFileSync(path.join(env.issuesDir, file), marker)
}

// ---- 固定种子 PRNG 与生成器(property-based) ----

function mulberry32(seed: number) {
  return (): number => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

function randomInt(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

const pick = <T>(rand: Rand, items: readonly T[]): T => items[randomInt(rand, 0, items.length - 1)]!

const nameHeadChars = [...'abcdefghijklmnopqrstuvwxyzABC归档恢复测试会议方案分析文档脚本目标'] as const
const nameTailChars = [...nameHeadChars, ...'0123456789-_'] as const

/** 随机 session 名：首字符非数字(避免撞时间戳前缀语义)，混合 CJK / ASCII / 连字符 */
function randomName(rand: Rand): string {
  const length = randomInt(rand, 1, 24)
  let name = pick(rand, nameHeadChars)
  while (name.length < length) name += pick(rand, nameTailChars)
  return name
}

/** 一批互不相同的随机 session 名 */
function uniqueNames(rand: Rand, count: number): string[] {
  const names = new Set<string>()
  while (names.size < count) names.add(randomName(rand))
  return [...names]
}

/** 把整棵目录树(含目录自身)的 mtime 定到指定时刻 —— latestMtimeMs 取的是树内最大值 */
function touchTree(dir: string, epochMs: number): void {
  const time = new Date(epochMs)
  const walk = (current: string): void => {
    if (fs.lstatSync(current).isDirectory()) {
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry))
    }
    // 后序：先改子项再改目录自身，改子项 mtime 不会反过来动到父目录
    fs.utimesSync(current, time, time)
  }
  walk(dir)
}

/** 随机 mtime(毫秒，约 2023–2033 年，对齐到秒避免文件系统精度差异) */
const randomMtimeMs = (rand: Rand): number => randomInt(rand, 1_700_000_000, 2_000_000_000) * 1000

/** 随机合法时间戳：随机 Date → formatTimestamp，顺带覆盖 formatTimestamp 的取值域 */
function randomTimestamp(rand: Rand): string {
  return formatTimestamp(
    new Date(
      2000 + randomInt(rand, 24, 99),
      randomInt(rand, 0, 11),
      randomInt(rand, 1, 28),
      randomInt(rand, 0, 23),
      randomInt(rand, 0, 59),
    ),
  )
}

// ---- property-based 不变量 ----

describe('property: 随机名字与时间戳下的不变量', () => {
  test('归档命名规则 + archive→resume 往返恒等 + 内容保持', () => {
    const rand = mulberry32(20260709)
    for (let i = 0; i < 100; i++) {
      const env = makeEnv()
      const name = randomName(rand)
      const timestamp = randomTimestamp(rand)
      const marker = `marker-${i}-${name}`
      seedSession(env, name, marker)

      // 归档：目录名 = <timestamp>-<name>，源目录消失，内容原样搬走
      const archived = archiveSession(name, { ...env, timestamp })
      expect(timestamp).toMatch(/^\d{10}$/)
      expect(archived.to).toBe(path.join(env.archiveDir, `${timestamp}-${name}`))
      expect(fs.existsSync(path.join(env.sessionsDir, name))).toBe(false)
      expect(fs.readFileSync(path.join(archived.to, 'CONTEXT.md'), 'utf8')).toBe(marker)

      // 恢复(裸名)：回到原位、去掉时间戳前缀，archive 中消失，内容仍在 → 往返恒等
      const resumed = resumeSession(name, env)
      expect(resumed.to).toBe(path.join(env.sessionsDir, name))
      expect(fs.existsSync(archived.to)).toBe(false)
      expect(fs.readFileSync(path.join(resumed.to, 'CONTEXT.md'), 'utf8')).toBe(marker)
    }
  })

  test('恢复时传完整归档目录名与传裸名等价', () => {
    const rand = mulberry32(709)
    for (let i = 0; i < 50; i++) {
      const env = makeEnv()
      const name = randomName(rand)
      const timestamp = randomTimestamp(rand)
      seedSession(env, name, 'x')
      archiveSession(name, { ...env, timestamp })

      const resumed = resumeSession(`${timestamp}-${name}`, env)
      expect(resumed.to).toBe(path.join(env.sessionsDir, name))
    }
  })
})

// ---- 边界与错误用例 ----

const FIXED_TS = '2607091500'

describe('archiveSession', () => {
  test('接受 sessions/<name>/ 路径写法并归一', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    const { to } = archiveSession('sessions/foo/', { ...env, timestamp: FIXED_TS })
    expect(to).toBe(path.join(env.archiveDir, `${FIXED_TS}-foo`))
  })

  test('archive/sessions/ 不存在时自动创建', () => {
    const env = makeEnv()
    fs.rmSync(env.archiveDir, { recursive: true })
    seedSession(env, 'foo', 'x')
    archiveSession('foo', { ...env, timestamp: FIXED_TS })
    expect(fs.existsSync(path.join(env.archiveDir, `${FIXED_TS}-foo`))).toBe(true)
  })

  test('session 不存在 → 报错', () => {
    const env = makeEnv()
    expect(() => archiveSession('不存在', { ...env, timestamp: FIXED_TS })).toThrow('源不存在')
  })

  test('目标已存在 → 报错，且源不动', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    fs.mkdirSync(path.join(env.archiveDir, `${FIXED_TS}-foo`), { recursive: true })
    expect(() => archiveSession('foo', { ...env, timestamp: FIXED_TS })).toThrow('拒绝覆盖')
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(true)
  })

  test('输入自带时间戳前缀 → 报错', () => {
    const rand = mulberry32(240)
    const env = makeEnv()
    for (let i = 0; i < 50; i++) {
      const prefixed = `${randomTimestamp(rand)}-${randomName(rand)}`
      expect(() => archiveSession(prefixed, { ...env, timestamp: FIXED_TS })).toThrow(
        '不应自带时间戳前缀',
      )
    }
  })

  test('任务时间段写在名字末尾或用 8 位日期开头，都不算时间戳前缀', () => {
    const env = makeEnv()
    for (const name of ['xx项目周报-20261026', 'xx项目进展-202610', '20261026-xx周报']) {
      seedSession(env, name, 'x')
      const { to } = archiveSession(name, { ...env, timestamp: FIXED_TS })
      expect(to).toBe(path.join(env.archiveDir, `${FIXED_TS}-${name}`))
    }
  })

  test('非法时间戳格式 → 报错', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    expect(() => archiveSession('foo', { ...env, timestamp: '2026-07-09' })).toThrow(
      '时间戳格式',
    )
  })
})

describe('archiveAllSessions', () => {
  test('归档全部 session 目录，跳过 . 开头目录与普通文件，批量共用同一时间戳', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    seedSession(env, 'bar', 'y')
    fs.mkdirSync(path.join(env.sessionsDir, '.logs'), { recursive: true })
    fs.writeFileSync(path.join(env.sessionsDir, 'README.md'), 'readme')

    const moves = archiveAllSessions({ ...env, timestamp: FIXED_TS })
    expect(moves.map(({ to }) => path.basename(to)).sort()).toEqual([
      `${FIXED_TS}-bar`,
      `${FIXED_TS}-foo`,
    ])
    expect(fs.existsSync(path.join(env.sessionsDir, '.logs'))).toBe(true)
    expect(fs.existsSync(path.join(env.sessionsDir, 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(false)
    expect(fs.existsSync(path.join(env.sessionsDir, 'bar'))).toBe(false)
  })

  test('sessions/ 为空 → 返回空数组，不报错', () => {
    const env = makeEnv()
    expect(archiveAllSessions({ ...env, timestamp: FIXED_TS })).toEqual([])
  })

  test('任一目标已存在 → 整体中止，一个都不移动', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    seedSession(env, 'bar', 'y')
    fs.mkdirSync(path.join(env.archiveDir, `${FIXED_TS}-foo`), { recursive: true })
    expect(() => archiveAllSessions({ ...env, timestamp: FIXED_TS })).toThrow('拒绝覆盖')
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(true)
    expect(fs.existsSync(path.join(env.sessionsDir, 'bar'))).toBe(true)
    expect(fs.existsSync(path.join(env.archiveDir, `${FIXED_TS}-bar`))).toBe(false)
  })
})

describe('批量归档 / 批量恢复(多选与多参数共用的入口)', () => {
  test('property: 一次多个 = 逐个的效果，且 archive→resume 往返恒等', () => {
    const rand = mulberry32(20260806)
    for (let i = 0; i < 30; i++) {
      const env = makeEnv()
      const timestamp = randomTimestamp(rand)
      const names = uniqueNames(rand, randomInt(rand, 2, 6))
      names.forEach((name, index) => seedSession(env, name, `marker-${index}`))

      const moves = archiveSessions(names, { ...env, timestamp })
      expect(moves.map(({ to }) => path.basename(to))).toEqual(
        names.map(name => `${timestamp}-${name}`),
      )
      names.forEach((name, index) => {
        expect(fs.existsSync(path.join(env.sessionsDir, name))).toBe(false)
        const readme = path.join(env.archiveDir, `${timestamp}-${name}`, 'CONTEXT.md')
        expect(fs.readFileSync(readme, 'utf8')).toBe(`marker-${index}`)
      })

      // 恢复同样一次多个：传完整归档目录名(多选列表回传的就是这个)
      const resumed = resumeSessions(names.map(name => `${timestamp}-${name}`), env)
      expect(resumed.map(({ to }) => to)).toEqual(
        names.map(name => path.join(env.sessionsDir, name)),
      )
      expect(fs.readdirSync(env.archiveDir)).toEqual([])
    }
  })

  test('归档：任一源不存在 → 整批不动', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    expect(() => archiveSessions(['foo', '不存在'], { ...env, timestamp: FIXED_TS })).toThrow(
      '源不存在',
    )
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(true)
    expect(fs.readdirSync(env.archiveDir)).toEqual([])
  })

  test('归档：同一批里出现重复目标 → 报错，整批不动', () => {
    const env = makeEnv()
    seedSession(env, 'foo', 'x')
    expect(() => archiveSessions(['foo', 'foo'], { ...env, timestamp: FIXED_TS })).toThrow(
      '同一目标',
    )
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(true)
  })

  test('恢复：任一目标已存在 → 整批不动', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-foo'), { recursive: true })
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-bar'), { recursive: true })
    seedSession(env, 'bar', 'x')
    expect(() => resumeSessions(['2601010000-foo', '2601010000-bar'], env)).toThrow('拒绝覆盖')
    expect(fs.existsSync(path.join(env.archiveDir, '2601010000-foo'))).toBe(true)
    expect(fs.existsSync(path.join(env.archiveDir, '2601010000-bar'))).toBe(true)
  })
})

// ---- 候选列表(多选列表与 --all 共用的枚举与排序) ----

describe('listSessionDirs', () => {
  test('property: 按目录内最新改动时间倒序，跳过 . 开头目录与普通文件', () => {
    const rand = mulberry32(20260807)
    for (let i = 0; i < 30; i++) {
      const env = makeEnv()
      const names = uniqueNames(rand, randomInt(rand, 1, 8))
      const expected = names.map((name) => {
        seedSession(env, name, 'x')
        const mtimeMs = randomMtimeMs(rand)
        touchTree(path.join(env.sessionsDir, name), mtimeMs)
        return { name, mtimeMs }
      })
      // 干扰项：. 开头目录与普通文件都不该出现在候选里
      fs.mkdirSync(path.join(env.sessionsDir, '.logs'), { recursive: true })
      fs.writeFileSync(path.join(env.sessionsDir, 'README.md'), 'readme')

      expect(listSessionDirs(env.sessionsDir)).toEqual(
        expected.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name)),
      )
    }
  })

  test('目录内任一文件被改动就会顶到最前', () => {
    const env = makeEnv()
    seedSession(env, 'old', 'x')
    seedSession(env, 'new', 'y')
    touchTree(path.join(env.sessionsDir, 'new'), 1_700_000_000_000)
    touchTree(path.join(env.sessionsDir, 'old'), 1_800_000_000_000)
    expect(listSessionDirs(env.sessionsDir).map(({ name }) => name)).toEqual(['old', 'new'])

    const touched = path.join(env.sessionsDir, 'new', 'CONTEXT.md')
    const later = new Date(1_900_000_000_000)
    fs.utimesSync(touched, later, later)
    expect(listSessionDirs(env.sessionsDir).map(({ name }) => name)).toEqual(['new', 'old'])
  })

  test('根目录不存在 → 空列表，不报错', () => {
    const env = makeEnv()
    expect(listSessionDirs(path.join(env.root, '无'))).toEqual([])
  })

  test('latestMtimeMs 取全树最大值(含深层子目录)', () => {
    const env = makeEnv()
    const dir = path.join(env.sessionsDir, 'foo')
    fs.mkdirSync(path.join(dir, 'docs', 'deep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'deep', 'a.md'), 'a')
    touchTree(dir, 1_700_000_000_000)
    const deepest = path.join(dir, 'docs', 'deep', 'a.md')
    const later = new Date(1_950_000_000_000)
    fs.utimesSync(deepest, later, later)
    expect(latestMtimeMs(dir)).toBe(1_950_000_000_000)
  })
})

// ---- git 时间戳推导 ----
// 在隔离的临时环境根上 git init，用固定 epoch(@<秒> +0000)提交；
// 断言两侧都经 formatTimestamp(new Date(epoch)) 渲染，与测试机时区无关

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

/** 关掉 core.quotePath：断言里直接比对 CJK 路径原文，不要 git 的八进制转义 */
function runGit(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const result = Bun.spawnSync(['git', '-C', cwd, '-c', 'core.quotePath=false', ...args], {
    env: { ...gitEnv, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}

/** 在临时仓库根下用 sh 执行一段命令(与 runGit 同一套隔离的 git 身份) */
function runShell(cwd: string, command: string): void {
  const result = Bun.spawnSync(['sh', '-c', command], {
    cwd,
    env: gitEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`sh -c ${JSON.stringify(command)} failed: ${result.stderr.toString()}`)
  }
}

function makeGitEnv(): TestEnv {
  const env = makeEnv()
  runGit(env.root, ['init', '-q'])
  return env
}

/** 把当前全部内容按指定时刻(epoch 秒)提交 */
function commitAll(env: TestEnv, epochSeconds: number): void {
  const date = `@${epochSeconds} +0000`
  runGit(env.root, ['add', '-A'])
  runGit(env.root, ['commit', '-q', '-m', 'seed'], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
}

/** 随机 epoch 秒(约 2023–2033 年)；断言两侧同经 formatTimestamp 渲染，不受秒级取整影响 */
const randomEpoch = (rand: Rand): number => randomInt(rand, 1_700_000_000, 2_000_000_000)

describe('resolveGitTimestamp', () => {
  test('property: 干净目录 → 最后一次触及该目录的 commit 时间，且按目录隔离', () => {
    const rand = mulberry32(20260726)
    for (let i = 0; i < 10; i++) {
      const env = makeGitEnv()
      const nameA = randomName(rand)
      const nameB = `${randomName(rand)}-b`
      const epochA = randomEpoch(rand)
      const epochB = epochA + randomInt(rand, 60, 1_000_000)
      seedSession(env, nameA, 'a')
      commitAll(env, epochA)
      seedSession(env, nameB, 'b')
      commitAll(env, epochB)

      // B 的后续 commit 不影响 A 的时间戳；两目录各取各的最后触及 commit
      expect(resolveGitTimestamp(path.join(env.sessionsDir, nameA))).toBe(
        formatTimestamp(new Date(epochA * 1000)),
      )
      expect(resolveGitTimestamp(path.join(env.sessionsDir, nameB))).toBe(
        formatTimestamp(new Date(epochB * 1000)),
      )
    }
  })

  test('property: 有未提交改动 → 所有被 git 追踪文件的最新 mtime，忽略未追踪文件', () => {
    const rand = mulberry32(726)
    for (let i = 0; i < 10; i++) {
      const env = makeGitEnv()
      const name = randomName(rand)
      const epoch = randomEpoch(rand)
      seedSession(env, name, 'x')
      const dir = path.join(env.sessionsDir, name)
      fs.writeFileSync(path.join(dir, 'notes.md'), 'n')
      commitAll(env, epoch)

      // 修改一个追踪文件制造未提交改动，把全部追踪文件的 mtime 定到指定时刻，追踪文件取 max
      const changed = path.join(dir, 'CONTEXT.md')
      const mtimeEpoch = epoch + randomInt(rand, 60, 1_000_000)
      fs.writeFileSync(changed, 'changed')
      fs.utimesSync(changed, new Date(mtimeEpoch * 1000), new Date(mtimeEpoch * 1000))
      fs.utimesSync(path.join(dir, 'notes.md'), new Date(epoch * 1000), new Date(epoch * 1000))
      // 未追踪文件即使 mtime 更晚也不参与
      const untracked = path.join(dir, 'untracked.md')
      fs.writeFileSync(untracked, 'u')
      const futureEpoch = mtimeEpoch + 1_000_000
      fs.utimesSync(untracked, new Date(futureEpoch * 1000), new Date(futureEpoch * 1000))

      expect(resolveGitTimestamp(dir)).toBe(formatTimestamp(new Date(mtimeEpoch * 1000)))
    }
  })

  test('既无 commit 也无追踪文件 → 报错', () => {
    const env = makeGitEnv()
    seedSession(env, 'foo', 'x')
    expect(() => resolveGitTimestamp(path.join(env.sessionsDir, 'foo'))).toThrow(
      '无法从 git 推导归档时间戳',
    )
  })

  test('目录不存在 → 报错', () => {
    const env = makeGitEnv()
    expect(() => resolveGitTimestamp(path.join(env.sessionsDir, '不存在'))).toThrow('源不存在')
  })

  test('archiveSession 未注入时间戳时按 git 推导归档目录名', () => {
    const env = makeGitEnv()
    const epoch = 1_800_000_000
    seedSession(env, 'foo', 'x')
    commitAll(env, epoch)
    const { to } = archiveSession('foo', env)
    expect(path.basename(to)).toBe(`${formatTimestamp(new Date(epoch * 1000))}-foo`)
  })
})

// ---- mv 之后精确 git add + 建议的 commit 命令 ----

/** `git status --porcelain` 逐行：第 1 列 index 状态、第 2 列工作区状态、`??` 未追踪 */
function porcelainLines(root: string): string[] {
  return runGit(root, ['status', '--porcelain']).split('\n').filter(Boolean)
}

describe('stageMoves + formatCommitHint', () => {
  test('property: 移动过的目录整体入 stage 且配成 rename，仓库里其他改动原样不动，hint 命令可直接执行', () => {
    const rand = mulberry32(925)
    for (let i = 0; i < 6; i++) {
      const env = makeGitEnv()
      // 每批 2–5 个 session，其中一个名字带 ' 覆盖 shell 转义；末尾一个留成脏目录(改追踪文件 + 加未追踪文件)
      const names = [...uniqueNames(rand, randomInt(rand, 1, 4)), `${randomName(rand)}'quote`]
      fs.writeFileSync(path.join(env.root, '.gitignore'), '.logs/\n')
      fs.writeFileSync(path.join(env.root, 'other.md'), 'o')
      for (const name of names) {
        seedSession(env, name, `m-${name}`)
        fs.mkdirSync(path.join(env.sessionsDir, name, '.logs'))
        fs.writeFileSync(path.join(env.sessionsDir, name, '.logs', 'run.log'), 'ignored')
      }
      commitAll(env, randomEpoch(rand))
      const dirtyName = names.at(-1)!
      fs.writeFileSync(path.join(env.sessionsDir, dirtyName, 'CONTEXT.md'), 'changed')
      fs.writeFileSync(path.join(env.sessionsDir, dirtyName, 'notes.md'), 'n')
      // 与 session 无关的改动：已追踪文件的修改 + 未追踪文件，都不该被带进 stage
      fs.writeFileSync(path.join(env.root, 'other.md'), 'o2')
      fs.writeFileSync(path.join(env.root, 'stray.md'), 's')

      const moves = archiveSessions(names, env)
      stageMoves(moves)

      const lines = porcelainLines(env.root)
      const archiveRel = path.relative(env.root, env.archiveDir)
      const sessionsRel = path.relative(env.root, env.sessionsDir)
      for (const line of lines) {
        const touchesMoved = line.includes(`${archiveRel}/`) || line.includes(`${sessionsRel}/`)
        if (touchesMoved) {
          // 只属于 index 的改动：第 2 列为空格，且不是未追踪
          // cspell:disable-next-line -- git status 的状态字母
          expect(line.slice(0, 2)).toMatch(/^[ARDM] $/)
        }
      }
      expect(lines).toContain(' M other.md')
      expect(lines).toContain('?? stray.md')
      // 干净 session 的追踪文件被识别为整体 rename；脏 session 的未追踪文件也随目录进 stage；忽略文件不入 index
      const cached = runGit(env.root, ['diff', '--cached', '--name-status', '-M'])
      for (const { from, to } of moves) {
        const name = path.basename(from)
        const fromRel = path.relative(env.root, from)
        const toRel = path.relative(env.root, to)
        if (name !== dirtyName) {
          expect(cached).toContain(`R100\t${fromRel}/CONTEXT.md\t${toRel}/CONTEXT.md`)
        }
        else {
          expect(cached).toContain(`A\t${toRel}/notes.md`)
        }
        expect(cached).not.toContain(`${toRel}/.logs/`)
      }

      // hint 里的命令原样交给 sh 执行，commit message 与预期逐字相同(含带 ' 的名字)
      const hint = formatCommitHint(moves.map(({ from }) => path.basename(from)))
      expect(hint.startsWith('如果要 git commit 提交这些改动，可以使用以下命令：\n\ngit commit -m ')).toBe(true)
      runShell(env.root, hint.slice(hint.indexOf('git commit')))
      // %B 输出末尾多一个 log 自己的换行，两侧都去掉尾部空白后比对 subject + body 原文
      expect(runGit(env.root, ['log', '-1', '--format=%B']).trimEnd()).toBe(
        `chore: batch archive finished sessions\n\n${names.map(name => `- ${name}`).join('\n')}`,
      )
      // commit 之后仓库里只剩那两个无关改动
      expect(porcelainLines(env.root).sort()).toEqual([' M other.md', '?? stray.md'])
    }
  })

  test('任一源从未被 git 追踪 → git 整批拒绝、stage 原样不动，报错说明目录已移动', () => {
    const env = makeGitEnv()
    seedSession(env, 'tracked', 'a')
    commitAll(env, 1_800_000_000)
    seedSession(env, 'never-tracked', 'b')
    const moves = archiveSessions(['tracked', 'never-tracked'], { ...env, timestamp: '2601010000' })
    expect(() => stageMoves(moves)).toThrow('已移动完成，但 git add 到 stage 失败')
    expect(runGit(env.root, ['diff', '--cached', '--name-only'])).toBe('')
    expect(fs.existsSync(path.join(env.archiveDir, '2601010000-tracked'))).toBe(true)
  })

  test('空批次 → 不调用 git，不报错', () => {
    const env = makeEnv()
    expect(() => stageMoves([])).not.toThrow()
    expect(fs.existsSync(path.join(env.root, '.git'))).toBe(false)
  })
})

describe('resumeSession', () => {
  test('archive 中找不到 → 报错', () => {
    const env = makeEnv()
    expect(() => resumeSession('不存在', env)).toThrow('找不到')
  })

  test('完整归档目录名不存在 → 报错', () => {
    const env = makeEnv()
    expect(() => resumeSession('2601010000-不存在', env)).toThrow('不存在该归档目录')
  })

  test('同名归档多个 → 报错并列出候选', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-foo'), { recursive: true })
    fs.mkdirSync(path.join(env.archiveDir, '2602020000-foo'), { recursive: true })
    expect(() => resumeSession('foo', env)).toThrow(/2601010000-foo[\s\S]*2602020000-foo/)
  })

  test('裸名精确匹配，不做子串/前缀误匹配', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-foo'), { recursive: true })
    fs.mkdirSync(path.join(env.archiveDir, '2601010001-foobar'), { recursive: true })
    const { to } = resumeSession('foo', env)
    expect(to).toBe(path.join(env.sessionsDir, 'foo'))
    expect(fs.existsSync(path.join(env.archiveDir, '2601010001-foobar'))).toBe(true)
  })

  test('目标 sessions/<name> 已存在 → 报错，且归档不动', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-foo'), { recursive: true })
    seedSession(env, 'foo', 'x')
    expect(() => resumeSession('foo', env)).toThrow('拒绝覆盖')
    expect(fs.existsSync(path.join(env.archiveDir, '2601010000-foo'))).toBe(true)
  })

  test('接受 archive/sessions/<完整名>/ 路径写法并归一', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.archiveDir, '2601010000-foo'), { recursive: true })
    const { to } = resumeSession('archive/sessions/2601010000-foo/', env)
    expect(to).toBe(path.join(env.sessionsDir, 'foo'))
  })
})

// ---- 仓库级 issue 的归档与恢复 ----

/** 随机 issue 文件名：自带 YYMMDDHHmm- 前缀 + 随机名 + .md */
const randomIssueFile = (rand: Rand): string => `${randomTimestamp(rand)}-${randomName(rand)}.md`

describe('archiveIssues / resumeIssues', () => {
  test('property: 文件名不变 + archive→resume 往返恒等 + 内容保持，裸名与路径写法等价', () => {
    const rand = mulberry32(20261104)
    for (let i = 0; i < 50; i++) {
      const env = makeEnv()
      const files = [
        ...new Set(Array.from({ length: randomInt(rand, 1, 5) }).fill(randomIssueFile(rand))),
      ]
      files.forEach((file, index) => seedIssue(env, file, `issue-${index}`))
      const asInput = (file: string, prefix: string): string =>
        rand() < 0.5 ? file : `${prefix}${file}`

      const archived = archiveIssues(
        files.map(file => asInput(file, 'issues/')),
        env,
      )
      expect(archived).toEqual(
        files.map(file => ({
          from: path.join(env.issuesDir, file),
          to: path.join(env.archiveIssuesDir, file),
        })),
      )
      expect(fs.readdirSync(env.issuesDir)).toEqual([])
      files.forEach((file, index) => {
        expect(fs.readFileSync(path.join(env.archiveIssuesDir, file), 'utf8')).toBe(`issue-${index}`)
      })

      const resumed = resumeIssues(
        files.map(file => asInput(file, 'archive/issues/')),
        env,
      )
      expect(resumed.map(({ to }) => to)).toEqual(files.map(file => path.join(env.issuesDir, file)))
      expect(fs.readdirSync(env.archiveIssuesDir)).toEqual([])
      files.forEach((file, index) => {
        expect(fs.readFileSync(path.join(env.issuesDir, file), 'utf8')).toBe(`issue-${index}`)
      })
    }
  })

  test('archive/issues/ 不存在时自动创建', () => {
    const env = makeEnv()
    fs.rmSync(env.archiveIssuesDir, { recursive: true })
    seedIssue(env, '2611031200-foo.md', 'x')
    archiveIssues(['2611031200-foo.md'], env)
    expect(fs.existsSync(path.join(env.archiveIssuesDir, '2611031200-foo.md'))).toBe(true)
  })

  test('归档：任一源不存在 → 整批不动', () => {
    const env = makeEnv()
    seedIssue(env, '2611031200-foo.md', 'x')
    expect(() => archiveIssues(['2611031200-foo.md', '不存在.md'], env)).toThrow('源不存在')
    expect(fs.existsSync(path.join(env.issuesDir, '2611031200-foo.md'))).toBe(true)
    expect(fs.readdirSync(env.archiveIssuesDir)).toEqual([])
  })

  test('归档：任一目标已存在 → 报错，整批不动', () => {
    const env = makeEnv()
    seedIssue(env, '2611031200-foo.md', 'x')
    seedIssue(env, '2611031201-bar.md', 'y')
    fs.writeFileSync(path.join(env.archiveIssuesDir, '2611031201-bar.md'), 'old')
    expect(() => archiveIssues(['2611031200-foo.md', '2611031201-bar.md'], env)).toThrow('拒绝覆盖')
    expect(fs.readdirSync(env.issuesDir).sort()).toEqual(['2611031200-foo.md', '2611031201-bar.md'])
    expect(fs.readFileSync(path.join(env.archiveIssuesDir, '2611031201-bar.md'), 'utf8')).toBe('old')
  })

  test('源是目录而非文件 → 报错', () => {
    const env = makeEnv()
    fs.mkdirSync(path.join(env.issuesDir, '2611031200-dir.md'))
    expect(() => archiveIssues(['2611031200-dir.md'], env)).toThrow('不是文件')
  })

  test('恢复：目标 issues/<file> 已存在 → 报错，归档不动', () => {
    const env = makeEnv()
    fs.writeFileSync(path.join(env.archiveIssuesDir, '2611031200-foo.md'), 'archived')
    seedIssue(env, '2611031200-foo.md', 'live')
    expect(() => resumeIssues(['2611031200-foo.md'], env)).toThrow('拒绝覆盖')
    expect(fs.readFileSync(path.join(env.archiveIssuesDir, '2611031200-foo.md'), 'utf8')).toBe(
      'archived',
    )
  })

  test('issue 移动经 stageMoves 入 stage 配成 rename，hint 用 issue 的 subject 且可直接执行', () => {
    const env = makeGitEnv()
    const files = ['2611031200-foo.md', '2611031201-it\'s.md']
    files.forEach(file => seedIssue(env, file, `m-${file}`))
    fs.writeFileSync(path.join(env.root, 'other.md'), 'o')
    commitAll(env, 1_800_000_000)
    fs.writeFileSync(path.join(env.root, 'other.md'), 'o2')

    const moves = archiveIssues(files, env)
    stageMoves(moves)
    const cached = runGit(env.root, ['diff', '--cached', '--name-status', '-M'])
    for (const file of files) {
      expect(cached).toContain(`R100\tissues/${file}\tarchive/issues/${file}`)
    }

    const hint = formatCommitHint(
      moves.map(({ from }) => path.basename(from)),
      ISSUE_COMMIT_SUBJECT,
    )
    runShell(env.root, hint.slice(hint.indexOf('git commit')))
    expect(runGit(env.root, ['log', '-1', '--format=%B']).trimEnd()).toBe(
      `chore: archive finished issues\n\n${files.map(file => `- ${file}`).join('\n')}`,
    )
    expect(porcelainLines(env.root)).toEqual([' M other.md'])
  })
})

// ---- 新建 session(new.ts) ----
// 模板同样经 options 注入隔离；另有一条用例走生产模板，锚定模板文件与脚本的 {{}} 变量约定

/** 种子模板：覆盖 {{SessionTitle}} 的紧凑与带空格两种写法、多处出现 */
const SEED_TEMPLATE
  = '# {{SessionTitle}}\n\n## 原始需求 Requirement\n> 这一节写原始用户输入要求是什么\n\n标题回显: {{ SessionTitle }}\n'

/** SEED_TEMPLATE 完成变量替换后的期望内容 */
function renderedTemplate(title: string): string {
  return `# ${title}\n\n## 原始需求 Requirement\n> 这一节写原始用户输入要求是什么\n\n标题回显: ${title}\n`
}

/** 在隔离环境里造一个 CONTEXT.md 模板目录，返回其路径；可传自定义模板内容 */
function seedTemplate(env: TestEnv, content: string = SEED_TEMPLATE): string {
  const templateDir = path.join(env.root, 'template')
  fs.mkdirSync(templateDir, { recursive: true })
  fs.writeFileSync(path.join(templateDir, 'CONTEXT.md'), content)
  return templateDir
}

describe('createSession', () => {
  test('property: 随机 title → 骨架恰为子目录 + CONTEXT.md、标题替换、已存在拒绝覆盖', () => {
    const rand = mulberry32(20260726)
    for (let i = 0; i < 100; i++) {
      const env = makeEnv()
      const templateDir = seedTemplate(env)
      const name = randomName(rand)

      const { dir } = createSession(name, { sessionsDir: env.sessionsDir, templateDir })
      expect(dir).toBe(path.join(env.sessionsDir, name))
      for (const subdir of sessionSubDirs) {
        expect(fs.statSync(path.join(dir, subdir)).isDirectory()).toBe(true)
      }
      // session 根下只有骨架子目录与主记录 CONTEXT.md
      expect(fs.readdirSync(dir).sort()).toEqual([...sessionSubDirs, 'CONTEXT.md'].sort())
      // CONTEXT.md = 模板原文，所有 {{SessionTitle}}(含带空格写法)替换为 title
      expect(fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8')).toBe(renderedTemplate(name))
      // 再建同名 → 报错，且已有内容不动
      expect(() => createSession(name, { sessionsDir: env.sessionsDir, templateDir })).toThrow(
        '拒绝覆盖',
      )
      expect(fs.existsSync(path.join(dir, 'CONTEXT.md'))).toBe(true)
    }
  })

  test('接受 sessions/<title>/ 路径写法并归一', () => {
    const env = makeEnv()
    const templateDir = seedTemplate(env)
    const { dir } = createSession('sessions/foo/', { sessionsDir: env.sessionsDir, templateDir })
    expect(dir).toBe(path.join(env.sessionsDir, 'foo'))
  })

  test('title 以 . 开头 → 报错', () => {
    const env = makeEnv()
    const templateDir = seedTemplate(env)
    expect(() => createSession('.logs', { sessionsDir: env.sessionsDir, templateDir })).toThrow(
      '不能以 . 开头',
    )
  })

  test('模板缺失 → 报错，不留半截骨架', () => {
    const env = makeEnv()
    expect(() =>
      createSession('foo', { sessionsDir: env.sessionsDir, templateDir: path.join(env.root, '无') }),
    ).toThrow()
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(false)
  })

  test('模板出现未知 {{变量}} → 报错，不留半截骨架', () => {
    const env = makeEnv()
    const templateDir = seedTemplate(env, '# {{SessionTitle}}\n\n{{Unknown}}\n')
    expect(() => createSession('foo', { sessionsDir: env.sessionsDir, templateDir })).toThrow(
      '未知变量',
    )
    expect(fs.existsSync(path.join(env.sessionsDir, 'foo'))).toBe(false)
  })

  test('默认走生产模板: frontmatter 会话 id + {{SessionTitle}} 替换生效，无残留 {{}} 变量', () => {
    const env = makeEnv()
    const cases: Array<[Record<string, string | undefined>, string]> = [
      [{}, 'claude-code-session-id: null\ncodex-session-id: null'],
      [
        { CLAUDE_CODE_SESSION_ID: 'c-1', CODEX_THREAD_ID: 'x-1' },
        'claude-code-session-id: c-1\ncodex-session-id: x-1',
      ],
    ]
    for (const [ids, frontmatter] of cases) {
      const { dir } = createSession(`生产模板检查-${Object.keys(ids).length}`, {
        sessionsDir: env.sessionsDir,
        env: ids,
      })
      const context = fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8')
      expect(context.startsWith(`---\n${frontmatter}\n---\n\n# ${path.basename(dir)}\n`)).toBe(true)
      expect(context).toContain('## 原始需求 Requirement')
      expect(context).not.toContain('{{')
    }
  })
})

// ---- 会话 id 环境变量 → frontmatter ----

/** 带 id 占位符的种子模板(含带空格写法) */
const ID_TEMPLATE
  = '---\nclaude-code-session-id: {{ClaudeCodeSessionId}}\ncodex-session-id: {{ CodexSessionId }}\n---\n\n# {{SessionTitle}}\n'

/** 随机会话 id：uuid 风格的十六进制段，长度 8~36 */
function randomId(rand: Rand): string {
  const length = randomInt(rand, 8, 36)
  let id = ''
  while (id.length < length) id += pick(rand, [...'0123456789abcdef-'])
  return id.replace(/^-+|-+$/g, '') || 'a'
}

/** 单个环境变量三态取样：未设置 / 空白 / 带随机空白包裹的 id */
function randomEnvValue(rand: Rand): string | undefined {
  return pick(rand, [
    () => undefined,
    () => pick(rand, ['', ' ', '\t ']),
    () => `${pick(rand, ['', ' '])}${randomId(rand)}${pick(rand, ['', ' ', '\n'])}`,
  ])()
}

function firstNonBlank(...values: Array<string | undefined>): string {
  return values.map(value => value?.trim()).find(value => value) ?? 'null'
}

describe('readSessionIds', () => {
  test('property: 三个变量任意三态组合 → 取第一个非空值(trim 后)，否则 null；镜像变量不泄漏', () => {
    const rand = mulberry32(20260909)
    for (let i = 0; i < 300; i++) {
      const shellEnv = {
        CLAUDE_CODE_SESSION_ID: randomEnvValue(rand),
        CODEX_THREAD_ID: randomEnvValue(rand),
        CODEX_SESSION_ID: randomEnvValue(rand),
        // Claude Code 的 codex 插件注入的 Claude 会话 id 镜像，绝不能被当成 Codex 的 id
        CODEX_COMPANION_SESSION_ID: randomId(rand),
      }
      const expected = {
        ClaudeCodeSessionId: firstNonBlank(shellEnv.CLAUDE_CODE_SESSION_ID),
        CodexSessionId: firstNonBlank(shellEnv.CODEX_THREAD_ID, shellEnv.CODEX_SESSION_ID),
      }
      expect(readSessionIds(shellEnv)).toEqual(expected)

      const env = makeEnv()
      const templateDir = seedTemplate(env, ID_TEMPLATE)
      const name = randomName(rand)
      const { dir } = createSession(name, { sessionsDir: env.sessionsDir, templateDir, env: shellEnv })
      expect(fs.readFileSync(path.join(dir, 'CONTEXT.md'), 'utf8')).toBe(
        `---\nclaude-code-session-id: ${expected.ClaudeCodeSessionId}\ncodex-session-id: ${expected.CodexSessionId}\n---\n\n# ${name}\n`,
      )
    }
  })

  test('默认读 process.env：本进程里有什么就取什么', () => {
    const { CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID, CODEX_SESSION_ID } = process.env
    expect(readSessionIds()).toEqual({
      ClaudeCodeSessionId: firstNonBlank(CLAUDE_CODE_SESSION_ID),
      CodexSessionId: firstNonBlank(CODEX_THREAD_ID, CODEX_SESSION_ID),
    })
  })
})

// ---- 接手登记: 会话 id 追加进 CONTEXT.md frontmatter ----

const PROD_TEMPLATE = fs.readFileSync(path.join(import.meta.dir, '../../../skills/collab-session/use-collab-session/scripts/template/CONTEXT.md'), 'utf8')
const PROD_KEYS = sessionIdKeys(PROD_TEMPLATE)
const ID_VARS = Object.keys(PROD_KEYS) as Array<keyof typeof PROD_KEYS>

/** uuid 形状的随机会话 id：带连字符，YAML 一定解析成字符串 */
function randomUuid(rand: Rand): string {
  return [8, 4, 4, 4, 12]
    .map(length => Array.from({ length }).fill(pick(rand, [...'0123456789abcdef'])).join(''))
    .join('-')
}

/** 一个字段的随机初始写法：缺失 / null / 单值 / 块列表 / 行内列表；值从 pool 取，可能已含当前 id */
function randomFieldLines(rand: Rand, key: string, pool: readonly string[]): string[] {
  const values = [...new Set(Array.from({ length: randomInt(rand, 0, 3) }).fill(pick(rand, pool)))]
  if (values.length === 0)
    return pick(rand, [[], [`${key}: null`], [`${key}: ~`], [`${key}:`]])
  if (values.length === 1 && rand() < 0.5)
    return [`${key}: ${values[0]}`]
  const indent = pick(rand, ['  ', '    ', ''])
  return rand() < 0.7
    ? [`${key}:`, ...values.map(value => `${indent}- ${value}`)]
    : [`${key}: [${values.join(', ')}]`]
}

/** YAML 取值归一成 id 列表：缺失 / null → []，单值 → [值]，列表 → 各项 */
function asIds(value: unknown): string[] {
  return value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]
}

/** 解析文本开头的 frontmatter(独立的 YAML 解析器作为 oracle)与其后的正文 */
function splitFrontmatter(text: string): { data: Record<string, unknown> | null, body: string } {
  const match = text.match(/^---\n((?:.*\n)*?)---(?:\n|$)/)
  if (!match)
    return { data: null, body: text }
  return { data: (Bun.YAML.parse(match[1]!) ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) }
}

describe('addSessionIds', () => {
  test('property: 当前 id 不在则追加到末尾、在则不动；其他字段与正文原样；结果可重复运行', () => {
    const rand = mulberry32(20261105)
    for (let i = 0; i < 400; i++) {
      const pool = Array.from({ length: 3 }).fill(randomUuid(rand))
      const ids = Object.fromEntries(
        ID_VARS.map(name => [name, rand() < 0.7 ? pick(rand, pool) : 'null']),
      ) as Record<(typeof ID_VARS)[number], string>
      const extra = `extra-key: ${randomName(rand)}`
      const body = `\n# ${randomName(rand)}\n\n---\n${PROD_KEYS.ClaudeCodeSessionId}: 不该被改\n`
      const hasFrontmatter = rand() < 0.85
      const fieldLines = ID_VARS.flatMap(name => randomFieldLines(rand, PROD_KEYS[name], pool))
      const context = hasFrontmatter ? `---\n${[extra, ...fieldLines].join('\n')}\n---\n${body}` : body
      const before = splitFrontmatter(context).data ?? {}

      const { text, added } = addSessionIds(context, ids, PROD_KEYS)
      const after = splitFrontmatter(text)
      expect(after.data).not.toBeNull()
      expect(after.body).toBe(hasFrontmatter ? body : `\n${body}`)
      if (hasFrontmatter)
        expect(after.data!['extra-key']).toBe(before['extra-key'])

      const expectedAdded: Array<{ key: string, id: string }> = []
      for (const name of ID_VARS) {
        const key = PROD_KEYS[name]
        const old = asIds(before[key])
        const id = ids[name]
        const appended = id !== 'null' && !old.includes(id)
        if (appended)
          expectedAdded.push({ key, id })
        expect(asIds(after.data![key])).toEqual(appended ? [...old, id] : old)
        if (appended) {
          // 追加后只有一个值写单值，多个写块列表
          const shape = old.length === 0 ? `${key}: ${id}\n` : `${key}:\n${[...old, id].map(v => `  - ${v}\n`).join('')}`
          expect(text).toContain(shape)
        }
      }
      expect(added).toEqual(expectedAdded)
      if (added.length === 0 && hasFrontmatter)
        expect(text).toBe(context)

      const again = addSessionIds(text, ids, PROD_KEYS)
      expect(again).toEqual({ text, added: [] })
    }
  })
})

describe('takeoverSession', () => {
  test('property: 新建后多个 Agent 依次接手 → 各字段按首次出现顺序累积 id，重复接手不改动', () => {
    const rand = mulberry32(1105)
    for (let i = 0; i < 40; i++) {
      const env = makeEnv()
      const agents = Array.from({ length: randomInt(rand, 1, 5) }).fill({
        CLAUDE_CODE_SESSION_ID: rand() < 0.6 ? randomUuid(rand) : undefined,
        CODEX_THREAD_ID: rand() < 0.4 ? randomUuid(rand) : undefined,
      })
      const name = randomName(rand)
      createSession(name, { sessionsDir: env.sessionsDir, env: agents[0] })
      const file = path.join(env.sessionsDir, name, 'CONTEXT.md')
      const bodyAtCreation = splitFrontmatter(fs.readFileSync(file, 'utf8')).body

      const sequence = [...agents, ...agents.map(() => pick(rand, agents))]
      for (const agent of sequence) {
        if (!agent.CLAUDE_CODE_SESSION_ID && !agent.CODEX_THREAD_ID) {
          expect(() => takeoverSession(name, { sessionsDir: env.sessionsDir, env: agent })).toThrow(
            '取不到任何 Agent 会话 id',
          )
          continue
        }
        takeoverSession(name, { sessionsDir: env.sessionsDir, env: agent })
      }

      const { data, body } = splitFrontmatter(fs.readFileSync(file, 'utf8'))
      expect(body).toBe(bodyAtCreation)
      const firstSeen = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => !!v))]
      expect(asIds(data![PROD_KEYS.ClaudeCodeSessionId])).toEqual(firstSeen(sequence.map(a => a.CLAUDE_CODE_SESSION_ID)))
      expect(asIds(data![PROD_KEYS.CodexSessionId])).toEqual(firstSeen(sequence.map(a => a.CODEX_THREAD_ID)))
    }
  })

  test('没有 frontmatter 的旧 CONTEXT.md → 开头补上会话 id 字段，正文不变', () => {
    const env = makeEnv()
    seedSession(env, '旧格式', '# 旧格式\n\n正文\n')
    const { added } = takeoverSession('sessions/旧格式/', {
      sessionsDir: env.sessionsDir,
      env: { CLAUDE_CODE_SESSION_ID: 'c-1' },
    })
    expect(added).toEqual([{ key: PROD_KEYS.ClaudeCodeSessionId, id: 'c-1' }])
    expect(fs.readFileSync(path.join(env.sessionsDir, '旧格式', 'CONTEXT.md'), 'utf8')).toBe(
      `---\n${PROD_KEYS.ClaudeCodeSessionId}: c-1\n${PROD_KEYS.CodexSessionId}: null\n---\n\n# 旧格式\n\n正文\n`,
    )
  })

  test('取不到任何会话 id → 报错且不改文件；session 不存在 → 报错', () => {
    const env = makeEnv()
    seedSession(env, 'foo', '---\nclaude-code-session-id: null\n---\n')
    expect(() => takeoverSession('foo', { sessionsDir: env.sessionsDir, env: {} })).toThrow(
      '取不到任何 Agent 会话 id',
    )
    expect(fs.readFileSync(path.join(env.sessionsDir, 'foo', 'CONTEXT.md'), 'utf8')).toBe(
      '---\nclaude-code-session-id: null\n---\n',
    )
    expect(() =>
      takeoverSession('不存在', { sessionsDir: env.sessionsDir, env: { CLAUDE_CODE_SESSION_ID: 'c-1' } }),
    ).toThrow('找不到 session 主记录')
  })

  test('字段名从生产模板推导；模板缺少会话 id 占位符 → 报错', () => {
    expect(PROD_KEYS).toEqual({
      ClaudeCodeSessionId: 'claude-code-session-id',
      CodexSessionId: 'codex-session-id',
    })
    expect(() => sessionIdKeys('---\nclaude-code-session-id: {{ClaudeCodeSessionId}}\n---\n')).toThrow(
      '缺少 {{CodexSessionId}}',
    )
  })
})

// ---- CLI 层(仅覆盖不触碰文件系统的安全路径: help / 参数校验) ----

function runScript(script: string, args: string[]) {
  const result = Bun.spawnSync(
    [process.execPath, path.join(import.meta.dir, '../../../skills/collab-session/use-collab-session/scripts', script), ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('CLI', () => {
  test('--help → 帮助到 stdout，退出 0', () => {
    for (const script of ['archive.ts', 'resume.ts', 'new.ts', 'takeover.ts']) {
      const { code, stdout } = runScript(script, ['--help'])
      expect(code).toBe(0)
      expect(stdout).toContain('用法：')
    }
  })

  test('无参数 + 非 TTY → 帮助到 stderr，退出 1(不进多选，非交互契约不变)', () => {
    for (const script of ['archive.ts', 'resume.ts', 'new.ts', 'takeover.ts']) {
      const { code, stderr } = runScript(script, [])
      expect(code).toBe(1)
      expect(stderr).toContain('用法：')
    }
  })

  test('archive / resume 接受多个 session 名(源不存在时整批报错，不动任何目录)', () => {
    const archive = runScript('archive.ts', ['不存在-a', '不存在-b'])
    expect(archive.code).toBe(1)
    expect(archive.stderr).toContain('源不存在')

    const resume = runScript('resume.ts', ['不存在-a', '不存在-b'])
    expect(resume.code).toBe(1)
    expect(resume.stderr).toContain('找不到')
  })

  test('archive: --all 与 <session-name> 互斥 → 报错退出 1', () => {
    const { code, stderr } = runScript('archive.ts', ['--all', 'foo'])
    expect(code).toBe(1)
    expect(stderr).toContain('互斥')
  })

  test('archive: --issue 与 --all 互斥；archive / resume 的 --issue 缺文件名 → 报错退出 1', () => {
    const both = runScript('archive.ts', ['--issue', '--all', 'x.md'])
    expect(both.code).toBe(1)
    expect(both.stderr).toContain('互斥')
    for (const script of ['archive.ts', 'resume.ts']) {
      const { code, stderr } = runScript(script, ['--issue'])
      expect(code).toBe(1)
      expect(stderr).toContain('至少一个 issue 文件名')
    }
  })

  test('archive / resume --issue 源不存在 → 整批报错，不动任何文件', () => {
    for (const script of ['archive.ts', 'resume.ts']) {
      const { code, stderr } = runScript(script, ['--issue', '不存在-a.md', '不存在-b.md'])
      expect(code).toBe(1)
      expect(stderr).toContain('源不存在')
    }
  })

  test('未知 flag → 报错退出 1', () => {
    for (const script of ['archive.ts', 'resume.ts', 'new.ts', 'takeover.ts']) {
      const { code, stderr } = runScript(script, ['--nope'])
      expect(code).toBe(1)
      expect(stderr).toContain('未知参数')
    }
  })
})

describe('formatTimestamp', () => {
  test('已知时刻的精确值', () => {
    expect(formatTimestamp(new Date(2026, 6, 9, 14, 8))).toBe('2607091408')
    expect(formatTimestamp(new Date(2031, 11, 31, 23, 59))).toBe('3112312359')
    expect(formatTimestamp(new Date(2030, 0, 1, 0, 0))).toBe('3001010000')
  })
})

// ---- 多选交互的纯核心(prompt.ts)：按键解码、状态迁移、渲染 ----

const keyEncodings: Record<PickerKey, readonly string[]> = {
  up: ['\x1B[A', '\x1BOA'],
  down: ['\x1B[B', '\x1BOB'],
  toggle: [' '],
  confirm: ['\r', '\n'],
  cancel: ['\x03', '\x1B'],
}
const pickerKeys = Object.keys(keyEncodings) as PickerKey[]

/** 随机候选：混合短名、超长 CJK 名，hint 可有可无 */
function randomChoices(rand: Rand): SessionChoice[] {
  return uniqueNames(rand, randomInt(rand, 0, 40)).map(name => ({
    value: name,
    label: rand() < 0.3 ? name.repeat(randomInt(rand, 3, 12)) : name,
    hint: rand() < 0.7 ? randomTimestamp(rand) : undefined,
  }))
}

/** 随机按键序列；cancel / confirm 概率低，让序列能走得足够长 */
function randomKeys(rand: Rand, length: number): PickerKey[] {
  return Array.from({ length }, () => {
    const roll = rand()
    if (roll < 0.02)
      return 'cancel'
    if (roll < 0.05)
      return 'confirm'
    return pick(rand, ['up', 'down', 'down', 'toggle'] as const)
  })
}

describe('多选交互纯核心(prompt.ts)', () => {
  test('property: 任意按键序列下光标在范围内、窗口含光标且不超过高度、每行不超过列宽，确认值即模型勾选值', () => {
    const rand = mulberry32(20261111)
    for (let iter = 0; iter < 300; iter++) {
      const choices = randomChoices(rand)
      const rows = randomInt(rand, 3, 60)
      const pageSize = maxItems(rows)
      let state = createPickerState(choices, pageSize)
      const model = choices.map(() => false)
      let modelCursor = 0
      for (const key of randomKeys(rand, randomInt(rand, 0, 200))) {
        const columns = randomInt(rand, 4, 200)
        const step = stepPicker(state, key)
        if (key === 'cancel') {
          expect(step.kind).toBe('cancelled')
          break
        }
        if (key === 'confirm') {
          expect(step).toEqual({ kind: 'done', values: choices.filter((_, i) => model[i]).map(c => c.value) })
          break
        }
        expect(step.kind).toBe('pending')
        if (step.kind !== 'pending')
          break
        state = step.state
        if (choices.length > 0) {
          if (key === 'toggle')
            model[modelCursor] = !model[modelCursor]
          if (key === 'up')
            modelCursor = (modelCursor - 1 + choices.length) % choices.length
          if (key === 'down')
            modelCursor = (modelCursor + 1) % choices.length
        }
        expect(state.cursor).toBe(modelCursor)
        expect(state.selected).toEqual(model)
        const { start, end } = visibleRange(state)
        expect(end - start).toBeLessThanOrEqual(pageSize)
        if (choices.length > 0) {
          expect(start).toBeLessThanOrEqual(state.cursor)
          expect(state.cursor).toBeLessThan(end)
          expect(end - start).toBe(Math.min(pageSize, choices.length))
        }
        const lines = renderPicker(state, '选择要归档的 session(sessions/ → archive/sessions/)', { columns })
        expect(lines.length).toBeLessThanOrEqual(pageSize + 4)
        for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('property: 同一位置连按两次 space，勾选状态恒等', () => {
    const rand = mulberry32(1111)
    for (let iter = 0; iter < 200; iter++) {
      let state = createPickerState(randomChoices(rand), randomInt(rand, 1, 20))
      for (const key of randomKeys(rand, randomInt(rand, 0, 60))) {
        if (key === 'cancel' || key === 'confirm')
          continue
        const step = stepPicker(state, key)
        if (step.kind === 'pending')
          state = step.state
      }
      const once = stepPicker(state, 'toggle')
      if (once.kind !== 'pending')
        throw new Error('toggle 不应结束选择')
      const twice = stepPicker(once.state, 'toggle')
      expect(twice).toEqual({ kind: 'pending', state })
    }
  })

  test('property: 终端尺寸变化后光标与勾选不变，窗口仍含光标', () => {
    const rand = mulberry32(2611)
    for (let iter = 0; iter < 200; iter++) {
      const choices = randomChoices(rand)
      let state = createPickerState(choices, randomInt(rand, 1, 30))
      for (const key of randomKeys(rand, randomInt(rand, 0, 80))) {
        if (key === 'cancel' || key === 'confirm')
          continue
        const step = stepPicker(state, key)
        if (step.kind === 'pending')
          state = step.state
      }
      const resized = resizePicker(state, randomInt(rand, 1, 30))
      expect(resized.cursor).toBe(state.cursor)
      expect(resized.selected).toEqual(state.selected)
      const { start, end } = visibleRange(resized)
      expect(end - start).toBeLessThanOrEqual(resized.pageSize)
      if (choices.length > 0) {
        expect(start).toBeLessThanOrEqual(resized.cursor)
        expect(resized.cursor).toBeLessThan(end)
      }
    }
  })

  test('property: 任意编码拼接的输入解码回原按键序列，不认识的字符被忽略', () => {
    const rand = mulberry32(20261112)
    for (let iter = 0; iter < 500; iter++) {
      const keys = Array.from({ length: randomInt(rand, 0, 30) }).fill(pick(rand, pickerKeys))
      const chunk = keys
        .map(key => (rand() < 0.2 ? pick(rand, ['x', 'q', '中', '\t']) : '') + pick(rand, keyEncodings[key]))
        .join('')
      expect(decodeKeys(chunk)).toEqual(keys)
    }
  })
})
