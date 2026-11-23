import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { chatSliceHelper, withBriefFiles } from "../briefs.ts"
import { sliceCommands, taskCommands } from "../docs/commands.ts"
import type { Outline } from "../docs/outline.ts"
import { staff } from "../helper-staff.ts"
import {
  endSliceHelpers,
  helperResultFile,
  helperResults,
  pendingHelperOffers,
  saveHelperResult,
  startHelpers,
} from "../helpers.ts"
import type { Task } from "../task/store.ts"
import { chatDocuments, chatLock, currentChat } from "./documents.ts"
import { parseChatSlices } from "./slices.ts"

/** No silence timeout: only a completion or explicit stop permits leaving Chat. */
export async function activeChatHelpers(ctx: Ctx, task: Task): Promise<string[]> {
  const path = join(task.runtimeDir, "helpers.json")
  if (!(await ctx.fs.exists(path))) return []
  try {
    const file = JSON.parse(await ctx.fs.readFile(path))
    if (file.stage !== "chat" || !Array.isArray(file.ids))
      throw new Error("Malformed helper identity")
    if (!file.lines || typeof file.lines !== "object" || Array.isArray(file.lines))
      throw new Error("Malformed helper progress")
    if (file.ids.some((id: unknown) => typeof id !== "string"))
      throw new Error("Malformed helper ids")
    return file.ids
      .filter((id: string) => file.lines[id]?.done !== true)
      .map((id: string) => (file.slices?.[id] ? `slice ${file.slices[id].n} (${id})` : id))
  } catch {
    return ["unreadable Chat helper state"]
  }
}

export async function stopChatSlice(ctx: Ctx, task: Task, n: number) {
  return ctx.fs.withLock(chatLock(task), async () => {
    if (!(await currentChat(ctx, task)))
      return err({ code: "bad_args", message: "This command needs an active Chat" })
    const stopped = await endSliceHelpers(ctx, task, n, "stopped explicitly")
    if (!stopped.length)
      return err({ code: "bad_args", message: `No running Chat helper for slice ${n}` })
    for (const id of stopped) {
      if (await ctx.fs.exists(join(task.dir, helperResultFile(id)))) continue
      const saved = await saveHelperResult(
        ctx,
        task,
        id,
        "stopped: Work was stopped explicitly by the lead; inspect edits and checks before resuming.",
      )
      if (!saved.ok) return saved
    }
    return ok({ stopped, note: "The lead must stop the native helper before recording this stop." })
  })
}

export async function buildChat(ctx: Ctx, task: Task, markdown?: string): Promise<Result<unknown>> {
  return ctx.fs.withLock(chatLock(task), async () => {
    const current = await currentChat(ctx, task)
    if (!current) return err({ code: "bad_args", message: "This command needs an active Chat" })
    const docs = await chatDocuments(ctx, current)
    if (!docs.plan.exists)
      return err({ code: "bad_args", message: "Save the Chat plan before building slices" })
    const active = await activeChatHelpers(ctx, current)
    if (active.length && markdown !== undefined)
      return err({
        code: "bad_args",
        message: `A slice is still building: ${active.join(", ")}; let it finish or stop it first`,
      })
    if (markdown === undefined && docs.slices.exists && active.length) {
      return ok({
        helpers: await pendingHelperOffers(ctx, current),
        running: active,
        results: await helperResults(ctx, current),
        resumed: true,
        slices: docs.slices.path,
      })
    }
    const resumed = markdown === undefined
    if (resumed && docs.slices.exists) markdown = await ctx.fs.readFile(docs.slices.path)
    if (markdown === undefined)
      return err({
        code: "bad_args",
        message: "Supply --file with slices derived from the saved plan",
      })
    const parsed = chatSlices(markdown)
    if (!parsed.ok) return parsed
    const outline = parsed.data
    if (!resumed) await ctx.fs.atomicWrite(docs.slices.path, markdown)
    const sliceOf: Record<string, number> = {}
    const helpers = outline.slices
      .filter((slice) => slice.tasks.some((card) => !card.checked))
      .map((slice) => {
        const id = `cs${slice.n}-${randomUUID().slice(0, 12)}`
        sliceOf[id] = slice.n
        return chatSliceHelper(
          current,
          {
            slice: slice.n,
            title: slice.title,
            cards: slice.tasks.map((card) => card.text),
            validation: slice.validation,
          },
          { read: [docs.plan.path], onDemand: [docs.slices.path] },
          id,
        )
      })
    const staffed = await staff(ctx, helpers)
    const filed = await withBriefFiles(ctx, current, staffed.on)
    await startHelpers(ctx, current, filed, sliceOf)
    return ok({ helpers: filed, slices: docs.slices.path, instructions: staffed.off, resumed })
  })
}

function hasValidSliceNumbers(outline: Outline): boolean {
  const numbers = outline.slices.map((slice) => slice.n)
  if (outline.malformed.length || !numbers.length || numbers.length > 32) return false
  return (
    numbers.every((n) => Number.isSafeInteger(n) && n >= 1) &&
    new Set(numbers).size === numbers.length
  )
}

function isValidChatCard(card: Outline["slices"][number]["tasks"][number]): boolean {
  return [card.objective, card.files.length, card.testFirst, taskCommands(card).length].every(
    Boolean,
  )
}

function isValidChatOutline(outline: Outline): boolean {
  if (!hasValidSliceNumbers(outline)) return false
  const cards = outline.slices.flatMap((slice) => slice.tasks)
  const ids = cards.map((card) => card.id)
  if (ids.length > 256 || new Set(ids).size !== ids.length) return false
  const validSlices = outline.slices.every(
    (slice) => slice.tasks.length > 0 && sliceCommands(slice).length > 0,
  )
  return validSlices && cards.every(isValidChatCard)
}

function chatSlices(markdown: string): Result<Outline> {
  const outline = parseChatSlices(markdown)
  if (!isValidChatOutline(outline)) {
    return err({
      code: "bad_args",
      message: "Supply complete unique slice cards with files, test first and validation checks",
    })
  }
  return ok(outline)
}
