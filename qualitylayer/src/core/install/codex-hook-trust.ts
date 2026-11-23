export { queryCodexHooks } from "./codex-hook-query.ts"

type ObjectValue = Record<string, unknown>
const isObj = (value: unknown): value is ObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export type InstalledCodexHook = { event: string; group: unknown }
export type CodexHookTrust = { key: string; hash: string; trusted: boolean; event: string }

function isCleanList(value: unknown, mustBeEmpty: boolean): boolean {
  return Array.isArray(value) && (!mustBeEmpty || value.length === 0)
}

function validHookPage(listed: unknown, cwd: string, doc: unknown): unknown[] | null {
  if (!isObj(listed) || !Array.isArray(listed.data) || listed.data.length !== 1) return null
  const page = listed.data[0]
  if (!isObj(page) || page.cwd !== cwd || !isObj(doc)) return null
  const ok =
    isCleanList(page.hooks, false) &&
    isCleanList(page.errors, true) &&
    isCleanList(page.warnings, true)
  return ok ? (page.hooks as unknown[]) : null
}

function groupMatchesDefinition(
  group: unknown,
  definition: ObjectValue,
  handler: ObjectValue,
): boolean {
  if (!isObj(group) || Object.keys(group).length !== Object.keys(definition).length) return false
  if (
    group.matcher !== definition.matcher ||
    !Array.isArray(group.hooks) ||
    group.hooks.length !== 1
  )
    return false
  const actual = group.hooks[0]
  if (!isObj(actual) || Object.keys(actual).length !== Object.keys(handler).length) return false
  return !Object.entries(handler).some(([name, value]) => actual[name] !== value)
}

function rowMatchesSource(row: ObjectValue, file: string, event: string): boolean {
  const expectedEvent = `${event[0]?.toLowerCase() ?? ""}${event.slice(1)}`
  if (row.sourcePath !== file || row.source !== "user" || row.pluginId !== null) return false
  return row.eventName === expectedEvent && row.handlerType === "command"
}

function rowMatchesHandler(
  row: ObjectValue,
  definition: ObjectValue,
  handler: ObjectValue,
): boolean {
  if (row.command !== handler.command || row.async !== (handler.async ?? false)) return false
  if (row.matcher !== (definition.matcher ?? null) || row.timeoutSec !== handler.timeout)
    return false
  return (
    row.statusMessage === null &&
    row.additionalContextLimit === null &&
    row.enabled === true &&
    row.isManaged === false
  )
}

function isValidTrustRow(
  row: ObjectValue,
  file: string,
  expectedEvent: string,
  definition: ObjectValue,
  handler: ObjectValue,
): boolean {
  if (!rowMatchesSource(row, file, expectedEvent)) return false
  if (!rowMatchesHandler(row, definition, handler)) return false
  const validStatus = row.trustStatus === "untrusted" || row.trustStatus === "trusted"
  return (
    validStatus &&
    typeof row.currentHash === "string" &&
    row.currentHash.length === 71 &&
    /^sha256:[a-f0-9]{64}$/.test(row.currentHash)
  )
}

function matchInstalledHook(
  expected: InstalledCodexHook,
  events: ObjectValue,
  hooks: unknown[],
  file: string,
): CodexHookTrust | null {
  const groups = events[expected.event]
  if (!Array.isArray(groups) || !isObj(expected.group)) return null
  const definition = expected.group
  const handlers = definition.hooks
  if (!Array.isArray(handlers) || handlers.length !== 1 || !isObj(handlers[0])) return null
  const handler = handlers[0]
  const matches: CodexHookTrust[] = []
  let definitions = 0
  for (let index = 0; index < groups.length; index++) {
    if (!groupMatchesDefinition(groups[index], definition, handler)) continue
    definitions++
    const event = expected.event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
    const key = `${file}:${event}:${index}:0`
    const rows = hooks.filter((row) => isObj(row) && row.key === key)
    if (rows.length !== 1) continue
    const row = rows[0] as ObjectValue
    if (!isValidTrustRow(row, file, expected.event, definition, handler)) continue
    matches.push({
      key,
      hash: row.currentHash as string,
      trusted: row.trustStatus === "trusted",
      event: expected.event,
    })
  }
  return definitions === 1 && matches.length === 1 ? (matches[0] as CodexHookTrust) : null
}

/** Admit only installer-owned definitions, never a whole hook source or a command prefix. */
export function codexHookTrust(
  listed: unknown,
  cwd: string,
  file: string,
  doc: unknown,
  installed: InstalledCodexHook[],
): CodexHookTrust[] {
  const hooks = validHookPage(listed, cwd, doc)
  if (hooks === null) return []
  const docObj = doc as ObjectValue
  const events = isObj(docObj.hooks) ? docObj.hooks : docObj
  const result: CodexHookTrust[] = []
  for (const expected of installed) {
    const matched = matchInstalledHook(expected, events, hooks, file)
    if (matched) result.push(matched)
  }
  return result.filter(
    (entry, index) => result.findIndex((other) => other.key === entry.key) === index,
  )
}
