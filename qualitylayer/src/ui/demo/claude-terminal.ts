import "./claude-terminal.css"

type Scene = "questions" | "artifact" | "plan" | "implement"

type SceneMeta = {
  repo: string
  step: string
  task: string
  status: string
  branch: string
}

const SCENE_META: Record<Scene, SceneMeta> = {
  questions: {
    repo: "notifications",
    step: "Plan",
    task: "· Webhook delivery",
    status: "4 items need you",
    branch: "feat/webhooks",
  },
  artifact: {
    repo: "jobs",
    step: "Plan",
    task: "· Queue routing",
    status: "Waits for your approval",
    branch: "feat/queue-routing",
  },
  plan: {
    repo: "billing",
    step: "Plan",
    task: "· Usage-based billing",
    status: "Waits for your approval",
    branch: "feat/usage-billing",
  },
  implement: {
    repo: "billing",
    step: "Implement",
    task: "· Usage-based billing",
    status: "Slice 6 of 11 · T16",
    branch: "feat/usage-billing",
  },
}

function el(tag: string, className: string, value?: string): HTMLElement {
  const element = document.createElement(tag)
  element.className = className
  if (value !== undefined) element.textContent = value
  return element
}

function lineTone(line: string): string | null {
  if (/^(>|❯) /.test(line)) return "cc-demo-prompt"
  if (/^\s*⎿/.test(line)) return "cc-demo-muted"
  if (/^● (Read|Update|Bash)/.test(line)) return "cc-demo-tool"
  if (/^\s*✓/.test(line)) return "cc-demo-green"
  return null
}

function appendTranscript(transcript: HTMLElement, text: string): void {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => /^(>|❯) /.test(line))
  const end = lines.findIndex((line) => /^─{5}/.test(line))
  for (const line of lines.slice(Math.max(0, start), end < 0 ? undefined : end)) {
    const row = el("div", "cc-demo-line", line === "" ? " " : line.replace(/^> /, "❯ "))
    const tone = lineTone(line)
    if (tone) row.classList.add(tone)
    transcript.append(row)
  }
}

/** Illustrative task data in Claude Code's transcript and native footer arrangement. */
export function renderClaudeTerminal(root: HTMLElement, text: string, scene: Scene): void {
  const meta = SCENE_META[scene]
  const terminal = el("div", "cc-demo")
  terminal.setAttribute("aria-label", "Illustrative Claude Code session with QualityLayer")

  const transcript = el("div", "cc-demo-transcript")
  const header = el("div", "cc-demo-header")
  header.append(el("pre", "cc-demo-logo", "▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝"))
  const identity = el("div", "")
  identity.append(
    el("div", "cc-demo-name", "Claude Code v2.1.303"),
    el("div", "cc-demo-muted", "Opus 5.5 · 1M context"),
    el("div", "cc-demo-muted", `~/acme/${meta.repo}`),
  )
  header.append(identity)
  transcript.append(header)
  appendTranscript(transcript, text)

  const band = el("div", "cc-demo-band")
  band.append(
    el("b", "", `QL ○ ${meta.step}`),
    el("span", "cc-demo-task", meta.task),
    el("span", "", meta.status),
    el("small", "cc-demo-muted", "d: Details"),
  )

  const prompt = el("div", "cc-demo-input")
  prompt.append(
    el("span", "", "❯ "),
    el("span", "cc-demo-muted", "Ask a question or give feedback"),
  )

  const status = el("div", "cc-demo-status")
  const parts: [string, string][] = [
    ["cc-demo-cyan", meta.repo],
    ["", " · "],
    ["cc-demo-yellow", "Opus 5.5"],
    ["cc-demo-orange", " ⚡high"],
    ["", " · "],
    ["cc-demo-blue", "◔ 18% · 180K ctx"],
    ["", " · "],
    ["cc-demo-green", "$0.84"],
    ["", " · "],
    ["cc-demo-purple", meta.branch],
  ]
  for (const [className, value] of parts) status.append(el("span", className, value))

  terminal.append(
    transcript,
    band,
    prompt,
    status,
    el("div", "cc-demo-help cc-demo-muted", "? for shortcuts"),
  )
  root.replaceChildren(terminal)
}
