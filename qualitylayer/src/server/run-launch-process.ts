import { dirname, isAbsolute } from "node:path"
import { checkedAgentBinary, runnableFile } from "../core/agents/binary.ts"
import type { Config } from "../core/config-values.ts"
import { agentEntry } from "../core/install/where.ts"
import { agentEnvironment } from "../core/run/agent-env.ts"
import { runBriefsDirectory, taskBriefsDirectory } from "../core/run/bind.ts"
import type { RunRecord, RunSettings, StartRequest } from "../core/run/contracts.ts"
import { assertNativeAvailable } from "../core/run/control.ts"
import { createNativeSession } from "../core/run/create-session.ts"
import type { launchDiagnostic } from "../core/run/launch-diagnostics.ts"
import { createLaunchOverlays, launchHooks, launchHooksFolder } from "../core/run/launch-hooks.ts"
import { AGENT_CAPABILITIES, launchSpec, permissionChoice } from "../core/run/launch-spec.ts"
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
  resume = false,
) {
  const { id, generation, agent } = run
  if (agent === "other") return undefined
  const folder = launchHooksFolder(ctx.home, id, generation)
  const mode = permissionChoice(agent, settings ?? {}).permMode
  return launchHooks({
    agent,
    binary: agentEntry(ctx),
    folder,
    version,
    ...(mode ? { permissionMode: mode } : {}),
    resume,
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
  let current = preparation.run
  const env = await agentEnvironment(ctx, current.id, process.env, diagnostic?.login)
  env.PWD = context.cwd
  if (current.task) env.QUALITYLAYER_TASK = current.task.split("~").at(-1) ?? current.task
  if (current.agent !== "other") env.QUALITYLAYER_AGENT = current.agent
  let binary: { path: string; version: string }
  const shell = current.purpose.kind === "terminal" && current.purpose.shell === true
  const setup =
    current.purpose.kind === "terminal" && current.purpose.context?.kind === "agent-setup"
      ? current.purpose.context
      : null
  const shellProgram = setup
    ? await agentSetupProgram(ctx, setup.agent, setup.operation, env)
    : shell
      ? terminalShell(ctx, config)
      : undefined
  if (current.agent === "other") {
    const program = shellProgram?.program ?? config.otherAgent.program
    const path = isAbsolute(program) ? program : Bun.which(program, { PATH: env.PATH })
    if (!path || !runnableFile(path))
      throw new Error(`Another agent's program cannot run: ${program || "not configured"}`)
    binary = { path, version: "unknown" }
  } else
    binary = await checkedAgentBinary(ctx, current.agent, {
      env,
      timeoutMs: Math.max(1, deadline - Date.now()),
      observe: diagnostic?.binary,
    })
  const create =
    current.agent === "other" ? undefined : AGENT_CAPABILITIES[current.agent].startSession?.create
  if (create && !current.nativeSession) {
    const nativeSession = await createNativeSession({
      program: binary.path,
      create,
      cwd: context.cwd,
      env,
      timeoutMs: Math.max(1, deadline - Date.now()),
    })
    current = updateRun(ctx.home, current.id, current.generation, { nativeSession })
  }
  // Resuming the outside session's own conversation: nothing else may hold it now.
  if (input.resumeNative !== undefined) assertNativeAvailable(ctx, current)
  const hooks = launchHooksFor(
    ctx,
    current,
    binary.version,
    current.settings,
    input.resumeNative !== undefined,
  )
  const spec = launchSpec({
    ...(input.resumeNative !== undefined ? { resume: true, continue: true } : {}),
    agent: current.agent,
    launchFiles: current.launchFiles,
    toolsFolder: dirname(agentEntry(ctx)),
    answers: context.task?.answers ?? current.settings?.answers,
    artifactPrompt: context.artifact
      ? await refreshArtifactAgentContext(
          ctx,
          context.artifact.binding,
          current.purpose.kind === "artifact" ? current.purpose.request : "",
          { expectedRevision: context.artifact.revision },
        ).then((result) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.data.prompt
        })
      : undefined,
    stage: context.task?.stage,
    purpose: context.task ? { kind: "task", task: context.task.slug } : current.purpose,
    managed: true,
    session: current.nativeSession,
    taskBriefsDir:
      context.task && current.agent !== "other"
        ? await taskBriefsDirectory(ctx, context.task)
        : undefined,
    runBriefsDir:
      current.purpose.kind === "new-task" && current.agent !== "other"
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
    hooks,
  })
  return { run: current, env, binary, hooks, spec }
}
