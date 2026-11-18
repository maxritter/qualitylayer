// verify judge | recheck | fix | keep-red: hand out the fresh reviewer (and read its verdicts), ask
// for a recheck, start a fix round, or keep a red check red on the person's answer. Thin parsing over
// core/next.ts.

import type { VerifyVerb } from "../../core/next/verify.ts"
import { type NextPayload, verifyVerbCmd } from "../../core/next.ts"
import { withManagedRunNext } from "../../core/run/bind.ts"
import { type Ctx, err, type Result } from "../../ctx.ts"
import { withTaskExtras } from "./next.ts"

const VERBS: readonly VerifyVerb[] = ["judge", "recheck", "fix", "keep-red"]

export async function verifyCmd(ctx: Ctx, args: string[]): Promise<Result<NextPayload>> {
  const [verb, ...rest] = args
  if (rest.length > 0 || !VERBS.includes(verb as VerifyVerb))
    return err({
      code: "bad_args",
      message:
        "usage: qualitylayer verify judge | recheck | fix | keep-red. Use fix for actionable failures and recheck after a change. Record a service blocker with qualitylayer need --kind service; continue independent work and ask the person only for a decision they own. Keep-red requires the person's recorded choice.",
    })
  return withManagedRunNext(ctx, [], async (bound) =>
    withTaskExtras(bound, await verifyVerbCmd(bound, verb as VerifyVerb)),
  )
}
