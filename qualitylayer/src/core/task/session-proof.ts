import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { Ctx } from "../../ctx.ts"
import {
  isCompressedRollout,
  isRolloutOf,
  oncePerSession,
  readCompressed,
} from "../agents/codex-rollout.ts"
import { cursorUserMessage } from "../agents/cursor-messages.ts"
import type { NativeAgent } from "../agents/ids.ts"
import {
  antigravityBrainDirectory,
  copilotSessionsDirectory,
  cursorProjectSlug,
  cursorProjectsDirectory,
  grokSessionsDirectory,
  opencodeDatabase,
  piSessionDirectory,
} from "../agents/storage.ts"
import { canonicalPath, homeVariable } from "../platform.ts"

export type SessionAnswer = { question: string; answer: string; labels?: string[]; notes?: string }
export type SessionProof = {
  agent: NativeAgent
  session: string
  callId: string
  recordedAt: number
  input: unknown
  answers: SessionAnswer[]
  completionDigest?: string
}
export type SessionRequest = { agent: NativeAgent; session: string; cwd?: string }
export type UserMessageProof = SessionRequest & { recordedAt: number; prompt: string }

const MAX_BYTES = 8 * 1024 * 1024
const HEADER_BYTES = 1024 * 1024
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const safe = (id: string) => /^[A-Za-z0-9_.-]{1,128}$/.test(id)
const stamp = (value: unknown): number | null => {
  const at = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN
  return Number.isFinite(at) && at > 0 ? at : null
}
const contentText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((p) => object(p)?.text ?? "").join("\n")
      : ""
const parse = (value: unknown): unknown => {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function sessionInputDigest(input: unknown): string {
  const raw = JSON.stringify(input)
  if (!raw || Buffer.byteLength(raw) > 128 * 1024)
    throw new Error("Native picker input exceeds its bound")
  let nodes = 0
  const ordered = (value: unknown, depth = 0): unknown => {
    if (++nodes > 4096 || depth > 16) throw new Error("Native picker input is too deeply nested")
    if (Array.isArray(value)) return value.map((part) => ordered(part, depth + 1))
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, part]) => [key, ordered(part, depth + 1)]),
      )
    return value
  }
  return createHash("sha256")
    .update(JSON.stringify(ordered(input)))
    .digest("hex")
}

/** Claude completion hooks include these two result fields beside the original questions. */
export function pickerCallInput(agent: NativeAgent, input: unknown): unknown {
  const value = object(input)
  return agent === "claude-code" &&
    value &&
    Object.keys(value).length === 3 &&
    Array.isArray(value.questions) &&
    object(value.answers) &&
    object(value.annotations)
    ? { questions: value.questions }
    : input
}
function labelsOf(value: unknown, options: string[]): string[] | null {
  if (Array.isArray(value))
    return value.length && value.every((v) => typeof v === "string" && v.trim()) ? [...value] : null
  if (object(value)) return labelsOf(object(value)?.answers, options)
  if (typeof value !== "string" || !value.trim()) return null
  const matches: string[][] = []
  let budget = 256
  const visit = (remaining: string, chosen: string[]) => {
    if (--budget < 0 || matches.length > 1) return
    for (const label of options) {
      if (chosen.includes(label)) continue
      if (remaining === label) matches.push([...chosen, label])
      else if (remaining.startsWith(`${label}, `))
        visit(remaining.slice(label.length + 2), [...chosen, label])
    }
  }
  visit(value, [])
  if (budget < 0 || matches.length > 1) return null
  return matches[0] ?? [value]
}

function quotedField(value: string): string | null {
  try {
    return JSON.parse(`"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`) as string
  } catch {
    return null
  }
}

/** Decode only answers to questions actually present in the recorded call. */
export function sessionAnswers(input: unknown, result: unknown): SessionAnswer[] {
  const questions = object(input)?.questions
  if (!Array.isArray(questions) || questions.length === 0) return []
  const texts = new Map<string, string>()
  const choices = new Map<string, string[]>()
  for (const q of questions) {
    const entry = object(q)
    if (typeof entry?.question !== "string") return []
    texts.set(entry.question, entry.question)
    choices.set(
      entry.question,
      Array.isArray(entry.options)
        ? [
            ...new Set(
              entry.options.flatMap((option) =>
                typeof object(option)?.label === "string" ? [object(option)?.label as string] : [],
              ),
            ),
          ]
        : [],
    )
    if (typeof entry.id === "string") texts.set(entry.id, entry.question)
  }
  const body = parse(result)
  const answers = object(object(body)?.answers)
  const notes = object(object(body)?.annotations)
  const picked: SessionAnswer[] = []
  if (answers !== null) {
    for (const [key, value] of Object.entries(answers)) {
      const question = texts.get(key)
      const labels = labelsOf(value, choices.get(question ?? "") ?? [])
      if (question === undefined || labels === null) return []
      const note = object(notes?.[question])?.notes
      picked.push({
        question,
        answer: labels.join(", "),
        labels,
        ...(typeof note === "string" && note !== "" ? { notes: note } : {}),
      })
    }
    return picked
  }
  if (typeof body !== "string") return []
  let consumed = 0
  for (const pair of body.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) {
    if (body.slice(consumed, pair.index).includes('"')) return []
    const key = quotedField(pair[1] ?? "")
    const answer = quotedField(pair[2] ?? "")
    if (key === null || answer === null) return []
    const question = texts.get(key)
    if (
      question === undefined ||
      answer.trim() === "" ||
      picked.some((item) => item.question === question)
    )
      return []
    const labels = labelsOf(answer, choices.get(question) ?? [])
    if (!labels) return []
    picked.push({ question, answer, labels })
    consumed = pair.index + pair[0].length
  }
  return body.slice(consumed).includes('"') ? [] : picked
}

async function names(ctx: Ctx, dir: string): Promise<string[]> {
  try {
    const found = await ctx.fs.readdir(dir)
    return found.sort().reverse()
  } catch {
    return []
  }
}

async function sameCheckout(ctx: Ctx, recorded: unknown, requested: string): Promise<boolean> {
  if (typeof recorded !== "string" || !isAbsolute(recorded) || !isAbsolute(requested)) return false
  const own = canonicalPath(recorded, true)
  const current = canonicalPath(requested, true)
  if (own === current) return true
  const [ownRoot, currentRoot] = await Promise.all([
    ctx.git.topLevel(own),
    ctx.git.topLevel(current),
  ])
  if (!ownRoot || !currentRoot) return false
  const root = canonicalPath(ownRoot, true)
  const inside = (path: string) => {
    const part = relative(root, path)
    return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`)
  }
  return root === canonicalPath(currentRoot, true) && inside(own) && inside(current)
}

/**
 * Grok's record of a session, `sessions/<URL-encoded checkout>/<id>/updates.jsonl`, Cursor's
 * `projects/<checkout>/agent-transcripts/<id>/<id>.jsonl`, or Antigravity's full transcript under
 * `brain/<id>`; undefined for any other agent. The id is unique across folders, so a checkout it
 * was moved from (or that Cursor gave a shortened folder name) still finds it.
 */
async function ownRecord(ctx: Ctx, request: SessionRequest): Promise<string | undefined> {
  const { agent, session } = request
  const brain = antigravityBrainDirectory(ctx)
  const sessions = grokSessionsDirectory(ctx)
  const cursor = cursorProjectsDirectory(ctx)
  const candidates: string[] = []
  if (agent === "cursor" && cursor !== null)
    for (const folder of [
      cursorProjectSlug(request.cwd ?? ctx.env.cwd()),
      ...(await names(ctx, cursor)),
    ])
      candidates.push(join(cursor, folder, "agent-transcripts", session, `${session}.jsonl`))
  if (agent === "antigravity" && brain !== null)
    for (const name of ["transcript_full.jsonl", "transcript.jsonl"])
      candidates.push(join(brain, session, ".system_generated", "logs", name))
  const copilot = copilotSessionsDirectory(ctx)
  if (agent === "copilot" && copilot !== null)
    candidates.push(join(copilot, session, "events.jsonl"))
  if (agent === "grok" && sessions !== null)
    for (const folder of [
      encodeURIComponent(request.cwd ?? ctx.env.cwd()),
      ...(await names(ctx, sessions)),
    ])
      candidates.push(join(sessions, folder, session, "updates.jsonl"))
  for (const file of candidates) if (await ctx.fs.exists(file)) return file
  return undefined
}

async function transcript(ctx: Ctx, request: SessionRequest): Promise<string | null> {
  const home = homeVariable(ctx.env)
  if (!home || !safe(request.session)) return null
  const { agent, session } = request
  const cwd = request.cwd ?? ctx.env.cwd()
  let file = await ownRecord(ctx, request)
  if (agent === "claude-code") {
    const projects = join(ctx.env.get("CLAUDE_CONFIG_DIR") || join(home, ".claude"), "projects")
    const own = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${session}.jsonl`)
    if (await ctx.fs.exists(own)) file = own
    else
      for (const dir of await names(ctx, projects)) {
        const candidate = join(projects, dir, `${session}.jsonl`)
        if (await ctx.fs.exists(candidate)) {
          file = candidate
          break
        }
      }
  } else if (agent === "pi") {
    const dir = piSessionDirectory(ctx, cwd)
    if (dir) {
      const own = (await names(ctx, dir)).filter((name) => name.endsWith(`_${session}.jsonl`))
      if (own.length > 1) return null
      if (own.length === 1) file = join(dir, own[0] as string)
      const directories = [dir]
      if (!file && !ctx.env.get("PI_CODING_AGENT_SESSION_DIR"))
        for (const name of await names(ctx, dirname(dir))) {
          const candidate = join(dirname(dir), name)
          if (candidate !== dir) directories.push(candidate)
        }
      for (const candidate of directories.slice(1)) {
        const found = (await names(ctx, candidate)).filter((name) =>
          name.endsWith(`_${session}.jsonl`),
        )
        if (found.length > 1 || (found.length === 1 && file)) return null
        if (found.length === 1) file = join(candidate, found[0] as string)
      }
    }
  } else if (agent === "codex") {
    const sessions = join(ctx.env.get("CODEX_HOME") || join(home, ".codex"), "sessions")
    search: for (const year of await names(ctx, sessions)) {
      for (const month of await names(ctx, join(sessions, year))) {
        for (const day of await names(ctx, join(sessions, year, month))) {
          const dir = join(sessions, year, month, day)
          const found = oncePerSession(
            (await names(ctx, dir)).filter((name) => isRolloutOf(name, session)),
            (name) => name,
          )
          if (found.length > 1) return null
          if (found.length === 1) {
            file = join(dir, found[0] as string)
            break search
          }
        }
      }
    }
  }
  if (!file) return null
  if (isCompressedRollout(file)) {
    const bytes = await readCompressed(file)
    if (bytes === null) return null
    return framedRecord(agent, bytes.length, async (offset, length) =>
      bytes.subarray(offset, offset + length).toString("utf8"),
    )
  }
  const info = await ctx.fs.stat?.(file)
  if (!info) return null
  return framedRecord(
    agent,
    info.size,
    ctx.fs.readRange
      ? async (offset, length) => (await ctx.fs.readRange?.(file, offset, length)) ?? ""
      : undefined,
    () => ctx.fs.readFile(file),
  )
}

/** A record within `MAX_BYTES`: whole, or its identity rows and its last bytes. */
async function framedRecord(
  agent: string,
  size: number,
  range: ((offset: number, length: number) => Promise<string>) | undefined,
  whole?: () => Promise<string>,
): Promise<string | null> {
  if (size > MAX_BYTES) {
    if (!range) return null
    const head = await range(0, HEADER_BYTES)
    const tail = await range(size - MAX_BYTES + HEADER_BYTES, MAX_BYTES - HEADER_BYTES)
    // Only complete rows are evidence; the window edges can cut through JSON or UTF-8.
    const headerRows = head
      .slice(0, head.lastIndexOf("\n") + 1)
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => object(JSON.parse(line)))
    if (!headerRows.length) return null
    const identity =
      agent === "claude-code"
        ? headerRows.map((row) => ({ sessionId: row?.sessionId }))
        : headerRows.filter(
            (row) =>
              row?.type === "session" ||
              row?.type === "session_meta" ||
              row?.type === "session.start",
          )
    return `${identity.map((row) => JSON.stringify(row)).join("\n")}\n${JSON.stringify({ type: "qualitylayer_omitted_prefix" })}\n${tail.slice(tail.indexOf("\n") + 1, tail.lastIndexOf("\n") + 1)}`
  }
  const text = range ? await range(0, MAX_BYTES + 1) : ((await whole?.()) ?? "")
  return Buffer.byteLength(text) > MAX_BYTES ? null : text
}

type Row = Record<string, unknown>

/**
 * Whether Grok's, Cursor's or Antigravity's rows are the session's, or null for another agent.
 * Grok's rows name it, as Copilot's `session.start` row does; Cursor's and Antigravity's folder does.
 */
function nativeRowsMatch(request: SessionRequest, rows: Row[]): boolean | null {
  if (request.agent === "copilot")
    return rows.some(
      (row) => row.type === "session.start" && object(row.data)?.sessionId === request.session,
    )
  if (request.agent === "grok")
    return (
      rows.length > 0 &&
      rows.every((row) => {
        const id = object(row.params)?.sessionId
        return id === undefined || id === request.session
      })
    )
  return request.agent === "antigravity" || request.agent === "cursor" ? rows.length > 0 : null
}

/** Whether Claude Code's rows carry the session's id, or the others' first row names it and this checkout. */
async function headRowsMatch(ctx: Ctx, request: SessionRequest, rows: Row[]): Promise<boolean> {
  if (request.agent === "claude-code")
    return (
      rows.length > 0 &&
      rows.every((row) => row.sessionId === undefined || row.sessionId === request.session) &&
      rows.some((row) => row.sessionId === request.session)
    )
  const first = rows[0]
  const meta =
    request.agent === "pi" && first?.type === "session"
      ? first
      : first?.type === "session_meta"
        ? object(first.payload)
        : null
  return (
    meta?.id === request.session &&
    (await sameCheckout(ctx, meta.cwd, request.cwd ?? ctx.env.cwd()))
  )
}

async function records(ctx: Ctx, request: SessionRequest): Promise<Row[] | null> {
  if (!safe(request.session)) return null
  if (request.agent === "opencode") {
    const file = opencodeDatabase(ctx)
    if (!file || !(await ctx.fs.exists(file))) return null
    let db: Database | undefined
    try {
      db = new Database(file, { readonly: true })
      db.exec("BEGIN")
      const session = db
        .query("SELECT directory FROM session_v2 WHERE id = ? LIMIT 1")
        .get(request.session) as { directory: unknown } | null
      if (!session || !(await sameCheckout(ctx, session.directory, request.cwd ?? ctx.env.cwd())))
        return null
      const budget = db
        .query(
          "SELECT SUM(bytes) AS bytes FROM (SELECT length(CAST(data AS BLOB)) AS bytes FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 512)",
        )
        .get(request.session) as { bytes: number | null } | null
      if (budget?.bytes === null || budget?.bytes === undefined || budget.bytes > MAX_BYTES)
        return null
      const rows = db
        .query(
          "SELECT type, time_created, data, length(CAST(data AS BLOB)) AS bytes FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 512",
        )
        .all(request.session) as Row[]
      return rows.reverse().map((row) => ({ ...row, payload: JSON.parse(row.data as string) }))
    } finally {
      db?.close()
    }
  }
  const text = await transcript(ctx, request)
  if (!text) return null
  const rows: Row[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const row = object(JSON.parse(line))
    if (!row) return null
    rows.push(row)
  }
  return (nativeRowsMatch(request, rows) ?? (await headRowsMatch(ctx, request, rows))) ? rows : null
}

/** `questions` is the call in the common `{questions:[{question, options}]}` shape when `input` is not. */
type Call = { input: unknown; result?: unknown; recordedAt: number | null; questions?: unknown }
function completed(call: Call | null, result: unknown, at: unknown): Call | null {
  const ended = stamp(at)
  return call !== null && call.recordedAt !== null && ended !== null && ended >= call.recordedAt
    ? { ...call, result }
    : null
}

/** The agents whose picks are read from their own record, with no answer hook to name the call. */
const RECORDED_PICKERS = new Set<NativeAgent>(["antigravity", "grok", "copilot"])
type NativeCall = Call & { id: string }
const NO_ANSWER = { answers: {} }

/**
 * Antigravity's `ask_question` calls: a planner step's `tool_calls`, answered by the next GENERIC
 * row (`Created At`, `Completed At`, one `A<n>: <answer>` line per question). A skipped question
 * and an answer completed the moment it was shown (an automatic one) are not the person's. The
 * call's time is when the question was shown, since the step itself began before it.
 */
function antigravityCalls(rows: Row[]): NativeCall[] {
  if (rows.some((row) => row.type === "qualitylayer_omitted_prefix")) return []
  const calls: NativeCall[] = []
  // Output rows have no call IDs. Only an isolated picker can prove a choice; overlapping
  // calls stay unattributed until all their outputs arrive, regardless of output order.
  const waiting: (NativeCall | null)[] = []
  for (const row of rows) {
    if (row.type === "PLANNER_RESPONSE") {
      const tools = Array.isArray(row.tool_calls) ? row.tool_calls : []
      const isolated = waiting.length === 0 && tools.length === 1
      if (waiting.length > 0) waiting.fill(null)
      tools.forEach((value, index) => {
        const tool = object(value)
        const asked = object(tool?.args)?.questions
        if (tool?.name !== "ask_question" || !Array.isArray(asked)) {
          waiting.push(null)
          return
        }
        const questions = asked.map((q) => {
          const options = object(q)?.options
          return {
            question: object(q)?.question,
            options: (Array.isArray(options) ? options : []).map((label) => ({ label })),
          }
        })
        const call = {
          id: `${row.step_index}:${index}`,
          input: tool.args,
          questions: { questions },
          recordedAt: stamp(row.created_at),
        }
        calls.push(call)
        waiting.push(isolated ? call : null)
      })
      continue
    }
    if (row.type !== "GENERIC") continue
    const call = waiting.shift()
    const content = typeof row.content === "string" ? row.content : ""
    // A picker's result holds the two times and one answer line per question, nothing else.
    const result = /^Created At: .+\nCompleted At: .+(?:\nA\d+: .*)+$/.test(content.trim())
    if (!call || !result) continue
    const lines = [...content.matchAll(/^A(\d+): (.*)$/gm)]
    const shown = stamp(/^Created At: (.+)$/m.exec(content)?.[1])
    const done = stamp(/^Completed At: (.+)$/m.exec(content)?.[1])
    const questions = (call.questions as { questions: { question: unknown }[] }).questions
    const answers: Record<string, string> = {}
    if (shown !== null && done !== null && done > shown)
      for (const [, n, text] of lines) {
        const question = questions[Number(n) - 1]?.question
        if (typeof question === "string" && text && text !== "User Skipped")
          answers[question] = text
      }
    const found = completed({ ...call, recordedAt: shown }, { answers }, done)
    if (found) Object.assign(call, found)
  }
  return calls
}

/**
 * Grok's `ask_user_question` calls: a `tool_call` update, then the `tool_call_update` that ends it.
 * Only `rawOutput.UserAnswered` is an answer; a question that timed out, failed or was cancelled
 * ends with none. Grok's own time is in `_meta.agentTimestampMs`, its row's in seconds.
 */
function grokCalls(rows: Row[]): NativeCall[] {
  const calls = new Map<string, NativeCall>()
  for (const row of rows) {
    const params = object(row.params)
    const update = object(params?.update)
    const id = update?.toolCallId
    if (row.method !== "session/update" || typeof id !== "string") continue
    const at =
      stamp(object(params?._meta)?.agentTimestampMs) ??
      (typeof row.timestamp === "number" ? row.timestamp * 1000 : null)
    const tool = object(object(update?._meta)?.["x.ai/tool"])
    if (
      update?.sessionUpdate === "tool_call" &&
      (tool?.name ?? update.title) === "ask_user_question"
    )
      calls.set(id, { id, input: update.rawInput, recordedAt: at })
    const call = calls.get(id)
    if (
      update?.sessionUpdate !== "tool_call_update" ||
      !call ||
      call.result !== undefined ||
      (update.status !== "completed" && update.status !== "failed")
    )
      continue
    const answered = object(object(update.rawOutput)?.UserAnswered)?.answers
    const answers: Record<string, unknown> = {}
    if (update.status === "completed" && Array.isArray(answered))
      for (const value of answered) {
        const entry = object(value)
        if (
          typeof entry?.question === "string" &&
          Array.isArray(entry.picked) &&
          entry.picked.length
        )
          answers[entry.question] = entry.picked
      }
    const found = completed(call, { answers }, at)
    if (found) calls.set(id, { ...found, id })
  }
  return [...calls.values()]
}

/**
 * Copilot's `ask_user` calls: a form (`message`, `requestedSchema` with one titled property per
 * question) started by `tool.execution_start` and answered by the person's
 * `human_response.recorded`; a call that completes without one (declined or cancelled) has none.
 */
function copilotCalls(rows: Row[]): NativeCall[] {
  const calls = new Map<string, NativeCall>()
  for (const row of rows) {
    const data = object(row.data)
    const id = data?.toolCallId
    if (typeof id !== "string") continue
    if (row.type === "tool.execution_start" && data?.toolName === "ask_user") {
      const form = object(data.arguments)
      const fields = object(object(form?.requestedSchema)?.properties) ?? {}
      const questions = Object.entries(fields).map(([key, value]) => {
        const field = object(value)
        const choices = field?.enum ?? object(field?.items)?.enum
        return {
          id: key,
          question: field?.title ?? form?.message,
          options: (Array.isArray(choices) ? choices : []).map((label) => ({ label })),
        }
      })
      calls.set(id, {
        id,
        input: data.arguments,
        questions: { questions },
        recordedAt: stamp(row.timestamp),
      })
      continue
    }
    const call = calls.get(id)
    if (!call || call.result !== undefined) continue
    const response = object(data?.response)
    const content = object(response?.content)
    if (
      row.type === "human_response.recorded" &&
      data?.actor === "human_response" &&
      response?.responseKind === "ask_user"
    ) {
      const found = completed(call, content ? { answers: content } : NO_ANSWER, row.timestamp)
      if (found) calls.set(id, { ...found, id })
    } else if (row.type === "tool.execution_complete") {
      const found = completed(call, NO_ANSWER, row.timestamp)
      if (found) calls.set(id, { ...found, id })
    }
  }
  return [...calls.values()]
}

const nativeCalls = (rows: Row[], agent: NativeAgent): NativeCall[] =>
  agent === "antigravity"
    ? antigravityCalls(rows)
    : agent === "grok"
      ? grokCalls(rows)
      : agent === "copilot"
        ? copilotCalls(rows)
        : []

/** The tool each hooked agent's picker is, as its record names it. */
const HOOKED_PICKERS: Partial<Record<NativeAgent, string>> = {
  "claude-code": "AskUserQuestion",
  codex: "request_user_input",
  pi: "ql_ask",
  opencode: "question",
}

/** The ids of the picker calls a hooked agent's record holds, oldest first. */
function hookedCallIds(rows: Row[], agent: NativeAgent): string[] {
  const name = HOOKED_PICKERS[agent]
  const ids = new Set<string>()
  for (const row of rows) {
    const p = object(row.payload)
    if (agent === "codex" && p?.type === "function_call" && p.name === name)
      if (typeof p.call_id === "string") ids.add(p.call_id)
    const parts = agent === "opencode" ? p?.content : object(row.message)?.content
    for (const value of Array.isArray(parts) ? parts : []) {
      const part = object(value)
      if (part?.name === name && typeof part?.id === "string") ids.add(part.id)
    }
  }
  return [...ids]
}

/**
 * The picker calls in an agent's own record, oldest first. Poll and wait read those of an agent
 * with no answer hook (Antigravity, Grok, Copilot); `gate decide` reads any agent's.
 */
export async function pickerCalls(
  ctx: Ctx,
  request: SessionRequest,
): Promise<{ callId: string; recordedAt: number }[]> {
  try {
    const rows = await records(ctx, request)
    if (rows === null) return []
    const calls = RECORDED_PICKERS.has(request.agent)
      ? nativeCalls(rows, request.agent)
      : hookedCallIds(rows, request.agent).map((id) => ({
          id,
          recordedAt: callIn(rows, request.agent, id)?.recordedAt ?? null,
        }))
    return calls.flatMap((call) =>
      call.recordedAt === null ? [] : [{ callId: call.id, recordedAt: call.recordedAt }],
    )
  } catch {
    return []
  }
}
function clientQuestion(part: Row): Call | null {
  const state = object(part.state),
    native = object(part.native),
    time = object(part.time)
  const questions = object(state?.input)?.questions,
    selections = object(state?.metadata)?.answers
  if (
    part.executed !== false ||
    typeof native?.itemId !== "string" ||
    !/^fc_[a-f0-9]{16,128}$/.test(native.itemId) ||
    !Array.isArray(questions) ||
    questions.length === 0 ||
    !Array.isArray(selections) ||
    selections.length !== questions.length
  )
    return null
  const began = stamp(time?.created),
    ran = stamp(time?.ran),
    ended = stamp(time?.completed)
  if (began === null || ran === null || ended === null || ran < began || ended < ran) return null
  const answers = Object.create(null) as Record<string, string[]>
  for (let n = 0; n < questions.length; n++) {
    const question = object(questions[n])?.question,
      selected = selections[n]
    if (
      typeof question !== "string" ||
      !question.trim() ||
      Object.hasOwn(answers, question) ||
      !Array.isArray(selected) ||
      selected.length === 0 ||
      selected.some((choice) => typeof choice !== "string" || !choice.trim())
    )
      return null
    answers[question] = selected as string[]
  }
  return completed({ input: state?.input, recordedAt: began }, { answers }, ended)
}
function callIn(rows: Row[], agent: NativeAgent, id: string): Call | null {
  if (RECORDED_PICKERS.has(agent))
    return nativeCalls(rows, agent).find((call) => call.id === id) ?? null
  let call: Call | null = null
  for (const row of rows) {
    const message = object(row.message)
    const p = object(row.payload)
    if (
      agent === "claude-code" &&
      (row.type === "api-request-blob" ||
        (message?.role !== "assistant" && message?.role !== "user") ||
        (row.type !== undefined && row.type !== message.role) ||
        stamp(row.timestamp) === null)
    )
      continue
    if (agent === "codex") {
      if (p?.call_id !== id || row.type !== "response_item") continue
      if (p.type === "function_call" && p.name === "request_user_input")
        call = { input: parse(p.arguments), recordedAt: stamp(row.timestamp) }
      if (p.type === "function_call_output" && call)
        call = completed(call, parse(p.output), row.timestamp)
    } else if (
      agent === "pi" &&
      message?.role === "toolResult" &&
      message.toolCallId === id &&
      message.toolName === "ql_ask" &&
      message.isError !== true &&
      call
    ) {
      call = completed(call, parse(contentText(message.content)), row.timestamp)
    } else {
      const parts = agent === "opencode" ? p?.content : message?.content
      for (const value of Array.isArray(parts) ? parts : []) {
        const part = object(value)
        if (agent === "claude-code") {
          if (
            message?.role === "assistant" &&
            part?.type === "tool_use" &&
            part.id === id &&
            part.name === "AskUserQuestion"
          )
            call = { input: part.input, recordedAt: stamp(row.timestamp) }
          if (
            message?.role === "user" &&
            part?.type === "tool_result" &&
            part.tool_use_id === id &&
            part.is_error !== true &&
            call
          ) {
            const own = object(row.toolUseResult)
            call = completed(
              call,
              own?.answers !== undefined ? own : parse(contentText(part.content)),
              row.timestamp,
            )
          }
        } else if (
          agent === "pi" &&
          message?.role === "assistant" &&
          part?.type === "toolCall" &&
          part.id === id &&
          part.name === "ql_ask"
        ) {
          call = { input: part.arguments, recordedAt: stamp(row.timestamp) }
        } else if (
          agent === "opencode" &&
          row.type === "assistant" &&
          part?.type === "tool" &&
          part.id === id &&
          part.name === "question"
        ) {
          const state = object(part.state)
          if (state?.status !== "completed") return null
          call =
            part.executed === true
              ? completed(
                  { input: state.input, recordedAt: stamp(object(part.time)?.created) },
                  parse(contentText(state.content)),
                  object(part.time)?.completed,
                )
              : clientQuestion(part)
        }
      }
    }
  }
  return call
}

const issued = new WeakMap<SessionProof, string>()
function emptySelection(input: unknown, result: unknown): boolean {
  const body = object(parse(result)),
    answers = object(body?.answers)
  const questions = object(input)?.questions
  return (
    body !== null &&
    Object.keys(body).length === 1 &&
    answers !== null &&
    Object.keys(answers).length === 0 &&
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every((q) => typeof object(q)?.question === "string")
  )
}
/** Consumers reject objects manufactured by a caller rather than read from the native store. */
export const isSessionProof = (proof: SessionProof): boolean => {
  try {
    return issued.has(proof) && issued.get(proof) === JSON.stringify(proof)
  } catch {
    return false
  }
}

export async function readSessionProof(
  ctx: Ctx,
  request: SessionRequest & {
    callId: string
    answers?: SessionAnswer[]
    input?: unknown
    waitMs?: 0 | 2000
  },
): Promise<SessionProof | null> {
  try {
    if (!request.callId || request.callId.length > 256) return null
    let call: Call | null = null
    const start = ctx.clock.now()
    for (;;) {
      const rows = await records(ctx, request)
      call = rows ? callIn(rows, request.agent, request.callId) : null
      if (call?.recordedAt !== null && call?.result !== undefined) break
      if (ctx.clock.now() - start >= (request.waitMs ?? 2000)) return null
      await ctx.clock.sleep(100)
    }
    if (!call || call.recordedAt === null) return null
    const asked = call.questions ?? call.input
    const answers = sessionAnswers(asked, call.result)
    if (
      (!answers.length && !emptySelection(asked, call.result)) ||
      (request.input !== undefined && !isDeepStrictEqual(request.input, call.input))
    )
      return null
    if (
      request.answers?.some(
        (claim) =>
          !answers.some(
            (own) =>
              own.question === claim.question &&
              own.answer === claim.answer &&
              own.notes === claim.notes &&
              (claim.labels === undefined || isDeepStrictEqual(own.labels, claim.labels)),
          ),
      )
    )
      return null
    const proof: SessionProof = {
      agent: request.agent,
      session: request.session,
      callId: request.callId,
      recordedAt: call.recordedAt,
      input: call.input,
      answers,
    }
    if (
      request.agent === "claude-code" &&
      pickerCallInput(request.agent, call.result) !== call.result &&
      isDeepStrictEqual(pickerCallInput(request.agent, call.result), call.input)
    )
      proof.completionDigest = sessionInputDigest(call.result)
    issued.set(proof, JSON.stringify(proof))
    return proof
  } catch {
    return null
  }
}

/**
 * The message the person typed, as Grok's, Cursor's and Antigravity's rows hold it: null when the row cuts
 * the words off or has no time, undefined for any other row. Grok keeps its time in seconds beside
 * the milliseconds of its own event; Antigravity wraps the request in markers beside its metadata.
 */
function nativeMessage(request: SessionRequest, row: Row): UserMessageProof | null | undefined {
  const typed = typedInNative(request.agent, row)
  if (typed === null) return undefined
  return typed.words?.trim() && typed.at !== null
    ? { ...request, prompt: typed.words, recordedAt: typed.at }
    : null
}

type Typed = { words: string | null; at: number | null } | null

/** Grok's message chunk, stamped in milliseconds when its meta names them. */
function grokTyped(row: Row): Typed {
  const params = object(row.params)
  const update = object(params?.update)
  if (row.method !== "session/update" || update?.sessionUpdate !== "user_message_chunk") return null
  const text = object(update.content)?.text
  const ms = stamp(object(params?._meta)?.agentTimestampMs)
  const seconds = stamp(row.timestamp)
  return {
    words: typeof text === "string" ? text : null,
    at: ms ?? (seconds === null ? null : seconds * 1000),
  }
}

function copilotTyped(row: Row): Typed {
  if (row.type !== "user.message") return null
  const data = object(row.data)
  // Copilot also records inter-agent prompts and hidden skill inputs as user.message.
  if (data?.source !== undefined || row.agentId !== undefined || row.checkpoint === true)
    return null
  const words = data?.content
  return { words: typeof words === "string" ? words : null, at: stamp(row.timestamp) }
}

/** Cursor stamps a message with the minute only; its time is the end of that minute. */
function cursorTyped(row: Row): Typed {
  const content = object(row.message)?.content
  if (row.role !== "user" || !Array.isArray(content)) return null
  const sent = cursorUserMessage(contentText(content))
  const minute = sent.at === undefined ? NaN : Date.parse(sent.at)
  return { words: sent.text, at: Number.isFinite(minute) ? minute + 59_999 : null }
}

function antigravityTyped(row: Row): Typed {
  if (row.source !== "USER_EXPLICIT" || row.type !== "USER_INPUT") return null
  const cut = Array.isArray(row.truncated_fields) && row.truncated_fields.includes("content")
  const request =
    typeof row.content === "string"
      ? /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(row.content)
      : null
  return {
    words: cut || request === null ? null : (request[1] as string),
    at: stamp(row.created_at),
  }
}

const TYPED: Partial<Record<NativeAgent, (row: Row) => Typed>> = {
  grok: grokTyped,
  copilot: copilotTyped,
  cursor: cursorTyped,
  antigravity: antigravityTyped,
}

/**
 * The words and time of a message the person typed, in Grok's, Copilot's, Cursor's and Antigravity's
 * rows; null for any other row. Cursor's minute-only stamp is read as the end of that minute, so a
 * reply is never taken as older than a question asked in the same minute.
 */
function typedInNative(agent: NativeAgent, row: Row): Typed {
  return TYPED[agent]?.(row) ?? null
}

/** What Claude Code recorded for a slash command, as the person typed it: the command, then its arguments. */
function claudeCommandWords(words: string): string {
  const command = words.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  const args = words.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]
  return command !== undefined && args !== undefined ? `${command} ${args}`.trim() : words
}

/**
 * Every message the person typed in the session, oldest first; a message whose words are cut off or
 * have no time is null, so the latest one is only taken when it can be read. Claude Code records a
 * message the person sent while the agent worked in a `queued_command` attachment, not in a user
 * row: it counts as typed when it was sent, and a task notification or other automated input never
 * does.
 */
export async function userMessages(
  ctx: Ctx,
  request: SessionRequest,
): Promise<(UserMessageProof | null)[] | null> {
  try {
    const rows = await records(ctx, request)
    if (!rows) return null
    const found: (UserMessageProof | null)[] = []
    for (const row of rows) {
      const native = nativeMessage(request, row)
      if (native !== undefined) {
        found.push(native)
        continue
      }
      const m = object(row.message)
      const p = object(row.payload)
      let words: unknown
      let human = false
      let typedAt: unknown
      const queued = object(row.attachment)
      if (
        request.agent === "claude-code" &&
        row.type === "attachment" &&
        queued?.type === "queued_command"
      ) {
        if (object(queued.origin)?.kind !== "human" || queued.commandMode === "task-notification")
          continue
        human = true
        words = queued.prompt
        typedAt = queued.timestamp ?? row.timestamp
      } else if (request.agent === "opencode" && row.type === "user") {
        human = true
        words = p?.text
      } else if (
        request.agent === "codex" &&
        row.type === "event_msg" &&
        p?.type === "user_message"
      ) {
        human = true
        words = p.message
      } else if (
        request.agent === "codex" &&
        row.type === "event_msg" &&
        (p?.type === "item_completed" || p?.type === "item_started") &&
        object(p.item)?.type === "UserMessage"
      ) {
        human = true
        const item = object(p.item)
        const parts = item?.content
        if (
          p.type === "item_completed" &&
          p.thread_id === request.session &&
          typeof p.turn_id === "string" &&
          safe(p.turn_id) &&
          typeof item?.id === "string" &&
          safe(item.id) &&
          (item.client_id === undefined ||
            (typeof item.client_id === "string" && safe(item.client_id))) &&
          Array.isArray(parts) &&
          parts.length > 0 &&
          parts.every(
            (part) => object(part)?.type === "text" && typeof object(part)?.text === "string",
          )
        )
          words = contentText(parts)
      } else if (
        (request.agent === "claude-code" || request.agent === "pi") &&
        m?.role === "user" &&
        row.isMeta !== true &&
        row.isSidechain !== true &&
        row.isCompactSummary !== true
      ) {
        if (row.type !== (request.agent === "pi" ? "message" : "user")) continue
        // Background-task and other automated input is no message of the person's.
        const origin = object(row.origin)?.kind
        if (origin !== undefined && origin !== "human") continue
        if (
          Array.isArray(m.content) &&
          m.content.some((part) => object(part)?.type === "tool_result")
        )
          continue
        human = true
        if (typeof m.content === "string") words = m.content
        else if (
          Array.isArray(m.content) &&
          m.content.some((part) => object(part)?.type === "text")
        )
          words = contentText(m.content)
      }
      if (!human) continue
      if (request.agent === "claude-code" && typeof words === "string") {
        if (/^\[Request interrupted by user(?: for tool use)?\]$/.test(words.trim())) continue
        words = claudeCommandWords(words)
      }
      const at = stamp(request.agent === "opencode" ? row.time_created : (typedAt ?? row.timestamp))
      found.push(
        typeof words === "string" && words.trim() && at !== null
          ? { ...request, prompt: words, recordedAt: at }
          : null,
      )
    }
    return found
  } catch {
    return null
  }
}

export async function latestUserMessage(
  ctx: Ctx,
  request: SessionRequest,
): Promise<UserMessageProof | null> {
  return ((await userMessages(ctx, request)) ?? []).at(-1) ?? null
}
