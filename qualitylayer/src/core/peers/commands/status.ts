import { latestStatuses, STATUS_TOPIC } from "../claims.ts"
import { type Doing, doingOf } from "../doing.ts"
import { readTaskStatus } from "../task-status.ts"
import { TOPIC_TAIL_MAX, topicPost, topicTail } from "../topics.ts"
import { type Args, fail, opt, printResult } from "./arguments.ts"
import { claimant, liveSessions, whoOf } from "./claim-context.ts"

export async function cmdStatus(args: Args): Promise<number> {
  const [sub, ...words] = args.positional
  if (sub === "set" || sub === "clear") {
    const me = claimant(args)
    const text = sub === "set" ? (opt(args, "message") ?? words.join(" ")).trim() : ""
    if (sub === "set" && text === "")
      return fail("say what this session is doing: status set <text>", 2)
    topicPost(STATUS_TOPIC, me, "status", { text })
    printResult(args, { status: text || null }, text ? `status: ${text}` : "status cleared")
    return 0
  }
  if (sub !== undefined) return fail("status subcommands are `set <text>` and `clear`", 2)
  const who = whoOf(claimant(args))
  const mine = liveSessions()(who) ? await statusOf(who) : null
  printResult(
    args,
    { status: mine?.text ?? null, from: mine?.from ?? null },
    mine === null
      ? "no status set"
      : `status${mine.from === "task" ? " (from its task)" : ""}: ${mine.text}`,
  )
  return 0
}

/** A session's status: the one it set by hand, or the one QualityLayer set from its task. */
export async function statusOf(
  who: string,
  said = latestStatuses(topicTail(STATUS_TOPIC, 0, TOPIC_TAIL_MAX).entries),
): Promise<Doing | null> {
  return doingOf({ hand: said.get(who), task: readTaskStatus(who) })
}
