// artifact guide [authoring|review] · artifact new <name> [--purpose "<line>"] [--project] [--wire] [--folder] [--on <artifact>[/<page>[,<page>…]]] ·
// artifact show <name> [--page <page>] [--changed "<line>"] [--open] [--terminal] · artifact keep <name> [--only-here] [--title "<title>"]
// [--purpose "<line>"] · artifact list · artifact check <name> [--page <page>] [--render] · artifact shot <name> [--page <page>] [--query <state-parameters>] [--width <px>] [--theme light|dark]
// [--matrix] [--section <label>] [--out <file>] · artifact comments <name> [resolve <id…|all> [--answer "<line>"]] ·
// artifact tokens <name> [--project] [--page <page>] [--refresh --if-match <revision>] ·
// artifact review <name> [--project] [--page <page>] [--request "<words>"] [--done --report <file>]

import { artifactQuery } from "../../core/app-routes.ts"
import type { Task } from "../../core/task/store.ts"
import { type Ctx, err, type Result } from "../../ctx.ts"
import { checkArtifactCmd } from "./artifact-check.ts"
import { artifactCommentsCmd } from "./artifact-comments-cmd.ts"
import { ARTIFACT_LIBRARY_USAGE, artifactLibraryCmd } from "./artifact-library.ts"
import { listCmd } from "./artifact-list.ts"
import { keepCmd, newCmd } from "./artifact-new.ts"
import { openCmd } from "./artifact-open.ts"
import { adoptCmd, contextCmd, guideCmd, reviewCmd } from "./artifact-review.ts"
import {
  ADOPTION_USAGE,
  ARTIFACT_USAGE,
  type ArtifactFlags,
  badArgs,
  REVIEW_USAGE,
  TOKENS_USAGE,
  type Where,
  WORKSPACE_USAGE,
  whereArtifact,
} from "./artifact-shared.ts"
import { readArtifactPage, shotCmd } from "./artifact-shot.ts"
import { showCmd } from "./artifact-show.ts"
import { tokensCmd } from "./artifact-tokens.ts"
import { workspaceCmd } from "./artifact-workspace.ts"
import { parseArgs } from "./shared.ts"

export { readArtifactPage }

const WORKSPACE_SUBS = new Set([
  "inspect",
  "push",
  "pull",
  "import",
  "export",
  "copy",
  "rename",
  "delete",
  "retire",
  "history",
  "restore",
  "metadata",
])

const STRICT_FLAGS: Readonly<Record<string, readonly string[]>> = {
  check: ["project", "page", "render"],
  open: ["project", "page", "section", "query", "browser", "no-open"],
  show: ["project", "page", "changed", "open", "terminal"],
}

const SUB_USAGE = {
  check:
    "qualitylayer artifact check <name> [--project] [--task <slug>] [--page <page>] [--render]",
  open: "qualitylayer artifact open <name> [--project] [--task <slug>] [--page <page>] [--query <state-parameters>] [--section <id-or-label>] [--browser] [--no-open]",
  show: "qualitylayer artifact show <name> [--project] [--task <slug>] [--page <page>] [--changed <line>] [--open] [--terminal]",
  shot: "qualitylayer artifact shot <name> [--page <page>] [--query <state-parameters>] [--width <px>] [--theme light|dark] [--matrix] [--section <label>] [--out <file>] [--task <slug>]",
  guide: "qualitylayer artifact guide [authoring|review]",
  review: `qualitylayer ${REVIEW_USAGE}`,
  new: 'qualitylayer artifact new <name> [--purpose "<line>"] [--project] [--wire] [--folder] [--on <artifact>[/<page>[,<page>…]]]',
  keep: 'qualitylayer artifact keep <name> [--only-here] [--title "<title>"] [--purpose "<line>"]',
  list: "qualitylayer artifact list [--project] [--task <slug>] [--lasting] [--name <name or title>] [--compact]",
  comments:
    'qualitylayer artifact comments <name> [--project] [--page <page>] [resolve <id…|all> [--answer "<one line>"]] · artifact comments add <name> [--project] [--page <page>] [--section <id>] --asked "<the person\'s words>"',
  tokens: `qualitylayer ${TOKENS_USAGE}`,
  adopt: `qualitylayer ${ADOPTION_USAGE}`,
  library: ARTIFACT_LIBRARY_USAGE,
} as const

function artifactArgs(args: string[]) {
  return parseArgs(args, [
    "name",
    "purpose",
    "changed",
    "width",
    "theme",
    "section",
    "out",
    "answer",
    "from",
    "to",
    "if-match",
    "revision",
    "into",
    "target-revision",
    "title",
    "page",
    "query",
    "asked",
    "request",
    "report",
    // `artifact new --on` names an artifact.
    ...(args[0] === "new" ? ["on"] : []),
  ])
}

/** Passive artifact tools join only the workflow explicitly named or bound to this session. */
export async function artifactWorkflowTask(ctx: Ctx, args: string[]): Promise<Task | null> {
  if (["guide", "library", "adopt", "claude"].includes(args[0] ?? "")) return null
  const { flags } = artifactArgs(args)
  const at = await whereArtifact(ctx, flags.project === true)
  return at.ok ? at.data.task : null
}

/** What `qualitylayer artifact <sub> --help` prints: that subcommand's own usage, or null when it has none of its own. */
export function artifactSubUsage(sub: string | undefined): string | null {
  if (sub === undefined || !Object.hasOwn(SUB_USAGE, sub)) return null
  return SUB_USAGE[sub as keyof typeof SUB_USAGE]
}

function normalizeQueryFlags(flags: ArtifactFlags): Result<never> | null {
  if (typeof flags.page === "string" && flags.page.includes("?")) {
    if (flags.query !== undefined)
      return badArgs("Use either the page's query or --query, not both")
    const mark = flags.page.indexOf("?")
    flags.query = flags.page.slice(mark + 1)
    flags.page = flags.page.slice(0, mark)
  }
  if (flags.query === undefined) return null
  if (typeof flags.query !== "string") return badArgs("--query needs state parameters")
  const query = artifactQuery(flags.query)
  if (query === null)
    return badArgs(
      "State parameters must fit in 2048 URL characters and contain no raw control characters",
    )
  flags.query = query
  return null
}

function validatePreDispatch(
  ctx: Ctx,
  sub: string | undefined,
  name: string | undefined,
  rest: string[],
  flags: ArtifactFlags,
): Result<never> | null {
  if (sub === "shot" || sub === "open") {
    const badQuery = normalizeQueryFlags(flags)
    if (badQuery !== null) return badQuery
  }
  const strict = sub ? STRICT_FLAGS[sub] : undefined
  if (strict && (rest.length > 0 || Object.keys(flags).some((key) => !strict.includes(key))))
    return badArgs(`usage: ${SUB_USAGE[sub as "check" | "open" | "show"]}`)
  if (sub === undefined || (!["list", "context"].includes(sub) && name === undefined))
    return badArgs(
      `${ARTIFACT_USAGE} · ${WORKSPACE_USAGE} · ${TOKENS_USAGE} · ${ARTIFACT_LIBRARY_USAGE} · artifact context · artifact check <name>`,
    )
  // `--task` (read by run() before this point) names the task's drafts; `--project` names the project's.
  if (
    ctx.invocationTask !== undefined &&
    flags.project === true &&
    ["open", "show", "check", "list", "review"].includes(sub)
  )
    return badArgs(
      `artifact ${sub}: --task selects a task's drafts and --project the project's; use one of them`,
    )
  return null
}

function dispatchArtifactSub(
  ctx: Ctx,
  at: Where,
  input: { sub: string; name: string; rest: string[]; flags: ArtifactFlags },
): Promise<Result<unknown>> | Result<unknown> {
  const { sub, name, rest, flags } = input
  if (sub === "check") return checkArtifactCmd(ctx, at, name, flags)
  if (WORKSPACE_SUBS.has(sub)) return workspaceCmd(ctx, at, sub, name, flags)
  const handlers: Record<string, () => Promise<Result<unknown>> | Result<unknown>> = {
    adopt: () => adoptCmd(ctx, at, name, rest, flags),
    context: () => contextCmd(ctx, at),
    open: () => openCmd(ctx, at, name, flags),
    new: () => newCmd(ctx, at, name, flags),
    show: () => showCmd(ctx, at, name, flags),
    keep: () => keepCmd(ctx, at, name, flags),
    list: () => listCmd(ctx, at, flags),
    comments: () => artifactCommentsCmd(ctx, at, name, rest, flags),
    shot: () => shotCmd(ctx, at, name, flags),
    review: () => reviewCmd(ctx, at, name, rest, flags),
    tokens: () =>
      rest.length > 0
        ? badArgs(`usage: qualitylayer ${TOKENS_USAGE}`)
        : tokensCmd(ctx, at, name, flags),
  }
  const handler = handlers[sub]
  return handler ? handler() : err({ code: "bad_args", message: ARTIFACT_USAGE })
}

function dispatchGuide(
  ctx: Ctx,
  name: string | undefined,
  rest: string[],
  flags: ArtifactFlags,
): Promise<Result<unknown>> | Result<unknown> {
  const validTopic = name === undefined || name === "authoring" || name === "review"
  if (!validTopic || rest.length > 0 || Object.keys(flags).length > 0)
    return badArgs("usage: qualitylayer artifact guide [authoring|review]")
  return guideCmd(ctx, name ?? "authoring")
}

export async function artifactCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "library") return artifactLibraryCmd(ctx, args.slice(1))
  const { positional, flags } = artifactArgs(args)
  const [sub, target, ...remaining] = positional
  const addingComment = sub === "comments" && target === "add"
  const name = addingComment ? remaining[0] : target
  const rest = addingComment ? ["add", ...remaining.slice(1)] : remaining
  if (sub === "guide") return dispatchGuide(ctx, name, rest, flags)
  const bad = validatePreDispatch(ctx, sub, name, rest, flags)
  if (bad !== null) return bad
  const at = await whereArtifact(ctx, flags.project === true)
  if (!at.ok) return at
  return dispatchArtifactSub(ctx, at.data, {
    sub: sub as string,
    name: name as string,
    rest,
    flags,
  })
}
