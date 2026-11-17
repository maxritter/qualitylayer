// The automations of this computer: where a task's events go. One owner-only file in the home,
// because a URL's signing secret sits in it; the settings file is readable by others and loaded by
// the web page, so nothing of this goes there. The App and the command line both write this file.

import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { automationsFile } from "../paths.ts"
import { ownerOnlyFile } from "../platform.ts"
import { maskKey } from "../redaction.ts"
import { isPublicEvent, PUBLIC_EVENTS } from "./events.ts"

export type AutomationKind = "url" | "command"

export type Automation = {
  /** `au_` and eight characters. */
  id: string
  kind: AutomationKind
  /** The URL, or the command line. */
  target: string
  events: "all" | string[]
  /** Project ids; "all" is every project on this computer. */
  projects: "all" | string[]
  on: boolean
  /** The URL's signing secret; a command has none. */
  secret?: string
  created: number
}

export type NewAutomation = {
  kind: AutomationKind
  target: string
  events?: "all" | string[]
  projects?: "all" | string[]
  /** A URL's signing secret when the caller made it (the App's form shows it before Save); else one is made. */
  secret?: string
}

export type Loaded = {
  automations: Automation[]
  /** Why the file could not be used (then `automations` is empty); null when it is fine or absent. */
  problem: string | null
}

const ID_PATTERN = /^au_[0-9a-f]{8}$/
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const FILE_NAME = "automations.json"

const eventsHelp = () => `The events are: ${PUBLIC_EVENTS.join(", ")}.`

/** A secret as lists and logs show it: enough to tell which one, never the secret. */
export const maskSecret = maskKey

/** The automation as `list` and the App show it: the secret masked. */
export function shownAutomation(automation: Automation): Automation {
  return automation.secret === undefined
    ? automation
    : { ...automation, secret: maskSecret(automation.secret) }
}

function checkEvents(value: unknown): Result<"all" | string[]> {
  if (value === undefined || value === "all") return ok("all")
  if (!Array.isArray(value) || value.length === 0)
    return err({
      code: "bad_args",
      message: `Name at least one event, or "all". ${eventsHelp()}`,
    })
  const unknown = value.filter((name) => !isPublicEvent(name))
  if (unknown.length > 0)
    return err({
      code: "bad_args",
      message: `Unknown event ${unknown.map((name) => `"${String(name)}"`).join(", ")}. ${eventsHelp()}`,
    })
  return ok([...new Set(value as string[])])
}

function checkProjects(value: unknown): Result<"all" | string[]> {
  if (value === undefined || value === "all") return ok("all")
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || id.trim() === "")
  )
    return err({
      code: "bad_args",
      message: 'Name at least one project, or "all" for every project on this computer.',
    })
  return ok([...new Set((value as string[]).map((id) => id.trim()))])
}

/** Whether the automation takes this event of this project: it is on, and the event and project are among its own. */
export function takesEvent(automation: Automation, event: string, projectId: string): boolean {
  return (
    automation.on &&
    (automation.events === "all" || automation.events.includes(event)) &&
    (automation.projects === "all" || automation.projects.includes(projectId))
  )
}

export type KnownProject = { id: string; name: string }

/** The projects registered on this computer, by id. */
export async function knownProjects(ctx: Ctx): Promise<KnownProject[]> {
  const dir = join(ctx.home, "projects")
  let ids: string[]
  try {
    ids = (await ctx.fs.readdir(dir)).sort()
  } catch {
    return []
  }
  const found: KnownProject[] = []
  for (const id of ids) {
    try {
      const raw = JSON.parse(await ctx.fs.readFile(join(dir, id, "project.json"))) as {
        name?: unknown
      }
      found.push({
        id,
        name:
          typeof raw.name === "string" && raw.name !== ""
            ? raw.name
            : id.replace(/-[0-9a-f]{12}$/, ""),
      })
    } catch {
      // a folder without a readable project file is no project
    }
  }
  return found
}

/**
 * Projects named by name or by id, as their ids: `all` is every project. A name two projects share
 * is refused with both ids; an unknown one with the projects there are.
 */
export async function resolveProjects(
  ctx: Ctx,
  given: string[],
): Promise<Result<"all" | string[]>> {
  const names = [...new Set(given.map((name) => name.trim()).filter((name) => name !== ""))]
  if (names.length === 0)
    return err({
      code: "bad_args",
      message: 'Name at least one project, or "all" for every project on this computer.',
    })
  if (names.length === 1 && names[0] === "all") return ok("all")
  const projects = await knownProjects(ctx)
  const listing = () =>
    projects.length === 0
      ? "No project is registered on this computer yet."
      : `The projects are: ${projects.map((project) => `${project.name} (${project.id})`).join(", ")}.`
  const ids: string[] = []
  for (const name of names) {
    const byId = projects.find((project) => project.id === name)
    const byName = projects.filter((project) => project.name.toLowerCase() === name.toLowerCase())
    if (byId === undefined && byName.length === 0)
      return err({ code: "bad_args", message: `Unknown project "${name}". ${listing()}` })
    if (byId === undefined && byName.length > 1)
      return err({
        code: "bad_args",
        message: `More than one project is called "${name}": give the id, one of ${byName.map((project) => project.id).join(", ")}.`,
      })
    ids.push((byId ?? byName[0])?.id ?? name)
  }
  return ok([...new Set(ids)])
}

/** The target as a person typed it, or the reason it cannot be one. */
export function checkTarget(kind: AutomationKind, target: unknown): Result<string> {
  const text = typeof target === "string" ? target.trim() : ""
  if (kind === "command") {
    if (text === "") return err({ code: "bad_args", message: "The command is empty." })
    return ok(text)
  }
  let url: URL | null = null
  try {
    url = new URL(text)
  } catch {
    // reported below with the rest of the rule
  }
  // The scheme is right and no host follows it (`http://`, `http://:8080/x`): say that.
  if (/^https?:\/\//i.test(text) && (url === null || url.hostname === ""))
    return err({
      code: "bad_args",
      message:
        "That URL names no host: give the whole address, for example https://example.com/hook.",
    })
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
    return err({
      code: "bad_args",
      message: "A URL must start with http:// or https://, for example https://example.com/hook.",
    })
  return ok(text)
}

/** One stored entry, or the reason it is not one. */
function entryOf(value: unknown, index: number): Automation | string {
  const at = `entry ${index + 1}`
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return `${at} is not an object`
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return `${at} has no valid id`
  if (raw.kind !== "url" && raw.kind !== "command") return `${at} has no kind`
  const target = checkTarget(raw.kind, raw.target)
  if (!target.ok) return `${at}: ${target.error.message}`
  const events = checkEvents(raw.events ?? "all")
  if (!events.ok) return `${at}: ${events.error.message}`
  const projects = checkProjects(raw.projects ?? "all")
  if (!projects.ok) return `${at}: ${projects.error.message}`
  if (raw.kind === "url" && (typeof raw.secret !== "string" || raw.secret === ""))
    return `${at} is a URL without a secret`
  if (raw.on !== undefined && typeof raw.on !== "boolean") return `${at}.on must be true or false`
  return {
    id: raw.id,
    kind: raw.kind,
    target: target.data,
    events: events.data,
    projects: projects.data,
    on: raw.on !== false,
    ...(raw.kind === "url" ? { secret: raw.secret as string } : {}),
    created: typeof raw.created === "number" ? raw.created : 0,
  }
}

/**
 * Every automation, on or off. One read of one file: a computer without automations pays this much
 * for each event it writes. A missing file is no automations; a file that cannot be read or parsed
 * is read as none, with the reason, and is never overwritten by `addAutomation`.
 */
export async function readAutomations(ctx: Ctx): Promise<Loaded> {
  const path = automationsFile(ctx)
  let text: string
  try {
    text = await ctx.fs.readFile(path)
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
  if (text.trim() === "") return { automations: [], problem: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return {
      automations: [],
      problem: `${FILE_NAME} is not valid JSON: ${(cause as Error).message}`,
    }
  }
  if (!Array.isArray(parsed))
    return { automations: [], problem: `${FILE_NAME} should hold a list of automations` }
  const automations: Automation[] = []
  for (const [index, value] of parsed.entries()) {
    const entry = entryOf(value, index)
    if (typeof entry === "string") return { automations: [], problem: `${FILE_NAME}: ${entry}` }
    automations.push(entry)
  }
  return { automations, problem: null }
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

/** What `set` changes: a target (and with it the kind), the events, the projects, on or off. */
export type AutomationChange = {
  target?: { kind: AutomationKind; target: string }
  events?: "all" | string[]
  projects?: "all" | string[]
  on?: boolean
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
  let target: Result<string> | null = null
  if (change.target !== undefined) {
    target = checkTarget(change.target.kind, change.target.target)
    if (!target.ok) return target
  }
  const events = change.events === undefined ? null : checkEvents(change.events)
  if (events !== null && !events.ok) return events
  const projects = change.projects === undefined ? null : checkProjects(change.projects)
  if (projects !== null && !projects.ok) return projects
  return changeAutomations(ctx, (current) => {
    const old = current.find((automation) => automation.id === id)
    if (old === undefined) return unknownAutomation(id, current)
    const kind = change.target?.kind ?? old.kind
    const { secret: oldSecret, ...rest } = old
    const secret = kind === "url" ? (oldSecret ?? randomBytes(32).toString("hex")) : undefined
    const automation: Automation = {
      ...rest,
      kind,
      target: target?.ok ? target.data : old.target,
      events: events?.ok ? events.data : old.events,
      projects: projects?.ok ? projects.data : old.projects,
      on: change.on ?? old.on,
      ...(secret !== undefined ? { secret } : {}),
    }
    return ok({
      automations: current.map((entry) => (entry.id === id ? automation : entry)),
      value: { automation, newSecret: kind === "url" && oldSecret === undefined },
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
  if (input.kind !== "url" && input.kind !== "command")
    return err({ code: "bad_args", message: "An automation is a url or a command." })
  const target = checkTarget(input.kind, input.target)
  if (!target.ok) return target
  const events = checkEvents(input.events)
  if (!events.ok) return events
  const projects = checkProjects(input.projects)
  if (!projects.ok) return projects
  const given = input.secret
  if (given !== undefined && !SECRET_PATTERN.test(given))
    return err({
      code: "bad_args",
      message: "A signing secret is 16 to 128 letters, digits, dashes or underscores.",
    })
  return changeAutomations(ctx, (current) => {
    const automation: Automation = {
      id: newId(new Set(current.map((a) => a.id))),
      kind: input.kind,
      target: target.data,
      events: events.data,
      projects: projects.data,
      on: true,
      ...(input.kind === "url" ? { secret: given ?? randomBytes(32).toString("hex") } : {}),
      created: ctx.clock.now(),
    }
    return ok({ automations: [...current, automation], value: automation })
  })
}
