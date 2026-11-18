import { claimPath, conflicts, type Held, latestStatuses, STATUS_TOPIC } from "../claims.ts"
import { stagedWithoutClaims } from "../staged.ts"
import { printable, TOPIC_TAIL_MAX, topicTail } from "../topics.ts"
import { type Args, flag, opt, out, printResult } from "./arguments.ts"
import { boardOf, heldLine, sessionsView, whoOf } from "./claim-context.ts"
import { statusOf } from "./status.ts"
import { topicSender } from "./topic-identity.ts"

type View = ReturnType<typeof sessionsView>
type Board = ReturnType<typeof boardOf>["board"]
function viaText(who: string, via: View["via"]): string {
  const coordinator = via(who)
  return coordinator === null ? "" : `  via ${printable(coordinator.name ?? coordinator.id)}`
}
function codexRoute(h: Board[number], via: View["via"], threads: View["threads"]) {
  if (!h.who.startsWith("codex:")) return {}
  const thread = threads.find((t) => t.id === h.who.slice(6))
  return {
    role: thread?.role ?? "unknown",
    addressability:
      thread?.role === "guardian"
        ? "system_thread"
        : via(h.who)
          ? "coordinator"
          : "native_queue_unverified",
  }
}
function holderJson(
  h: Board[number],
  all: Map<string, string>,
  via: View["via"],
  threads: View["threads"],
) {
  return {
    ...h,
    status: all.get(h.who) ?? null,
    via: via(h.who)?.id ?? null,
    ...codexRoute(h, via, threads),
  }
}
function checkClaim(
  args: Args,
  check: string,
  { repo, board }: ReturnType<typeof boardOf>,
  via: View["via"],
): number {
  const me = topicSender(args)
  const clashes = conflicts(board, me === null ? "" : whoOf(me), [claimPath(repo, check)])
  const holder = clashes[0]?.holder ?? null
  printResult(
    args,
    { repo, path: claimPath(repo, check), held_by: holder?.name ?? holder?.who ?? null },
    holder === null
      ? `${check} is free`
      : `${check} is held by ${printable(holder.name ?? holder.who)}${viaText(holder.who, via)}: ${heldLine(clashes[0]?.held as Held)}`,
  )
  return holder === null ? 0 : 3
}

function printBoard(repo: string, board: Board, all: Map<string, string>, via: View["via"]): void {
  if (board.length === 0) {
    out(`nobody holds anything in ${repo}`)
  } else out(`${repo}:`)
  for (const holder of board) {
    const paused =
      holder.paused === null
        ? ""
        : `  [paused since ${holder.paused.since}${holder.paused.note === null ? "" : `: ${printable(holder.paused.note)}`}]`
    const status = all.get(holder.who)
    out(
      `  ${printable(holder.name ?? holder.who)}${viaText(holder.who, via)}${paused}${status === undefined ? "" : `  — ${status}`}`,
    )
    for (const held of holder.paths) out(`    ${heldLine(held)}`)
  }
}

function printStaged(staged: ReturnType<typeof stagedWithoutClaims>): void {
  if (staged.staged_error !== null) out(`warning: ${staged.staged_error}`)
  else if (staged.staged_unclaimed?.length) {
    out("warning: staged paths with no live claim (a shared-index commit would include them):")
    for (const path of staged.staged_unclaimed) out(`  ${JSON.stringify(path)}`)
    out("Review their ownership before committing; use a private index for your own paths.")
  }
}

export async function cmdClaims(args: Args): Promise<number> {
  const { live, via, threads } = sessionsView()
  const { repo, board } = boardOf(args, live)
  const said = latestStatuses(topicTail(STATUS_TOPIC, 0, TOPIC_TAIL_MAX).entries)
  const all = new Map<string, string>()
  for (const holder of board) {
    const status = await statusOf(holder.who, said)
    if (status !== null) all.set(holder.who, status.text)
  }
  const check = opt(args, "check")
  if (check !== undefined) return checkClaim(args, check, { repo, board }, via)
  const staged = stagedWithoutClaims(repo, board)
  if (flag(args, "json")) {
    out(
      JSON.stringify({
        repo,
        holders: board.map((h) => holderJson(h, all, via, threads)),
        ...staged,
      }),
    )
    return 0
  }
  printBoard(repo, board, all, via)
  printStaged(staged)
  return 0
}
