// The four memory tools every agent has: search, read, save and keep lessons. The stdio server
// (`qualitylayer memory mcp`), the Pi and OpenCode plugins (`qualitylayer memory tool <name>`) and
// the CLI call `runMemoryTool`, so a lesson is found, read, saved and kept the same way on every
// client. Lesson text and reasons leave here only inside a nonce-tagged data block; ids, source,
// states and flags stay outside it.

import { basename } from "node:path"
import { composeHits } from "./core/memory/ranking.ts"
import { MEMORY_KINDS } from "./core/memory/validation.ts"
import { resolveRepo } from "./core/paths.ts"
import { resolveBoundTask } from "./core/task/store.ts"
import { type Ctx, err, type Result } from "./ctx.ts"
import { type MemoryPreview, type MemorySemantic, PERSONAL_PROJECT } from "./memory-contracts.ts"
import { memoryService } from "./memory-runtime.ts"
import {
  handleReadTool,
  handleSearchTool,
  type MemoryToolService,
  QUERY_MAX,
  SCOPES,
  SEARCH_LIMIT_MAX,
  type ToolContext,
} from "./memory-tools-read.ts"
import {
  ABOUT,
  handleKeepTool,
  handleSaveTool,
  KEEP_ACTIONS,
  REASON_MAX,
  RESTS_ON_MAX,
} from "./memory-tools-write.ts"

export const MEMORY_NOT_A_REPO = "This folder is not a memory repository."

export type MemoryToolName = "memory_search" | "memory_read" | "memory_save" | "memory_keep"
export type MemoryTool = { name: MemoryToolName; description: string; inputSchema: object }
export type MemorySearchScope = (typeof SCOPES)[number]
const kinds = [...MEMORY_KINDS]
/** Reviewers only read: the plugins refuse their writes, and so does every path through here. */
export const REVIEWERS_READ_ONLY = "Reviewers do not save or keep lessons."

export const MEMORY_TOOLS: MemoryTool[] = [
  {
    name: "memory_search",
    description:
      "Search project and personal lessons by words and meaning when earlier decisions may affect the work, including in a fresh session or after compaction. Start with a repository-relative file path or a concrete code symbol. If a broad query finds nothing, try a file you just read. Each hit includes its scope, saved/check dates and whether its files changed. Read a hit in full and check it against current code.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: QUERY_MAX },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT_MAX },
        scope: { type: "string", enum: [...SCOPES] },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_read",
    description:
      "Read one saved lesson in full by its id. With around (1 to 3) it also names the lessons saved just before and after it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        around: { type: "integer", minimum: 0, maximum: 3 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_save",
    description:
      'Save one lesson about this project: one constraint, decision, reusable fix or project term (title it Term: <word>), the reason it holds and the files it is about, so a later agent can tell when the reason no longer does. Set about to "you" for how the person likes to work, a preference that would hold in any repository: it stays on this computer, takes no files and is found in every repository. Everything about this code stays with the repository. Write the decision, not what the code does: the code says that. Search first. To edit an existing lesson, read it and pass its id and current revision. For a new lesson that replaces an older claim, pass replaces with the older id. Name in rests_on the task decision it rests on. Use repository-relative paths; leave out prompts, logs, credentials and personal details.',
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        content: { type: "string", minLength: 1, maxLength: 24000 },
        kind: { type: "string", enum: kinds },
        files: { type: "array", items: { type: "string", maxLength: 512 }, maxItems: 32 },
        replaces: { type: "string", minLength: 1 },
        id: { type: "string", minLength: 1 },
        revision: { type: "integer", minimum: 1 },
        rests_on: { type: "string", minLength: 1, maxLength: RESTS_ON_MAX },
        about: { type: "string", enum: [...ABOUT] },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_keep",
    description:
      "Keep a saved lesson true after reading it against the code: confirm that it still holds (its files are then checked at the current commit), retire one that is false with the reason, or restore a retired one. To correct a lesson, save the corrected one with memory_save and replaces instead. A lesson about the person has no commit to confirm against: retire it when they say otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        action: { type: "string", enum: [...KEEP_ACTIONS] },
        reason: { type: "string", minLength: 1, maxLength: REASON_MAX },
      },
      required: ["id", "action"],
      additionalProperties: false,
    },
  },
]

const bad = (message: string) => err({ code: "bad_args", message })

/** What a lesson rests on is its last line, so the shared record keeps the fields 12.0 reads. */
export function withRestsOn(content: string, restsOn: string | undefined): string {
  const named = restsOn?.replace(/\s+/g, " ").trim()
  return named ? `${content.trimEnd()}\n\nRests on: ${named}` : content
}

function object(args: unknown): Record<string, unknown> | null {
  if (args === undefined || args === null) return {}
  return typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null
}

function only(args: Record<string, unknown>, names: string[]): string | null {
  const stray = Object.keys(args).find((key) => !names.includes(key))
  return stray === undefined ? null : `Unknown argument: ${stray}.`
}

export const scopeOf = (project: string): "repo" | "you" =>
  project === PERSONAL_PROJECT ? "you" : "repo"

/**
 * An agent's search of this repository and the lessons about the person, the query embedded once.
 * The repository's hits keep their relevance order, then the person's, who keep up to
 * two slots of the page.
 */
export async function searchLessons(
  service: MemoryToolService,
  project: string,
  query: string,
  limit: number,
  scope: MemorySearchScope = "all",
): Promise<{ lessons: MemoryPreview[]; semantic: MemorySemantic; issue?: string }> {
  const projects =
    scope === "repo"
      ? [project]
      : scope === "you"
        ? [PERSONAL_PROJECT]
        : [project, PERSONAL_PROJECT]
  const found = await service.searchProjects(projects, query, SEARCH_LIMIT_MAX)
  const [first = [], second = []] = found.lessons
  const lessons =
    scope === "all"
      ? composeHits(first, second, limit)
      : composeHits(scope === "repo" ? first : [], scope === "you" ? first : [], limit)
  return { lessons, semantic: found.semantic, ...(found.issue ? { issue: found.issue } : {}) }
}

const TOOL_HANDLERS: Record<
  MemoryToolName,
  (toolCtx: ToolContext, given: Record<string, unknown>) => Promise<Result<unknown>>
> = {
  memory_search: handleSearchTool,
  memory_read: handleReadTool,
  memory_keep: handleKeepTool,
  memory_save: handleSaveTool,
}

function validateToolCall(
  ctx: Ctx,
  name: string,
  args: unknown,
): { toolName: MemoryToolName; given: Record<string, unknown> } | { error: Result<unknown> } {
  const tool = MEMORY_TOOLS.find((entry) => entry.name === name)
  if (!tool) return { error: bad(`Unknown memory tool: ${name}.`) }
  const given = object(args)
  if (!given) return { error: bad("Tool arguments must be an object.") }
  const names = Object.keys((tool.inputSchema as { properties: object }).properties)
  const stray = only(given, names)
  if (stray) return { error: bad(stray) }
  const isWrite = tool.name === "memory_save" || tool.name === "memory_keep"
  if (isWrite && ctx.env.get("QUALITYLAYER_REVIEW_READ_ONLY") === "1")
    return { error: bad(REVIEWERS_READ_ONLY) }
  return { toolName: tool.name, given }
}

/**
 * Runs one tool for the repository the process stands in. A tool call in a session bound to a task
 * is counted in that task's Memory record and saves a task lesson; any other call saves a session
 * lesson and counts nowhere. `make` opens the service: a server keeps one for its whole life.
 */
export async function runMemoryTool(
  ctx: Ctx,
  name: string,
  args: unknown,
  make: () => MemoryToolService = () => memoryService(ctx),
): Promise<Result<unknown>> {
  const validated = validateToolCall(ctx, name, args)
  if ("error" in validated) return validated.error
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return err({ code: "not_a_repo", message: MEMORY_NOT_A_REPO })
  const service = make()
  try {
    const project = repo.data.id
    await service.registerProject({
      id: project,
      name: basename(repo.data.root),
      root: repo.data.root,
    })
    await service.registerPersonal()
    const task = await resolveBoundTask(ctx, repo.data)
    return await TOOL_HANDLERS[validated.toolName]({ ctx, service, project, task }, validated.given)
  } catch (cause) {
    return bad(cause instanceof Error ? cause.message : "Memory tool could not finish.")
  } finally {
    await service.close()
  }
}
