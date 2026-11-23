import { resolve } from "node:path"
import { importCursorExport } from "../../core/cost/usage-cursor.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

const USAGE =
  "usage: qualitylayer usage import cursor <file.csv> --from <ISO time> --to <ISO time> [--account <local label>]"

const ALLOWED_FLAGS = new Set(["--from", "--to", "--account"])

function parseUsageFlags(rest: string[]): Map<string, string> | null {
  const flags = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key || !value || !ALLOWED_FLAGS.has(key) || flags.has(key)) return null
    flags.set(key, value)
  }
  return flags
}

export async function usageCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, provider, file, ...rest] = args
  const flags = parseUsageFlags(rest)
  const from = flags?.get("--from")
  const to = flags?.get("--to")
  if (sub !== "import" || provider !== "cursor" || !file)
    return err({ code: "bad_args", message: USAGE })
  if (!from || !to) return err({ code: "bad_args", message: USAGE })
  try {
    const rows = await importCursorExport(
      ctx,
      resolve(ctx.env.cwd(), file),
      Date.parse(from),
      Date.parse(to),
      flags?.get("--account"),
    )
    return ok({
      provider: "cursor",
      rows,
      note: "Local provider export imported. Usage after the snapshot remains unreported.",
    })
  } catch (error) {
    return err({
      code: "bad_args",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
