// An agent that waits on its own start-up question: trust this folder, choose a text style, its first-run
// notes, the Bypass Permissions warning, a sign-in. The question shows only on the agent's terminal screen,
// so the run's host reads that screen and the App says who asks and where to answer. Antigravity can
// record the first prompt before its setup or folder trust screen releases the terminal.

import type { NativeAgent } from "../agents/ids.ts"

export type StartupPrompt = "trust" | "theme" | "setup" | "notes" | "bypass" | "login"

/** How the card's title finishes: "<Agent> <asks you to trust this folder>". */
export const STARTUP_PROMPT_LINES: Record<StartupPrompt, string> = {
  trust: "asks you to trust this folder",
  theme: "asks you to choose a text style",
  setup: "asks you to finish setup",
  notes: "shows its first-run notes and waits for Enter",
  bypass: "asks you to accept Bypass Permissions mode",
  login: "asks you to sign in",
}

/** The sentence a one-line status says: the same, as what the person has to do. */
export const STARTUP_PROMPT_STATUS: Record<StartupPrompt, string> = {
  trust: "Asks you to trust this folder · answer in its terminal",
  theme: "Asks for a text style · answer in its terminal",
  setup: "Asks you to finish setup · answer in its terminal",
  notes: "Shows its first-run notes · press Enter in its terminal",
  bypass: "Asks you to accept Bypass Permissions · answer in its terminal",
  login: "Asks you to sign in · answer in its terminal",
}

// What the agents print. Claude Code: "Quick safety check: Is this a project you created or one you trust?"
// with "Yes, I trust this folder" (older: "Do you trust the files in this folder?"), "Choose the text style
// that looks best with your terminal", "Security notes:", "WARNING: Claude Code running in Bypass Permissions
// mode", "Select login method". Codex: "Do you trust the contents of this directory?". The trust question of
// any other agent is read by its words, not its layout.
const PATTERNS: readonly (readonly [StartupPrompt, RegExp])[] = [
  [
    "login",
    /select login method|paste code here if prompted|browser didn.?t open|sign in with chatgpt/,
  ],
  [
    "bypass",
    /bypass permissions mode[\s\S]{0,400}(i accept|no, exit)|(i accept|no, exit)[\s\S]{0,400}bypass permissions mode/,
  ],
  [
    "trust",
    /is this a project you created or one you trust|do you trust (the files in|the contents of|this)|yes, i trust this (folder|workspace|directory)|trust this (folder|workspace|directory)\?|workspace trust required/,
  ],
  ["theme", /text style that looks best with your terminal|choose the text style|select a theme/],
  ["notes", /security notes:[\s\S]{0,600}press enter to continue/],
]

const ANTIGRAVITY_PROMPTS = [
  ["setup", "welcome to antigravity cli!", "choose your color scheme", "next"],
  ["setup", "terms of service & data use", "help improve antigravity cli", "previous", "done"],
  [
    "trust",
    "accessing workspace:",
    "do you trust the contents of this project?",
    "antigravity cli requires permission",
    "yes, i trust this folder",
    "no, exit",
  ],
] as const

export function holdsAntigravityStartup(
  agent: NativeAgent | "other",
  prompt: StartupPrompt | undefined,
): boolean {
  return agent === "antigravity" && (prompt === "setup" || prompt === "trust")
}

const screenWords = (screen: string) => screen.replace(/\s+/g, " ").trim().toLowerCase()

function detect(text: string, agent: NativeAgent | undefined, tookPrompt: boolean) {
  if (agent === "antigravity")
    for (const [kind, ...parts] of ANTIGRAVITY_PROMPTS)
      if (parts.every((part) => text.includes(part))) return kind
  if (tookPrompt) return null
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind
  return null
}

/** The question the agent's screen shows, or null when it shows none. */
export function detectStartupPrompt(screen: string, agent?: NativeAgent): StartupPrompt | null {
  return detect(screenWords(screen), agent, false)
}

/** How long after the start a screen with no question stops being read. */
export const STARTUP_WATCH_MS = 10 * 60_000
const DEBOUNCE_MS = 700

type Watch = {
  agent?: NativeAgent
  /** The screen as text, read only when a question may be showing. */
  screen: () => string
  /** The run took its first prompt. Antigravity's own setup and trust may still have the input. */
  done: () => boolean
  /** The question changed: what shows now, or null once it is gone. */
  set: (kind: StartupPrompt | null) => void
  now?: () => number
  /** How long a pause in the output must last before the screen is read (default 700 ms). */
  debounceMs?: number
}

function antigravityStartupStillShowing(
  agent: NativeAgent | undefined,
  current: StartupPrompt | null,
  screen: string,
): boolean {
  if (!holdsAntigravityStartup(agent ?? "other", current ?? undefined)) return false
  return !screen || ANTIGRAVITY_PROMPTS.some(([, title]) => screen.includes(title))
}

function evaluateStartupScreen(
  watch: Watch,
  current: StartupPrompt | null,
  elapsedMs: number,
): { action: "end" | "keep" | "set"; next?: StartupPrompt | null } {
  const tookPrompt = watch.done()
  if (tookPrompt && watch.agent !== "antigravity") return { action: "end" }
  const screen = screenWords(watch.screen())
  const next = detect(screen, watch.agent, tookPrompt)
  if (tookPrompt && next === null) {
    return antigravityStartupStillShowing(watch.agent, current, screen)
      ? { action: "keep" }
      : { action: "end" }
  }
  if (next === null && current === null && elapsedMs > STARTUP_WATCH_MS) return { action: "end" }
  return next === current ? { action: "keep" } : { action: "set", next }
}

/**
 * Watches one run's screen for its start-up question. `changed` is called when the agent printed
 * something; at most one read follows it, 700 ms later, so a stream of output costs one screen read per
 * pause. A quiet terminal reads nothing. The first prompt ends the watch unless an Antigravity startup
 * screen is still visible. A screen that never held a question stops being read after {@link STARTUP_WATCH_MS}.
 */
export function watchStartupPrompt(watch: Watch) {
  const now = watch.now ?? Date.now
  const started = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: StartupPrompt | null = null
  let ended = false
  const end = () => {
    ended = true
    if (timer) clearTimeout(timer)
    timer = undefined
    if (current !== null) {
      current = null
      watch.set(null)
    }
  }
  const read = () => {
    timer = undefined
    if (ended) return
    const verdict = evaluateStartupScreen(watch, current, now() - started)
    if (verdict.action === "end") end()
    else if (verdict.action === "set") {
      current = verdict.next ?? null
      watch.set(current)
    }
  }
  return {
    changed() {
      if (ended || timer) return
      timer = setTimeout(read, watch.debounceMs ?? DEBOUNCE_MS)
      timer.unref?.()
    },
    stop: end,
  }
}
