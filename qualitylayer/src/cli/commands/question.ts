// question ask '<json>' · question show '<json>' · question link <id> --points 1,3 · question more <id> --file <json> · question show <batch-id> · question progress "<line>" · question answered
// "<choice>": thin CLI dispatcher over sibling question modules.

import { type Ctx, err, type Result } from "../../ctx.ts"
import { answeredQuestionCmd } from "./question-answered.ts"
import { askSingleCmd } from "./question-ask.ts"
import { askBatchCmd } from "./question-batch.ts"
import {
  cancelQuestionCmd,
  linkQuestionCmd,
  pollQuestionCmd,
  progressQuestionCmd,
  replyQuestionCmd,
} from "./question-manage.ts"
import {
  asExitQuestion,
  askWaits,
  BUILD_ALREADY_ASKED,
  BUILD_ALREADY_IN_CHAT,
  BUILD_ASKED,
  BUILD_ASKED_IN_CHAT,
  type Host,
  hostOf,
  questionUsage,
  reviewOf,
} from "./question-shared.ts"
import { moreQuestionCmd, showQuestionCmd } from "./question-show.ts"
import { parseArgs } from "./shared.ts"

export {
  asExitQuestion,
  askWaits,
  BUILD_ALREADY_ASKED,
  BUILD_ALREADY_IN_CHAT,
  BUILD_ASKED,
  BUILD_ASKED_IN_CHAT,
}

const QUESTION_SUBS = new Set([
  "show",
  "answered",
  "ask",
  "progress",
  "poll",
  "cancel",
  "link",
  "more",
  "reply",
])

type Flags = Record<string, string | true>

function dispatchQuestionSub(
  ctx: Ctx,
  sub: string,
  task: Host,
  raw: string,
  flags: Flags,
): Promise<Result<unknown>> {
  const handlers: Record<string, () => Promise<Result<unknown>>> = {
    cancel: () => cancelQuestionCmd(ctx, task, flags),
    poll: () => pollQuestionCmd(ctx, task, flags),
    reply: () => replyQuestionCmd(ctx, task, raw, flags),
    more: () => moreQuestionCmd(ctx, task, raw, flags.file),
    link: () => linkQuestionCmd(ctx, task, raw, flags.points),
    ask: () =>
      flags.batch === true || flags["batch-file"] !== undefined
        ? askBatchCmd(ctx, task, raw, flags)
        : askSingleCmd(ctx, task, raw, flags),
    show: () => showQuestionCmd(ctx, task, raw),
    progress: () => progressQuestionCmd(ctx, task, raw),
    answered: () =>
      answeredQuestionCmd(ctx, task, raw, typeof flags.id === "string" ? flags.id : undefined),
  }
  return (handlers[sub] as () => Promise<Result<unknown>>)()
}

export async function questionCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (!sub || !QUESTION_SUBS.has(sub)) return err({ code: "bad_args", message: questionUsage() })
  const { positional, flags } = parseArgs(rest, [
    "wait-seconds",
    "batch-file",
    "text",
    "answer-at",
    "id",
    "points",
    "file",
    ...(sub === "poll" || sub === "cancel" ? ["batch"] : []),
  ])
  if (flags.id !== undefined && typeof flags.id !== "string")
    return err({ code: "bad_args", message: "--id needs the exact question id" })
  if (flags.home === true && (sub === "ask" || sub === "show"))
    return err({
      code: "bad_args",
      message:
        "new intake questions belong to a task's Plan; start the task, then ask there. Legacy Home questions remain available through poll, answered and cancel.",
    })
  const raw = positional.join(" ").trim()
  const single =
    (sub === "ask" || sub === "show") &&
    flags.batch === undefined &&
    flags["batch-file"] === undefined
  const task = await hostOf(ctx, flags.home === true, single ? reviewOf(raw) : undefined)
  if (!task.ok) return task
  return dispatchQuestionSub(ctx, sub, task.data, raw, flags)
}
