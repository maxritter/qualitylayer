// hook prompt: the agents' UserPromptSubmit hook. Claude Code and Codex pipe the person's message
// to it as JSON before the agent sees it; "approve" typed in the session that opened a gate is
// recorded here, and so is the person's answer to a held addition or a stop (`/ql continue`), and the line printed is what the agent is told. It runs on every message, keeps
// the message as the session's last (core/task/prompts.ts), and it never fails. A `/ql …` pasted
// into the middle of a message (which the client does not run as a command) is told to the agent
// as one line (core/prompt-invocation.ts). A session's first message also brings the lessons of its
// repository (memory-session.ts), once; so do the next message and tool call after a compaction
// that no other return point answered. hook memory-compact is every client's compaction signal.
// Every hook reads its payload as Claude Code's (core/live/hook-payload.ts). Cursor's and Grok's
// are read as they come; Antigravity's has no event name, so its hook command passes it: `hook live Stop`,
// `hook prompt PreInvocation`. A hook that starts or ends no turn (Grok's second Stop, at shutdown)
// records nothing. The agents with a hook file of their own (Cursor, Grok, Antigravity, Copilot) call
// their hooks with `--agent <id>`; that call is the one that counts. Cursor and Grok also run Claude
// Code's hooks, and those calls come without it, so a turn that ends, or a tool call, is recorded once.
// hook ask: Claude Code's PreToolUse hook for its own picker, denied while a build runs, except the
// picker call QualityLayer itself handed out with `question ask` (see `buildRefuses`).
// hook approve: the PermissionRequest hook of Claude Code and Codex (and OpenCode's plugin). While the
// Conversation view shows the session it waits for the person's answer there; otherwise it prints nothing.

import { readFileSync, realpathSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { detectAgent, sessionIdentity } from "../../core/agents/detect.ts"
import { isNativeAgent, type NativeAgent } from "../../core/agents/ids.ts"
import {
  qualityTurnFeedback,
  recordQualityEdit,
  takeQualityFeedback,
} from "../../core/code-quality/hook.ts"
import {
  approvalRequest,
  awaitApproval,
  clearCall,
  clearSession,
  hookOutput,
} from "../../core/conversation/approvals.ts"
import { awaitPicker } from "../../core/conversation/pickers.ts"
import { folderDoc } from "../../core/docs/names.ts"
import { isApproval, openGate, recordChatApproval } from "../../core/gate/gate.ts"
import { recordShapes } from "../../core/git/own-edit-shapes.ts"
import {
  editedPaths,
  noteCommitStart,
  noteToolHook,
  recordEdits,
  recordShellEdits,
  settleCommits,
  shellCommits,
  shellPatchedPaths,
} from "../../core/git/session-edits.ts"
import { shellWriteDenial, shellWriteTool } from "../../core/git/shell-write-policy.ts"
import { captureWorkingEdit } from "../../core/git/working-capture.ts"
import { endWorkingCalls } from "../../core/git/working-records.ts"
import { hasHookFile } from "../../core/install/agent-hooks.ts"
import { agentEntry } from "../../core/install/where.ts"
import {
  normalizeHookPayload,
  stopContinuation,
  toolContext,
  toolRefusal,
} from "../../core/live/hook-payload.ts"
import { ownCommand } from "../../core/live/own-command.ts"
import { interruptedIn, realProbe } from "../../core/live/read.ts"
import {
  ownAgentProcess,
  ownTranscript,
  recordHook,
  workflowOwnerKey,
} from "../../core/live/record.ts"
import { needQuestionText, readNeeds } from "../../core/need/need.ts"
import { BUILD_ROUTE, buildRouteOpen } from "../../core/next/implement.ts"
import { resolveRepo } from "../../core/paths.ts"
import { trackHookPeer } from "../../core/peers/hook-peer.ts"
import { isPeerEnvelope } from "../../core/peers/native.ts"
import { windows } from "../../core/platform.ts"
import { type PromptAgent, promptLine } from "../../core/prompt-invocation.ts"
import { startDueSweep } from "../../core/retention.ts"
import { autonomousNow } from "../../core/review/in-review.ts"
import {
  continueRunIntent,
  managedArtifactPrompt,
  recordRunHook,
  settleRunStop,
} from "../../core/run/bind.ts"
import type { RunEvent } from "../../core/run/contracts.ts"
import { liveTaskFor, probeCheckout } from "../../core/status/report.ts"
import { isArchived } from "../../core/task/archive.ts"
import { adoptPaneBinding, boundSlug, keyOf, sessionKey } from "../../core/task/binding.ts"
import { observedTarget } from "../../core/task/bound-target.ts"
import { chatQuestions } from "../../core/task/chat-questions.ts"
import {
  applyPickerProof,
  observePickerCompletion,
  pickerAgent,
  pickerPending,
} from "../../core/task/picker-completion.ts"
import { recordPrompt, verifyPendingPrompt } from "../../core/task/prompts.ts"
import { answeredQuestions, openQuestion, type Question } from "../../core/task/question.ts"
import { batchProgress, readBatch } from "../../core/task/question-batch.ts"
import {
  readSessionProof,
  type SessionAnswer,
  sessionAnswers,
} from "../../core/task/session-proof.ts"
import { approvesInAgent, askedInAgent, inAgent } from "../../core/task/sides.ts"
import { isTerminal, keepAlive, loadTask, type Task } from "../../core/task/store.ts"
import { noteOwnChange } from "../../core/verification.ts"
import { viewingLine } from "../../core/viewing.ts"
import { hasActiveWait, type WaitReply, waitReplyPath } from "../../core/wait.ts"
import type { Ctx } from "../../ctx.ts"
import { markCompacted, sessionBlock } from "../../memory-session.ts"
import { activityRepository } from "./hook-repo.ts"

type Prompt = {
  session_id?: unknown
  agent_pid?: unknown
  cwd?: unknown
  prompt?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  tool_input?: unknown
  tool_response?: unknown
  is_error?: unknown
  hook_event_name?: unknown
  turn_id?: unknown
  permission_mode?: unknown
  prompt_id?: unknown
  stop_hook_active?: unknown
  transcript_path?: unknown
  reason?: unknown
  notification_type?: unknown
  source?: unknown
}

/**
 * The running hook's payload as Claude Code's (`event` is what the hook command named for an agent
 * whose payload has no event name), or null for a hook that starts or ends no turn.
 */
async function readHookPayload(event?: string): Promise<Prompt | null> {
  try {
    const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim()
    return normalizeHookPayload(
      raw === "" ? {} : (JSON.parse(raw) as unknown),
      event,
    ) as Prompt | null
  } catch {
    return {}
  }
}

async function readPrompt(event?: string): Promise<Prompt> {
  return (await readHookPayload(event)) ?? {}
}

/** The directory as the agent names it may sit behind a symlink; a process's own is always the real one. */
function inDirectory(ctx: Ctx, cwd: unknown): Ctx {
  const where = typeof cwd === "string" ? realpathSync(cwd) : ctx.env.cwd()
  return {
    ...ctx,
    env: {
      get: (name) => (name === "QUALITYLAYER_TASK" ? undefined : ctx.env.get(name)),
      cwd: () => where,
    },
  }
}

/** Hooks observe the payload's already joined session; they never select a repository task. */
async function hookTask(ctx: Ctx, payload: Prompt) {
  const session = typeof payload.session_id === "string" ? payload.session_id.trim() : ""
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(session)) return null
  const target = await observedTarget(ctx, keyOf(session))
  if (target.kind === "blocked") return null
  if (target.kind === "bound") {
    const task = await loadTask(ctx, target.repo, target.slug)
    return task === null || isTerminal(task.stage) || (await isArchived(ctx, task)) ? null : task
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  const slug = boundSlug(ctx, repo.data.id, keyOf(session))
  if (slug === null) return null
  const task = await loadTask(ctx, repo.data, slug)
  return task === null || isTerminal(task.stage) || (await isArchived(ctx, task)) ? null : task
}

/** Only these native question tools can supply a picker answer. */
const PICKERS = new Set(["AskUserQuestion", "request_user_input", "question", "ql_ask"])

/** Payload claims retain every selection; the native transcript must still prove them. */
export function pickedAnswers(payload: Prompt): SessionAnswer[] {
  if (typeof payload.tool_name !== "string" || !PICKERS.has(payload.tool_name)) return []
  return sessionAnswers(payload.tool_input, payload.tool_response)
}

/**
 * An answer given in the agent's own window, or a call that went on, removes its card from the
 * Conversation view: one tool call for a finished or failed call, the whole session when its turn
 * or the session ended. Quiet and cheap when no view ever looked at the session.
 */
async function releaseApprovals(
  ctx: Ctx,
  payload: Prompt,
  scope: "call" | "session",
): Promise<void> {
  try {
    if (typeof payload.session_id !== "string") return
    const agent = promptAgent(ctx, payload, "/ql")
    if (scope === "session") await clearSession(ctx, agent, payload.session_id)
    else
      await clearCall(ctx, agent, payload.session_id, {
        ...(typeof payload.tool_use_id === "string" ? { toolUseId: payload.tool_use_id } : {}),
        ...(typeof payload.tool_name === "string" ? { name: payload.tool_name } : {}),
        input: payload.tool_input,
      })
  } catch {
    // Housekeeping never stops a tool call.
  }
}

/** Exit codes of a hook ended by a signal: the request must not stay behind in the App. */
const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const

/**
 * hook approve: the PermissionRequest hook of Claude Code and Codex, and the call OpenCode's plugin
 * makes for its permission events (`--agent opencode`). When the Conversation view is not open on the
 * session it prints nothing and returns at once, and the agent asks in its own window. When it is, the
 * request is left there and the hook waits a few seconds for a live view to read it; none does when the
 * page is hidden, suspended or gone, and the agent asks as before. Otherwise the request waits (the hook
 * touching its file every few seconds so a live view keeps reading) and the person's answer is printed
 * as the agent reads it (OpenCode's plugin reads the plain decision). If the view stops reading, closes,
 * the request is cleared or about nine minutes pass, it prints nothing as well. It never fails the agent.
 */
async function approveHook(ctx: Ctx, args: string[]): Promise<number> {
  let clear: (() => Promise<void>) | undefined
  const leave = () => {
    void (clear?.() ?? Promise.resolve()).finally(() => process.exit(143))
  }
  try {
    const payload = await readPrompt()
    const flag = args.indexOf("--agent")
    const named = flag >= 0 ? args[flag + 1] : undefined
    const agent = isNativeAgent(named) ? named : promptAgent(ctx, payload, "/ql")
    const request = approvalRequest(agent, payload)
    if (request === null) return 0
    for (const signal of SIGNALS) process.once(signal, leave)
    const decision = await awaitApproval(ctx, request, {
      onPending: (drop) => {
        clear = drop
      },
    })
    if (decision !== null)
      console.log(
        JSON.stringify(agent === "opencode" ? decision : hookOutput(decision, request.suggestions)),
      )
  } catch {
    // The agent asks in its own window whatever this finds.
  } finally {
    for (const signal of SIGNALS) process.off(signal, leave)
  }
  return 0
}

/**
 * What a session of the task changed, as one hook event shows it: recorded for the session (a
 * slice commit of another task sharing the checkout asks for its files) and kept with the task,
 * whose passed review is withdrawn by its own changes alone (`noteOwnChange`).
 *
 * Every event reads HEAD (`settleCommits`): a shell call that can commit may return before its
 * command ends, and the commit shows at a later event. `call` says what the event is for its tool
 * call: "done" (PostToolUse: its edits and shell writes are recorded), "failed" (the failure
 * event some agents send instead: a shell that failed may have committed or written before it
 * did; a file tool that failed edited nothing), or absent for any other event. `ended` is the end
 * of the turn or the session. Returns the source files the call patched through the shell.
 */
async function recordOwnWork(
  at: Ctx,
  task: Task,
  payload: Prompt,
  event: { call?: "done" | "failed"; ended?: "turn" | "session" },
): Promise<string[]> {
  if (typeof payload.session_id !== "string") return []
  const repo = { id: task.repoId, root: task.repoRoot }
  const key = keyOf(payload.session_id)
  const call =
    event.call === undefined
      ? undefined
      : {
          tool: payload.tool_name,
          input: payload.tool_input,
          id: payload.tool_use_id,
          response: payload.tool_response,
          // A stop that failed has stopped nothing: its start stays open (`settleCommits`).
          failed: event.call === "failed" || payload.is_error === true,
        }
  const settled = await settleCommits(at, repo, key, task.slug, {
    ...(call !== undefined ? { call } : {}),
    ...(event.ended !== undefined ? { ended: event.ended } : {}),
  }).catch(() => ({
    made: [] as string[],
    gained: [] as string[],
    // A call that can commit ended and HEAD could not be read: the hooks cannot tell.
    unsure: call !== undefined && shellCommits(call.tool, call.input),
  }))
  const cwd = at.env.cwd()
  const edited = event.call === "done" ? editedPaths(payload.tool_name, payload.tool_input) : []
  const patched = call !== undefined ? shellPatchedPaths(payload.tool_name, payload.tool_input) : []
  const touched = await recordEdits(at, {
    repo: repo,
    key: key,
    task: task.slug,
    cwd: cwd,
    paths: edited,
  })
  const shelled = await recordShellEdits(at, {
    repo: repo,
    key: key,
    task: task.slug,
    cwd: cwd,
    paths: patched,
  })
  await noteOwnChange(at, task, {
    files: [...touched, ...shelled],
    commits: settled.made,
    window: settled.gained,
    unsure: settled.unsure,
  }).catch(() => {})
  await recordShapes(at, repo, key, task.slug, [...touched, ...shelled]).catch(() => {})
  return shelled
}

/**
 * hook activity: the agents' PostToolUse hook. The tool call keeps the task's session alive, and
 * when the tool was the picker the person answered, their pick on a gate question is recorded, but
 * only when the client's own transcript holds that answer. It prints only the warning for source
 * files patched through the shell, and never fails a tool call.
 */
async function activity(ctx: Ctx, argument?: string): Promise<number> {
  // What the agent reads after this call: one JSON line, whatever the parts.
  const told: string[] = []
  const agent = detectAgent(ctx.env)
  // Antigravity's PostToolUse reads no words: what this hook would take for it stays for the next
  // place that can deliver it.
  const reads = toolContext(agent, "PostToolUse", "") !== null
  try {
    const payload = await readPrompt(argument)
    // A call that went on no longer waits for an answer in the Conversation view.
    await releaseApprovals(ctx, payload, "call")
    const nativeEvent = await recordRunHook(ctx, payload, "PostToolUse")
    // The lessons of a session that was compacted since its last message, once. Copilot's tool
    // hooks are not known to take context, so its next message returns them instead.
    const lessons = agent === "copilot" || !reads ? null : await compactedBlock(ctx, payload)
    if (lessons !== null) told.push(lessons)
    const at = activityRepository(inDirectory(ctx, payload.cwd), payload.session_id)
    const quality = reads
      ? await takeQualityFeedback(at, {
          ...payload,
          hook_event_name: "PostToolUse",
        }).catch(() => null)
      : null
    if (quality) told.push(quality)
    await recordQualityEdit(at, payload).catch(() => {})
    const task = await hookTask(at, payload)
    if (task === null) return 0
    await captureWorkingEdit(at, task, { ...payload, hook_event_name: "PostToolUse" }, nativeEvent)
    const pending = await settlePendingPrompt(at, payload)
    if (pending !== null) told.push(pending)
    await keepAlive(at, "tool", payload.session_id as string)
    await recordHook(at, payload, "PostToolUse", undefined, true)
    // What this call changed is the task's own: its files, and the commits its shell made by hand.
    // A source file patched through the shell is recorded too, and the agent is told at once.
    const shelled = await recordOwnWork(at, task, payload, { call: "done" })
    await noteToolHook(at, task.runtimeDir, keyOf(payload.session_id as string), "post").catch(
      () => {},
    )
    if (shelled.length > 0)
      told.push(shellPatchWarning(shelled).hookSpecificOutput.additionalContext)
    const picks = typeof payload.session_id === "string" ? pickedAnswers(payload) : []
    if (inAgent(task) && pickerAgent(payload.tool_name)) {
      const pending = pickerPending(await observePickerCompletion(at, task, payload))
      if ("native_picker_pending" in pending) told.push(pending.native_picker_pending.status)
      if ("native_picker_unanswered" in pending) told.push(pending.native_picker_unanswered.status)
      return 0
    }
    if (
      picks.length &&
      typeof payload.session_id === "string" &&
      typeof payload.tool_use_id === "string"
    ) {
      const agent =
        payload.tool_name === "AskUserQuestion"
          ? "claude-code"
          : payload.tool_name === "request_user_input"
            ? "codex"
            : payload.tool_name === "ql_ask"
              ? "pi"
              : "opencode"
      const proof = await readSessionProof(at, {
        agent,
        session: payload.session_id,
        callId: payload.tool_use_id,
        answers: picks,
        waitMs: 0,
      })
      if (proof) await applyPickerProof(at, task, proof)
    }
  } catch {
    // The agent's tool call goes on whatever this finds.
  } finally {
    const words = told.length > 0 ? toolContext(agent, "PostToolUse", told.join("\n\n")) : null
    if (words !== null) console.log(JSON.stringify(words))
  }
  return 0
}

/** A native background hook releases the client before looking for its completed transcript row. */
async function pickerHook(ctx: Ctx, argument?: string): Promise<void> {
  try {
    const payload = await readPrompt(argument)
    const at = inDirectory(ctx, payload.cwd),
      task = await hookTask(at, payload)
    const agent = pickerAgent(payload.tool_name)
    if (
      !task ||
      !agent ||
      typeof payload.session_id !== "string" ||
      typeof payload.tool_use_id !== "string" ||
      payload.is_error === true
    )
      return
    if (inAgent(task)) {
      const pending = pickerPending(await observePickerCompletion(at, task, payload, 2000))
      const status =
        "native_picker_pending" in pending
          ? pending.native_picker_pending.status
          : "native_picker_unanswered" in pending
            ? pending.native_picker_unanswered.status
            : null
      if (status !== null) console.log(JSON.stringify(contextOutput("PostToolUse", status)))
    } else {
      const proof = await readSessionProof(at, {
        agent,
        session: payload.session_id,
        callId: payload.tool_use_id,
        answers: pickedAnswers(payload),
      })
      if (proof) await applyPickerProof(at, task, proof)
    }
  } catch {
    /* A missing native result stays pending; no hook payload grants answer authority. */
  }
}

const contextOutput = (hookEventName: string, additionalContext: string) => ({
  hookSpecificOutput: { hookEventName, additionalContext },
})

/** What the agent reads after it patched source files through the shell. */
export const shellPatchWarning = (paths: string[]) =>
  contextOutput(
    "PostToolUse",
    `QualityLayer: ${paths.join(", ")} ${paths.length === 1 ? "was" : "were"} changed through the shell. Edit source files only with your file tools (Edit or Write, apply_patch in Codex), never sed, a redirect or a script: the person reviews each edit. When an edit fails, read the file again and retry it with the file tool.`,
  )

/** Why an agent's own question tool is refused while the build runs. */
export const ASK_DENIED =
  "The build runs unattended: decide yourself and say why in the agents' file. What can wait is a `qualitylayer need`; the person sees it in their review at Verify. Only when nothing but the person can do it (a push, a deploy, their account) and it cannot wait for their review, send one `qualitylayer question ask` and do not wait for the answer: go on with everything that does not depend on it and take the answer when it comes."

/**
 * Each agent's own question tool, by the name its PreToolUse payload carries. Claude Code, Pi and
 * OpenCode hand it to `hook ask`; Codex, Grok, Copilot and Antigravity to the `hook live` that runs
 * before every tool call they make. Cursor's hook payloads name no question tool.
 */
const ASKING_TOOLS: Readonly<Record<string, NativeAgent>> = {
  AskUserQuestion: "claude-code",
  request_user_input: "codex",
  ql_ask: "pi",
  question: "opencode",
  ask_user_question: "grok",
  ask_user: "copilot",
  ask_question: "antigravity",
}

/** The question tools that reach the build's guard through `hook live` rather than `hook ask`. */
const LIVE_ASKING_TOOLS = new Set([
  "request_user_input",
  "ask_user_question",
  "ask_user",
  "ask_question",
])

/**
 * The open questions QualityLayer itself handed to this chat's picker (`question ask` with the
 * answers given in the agent's chat): the build's one question, Verify's exit question, a need's
 * own question while that need is open and unchanged, and the open batch. Each entry is one
 * `question ask`, so its picker calls are built from it as that command built them. A question an
 * agent asked without naming a session (Copilot started in a terminal) counts for the session the
 * hook found bound to the task.
 */
async function handedToChat(at: Ctx, task: Task, session: unknown): Promise<Question[][]> {
  const mine = (asked: string | null | undefined) => asked == null || asked === session
  const handed: Question[][] = []
  const q = await openQuestion(at, task)
  if (q && askedInAgent(task, [q]) && mine(q.session)) {
    const current =
      !q.id.startsWith("need-") ||
      (await readNeeds(at, task)).some(
        (n) =>
          n.state === "open" &&
          q.id.startsWith(`need-${n.for}-`) &&
          q.question === needQuestionText(n) &&
          q.asked >= Math.max(n.opened, n.reopened?.at ?? 0),
      )
    if (current) handed.push([q])
  }
  const batch = await readBatch(at, task)
  if (batch && batch.questions.length > 0 && askedInAgent(task, batch.questions)) {
    if (mine(batch.session)) handed.push(batch.questions)
  }
  // The approval's own reply asked how to build: it stands until a build starts.
  if (await buildRouteOpen(at, task)) handed.push([BUILD_ROUTE])
  return handed
}

/**
 * Whether the build refuses this call of the agent's own question tool: while the agents have the
 * task (Implement, and Verify until it turns to the person) every call is refused except one
 * QualityLayer itself handed out (`handedToChat`), given exactly as it was handed. So the reply of
 * `question ask` never leads into a refusal.
 */
async function buildRefuses(at: Ctx, task: Task, payload: Prompt): Promise<boolean> {
  if (!(await autonomousNow(at, task))) return false
  const agent =
    (typeof payload.tool_name === "string" ? ASKING_TOOLS[payload.tool_name] : undefined) ??
    "opencode"
  for (const questions of await handedToChat(at, task, payload.session_id)) {
    const ready = await chatQuestions(at, questions, { agent })
    if (ready.calls.some((call) => isDeepStrictEqual(call, payload.tool_input))) return false
  }
  return true
}

/**
 * hook ask: the PreToolUse hook for Claude Code's own picker (AskUserQuestion), which Pi's and
 * OpenCode's plugins call for theirs. While the agents have the task of the session's directory
 * (Implement, and Verify until it turns to the person), the picker is denied with the reason the agent reads; otherwise the hook says
 * nothing and the client goes on as it would. It never fails.
 */
async function askHook(ctx: Ctx): Promise<number> {
  try {
    const payload = await readPrompt()
    await recordRunHook(ctx, payload, "PreToolUse")
    if (
      payload.tool_name !== undefined &&
      (typeof payload.tool_name !== "string" || !PICKERS.has(payload.tool_name))
    )
      return 0
    const at = inDirectory(ctx, payload.cwd)
    const task = await hookTask(at, payload)
    if (task === null || !(await autonomousNow(at, task))) {
      if (payload.tool_name === "AskUserQuestion") {
        const answer = await awaitPicker(at, payload)
        if (answer) console.log(JSON.stringify(answer))
      }
      return 0
    }
    if (await buildRefuses(at, task, payload))
      console.log(JSON.stringify(toolRefusal("claude-code", ASK_DENIED, null)))
  } catch {
    // A hook that fails must not stand in the agent's way.
  }
  return 0
}

/**
 * hook live: the agents' hooks for the live status. Every tool call that starts (PreToolUse), every
 * subagent that starts and stops, the end of a turn (Stop), of a session (SessionEnd) and a
 * permission prompt (Claude Code's Notification, Codex's PermissionRequest) leave a sign of life on
 * the task the session works on. Pending App work alone does not block the turn; every
 * other event is silent, and a hook error never fails the agent's call.
 */
async function planningAnswerContext(ctx: Ctx, payload: Prompt): Promise<string | null> {
  if (
    payload.hook_event_name !== "PreToolUse" ||
    !["claude-code", "codex", "pi", "opencode"].includes(detectAgent(ctx.env))
  )
    return null
  const task = await hookTask(ctx, payload)
  if (!task) return null
  const batch = await readBatch(ctx, task)
  // Only a batch the App asks is kept out of the agent's own picker.
  if (askedInAgent(task, batch?.questions ?? [])) return null
  if (!batch?.session || batch.session !== payload.session_id) return null
  const owner = await workflowOwnerKey(ctx, task)
  if (owner && owner !== keyOf(batch.session)) return null
  const progress = await batchProgress(ctx, task, batch.id)
  const members = new Set(progress?.members)
  const history = (await answeredQuestions(ctx, task)).filter(
    (answer) => answer.id !== undefined && members.has(answer.id),
  )
  const fresh = history
    .filter((answer) => !answer.reopened && answer.delivered === false)
    .map((answer) => ({ id: answer.id, choice: answer.choice, answer_at: answer.at }))
  const changed = history
    .filter((answer) => answer.changed?.delivered === false)
    .map((answer) => ({
      id: answer.id,
      was: answer.changed?.was,
      now: answer.choice,
      answer_at: answer.at,
    }))
  const more = batch.questions
    .filter((question) => question.more && question.more.cancelled === undefined)
    .map((question) => ({
      id: question.id,
      request: question.more?.request,
      request_at: question.more?.at,
    }))
  if (!fresh.length && !changed.length && !more.length) return null
  const saved = JSON.stringify({
    batch: batch.id,
    answered_meanwhile: fresh,
    changed_answers: changed,
    more_requests: more,
  })
  const details =
    saved.length <= 12000
      ? saved
      : JSON.stringify({
          batch: batch.id,
          answer_ids: fresh.map((answer) => answer.id),
          changed_ids: changed.map((answer) => answer.id),
          more_ids: more.map((question) => question.id),
          omitted:
            "Answer contents exceed this hook's context limit; read them with the named poll.",
        })
  return `QualityLayer saved App answers or Tell me more requests for your batch. Read them with \`qualitylayer question poll --batch ${batch.id} --json\`.\n${details}`
}

async function stopHook(ctx: Ctx, payload: Prompt, event: RunEvent | null): Promise<boolean> {
  const session = typeof payload.session_id === "string" ? payload.session_id : ""
  if (!session || payload.reason === "interrupted" || payload.reason === "user_interrupt")
    return true
  const checkout = probeCheckout(ctx.env.cwd())
  if (!checkout) return false
  const live = await liveTaskFor(ctx, checkout, session, { boundOnly: true })
  if (!live || (await isArchived(ctx, live.task))) return false
  const key = keyOf(session)
  // The turn ends while the person answers in this chat: a question asked here, or an approval.
  const question = await openQuestion(ctx, live.task)
  if (question && askedInAgent(live.task, [question])) return false
  if (approvesInAgent(live.task)) {
    const gate = await openGate(ctx, live.task)
    if (
      gate &&
      gate.session === session &&
      !gate.waitsFor &&
      (gate.target === folderDoc("plan") || gate.target === "final")
    )
      return false
  }
  const transcript = ownTranscript(ctx, payload.transcript_path)
  if (transcript && interruptedIn(realProbe.tail(transcript, 8192))) {
    await continueRunIntent(ctx, event ? { ...event, interrupted: true } : null, live.task)
    return true
  }
  const owner = await workflowOwnerKey(ctx, live.task)
  if (owner !== null && owner !== key) return false
  let reply: WaitReply | null = null
  try {
    reply = JSON.parse(await ctx.fs.readFile(waitReplyPath(live.task, key))) as WaitReply
  } catch {
    /* no CLI reply */
  }
  const activeWait = await hasActiveWait(ctx, live.task, key)
  await continueRunIntent(ctx, event, live.task, activeWait, !!(reply?.stop || reply?.done))
  return false
}

/** A hook that marks no start or end of a turn (Grok's Stop at shutdown) records nothing. */
async function live(ctx: Ctx, forceStop = false, argument?: string): Promise<number> {
  const payload = await readHookPayload(argument)
  if (payload === null) return 0
  await adoptTerminalSession(ctx, payload)
  return liveHook(ctx, payload, forceStop)
}

/**
 * An agent that hides its session id from its commands (Copilot started in a terminal) bound its
 * task under the terminal pane; the hook, in that pane, binds the payload's session to it too.
 */
async function adoptTerminalSession(ctx: Ctx, payload: Prompt): Promise<void> {
  try {
    if (sessionIdentity(ctx.env) !== null) return
    const session = typeof payload.session_id === "string" ? payload.session_id.trim() : ""
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(session)) return
    const at = inDirectory(ctx, payload.cwd)
    const pane = sessionKey(at.env)
    const target = pane !== null ? await observedTarget(at, pane) : null
    if (target?.kind === "blocked") return
    const repo =
      target?.kind === "bound" ? { ok: true as const, data: target.repo } : await resolveRepo(at)
    if (repo.ok) await adoptPaneBinding(at, repo.data.id, session)
  } catch {
    // The hook goes on with whatever binding the session has.
  }
}

async function liveHook(ctx: Ctx, payload: Prompt, forceStop: boolean): Promise<number> {
  try {
    const named = String(payload.hook_event_name ?? "")
    if (forceStop || named === "Stop" || named === "SessionEnd")
      await releaseApprovals(ctx, payload, "session")
    else if (named === "PostToolUseFailure" || named === "PermissionDenied")
      await releaseApprovals(ctx, payload, "call")
    const at = inDirectory(ctx, payload.cwd)
    const pending = await settlePendingPrompt(at, payload)
    // Codex's, Grok's, Copilot's and Antigravity's own question tool, refused while the build runs
    // as `hook ask` does.
    if (
      !forceStop &&
      payload.hook_event_name === "PreToolUse" &&
      typeof payload.tool_name === "string" &&
      LIVE_ASKING_TOOLS.has(payload.tool_name)
    ) {
      const task = await hookTask(at, payload)
      if (task && (await buildRefuses(at, task, payload))) {
        console.log(JSON.stringify(toolRefusal(detectAgent(ctx.env), ASK_DENIED, pending)))
        return 0
      }
    }
    if (
      !forceStop &&
      payload.hook_event_name === "PreToolUse" &&
      shellWriteTool(payload.tool_name)
    ) {
      const task = await hookTask(at, payload)
      const reason = task
        ? await shellWriteDenial(at, task, payload.tool_name, payload.tool_input)
        : null
      if (reason) {
        console.log(JSON.stringify(toolRefusal(detectAgent(ctx.env), reason, pending)))
        return 0
      }
    }
    // The task's own commits and changes, at every event of its session that is no PostToolUse
    // (`hook activity` has those): a call that failed (Claude Code, Cursor and Copilot send that
    // here), a later call, the end of the turn or the session. A commit of a shell call that
    // returned before its command ended shows at one of these.
    const ending =
      forceStop || named === "Stop" ? "turn" : named === "SessionEnd" ? "session" : null
    if (ending !== null || ["PreToolUse", "PostToolUseFailure", "SubagentStop"].includes(named)) {
      const task = await hookTask(at, payload)
      if (task)
        await recordOwnWork(at, task, payload, {
          ...(named === "PostToolUseFailure" && !forceStop ? { call: "failed" as const } : {}),
          ...(ending !== null ? { ended: ending } : {}),
        }).catch(() => [])
      // A shell call that can commit: where HEAD stands before it runs, so the commits it creates
      // are told from another session's commit it found there.
      if (task && !forceStop && named === "PreToolUse") {
        const key = keyOf(payload.session_id as string)
        const repo = shellCommits(payload.tool_name, payload.tool_input)
          ? { id: task.repoId, root: task.repoRoot }
          : null
        if (repo)
          await noteCommitStart(at, {
            repo,
            key: key,
            call: { tool: payload.tool_name, input: payload.tool_input, id: payload.tool_use_id },
          }).catch(() => {})
        await noteToolHook(at, task.runtimeDir, key, "pre").catch(() => {})
      }
    }
    const answers = forceStop ? null : await planningAnswerContext(at, payload).catch(() => null)
    const words =
      (pending !== null || answers !== null) &&
      !forceStop &&
      named !== "Stop" &&
      named !== "SubagentStop"
        ? toolContext(
            detectAgent(ctx.env),
            String(payload.hook_event_name ?? "PreToolUse"),
            [pending, answers].filter(Boolean).join("\n\n"),
          )
        : null
    if (words !== null) console.log(JSON.stringify(words))
    const event = await recordRunHook(ctx, payload, forceStop ? "Stop" : "")
    await recordHook(at, payload, forceStop ? "Stop" : "", undefined, true)
    if (!forceStop && ["PreToolUse", "PostToolUseFailure"].includes(named)) {
      const task = await hookTask(at, payload)
      if (task) await captureWorkingEdit(at, task, payload, event)
    }
    if (["Stop", "SessionEnd"].includes(named) && typeof payload.session_id === "string") {
      const task = await hookTask(at, payload)
      if (task) await endWorkingCalls(at, task, keyOf(payload.session_id))
    }
    const finishing = forceStop || named === "Stop" || named === "SubagentStop"
    const quality = finishing ? await qualityTurnFeedback(at, payload).catch(() => null) : null
    const feedback =
      named === "SubagentStop"
        ? [pending, answers, quality].filter(Boolean).join("\n\n") || null
        : quality
    let blocked = false
    let peers: string | null = null
    if (forceStop || named === "Stop") {
      blocked = await stopHook(at, payload, event)
      await settleRunStop(ctx, event, blocked)
      // Peer messages queued for this session continue the turn the agent just ended.
      peers = trackHookPeer(ctx.env, { ...payload, hook_event_name: "Stop" }, { blocked })
    } else if (named === "SessionStart" || named === "SessionEnd") {
      trackHookPeer(ctx.env, payload)
    }
    if (finishing) {
      if (peers)
        console.log(
          JSON.stringify(
            stopContinuation(detectAgent(ctx.env), peers, feedback && !blocked ? feedback : null),
          ),
        )
      else if (feedback && !blocked) console.log(JSON.stringify({ systemMessage: feedback }))
    }
  } catch {
    // The agent goes on whatever this finds.
  }
  return 0
}

async function settlePendingPrompt(ctx: Ctx, payload: Prompt): Promise<string | null> {
  if (typeof payload.session_id !== "string") return null
  const prompt = await verifyPendingPrompt(ctx, payload.session_id)
  if (prompt === null) return null
  const approval = isApproval(prompt)
  const result = approval
    ? await recordChatApproval(ctx, { session: payload.session_id, prompt })
    : null
  if (result !== null || !approval)
    await recordPrompt(ctx, {
      session: payload.session_id,
      prompt,
      agent: promptAgent(ctx, payload, "/ql"),
    })
  return result
}

/** The agent that sent the payload: Codex's carries a turn id, Claude Code's a permission mode; else the environment says. */
function promptAgent(ctx: Ctx, payload: Prompt, marker: string): PromptAgent {
  const native = detectAgent(ctx.env)
  if (native === "pi" || native === "opencode" || hasHookFile(native)) return native
  if (typeof payload.turn_id === "string") return "codex"
  if (typeof payload.permission_mode === "string" || typeof payload.prompt_id === "string")
    return "claude-code"
  const known = detectAgent(ctx.env)
  if (known === "codex" || known === "claude-code") return known
  return marker === "$ql" ? "codex" : "claude-code"
}

/**
 * A standalone or explicitly requested command can arrive as plain words after other text.
 * Command examples and UI-option discussion stay silent; an invocation line names its arguments.
 * A message that only names QualityLayer gets one line that lets the agent read the request. Silent
 * without a command or the name, and it never fails the message.
 */
async function invokedInMessage(ctx: Ctx, payload: Prompt, prompt: string): Promise<void> {
  try {
    const cwd = typeof payload.cwd === "string" ? payload.cwd : ctx.env.cwd()
    const line = await promptLine(ctx, prompt, cwd, (marker) => promptAgent(ctx, payload, marker))
    if (line !== null) console.log(line)
  } catch {
    // A hook that fails would stop the person's message from reaching the agent.
  }
}

/**
 * The lessons a session starts with, printed on its first message: pinned ones and those that match
 * the message. Silent on every later message, with memory or sessions off, outside Git and when the
 * lookup is slow or fails; the message goes on in every case.
 */
async function lessonBlock(ctx: Ctx, payload: Prompt, prompt: string): Promise<void> {
  try {
    if (typeof payload.session_id !== "string") return
    const input = {
      cwd: typeof payload.cwd === "string" ? payload.cwd : ctx.env.cwd(),
      session: payload.session_id.trim(),
      message: prompt,
    }
    let block = await sessionBlock(ctx, { ...input, reason: "first" })
    // A session compacted since its last message that no earlier return point served.
    if (block.text === null) block = await sessionBlock(ctx, { ...input, reason: "compact" })
    if (block.text !== null) console.log(block.text)
  } catch {
    // Lessons are never worth a message that does not reach the agent.
  }
}

/** The block a marked session gets back, or null: nothing marked, nothing to send or a slow lookup. */
async function compactedBlock(ctx: Ctx, payload: Prompt): Promise<string | null> {
  try {
    if (typeof payload.session_id !== "string") return null
    const block = await sessionBlock(ctx, {
      cwd: typeof payload.cwd === "string" ? payload.cwd : ctx.env.cwd(),
      session: payload.session_id.trim(),
      reason: "compact",
    })
    return block.text
  } catch {
    return null
  }
}

/**
 * hook memory-compact: every client's compaction signal. PreCompact marks a session that was served
 * its first block (Codex and Claude Code send it before compacting, Pi and OpenCode send it from
 * their own events) and prints nothing. The return points print the block once and clear the mark:
 * Claude Code's and Codex's SessionStart with source "compact" (as additionalContext), and Pi's and
 * OpenCode's ContextRequest (plain text). Codex PostCompact accepts no context: leave its mark alone
 * until the context-capable SessionStart event runs before the next model request.
 */
async function memoryCompact(ctx: Ctx, argument?: string): Promise<void> {
  try {
    const payload = await readPrompt(argument)
    const event = payload.hook_event_name
    if (event === "PreCompact") {
      if (typeof payload.session_id === "string")
        await markCompacted(ctx, payload.session_id.trim(), { servedOnly: true })
      return
    }
    const returns =
      (event === "SessionStart" && payload.source === "compact") || event === "ContextRequest"
    if (!returns) return
    const text = await compactedBlock(ctx, payload)
    if (text === null) return
    console.log(
      event === "ContextRequest" ? text : JSON.stringify(contextOutput(event as string, text)),
    )
  } catch {
    // The client's compaction goes on whatever this finds.
  }
}

/**
 * `--agent <id>` ends the arguments of a hook an agent runs from its own hook file. The agent it
 * names answers for the hook from then on; a hook of Claude Code's settings that Cursor or Grok ran
 * comes without it, or with another agent's name, and is left to the hook file's call.
 */
export function ownHookCall(ctx: Ctx, args: string[]): { args: string[]; ctx: Ctx } | null {
  const at = args.indexOf("--agent")
  const named = at >= 0 ? args[at + 1] : undefined
  const running = detectAgent(ctx.env)
  if (hasHookFile(running) && named !== running) return null
  if (!isNativeAgent(named) || !hasHookFile(named)) return { args, ctx }
  const agent: NativeAgent = named
  return {
    args: args.filter((_, index) => index !== at && index !== at + 1),
    ctx: {
      ...ctx,
      env: {
        ...ctx.env,
        get: (name) => (name === "QUALITYLAYER_AGENT" ? agent : ctx.env.get(name)),
      },
    },
  }
}

/** The hooks that need no more than the arguments; `prompt` is the rest of `hookCmd`. */
/**
 * hook own-command: Copilot's permission request for a shell command. A command that only runs
 * QualityLayer from its install folder (see `ownCommand`) is allowed; any other gets no answer, so
 * Copilot asks the person as it would without the hook.
 */
async function ownCommandHook(ctx: Ctx, argument?: string): Promise<number> {
  try {
    const payload = (await readHookPayload(argument)) as Record<string, unknown> | null
    const input = (payload?.tool_input ?? payload?.toolInput) as { command?: unknown } | undefined
    const tool = String(payload?.tool_name ?? payload?.toolName ?? "")
    const cwd = typeof payload?.cwd === "string" ? realpathSync(payload.cwd) : ctx.env.cwd()
    const command = !windows && ["bash", "shell"].includes(tool) ? input?.command : undefined
    if (typeof command !== "string") return 0
    // The skills name the installed launcher; the commands QualityLayer prints name the CLI that
    // runs (an App's bundled one), which is this process.
    const binaries = [agentEntry(ctx), process.execPath]
    if (binaries.some((binary) => ownCommand(command, binary, cwd)))
      console.log(JSON.stringify({ behavior: "allow" }))
  } catch {
    // No answer: the person is asked.
  }
  return 0
}

const SUBCOMMANDS = new Map<string, (ctx: Ctx, args: string[]) => Promise<number>>([
  ["activity", (ctx, args) => activity(ctx, args[1])],
  [
    "picker",
    async (ctx, args) => {
      await pickerHook(ctx, args[1])
      return 0
    },
  ],
  ["ask", (ctx) => askHook(ctx)],
  ["approve", (ctx, args) => approveHook(ctx, args.slice(1))],
  ["live", (ctx, args) => live(ctx, false, args[1])],
  ["stop", (ctx) => live(ctx, true)],
  ["own-command", (ctx, args) => ownCommandHook(ctx, args[1])],
  [
    "memory-compact",
    async (ctx, args) => {
      await memoryCompact(ctx, args[1])
      return 0
    },
  ],
])

/** The agent a hook call comes from: the one `--agent` names, else the one the environment and parent processes show. */
function invokingAgent(ctx: Ctx, args: string[]): string {
  const at = args.indexOf("--agent")
  const named = at >= 0 ? args[at + 1] : undefined
  return isNativeAgent(named) ? named : detectAgent(ctx.env)
}

/**
 * An App launch carries its own copy of the hooks and sets `QUALITYLAYER_SESSION_HOOKS` to its agent's
 * id; its copy calls the hook with `--launch`. The installed copy of that same agent steps aside at
 * once, so no event is reported twice. Another agent started from inside the session (a helper, a
 * review) is not that agent and keeps its installed hooks.
 */
export async function hookCmd(given: Ctx, called: string[]): Promise<number> {
  const launch = called.includes("--launch")
  const hooked = given.env.get("QUALITYLAYER_SESSION_HOOKS")
  if (!launch && hooked && hooked === invokingAgent(given, called)) return 0
  const all = called.filter((word) => word !== "--launch")
  const own = ownHookCall(given, all)
  if (own === null) return 0
  const { ctx, args } = own
  const run = SUBCOMMANDS.get(args[0] ?? "")
  if (run !== undefined) return run(ctx, args)
  if (args[0] !== "prompt") {
    console.error(
      "usage: qualitylayer hook prompt | hook activity | hook picker | hook ask | hook approve | hook live | hook stop | hook memory-compact  (read the agent's hook JSON)",
    )
    return 1
  }
  if (detectAgent(ctx.env) === "copilot") await asAdditionalContext(() => promptHook(ctx, args))
  else await promptHook(ctx, args)
  return 0
}

/**
 * Copilot reads a prompt hook's output as JSON only and drops plain text, so the lines the prompt
 * hook prints go back as one `additionalContext`, which it adds to the model's context.
 */
async function asAdditionalContext(run: () => Promise<void>): Promise<void> {
  const lines: string[] = []
  const print = console.log
  console.log = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "))
  }
  try {
    await run()
  } finally {
    console.log = print
    if (lines.length > 0) print(JSON.stringify({ additionalContext: lines.join("\n") }))
  }
}

/** hook prompt: what the person's message records, and the context it adds for the agent. */
async function promptHook(ctx: Ctx, args: string[]): Promise<void> {
  const payload = await readPrompt(args[1])
  await adoptTerminalSession(ctx, payload)
  const runEvent = await recordRunHook(ctx, payload, "UserPromptSubmit").catch(() => null)
  const artifactContext = await managedArtifactPrompt(ctx, runEvent).catch(() => null)
  if (artifactContext) console.log(artifactContext)
  // Peer messages queued for this session ride in with the prompt (agents with a hook file only).
  const peers = trackHookPeer(ctx.env, payload)
  if (peers) console.log(peers)
  const { session_id: session, cwd, prompt } = payload
  if (typeof prompt !== "string") return
  // A peer message typed into the App's session is not the person's own words.
  if (isPeerEnvelope(prompt)) return
  // Every step below needs the repository, which git answers in two processes. They are started now
  // and the agent above this hook is looked for while they run: the lookup is a few `ps` calls, and
  // run after the answer it would add to the wait.
  let agent: number | null | undefined
  try {
    void resolveRepo(inDirectory(ctx, cwd)).catch(() => null)
    agent = ownAgentProcess()
  } catch {
    // The steps below look again, and fail or not as they always did.
  }
  const quality = await takeQualityFeedback(inDirectory(ctx, cwd), {
    ...payload,
    hook_event_name: "UserPromptSubmit",
  }).catch(() => null)
  if (quality) console.log(quality)
  // The person's last message, kept locally per session: the agent may act on their own words.
  let verified = false
  try {
    const at = inDirectory(ctx, cwd)
    verified = await recordPrompt(at, {
      session: typeof session === "string" ? session : "",
      prompt,
      agent: promptAgent(at, payload, prompt.trimStart().startsWith("$ql") ? "$ql" : "/ql"),
    })
    await recordHook(
      at,
      payload,
      "UserPromptSubmit",
      agent === undefined ? undefined : () => agent,
      true,
    )
  } catch {
    // Keeping it is never worth a message that does not reach the agent.
  }
  // Once a day a prompt starts the retention sweep, detached: machines that never open the App
  // keep their home inside its limits too.
  await startDueSweep(ctx).catch(() => {})
  await lessonBlock(ctx, payload, prompt)
  const reportViewing = async () => {
    try {
      const at = inDirectory(ctx, cwd)
      const task = await hookTask(at, payload)
      const line = task ? await viewingLine(at, task) : null
      if (line !== null) console.log(line)
    } catch {
      // Viewing context never holds the person's message.
    }
  }
  const approval = isApproval(prompt) && typeof session === "string"
  if (!approval) {
    await invokedInMessage(ctx, payload, prompt)
    await reportViewing()
    return
  }
  if (!verified) {
    await reportViewing()
    return
  }
  try {
    const at = inDirectory(ctx, cwd)
    const told = await recordChatApproval(at, { session: session as string, prompt })
    if (told !== null) console.log(told)
    else if (typeof session === "string")
      await recordPrompt(at, {
        session,
        prompt,
        agent: promptAgent(at, payload, "/ql"),
        pending: true,
      })
  } catch {
    // A hook that fails would stop the person's message from reaching the agent.
  }
  await reportViewing()
}
