// The automations of this computer: where a task's events go. One owner-only file in the home,
// because a URL's signing secret sits in it; the settings file is readable by others and loaded by
// the web page, so nothing of this goes there. The App and the command line both write this file.

import { randomBytes } from "node:crypto"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { automationsFile } from "../paths.ts"
import { ownerOnlyFile } from "../platform.ts"
import { maskKey } from "../redaction.ts"
import { applyAutomationChange, validateChange, validateNewAutomation } from "./store-mutations.ts"
import {
  type Automation,
  type AutomationChange,
  type AutomationKind,
  checkTarget,
  FILE_NAME,
  type Loaded,
  type NewAutomation,
  parseAutomationsText,
} from "./store-parse.ts"
import { type KnownProject, knownProjects, resolveProjects } from "./store-projects.ts"

export {
  type Automation,
  type AutomationChange,
  type AutomationKind,
  checkTarget,
  type KnownProject,
  knownProjects,
  type Loaded,
  type NewAutomation,
  resolveProjects,
}

/** A secret as lists and logs show it: enough to tell which one, never the secret. */
export const maskSecret = maskKey

/** The automation as `list` and the App show it: the secret masked. */
export function shownAutomation(automation: Automation): Automation {
  return automation.secret === undefined
    ? automation
    : { ...automation, secret: maskSecret(automation.secret) }
}

/** Whether the automation takes this event of this project: it is on, and the event and project are among its own. */
export function takesEvent(automation: Automation, event: string, projectId: string): boolean {
  return (
    automation.on &&
    (automation.events === "all" || automation.events.includes(event)) &&
    (automation.projects === "all" || automation.projects.includes(projectId))
  )
}

/**
 * Every automation, on or off. One read of one file: a computer without automations pays this much
 * for each event it writes. A missing file is no automations; a file that cannot be read or parsed
 * is read as none, with the reason, and is never overwritten by `addAutomation`.
 */
export async function readAutomations(ctx: Ctx): Promise<Loaded> {
  const path = automationsFile(ctx)
  try {
    return parseAutomationsText(await ctx.fs.readFile(path))
  } catch (cause) {
    let present = true
    try {
      present = await ctx.fs.exists(path)
    } catch {
      // unknown: treat as present, so the reason is shown
    }
    return {
      automations: [],
      problem: present ? `${FILE_NAME} cannot be read: ${(cause as Error).message}` : null,
    }
  }
}

/** Write the whole list, owner-only, replaced in one step. */
export async function writeAutomations(ctx: Ctx, automations: Automation[]): Promise<void> {
  const path = automationsFile(ctx)
  await ctx.fs.mkdir(ctx.home)
  await ctx.fs.atomicWrite(path, `${JSON.stringify(automations, null, 2)}\n`, { mode: 0o600 })
  // Windows protects a file by access rules, not mode bits.
  ownerOnlyFile(path)
}

/** Read, change and write under one lock: the App's server and a command may do it together. */
export async function changeAutomations<T>(
  ctx: Ctx,
  change: (current: Automation[]) => Result<{ automations: Automation[]; value: T }>,
): Promise<Result<T>> {
  await ctx.fs.mkdir(ctx.home)
  return ctx.fs.withLock(`${automationsFile(ctx)}.lock`, async () => {
    const loaded = await readAutomations(ctx)
    if (loaded.problem !== null)
      return err({
        code: "bad_args",
        message: `${loaded.problem}. Nothing was changed; mend or remove ${automationsFile(ctx)} first.`,
      })
    const changed = change(loaded.automations)
    if (!changed.ok) return changed
    await writeAutomations(ctx, changed.data.automations)
    return ok(changed.data.value)
  })
}

/** An id that is no automation here, with the ones there are, so the next call can name one. */
function unknownAutomation(id: string, automations: readonly Automation[]): Result<never> {
  return err({
    code: "bad_args",
    message:
      automations.length === 0
        ? `No automation "${id}": there are no automations. Add one with qualitylayer automations add.`
        : `No automation "${id}". The automations are: ${automations.map((automation) => automation.id).join(", ")}.`,
  })
}

/** One automation by id, or the reason there is none. */
export async function findAutomation(ctx: Ctx, id: string): Promise<Result<Automation>> {
  const { automations, problem } = await readAutomations(ctx)
  if (problem !== null) return err({ code: "bad_args", message: problem })
  const found = automations.find((automation) => automation.id === id)
  return found === undefined ? unknownAutomation(id, automations) : ok(found)
}

/**
 * Change one automation. A URL automation keeps its secret when it stays a URL; one that becomes a
 * URL gets a new secret (`newSecret` says so, for the reply to show it once), and one that becomes
 * a command loses it.
 */
export async function changeAutomation(
  ctx: Ctx,
  id: string,
  change: AutomationChange,
): Promise<Result<{ automation: Automation; newSecret: boolean }>> {
  const validated = validateChange(change)
  if (!validated.ok) return validated
  return changeAutomations(ctx, (current) => {
    const old = current.find((automation) => automation.id === id)
    if (old === undefined) return unknownAutomation(id, current)
    const updated = applyAutomationChange(old, validated.data)
    return ok({
      automations: current.map((entry) => (entry.id === id ? updated.automation : entry)),
      value: updated,
    })
  })
}

/** Remove one automation; returns it, so the caller can say what went. */
export async function removeAutomation(ctx: Ctx, id: string): Promise<Result<Automation>> {
  return changeAutomations(ctx, (current) => {
    const old = current.find((automation) => automation.id === id)
    if (old === undefined) return unknownAutomation(id, current)
    return ok({ automations: current.filter((entry) => entry.id !== id), value: old })
  })
}

const newId = (taken: ReadonlySet<string>): string => {
  for (;;) {
    const id = `au_${randomBytes(4).toString("hex")}`
    if (!taken.has(id)) return id
  }
}

/** Add an automation: a URL gets a signing secret of 32 random bytes (hex); a command gets none. */
export async function addAutomation(ctx: Ctx, input: NewAutomation): Promise<Result<Automation>> {
  const validated = validateNewAutomation(input)
  if (!validated.ok) return validated
  const { kind, target, events, projects, secret } = validated.data
  return changeAutomations(ctx, (current) => {
    const automation: Automation = {
      id: newId(new Set(current.map((a) => a.id))),
      kind,
      target,
      events,
      projects,
      on: true,
      ...(kind === "url" ? { secret: secret ?? randomBytes(32).toString("hex") } : {}),
      created: ctx.clock.now(),
    }
    return ok({ automations: [...current, automation], value: automation })
  })
}
