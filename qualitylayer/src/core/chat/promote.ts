import { dirname, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { appendToSection } from "../docs/build-log.ts"
import { agentFileOf, folderDoc } from "../docs/names.ts"
import { agentsTemplateFor } from "../docs/schema.ts"
import { adoptChatPlan } from "../task/adoption.ts"
import { advance } from "../task/machine.ts"
import type { Task } from "../task/store.ts"
import { activeChatHelpers } from "./build.ts"
import { chatLock, currentChat } from "./documents.ts"
import { promotionContext } from "./promote-context.ts"

type PromotionResult = Result<{ task: Task; then: string }>

function heldByActiveSlices(active: string[]): Result<never> {
  return err({
    code: "held",
    message: `A slice is still building: ${active.join(", ")}; let it finish or stop it first`,
  })
}

async function writePromotedPlanContext(ctx: Ctx, updated: Task, context: string): Promise<void> {
  if (!context) return
  // A Chat task starts without the Plan's agents' file: the promoted task gets it, with the
  // chat's context under Read first.
  const path = join(updated.dir, agentFileOf("plan"))
  const kept = (await ctx.fs.exists(path))
    ? await ctx.fs.readFile(path)
    : agentsTemplateFor(folderDoc("plan"), updated, updated.title)
  if (kept === undefined) return
  await ctx.fs.mkdir(dirname(path))
  await ctx.fs.atomicWrite(path, appendToSection(kept, "Read first", context))
}

async function applyPromotion(
  ctx: Ctx,
  current: Task,
  type: "feature" | "bugfix",
  context: string,
  options: { beforeAdvance?: () => void; fromSavedPlan?: boolean },
): Promise<PromotionResult> {
  const lastActive = await activeChatHelpers(ctx, current)
  if (lastActive.length) return heldByActiveSlices(lastActive)
  // From the saved plan: the Plan maps it as the person's own plan.
  if (options.fromSavedPlan) {
    const adopted = await adoptChatPlan(ctx, current, type, {
      beforeAdvance: options.beforeAdvance,
    })
    return adopted.ok
      ? ok({
          task: adopted.data,
          then: "Run qualitylayer next to continue this task at the Plan in the same session: map the saved plan, kept as original-plan.md.",
        })
      : adopted
  }
  options.beforeAdvance?.()
  const advanced = await advance(ctx, current, "workflow_started", {
    type,
    effect: async (updated) => {
      await writePromotedPlanContext(ctx, updated, context)
      return ok(undefined)
    },
  })
  return advanced.ok
    ? ok({
        task: advanced.data,
        then: "The task is at Plan in this session: run qualitylayer brief plan for the step's text, and qualitylayer next for its moves.",
      })
    : advanced
}

export async function promoteChat(
  ctx: Ctx,
  task: Task,
  type: "feature" | "bugfix",
  /** `fromSavedPlan`: start at the Plan, keeping chat-plan.md as the original (task/adoption.ts). */
  options: { beforeAdvance?: () => void; fromSavedPlan?: boolean } = {},
): Promise<PromotionResult> {
  if (type !== "feature" && type !== "bugfix")
    return err({ code: "bad_args", message: "Choose feature or bugfix" })
  return ctx.fs.withLock(chatLock(task), async () => {
    const current = await currentChat(ctx, task)
    if (!current) return err({ code: "bad_args", message: "This task is no longer a Chat" })
    const active = await activeChatHelpers(ctx, current)
    if (active.length) return heldByActiveSlices(active)
    const context = options.fromSavedPlan ? ok("") : await promotionContext(ctx, current)
    if (!context.ok) return context
    return ctx.fs.withLock(join(current.runtimeDir, "helpers.lock"), () =>
      applyPromotion(ctx, current, type, context.data, options),
    )
  })
}
