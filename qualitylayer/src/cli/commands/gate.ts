// gate open plan | final · gate decide changes "<remark>" (`wait --for approval` waits and applies)
// (a person's own terminal, outside any agent, also has gate decide approve; the agent has it with
// --asked "<the person's words>" when a message of theirs since the gate opened holds them).
// Thin parsing over core/gate; the chat's `decide` and the Cockpit's button
// end in the same record().

import { chatWorkflowRefusal } from "../../core/chat/task.ts"
import { type Ctx, err, type Result } from "../../ctx.ts"
import { decideGateCmd } from "./gate-decide.ts"
import { openGateCmd } from "./gate-open.ts"
import { requireTask } from "./shared.ts"

export async function gateCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const task = await requireTask(ctx)
  if (task.ok && task.data.type === "chat") return chatWorkflowRefusal()
  if (sub === "open") return openGateCmd(ctx, task, rest)
  if (sub === "decide") return task.ok ? decideGateCmd(ctx, task.data, rest) : task
  return err({
    code: "bad_args",
    message:
      'usage: qualitylayer gate open plan | final · gate decide changes "<remark>" (wait with qualitylayer wait --for approval)',
  })
}
