// `next`: the read-only compass (core/next/compass.ts). It never writes: no App is started, no
// session is touched, no decision applied. A word or an old flag after it changes nothing; the
// reply says which verb was meant. Also the extras every verb's reply about a task carries.

import { readComments } from "../../core/gate/comments.ts"
import { FINAL, readGate } from "../../core/gate/gate.ts"
import { type Compass, compass, type NextPayload } from "../../core/next.ts"
import { ORIGINAL_MAX_BYTES } from "../../core/task/adoption.ts"
import { agentActionable } from "../../core/team/comments.ts"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { leadInstructions } from "../../workflow/notice.ts"
import { openCockpit } from "../browser.ts"
import { firstMention, taskCockpitUrl } from "./cockpit.ts"
import { requireTask } from "./shared.ts"

export type { NextPayload }

/** The flags an older `next` took, each with the verb that does what it did. */
const OLD_FLAGS: Record<string, string> = {
  "--implement": "qualitylayer build start",
  "--from-plan": "qualitylayer task start --from-plan <file|->",
}

/** Flags of an older `next` that took a value: the value is no word of the request. */
const VALUED = new Set(["--from-plan", "--title", "--prompt", "--report", "--type"])

/** `next [words]`: where the task is and the moves open now. Reads only. */
export async function nextCmd(ctx: Ctx, args: string[]): Promise<Result<Compass>> {
  const words: string[] = []
  let meant: string | null = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg.startsWith("--")) {
      meant = meant ?? OLD_FLAGS[arg] ?? null
      if (VALUED.has(arg)) i++
      continue
    }
    words.push(arg)
  }
  const read = await compass(ctx, words.join(" "))
  if (!read.ok) return read
  return ok(meant !== null ? { ...read.data, meant } : read.data)
}

/** The raw bytes piped to the CLI, undecoded: a pasted plan is kept exactly as it was sent. */
export async function stdinBytes(): Promise<Uint8Array> {
  return process.stdin.isTTY ? new Uint8Array() : readPlanStdin(Bun.stdin.stream())
}

/** Enforce the original-plan byte limit before waiting for EOF or decoding any text. */
export async function readPlanStdin(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const bytes = new Uint8Array(ORIGINAL_MAX_BYTES)
  let used = 0,
    complete = false
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        complete = true
        return bytes.slice(0, used)
      }
      if (chunk.value.byteLength > ORIGINAL_MAX_BYTES - used)
        throw new Error(`An original plan can be at most ${ORIGINAL_MAX_BYTES / 1024} KB.`)
      bytes.set(chunk.value, used)
      used += chunk.value.byteLength
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

type LoadedTask = Awaited<ReturnType<typeof requireTask>> extends Result<infer T> ? T : never

function commentsSurfaceNow(gate: Awaited<ReturnType<typeof readGate>>): boolean {
  // A Plan gate hands the person's comments over with its decision; at the final review they
  // are the agents' to apply while the person reads, so the reply names them.
  return (
    gate === null || gate.decision !== "pending" || gate.settled === true || gate.target === FINAL
  )
}

async function attachLocalComments(
  ctx: Ctx,
  current: LoadedTask,
  data: NextPayload,
): Promise<NextPayload> {
  const gate = await readGate(ctx, current)
  if (!commentsSurfaceNow(gate)) return data
  const local = (await readComments(ctx, current)).filter(
    (c) => c.source === undefined && agentActionable(c) && c.remark.trim() !== "",
  ).length
  if (local === 0) return data
  const line = `${local} ${local === 1 ? "comment from the person waits" : "comments from the person wait"}: run \`qualitylayer comments take\`, apply each request, and answer it with \`qualitylayer comments resolve <id> --answer "<what changed>"\` before continuing.`
  return {
    ...data,
    local_comments: local,
    ...(typeof data.instructions === "string"
      ? { instructions: leadInstructions(data.instructions, line) }
      : { message: `${String(data.message ?? "")}\n\n${line}` }),
  }
}

async function attachAppExtras(
  ctx: Ctx,
  task: string,
  base: NextPayload,
  terminalAnswers: boolean,
): Promise<NextPayload> {
  // Autostart and QUALITYLAYER_NO_COCKPIT decide; an App that cannot start never fails a verb.
  const cockpit = await taskCockpitUrl(ctx, task)
  if (cockpit === undefined) return base
  const data: NextPayload = { ...base, app: cockpit }
  if (terminalAnswers) return data
  // At the Implement stop the App's Implement page holds the setup and the command: the chat points there.
  if (data.stop === "implement") {
    data.message = `${String(data.message)}\n\nThe QualityLayer App's Implement page has the setup and the command that starts the build.`
    return data
  }
  // The first time, name the App in the instructions; its local address stays in structured fields.
  if (typeof data.instructions === "string" && (await firstMention(ctx, cockpit))) {
    // A task starts: the App opens beside the chat, unless a page of it is open already.
    await openCockpit(ctx, cockpit)
    data.instructions = leadInstructions(
      data.instructions,
      "**The user can follow and review this task in the QualityLayer App.** Name the task on the App's Home when they need to answer. Never print its local address or a localhost link in the chat.",
    )
  }
  return data
}

/** What every verb's reply about a task carries: waiting person comments, and the App's link. */
export async function withTaskExtras(
  ctx: Ctx,
  asked: Result<NextPayload>,
): Promise<Result<NextPayload>> {
  if (!asked.ok) return asked
  const { task, done } = asked.data
  if (typeof task !== "string") return asked
  let data = asked.data
  const current = await requireTask(ctx)
  const matchesTask = current.ok && current.data.slug === task
  const terminalAnswers = matchesTask && current.data.answers === "terminal"
  if (matchesTask && done !== true) {
    data = await attachLocalComments(ctx, current.data, data)
  }
  if (done === true) return { ok: true, data }
  return { ok: true, data: await attachAppExtras(ctx, task, data, terminalAnswers) }
}
