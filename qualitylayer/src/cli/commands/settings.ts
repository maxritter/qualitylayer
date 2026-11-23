import { readConfig, refuseSettingsPatch, writeConfig } from "../../core/config.ts"
import { onlyInApp } from "../../core/run/contracts.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recheckAfterChannelChange } from "../../server/update.ts"

const usage = "usage: qualitylayer settings get [<key>] | settings set <key> <value>"
const bad = (message: string) => err({ code: "bad_args", message })

const MISSING = Symbol("no such setting")

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The value at a dotted key, or `MISSING` when the config has no such setting. */
function settingAt(config: unknown, parts: string[]): unknown {
  let held = config
  for (const part of parts) {
    if (!part || !isPlainObject(held) || !Object.hasOwn(held, part)) return MISSING
    held = held[part]
  }
  return held
}

function parseSettingValue(held: unknown, text: string | undefined): unknown {
  let value: unknown = text
  try {
    const parsed: unknown = JSON.parse(text ?? "")
    if (typeof held !== "string" || typeof parsed === "string") value = parsed
  } catch {
    /* Unquoted strings are accepted. */
  }
  // A list takes its entries separated by commas too: addedModels.pi openai/a,openai/b.
  if (Array.isArray(held) && typeof value === "string")
    value = value.split(",").map((entry) => entry.trim())
  return value
}

async function applySetting(
  ctx: Ctx,
  key: string,
  parts: string[],
  held: unknown,
  text: string | undefined,
): Promise<Result<unknown>> {
  const value = parseSettingValue(held, text)
  let patch: unknown = value
  for (const part of parts.toReversed()) patch = { [part]: patch }
  if (onlyInApp(patch as Record<string, unknown>))
    return bad(
      `${key} can only be changed in the App's Settings, not by an agent or the command line`,
    )
  const before = await readConfig(ctx)
  const refused = refuseSettingsPatch(patch, before.addedModels)
  if (refused !== null) return bad(refused)
  // A new update channel is checked at once, as when it is chosen in Settings › About.
  await recheckAfterChannelChange(ctx, before, await writeConfig(ctx, patch))
  return ok({
    key,
    value,
    ...(key === "cockpit.port"
      ? { note: "The server uses it when it starts again: run qualitylayer app restart." }
      : {}),
  })
}

export async function settingsCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, key, text] = args
  if (!((sub === "get" && args.length <= 2) || (sub === "set" && args.length === 3)))
    return bad(usage)
  const config = await readConfig(ctx)
  if (sub === "get" && key === undefined) return ok(config)
  const parts = (key ?? "").split(".")
  const held = settingAt(config, parts)
  if (held === MISSING) return bad(`${key} is not a setting`)
  if (sub === "get") return ok({ key, value: held })
  return applySetting(ctx, key ?? "", parts, held, text)
}
