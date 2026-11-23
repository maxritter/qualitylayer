// `qualitylayer automations`: where a task's events go. Open to every licence and to the person's
// agents alike: nothing here approves or answers anything, and every change shows in `list`.

import { PUBLIC_EVENTS } from "../../core/automations/events.ts"
import { type DeliveryLine, readDeliveries } from "../../core/automations/log.ts"
import { dropQueuedFor } from "../../core/automations/queue.ts"
import { sendTest } from "../../core/automations/sender.ts"
import {
  findAutomation,
  readAutomations,
  removeAutomation,
  shownAutomation,
} from "../../core/automations/store.ts"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import {
  AUTOMATIONS_USAGE,
  addAutomationCmd,
  badAutomationArgs,
  idOf,
  refuseOtherOptions,
  setAutomationCmd,
} from "./automations-mutate.ts"
import { parseArgs } from "./shared.ts"

function lastOf(lines: DeliveryLine[]): Record<string, unknown> | null {
  const last = lines.at(-1)
  return last === undefined
    ? null
    : { at: last.at, event: last.name, result: last.result, gave_up: last.gaveUp }
}

async function list(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args)
  const other = refuseOtherOptions(flags, [])
  if (other !== null) return other
  if (positional.length > 0) return badAutomationArgs(AUTOMATIONS_USAGE)
  const { automations, problem } = await readAutomations(ctx)
  const deliveries = await readDeliveries(ctx)
  return ok({
    automations: automations.map((automation) => ({
      ...shownAutomation(automation),
      last_delivery: lastOf(deliveries.filter((line) => line.automation === automation.id)),
    })),
    ...(problem !== null ? { problem } : {}),
  })
}

function events(_ctx: Ctx, args: string[]): Result<unknown> {
  return args.length === 0
    ? ok({ events: [...PUBLIC_EVENTS] })
    : badAutomationArgs(AUTOMATIONS_USAGE)
}

/** Send the sample event now. A receiver that fails is a result (`delivered: false`), not a failed command. */
async function test(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args)
  const other = refuseOtherOptions(flags, [])
  if (other !== null) return other
  const id = idOf(positional)
  if (!id.ok) return id
  const found = await findAutomation(ctx, id.data)
  if (!found.ok) return found
  const sent = await sendTest(ctx, found.data)
  return ok({
    id: found.data.id,
    event: sent.event,
    delivery: sent.id,
    result: sent.result,
    delivered: sent.delivered,
    ...(sent.output !== undefined ? { output: sent.output } : {}),
  })
}

/** The tries, newest first, of one automation or of all. */
async function log(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args)
  const other = refuseOtherOptions(flags, [])
  if (other !== null) return other
  if (positional.length > 1) return badAutomationArgs(AUTOMATIONS_USAGE)
  const [id] = positional
  if (id !== undefined) {
    const found = await findAutomation(ctx, id)
    if (!found.ok) return found
  }
  const lines = await readDeliveries(ctx, id)
  return ok({
    log: lines.toReversed().map((line) => ({
      at: line.at,
      automation: line.automation,
      event: line.name,
      id: line.event,
      result: line.result,
      gave_up: line.gaveUp,
      ...(line.output !== undefined ? { output: line.output } : {}),
    })),
  })
}

/** A URL's signing secret, in full: a receiver needs it to check the signature. */
async function secret(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args)
  const other = refuseOtherOptions(flags, [])
  if (other !== null) return other
  const id = idOf(positional)
  if (!id.ok) return id
  const found = await findAutomation(ctx, id.data)
  if (!found.ok) return found
  if (found.data.secret === undefined)
    return badAutomationArgs(`${found.data.id} runs a command: a command has no signing secret.`)
  return ok({ id: found.data.id, secret: found.data.secret })
}

async function remove(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args)
  const other = refuseOtherOptions(flags, [])
  if (other !== null) return other
  const id = idOf(positional)
  if (!id.ok) return id
  const removed = await removeAutomation(ctx, id.data)
  if (!removed.ok) return removed
  await dropQueuedFor(ctx, id.data)
  return ok({ removed: removed.data.id, kind: removed.data.kind, target: removed.data.target })
}

const SUBCOMMANDS: Record<
  string,
  (ctx: Ctx, args: string[]) => Promise<Result<unknown>> | Result<unknown>
> = {
  add: addAutomationCmd,
  list,
  events,
  set: setAutomationCmd,
  remove,
  test,
  log,
  secret,
}

export async function automationsCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const handler = sub === undefined ? undefined : SUBCOMMANDS[sub]
  return handler ? handler(ctx, rest) : badAutomationArgs(AUTOMATIONS_USAGE)
}
