import { basename } from "node:path"
import { resolveRepo } from "../../core/paths.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { memoryService } from "../../memory-runtime.ts"
import { REVIEWERS_READ_ONLY, runMemoryTool } from "../../memory-tools.ts"
import { type MemoryService, runRecordAction, runSearchOrContext } from "./memory-actions.ts"
import {
  buildMemoryQuery,
  MEMORY_USAGE,
  type ParsedMemoryArgs,
  parseMemoryArgs,
  readToolInput,
} from "./memory-parse.ts"
import { runImportPilotAction, runStoreAction } from "./memory-write.ts"

const RECORD_ACTIONS = new Set(["read", "confirm", "retire", "restore", "pin", "unpin"])

async function runToolAction(
  ctx: Ctx,
  rest: string[],
  make: () => MemoryService,
  readInput: () => Promise<string>,
): Promise<Result<unknown>> {
  const [name, given] = rest
  if (!name || rest.length > 2) throw new Error(MEMORY_USAGE)
  const raw = given ?? (await readInput())
  let parsed: unknown
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    throw new Error("Tool arguments must be one JSON object.")
  }
  return runMemoryTool(ctx, name, parsed, make)
}

async function runGlobalAction(
  service: MemoryService,
  parsed: ParsedMemoryArgs,
): Promise<Result<unknown> | null> {
  const { action, rest, flags } = parsed
  if (action === "pause" || action === "resume")
    return ok(await service.settings({ enabled: action === "resume" }))
  if (action === "sessions") {
    if (rest.length !== 1 || !["on", "off"].includes(rest[0] ?? "")) throw new Error(MEMORY_USAGE)
    return ok(await service.settings({ sessions: rest[0] === "on" }))
  }
  // Every project's lessons, so it needs no repository: install runs it from anywhere.
  if (action === "reindex") return ok(await service.reindex())
  if (action === "projects")
    return ok(
      await service.projects({
        query: flags.query,
        cursor: flags.cursor,
        limit: buildMemoryQuery(flags, "").limit,
      }),
    )
  return null
}

function reconcileAction(
  service: MemoryService,
  project: string,
  rest: string[],
  flags: Record<string, string>,
): Promise<Result<unknown>> {
  const revision = Number(flags.revision)
  if (rest.length !== 1 || !Number.isSafeInteger(revision) || revision < 1 || !flags.candidate)
    throw new Error(MEMORY_USAGE)
  return service.reconcile(project, rest[0] as string, revision, flags.candidate).then(ok)
}

function shareAction(
  service: MemoryService,
  project: string,
  rest: string[],
): Promise<Result<unknown>> {
  if (rest.length !== 1 || !["on", "off"].includes(rest[0] ?? "")) throw new Error(MEMORY_USAGE)
  return service.sharing(project, rest[0] === "on").then(ok)
}

async function runProjectAction(
  ctx: Ctx,
  service: MemoryService,
  project: string,
  parsed: ParsedMemoryArgs,
): Promise<Result<unknown>> {
  const { action, rest, flags } = parsed
  const handlers: Record<string, () => Promise<Result<unknown>>> = {
    overview: () => service.overview(project).then(ok),
    list: () => service.list(buildMemoryQuery(flags, project)).then(ok),
    search: () => runSearchOrContext(ctx, service, project, parsed),
    context: () => runSearchOrContext(ctx, service, project, parsed),
    share: () => shareAction(service, project, rest),
    sync: () => {
      throw new Error(
        "Memory sync is retired. Use export to write project lessons, or import to explicitly restore tracked repository lessons.",
      )
    },
    export: () => service.exchange(project).then(ok),
    import: () => service.restoreProject(project).then(ok),
    conflicts: () => service.conflicts(project).then((conflicts) => ok({ conflicts })),
    reconcile: () => reconcileAction(service, project, rest, flags),
    store: () => runStoreAction(ctx, service, project, parsed),
    "import-pilot": () => runImportPilotAction(ctx, service, project, rest),
  }
  const handler = handlers[action]
  if (handler) return handler()
  if (RECORD_ACTIONS.has(action)) return runRecordAction(ctx, service, project, parsed)
  throw new Error(MEMORY_USAGE)
}

export async function memoryCmd(
  ctx: Ctx,
  args: string[],
  make: () => MemoryService = () => memoryService(ctx),
  readInput: () => Promise<string> = readToolInput,
): Promise<Result<unknown>> {
  let service: MemoryService | null = null
  try {
    const parsed = parseMemoryArgs(args)
    // The agents' tools: the plugins send the arguments as JSON on standard input.
    if (
      ["import", "reconcile"].includes(parsed.action) &&
      ctx.env.get("QUALITYLAYER_REVIEW_READ_ONLY") === "1"
    )
      throw new Error(REVIEWERS_READ_ONLY)
    if (parsed.action === "tool") return await runToolAction(ctx, parsed.rest, make, readInput)
    service = make()
    const globalResult = await runGlobalAction(service, parsed)
    if (globalResult !== null) return globalResult
    const repo = await resolveRepo(ctx)
    if (!repo.ok) return repo
    await service.registerProject({
      id: repo.data.id,
      name: basename(repo.data.root),
      root: repo.data.root,
    })
    await service.registerPersonal()
    return await runProjectAction(ctx, service, repo.data.id, parsed)
  } catch (cause) {
    return err({
      code: "bad_args",
      message: cause instanceof Error ? cause.message : "Memory command could not finish.",
    })
  } finally {
    await service?.close()
  }
}
