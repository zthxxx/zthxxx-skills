/**
 * session 多选交互 —— archive.ts / resume.ts 无参数运行时的选择器
 *
 * 需求：
 * - 归档 / 恢复常常一次要处理好几个 session，逐个敲名字既慢又容易拼错；
 *   无参数直接运行就列出候选、space 勾选、enter 一次性执行
 * - 只用 Bun 运行时与 Node 内置能力实现，不依赖第三方包：脚本随 skill 复制分发，复制到的项目里不一定有 node_modules
 *
 * 定义 / 行为：
 * - ↑/↓ 移动光标(首尾循环)，space 勾选/取消，enter 确认，Ctrl-C / Esc 取消
 * - 一个都不勾也能确认，返回空数组，由调用方决定怎么提示；取消返回 null
 * - 列表最多显示 max(5, 终端行数 - 6) 项，候选多于一屏时滚动，光标始终在可见范围内；终端尺寸变化时按新行数重排
 * - 每行按终端列宽截断(CJK 宽字符按 Bun.stringWidth 计宽)，保证一行不折行，重绘时上移的行数才准确
 * - 画面渲染指向 stderr，执行结果由调用方打到 stdout —— 重定向 stdout 拿到的仍是纯结果
 * - 确认、取消、异常任何一种结束方式，都恢复终端的 raw mode、光标显示，并暂停 stdin
 *
 * 分层：按键解码 decodeKeys、状态迁移 stepPicker、渲染 renderPicker 都是纯函数，由 zthxxx-skills 仓库的 tests/collab-session/use-collab-session/session.test.ts 做 property-based 覆盖；
 * pickSessions 只负责 TTY 读写，用真 pty 驱动手工验证
 *
 * 用法(仅供 archive.ts / resume.ts 在 TTY 下调用)：
 *   const picked = await pickSessions('选择要归档的 session', [{ value, label, hint }])
 */

export interface SessionChoice {
  /** 确认后回传给调用方的值(session 名 / 归档目录名) */
  value: string
  /** 列表主文案 */
  label: string
  /** 右侧次要信息(时间戳等) */
  hint?: string
}

export type PickerKey = 'up' | 'down' | 'toggle' | 'confirm' | 'cancel'

export interface PickerState {
  readonly choices: readonly SessionChoice[]
  /** 光标所在候选的下标；没有候选时为 0 */
  readonly cursor: number
  /** 可见窗口第一项的下标 */
  readonly top: number
  /** 可见窗口最多几项 */
  readonly pageSize: number
  /** 与 choices 等长，是否已勾选 */
  readonly selected: readonly boolean[]
}

export type PickerStep
  = | { readonly kind: 'pending', readonly state: PickerState }
    | { readonly kind: 'done', readonly values: string[] }
    | { readonly kind: 'cancelled' }

/** 列表最多占几行：撑满终端但给标题、滚动提示、footer 留边 */
export const maxItems = (rows: number | undefined): number => Math.max(5, (rows ?? 24) - 6)

/** 调整窗口起点，使光标落在 [top, top + pageSize) 内，且窗口不越过列表末尾 */
function scrollTo(cursor: number, top: number, pageSize: number, count: number): number {
  const maxTop = Math.max(0, count - pageSize)
  const visibleTop = cursor < top ? cursor : cursor >= top + pageSize ? cursor - pageSize + 1 : top
  return Math.min(Math.max(0, visibleTop), maxTop)
}

export function createPickerState(choices: readonly SessionChoice[], pageSize: number): PickerState {
  return {
    choices,
    cursor: 0,
    top: 0,
    pageSize: Math.max(1, pageSize),
    selected: choices.map(() => false),
  }
}

/** 终端尺寸变化后按新的窗口高度重排，光标与勾选不变 */
export function resizePicker(state: PickerState, pageSize: number): PickerState {
  const size = Math.max(1, pageSize)
  return { ...state, pageSize: size, top: scrollTo(state.cursor, state.top, size, state.choices.length) }
}

/** 状态迁移：一次按键 → 新状态，或确认(带勾选值，按列表顺序)、取消 */
export function stepPicker(state: PickerState, key: PickerKey): PickerStep {
  const count = state.choices.length
  switch (key) {
    case 'cancel':
      return { kind: 'cancelled' }
    case 'confirm':
      return { kind: 'done', values: state.choices.filter((_, i) => state.selected[i]).map(c => c.value) }
    case 'toggle': {
      if (count === 0)
        return { kind: 'pending', state }
      const selected = state.selected.map((on, i) => (i === state.cursor ? !on : on))
      return { kind: 'pending', state: { ...state, selected } }
    }
    case 'up':
    case 'down': {
      if (count === 0)
        return { kind: 'pending', state }
      const cursor = (state.cursor + (key === 'up' ? -1 : 1) + count) % count
      return { kind: 'pending', state: { ...state, cursor, top: scrollTo(cursor, state.top, state.pageSize, count) } }
    }
  }
}

/** CSI 序列的结束字节范围 0x40–0x7e */
const csiFinalByteRe = /[\x40-\x7E]/

/**
 * 把一段 stdin 输入解码成按键序列；不认识的输入忽略
 * - 方向键兼容普通模式 `ESC [ A` 与应用模式 `ESC O A`
 * - 单独的 ESC(其后不是 `[` / `O` 序列)视为取消
 */
export function decodeKeys(chunk: string): PickerKey[] {
  const keys: PickerKey[] = []
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i]!
    if (ch === '\x1B') {
      const next = chunk[i + 1]
      if ((next === '[' || next === 'O') && i + 2 < chunk.length) {
        const code = chunk[i + 2]
        if (code === 'A')
          keys.push('up')
        else if (code === 'B')
          keys.push('down')
        // 跳过整段 CSI 序列(参数字节 0x30–0x3f、中间字节 0x20–0x2f，以 0x40–0x7e 结尾)
        let end = i + 2
        while (end < chunk.length && !csiFinalByteRe.test(chunk[end]!)) end++
        i = end
      }
      else {
        keys.push('cancel')
      }
    }
    else if (ch === '\x03') {
      keys.push('cancel')
    }
    else if (ch === '\r' || ch === '\n') {
      keys.push('confirm')
    }
    else if (ch === ' ') {
      keys.push('toggle')
    }
  }
  return keys
}

const ansi = {
  dim: (s: string) => `\x1B[2m${s}\x1B[22m`,
  cyan: (s: string) => `\x1B[36m${s}\x1B[39m`,
  green: (s: string) => `\x1B[32m${s}\x1B[39m`,
}

const segmenter = new Intl.Segmenter()

/** 按显示宽度截断纯文本，超出时以 … 结尾，结果宽度 ≤ maxWidth */
function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0)
    return ''
  if (Bun.stringWidth(text) <= maxWidth)
    return text
  let out = ''
  let width = 0
  for (const { segment } of segmenter.segment(text)) {
    const w = Bun.stringWidth(segment)
    if (width + w > maxWidth - 1)
      break
    out += segment
    width += w
  }
  return `${out}…`
}

/** 一行里的一段文字与它的样式 */
type Segment = readonly [text: string, style?: (s: string) => string]

/** 把若干段文字拼成一行并按显示宽度截断：截到哪段，哪段以 … 结尾，其后各段丢弃；样式只包在可见文字外，不计宽度 */
function fit(segments: readonly Segment[], maxWidth: number): string {
  let out = ''
  let remaining = maxWidth
  for (const [text, style] of segments) {
    if (remaining <= 0)
      break
    const width = Bun.stringWidth(text)
    const piece = width <= remaining ? text : truncate(text, remaining)
    out += style && piece ? style(piece) : piece
    if (width > remaining)
      break
    remaining -= width
  }
  return out
}

/** 一行可用的最大显示宽度：留出最后一列，避免写满整行时部分终端提前折行 */
const lineWidth = (columns: number): number => Math.max(1, columns - 1)

/** 当前可见窗口 [start, end) */
export function visibleRange(state: PickerState): { start: number, end: number } {
  return {
    start: state.top,
    end: Math.min(state.choices.length, state.top + state.pageSize),
  }
}

/** 渲染选择器画面(不含光标控制)；每行显示宽度 ≤ columns */
export function renderPicker(state: PickerState, message: string, { columns }: { columns: number }): string[] {
  const width = lineWidth(columns)
  const { start, end } = visibleRange(state)
  const lines = [fit([[`◆ ${message}`, ansi.cyan]], width)]
  if (state.choices.length === 0)
    lines.push(fit([['│ (没有候选)', ansi.dim]], width))
  if (start > 0)
    lines.push(fit([[`│ ↑ 上方还有 ${start} 项`, ansi.dim]], width))
  for (let i = start; i < end; i++) {
    const { label, hint } = state.choices[i]!
    const active = i === state.cursor
    const checked = state.selected[i]
    lines.push(
      fit(
        [
          [`│ ${active ? '❯' : ' '} `],
          [checked ? '◼' : '◻', checked ? ansi.green : undefined],
          [' '],
          [label, active ? ansi.cyan : undefined],
          [hint ? `  ${hint}` : '', ansi.dim],
        ],
        width,
      ),
    )
  }
  if (end < state.choices.length)
    lines.push(fit([[`│ ↓ 下方还有 ${state.choices.length - end} 项`, ansi.dim]], width))
  const picked = state.selected.filter(Boolean).length
  lines.push(fit([[`└ 已选 ${picked} 项 · ↑/↓ 移动 · space 勾选 · enter 确认 · esc 取消`, ansi.dim]], width))
  return lines
}

/** 结束后留在屏幕上的摘要：列出选中项的文案 */
function renderSummary(state: PickerState, step: PickerStep, message: string, columns: number): string[] {
  const width = lineWidth(columns)
  const labels = state.choices.filter((_, i) => state.selected[i]).map(c => c.label)
  const status = step.kind === 'cancelled' ? '│ 已取消' : labels.length > 0 ? `│ ${labels.join(', ')}` : '│ 未选择'
  return [fit([[`◇ ${message}`]], width), fit([[status, ansi.dim]], width)]
}

/** 弹出多选；返回选中的 value 列表(按候选顺序)，取消(Ctrl-C / Esc)返回 null */
export async function pickSessions(message: string, choices: readonly SessionChoice[]): Promise<string[] | null> {
  const input = process.stdin
  const output = process.stderr
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('多选列表需要在终端(TTY)里运行；非交互环境请显式传名字')
  }
  const columns = (): number => output.columns ?? 80
  let state = createPickerState(choices, maxItems(output.rows))
  let drawn = 0

  const draw = (lines: string[]): void => {
    const rewind = drawn > 0 ? `\x1B[${drawn}A\r` : ''
    output.write(`${rewind}\x1B[J${lines.join('\n')}\n`)
    drawn = lines.length
  }

  return await new Promise<string[] | null>((resolve, reject) => {
    const cleanup = (): void => {
      input.off('data', onData)
      output.off('resize', onResize)
      input.setRawMode(false)
      input.pause()
      output.write('\x1B[?25h')
    }
    const finish = (step: Exclude<PickerStep, { kind: 'pending' }>): void => {
      draw(renderSummary(state, step, message, columns()))
      cleanup()
      resolve(step.kind === 'done' ? step.values : null)
    }
    const fail = (error: unknown): void => {
      cleanup()
      reject(error)
    }
    function onResize(): void {
      try {
        state = resizePicker(state, maxItems(output.rows))
        draw(renderPicker(state, message, { columns: columns() }))
      }
      catch (error) {
        fail(error)
      }
    }
    function onData(chunk: string | Buffer): void {
      try {
        for (const key of decodeKeys(chunk.toString())) {
          const step = stepPicker(state, key)
          if (step.kind !== 'pending')
            return finish(step)
          state = step.state
        }
        draw(renderPicker(state, message, { columns: columns() }))
      }
      catch (error) {
        fail(error)
      }
    }

    try {
      input.setRawMode(true)
      input.setEncoding('utf8')
      output.write('\x1B[?25l')
      draw(renderPicker(state, message, { columns: columns() }))
      input.on('data', onData)
      output.on('resize', onResize)
      input.resume()
    }
    catch (error) {
      fail(error)
    }
  })
}
