import type { Ctx, Git } from "../../ctx.ts"

type Lookup = "topLevel" | "commonDir"

function createRepoCache(ctx: Ctx, cwd: string) {
  const answers: Partial<Record<Lookup, Promise<string | null>>> = {}
  const clear = () => {
    delete answers.topLevel
    delete answers.commonDir
  }
  const start = (method: Lookup): Promise<string | null> => {
    const kept = answers[method]
    if (kept !== undefined) return kept
    const pending = Promise.resolve().then(() => ctx.git[method](cwd))
    answers[method] = pending
    const forget = () => {
      if (answers[method] === pending) delete answers[method]
    }
    pending.then((answer) => (answer === null ? forget() : undefined), forget)
    return pending
  }
  const read = (method: Lookup, where: string): Promise<string | null> => {
    if (where !== cwd || ctx.env.cwd() !== cwd) return ctx.git[method](where)
    const top = start("topLevel")
    const common = start("commonDir")
    return method === "topLevel" ? top : common
  }
  return { clear, read }
}

/** Discovery is stable within one activity hook; task and permission reads stay live. */
export function activityRepository(ctx: Ctx, session: unknown): Ctx {
  if (typeof session !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(session.trim())) return ctx
  const { clear, read } = createRepoCache(ctx, ctx.env.cwd())
  const git: Git = {
    commitPaths: async (where, paths, message, authority) => {
      clear()
      try {
        return await ctx.git.commitPaths(where, paths, message, authority)
      } finally {
        clear()
      }
    },
    run: (where, args, options) => {
      clear()
      return ctx.git.run(where, args, options)
    },
    topLevel: (where) => read("topLevel", where),
    commonDir: (where) => read("commonDir", where),
  }
  return { ...ctx, git }
}
