// Codex runs its PermissionRequest hook for a request its Auto review then approves on its own, and no
// hook runs when an approval resolves. The hook alone leaves the run "waiting for your answer" through a
// long approved command (a `gate wait` for the Plan). While that request is the run's latest event, the
// host reads Codex's screen: an approval shows Codex's confirmation footer at the bottom; an approved
// command shows its working line above the empty composer and its "? for shortcuts" hint. Nothing is
// read while no request is unresolved.

/** Codex's approval dialogs (command, edits, network) end in this footer, on the screen's last line. */
const CONFIRM = /^press enter to confirm or esc to cancel$/
/** Codex's status line while a turn runs: "Working (3m 03s • esc to interrupt)". */
const WORKING = /^(?:• )?working \([^)]*esc to interrupt\)$/
/** The hint line under Codex's empty composer, the screen's last line when no overlay is open. */
const COMPOSER = /^(?:[←→↑↓↔⌃⌘][^·|]*[·|]\s*)*\? for shortcuts\b/
/** How far from the bottom the working line sits: it, a tip, the composer and its hints. */
const WORKING_ROWS = 8

/**
 * What the bottom of Codex's screen shows: a dialog asking, a turn working above the composer, or
 * neither (any other overlay keeps the hook's wait).
 */
export function approvalScreen(screen: string): "asking" | "working" | null {
  const rows = screen
    .split(/\r?\n/)
    .map((row) => row.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((row) => row !== "")
  if (CONFIRM.test(rows.at(-1) ?? "")) return "asking"
  if (!COMPOSER.test(rows.at(-1) ?? "")) return null
  const bottom = rows.slice(-WORKING_ROWS)
  const working = bottom.findLastIndex((row) => WORKING.test(row))
  const confirmation = bottom.findLastIndex((row) => CONFIRM.test(row))
  if (confirmation > working) return "asking"
  return working >= 0 ? "working" : null
}

/**
 * How long a working screen must follow the request before it ends the wait. Auto review approved each
 * of 27 requests captured from Codex 0.163 and 0.164 in 1.1–3.8 s, the command's own run included; a
 * person's dialog replaces the working line, so it keeps the wait whatever the time.
 */
export const APPROVAL_SETTLE_MS = 10_000
// Codex's working line ticks every second, so a read follows at most every two seconds while it works.
const DEBOUNCE_MS = 2000

/** A native permission dialog at the live bottom of a terminal, never a reply transport. */
export function terminalPermissionScreen(screen: string): boolean {
  const rows = screen
    .split(/\r?\n/)
    .map((row) => row.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .slice(-24)
  const text = rows.join("\n")
  if (rows.every((row) => row.startsWith("> "))) return false
  // Copilot's MCP permission dialog includes Yes, Yes and don't ask again, and No.
  // Requiring real choice rows excludes an assistant merely mentioning approval.
  const choices = rows.map((row) =>
    row
      .replace(/^[│┃|›>❯→●○\s\d.)-]+/, "")
      .replace(/[│┃|]\s*$/, "")
      .trim(),
  )
  const cursorQuestion = rows.lastIndexOf("run this command?")
  const cursorNotAllowed = rows.findLastIndex((row) => row.startsWith("not in allowlist:"))
  const cursorRun = choices.lastIndexOf("run (once) (y)")
  const cursorSkip = choices.lastIndexOf("skip & tell the agent what to do instead (esc or n)")
  if (
    cursorQuestion >= 0 &&
    cursorNotAllowed > cursorQuestion &&
    cursorRun > cursorNotAllowed &&
    cursorSkip > cursorRun &&
    cursorSkip === choices.length - 1
  )
    return true
  const lastChoice = choices.findLastIndex((row) =>
    /^(?:yes|no|allow|approve|accept|deny|reject|decline|cancel)(?:$|[, (])/.test(row),
  )
  if (
    lastChoice >= 0 &&
    rows
      .slice(lastChoice + 1)
      .some(
        (row) =>
          !/^[─━└┘┌┐╭╮╯╰│┃┴┬├┤+\s-]+$/.test(row) &&
          !/(?:enter to|esc(?:ape)? to|press enter|arrow keys|↑|↓|navigate|select an option)/.test(
            row,
          ),
      )
  )
    return false
  const yes = choices.some((row) => /^yes(?:$|[, (])/.test(row))
  const no = choices.some((row) => /^no(?:$|[, (])/.test(row))
  const remember = choices.some((row) =>
    /^(?:yes[, ]+)?(?:and )?(?:don.t ask again|allow.*session|always allow)/.test(row),
  )
  if (yes && no && remember) return true
  const question =
    rows.some((row) =>
      /^(?:permission (?:required|request)|approval (?:required|request))[:?]?$/.test(row),
    ) ||
    /(?:would you like|do you want|allow|approve|permission|confirm).{0,160}(?:run|execute|tool|command|access|create|\bread\b|write|edit|delete|file|request)|(?:run|execute|tool|command|access|create|\bread\b|write|edit|delete).{0,160}(?:permission|approval|\?)/.test(
      text,
    )
  if (!question) return false
  const allow = choices.some((row) => /^(?:allow|approve|accept)(?:$|[, (])/.test(row))
  const deny = choices.some((row) => /^(?:deny|reject|decline|cancel)(?:$|[, (])/.test(row))
  const footer = rows
    .slice(-3)
    .some((row) =>
      /(?:enter to (?:confirm|accept)|press enter to confirm|\[y\/n\]|\(y\/n\))/.test(row),
    )
  return (yes && no) || (allow && deny) || footer
}

/** Observe output pauses only; idle terminals cause no reads or recurring timers. */
export function watchTerminalPermission(watch: {
  screen(): string
  set(asking: boolean): void
  debounceMs?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let asking = false
  let ended = false
  return {
    changed() {
      if (ended || timer) return
      timer = setTimeout(() => {
        timer = undefined
        if (ended) return
        const next = terminalPermissionScreen(watch.screen())
        if (next !== asking) {
          asking = next
          watch.set(next)
        }
      }, watch.debounceMs ?? 700)
      timer.unref?.()
    },
    stop() {
      ended = true
      if (timer) clearTimeout(timer)
      timer = undefined
      if (asking) watch.set(false)
      asking = false
    },
  }
}

/** The run's unresolved lead permission request: the event that recorded it and the wait it set. */
export type PendingApproval = { sequence: number; requestedAt: string; waitSince?: string }

type Watch = {
  /** The request when it is the run's latest event, else undefined. */
  pending: () => PendingApproval | undefined
  /** The screen as text, read only while a request is pending. */
  screen: () => string
  /** Records the wait for that request only while it is still the run's latest event. */
  set: (sequence: number, waitSince: string | undefined) => void
  now?: () => number
  debounceMs?: number
}

/**
 * Watches one Codex run for a permission wait its screen contradicts. `runChanged` is called when the
 * run record changed, `changed` when the agent printed something. A pending request is read when it has
 * settled and, after that, at most every two seconds of output until a newer event resolves it: a
 * working line ends its wait, the confirmation footer restores it (Auto review handed it to the person),
 * and any other screen changes nothing. A quiet terminal with no pending request reads nothing.
 */
export function watchApprovalScreen(watch: Watch) {
  const now = watch.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | undefined
  let watched: number | undefined
  let ended = false
  const later = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(read, Math.max(0, ms))
    timer.unref?.()
  }
  const read = () => {
    timer = undefined
    if (ended || watched === undefined) return
    const request = watch.pending()
    if (request?.sequence !== watched) {
      watched = undefined
      return
    }
    const settled = Date.parse(request.requestedAt) + APPROVAL_SETTLE_MS - now()
    const shown = approvalScreen(watch.screen())
    if (shown === "asking" && request.waitSince === undefined)
      watch.set(request.sequence, new Date(now()).toISOString())
    else if (shown === "working" && request.waitSince !== undefined && settled <= 0)
      watch.set(request.sequence, undefined)
    else if (settled > 0) later(settled)
  }
  return {
    runChanged() {
      if (ended) return
      const request = watch.pending()
      if (request?.sequence === watched) return
      watched = request?.sequence
      if (timer) clearTimeout(timer)
      timer = undefined
      if (request) later(Date.parse(request.requestedAt) + APPROVAL_SETTLE_MS - now())
    },
    changed() {
      if (ended || watched === undefined || timer) return
      later(watch.debounceMs ?? DEBOUNCE_MS)
    },
    stop() {
      ended = true
      watched = undefined
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

/** The lead's unresolved PermissionRequest; trailing helper events do not resolve it. */
export function pendingApproval(run: {
  generation: number
  eventSequence?: number
  waitSince?: string
  runEvents?: readonly {
    generation: number
    sequence: number
    at: string
    event: string
    lead: boolean
  }[]
}): PendingApproval | undefined {
  const latest = run.runEvents?.at(-1)
  const last = run.runEvents?.findLast((event) => event.generation === run.generation && event.lead)
  if (last?.event !== "PermissionRequest") return undefined
  if (latest?.generation !== run.generation || run.eventSequence !== latest.sequence)
    return undefined
  return {
    sequence: last.sequence,
    requestedAt: last.at,
    ...(run.waitSince ? { waitSince: run.waitSince } : {}),
  }
}
