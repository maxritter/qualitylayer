// The build's slices and cards live in Implement's agents' file (`agents/02-implement.md`). Every
// reader of the build's authority reads them from there (parseOutline).

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { agentFileOf } from "./names.ts"
import { type Outline, parseOutline } from "./outline.ts"

/** The file that holds a task's slices and cards, from its task folder. */
export const cardsPath = (taskDir: string): string => join(taskDir, agentFileOf("implement"))

/** The text of a task's cards file; "" while it is not written. */
export async function readCardsText(ctx: Ctx, taskDir: string): Promise<string> {
  const path = cardsPath(taskDir)
  return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
}

/** A task's slices and cards, read from its cards file. */
export async function readCards(ctx: Ctx, taskDir: string): Promise<Outline> {
  return parseOutline(await readCardsText(ctx, taskDir))
}

/** Only written card titles count toward the build's shape. The raw parser keeps the template for validation. */
export async function readWrittenCards(ctx: Ctx, taskDir: string): Promise<Outline | null> {
  const outline = await readCards(ctx, taskDir)
  const slices = outline.slices.flatMap((slice) => {
    const tasks = slice.tasks.filter(
      ({ title }) => title.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim() !== "",
    )
    return tasks.length === 0 ? [] : [{ ...slice, tasks }]
  })
  return slices.length === 0 ? null : { ...outline, slices }
}
