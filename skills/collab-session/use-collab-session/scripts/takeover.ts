#!/usr/bin/env bun
/**
 * 接手登记: 把当前 Agent 会话 id 追加进 `sessions/<name>/CONTEXT.md` 的 frontmatter
 *
 * 需求：
 * - CONTEXT.md 的 frontmatter 记录处理过该 session 的所有 Agent 会话 id(语义见 ../SKILL.md#context-主记录)；
 *   Agent 接手一个已有 session 时调用本脚本登记自己，不手写 frontmatter
 *
 * 定义 / 行为：
 * - 会话 id 与 new.ts 同源，从运行本脚本的 shell 的环境变量读取(readSessionIds)；
 *   frontmatter 字段名从 template/CONTEXT.md 的 `<字段>: {{变量名}}` 行推导，模板改字段名时随之生效
 * - 对每个取到 id 的字段：id 已在其中 → 不动；原值为 null 或空 → 写成单值；
 *   原为单值 → 改写成 YAML 列表并追加；原为列表 → 在末尾追加
 * - 取不到 id 的字段保持原样；字段缺失时补上；CONTEXT.md 没有 frontmatter 时在开头补上会话 id 字段
 * - 当前 shell 里一个会话 id 都取不到 → 报错(只有在 Claude Code / Codex 会话的 shell 里运行才有值)
 * - 只改 frontmatter 中的会话 id 字段，其余内容原样保留；可重复运行；不碰 git
 *
 * 用法(--help / 无参数时显示)：
 *   bun .agents/skills/use-session/scripts/takeover.ts <session-name>
 *
 * 单测隔离: takeoverSession() 的 sessions 目录、模板路径、环境变量都可经 options 注入(见 zthxxx-skills 仓库的 tests/use-session/session.test.ts)
 */

import type { SessionPaths } from './lib'
import type { SessionIdVar } from './new'
import fs from 'node:fs'
import path from 'node:path'
import { defaultPaths, normalizeName, runCli } from './lib'
import { NULL_SESSION_ID, readSessionIds, sessionIdEnvVars } from './new'

const defaultTemplatePath = path.join(import.meta.dir, 'template', 'CONTEXT.md')

/** `---` 包裹的 frontmatter 块；分组 1 为块内各行(含行尾换行) */
const frontmatterRe = /^---\n((?:.*\n)*?)---(?:\n|$)/

/** frontmatter 里 `<字段>: {{变量名}}` 的一行；分组 1 为字段名、2 为变量名 */
const idFieldRe = /^([\w-]+):\s*\{\{\s*(\w+)\s*\}\}\s*$/gm

/** 从模板 frontmatter 的 `<字段>: {{变量名}}` 行推导每个会话 id 变量对应的字段名 */
export function sessionIdKeys(template: string): Record<SessionIdVar, string> {
  const block = template.match(frontmatterRe)?.[1] ?? ''
  const keyOf = new Map(
    Array.from(block.matchAll(idFieldRe), m => [m[2]!, m[1]!]),
  )
  return Object.fromEntries(
    (Object.keys(sessionIdEnvVars) as SessionIdVar[]).map((name) => {
      const key = keyOf.get(name)
      if (!key)
        throw new Error(`模板 frontmatter 缺少 {{${name}}} 字段`)
      return [name, key]
    }),
  ) as Record<SessionIdVar, string>
}

const quotedRe = /^(['"])(.*)\1$/

const unquote = (value: string): string => value.trim().replace(quotedRe, '$2')

/** 解析一个字段的取值：null / 空 → []；单值 → [值]；块列表或 `[a, b]` 行内列表 → 各项 */
function parseValues(inline: string, items: string[]): string[] {
  if (items.length > 0)
    return items.map(unquote)
  const value = inline.trim()
  if (value === '' || value === 'null' || value === '~')
    return []
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(unquote).filter(item => item !== '')
  }
  return [unquote(value)]
}

/** 一个值写成单值，多个写成块列表；没有值写 null */
function renderField(key: string, values: readonly string[]): string[] {
  if (values.length === 0)
    return [`${key}: ${NULL_SESSION_ID}`]
  if (values.length === 1)
    return [`${key}: ${values[0]}`]
  return [`${key}:`, ...values.map(value => `  - ${value}`)]
}

/** 在 frontmatter 行列表中把 id 追加进 key 字段；返回是否有改动 */
/** 块列表的一项 `- 值`，及其前缀 */
const listItemRe = /^\s*-(?:\s|$)/
const listItemPrefixRe = /^\s*-\s?/

function appendToField(lines: string[], key: string, id: string): boolean {
  const start = lines.findIndex(line => line.startsWith(`${key}:`))
  if (start === -1) {
    lines.push(...renderField(key, [id]))
    return true
  }
  let end = start + 1
  while (end < lines.length && listItemRe.test(lines[end]!)) end++
  const items = lines.slice(start + 1, end).map(line => line.replace(listItemPrefixRe, ''))
  const values = parseValues(lines[start]!.slice(key.length + 1), items)
  if (values.includes(id))
    return false
  lines.splice(start, end - start, ...renderField(key, [...values, id]))
  return true
}

/** 纯函数：把取到的会话 id 追加进 CONTEXT.md 文本的 frontmatter，返回新文本与实际追加的条目 */
export function addSessionIds(context: string, ids: Record<SessionIdVar, string>, keys: Record<SessionIdVar, string>): { text: string, added: Array<{ key: string, id: string }> } {
  const names = Object.keys(keys) as SessionIdVar[]
  const present = names.filter(name => ids[name] !== NULL_SESSION_ID)
  const block = context.match(frontmatterRe)
  if (!block) {
    const lines = names.flatMap(name =>
      renderField(keys[name], ids[name] === NULL_SESSION_ID ? [] : [ids[name]]),
    )
    return {
      text: `---\n${lines.join('\n')}\n---\n\n${context}`,
      added: present.map(name => ({ key: keys[name], id: ids[name] })),
    }
  }
  const lines = block[1]!.split('\n').slice(0, -1)
  const added = present
    .filter(name => appendToField(lines, keys[name], ids[name]))
    .map(name => ({ key: keys[name], id: ids[name] }))
  if (added.length === 0)
    return { text: context, added }
  const rest = context.slice(block[0].length)
  return { text: `---\n${lines.join('\n')}\n---${block[0].endsWith('\n') ? '\n' : ''}${rest}`, added }
}

export interface TakeoverOptions extends Partial<Pick<SessionPaths, 'sessionsDir'>> {
  /** CONTEXT.md 模板路径，默认本目录的 template/CONTEXT.md */
  templatePath?: string
  /** 读会话 id 用的环境变量表，默认 process.env */
  env?: Record<string, string | undefined>
}

/** 接手登记：读环境变量里的会话 id，追加进该 session 的 CONTEXT.md frontmatter */
export function takeoverSession(name: string, options: TakeoverOptions = {}): { file: string, added: Array<{ key: string, id: string }> } {
  const sessionsDir = options.sessionsDir ?? defaultPaths.sessionsDir
  const file = path.join(sessionsDir, normalizeName(name), 'CONTEXT.md')
  if (!fs.existsSync(file)) {
    throw new Error(`找不到 session 主记录: ${file}`)
  }
  const ids = readSessionIds(options.env)
  if (Object.values(ids).every(id => id === NULL_SESSION_ID)) {
    throw new Error('当前 shell 里取不到任何 Agent 会话 id：需在 Claude Code / Codex 会话的 shell 里运行')
  }
  const keys = sessionIdKeys(fs.readFileSync(options.templatePath ?? defaultTemplatePath, 'utf8'))
  const { text, added } = addSessionIds(fs.readFileSync(file, 'utf8'), ids, keys)
  if (added.length > 0)
    fs.writeFileSync(file, text)
  return { file, added }
}

const HELP = `接手登记: 把当前 Agent 会话 id 追加进 sessions/<name>/CONTEXT.md 的 frontmatter

用法：
  bun .agents/skills/use-session/scripts/takeover.ts <session-name>    接受 sessions/<name>/ 路径写法

行为：
  - 会话 id 取自环境变量 $CLAUDE_CODE_SESSION_ID、$CODEX_THREAD_ID(兜底 $CODEX_SESSION_ID)，
    只有在 Claude Code / Codex 会话的 shell 里才有值；一个都取不到则报错
  - id 已在 frontmatter 中则不动；原为 null 写成单值，原有值则改成列表追加
  - 只改 frontmatter 的会话 id 字段，可重复运行；不碰 git`

if (import.meta.main) {
  await runCli(HELP, (args) => {
    const flags = args.filter(arg => arg.startsWith('-'))
    if (flags.length > 0) {
      throw new Error(`未知参数: ${flags.join(' ')}(--help 查看用法)`)
    }
    if (args.length !== 1) {
      throw new Error(`一次只能登记一个 session，收到: ${args.join(' ')}(--help 查看用法)`)
    }
    const { file, added } = takeoverSession(args[0]!)
    console.log(file)
    if (added.length === 0)
      console.log('  会话 id 已在其中，未改动')
    for (const { key, id } of added) console.log(`  + ${key}: ${id}`)
  })
}
