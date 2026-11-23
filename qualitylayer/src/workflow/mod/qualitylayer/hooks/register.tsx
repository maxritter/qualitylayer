// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
// QualityLayer inside Claude Code. It asks the CLI (`qualitylayer status --json --session <id>`) for
// the task this session works on, and on a slower clock (`status --json --board`) for every other
// QualityLayer task: what needs the person, what agents run, the open pull requests. It draws what
// comes back: a slim band above the prompt, a pane with the stage track, the build's progress and
// All tasks, and toasts. It never approves, never writes a task file and never blocks a tool call.
// Besides the reads it starts one background `pr read --stale`, which refreshes the pull request
// records every session shares. It sets no status line: the user's own stays theirs.

import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'
import type { BoardPartKey, Snapshot } from '../types'
import { BOARD_TIMEOUT_MS, PANE, PR_READ_TIMEOUT_MS, PR_STALE_MS, STATUS_TIMEOUT_MS } from './atoms'
import { drawBand } from './band'
import { bandLine } from './band-line'
import { boardFrom, hasStalePr, type BoardControl } from './board-model'
import { paletteOf } from './palette'
import { drawPaneContent } from './pane'
import { parseStatusReport, progressCueAction, statusToastMessages, type CueControl } from './status'

export { boardFrom }

const snapshot = atom({ plugin: 'qualitylayer', key: 'snapshot' } as const, null)
const board = atom({ plugin: 'qualitylayer', key: 'board' } as const, null)
const folds = atom({ plugin: 'qualitylayer', key: 'folds' } as const, [])
const error = atom({ plugin: 'qualitylayer', key: 'error' } as const, null)
const theme = atom({ plugin: 'qualitylayer', key: 'theme' } as const, null)
const progressCue = atom({ plugin: 'qualitylayer', key: 'progressCue' } as const, null)

// The installer writes the path of the binary it installed in place of the placeholder.
const BIN: string = "{{QUALITYLAYER_BIN}}"
/** A decision made in the App happens between turns: follow it this often, not only after a turn. */
const REFRESH_MS = 5000
/** Every other task is read this often, on its own clock, so the band's own read stays quick. */
const BOARD_MS = 15_000

async function openPane($: any): Promise<void> {
  await $.ui.open({ id: PANE, title: 'QualityLayer' })
}

async function sessionId($: any): Promise<string> {
  try {
    return String((await $.session.id()) ?? '')
  } catch {
    return ''
  }
}

async function themeSetting($: any): Promise<string | null> {
  try {
    const row = (await $.config.list()).find((one: any) => one.key === 'theme')
    return typeof row?.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

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

async function clearCue($: any, cues: CueControl): Promise<void> {
  cues.timer?.cancel()
  cues.timer = null
  await update($, progressCue, () => null)
}

async function runStatusCommand($: any, id: string, cues: CueControl): Promise<any | null> {
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
    if (cues.lastGoodSession !== id || (await sessionId($)) !== id) throw new Error('status timed out')
    cues.lastGoodSession = null
    return null
  }
  if (run.exitCode !== 0) throw new Error(`exit ${run.exitCode}`)
  return run
}

async function applyProgressCue(
  $: any,
  cues: CueControl,
  state: { before: Snapshot | null; next: Snapshot | null; wasFailed: boolean },
): Promise<void> {
  const action = progressCueAction(cues, state)
  if (action === 'clear') {
    await clearCue($, cues)
    return
  }
  if (action === 'keep' || state.next === null) return
  cues.timer?.cancel()
  const version = ++cues.version
  await update($, progressCue, () => ({ task: state.next!.task.id, version }))
  cues.timer = $.clock.after(900, () => {
    void update($, progressCue, current => (current?.version === version ? null : current))
  })
}

async function refreshFromCli($: any, cues: CueControl): Promise<void> {
  const id = await sessionId($)
  if (id === '') throw new Error('session id unavailable')
  const run = await runStatusCommand($, id, cues)
  if (run === null) return
  const next = parseStatusReport(run.stdout)
  const before = await read($, snapshot)
  const wasFailed = (await read($, error)) !== null
  await applyProgressCue($, cues, { before, next, wasFailed })
  const setting = await themeSetting($)
  if (setting !== (await read($, theme))) await update($, theme, () => setting)
  await update($, snapshot, () => (next === null ? null : { ...next, boundSession: id }))
  await update($, error, () => null)
  cues.ready = true
  cues.lastGoodSession = id
  if (next !== null) for (const msg of statusToastMessages(before, next)) $.ui.toast(msg)
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
    if (hasStalePr(next, now) && !control.prReading && now - control.prReadAt >= PR_STALE_MS) {
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

async function copyCommand($: any, surface: unknown, command: string): Promise<void> {
  try {
    const copied = await $.ui.copy({ text: command, surface })
    $.ui.toast(copied?.isCopied === false ? `Could not copy ${command}` : `Copied ${command}`)
  } catch {
    $.ui.toast(`Could not copy ${command}`)
  }
}

async function toggleFold($: any, key: BoardPartKey): Promise<void> {
  await update($, folds, (list: BoardPartKey[]) =>
    list.includes(key) ? list.filter(k => k !== key) : [...list, key],
  )
}

async function renderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)
  const now = await read($, snapshot)
  const failed = await read($, error)
  const cue = await read($, progressCue)
  const ui = $.ui.resolve(e) as any
  const palette = paletteOf(await read($, theme))
  const width = typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80
  const withBelow = async (mine: unknown) => {
    const below = await next(e)
    return below === null || below === undefined ? mine : <ui.Box flexDirection="column">{mine}{below}</ui.Box>
  }
  if (failed !== null) {
    return withBelow(drawBand(() => openPane($), { ui, palette, line: { text: 'Status unavailable', extras: [], turn: 'failed' }, snap: null, width, cue: false, isWorking: false, failed: true }))
  }
  if (now === null || (now as Snapshot & { boundSession?: string }).boundSession !== (await sessionId($))) return next(e)
  return withBelow(drawBand(() => openPane($), { ui, palette, line: bandLine(now), snap: now, width, cue: cue?.task === now.task.id, isWorking: e.props.isWorking }))
}

async function renderPane($: any, e: any) {
  const ui = $.ui.resolve(e) as any
  const kit = {
    ui,
    palette: paletteOf(await read($, theme)),
    clock: await $.clock.now(),
    surface: e.surface,
    columns: typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80,
  }
  const state = {
    now: await read($, snapshot),
    failed: await read($, error),
    others: await read($, board),
    folded: await read($, folds),
  }
  const actions = {
    onToggleFold: (key: BoardPartKey) => toggleFold($, key),
    onCopy: (command: string) => copyCommand($, e.surface, command),
  }
  return drawPaneContent(kit, state, actions)
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
  on('ui.render', { component: 'AbovePrompt' }, renderAbovePrompt)

  on('ui.render', { component: 'Pane', requestId: PANE }, renderPane)
}
