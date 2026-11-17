#!/usr/bin/env bun
/**
 * 新建 session: 建立 `sessions/<title>/` 的标准目录骨架 + 主记录 CONTEXT.md
 *
 * 需求：
 * - User 与 Agent 按 ../SKILL.md 的创建规则调用本脚本，统一从模板初始化主记录 CONTEXT.md；
 *   其他协作文件(GLOSSARY.md、docs/spec.md、issues/、adr/ 等)在需要时按需创建
 * - CONTEXT.md 顶部的 frontmatter 记录创建时所在的 Agent 会话 id(之后接手的 Agent 由 takeover.ts 追加)，
 *   供用户之后手动 `claude --resume <id>` / `codex resume <id>` 接回原对话(语义见 ../SKILL.md)
 *
 * 定义 / 行为：
 * - 输入 session title(即目录名，命名约定见 ../SKILL.md#命名与创建)；
 *   也接受 `sessions/<title>/` 这类 tab 补全出来的路径写法(自动归一)
 * - 按 ../SKILL.md 定义的内部结构建立空目录：
 *   artifacts/ minutes/ docs/ assets/ scripts/
 * - CONTEXT.md 直接从本目录的 template/CONTEXT.md 复制，
 *   复制时做简易变量替换：模板中的 `{{变量名}}` 占位符(允许花括号内空格)替换为实际值；
 *   模板出现未知变量则报错，保证模板与脚本同步演进。现有变量：
 *   - SessionTitle = session 目录名
 *   - ClaudeCodeSessionId / CodexSessionId = 运行本脚本的 shell 里各 CLI 注入的会话 id 环境变量(见 sessionIdEnvVars)；
 *     只有在 Claude Code / Codex 会话的 shell 里跑(Agent 的 shell 工具，或用户在会话里用 `!` 前缀)才有值，
 *     普通终端里取不到，一律写成 `null`
 * - title 不能以 `.` 开头(归档、恢复脚本列 session 时会跳过 `.` 开头的目录)；
 *   目标 sessions/<title>/ 已存在 → 报错退出(并行撞名按 ../SKILL.md#命名与创建 自行加 -2 -3 后缀)
 * - 只建目录写文件，不碰 git
 *
 * 用法(--help / 无参数时显示)：
 *   bun .agents/skills/use-collab-session/scripts/new.ts <title>
 *
 * 单测隔离: createSession() 的 sessions 目录、模板目录、环境变量都可经 options 注入，
 * 测试用临时目录替换生产的 sessions/ 与 template/、用普通对象替换 process.env(见 zthxxx-skills 仓库的 tests/collab-session/use-collab-session/session.test.ts)
 */

import type { SessionPaths } from './lib'
import fs from 'node:fs'
import path from 'node:path'
import { defaultPaths, normalizeName, runCli } from './lib'

/** session 内部目录骨架(定义见 ../SKILL.md);`.logs/` 等不进 git 的过程目录按需创建，不在骨架内 */
export const sessionSubDirs = [
  'artifacts',
  'minutes',
  'docs',
  'assets',
  'scripts',
] as const

/**
 * 各 Agent CLI 注入到 shell 子进程的会话 id 环境变量，按顺序取第一个非空值：
 * - Claude Code 2.1.266: `CLAUDE_CODE_SESSION_ID`，即 `claude --resume <id>` 用的 id
 * - codex-cli 0.153.4: `CODEX_THREAD_ID` 与旧名 `CODEX_SESSION_ID` 同值，即 `codex resume <id>` 用的 id
 * 注意 Claude Code 的 codex 插件会另外注入 `CODEX_COMPANION_SESSION_ID`，它是 Claude 会话 id 的镜像、不是 Codex 的，不能用
 */
export const sessionIdEnvVars = {
  ClaudeCodeSessionId: ['CLAUDE_CODE_SESSION_ID'],
  CodexSessionId: ['CODEX_THREAD_ID', 'CODEX_SESSION_ID'],
} as const

export type SessionIdVar = keyof typeof sessionIdEnvVars

/** 环境变量里取不到会话 id 时 frontmatter 写的值(YAML null) */
export const NULL_SESSION_ID = 'null'

/** 从环境变量读出各 CLI 的会话 id；未设置或空白 → NULL_SESSION_ID */
export function readSessionIds(env: Record<string, string | undefined> = process.env): Record<SessionIdVar, string> {
  return Object.fromEntries(
    Object.entries(sessionIdEnvVars).map(([key, names]) => [
      key,
      names.map(name => env[name]?.trim()).find(value => value) ?? NULL_SESSION_ID,
    ]),
  ) as Record<SessionIdVar, string>
}

export interface NewSessionOptions extends Partial<Pick<SessionPaths, 'sessionsDir'>> {
  /** CONTEXT.md 模板所在目录，默认本目录的 template/；单测与特殊场景传入覆盖 */
  templateDir?: string
  /** 读会话 id 用的环境变量表，默认 process.env；单测传入普通对象模拟各 CLI 的会话环境 */
  env?: Record<string, string | undefined>
}

const defaultTemplateDir = path.join(import.meta.dir, 'template')

const templateVarRe = /\{\{\s*(\w+)\s*\}\}/g

/** 模板简易变量替换: `{{变量名}}`(允许花括号内空格)；未知变量报错(见文件头) */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(templateVarRe, (matched, key: string) => {
    const value = vars[key]
    if (value === undefined) {
      throw new Error(`模板中出现未知变量 ${matched}(已支持: ${Object.keys(vars).join(', ')})`)
    }
    return value
  })
}

/** 按模板新建 session 的实现；建骨架目录并从模板生成 CONTEXT.md */
export function createSession(title: string, options: NewSessionOptions = {}): { dir: string } {
  const sessionsDir = options.sessionsDir ?? defaultPaths.sessionsDir
  const templateDir = options.templateDir ?? defaultTemplateDir
  const name = normalizeName(title)
  if (name.startsWith('.')) {
    throw new Error(`session 名不能以 . 开头(归档、恢复脚本列 session 时会跳过 . 开头的目录): ${name}`)
  }
  const dir = path.join(sessionsDir, name)
  if (fs.existsSync(dir)) {
    throw new Error(`session 已存在，拒绝覆盖: ${dir}(并行撞名时按 use-collab-session 的 SKILL.md「命名与创建」加 -2 -3 后缀)`)
  }
  // 先读模板并完成变量替换、再建目录：模板缺失或含未知变量时直接报错退出，不留半截骨架
  const template = fs.readFileSync(path.join(templateDir, 'CONTEXT.md'), 'utf8')
  const context = renderTemplate(template, { SessionTitle: name, ...readSessionIds(options.env) })
  for (const subdir of sessionSubDirs) {
    fs.mkdirSync(path.join(dir, subdir), { recursive: true })
  }
  fs.writeFileSync(path.join(dir, 'CONTEXT.md'), context)
  return { dir }
}

const HELP = `新建 session: 建立 sessions/<title>/ 的标准目录骨架 + 主记录 CONTEXT.md

用法：
  bun .agents/skills/use-collab-session/scripts/new.ts <title>    title 即 session 目录名(命名约定见 use-collab-session 的 SKILL.md「命名与创建」)

行为：
  - 建立空目录: artifacts/ minutes/ docs/ assets/ scripts/
  - CONTEXT.md 从 use-collab-session 的 scripts/template/CONTEXT.md 复制，并替换模板中的 {{}} 变量:
      SessionTitle        = <title>
      ClaudeCodeSessionId = $CLAUDE_CODE_SESSION_ID(Claude Code 会话的 shell 里才有)
      CodexSessionId      = $CODEX_THREAD_ID(Codex 会话的 shell 里才有；兜底 $CODEX_SESSION_ID)
    两个 id 写进 CONTEXT.md 顶部 frontmatter，取不到写 null；
    之后可用 claude --resume <id> / codex resume <id> 接回创建它的会话
  - 目标已存在则报错；只建目录写文件，不碰 git
  - User 与 Agent 均通过本脚本创建 session，按需拆文件的规则见 use-collab-session 的 SKILL.md`

if (import.meta.main) {
  await runCli(HELP, (args) => {
    const flags = args.filter(arg => arg.startsWith('-'))
    if (flags.length > 0) {
      throw new Error(`未知参数: ${flags.join(' ')}(--help 查看用法)`)
    }
    if (args.length !== 1) {
      throw new Error(`一次只能新建一个 session，收到: ${args.join(' ')}(--help 查看用法)`)
    }
    const { dir } = createSession(args[0]!)
    console.log(dir)
    console.log(`  ${sessionSubDirs.map(subdir => `${subdir}/`).join(' ')}`)
    console.log('  CONTEXT.md')
  })
}
