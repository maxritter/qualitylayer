import { boardTopic, checkoutOf, claimPath, conflicts } from "../claims.ts"
import { printable, topicPost } from "../topics.ts"
import { type Args, fail, flag, opt, printResult } from "./arguments.ts"
import { boardOf, claimant, sessionsView, whoOf } from "./claim-context.ts"

export async function cmdClaim(args: Args): Promise<number> {
  const me = claimant(args)
  const { live, threads } = sessionsView()
  const { repo, board } = boardOf(args, live)
  if (args.positional.length === 0)
    return fail("name the paths to hold: claim <path>... [--note <why>]", 2)
  const paths = [...new Set(args.positional.map((raw) => claimPath(repo, raw)))]
  // The board drops a session it does not count as live, so a claim from one would be
  // reported as made and be gone from `claims` at once.
  if (me.kind === "codex" && !live(whoOf(me))) {
    const parent = threads.find((t) => t.id === me.uuid)?.parent_id ?? null
    if (parent !== null)
      return fail(
        `Codex thread ${me.uuid} is a sub-agent of ${parent}, which is not live either, so a claim from it would not hold; its coordinator should claim for it, after attaching: qualitylayer peers up ${parent}`,
        2,
      )
    return fail(
      `Codex thread ${me.uuid} is not live as far as the board can tell, so a claim from it would not hold; attach it first: qualitylayer peers up ${me.uuid}`,
      2,
    )
  }
  const clashes = conflicts(board, whoOf(me), paths)
  if (clashes.length > 0) {
    for (const { path, holder, held } of clashes)
      process.stderr.write(
        `error: ${path} overlaps ${held.path}, held by ${printable(holder.name ?? holder.who)} since ${held.since}${held.note === null ? "" : ` (${printable(held.note)})`}\n`,
      )
    return 3
  }
  topicPost(boardTopic(repo), me, "claim", { data: { paths, note: opt(args, "note") ?? null } })
  printResult(args, { repo, claimed: paths }, `claimed ${paths.join(", ")} in ${repo}`)
  return 0
}

export async function cmdRelease(args: Args): Promise<number> {
  const me = claimant(args)
  const repo = checkoutOf(opt(args, "repo") ?? process.cwd())
  const all = flag(args, "all")
  if (!all && args.positional.length === 0)
    return fail("name the paths to let go of, or pass --all", 2)
  const paths = all ? [] : [...new Set(args.positional.map((raw) => claimPath(repo, raw)))]
  topicPost(boardTopic(repo), me, "release", { data: { paths, all } })
  printResult(
    args,
    { repo, released: all ? "all" : paths },
    `released ${all ? "everything" : paths.join(", ")} in ${repo}`,
  )
  return 0
}

export async function cmdPause(args: Args): Promise<number> {
  const me = claimant(args)
  const repo = checkoutOf(opt(args, "repo") ?? process.cwd())
  topicPost(boardTopic(repo), me, "pause", { data: { note: opt(args, "note") ?? null } })
  printResult(
    args,
    { repo, paused: true },
    `paused in ${repo}; claims still hold, \`resume\` to go on`,
  )
  return 0
}

export async function cmdResume(args: Args): Promise<number> {
  const me = claimant(args)
  const repo = checkoutOf(opt(args, "repo") ?? process.cwd())
  topicPost(boardTopic(repo), me, "resume", { data: {} })
  printResult(args, { repo, paused: false }, `resumed in ${repo}`)
  return 0
}
