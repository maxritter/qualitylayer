import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { windows, windowsHookCommand } from "../../platform.ts"
import { selfCommand } from "../../self.ts"
import { asRecord, codexHome, writeJsonAtomic } from "../base.ts"
import { type Args, fail, flag, out } from "./arguments.ts"

export function hookCommand(autoAttach: boolean): string {
  if (windows) {
    const [command, ...args] = selfCommand([
      "peers",
      "session-hook",
      ...(autoAttach ? ["--auto-attach"] : []),
    ])
    return windowsHookCommand(command as string, args)
  }
  const parts = selfCommand(["peers", "session-hook"]).map((p) =>
    /^[\w./-]+$/.test(p) ? p : `'${p.replaceAll("'", "'\\''")}'`,
  )
  return `${parts.join(" ")}${autoAttach ? " --auto-attach" : ""}`
}

export function hookEntry(autoAttach: boolean) {
  return {
    matcher: "startup|resume",
    hooks: [{ type: "command", command: hookCommand(autoAttach), timeout: 10 }],
  }
}

/** Is this hook command ours, or the session-peers skill's that QualityLayer replaces? */
export function isBridgeHook(command: unknown): boolean {
  if (typeof command !== "string") return false
  return (
    command === hookCommand(false) ||
    command === hookCommand(true) ||
    /peers session-hook/.test(command) ||
    /session-peers\/scripts\/peers\.py['"]? session-hook/.test(command)
  )
}

export function backupFile(path: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const backup = `${path}.qualitylayer-bak-${stamp}`
  copyFileSync(path, backup)
  return backup
}

function replaceBridgeEntries(entries: unknown[]) {
  let replaced = 0
  const kept = entries
    .map((entry) => {
      const rec = asRecord(entry)
      const hooks = Array.isArray(rec?.hooks) ? rec.hooks : []
      const others = hooks.filter((h) => !isBridgeHook(asRecord(h)?.command))
      replaced += hooks.length - others.length
      if (others.length === hooks.length) return entry
      return others.length > 0 ? { ...rec, hooks: others } : null
    })
    .filter((entry) => entry !== null)
  return { kept, replaced }
}

function sameBridgeEntry(entry: unknown, desired: ReturnType<typeof hookEntry>): boolean {
  const rec = asRecord(entry)
  const hooks = Array.isArray(rec?.hooks) ? rec.hooks : []
  if (rec?.matcher !== desired.matcher || hooks.length !== 1) return false
  const hook = asRecord(hooks[0])
  return hook?.command === desired.hooks[0]?.command && hook?.timeout === desired.hooks[0]?.timeout
}

export async function cmdInstallHook(args: Args): Promise<number> {
  const path = join(codexHome(), "hooks.json")
  mkdirSync(codexHome(), { recursive: true })
  const autoAttach = flag(args, "auto-attach")
  let data: Record<string, unknown> | null = null
  let created = false
  if (!existsSync(path)) created = true
  else {
    try {
      data = asRecord(JSON.parse(readFileSync(path, "utf8")))
    } catch (cause) {
      // Never overwrite a file we could not read: its other entries would go with it.
      const backup = backupFile(path)
      return fail(
        `${path} is not valid JSON (${(cause as Error).message}). It was copied to ${backup} and left alone; fix it and re-run, or add this SessionStart entry by hand:\n  ${JSON.stringify(hookEntry(autoAttach))}`,
      )
    }
  }
  const root: Record<string, unknown> =
    data !== null && Object.keys(data).length > 0 ? data : { hooks: {} }
  const events = (asRecord(root.hooks) ?? root) as Record<string, unknown>
  const entries = Array.isArray(events.SessionStart) ? [...events.SessionStart] : []
  const desired = hookEntry(autoAttach)
  // Every bridge entry, ours or the skill's, is replaced by exactly one of ours.
  const { kept, replaced } = replaceBridgeEntries(entries)
  // Compare fields because saved hook keys may have a different order.
  const already = replaced === 1 && entries.some((entry) => sameBridgeEntry(entry, desired))
  if (already) {
    out(`SessionStart entry already installed in ${path}`)
    out(
      "Next: open Codex and run /hooks to trust it. Until you do, it is inert; `qualitylayer peers up` by hand does the same job.",
    )
    return 0
  }
  if (!created) out(`backed up ${path} to ${backupFile(path)}`)
  kept.push(desired)
  events.SessionStart = kept
  let mode = 0o600
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    // New hook files retain the private default permissions.
  }
  writeJsonAtomic(path, root, mode)
  out(
    `${replaced > 0 ? "updated" : "added"} one SessionStart entry in ${path}${replaced > 0 ? ` (replacing ${replaced} earlier bridge entr${replaced === 1 ? "y" : "ies"})` : ""}`,
  )
  out(
    "Next: open Codex and run /hooks to trust the new entry. Until you do, it is inert; `qualitylayer peers up` by hand does the same job.",
  )
  return 0
}
