// What the agents' hooks and every `qualitylayer` call leave for the live status: small files in
// the task's runtime folder, one folder per agent session, each written whole. Nothing here reads
// them back to decide anything (read.ts does, for the App and the band), and nothing here ever
// fails the caller: a hook that throws would stop the agent's tool call.
//
//   live/owner.json                 the session that works on the step (its latest workflow call)
//   live/cli.json                   the latest `qualitylayer` call for the task
//   live/errors.json                a refusal of QualityLayer's own, and how often it came in a row
//   live/<session>/hook.json        the session's latest hook: when, which event, its words, how a turn ended
//   live/<session>/process.json     the agent's process (the hook's parent) and its transcript
//   live/<session>/open/<id>.json   a tool call that started (PreToolUse) and has not finished
//   live/<session>/agents/<id>.json a subagent it started, and when it stopped
//
// A session is known by the key of its id (task/binding.ts), never by the raw id.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { basename, isAbsolute, join, normalize, sep } from "node:path"
import type { Ctx, HarnessError, Result } from "../../ctx.ts"
import agentsJson from "../agents/agents.json" with { type: "json" }
import {
  isCompressedRollout,
  isRollout,
  isRolloutOf,
  oncePerSession,
} from "../agents/codex-rollout.ts"
import { detectAgent, sessionIdentity, sessionVariables } from "../agents/detect.ts"
import { BINARIES, NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"
import {
  antigravityBrainDirectory,
  copilotSessionsDirectory,
  cursorProjectsDirectory,
  grokSessionsDirectory,
  piSessionDirectory,
} from "../agents/storage.ts"
import { nativePlanReceipt, recordNativePlan } from "../conversation/native-plan.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import { homeVariable, windows } from "../platform.ts"
import { recordRunHook } from "../run/bind.ts"
import { readRun } from "../run/registry.ts"
import { pidAlive } from "../self.ts"
import { isArchived } from "../task/archive.ts"
import { boundSlug, keyOf, sessionKey, WORKFLOW_OWNER_COMMANDS } from "../task/binding.ts"
import { observedTarget } from "../task/bound-target.ts"
import { loadTask, resolveTask } from "../task/store.ts"
import { recentWindowsProcesses } from "../windows-processes.ts"
import type { EndKind } from "./liveness.ts"
import { recordTodo } from "./todo.ts"

export const LIVE_DIR = "live"

/** The fields of a hook's JSON that the live status reads. Claude Code and Codex share them. */
export type HookPayload = {
  hook_event_name?: unknown
  session_id?: unknown
  cwd?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: unknown
  tool_response?: unknown
  is_error?: unknown
  transcript_path?: unknown
  agent_id?: unknown
  agent_type?: unknown
  notification_type?: unknown
  message?: unknown
  reason?: unknown
  turn_id?: unknown
  permission_mode?: unknown
}

export type HookRow = {
  at: number
  event: string
  agent: string | null
  /** What the hook saw, short: "bun test started", "read client.ts". */
  words: string
  /** Set when this hook ended the turn or the session, or waits on a permission prompt. */
  end?: EndKind
  run?: { id: string; generation: number }
}

export type OpenTool = { at: number; words: string }
export type ProcessRow = {
  pid: number
  agent: string | null
  transcript: string | null
  at: number
  /** Native id for the client's resume command; folder names remain hashed. */
  sessionId?: string | null
}
export type SubagentRow = { id: string; words: string; started: number; stopped: number | null }
export type OwnerRow = { key: string; at: number }
export type CliRow = { at: number; command: string }
/** A refusal of QualityLayer's own: its kind (command and code), its words, and how many in a row. */
export type ErrorRow = {
  kind: string
  lead: string
  words: string
  count: number
  /** How many errors the latest refusal named (one for a refusal without a list). */
  errors?: number
  at: number
  /** The first of the row. */
  since: number
}

export const liveDir = (runtimeDir: string) => join(runtimeDir, LIVE_DIR)

export async function workflowOwnerKey(
  ctx: Ctx,
  task: { runtimeDir: string },
): Promise<string | null> {
  const owner = await readJson<OwnerRow>(ctx, join(liveDir(task.runtimeDir), "owner.json"))
  return owner && /^[a-f0-9]{16}$/.test(owner.key) ? owner.key : null
}
export const sessionDir = (runtimeDir: string, key: string) => join(runtimeDir, LIVE_DIR, key)

const str = (value: unknown): string => (typeof value === "string" ? value : "")
const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** A file name from a tool call id: only the characters a name may hold. */
const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)

/** Up to `max` characters of one line, cut at a word. */
function cut(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const head = flat.slice(0, max - 1)
  const space = head.lastIndexOf(" ")
  return `${space > max / 2 ? head.slice(0, space) : head}…`
}

/** A shell command as a hook hands it: a string, or Codex's argument list (`bash -lc "<cmd>"`). */
function commandOf(input: Record<string, unknown>): string {
  const raw = input.command ?? input.cmd
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) {
    const parts = raw.map(String)
    const lc = parts.findIndex((p) => p === "-lc" || p === "-c")
    return lc >= 0 && parts[lc + 1] !== undefined ? (parts[lc + 1] as string) : parts.join(" ")
  }
  return ""
}

/** Environment values and executable folders are setup, not the work shown in the App. */
function displayCommand(raw: string): string {
  let command = raw.trim()
  const assignment = /^[A-Za-z_]\w*=(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s;]*)(?:\s+|;\s*|$)/
  for (;;) {
    command = command.replace(/^(?:env|export)\s+(?=[A-Za-z_]\w*=)/, "")
    const found = assignment.exec(command)
    if (found === null) break
    command = command.slice(found[0].length).replace(/^(?:&&|;)\s*/, "")
  }
  const first = /^(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(command)
  const executable = first?.[1] ?? first?.[2] ?? first?.[3]
  // A shell variable cannot be named from this one call without guessing its value.
  if (first === null || executable === undefined || executable.startsWith("$")) return ""
  const name = executable.split(/[\\/]/).at(-1) ?? executable
  return name + command.slice(first[0].length)
}

/**
 * What a tool call does, in the panel's words: `now` while it runs ("Running bun test"), `done`
 * as the last sign of life a hook leaves ("bun test started", "read client.ts").
 */
export function toolWords(
  tool: string,
  input: unknown,
  phase: "start" | "end",
): { now: string; hook: string } {
  const args = asObject(input)
  const file = basename(
    str(args.file_path) || str(args.path) || str(args.filePath) || str(args.notebook_path),
  )
  const name = tool.toLowerCase()
  if (
    ["bash", "shell", "exec_command", "local_shell", "unified_exec", "powershell"].includes(name)
  ) {
    const command = cut(displayCommand(commandOf(args)), 60)
    if (command === "") return { now: "Running a command", hook: "a command" }
    return {
      now: `Running ${command}`,
      hook: `${cut(command, 40)} ${phase === "start" ? "started" : "ran"}`,
    }
  }
  if (name === "read" || name === "view_image")
    return { now: `Reading ${file || "a file"}`, hook: `read ${file || "a file"}` }
  if (["edit", "multiedit", "write", "notebookedit", "apply_patch"].includes(name))
    return { now: `Editing ${file || "files"}`, hook: `edited ${file || "files"}` }
  if (name === "grep" || name === "glob" || name === "search")
    return { now: "Searching the code", hook: "searched the code" }
  if (name === "task" || name === "agent" || name === "spawn_agent" || name === "ql_helper") {
    const what = cut(str(args.description) || str(args.prompt), 50)
    return {
      now: what !== "" ? `Starting an agent: ${what}` : "Starting an agent",
      hook: what !== "" ? `started an agent, ${what}` : "started an agent",
    }
  }
  if (name === "webfetch" || name === "websearch" || name === "web_search")
    return { now: "Looking on the web", hook: "looked on the web" }
  if (name.startsWith("todo") || name.startsWith("task") || name === "update_plan")
    return { now: "Updating its task list", hook: "updated its task list" }
  const plain = cut(tool.replace(/^mcp__/, "").replace(/_/g, " "), 40)
  return { now: plain !== "" ? `Using ${plain}` : "Using a tool", hook: plain || "a tool" }
}

/** The shells a hook may run under: the agent is the first parent that is none of these. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "tcsh", "csh", "env"])

/** The process table is an OS boundary, injectable for parent-chain probes. */
export type ProcessProbe = {
  start: number
  parent(pid: number): { pid: number; name: string } | null
}

/** One row of `ps -o pid=,ppid=,comm=`: a process, its parent and its name. */
type PsRow = { pid: number; parent: number; name: string }

function processRow(line: string): PsRow | null {
  const match = /^(\d+)\s+(\d+)\s+(\S.*)$/.exec(line.trim())
  if (match === null) return null
  const pid = Number(match[1]),
    parent = Number(match[2])
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(parent) || parent < 0)
    return null
  return { pid, parent, name: match[3] as string }
}

/** `ps` from an OS-managed folder only, with the bounds every process question keeps. */
function runPs(args: string[]): string | null {
  const command = ["/bin/ps", "/usr/bin/ps", "/run/current-system/sw/bin/ps"].find(existsSync)
  if (command === undefined) return null
  const ps = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 200,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  })
  if (ps.status !== 0 || ps.error || Buffer.byteLength(ps.stdout) > 1024 * 1024) return null
  return ps.stdout
}

function posixProcesses(): Map<number, { pid: number; name: string }> | null {
  try {
    const out = runPs(["-axo", "pid=,ppid=,comm="])
    if (out === null) return null
    const lines = out.trim().split("\n")
    if (lines.length > 32768) return null
    const records = new Map<number, { pid: number; name: string }>()
    for (const line of lines) {
      const row = processRow(line)
      if (row === null || records.has(row.pid)) return null
      records.set(row.pid, { pid: row.parent, name: row.name })
    }
    return records
  } catch {
    return null
  }
}

/**
 * One process of the OS, asked alone: `ps -p` on macOS and the BSDs, `/proc/<pid>/stat` on Linux,
 * which needs no process. The table of every process costs 30 ms and more on a busy Mac, and a walk
 * to an agent asks about two or three.
 */
function posixProcess(pid: number, procfs: boolean): PsRow | null {
  try {
    if (procfs) {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      // `pid (name) state parent …`: the name may hold spaces and parentheses, so the last one closes it.
      const open = stat.indexOf("("),
        close = stat.lastIndexOf(")")
      if (open < 1 || close < open || Number(stat.slice(0, open)) !== pid) return null
      const row = processRow(
        `${pid} ${stat.slice(close + 1).split(" ")[2]} ${stat.slice(open + 1, close)}`,
      )
      return row?.pid === pid ? row : null
    }
    const out = runPs(["-o", "pid=,ppid=,comm=", "-p", String(pid)])
    const lines = out?.trim().split("\n")
    const row = lines?.length === 1 ? processRow(lines[0] as string) : null
    return row?.pid === pid ? row : null
  } catch {
    return null
  }
}

/**
 * The same questions as `processProbe`, answered one process at a time. A walk stops at the first
 * agent, so most calls ask about two or three processes; a Linux walk starts none.
 */
export function lookupProbe(): ProcessProbe {
  if (windows) return processProbe()
  const procfs = process.platform === "linux" && existsSync("/proc/self/stat")
  return {
    start: process.ppid,
    parent: (pid) => {
      const row = posixProcess(pid, procfs)
      return row === null ? null : { pid: row.parent, name: row.name }
    },
  }
}

/** One discovery keeps one snapshot; the next call rechecks the live process names and parents. */
function processProbe(): ProcessProbe {
  let records: ReturnType<typeof posixProcesses> | undefined
  return {
    start: process.ppid,
    parent: (pid) => {
      if (windows) {
        const [records] = recentWindowsProcesses()
        const record = records.find((row) => row.pid === pid)
        return record === undefined ? null : { pid: record.ppid, name: record.name }
      }
      if (records === undefined) records = posixProcesses()
      return records?.get(pid) ?? null
    },
  }
}

/**
 * The agent above this process, found by asking about each process on the walk alone (`lookupProbe`).
 * What a hook or a workflow call does: they run on every prompt and tool call, and the table of every
 * process (the default probe of `agentProcess`) is most of what such a call costs on a busy Mac.
 */
export const ownAgentProcess = (): number | null => agentProcess(true, lookupProbe())

/**
 * A native agent ancestor, beyond shell and tool wrappers. An unverified parent cannot establish
 * that the session quit when a short-lived hook or check command exits.
 */
export function agentProcess(
  knownOnly = true,
  probe: ProcessProbe = processProbe(),
): number | null {
  let pid = probe.start
  if (pid <= 1) return null
  const seen = new Set<number>()
  for (let depth = 0; depth < 16 && pid > 1 && !seen.has(pid); depth++) {
    seen.add(pid)
    const parent = probe.parent(pid)
    if (parent === null) return knownOnly ? null : pid
    const name =
      parent.name
        .split(/[\\/]/)
        .pop()
        ?.replace(/^-/, "")
        .replace(/\.exe$/i, "")
        .toLowerCase() ?? ""
    if (Object.values(BINARIES).includes(name) || Object.hasOwn(agentsJson, name)) return pid
    if (!knownOnly && !SHELLS.has(name)) return pid
    pid = parent.pid
  }
  return knownOnly ? null : pid > 1 ? pid : null
}

function canonicalTranscript(path: string, root: string): string | null {
  try {
    const candidate = realpathSync(path)
    const directory = realpathSync(root)
    return candidate.startsWith(`${directory}${sep}`) ? candidate : null
  } catch {
    return null
  }
}

/** Where each agent keeps the transcript a hook payload names. */
const TRANSCRIPT_OWNERS: readonly (readonly [NativeAgent, RegExp])[] = [
  ["codex", /[\\/]\.codex[\\/]|[\\/]rollout-/],
  ["claude-code", /[\\/]\.claude[\\/]projects[\\/]/],
  ["cursor", /[\\/]\.cursor[\\/]projects[\\/]/],
  ["grok", /[\\/]\.grok[\\/]sessions[\\/]/],
  ["copilot", /[\\/]session-state[\\/][^\\/]+[\\/]events\.jsonl$/],
  ["antigravity", /[\\/]\.gemini[\\/]antigravity-cli[\\/]/],
]

/** What the environment names when the payload has to settle it: the two whose hooks look alike. */
const PAYLOAD_FIRST: ReadonlySet<string> = new Set(["unknown", "claude-code", "codex"])

/**
 * Which agent a payload came from. Cursor and Grok also run Claude Code's hooks, so the payload alone
 * can look like Claude's: the variables the agent sets for its hooks and the folder of its transcript
 * name it first. Codex sends a turn id and keeps its rollouts under `sessions`; Claude Code and Codex
 * are told apart by their payload before their variables.
 */
function agentOf(ctx: Ctx, payload: HookPayload): string | null {
  const native = detectAgent(ctx.env)
  if (!PAYLOAD_FIRST.has(native)) return native
  const transcript = str(payload.transcript_path)
  if (payload.turn_id !== undefined) return "codex"
  const claudeRoot = ctx.env.get("CLAUDE_CONFIG_DIR")
  if (
    claudeRoot &&
    isAbsolute(transcript) &&
    transcript.endsWith(".jsonl") &&
    canonicalTranscript(transcript, join(claudeRoot, "projects"))
  )
    return "claude-code"
  const owner = TRANSCRIPT_OWNERS.find(([, pattern]) => pattern.test(transcript))
  if (owner !== undefined) return owner[0]
  if (ctx.env.get("CODEX_THREAD_ID")?.trim()) return "codex"
  if (ctx.env.get("CLAUDE_CODE_SESSION_ID")?.trim() || ctx.env.get("CLAUDECODE")?.trim())
    return "claude-code"
  return null
}

/**
 * The transcript a payload names, only where the agent keeps its own: under Claude's configured `projects`
 * or Codex's `sessions`, a `.jsonl` file or Codex's compressed rollout. Anything else is not read, not even for its time.
 */
export function ownTranscript(ctx: Ctx, path: unknown): string | null {
  if (typeof path !== "string" || !isAbsolute(path)) return null
  if (!path.endsWith(".jsonl") && !isCompressedRollout(path)) return null
  const home = homeVariable(ctx.env)
  if (home === undefined) return null
  const clean = normalize(path)
  const codexHome = ctx.env.get("CODEX_HOME") || join(home, ".codex")
  if (isCompressedRollout(clean))
    return isRollout(clean) ? canonicalTranscript(clean, join(codexHome, "sessions")) : null
  const pi = piSessionDirectory(ctx, ctx.env.cwd())
  const roots = [
    join(ctx.env.get("CLAUDE_CONFIG_DIR") || join(home, ".claude"), "projects"),
    join(codexHome, "sessions"),
    ...[
      pi,
      cursorProjectsDirectory(ctx),
      grokSessionsDirectory(ctx),
      copilotSessionsDirectory(ctx),
      antigravityBrainDirectory(ctx),
    ].filter((dir): dir is string => dir !== null),
  ]
  return roots.map((root) => canonicalTranscript(clean, root)).find((path) => path !== null) ?? null
}

/** The task a session works on in this checkout: only one it is bound to, or the one named. */
async function boundTask(
  ctx: Ctx,
  key: string | null,
): Promise<{ repo: RepoRef; slug: string; runtimeDir: string } | null> {
  if (key !== null) {
    const target = await observedTarget(ctx, key)
    if (target.kind === "blocked") return null
    if (target.kind === "bound") {
      const task = await loadTask(ctx, target.repo, target.slug)
      return task && !(await isArchived(ctx, task))
        ? { repo: target.repo, slug: task.slug, runtimeDir: task.runtimeDir }
        : null
    }
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  const named = ctx.env.get("QUALITYLAYER_TASK")
  const slug =
    named !== undefined && named !== ""
      ? named
      : key !== null
        ? boundSlug(ctx, repo.data.id, key)
        : null
  if (slug === null) return null
  const task = await loadTask(ctx, repo.data, slug)
  if (!task || (await isArchived(ctx, task))) return null
  return { repo: repo.data, slug, runtimeDir: task.runtimeDir }
}

async function readJson<T>(ctx: Ctx, path: string): Promise<T | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as T
  } catch {
    return null
  }
}

const write = (ctx: Ctx, path: string, value: unknown) =>
  ctx.fs.atomicWrite(path, `${JSON.stringify(value)}\n`)

/** How a hook ends the turn, if it does. */
function endOf(event: string, payload: HookPayload): EndKind | undefined {
  if (event === "SessionEnd") return "session-end"
  if (event === "Stop") return "turn-end"
  if (event === "PermissionRequest") return "permission"
  if (event === "Notification") {
    const kind = str(payload.notification_type)
    if (
      kind === "permission_prompt" ||
      (kind === "" && /needs your permission to use/i.test(str(payload.message)))
    )
      return "permission"
    if (
      kind === "idle_prompt" ||
      (kind === "" && /waiting for your input/i.test(str(payload.message)))
    )
      return "turn-end"
  }
  return undefined
}

/**
 * One hook of an agent: what it did, when, and for a tool call whether it is still running. Only
 * for the task the session is bound to (or the one named by QUALITYLAYER_TASK): a session that
 * never ran QualityLayer for a task leaves nothing on it. Never throws.
 */
export async function recordHook(
  ctx: Ctx,
  payload: HookPayload,
  fallbackEvent: string,
  pidOf: () => number | null = ownAgentProcess,
  runRecorded = false,
): Promise<void> {
  try {
    if (!runRecorded) await recordRunHook(ctx, payload, fallbackEvent)
    const event = str(payload.hook_event_name) || fallbackEvent
    const end = endOf(event, payload)
    if (event === "Notification" && end === undefined) return
    const id = str(payload.session_id)
    const runId = ctx.env.get("QUALITYLAYER_RUN")
    const run = runId ? readRun(ctx.home, runId) : null
    const key = id !== "" ? keyOf(id) : sessionKey(ctx.env)
    if (key === null) return
    const task = await boundTask(ctx, key)
    if (task === null) return
    const now = ctx.clock.now()
    const dir = sessionDir(task.runtimeDir, key)
    await ctx.fs.mkdir(dir)
    const agent = agentOf(ctx, payload)
    let observedPid: number | null | undefined
    const processPid = () => {
      if (observedPid === undefined) observedPid = pidOf()
      return observedPid
    }
    if (
      !run &&
      agent === "codex" &&
      nativePlanReceipt(payload, fallbackEvent) &&
      processPid() !== null
    )
      await recordNativePlan(ctx, payload, fallbackEvent)
    const tool = str(payload.tool_name)
    const call = safeName(str(payload.tool_use_id))
    let words = ""
    if (event === "PreToolUse" && tool !== "") {
      const said = toolWords(tool, payload.tool_input, "start")
      words = said.hook
      if (call !== "") {
        await ctx.fs.mkdir(join(dir, "open"))
        await write(ctx, join(dir, "open", `${call}.json`), {
          at: now,
          words: said.now,
        } satisfies OpenTool)
      }
    } else if ((event === "PostToolUse" || event === "PostToolUseFailure") && tool !== "") {
      words = toolWords(tool, payload.tool_input, "end").hook
      if (call !== "") await ctx.fs.remove(join(dir, "open", `${call}.json`))
    } else if (event === "SubagentStart" || event === "SubagentStop") {
      const agentId = safeName(str(payload.agent_id))
      const type = str(payload.agent_type)
      words =
        event === "SubagentStart"
          ? `started an agent${type !== "" ? `, ${type}` : ""}`
          : "an agent finished"
      if (agentId !== "") {
        await ctx.fs.mkdir(join(dir, "agents"))
        const path = join(dir, "agents", `${agentId}.json`)
        const before = await readJson<SubagentRow>(ctx, path)
        await write(ctx, path, {
          id: agentId,
          words: before?.words ?? (type !== "" ? type : "an agent"),
          started: before?.started ?? now,
          stopped: event === "SubagentStop" ? now : null,
        } satisfies SubagentRow)
      }
    } else if (end === "permission") {
      words = "asks for permission"
    } else if (end === "session-end") {
      words = "the session ended"
    } else if (end === "turn-end") {
      words = "its turn ended"
    } else if (event === "UserPromptSubmit") {
      words = "you wrote to it"
    }
    // A turn or a session that ended runs no tool any more.
    if (end === "turn-end" || end === "session-end") await ctx.fs.remove(join(dir, "open"))
    await write(ctx, join(dir, "hook.json"), {
      at: now,
      event,
      agent,
      words,
      ...(end !== undefined ? { end } : {}),
      ...(run?.nativeSession === id ? { run: { id: run.id, generation: run.generation } } : {}),
    } satisfies HookRow)
    // A task list the agent reports (todo.ts decides which agents and calls carry one).
    await recordTodo(ctx, dir, now, agent, event, payload)
    // The process and the transcript are looked up once per session, or again when they change.
    const known = await readJson<ProcessRow>(ctx, join(dir, "process.json"))
    const transcript =
      ownTranscript(ctx, payload.transcript_path) ?? ownTranscript(ctx, known?.transcript)
    // A resumed native session keeps its id and transcript, but belongs to a new process.
    // Look again at session/turn entry, without adding a process walk to every tool hook.
    const entered = event === "SessionStart" || event === "UserPromptSubmit" ? processPid() : null
    if (
      known === null ||
      (id !== "" && known.sessionId !== id) ||
      known.transcript !== transcript ||
      (entered !== null && entered !== known.pid)
    ) {
      const pid = entered ?? known?.pid ?? processPid()
      if (pid !== null)
        await write(ctx, join(dir, "process.json"), {
          pid,
          agent: agent ?? known?.agent ?? null,
          transcript,
          at: now,
          sessionId: id || known?.sessionId || null,
        } satisfies ProcessRow)
    }
    // A step nobody has claimed yet belongs to the first session that shows a sign of life.
    const ownerPath = join(liveDir(task.runtimeDir), "owner.json")
    if ((await readJson<OwnerRow>(ctx, ownerPath)) === null)
      await write(ctx, ownerPath, { key, at: now } satisfies OwnerRow)
  } catch {
    // The agent's tool call goes on whatever this finds.
  }
}

async function names(ctx: Ctx, dir: string): Promise<string[]> {
  try {
    return (await ctx.fs.readdir(dir)).sort().reverse()
  } catch {
    return []
  }
}

/**
 * The transcript of the session running this command, found once: Claude Code keeps it under
 * `projects/<the directory, every other character a dash>/<id>.jsonl`, Codex under
 * `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl[.zst]` (newest days first, a week back at most).
 */
async function transcriptOf(ctx: Ctx): Promise<{ agent: string; path: string | null } | null> {
  const home = homeVariable(ctx.env)
  const ownSession = sessionIdentity(ctx.env)
  if (ownSession?.agent === "opencode") return { agent: "opencode", path: null }
  const pi = ownSession?.agent === "pi" ? ownSession.id : null
  if (pi) {
    const root = piSessionDirectory(ctx, ctx.env.cwd())
    const file =
      root && /^[A-Za-z0-9_-]{1,128}$/.test(pi)
        ? (await names(ctx, root)).find((name) => name.endsWith(`_${pi}.jsonl`))
        : null
    return { agent: "pi", path: root && file ? join(root, file) : null }
  }
  const claude = ownSession?.agent === "claude-code" ? ownSession.id : null
  const codex = ownSession?.agent === "codex" ? ownSession.id : null
  if (claude) {
    if (home === undefined || !/^[A-Za-z0-9_-]+$/.test(claude))
      return { agent: "claude-code", path: null }
    const projects = join(ctx.env.get("CLAUDE_CONFIG_DIR") || join(home, ".claude"), "projects")
    const own = join(projects, ctx.env.cwd().replace(/[^a-zA-Z0-9]/g, "-"), `${claude}.jsonl`)
    if (await ctx.fs.exists(own)) return { agent: "claude-code", path: own }
    for (const dir of await names(ctx, projects)) {
      const file = join(projects, dir, `${claude}.jsonl`)
      if (await ctx.fs.exists(file)) return { agent: "claude-code", path: file }
    }
    return { agent: "claude-code", path: null }
  }
  if (codex) {
    if (home === undefined || !/^[A-Za-z0-9_-]+$/.test(codex)) return { agent: "codex", path: null }
    const sessions = join(ctx.env.get("CODEX_HOME") || join(home, ".codex"), "sessions")
    let days = 0
    for (const year of await names(ctx, sessions))
      for (const month of await names(ctx, join(sessions, year)))
        for (const day of await names(ctx, join(sessions, year, month))) {
          if (days++ >= 7) return { agent: "codex", path: null }
          const dir = join(sessions, year, month, day)
          const found = oncePerSession(await names(ctx, dir), (name) => name).find((name) =>
            isRolloutOf(name, codex),
          )
          if (found !== undefined) return { agent: "codex", path: join(dir, found) }
        }
    return { agent: "codex", path: null }
  }
  // The agents with a hook file hand their commands a session id of their own (Copilot: none).
  const own = ownSession?.agent
  if (own === "cursor" || own === "grok" || own === "antigravity" || own === "copilot") {
    const { ownRecordPath } = await import("../conversation/locate.ts")
    return { agent: own, path: ownRecordPath(ctx, own, ctx.env.cwd(), ownSession!.id) }
  }
  return null
}

/** The variable holding the session id of the agent running a command, else Claude Code's. */
const sessionOf = (ctx: Ctx, agent: string | null): string | undefined => {
  const named = NATIVE_AGENTS.find((id) => id === agent)
  if (named === undefined) return ctx.env.get("CLAUDE_CODE_SESSION_ID")
  for (const variable of sessionVariables(named)) {
    const value = ctx.env.get(variable)
    if (value) return value
  }
  return undefined
}

/** Every CLI call identifies its current client, replacing old shell and resumed-process records. */
async function noteProcess(ctx: Ctx, dir: string, now: number, pid: number | null): Promise<void> {
  const known = await readJson<ProcessRow>(ctx, join(dir, "process.json"))
  if (pid === null) return
  if (known !== null && known.pid === pid && pidAlive(known.pid)) {
    const sessionId = sessionOf(ctx, known.agent)
    const transcript = ownTranscript(ctx, known.transcript)
    if ((!known.sessionId && sessionId) || known.transcript !== transcript)
      await write(ctx, join(dir, "process.json"), {
        ...known,
        transcript,
        sessionId: known.sessionId || sessionId || null,
      })
    return
  }
  const found = await transcriptOf(ctx)
  await ctx.fs.mkdir(dir)
  await write(ctx, join(dir, "process.json"), {
    pid,
    agent: found?.agent ?? known?.agent ?? null,
    transcript: ownTranscript(ctx, found?.path) ?? ownTranscript(ctx, known?.transcript),
    at: now,
    sessionId:
      found === null
        ? (known?.sessionId ?? null)
        : (sessionOf(ctx, found.agent) ?? known?.sessionId ?? null),
  } satisfies ProcessRow)
}

/**
 * The commands a session runs when it is the one working on the step: the latest of them makes it
 * the owner. A helper's own calls (`progress`, `verdict`, a task's check) keep the task alive but
 * never take the step over.
 */
const OWNER_COMMANDS = WORKFLOW_OWNER_COMMANDS
/**
 * `build start` is the session taking the approved Plan's build: it owns the step from then on, also
 * when the planner that owned it before has ended (a fresh build session in the App, 11 November
 * 2026: the row said Stopped early while the build ran). A helper never runs it.
 */
const takesOwnership = (command: string, args: string[]): boolean =>
  OWNER_COMMANDS.has(command) || (command === "build" && args[0] === "start")

/** QualityLayer's own refusals, which the agent is expected to fix: a second one in a row needs the person. */
const REFUSALS = new Set<HarnessError["code"]>([
  "validation_failed",
  "illegal_transition",
  "state_mismatch",
  "wrong_checkout",
])

/** What a refusal is called on the pill: "Plan refused", "Verify refused", "Step refused". */
function refusalLead(command: string, args: string[]): string {
  const target = args[1] ?? ""
  if (command === "gate" && args[0] === "open") {
    if (/plan/i.test(target)) return "Plan refused"
    if (target === "final") return "Verify refused"
  }
  if (command === "check") return "A check was refused"
  return `${command.charAt(0).toUpperCase()}${command.slice(1)} refused`
}

/** The first thing a refusal names, short. */
function refusalWords(error: HarnessError): string {
  if (error.code === "validation_failed" && error.errors.length > 0)
    return cut(
      (error.errors.find((e) => e.severity === "error") ?? error.errors[0])?.message ?? "",
      80,
    )
  return cut(error.message, 80)
}

/** How many errors a refusal names; a warning is not one, and a refusal without a list names one. */
function refusalErrors(error: HarnessError): number {
  return error.code === "validation_failed"
    ? Math.max(1, error.errors.filter((e) => e.severity === "error").length)
    : 1
}

/**
 * A `qualitylayer` call for the open task: it keeps the task alive, a workflow call makes its
 * session the step's owner, and a refusal of QualityLayer's own is counted, so a second one of the
 * same kind in a row goes to the person. Never throws.
 */
export async function recordCall(
  ctx: Ctx,
  command: string,
  args: string[],
  result: Result<unknown>,
  pidOf: () => number | null = ownAgentProcess,
): Promise<void> {
  try {
    const pid = pidOf()
    const key = sessionKey(ctx.env) ?? (pid !== null ? keyOf(`process:${pid}`) : null)
    const bound = await boundTask(ctx, key)
    let runtimeDir = bound?.runtimeDir ?? null
    if (runtimeDir === null) {
      const repo = await resolveRepo(ctx)
      if (!repo.ok) return
      const task = await resolveTask(ctx, repo.data)
      if (task === null || (await isArchived(ctx, task))) return
      runtimeDir = task.runtimeDir
    }
    const dir = liveDir(runtimeDir)
    await ctx.fs.mkdir(dir)
    const now = ctx.clock.now()
    // A word of the command line names the call only when it is a plain token, never free text.
    const token = (word: string | undefined) =>
      word !== undefined && /^[A-Za-z0-9._/-]{1,24}$/.test(word) && !word.startsWith("-")
        ? word
        : null
    const base = [command, token(args[0])].filter((w) => w !== null).join(" ")
    await write(ctx, join(dir, "cli.json"), { at: now, command: base } satisfies CliRow)
    if (
      !ctx.visitsTask &&
      key !== null &&
      pid !== null &&
      (takesOwnership(command, args) ||
        (await readJson<OwnerRow>(ctx, join(dir, "owner.json"))) === null)
    )
      await write(ctx, join(dir, "owner.json"), { key, at: now } satisfies OwnerRow)
    // Without the hooks installed, the call still names the agent's process and its transcript.
    if (key !== null) await noteProcess(ctx, join(dir, key), now, pid)
    const errorsPath = join(dir, "errors.json")
    if (!result.ok && REFUSALS.has(result.error.code)) {
      const target = token(args[1])
      const kind = `${base}${target !== null ? ` ${target}` : ""}:${result.error.code}`
      const before = await readJson<ErrorRow>(ctx, errorsPath)
      const again = before !== null && before.kind === kind
      await write(ctx, errorsPath, {
        kind,
        lead: refusalLead(command, args),
        words: refusalWords(result.error),
        count: again ? before.count + 1 : 1,
        errors: refusalErrors(result.error),
        at: now,
        since: again ? before.since : now,
      } satisfies ErrorRow)
    } else if (result.ok) {
      // The same command going through settles its refusal.
      const before = await readJson<ErrorRow>(ctx, errorsPath)
      if (
        before !== null &&
        (before.kind.startsWith(`${base} `) || before.kind.startsWith(`${base}:`))
      )
        await ctx.fs.remove(errorsPath)
    }
  } catch {
    // A sign of life is never worth a failed command.
  }
}
