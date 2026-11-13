// The sections of Settings, in the order the sidebar lists them: each with its icon, its one lead
// line, the words a search for it answers to, and the rows it holds (what a search for a single
// setting finds). Opening a section is `#/settings/<id>`; an unknown id is Workflow.

import {
  BellIcon,
  BotIcon,
  BoxIcon,
  BrainIcon,
  CpuIcon,
  GaugeIcon,
  GitBranchIcon,
  InfoIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  PaletteIcon,
  ServerIcon,
  WebhookIcon,
} from "lucide-react"
import { machineFrame } from "../machines/framed.ts"
import { LEAVES_LABELS, PLAN_LABELS } from "./Licence.tsx"

export type SettingsSection = {
  id: string
  label: string
  icon: LucideIcon
  /** One line under the section's name: what it is for. */
  lead: string
  /** Words the section answers to besides its name and its rows. */
  words: string
  /** The labels of the rows the section holds, as the page shows them. */
  rows: readonly string[]
  /** Group names that a search can find. */
  groups?: readonly string[]
}

const ENTRIES: readonly SettingsSection[] = [
  {
    id: "workflow",
    label: "Workflow",
    icon: ListChecksIcon,
    lead: "How new tasks are planned, reviewed and scanned.",
    words:
      "instructions answer questions approve approval where terminal ide own agent app claude code codex t3 code orca chat offer independent review design review second opinion plan security scans secrets osv advisories vulnerable packages",
    rows: [
      "Offer QualityLayer",
      "Your instructions",
      "Answer questions in",
      "Approve in",
      "Independent review",
      "Second opinion",
      "Design review",
      "Scan each change",
      "Dependency advisories",
    ],
    groups: ["Your agent"],
  },
  {
    id: "agents",
    label: "Agents",
    icon: BotIcon,
    lead: "The coding agents QualityLayer starts on this computer.",
    words:
      "claude code codex pi opencode cursor grok antigravity github copilot sign in account version launch edit launch command extra arguments config folder default permission permission mode integration install repair another agent program terminal shell",
    rows: ["Program", "Arguments", "Shell"],
  },
  {
    id: "models",
    label: "Models",
    icon: BoxIcon,
    lead: "The model each agent uses for each job. A launch can still pick another.",
    words:
      "model models roles reviewer reviewer models judge opus sonnet fable haiku gpt grok gemini auto composer planning plan implement build lead full task small change subagents helpers chat review verify second opinion add a model catalog reported default recommended claude code codex pi opencode cursor antigravity github copilot",
    rows: [
      "Plan",
      "Implement · full task",
      "Implement · small change",
      "Implement subagents",
      "Helpers",
      "Independent review",
      "Design review",
      "Second opinion",
    ],
    groups: ["Plan and Implement", "Reviews", "Model list"],
  },
  {
    id: "usage",
    label: "Usage",
    icon: GaugeIcon,
    lead: "Plan limits now, and what your agents used.",
    words:
      "plan limits left resets tokens cost estimated week hours days month model agent price sessions cache fast speed billed api key gateway breakdown chart",
    rows: ["Resume when a limit resets"],
  },
  {
    id: "sessions",
    label: "Sessions",
    icon: CpuIcon,
    lead: "The agent sessions running on this computer.",
    words: "running idle memory stop quit background typing browsers paired",
    rows: ["Stop agents that sit idle", "Who can type in a session", "When you quit the App"],
  },
  {
    id: "machines",
    label: "Machines",
    icon: ServerIcon,
    lead: "Other computers you reach over ssh. Their agents keep working while this one sleeps.",
    words:
      "machine machines remote server vm workstation ssh host connect offline add remove another computer tunnel forward",
    rows: [],
    groups: ["Machines"],
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellIcon,
    lead: "How QualityLayer tells you a task needs you.",
    words: "notify sound system alert browser",
    rows: ["Tell me when a task needs me", "Play a sound with it"],
  },
  {
    id: "source",
    label: "Git and editor",
    icon: GitBranchIcon,
    lead: "Where files open, and the pull requests agents watch.",
    words:
      "git github gh pull request checks editor vs code cursor zed finder terminal open watch wake needs you",
    rows: ["Open files and folders in", "Watch pull requests"],
    groups: ["Tools"],
  },
  {
    id: "automations",
    label: "Automations",
    icon: WebhookIcon,
    lead: "Send task events to your own tools.",
    words:
      "webhook webhooks api event events url command script hook integration zapier n8n jira linear ticket deliver delivery recent deliveries new automation signing secret test add",
    rows: ["Set up by command", "Events and payload"],
    groups: ["Your automations", "From your agent or a script"],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    lead: "How the App and the agent terminal look.",
    words:
      "default view conversation terminal agent sessions theme mode dark mode light mode appearance system text size zoom bigger larger smaller readable scale font typeface geist atkinson hyperlegible animations motion reduce motion full reduced sidebar task rows detailed two lines one line font size weight spacing terminal colours cursor webgl scrollback",
    rows: [
      "Show agent sessions as",
      "Text size",
      "Task rows",
      "Font size",
      "Font",
      "Weight",
      "Letter spacing",
      "Line spacing",
      "Colours",
      "Blinking cursor",
      "Use WebGL",
      "Scrollback",
    ],
    groups: ["Theme", "Text", "Agent sessions", "Agent terminal"],
  },
  {
    id: "memory",
    label: "Memory",
    icon: BrainIcon,
    lead: "Lessons agents keep between tasks.",
    words: "lessons pin share import pilot shell",
    rows: ["Remember useful lessons", "Lessons in every session"],
  },
  {
    id: "licence",
    label: "Licence",
    icon: KeyRoundIcon,
    lead: "Your plan, your key, and what leaves this computer.",
    words:
      "key billing plan subscription invoice payment activate activation command seats privacy",
    rows: ["Your licence", "On another computer", ...LEAVES_LABELS],
  },
  {
    id: "about",
    label: "About",
    icon: InfoIcon,
    lead: "This version, its updates, help and what changed.",
    words:
      "version update channel stable beta release notes help report docs documentation server port localhost 41888 forward tunnel ssh restart",
    rows: [
      "Check for updates",
      "Update channel",
      "Server port",
      "In use now",
      "Documentation",
      "Something wrong?",
    ],
    groups: ["Server"],
  },
]

/**
 * The sidebar's order in three runs (Max, 5 November 2026): how the work runs, how the App behaves for
 * you, then your account. A thin rule follows the last section of a run while the search is empty.
 */
const ORDER = [
  "workflow",
  "agents",
  "models",
  "sessions",
  "machines",
  "memory",
  "source",
  "automations",
  "notifications",
  "appearance",
  "usage",
  "licence",
  "about",
] as const
export const RUN_ENDS: readonly string[] = ["automations", "appearance"]

export const SECTIONS: readonly SettingsSection[] = ORDER.map(
  (id) => ENTRIES.find((entry) => entry.id === id) as SettingsSection,
)

const DEFAULT_SECTION = "workflow"

/**
 * The sections this page offers. Machines are added on the computer the person sits at, so a
 * machine's own page (shown framed in another computer's App) has no Machines section.
 */
const offered = (): readonly SettingsSection[] =>
  typeof window === "undefined" || machineFrame() === null
    ? SECTIONS
    : SECTIONS.filter((section) => section.id !== "machines")

/** What a row is also called: a browser's notifications, a licence by its tier, updates. */
export const ROW_ALIASES: Record<string, readonly string[]> = {
  "Tell me when a task needs me": ["Browser notifications"],
  "Check for updates": ["Updates"],
  "Your licence": PLAN_LABELS,
}

/** The section a route names; Workflow when it names none the page has. */
export function sectionOf(tab: string | undefined): SettingsSection {
  const found = offered().find((section) => section.id === tab)
  return found ?? (SECTIONS.find((section) => section.id === DEFAULT_SECTION) as SettingsSection)
}

type SettingsHit = {
  section: SettingsSection
  /** The rows and groups whose own name matches, shown under the section, best first. */
  rows: string[]
}

/** A word without its plural s, so "updates" and "update" are the same word. */
const stem = (word: string): string => (word.length > 3 ? word.replace(/s$/, "") : word)
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem)

/**
 * How well a name answers the words typed, lower is better: 0 is the name itself, 1 holds every
 * word among its own (fewer other words is better), 2 holds them as the start of its words,
 * 3 anywhere in its letters. Null: it does not answer.
 */
function nameScore(typed: string[], name: string): number | null {
  const own = wordsOf(name)
  if (own.length === typed.length && typed.every((word, at) => own[at] === word)) return 0
  if (typed.every((word) => own.includes(word))) return 1 + (own.length - typed.length) / 100
  if (typed.every((word) => own.some((have) => have.startsWith(word)))) return 2
  const lower = name.toLowerCase()
  return typed.every((word) => lower.includes(word)) ? 3 : null
}

const best = (scores: (number | null)[]): number | null => {
  const found = scores.filter((score): score is number => score !== null)
  return found.length === 0 ? null : Math.min(...found)
}

/**
 * The sections a search finds, best first: a section named by the words, then a group, then a row
 * named by them, then a partial match, then a match in what the section holds, each in the sidebar's
 * order; with the rows and groups that matched by their own name, best first. Every word typed has to
 * be in the text, in any order.
 */
export function findSettings(query: string): SettingsHit[] {
  const typed = wordsOf(query)
  const sections = offered()
  if (typed.length === 0) return sections.map((section) => ({ section, rows: [] }))
  const hits = sections.flatMap((section, order) => {
    const entries = [
      ...(section.groups ?? []).map((name) => ({ name, group: true })),
      ...section.rows.map((name) => ({ name, group: false })),
    ]
      .map((entry) => ({
        ...entry,
        score: best(
          [entry.name, ...(ROW_ALIASES[entry.name] ?? [])].map((name) => nameScore(typed, name)),
        ),
      }))
      .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
      .sort((x, y) => x.score - y.score)
    const own = nameScore(typed, section.label)
    const text = [section.label, section.words, ...section.rows, ...(section.groups ?? [])]
      .join(" ")
      .toLowerCase()
    const holds = typed.every((word) => text.includes(word))
    if (entries.length === 0 && own === null && !holds) return []
    const exact = entries.filter((entry) => entry.score === 0)
    let rank = 4
    if (own === 0) rank = 0
    else if (exact.some((entry) => entry.group)) rank = 1
    else if (exact.length > 0) rank = 2
    else if (entries.length > 0 || own !== null) rank = 3
    const lead = Math.min(own ?? 9, entries[0]?.score ?? 9)
    // A section named by the words is the answer itself; its rows would only repeat it.
    const rows = own === 0 ? [] : entries.map((entry) => entry.name)
    return [{ section, rows, rank, lead, order }]
  })
  hits.sort((x, y) => x.rank - y.rank || x.lead - y.lead || x.order - y.order)
  return hits.map(({ section, rows }) => ({ section, rows }))
}
