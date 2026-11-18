import { warnVersions } from "../base.ts"
import { latestStatuses, STATUS_TOPIC } from "../claims.ts"
import { classifyClaudeRecords, defaultSocketDir, readClaudeRecords } from "../claude.ts"
import { codexThreads, readRegistered } from "../codex.ts"
import { NATIVE_KINDS, nativeRegistrations } from "../native.ts"
import { TOPIC_TAIL_MAX, topicTail } from "../topics.ts"
import type { Args } from "./arguments.ts"
import { codexView } from "./codex-inventory.ts"
import { printInventory } from "./list-render.ts"
import { claudeView, nativeView } from "./session-inventory.ts"

export async function collectInventory() {
  warnVersions()
  const classified = classifyClaudeRecords(
    readClaudeRecords().filter((r) => r.entrypoint !== "codex"),
  )
  const records = classified.filter(([, s]) => s === "live").map(([r]) => r)
  const unverified = classified.filter(([, s]) => s === "unverified").map(([r]) => r)
  const [threads, schemaOk] = codexThreads()
  const registered = readRegistered()
  // What each session said it is doing (`peers status set`).
  const said = latestStatuses(topicTail(STATUS_TOPIC, 0, TOPIC_TAIL_MAX).entries)
  const claude = await Promise.all(records.map((row) => claudeView(row, said)))
  const codex = await Promise.all(
    threads
      .filter((t) => t.live === true)
      .map((row) => codexView(row, { threads, records, registered, said })),
  )
  const native = await Promise.all(nativeRegistrations().map((row) => nativeView(row, said)))
  const codexUnverified = await Promise.all(
    threads
      .filter((t) => t.live === null)
      .map((row) => codexView(row, { threads, records, registered, said })),
  )
  const nativeByKind = Object.fromEntries(
    NATIVE_KINDS.map((kind) => [kind, native.filter((r) => r.kind === kind)]),
  ) as Record<(typeof NATIVE_KINDS)[number], typeof native>
  const payload = {
    claude,
    claude_unverified: await Promise.all(unverified.map((row) => claudeView(row, said))),
    codex,
    codex_unverified: codexUnverified,
    codex_schema_recognised: schemaOk,
    socket_dir: defaultSocketDir(),
    ...nativeByKind,
  }
  return payload
}

export type Inventory = Awaited<ReturnType<typeof collectInventory>>

export async function cmdList(args: Args): Promise<number> {
  const payload = await collectInventory()
  printInventory(args, payload)
  return 0
}
