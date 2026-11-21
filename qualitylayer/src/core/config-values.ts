// The config's shape and defaults, apart from any file access, so the App page
// (and the website's in-memory demo) can import them without pulling in
// server modules. config.ts re-exports everything here.

import agents from "./agents/agents.json" with { type: "json" }
import { isNativeAgent, NATIVE_AGENTS, type NativeAgent, validModelId } from "./agents/ids.ts"
import {
  AGENT_OWN,
  orchestratorModel,
  PI_ASTRA_MODEL,
  PI_SOL_MODEL,
  planModel,
  smallChangeModel,
  startsOnOwnModel,
} from "./agents/model-values.ts"
import { DEFAULT_USAGE_DISPLAY, type UsageDisplay } from "./usage-display.ts"

/** `system` follows the operating system; light and dark are an explicit choice. */
export type Theme = "system" | "light" | "dark"
export const THEMES: Theme[] = ["system", "light", "dark"]

/** A value that is not a theme follows the system. */
export function themeOf(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "system"
}

/** `system` follows the computer's Reduce motion setting; Full and Reduced are the person's own choice. */
export type Animations = "system" | "full" | "reduced"
export const ANIMATIONS: Animations[] = ["system", "full", "reduced"]

/** A value that is not an animations choice follows the system. */
export function animationsOf(value: unknown): Animations {
  return ANIMATIONS.includes(value as Animations) ? (value as Animations) : "system"
}

/**
 * What the App draws: `full`, or `gentle` (short fades, no travel, nothing that loops). Full wins over
 * a system that asks for less, so the person who wants animations has them.
 */
export type Motion = "full" | "gentle"
export function motionOf(choice: unknown, systemReduces: boolean): Motion {
  const held = animationsOf(choice)
  if (held === "full") return "full"
  if (held === "reduced") return "gentle"
  return systemReduces ? "gentle" : "full"
}

/**
 * Settings › Appearance › Text size, in percent: the installed App's window zoom, so text, buttons,
 * icons and spacing grow together. It stops at 130 %: the App opens 1280 px wide and keeps its
 * sidebar down to 900 px of page, so 150 % would turn the default window into the narrow layout. The
 * native window applies it from `config.json`; a browser tab keeps the browser's own zoom.
 */
export type TextSize = 90 | 100 | 115 | 130
export const TEXT_SIZES: TextSize[] = [90, 100, 115, 130]

/** A value that is not one of the steps is 100 %. */
export function textSizeOf(value: unknown): TextSize {
  return TEXT_SIZES.includes(value as TextSize) ? (value as TextSize) : 100
}

/** The step one larger (`1`) or smaller (`-1`) than `value`, held at the ends: ⌘ + and ⌘ −. */
export function stepTextSize(value: unknown, by: 1 | -1): TextSize {
  const at = TEXT_SIZES.indexOf(textSizeOf(value))
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, at + by))] ?? 100
}

/**
 * Settings › Appearance › Font: the App's text. Each face sets within a few percent of Geist's width,
 * so the fixed-width controls keep their labels; code, paths and the terminal keep their own fonts.
 */
export type UiFont = "geist" | "system" | "atkinson"
export const UI_FONTS: UiFont[] = ["geist", "system", "atkinson"]

/** A value that is not one of the fonts is Geist. */
export function uiFontOf(value: unknown): UiFont {
  return UI_FONTS.includes(value as UiFont) ? (value as UiFont) : "geist"
}

export type ReviewerAgent = NativeAgent

/** When an enabled second opinion reads the Plan; Off leaves the change's choice alone. */
export type SecondOpinionPlan = "off" | "always" | "risky"
export const SECOND_OPINION_PLAN: SecondOpinionPlan[] = ["off", "always", "risky"]
/** When an enabled second opinion reads the built change; Off leaves the Plan's choice alone. */
export type SecondOpinionChange = "off" | "risky" | "always"
export const SECOND_OPINION_CHANGE: SecondOpinionChange[] = ["off", "risky", "always"]
/** The "when" of a read that is on; Settings keeps it while the read is off, so turning it back on restores it. */
export type SecondOpinionWhen = "risky" | "always"
export const SECOND_OPINION_WHEN: SecondOpinionWhen[] = ["risky", "always"]

/** The agent a defaults card opens on: one of the two, or another agent that picks its own models. */
export type DefaultsAgent = NativeAgent | "other"
export const DEFAULTS_AGENTS: DefaultsAgent[] = [...NATIVE_AGENTS, "other"]
/** One effort for a session (and, in a build, every worker): any level an agent's `efforts` lists in `agents.json`. */
export type DefaultsEffort = "low" | "medium" | "high" | "xhigh" | "max"
export const DEFAULTS_EFFORTS: DefaultsEffort[] = ["low", "medium", "high", "xhigh", "max"]
/** An effort a card holds: a level, or "" for Agent’s settings (no effort is passed, the agent's own decides). */
export type EffortChoice = DefaultsEffort | typeof AGENT_OWN
/**
 * Where a session starts: in the session that is open (`this`, after /clear), a new one, or a new
 * worktree. The Implement start's own ids say `here` for `this`; start-values.ts converts.
 */
export type DefaultsWhere = "this" | "new" | "worktree"
export type TerminalSession = "this" | "new"
export type PlanningWorks = "checkout" | "worktree"
export type BuildingWorks = "checkout" | "branch"
export const TERMINAL_SESSIONS: TerminalSession[] = ["this", "new"]
export const PLANNING_WORKS: PlanningWorks[] = ["checkout", "worktree"]
export const BUILDING_WORKS: BuildingWorks[] = ["checkout", "branch"]

/** The view a new session opens in: the setting, else the terminal. */
export function defaultAgentView(config: Pick<Config, "agentView"> | undefined): AgentView {
  return config?.agentView ?? "terminal"
}

export type RunWhere = "app" | "terminal"
/** How an App agent session is drawn: as a conversation, or as the agent's own terminal window. */
export type AgentView = "conversation" | "terminal"
export const AGENT_VIEWS: AgentView[] = ["conversation", "terminal"]
export type Answers = "app" | "terminal"
export const ANSWERS: Answers[] = ["app", "terminal"]
export type RunPermission = "own" | "fewer" | "bypass"
/** Where dependency advisories come from: osv.dev (package names and versions leave the computer), or a local copy. */
export type Advisories = "online" | "local"
export const ADVISORIES: Advisories[] = ["online", "local"]
/** Settings › Workflow › Reviews › Design review: Off, or each finished design. */
export type DesignReview = "off" | "designs"
export const DESIGN_REVIEWS: DesignReview[] = ["off", "designs"]
export type OnQuit = "keep" | "stop"
export type TypeFrom = "keyPaired" | "anyPaired"
export type WindowMode = "fold" | "open"
export type OtherAgent = { program: string; args: string[] }
/**
 * Settings › Agents, per agent. `enabled: false` hides the agent from launch choices and health.
 * `command` is an absolute path that replaces the one found on PATH; `args` are added to every
 * start; `configDir` moves the agent's folder (only for an agent whose `agents.json` entry names a
 * `configDirEnv`); `permMode` is the id of one of the agent's permission modes that a new session
 * starts in when its launch names none, including an explicitly saved Bypass choice.
 * An empty permission mode follows the global default; `own` explicitly uses the agent's settings.
 */
export type AgentSettings = {
  enabled: boolean
  command: string
  args: string[]
  configDir: string
  permMode: string
}
/** The shell a plain Terminal opens: an empty program is the login shell, started with `-l` unless `args` say otherwise. */
export type TerminalShell = { program: string; args: string[] }
/** Where Open in puts a file or folder; Finder shows it in the file manager, Terminal opens a shell in its folder. */
export type Editor = "vscode" | "cursor" | "zed" | "finder" | "terminal" | "custom"
export const EDITORS: Editor[] = ["vscode", "cursor", "zed", "finder", "terminal", "custom"]
/** The one list of places a file or folder opens, by name: Settings › Git and editor and the Files tab's Open in. */
export const EDITOR_NAMES: Record<Editor, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
  custom: "Custom editor",
  finder: "Finder",
  terminal: "Terminal",
}
/** How long an idle session that still has a window open runs before it stops. */
export type IdleStop = "never" | "2h" | "8h" | "24h"
export const IDLE_STOPS: IdleStop[] = ["never", "2h", "8h", "24h"]
/** Which releases the updater offers: Stable ones only, or the newest of any kind (Beta). Settings › About. */
export type UpdateChannel = "stable" | "beta"
export const UPDATE_CHANNELS: UpdateChannel[] = ["stable", "beta"]
export const RUN_WHERE: RunWhere[] = ["app", "terminal"]
export const RUN_PERMISSIONS: RunPermission[] = ["own", "fewer", "bypass"]
export const ON_QUIT: OnQuit[] = ["keep", "stop"]
export const TYPE_FROM: TypeFrom[] = ["keyPaired", "anyPaired"]
export const WINDOW_MODES: WindowMode[] = ["fold", "open"]

export function validOtherAgentProgram(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
  )
}

export function validOtherAgentArgs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every((arg) => typeof arg === "string" && arg.length <= 32768 && !arg.includes("\u0000"))
  )
}

const printable = (text: string): boolean =>
  Array.from(text).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
const absoluteWithoutParents = (text: string): boolean =>
  /^(?:\/|[A-Za-z]:[\\/])/.test(text) && !text.split(/[\\/]/).includes("..")

/** An absolute path, or "" for not set. The file's existence is checked when the agent starts. */
export function validAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false
  return printable(value) && (value === "" || absoluteWithoutParents(value))
}

/** What New task opens with for one agent: Discuss and Plan run on it. */
export type PlanningDefaults = {
  /** A model id, or "" for Agent’s settings (no model is passed, the agent's own decides). */
  model: string
  effort: EffortChoice
  terminalSession: TerminalSession
  planningWorks: PlanningWorks
}
/** The setup of a successfully submitted planning launch; branch names and files are never reused. */
export type PlanningLaunch = {
  /** Submission time orders successful launches without letting a slower old start replace a newer choice. */
  at?: number
  agent: DefaultsAgent
  model: string
  effort: EffortChoice
  perm: RunPermission
  permMode: string
  runWhere: RunWhere
  works: "checkout" | "branch" | "worktree"
}

export function planningLaunchOf(value: unknown): PlanningLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as PlanningLaunch
  if (v.at !== undefined && (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at <= 0))
    return null
  if (
    Object.keys(v)
      .filter((key) => key !== "at")
      .sort()
      .join() !== "agent,effort,model,perm,permMode,runWhere,works"
  )
    return null
  if (
    !DEFAULTS_AGENTS.includes(v.agent) ||
    !RUN_PERMISSIONS.includes(v.perm) ||
    !RUN_WHERE.includes(v.runWhere) ||
    !["checkout", "branch", "worktree"].includes(v.works) ||
    !(v.effort === "" || DEFAULTS_EFFORTS.includes(v.effort)) ||
    typeof v.permMode !== "string"
  )
    return null
  if (v.agent === "other") return v.model === "" && v.perm === "own" && v.permMode === "" ? v : null
  if (!(v.model === "" || validModelId(v.agent, v.model))) return null
  if (
    v.perm !== "own" &&
    !(v.agent === "pi" && v.perm === "bypass") &&
    !agents[v.agent].capabilities.permissionModes.some((mode) => mode.level === v.perm)
  )
    return null
  if (
    v.permMode !== "" &&
    !agents[v.agent].capabilities.permissionModes.some(
      (mode) => mode.id === v.permMode && mode.level === v.perm,
    )
  )
    return null
  return isNativeAgent(v.agent) ? v : null
}
/**
 * What Implement Start opens with for one agent. `orchestrator` is the build session's model for a
 * full task; `builder` its model for a small change. `subagents` is the native build-subagent
 * default; research and Plan helpers keep their independent `models.<agent>.helpers` setting.
 */
export type BuildDefaults = {
  orchestrator: string
  builder: string
  subagents: string
  effort: EffortChoice
  goal: boolean
  terminalSession: TerminalSession
  buildingWorks: BuildingWorks
}

export const COMMIT_TIMINGS = ["slice", "before-verify", "review"] as const
export type CommitTiming = (typeof COMMIT_TIMINGS)[number]
export const commitTimingOf = (value: unknown): CommitTiming =>
  value === "before-verify" || value === "review" ? value : "slice"

export type Config = {
  commitTiming: CommitTiming
  /** Where a task started in an agent asks its questions. */
  answers: Answers
  /** Where such a task asks for its approvals; left unset it follows `answers`. */
  approvals?: Answers | undefined
  /** Whether the person chose both places (the first task started in an agent asks until then). */
  answerPlaceChosen: boolean
  /** Whether the agent offers QualityLayer once when asked to plan without naming it. */
  offerWorkflow: boolean
  runWhere: RunWhere
  /** How a new session is drawn; left unset it is the terminal. */
  agentView?: AgentView | undefined
  perm: RunPermission
  onQuit: OnQuit
  typeFrom: TypeFrom
  windowMode: WindowMode
  otherAgent: OtherAgent
  /** What a plain Terminal opens in: its shell. */
  terminal: { shell: TerminalShell }
  /** One entry per native agent, in Settings › Agents. */
  agents: Record<NativeAgent, AgentSettings>
  cockpit: { port: number; idleMinutes: number }
  /**
   * `sound`: a short sound when a task needs the person or an agent finishes, never while they
   * type. (A retired `openFeedback` key in an older config is read and ignored.)
   */
  notifications: {
    gateOpened: boolean
    taskFinished: boolean
    sound: boolean
  }
  editor: Editor
  customEditor: { program: string; args: string[] }
  sessions: { idleStop: IdleStop }
  /** `channel`: the person's choice, only theirs to make; left unset an installed prerelease follows Beta, any other install Stable. */
  updates: { channel?: UpdateChannel | undefined }
  /**
   * Plan limits: a build stopped by one continues when the window resets. `tokenWarning`: one quiet
   * warning when a task's tokens run well above the person's usual task (cost/token-warning.ts).
   */
  limits: { resumeAfterReset: boolean; tokenWarning: boolean }
  usage: UsageDisplay
  /** Watch the pull request of a task while it is open: failing checks, requested changes, conflicts. */
  pullRequests: { watch: boolean }
  theme: Theme
  /** Settings › Appearance › Animations. */
  animations: Animations
  /** Settings › Appearance › Text size: the installed App's window zoom, in percent. */
  textSize: TextSize
  /** Settings › Appearance › Font. */
  uiFont: UiFont
  /**
   * The models an agent's helpers run on: `helpers` for research, Chat slices, fixes and
   * security, `judge` for the fresh judge (Settings › Models › Independent review), `design` for
   * the fresh look at each finished design (Design review). `session` as the helpers' model: no
   * subagents, the session does every step itself.
   */
  models: Record<ReviewerAgent, { helpers: string; judge: string; design: string }>
  /**
   * The model ids the person added for each agent that takes ids of its own (Settings › Agents ›
   * Models, or Add a model… in any model menu): in every picker after the catalog's and the agent's
   * own. An agent that takes none keeps an empty list.
   */
  addedModels: Record<ReviewerAgent, string[]>
  /**
   * On: one fresh agent that never wrote the code reviews every round and adds the missing tests.
   * Off: checks and the security review still run, Verify records the change as checked without an
   * independent review, and the final review always needs the person.
   */
  independentReview: { enabled: boolean }
  /**
   * Settings › Workflow › Security scans: whether each change is scanned (Verify's scans lane and the
   * turn-end secrets scan), and where dependency advisories come from: osv.dev, or a local copy.
   */
  securityScans: { enabled: boolean; advisories: Advisories }
  /** Whether a fresh agent looks at each finished design once before the person sees it; wireframes are never looked at. */
  designReview: DesignReview
  /**
   * The other agent reviews the Plan and the built change (Claude Code reviews Codex's work and
   * the other way round), on the model named for the reviewing agent. `plan` says when it reads
   * the Plan (Off, When risky, or Always), `change` when it reads the built change independently;
   * `enabled: false` is the reviewer's None choice and turns both off. Only a task that asks for one
   * (`+second-opinion`) gets it.
   */
  secondOpinion: {
    enabled: boolean
    plan: SecondOpinionPlan
    change: SecondOpinionChange
    /** The model each agent reviews on when it gives a second opinion and none is named for it below. */
    models: Record<ReviewerAgent, string>
    /** The "when" each read had when it was last on (Off hides it, never forgets it). */
    whenKept: { plan: SecondOpinionWhen; change: SecondOpinionWhen }
    /** Older setting: a single named reviewer for every agent's work. It is no longer followed. */
    agent: ReviewerAgent | "auto"
    /**
     * Settings › Models › Second opinion, per agent whose work is read: who reads it and on which
     * model. `auto` is the first agent on this computer from another model family; `model` "" is
     * that agent's model above.
     */
    reviewers: Record<ReviewerAgent, SecondOpinionReviewer>
  }
  /** Who you are to your team: the name on your comments and in your avatar. Empty: Polar's name, then your email. */
  profile: { name: string }
  /** Settings › Workflow › Planning defaults: what New task opens with, per agent, and its default agent. */
  planning: {
    lastStart?: PlanningLaunch | null
    defaults: { agent: DefaultsAgent } & Record<ReviewerAgent, PlanningDefaults>
  }
  /** Settings › Workflow › Build defaults: what Implement Start opens with, per agent, and its default agent. */
  implement: {
    /**
     * The agent the last build started in the App used: Start the build opens on it, apart from the
     * agent planning remembers. Only the agent, never its model or effort; "" until a build started.
     */
    lastAgent?: NativeAgent | ""
    defaults: { agent: DefaultsAgent } & Record<ReviewerAgent, BuildDefaults>
  }
}

/** Who gives one agent's second opinion: `auto`, or another agent and its model ("" is its default). */
export type SecondOpinionReviewer = { agent: ReviewerAgent | "auto"; model: string }

const AUTO_REVIEWER = (): SecondOpinionReviewer => ({ agent: "auto", model: "" })

/**
 * One agent's second-opinion reviewer as the settings keep it: `auto` with no model, or another
 * agent than `of` with a model id or "". Anything else (an unknown agent, the agent itself) is `auto`.
 */
export function reviewerOf(of: ReviewerAgent, value: unknown): SecondOpinionReviewer {
  if (typeof value !== "object" || value === null) return AUTO_REVIEWER()
  const { agent, model } = value as Record<string, unknown>
  if (!isNativeAgent(agent) || agent === of) return AUTO_REVIEWER()
  return { agent, model: typeof model === "string" ? model.trim() : "" }
}

export type CrossReviewPoint = "plan" | "verify"
/** The helpers' model that means no subagents: the session does every step itself. */
/** The most ids one agent keeps in its added list. */
export const ADDED_MODELS_MAX = 50
export const SESSION_MODEL = "session"

/**
 * The planning setup QualityLayer recommends for one agent: the model agents.json names, or the
 * agent's own where it has no catalog recommendation, High, this session.
 */
export function recommendedPlanning(agent: ReviewerAgent): PlanningDefaults {
  return {
    model: startsOnOwnModel(agent) ? AGENT_OWN : planModel(agent),
    effort: "high",
    terminalSession: "this",
    planningWorks: "checkout",
  }
}

/** The build setup QualityLayer recommends for one agent: High, goal mode, this session. */
export function recommendedBuild(agent: ReviewerAgent): BuildDefaults {
  const own = startsOnOwnModel(agent)
  return {
    orchestrator: own ? AGENT_OWN : orchestratorModel(agent),
    builder: own ? AGENT_OWN : smallChangeModel(agent),
    subagents: agent === "claude-code" ? "sonnet" : agent === "codex" ? "gpt-6.2-sol" : AGENT_OWN,
    effort: "high",
    goal: agents[agent].goal !== null,
    terminalSession: "this",
    buildingWorks: "checkout",
  }
}

const unsetAgent = (): AgentSettings => ({
  enabled: true,
  command: "",
  args: [],
  configDir: "",
  permMode: "",
})

export const DEFAULT_CONFIG: Config = {
  commitTiming: "slice",
  answers: "app",
  approvals: undefined,
  answerPlaceChosen: false,
  offerWorkflow: true,
  runWhere: "app",
  agentView: undefined,
  perm: "bypass",
  onQuit: "keep",
  typeFrom: "keyPaired",
  windowMode: "fold",
  otherAgent: { program: "", args: [] },
  terminal: { shell: { program: "", args: [] } },
  agents: {
    "claude-code": unsetAgent(),
    codex: unsetAgent(),
    pi: unsetAgent(),
    opencode: unsetAgent(),
    cursor: unsetAgent(),
    grok: unsetAgent(),
    antigravity: unsetAgent(),
    copilot: unsetAgent(),
  },
  cockpit: { port: 41888, idleMinutes: 30 },
  notifications: { gateOpened: true, taskFinished: true, sound: true },
  editor: "vscode",
  customEditor: { program: "", args: [] },
  sessions: { idleStop: "8h" },
  updates: { channel: undefined },
  limits: { resumeAfterReset: true, tokenWarning: true },
  usage: DEFAULT_USAGE_DISPLAY,
  pullRequests: { watch: true },
  theme: "system",
  animations: "system",
  textSize: 100,
  uiFont: "geist",
  addedModels: {
    "claude-code": [],
    codex: [],
    pi: [],
    opencode: [],
    cursor: [],
    grok: [],
    antigravity: [],
    copilot: [],
  },
  // A design is looked at on the model the change is judged on, unless the person picks another.
  models: {
    "claude-code": { helpers: "sonnet", judge: "opus", design: "opus" },
    codex: { helpers: "gpt-6.2-sol", judge: "gpt-6.2-astra", design: "gpt-6.2-astra" },
    pi: {
      helpers: PI_SOL_MODEL,
      judge: PI_ASTRA_MODEL,
      design: PI_ASTRA_MODEL,
    },
    opencode: {
      helpers: "openai/gpt-6.2-sol",
      judge: "openai/gpt-6.2-astra",
      design: "openai/gpt-6.2-astra",
    },
    cursor: { helpers: "auto", judge: "claude-opus-5-5-high", design: "claude-opus-5-5-high" },
    grok: { helpers: "grok-4.7", judge: "grok-4.7", design: "grok-4.7" },
    antigravity: {
      helpers: "gemini-3.8-flash-high",
      judge: "claude-opus-4-6-thinking",
      design: "claude-opus-4-6-thinking",
    },
    // Auto runs on every Copilot plan; Free has no Claude or GPT premium model.
    copilot: { helpers: "auto", judge: "auto", design: "auto" },
  },
  secondOpinion: {
    enabled: false,
    // The other agent reads a risky Plan (its Risky line, a trust boundary, a risky slice); Always
    // in Settings sends it every Plan.
    plan: "risky",
    change: "risky",
    models: {
      "claude-code": "opus",
      codex: "gpt-6.2-astra",
      pi: PI_ASTRA_MODEL,
      opencode: "openai/gpt-6.2-astra",
      cursor: "auto",
      grok: "grok-4.7",
      antigravity: "gemini-3.8-flash-high",
      copilot: "auto",
    },
    whenKept: { plan: "risky", change: "risky" },
    agent: "auto",
    reviewers: {
      "claude-code": AUTO_REVIEWER(),
      codex: AUTO_REVIEWER(),
      pi: AUTO_REVIEWER(),
      opencode: AUTO_REVIEWER(),
      cursor: AUTO_REVIEWER(),
      grok: AUTO_REVIEWER(),
      antigravity: AUTO_REVIEWER(),
      copilot: AUTO_REVIEWER(),
    },
  },
  independentReview: { enabled: true },
  securityScans: { enabled: true, advisories: "online" },
  designReview: "designs",
  profile: { name: "" },
  planning: {
    lastStart: null,
    defaults: {
      agent: "claude-code",
      "claude-code": recommendedPlanning("claude-code"),
      codex: recommendedPlanning("codex"),
      pi: recommendedPlanning("pi"),
      opencode: recommendedPlanning("opencode"),
      cursor: recommendedPlanning("cursor"),
      grok: recommendedPlanning("grok"),
      antigravity: recommendedPlanning("antigravity"),
      copilot: recommendedPlanning("copilot"),
    },
  },
  implement: {
    lastAgent: "",
    defaults: {
      agent: "claude-code",
      "claude-code": recommendedBuild("claude-code"),
      codex: recommendedBuild("codex"),
      pi: recommendedBuild("pi"),
      opencode: recommendedBuild("opencode"),
      cursor: recommendedBuild("cursor"),
      grok: recommendedBuild("grok"),
      antigravity: recommendedBuild("antigravity"),
      copilot: recommendedBuild("copilot"),
    },
  },
}
