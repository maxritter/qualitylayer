import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { checkedAgentBinary } from "../core/agents/binary.ts"
import { readConfig } from "../core/config.ts"
import { currentBranch } from "../core/git/repo.ts"
import { agentEnvironment } from "../core/run/agent-env.ts"
import type { RunRecord } from "../core/run/contracts.ts"
import { effectiveNativeSettings } from "../core/run/effective-native-settings.ts"
import { type FreshPreparation, freshPermission } from "../core/run/fresh.ts"
import type { Ctx } from "../ctx.ts"
import { resolveFreshPurpose } from "./conversation-fresh-purpose.ts"
import { readLaunchFiles } from "./run-launch-files.ts"
import { shippedRun } from "./shipped-run.ts"

async function verifyCheckout(ctx: Ctx, source: RunRecord) {
  if (source.agent === "other" || source.agent === "opencode") {
    throw new Error(
      "Start a fresh conversation in Terminal for this agent. Its existing session is kept.",
    )
  }
  const cwd = await realpath(source.cwd)
  if (cwd !== source.cwd)
    throw new Error("The recorded checkout identity changed. The existing conversation is kept.")
  if ("dropCaches" in ctx.git && typeof ctx.git.dropCaches === "function") ctx.git.dropCaches()
  if (
    source.branch &&
    (await currentBranch(ctx, cwd)) !== source.branch &&
    !(await shippedRun(ctx, source))
  )
    throw new Error("This checkout changed branches. The existing conversation is kept.")
  return { cwd, agent: source.agent }
}

/** No new task, branch, host or lease is allocated during this preflight. */
export async function prepareFreshConversation(
  ctx: Ctx,
  source: RunRecord,
  key: string,
  options: { checkBinary?: typeof checkedAgentBinary } = {},
): Promise<FreshPreparation> {
  const { cwd, agent } = await verifyCheckout(ctx, source)
  const hash = createHash("sha256")
  hash.update(JSON.stringify({ cwd, agent, nativeSession: source.nativeSession }))
  const { purpose, artifactBinding } = await resolveFreshPurpose(ctx, source, cwd, hash)
  const config = await readConfig(ctx)
  const launch = await readLaunchFiles(ctx, source)
  hash.update(launch.hash)
  const settings = {
    ...effectiveNativeSettings(ctx, source, {}),
    ...freshPermission(ctx, source),
    ...(["task", "new-task"].includes(source.purpose.kind) ? { answers: "app" as const } : {}),
    agentView: "conversation" as const,
    fastMode: undefined,
  }
  const env = await agentEnvironment(ctx, source.id)
  await (options.checkBinary ?? checkedAgentBinary)(ctx, agent, { env, timeoutMs: 3000 })
  hash.update(JSON.stringify({ settings, otherAgent: config.otherAgent }))
  return {
    context: hash.digest("hex"),
    files: launch.files,
    ...(artifactBinding ? { artifactBinding } : {}),
    request: {
      agent,
      cwd,
      purpose,
      idempotencyKey: key,
      works: "checkout",
      mode: "plain",
      settings,
    },
  }
}
