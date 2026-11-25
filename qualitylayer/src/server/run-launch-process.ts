import { dirname, isAbsolute } from "node:path"
import { checkedAgentBinary, runnableFile } from "../core/agents/binary.ts"
import type { Config } from "../core/config-values.ts"
import { agentEntry } from "../core/install/where.ts"
import { agentEnvironment } from "../core/run/agent-env.ts"
import { runBriefsDirectory, taskBriefsDirectory } from "../core/run/bind.ts"
import type { RunRecord, RunSettings, StartRequest } from "../core/run/contracts.ts"
import { assertNativeAvailable } from "../core/run/control.ts"
import { createNativeSession } from "../core/run/create-session.ts"
import { grantedFolders } from "../core/run/launch-args.ts"
import type { launchDiagnostic } from "../core/run/launch-diagnostics.ts"
import { createLaunchOverlays, launchHooks, launchHooksFolder } from "../core/run/launch-hooks.ts"
import {
  AGENT_CAPABILITIES,
  type LaunchSpecInput,
  launchSpec,
  permissionChoice,
} from "../core/run/launch-spec.ts"
import { updateRun } from "../core/run/registry.ts"
import type { Ctx } from "../ctx.ts"
import { agentSetupProgram } from "./agent-setup-command.ts"
import { refreshArtifactAgentContext } from "./artifact-agent.ts"
import { agentArgs, terminalShell } from "./run-launch-settings.ts"
import type { LaunchContext } from "./run-purpose-context.ts"

/**
 * The hooks the launch of this generation of the run carries (`launch-hooks.ts`). Nothing is made on
 * disk yet: `readyLaunchHooks` makes the overlay folders once the launch has been validated.
 */
export function launchHooksFor(
  ctx: Ctx,
  run: Pick<RunRecord, "id" | "generation" | "agent">,
  version: string,
  settings?: Partial<Pick<RunSettings, "perm" | "permMode">>,
  options?: { resume?: boolean; additionalDirectories?: readonly string[] },
) {
  const { id, generation, agent } = run
  if (agent === "other") return undefined
  const folder = launchHooksFolder(ctx.home, id, generation)
  const mode = permissionChoice(agent, settings ?? {}).permMode
  const dirs = options?.additionalDirectories
  return launchHooks({
    agent,
    binary: agentEntry(ctx),
    folder,
    version,
    ...(mode ? { permissionMode: mode } : {}),
    ...(dirs && dirs.length > 0 ? { additionalDirectories: dirs } : {}),
    resume: options?.resume ?? false,
  })
}
/**
 * Make the overlay folders of a validated launch from the person's own agent folders. The agent host
 * removes them when its agent ends; each generation has its own, so a restart never takes the
 * folder of the launch it is replacing.
 */
export function readyLaunchHooks(
  ctx: Ctx,
  run: string,
  generation: number,
  hooks: ReturnType<typeof launchHooksFor>,
  env: Record<string, string>,
) {
  if (hooks) createLaunchOverlays(launchHooksFolder(ctx.home, run, generation), hooks.overlays, env)
}

async function resolveShellProgram(
  ctx: Ctx,
  run: RunRecord,
  config: Config,
  env: Record<string, string>,
) {
  if (run.purpose.kind !== "terminal") return undefined
  if (run.purpose.context?.kind === "agent-setup")
    return agentSetupProgram(ctx, run.purpose.context.agent, run.purpose.context.operation, env)
  return run.purpose.shell === true ? terminalShell(ctx, config) : undefined
}

async function resolveBinary(
  ctx: Ctx,
  run: RunRecord,
  config: Config,
  env: Record<string, string>,
  options: {
    shellProgram: Awaited<ReturnType<typeof resolveShellProgram>>
    deadline: number
    diagnostic: ReturnType<typeof launchDiagnostic> | null
  },
): Promise<{ path: string; version: string }> {
  if (run.agent === "other") {
    const program = options.shellProgram?.program ?? config.otherAgent.program
    const path = isAbsolute(program) ? program : Bun.which(program, { PATH: env.PATH })
    if (!path || !runnableFile(path))
      throw new Error(`Another agent's program cannot run: ${program || "not configured"}`)
    return { path, version: "unknown" }
  }
  return checkedAgentBinary(ctx, run.agent, {
    env,
    timeoutMs: Math.max(1, options.deadline - Date.now()),
    observe: options.diagnostic?.binary,
  })
}

async function resolveArtifactPrompt(
  ctx: Ctx,
  run: RunRecord,
  context: LaunchContext,
): Promise<string | undefined> {
  if (!context.artifact) return undefined
  const request = run.purpose.kind === "artifact" ? run.purpose.request : ""
  const result = await refreshArtifactAgentContext(ctx, context.artifact.binding, request, {
    expectedRevision: context.artifact.revision,
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.data.prompt
}

async function ensureNativeSession(
  ctx: Ctx,
  run: RunRecord,
  binaryPath: string,
  cwd: string,
  options: { env: Record<string, string>; deadline: number },
): Promise<RunRecord> {
  const create =
    run.agent === "other" ? undefined : AGENT_CAPABILITIES[run.agent].startSession?.create
  if (!create || run.nativeSession) return run
  const nativeSession = await createNativeSession({
    program: binaryPath,
    create,
    cwd,
    env: options.env,
    timeoutMs: Math.max(1, options.deadline - Date.now()),
  })
  return updateRun(ctx.home, run.id, run.generation, { nativeSession })
}

/** Prepare a validated start's executable, native session and arguments before the host is started. */
export async function prepareStartProcess(
  ctx: Ctx,
  preparation: {
    input: StartRequest
    run: RunRecord
    context: LaunchContext
    config: Config
    deadline: number
    diagnostic: ReturnType<typeof launchDiagnostic> | null
  },
) {
  const { input, context, config, deadline, diagnostic } = preparation
  const env = await agentEnvironment(ctx, preparation.run.id, process.env, diagnostic?.login)
  env.PWD = context.cwd
  if (preparation.run.task)
    env.QUALITYLAYER_TASK = preparation.run.task.split("~").at(-1) ?? preparation.run.task
  if (preparation.run.agent !== "other") env.QUALITYLAYER_AGENT = preparation.run.agent
  const shellProgram = await resolveShellProgram(ctx, preparation.run, config, env)
  const binary = await resolveBinary(ctx, preparation.run, config, env, {
    shellProgram,
    deadline,
    diagnostic,
  })
  const current = await ensureNativeSession(ctx, preparation.run, binary.path, context.cwd, {
    env,
    deadline,
  })
  // Resuming the outside session's own conversation: nothing else may hold it now.
  if (input.resumeNative !== undefined) assertNativeAvailable(ctx, current)
  const isNative = current.agent !== "other"
  const specInput: LaunchSpecInput = {
    ...(input.resumeNative !== undefined ? { resume: true, continue: true } : {}),
    agent: current.agent,
    launchFiles: current.launchFiles,
    toolsFolder: dirname(agentEntry(ctx)),
    answers: context.task?.answers ?? current.settings?.answers,
    artifactPrompt: await resolveArtifactPrompt(ctx, current, context),
    stage: context.task?.stage,
    purpose: context.task ? { kind: "task", task: context.task.slug } : current.purpose,
    managed: true,
    session: current.nativeSession,
    taskBriefsDir:
      context.task && isNative ? await taskBriefsDirectory(ctx, context.task) : undefined,
    runBriefsDir:
      current.purpose.kind === "new-task" && isNative
        ? await runBriefsDirectory(ctx, current.id)
        : undefined,
    perm: current.settings?.perm,
    permMode: current.settings?.permMode,
    model: current.settings?.model,
    effort: current.settings?.effort,
    subagentModel: current.settings?.subagentModel,
    works: context.works === "worktree" ? "checkout" : context.works,
    mode: current.purpose.kind === "task" ? "plain" : (input.mode ?? "plain"),
    otherAgent: shellProgram ?? config.otherAgent,
    agentArgs: agentArgs(current.agent, config),
  }
  const additionalDirectories =
    current.agent === "claude-code" ? grantedFolders(specInput) : undefined
  const hooks = launchHooksFor(ctx, current, binary.version, current.settings, {
    resume: input.resumeNative !== undefined,
    additionalDirectories,
  })
  const spec = launchSpec({ ...specInput, hooks })
  return { run: current, env, binary, hooks, spec }
}
