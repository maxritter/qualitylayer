// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
// QualityLayer inside Claude Code. It asks the CLI (`qualitylayer status --json --session <id>`) for
// the task this session works on, and on a slower clock (`status --json --board`) for every other
// QualityLayer task: what needs the person, what agents run, the open pull requests. It draws what
// comes back: a slim band above the prompt, a pane with the stage track, the build's progress and
// All tasks, and toasts. It never approves, never writes a task file and never blocks a tool call.
// Besides the reads it starts one background `pr read --stale`, which refreshes the pull request
// records every session shares. It sets no status line: the user's own stays theirs.

import type { Register } from 'claude-code'
import { openPane, PANE } from './atoms'
import { renderAbovePrompt } from './band'
import { boardFrom, refreshBoard, type BoardControl } from './board-model'
import { renderPane } from './pane'
import { refresh, type CueControl } from './status'

export { boardFrom }

// The installer writes the path of the binary it installed in place of the placeholder.
const BIN: string = "{{QUALITYLAYER_BIN}}"
/** A decision made in the App happens between turns: follow it this often, not only after a turn. */
const REFRESH_MS = 5000
/** Every other task is read this often, on its own clock, so the band's own read stays quick. */
const BOARD_MS = 15_000

export const register: Register = (on, options) => {
  const cues: CueControl = { enabled: options.progressCue !== false, ready: false, timer: null, version: 0, refreshing: false, lastGoodSession: null }
  const boards: BoardControl = { reading: false, prReading: false, prReadAt: 0 }
  // One timer each for the module's life: `session.start` fires again after /clear and on a resume.
  let timer = false
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'task-pane', description: 'Show the QualityLayer task beside the transcript' })
    await refresh($, BIN, cues)
    // Nobody waits for the board: the session starts with its own task's band at once.
    void refreshBoard($, BIN, boards)
    if (!timer) {
      timer = true
      $.clock.every(REFRESH_MS, () => {
        void refresh($, BIN, cues)
      })
      $.clock.every(BOARD_MS, () => {
        void refreshBoard($, BIN, boards)
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($, BIN, cues)
    return result
  })

  on('command.run', { command: 'task-pane' }, async $ => {
    await refresh($, BIN, cues)
    await openPane($)
    return { text: 'QualityLayer pane opened.' }
  })

  // The prompt belongs to this native session. Other tasks are available in /task-pane.
  on('ui.render', { component: 'AbovePrompt' }, renderAbovePrompt)

  on('ui.render', { component: 'Pane', requestId: PANE }, renderPane)
}
