// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
// QualityLayer inside Claude Code. It asks the CLI (`qualitylayer status --json --session <id>`) for
// the task this session works on, and on a slower clock (`status --json --board`) for every other
// QualityLayer task: what needs the person, what agents run, the open pull requests. It draws what
// comes back: a slim band above the prompt (with a second line while another task needs you), a pane
// with the stage track, the build's progress and All tasks, and toasts. It never approves, never
// writes a task file and never blocks a tool call. Besides the reads it starts one background
// `pr read --stale`, which refreshes the pull request records every session shares. It sets no
// status line: the user's own stays theirs.

import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Board, BoardPart, BoardPartKey, BoardRow, Snapshot } from '../types'

// The installer writes the path of the binary it installed in place of the placeholder.
const BIN: string = "{{QUALITYLAYER_BIN}}"
const PANE = 'ql-progress'
/** A decision made in the App happens between turns: follow it this often, not only after a turn. */
const REFRESH_MS = 5000
const STATUS_TIMEOUT_MS = 2000
/** Every other task is read this often, on its own clock, so the band's own read stays quick. */
const BOARD_MS = 15_000
const BOARD_TIMEOUT_MS = 10_000
/** A pull request record older than the server's poll is read again in the background, at most this often. */
const PR_STALE_MS = 120_000
const PR_READ_TIMEOUT_MS = 60_000

const snapshot = atom({ plugin: 'qualitylayer', key: 'snapshot' } as const, null)
const board = atom({ plugin: 'qualitylayer', key: 'board' } as const, null)
const folds = atom({ plugin: 'qualitylayer', key: 'folds' } as const, [])
const error = atom({ plugin: 'qualitylayer', key: 'error' } as const, null)
const theme = atom({ plugin: 'qualitylayer', key: 'theme' } as const, null)
const progressCue = atom({ plugin: 'qualitylayer', key: 'progressCue' } as const, null)
type CueControl = { enabled: boolean; ready: boolean; timer: Timer | null; version: number; refreshing: boolean; lastGoodSession: string | null }

type Turn = 'you' | 'agents' | 'failed' | null
/** One tone: the stripe and bar colour, and the row's tint behind it (none where the theme is unknown). */
type Tone = { ink?: string; tint?: string; track?: string }
type Palette = Record<'you' | 'agents' | 'failed' | 'checked', Tone>

/**
 * The App's colours (DESIGN.md) for Claude Code's light and dark themes: amber for your turn, blue
 * while agents work, red for a failure, violet for what agents checked. An ANSI or unknown theme gets
 * the terminal's own named colours and no tint, so nothing is drawn against a background it cannot see.
 */
const PALETTES: Record<'dark' | 'light' | 'ansi', Palette> = {
  dark: {
    you: { ink: '#f7b23b', tint: '#2a2112', track: '#5c4419' },
    agents: { ink: '#5da3e5', tint: '#132235', track: '#2c4a6b' },
    failed: { ink: '#ff6166', tint: '#2d1416' },
    checked: { ink: '#b28be0' },
  },
  light: {
    you: { ink: '#9d6607', tint: '#fff4dc', track: '#e9cf98' },
    agents: { ink: '#2076c5', tint: '#e8f1fb', track: '#b4cfec' },
    failed: { ink: '#c9292f', tint: '#fdecec' },
    checked: { ink: '#7a3fb8' },
  },
  ansi: {
    you: { ink: 'yellow' },
    agents: { ink: 'blue' },
    failed: { ink: 'red' },
    checked: { ink: 'magenta' },
  },
}

/** Claude Code's theme setting in the palette's terms: `dark`, `light` and their daltonized forms have one; ANSI and the rest do not. */
const paletteOf = (setting: string | null): Palette => {
  if (setting === null || /ansi/.test(setting)) return PALETTES.ansi
  if (setting.startsWith('dark')) return PALETTES.dark
  if (setting.startsWith('light')) return PALETTES.light
  return PALETTES.ansi
}

const toneOf = (palette: Palette, turn: Turn): Tone => (turn === null ? {} : palette[turn])

/** The setting, read each refresh: the person may switch the theme while a task runs. */
async function themeSetting($: any): Promise<string | null> {
  try {
    const row = (await $.config.list()).find((one: any) => one.key === 'theme')
    return typeof row?.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

/** The track groups, in the order the pane draws them; the CLI reports each step's group. */
const GROUP_ORDER = ['Plan', 'Build', 'Check']
const QUALITY: Record<string, string> = {
  security: 'Security review',
}

/** A stage's word on the task's three steps: a shipped task stands on Verify. */
const stepOf = (snap: Snapshot): string => (snap.task.stage === 'shipped' ? 'verify' : snap.task.stage)
const stageLabel = (snap: Snapshot): string => (snap.track ?? []).find(one => one.id === stepOf(snap))?.label ?? snap.task.stage

/** What the open gate asks, in the step line's words. */
const gateWords = (snap: Snapshot): string =>
  snap.gate?.target === 'final' ? 'Waits for your review' : 'Waits for your approval'

/** A pending approval becomes a human action only when the CLI records the person's turn. */
const gateReady = (snap: Snapshot): boolean => snap.gate !== null &&
  (snap.waiting_on === undefined || (snap.waiting_on.kind === 'person' && ['plan_approval', 'final_review'].includes(snap.waiting_on.reason)))

const planReviewWords = (snap: Snapshot): string | null => {
  if (snap.task.stage !== 'plan' || snap.waiting_on?.kind !== 'agent' || snap.waiting_on.reason !== 'review') return null
  return snap.review?.state === 'running' ? 'Reviewing Plan' :
    snap.review?.state === 'done' ? 'Updating Plan' : 'Review paused'
}

/** Completion and remaining work differ in shape as well as colour. */
const barRuns = (done: number, total: number, cells = 10): [string, string] => {
  const full = total === 0 ? 0 : Math.max(0, Math.min(cells, Math.round((done / total) * cells)))
  return ['━'.repeat(full), '·'.repeat(cells - full)]
}

/**
 * The build's place: how many slices are finished, as the App's Implement page counts them ("2 of 10
 * slices"), then the task in work in the report's own words ("task 4 of 7 (T13)"). A slice's number
 * is not shown as progress: slices are not always built in the list's order, and "slice 12 of 12"
 * read as a finished build.
 */
const buildPlace = (snap: Snapshot): string => {
  const slices = snap.build?.slices ?? []
  const words = snap.progress?.words
  if (slices.length === 0) return words?.place ?? 'slice 0 of 0'
  const finished = slices.filter(s => s.total > 0 && s.done >= s.total).length
  const task = words?.place.split(' · ').slice(1).join(' · ') ?? ''
  const count = `${finished} of ${slices.length} slices`
  return task === '' ? count : `${count} · ${task}`
}

/** Every task of the build: how many are done, of how many. */
const buildCount = (snap: Snapshot): { done: number; total: number } => {
  const slices = snap.build?.slices ?? []
  return { done: slices.reduce((sum, s) => sum + s.done, 0), total: slices.reduce((sum, s) => sum + s.total, 0) }
}

/** The surface's own elements: the module has none, so each drawing is handed them. */
type Ui = { Box: any; Text: any }

/** How many cells a bar takes with its count: the runs, a space and `done/total`. */
const barWidth = (done: number, total: number, cells = 10) => cells + 1 + `${done}/${total}`.length

/** A bar drawn in a tone: the done run in its ink, the rest in its track colour (dimmed where it has none), then the count. */
const drawBar = ({ Text }: Ui, tone: Tone, done: number, total: number, cells = 10, tasks = false) => {
  const [full, rest] = barRuns(done, total, cells)
  return (
    <Text>
      <Text color={tone.ink}>{full}</Text>
      <Text color={tone.track ?? tone.ink} dimColor={tone.track === undefined}>
        {rest}
      </Text>
      <Text dimColor>{` ${done}/${total}${tasks ? ' tasks' : ''}`}</Text>
    </Text>
  )
}

/** One terminal line; long prose stays intact in the pane. */
const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
const glyphWidth = (glyph: string): number => {
  if (/\p{Mark}|[\u200d\ufe0e\ufe0f]/u.test(glyph)) return 0
  const code = glyph.codePointAt(0) ?? 0
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || code >= 0x20000) ? 2 : 1
}
const cellsOf = (text: string): number => [...text].reduce((sum, glyph) => sum + glyphWidth(glyph), 0)
const clip = (text: string, cells: number): string => {
  text = oneLine(text)
  if (cellsOf(text) <= cells) return text
  if (cells <= 0) return ''
  let result = ''
  for (const glyph of text) {
    if (cellsOf(result) + glyphWidth(glyph) > cells - 1) break
    result += glyph
  }
  return `${result.trimEnd()}…`
}

/** The band owns its explicit spaces, so the kit can inspect its complete single row. */
const drawBand = ($: any, ui: any, palette: Palette, line: BandLine, snap: Snapshot | null,
  width: number, cue: boolean, isWorking: boolean, failed = false) => {
  const { Box, Text, Button } = ui
  const turn = line.turn ?? (snap?.task.stage === 'plan' && isWorking ? 'agents' : null)
  const tone = toneOf(palette, turn)
  // A plain button with a letter hotkey draws "d: Details", ten cells, in this engine.
  const details = snap !== null || failed
  const control = details ? 'd: Details' : '/ql answer'
  const controlWidth = cellsOf(control)
  const button = <Button key="ql-details" label="Details" plain dimColor hotkey="d" onPress={() => openPane($)} />
  if (failed) return (
    <Box key="ql-band" width={width} flexShrink={0}>
      <Text wrap="truncate-end"><Text dimColor>QL · </Text><Text color={palette.failed.ink}>Status unavailable</Text><Text>{' '.repeat(Math.max(2, width - 23 - controlWidth))}</Text></Text>
      <Box flexShrink={0} width={controlWidth}>{button}</Box>
    </Box>
  )
  const narrow = width <= 55
  const count = snap === null ? { done: 0, total: 0 } : buildCount(snap)
  const bar = snap?.task.stage === 'implement' && turn === 'agents' && Number.isFinite(count.total) && count.total > 0 && Number.isFinite(count.done)
  const barCells = narrow ? 5 : 10
  const barSize = bar ? barWidth(count.done, count.total, barCells) + 6 + 2 : 0
  let step = snap === null ? '' : `○ ${stageLabel(snap)}`
  let message = oneLine(line.text)
  let place = ''
  let extras = line.extras.filter(Boolean).map(oneLine)
  if (bar) {
    const [slice, ...rest] = message.split(' · ')
    place = narrow ? slice.replace(/^(\d+) of (\d+) slices$/, '$1/$2 slices') : slice
    extras = [...rest, ...extras]
    message = ''
  }
  if (snap === null && !failed) {
    step = `○ ${line.text}`
    message = ''
  }
  const separator = narrow && bar ? ' ' : ' · '
  const prefixWidth = 2 + (step ? 1 + cellsOf(step) : 0)
  const messageBudget = Math.max(0, width - prefixWidth - controlWidth - 4)
  message = clip(message, messageBudget)
  let title = snap === null ? '' : oneLine(snap.task.title)
  const leftSize = () => prefixWidth + (title ? 3 + cellsOf(title) : 0) +
    (place ? cellsOf(separator) + cellsOf(place) : 0) + extras.reduce((sum, part) => sum + 3 + cellsOf(part), 0)
  const rightSize = () => controlWidth + (bar ? barSize + 2 : 0) + (message ? cellsOf(message) + 2 : 0)
  if (snap === null && extras.length > 0) {
    extras = [clip(extras.join(', '), Math.max(0, width - prefixWidth - rightSize() - 5))].filter(Boolean)
  }
  while (extras.length && leftSize() + rightSize() + 2 > width) extras.pop()
  if (leftSize() + rightSize() + 2 > width) {
    const room = width - rightSize() - 2 - prefixWidth - (place ? cellsOf(separator) + cellsOf(place) : 0) - 3
    // A few anonymous letters are worse than the slice and the task count remaining legible.
    title = room >= 4 ? clip(title, room) : ''
  }
  // Two cells between the halves, one when the row is full to the last cell.
  const gap = Math.max(1, width - leftSize() - rightSize())
  return (
    <Box key="ql-band" width={width} flexShrink={0} backgroundColor={turn === 'you' ? tone.tint : undefined}>
      <Text wrap="truncate-end">
        <Text dimColor>QL</Text>
        {step !== '' ? <Text> <Text bold color={tone.ink}>{step}</Text></Text> : null}
        {title !== '' ? <Text><Text dimColor> · </Text><Text>{title}</Text></Text> : null}
        {place !== '' ? <Text><Text dimColor>{separator}</Text><Text>{place}</Text></Text> : null}
        {extras.map(part => <Text><Text dimColor> · </Text><Text dimColor>{part}</Text></Text>)}
        <Text>{' '.repeat(gap)}</Text>
        {message !== '' ? <Text><Text color={tone.ink}>{message}</Text><Text>{'  '}</Text></Text> : null}
        {bar ? <Text>{drawBar(ui, tone, count.done, count.total, barCells, true)}<Text color={tone.ink}>{cue ? ' ↑' : '  '}</Text><Text>{'  '}</Text></Text> : null}
      </Text>
      <Box flexShrink={0} width={controlWidth}>
        {details ? button : <Text>{control}</Text>}
      </Box>
    </Box>
  )
}

/**
 * A row in the App's step-line form: a stripe in the tone's ink, the words, and on the right what
 * goes with them (a bar), over the tone's tint across the whole width. A row without a tone is dim.
 */
const drawRow = ({ Box, Text }: Ui, tone: Tone, text: string, right: unknown = null, width?: number) => (
  <Box width={width} backgroundColor={tone.tint} justifyContent="space-between">
    <Box flexShrink={1}>
      <Text color={tone.ink} dimColor={tone.ink === undefined}>
        {'▎ '}
      </Text>
      <Text wrap="truncate-end" dimColor={tone.ink === undefined}>
        {text}
      </Text>
    </Box>
    {right !== null ? (
      <Box flexShrink={0} paddingLeft={2} paddingRight={1}>
        {right}
      </Box>
    ) : null}
  </Box>
)

/** How many items wait for the person, once the status report says (the task summary's `openItems`, or the report's own `open_items`). */
const openItemsOf = (snap: Snapshot): number | null => {
  const count = snap.open_items ?? snap.task.openItems
  return typeof count === 'number' ? count : null
}

/**
 * What waits for the person, in the step line's words: the count, else the approval or review the step
 * holds, else the App's own words. Whether anything does is the CLI's answer (`needs_you`, Home's own),
 * never worked out here.
 */
const needsYou = (snap: Snapshot): string | null => {
  if (snap.needs_you == null) return null
  const items = openItemsOf(snap)
  if (items !== null && items > 0) return `${items} ${items === 1 ? 'item needs' : 'items need'} you`
  if (gateReady(snap)) return gateWords(snap)
  return snap.needs_you.words
}

/** What a gate that opened is called in a toast: the step's words, never a file name. */
const waitingWords = (snap: Snapshot): string =>
  snap.gate?.target === 'final'
    ? 'the change waits for your review'
    : /^\d{2}-plan\.md$/.test(snap.gate?.target ?? '')
      ? 'the Plan waits for your approval'
      : 'a review waits for you'

/** The band's line: what it always says, what may give way in a narrow band, and whose turn it is. */
type BandLine = { text: string; extras: string[]; turn: Turn }

/** From Implement until the final review the build asks nothing: a question shown there is a stale one. */
const building = (snap: Snapshot): boolean => snap.task.stage === 'implement' || snap.task.stage === 'verify'

/** The request or build's place, separate from the task and its current step. */
const bandLine = (snap: Snapshot): BandLine => {
  const line = (parts: string[], turn: Turn, extras: string[] = []): BandLine => ({
    text: parts.filter(part => part !== '').join(' · '),
    extras,
    turn,
  })
  const yours = snap.needs_you != null
  // The agent asks in its own window: the band names the question it asks next, never during the build.
  if (yours && typeof snap.question === 'string' && snap.question !== '' && !building(snap)) {
    return line([`the agent asks next: ${snap.question}`], 'you')
  }
  // What only the person can give the build: said at once, and plainly once the build waits for it.
  // While the agents build and check it is kept for the person's review in Verify, as Home keeps it.
  const needs = snap.needs ?? []
  const waitsFor = needs.find(need => need.waiting)
  const need = needs[0]
  if (yours && waitsFor !== undefined) return line([`the build waits for you: ${waitsFor.what}`], 'you')
  if (yours && need !== undefined) return line([`needs you: ${need.what} (${need.for})`, 'the build goes on'], 'you')
  if (need !== undefined) return line([`kept for your review: ${need.what} (${need.for})`, 'the build goes on'], null)
  const waiting = needsYou(snap)
  if (waiting !== null) return line([waiting], 'you')
  const reviewing = planReviewWords(snap)
  if (reviewing !== null) return line([reviewing], 'agents')
  // Needs you comes only from an open question, gate or need. A refusal is the agent's work,
  // however often it repeats: the band says so and nothing here is the person's to act on.
  const refusal = snap.refusal
  // The number is the latest refusal's own errors, never how often the same refusal came again.
  if (refusal != null) {
    const errors = refusal.errors ?? 1
    return line([`working: fixing ${errors} validation ${errors === 1 ? 'error' : 'errors'}`], 'agents')
  }
  const hasSlices = (snap.build?.slices.length ?? 0) > 0
  if (snap.task.stage === 'implement') {
    if (!hasSlices && snap.progress == null) return line(['Agents are building'], 'agents')
    return line([buildPlace(snap)], 'agents')
  }
  if (snap.task.stage === 'verify') return line(['Agents are checking'], 'agents')
  return line([], null)
}

/** Ask the CLI and draw the answer; whatever goes wrong draws "qualitylayer status failed", never a rejection. */
async function clearCue($: any, cues: CueControl): Promise<void> {
  cues.timer?.cancel()
  cues.timer = null
  await update($, progressCue, () => null)
}

async function refresh($: any, cues: CueControl): Promise<void> {
  if (cues.refreshing) return
  cues.refreshing = true
  try {
    await refreshFromCli($, cues)
  } catch (failure) {
    cues.lastGoodSession = null
    try {
      await clearCue($, cues)
      await update($, snapshot, () => null)
      await update($, error, () => `qualitylayer status failed (${String((failure as Error)?.message ?? failure)})`)
    } catch {
      // nothing left to draw it with
    }
  } finally {
    cues.refreshing = false
  }
}

/** This session's id, read each time: it changes after /clear, /resume and /branch. Empty when Claude Code cannot say. */
async function sessionId($: any): Promise<string> {
  try {
    return String((await $.session.id()) ?? '')
  } catch {
    return ''
  }
}

/** Reject a payload its band or pane cannot read. */
const validReport = (report: any): boolean => {
  if (report === null || typeof report !== 'object' || Array.isArray(report) || report.ok === false) return false
  if (report.task === null) return true
  return typeof report.task?.id === 'string' && typeof report.task?.title === 'string' && typeof report.task?.stage === 'string' &&
    Array.isArray(report.track) && Array.isArray(report.quality) && Array.isArray(report.helpers) &&
    (report.gate === null || typeof report.gate?.target === 'string') &&
    (report.build === null || Array.isArray(report.build?.slices))
}

async function refreshFromCli($: any, cues: CueControl): Promise<void> {
  // The band shows only the task this session works on, never another session's in the same repository.
  const id = await sessionId($)
  if (id === '') throw new Error('session id unavailable')
  let deadline: Timer | null = null
  const timedOut = Symbol()
  const timeout = new Promise<typeof timedOut>(resolve => {
    deadline = $.clock.after(STATUS_TIMEOUT_MS, () => resolve(timedOut))
  })
  let run: any
  try {
    run = await Promise.race([$.process.run([BIN, 'status', '--json', '--session', id]), timeout])
  } finally {
    deadline?.cancel()
  }
  if (run === timedOut) {
    if (cues.lastGoodSession !== id || await sessionId($) !== id) throw new Error('status timed out')
    cues.lastGoodSession = null
    return
  }
  if (run.exitCode !== 0) {
    throw new Error(`exit ${run.exitCode}`)
  }
  let report: (Snapshot & { task: Snapshot['task'] | null }) | null
  try {
    report = JSON.parse(run.stdout)
  } catch {
    throw new Error('answered something else than JSON')
  }
  if (!validReport(report)) {
    throw new Error('answered an invalid report')
  }
  const next: Snapshot | null = report !== null && report.task !== null ? (report as Snapshot) : null
  const before = await read($, snapshot)
  const wasFailed = (await read($, error)) !== null
  const priorCount = before === null ? null : buildCount(before)
  const nextCount = next === null ? null : buildCount(next)
  const sameBuild = before !== null && next !== null && before.task.id === next.task.id &&
    before.task.stage === 'implement' && next.task.stage === 'implement' &&
    priorCount?.total === nextCount?.total && (nextCount?.total ?? 0) > 0
  if (!cues.enabled || !cues.ready || wasFailed || !sameBuild || (nextCount?.done ?? 0) < (priorCount?.done ?? 0)) await clearCue($, cues)
  if (cues.enabled && cues.ready && !wasFailed && sameBuild && nextCount!.done > priorCount!.done) {
    cues.timer?.cancel()
    const version = ++cues.version
    await update($, progressCue, () => ({ task: next!.task.id, version }))
    cues.timer = $.clock.after(900, () => {
      void update($, progressCue, current => current?.version === version ? null : current)
    })
  }
  const setting = await themeSetting($)
  if (setting !== (await read($, theme))) await update($, theme, () => setting)
  await update($, snapshot, () => next === null ? null : { ...next, boundSession: id })
  await update($, error, () => null)
  cues.ready = true
  cues.lastGoodSession = id
  if (next === null) return

  if (gateReady(next) && (before === null || !gateReady(before) || next.gate?.target !== before.gate?.target)) {
    $.ui.toast(`QualityLayer: ${waitingWords(next)} in the App`)
  }
  const fixing = next.quality.find(row => row.state === 'fixing')
  if (fixing !== undefined && fixing.open !== before?.quality.find(row => row.step === fixing.step)?.open) {
    $.ui.toast(`QualityLayer: ${(QUALITY[fixing.step] ?? fixing.step).toLowerCase()} found ${fixing.open ?? 0} to fix`)
  }
}

/** The board's reads: one at a time, and the last background pull request read. */
type BoardControl = { reading: boolean; prReading: boolean; prReadAt: number }

/** A run of the CLI that gives up after `ms`; its late answer is dropped. */
async function runFor($: any, argv: string[], ms: number): Promise<any> {
  let deadline: Timer | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    deadline = $.clock.after(ms, () => reject(new Error('timed out')))
  })
  try {
    return await Promise.race([$.process.run(argv), timeout])
  } finally {
    deadline?.cancel()
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? oneLine(value) : '')
const stamp = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** One row as the board reports it, or null when it cannot be drawn. */
function rowFrom(raw: any): BoardRow | null {
  if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  const pr = raw.pr !== null && typeof raw.pr === 'object' && typeof raw.pr.url === 'string'
    ? { number: stamp(raw.pr.number), url: raw.pr.url, readAt: stamp(raw.pr.readAt) ?? 0 }
    : null
  const progress = raw.progress !== null && typeof raw.progress === 'object' &&
    stamp(raw.progress.done) !== null && (stamp(raw.progress.total) ?? 0) > 0
    ? { done: raw.progress.done, total: raw.progress.total }
    : null
  return {
    id: raw.id,
    title: text(raw.title),
    project: text(raw.project),
    words: text(raw.words),
    since: stamp(raw.since),
    link: typeof raw.link === 'string' ? raw.link : null,
    command: typeof raw.command === 'string' && raw.command !== '' ? raw.command : null,
    agent: typeof raw.agent === 'string' ? raw.agent : null,
    pr,
    progress,
  }
}

/** The board from `status --json --board`, or null when the answer is not one. */
export function boardFrom(raw: any): Board | null {
  const value = raw?.board
  if (raw?.ok === false || value === null || typeof value !== 'object') return null
  const part = (one: any): BoardPart | null => {
    if (one === null || typeof one !== 'object' || !Array.isArray(one.rows) || stamp(one.count) === null) return null
    const rows = one.rows.map(rowFrom).filter((row: BoardRow | null): row is BoardRow => row !== null)
    return { rows, count: Math.max(one.count, rows.length) }
  }
  const [needs, running, prs] = [part(value.needs), part(value.running), part(value.prs)]
  if (needs === null || running === null || prs === null) return null
  return { needs, running, prs, home: typeof value.home === 'string' ? value.home : null }
}

const PARTS: BoardPartKey[] = ['needs', 'running', 'prs']
const boardRows = (now: Board): BoardRow[] => PARTS.flatMap(key => now[key].rows)

/**
 * Read every other task. It runs on its own clock and nobody waits for it: a slow or failed read
 * leaves the last board as it was. A pull request read longer ago than the server's poll starts one
 * background `pr read --stale`; its answer lands in the shared records, which the next board reads.
 */
async function refreshBoard($: any, control: BoardControl): Promise<void> {
  if (control.reading) return
  control.reading = true
  try {
    const own = (await read($, snapshot))?.task.id
    const argv = [BIN, 'status', '--json', '--board', ...(own ? ['--except', own] : [])]
    const run = await runFor($, argv, BOARD_TIMEOUT_MS)
    if (run.exitCode !== 0) return
    const next = boardFrom(JSON.parse(run.stdout))
    if (next === null) return
    await update($, board, () => next)
    const now = await $.clock.now()
    const stale = boardRows(next).some(row => row.pr !== null && now - row.pr.readAt >= PR_STALE_MS)
    if (stale && !control.prReading && now - control.prReadAt >= PR_STALE_MS) {
      control.prReading = true
      control.prReadAt = now
      void runFor($, [BIN, 'pr', 'read', '--stale'], PR_READ_TIMEOUT_MS)
        .catch(() => undefined)
        .finally(() => {
          control.prReading = false
        })
    }
  } catch {
    // The board keeps what it last showed; the next read tries again.
  } finally {
    control.reading = false
  }
}

/** How long ago, in a few cells: "now", "12m", "3h", "2d". */
const age = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

async function openPane($: any): Promise<void> {
  await $.ui.open({ id: PANE, title: 'QualityLayer' })
}

/** What every row of All tasks draws with. `$` is passed beside it: the engine keeps it out of objects. */
type Kit = { ui: any; palette: Palette; clock: number; surface: unknown; columns: number }

const ago = (kit: Kit, at: number | null): string => (at === null ? '' : age(kit.clock - at))

/** A title that opens its page while the App runs, else bold text. */
const titled = ({ ui }: Kit, url: string | null, label: string) =>
  url !== null && ui.Link !== undefined ? <ui.Link href={url} label={label} /> : <ui.Text bold>{label}</ui.Text>

/** A row's two lines: the mark and title with what goes on the right, then the project and words. */
const rowLines = (kit: Kit, key: string, top: [unknown, unknown, unknown], row: BoardRow, words: unknown, end: unknown = null) => {
  const { Box, Text } = kit.ui
  return (
    <Box key={key} flexDirection="column">
      <Box width={kit.columns} justifyContent="space-between">
        <Box flexShrink={1}>{top[0]}{top[1]}</Box>
        {top[2]}
      </Box>
      <Box width={kit.columns} justifyContent="space-between">
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text>{'  '}</Text>
            {row.project !== '' ? <Text dimColor>{`${row.project} · `}</Text> : null}
            {words}
          </Text>
        </Box>
        {end}
      </Box>
    </Box>
  )
}

const dimRight = ({ ui }: Kit, words: string) => <ui.Box flexShrink={0} paddingLeft={2}><ui.Text dimColor>{words}</ui.Text></ui.Box>

async function copyCommand($: any, { surface }: Kit, command: string): Promise<void> {
  try {
    const copied = await $.ui.copy({ text: command, surface })
    $.ui.toast(copied?.isCopied === false ? `Could not copy ${command}` : `Copied ${command}`)
  } catch {
    $.ui.toast(`Could not copy ${command}`)
  }
}

const needRow = ($: any, kit: Kit, row: BoardRow) => {
  const { Box, Text, Button } = kit.ui
  const ink = kit.palette.you.ink
  const words = (
    <Text>
      {row.pr?.number != null ? <Text dimColor>{`#${row.pr.number} · `}</Text> : null}
      <Text color={ink}>{row.words}</Text>
    </Text>
  )
  const resume = row.command === null ? null : (
    <Box flexShrink={0} paddingLeft={2}>
      <Button key={`ql-copy-${row.id}`} label="⧉ resume" plain dimColor onPress={() => copyCommand($, kit, row.command as string)} />
    </Box>
  )
  return rowLines(kit, `need-${row.id}`, [<Text bold color={ink}>! </Text>, titled(kit, row.link, row.title), dimRight(kit, ago(kit, row.since))], row, words, resume)
}

const runRow = (kit: Kit, row: BoardRow) => {
  const { Box, Text } = kit.ui
  const ink = kit.palette.agents.ink
  const end = (
    <Box flexShrink={0} paddingLeft={2}>
      {row.progress !== null ? <Text>{drawBar(kit.ui, kit.palette.agents, row.progress.done, row.progress.total, 10)}{'  '}</Text> : null}
      <Text dimColor>{ago(kit, row.since)}</Text>
    </Box>
  )
  const words = (
    <Text>
      {row.agent !== null ? <Text><Text bold>{row.agent}</Text><Text dimColor> · </Text></Text> : null}
      <Text color={row.pr !== null ? ink : undefined} dimColor={row.pr === null}>{row.words}</Text>
    </Text>
  )
  return rowLines(kit, `run-${row.id}`, [<Text color={ink}>◐ </Text>, titled(kit, row.link, row.title), end], row, words)
}

const prRow = (kit: Kit, row: BoardRow) => {
  const { Text } = kit.ui
  const pr = row.pr
  const title = (
    <Text>
      {pr?.number != null ? titled(kit, pr.url, `#${pr.number}`) : null}
      <Text>{` ${row.title}`}</Text>
    </Text>
  )
  const when = pr !== null && pr.readAt > 0 ? ago(kit, pr.readAt) : ''
  const read = when === '' ? '' : when === 'now' ? 'read just now' : `read ${when} ago`
  return rowLines(kit, `pr-${row.id}`, [<Text>⑂ </Text>, title, dimRight(kit, read)], row, <Text dimColor>{row.words}</Text>)
}

const PARTS_DRAWN: { key: BoardPartKey; title: string; ink: (palette: Palette) => string | undefined }[] = [
  { key: 'needs', title: 'Needs you', ink: palette => palette.you.ink },
  { key: 'running', title: 'Running', ink: palette => palette.agents.ink },
  { key: 'prs', title: 'Pull requests', ink: () => undefined },
]

/** One part: its heading (which folds it), its rows and how many more there are. */
const drawPart = ($: any, kit: Kit, now: Board, part: (typeof PARTS_DRAWN)[number], isFolded: boolean) => {
  const { Box, Text, Button } = kit.ui
  const { rows, count } = now[part.key]
  const toggle = () => update($, folds, list => (list.includes(part.key) ? list.filter(k => k !== part.key) : [...list, part.key]))
  return (
    <Box key={`ql-part-${part.key}`} flexDirection="column" marginTop={1}>
      <Button key={`ql-fold-${part.key}`} label={`${isFolded ? '▸' : '▾'} ${part.title} · ${count}`} plain onPress={toggle} />
      {isFolded ? null : rows.map(row => (part.key === 'needs' ? needRow($, kit, row) : part.key === 'running' ? runRow(kit, row) : prRow(kit, row)))}
      {!isFolded && count > rows.length ? <Text dimColor>{`  +${count - rows.length} more`}</Text> : null}
    </Box>
  )
}

/** The pane's All tasks: Needs you, Running and Pull requests, three rows each, every heading folds. */
const drawAllTasks = ($: any, kit: Kit, now: Board, folded: BoardPartKey[]) => {
  const { Box, Text, Link } = kit.ui
  const shown = PARTS_DRAWN.filter(part => now[part.key].count > 0)
  return (
    <Box key="ql-all-tasks" flexDirection="column" marginTop={1}>
      <Box width={kit.columns} justifyContent="space-between">
        <Text bold>All tasks</Text>
        {now.home !== null && Link !== undefined ? <Link href={now.home} label="Home ↗" /> : null}
      </Box>
      {shown.length === 0 ? <Text dimColor>Nothing needs you</Text> : null}
      {shown.map(part => drawPart($, kit, now, part, folded.includes(part.key)))}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const cues: CueControl = { enabled: options.progressCue !== false, ready: false, timer: null, version: 0, refreshing: false, lastGoodSession: null }
  const boards: BoardControl = { reading: false, prReading: false, prReadAt: 0 }
  // One timer each for the module's life: `session.start` fires again after /clear and on a resume.
  let timer = false
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'task-pane', description: 'Show the QualityLayer task beside the transcript' })
    await refresh($, cues)
    // Nobody waits for the board: the session starts with its own task's band at once.
    void refreshBoard($, boards)
    if (!timer) {
      timer = true
      $.clock.every(REFRESH_MS, () => {
        void refresh($, cues)
      })
      $.clock.every(BOARD_MS, () => {
        void refreshBoard($, boards)
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($, cues)
    return result
  })

  on('command.run', { command: 'task-pane' }, async $ => {
    await refresh($, cues)
    await openPane($)
    return { text: 'QualityLayer pane opened.' }
  })

  // The prompt belongs to this native session. Other tasks are available in /task-pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await read($, snapshot)
    const failed = await read($, error)
    const cue = await read($, progressCue)
    const ui = $.ui.resolve(e) as any
    const palette = paletteOf(await read($, theme))
    const width = typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80
    // The band is shared: other mods (a router, a usage meter) draw theirs beneath, so QualityLayer's
    // line goes on top of whatever they draw, never in its place.
    const withBelow = async (mine: unknown) => {
      const below = await next(e)
      return below === null || below === undefined ? mine : (
        <ui.Box flexDirection="column">
          {mine}
          {below}
        </ui.Box>
      )
    }
    if (failed !== null) return withBelow(drawBand($, ui, palette, { text: 'Status unavailable', extras: [], turn: 'failed' }, null, width, false, false, true))
    if (now === null || (now as Snapshot & { boundSession?: string }).boundSession !== await sessionId($)) return next(e)
    return withBelow(drawBand($, ui, palette, bandLine(now), now, width, cue?.task === now.task.id, e.props.isWorking))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as any
    const { Box, Text, Markdown } = ui
    const now = await read($, snapshot)
    const failed = await read($, error)
    const palette = paletteOf(await read($, theme))
    const others = await read($, board)
    const kit: Kit = {
      ui, palette, clock: await $.clock.now(), surface: e.surface,
      columns: typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80,
    }
    const allTasks = others === null ? null : drawAllTasks($, kit, others, await read($, folds))
    if (failed !== null) return allTasks === null ? drawRow(ui, palette.failed, failed) : (
      <Box flexDirection="column">{drawRow(ui, palette.failed, failed)}{allTasks}</Box>
    )
    if (now === null) return (
      <Box flexDirection="column">
        <Text dimColor>No open QualityLayer task.</Text>
        {allTasks}
      </Box>
    )
    const track = now.track ?? []
    const turn = bandLine(now).turn
    const tone = toneOf(palette, turn)
    const mark = (state: string) => (state === 'done' ? '✓' : state === 'now' ? '●' : '○')
    const slices = now.build?.slices ?? []
    // The slice the build is on: the first one not done.
    const buildingSlice = slices.find(s => s.done < s.total)?.n
    // A slice's row is its mark and number, its title and the bar: the title gets what the pane has left.
    const columns = typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80
    const widest = Math.max(0, ...slices.map(s => barWidth(s.done, s.total)))
    const longest = Math.max(0, ...slices.map(s => s.title.length))
    const titleWidth = Math.max(8, Math.min(32, longest, columns - 6 - widest))
    const sliceTitle = (title: string) =>
      (title.length > titleWidth ? `${title.slice(0, titleWidth - 1).trimEnd()}…` : title).padEnd(titleWidth)
    const quality = now.quality.filter(row => row.state !== 'off')
    const heading = (text: string, color?: string) => (
      <Box marginTop={1}>
        <Text bold color={color}>
          {text}
        </Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Text bold>{now.task.title}</Text>
        <Text dimColor>
          {now.task.kind} · {stageLabel(now)}
        </Text>
        {bandLine(now).text !== '' && bandLine(now).turn !== 'agents' && !(now.question && !building(now)) ? (
          <Box marginTop={1}><Text color={tone.ink}>{bandLine(now).text}</Text></Box>
        ) : null}
        {typeof now.question === 'string' && now.question !== '' && !building(now) ? (
          <Box marginTop={1}><Text>{now.question}</Text></Box>
        ) : null}
        {now.gate !== null && (gateReady(now) || planReviewWords(now) !== null) ? (
          <Box marginTop={1}>{drawRow(ui, gateReady(now) ? palette.you : palette.agents, `${planReviewWords(now) ?? gateWords(now)} · ${now.gate.minutes} min`, null, columns)}</Box>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {GROUP_ORDER.filter(group => track.some(one => one.group === group)).map(group => (
            <Box>
              <Text dimColor>{group.padEnd(7)}</Text>
              {track
                .filter(one => one.group === group)
                .map(one => (
                  <Text color={one.state === 'now' ? tone.ink : undefined} bold={one.state === 'now'} dimColor={one.state === 'todo'}>
                    {mark(one.state)} {one.label}
                    {'   '}
                  </Text>
                ))}
            </Box>
          ))}
        </Box>
        {slices.length > 0 ? heading('Slices') : null}
        {now.progress?.words !== undefined && now.task.stage === 'implement' ? (
          <Text dimColor>{buildPlace(now)}</Text>
        ) : null}
        {slices.map(s => {
          const done = s.done === s.total && s.total > 0
          const current = s.n === buildingSlice
          return (
            <Box>
              <Text color={current ? palette.agents.ink : undefined} dimColor={!current && !done}>
                {done ? '✓' : current ? '●' : '○'} {String(s.n).padStart(2)} {sliceTitle(s.title)}{' '}
              </Text>
              {drawBar(ui, current ? palette.agents : {}, s.done, s.total)}
            </Box>
          )
        })}
        {now.task.stage === 'verify' && quality.length > 0 ? heading('Checked by agents', palette.checked.ink) : null}
        {now.task.stage === 'verify'
          ? quality.map(row => (
              <Text dimColor={row.state === 'waiting'} color={row.state === 'fixing' ? palette.failed.ink : row.state === 'running' ? palette.agents.ink : undefined}>
                <Text color={row.state === 'done' ? palette.checked.ink : undefined}>
                  {row.state === 'done' ? '✓' : row.state === 'fixing' ? '!' : row.state === 'running' ? '●' : '┄'}
                </Text>{' '}
                {QUALITY[row.step] ?? row.step}
                {row.state === 'fixing' ? ` ${row.open ?? 0} to fix` : ''}
              </Text>
            ))
          : null}
        {now.review !== null ? heading('Second opinion') : null}
        {now.review !== null ? (
          <Text dimColor>
            {now.review.name} · {now.review.model} ·{' '}
            {now.review.state === 'running' ? `reviewing: ${now.review.line ?? ''}` : `${now.review.state}, ${now.review.findings ?? 0} findings`}
          </Text>
        ) : null}
        {now.helpers.length > 0 ? heading('Agents working') : null}
        {now.helpers.map(helper => (
          <Text>
            <Text color={palette.agents.ink}>{helper.role === 'judge' ? 'final check' : (helper.role ?? 'agent')}</Text>
            <Text dimColor>
              {' '}
              · {helper.line} · {helper.minutes} min ago
            </Text>
          </Text>
        ))}
        {now.gate?.cockpit != null ? (
          <Box marginTop={1}>
            <Markdown text={`[Open the task in the App](${now.gate.cockpit})`} />
          </Box>
        ) : null}
        {allTasks}
      </Box>
    )
  })
}
