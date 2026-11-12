import type { Ctx } from "../../ctx.ts"

/** The same task with the environment naming it, as `--task <slug>` does for any command. */
export function forTask(ctx: Ctx, slug: string): Ctx {
  const inner = ctx.env
  return {
    ...ctx,
    env: {
      cwd: inner.cwd,
      get: (name) => (name === "QUALITYLAYER_TASK" ? slug : inner.get(name)),
    },
  }
}
