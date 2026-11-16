import { existsSync, type FSWatcher, lstatSync, readFileSync, statSync, watch } from "node:fs"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { readGate } from "../gate/gate.ts"
import { readNeeds } from "../need/need.ts"
import { openQuestion } from "../task/question.ts"
import { readBatch } from "../task/question-batch.ts"
import { acceptedStopEvent } from "./bind.ts"
import type { RunRecord } from "./contracts.ts"
import { nativeSessionFile } from "./control.ts"
import { intentHelperRunning } from "./intent.ts"
import { readRun, runDir, updateRun } from "./registry.ts"

export const RUN_IDLE_MS = 15 * 60_000

/** Missing hooks or an unfinished turn never count as idle evidence. */
export function idleRunBoundary(run: RunRecord): number | undefined {
  if (run.agent === "other" || !run.nativeSession || run.waitSince || run.terminalPrompt)
    return undefined
  if (run.intent && !["paused", "blocked", "complete"].includes(run.intent.state)) return undefined
  const stop = run.status === "running" ? acceptedStopEvent(run) : undefined
  return stop && Number.isFinite(Date.parse(stop.at)) ? stop.sequence : undefined
}

/**
 * The planner's build went outside the App (handoff/outside.ts) and a turn ended after it was told:
 * its host closes it at this boundary, without the idle wait and whoever watches it.
 */
export function handedOffBoundary(run: RunRecord, sequence: number): boolean {
  return run.handedOff !== undefined && sequence > run.handedOff.sequence
}

const HUMAN_FILES = [
  "gate.json",
  "question.json",
  "question-batches.json",
  "questions.json",
  "needs.json",
]

/** Atomic task-file replacements must invalidate an in-flight eligibility check. */
export function idleStateStamp(run: RunRecord): string {
  if (!run.taskRuntimeDir) return "unbound"
  return HUMAN_FILES.map((name) => {
    const path = join(run.taskRuntimeDir as string, name)
    try {
      const stat = lstatSync(path, { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unknown task state")
      return `${name}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return `${name}:absent`
      throw cause
    }
  }).join("|")
}

export function reserveIdleStop(
  home: string,
  id: string,
  generation: number,
  sequence: number,
  stamp: string,
) {
  updateRun(home, id, generation, (run) => {
    if (idleRunBoundary(run) !== sequence || idleStateStamp(run) !== stamp)
      throw new Error("The session changed before idle cleanup")
    return { status: "stopping", guardedRestart: { sequence, valid: true } }
  })
}

/** Preserve native resume and every outstanding human/helper boundary. */
export async function idleRunBlocked(ctx: Ctx, run: RunRecord): Promise<boolean> {
  if (!nativeSessionFile(ctx, run)) return true
  if (!run.taskRuntimeDir) return !!run.task || run.purpose.kind === "task"
  const task = { runtimeDir: run.taskRuntimeDir }
  for (const name of HUMAN_FILES) {
    const path = join(task.runtimeDir, name)
    if (!existsSync(path)) continue
    // A damaged or unexpectedly large record is unknown, never permission to stop.
    if (statSync(path).size > 1024 * 1024) return true
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown
    const array = name === "questions.json" || name === "question-batches.json"
    if (!value || typeof value !== "object" || Array.isArray(value) !== array) return true
    if (
      name === "gate.json" &&
      !["pending", "approved", "changes"].includes((value as { decision: string }).decision)
    )
      return true
  }
  return Object.values(await idlePending(ctx, run)).some(Boolean)
}

/**
 * What the run's task still waits on: a person (a question, an approval or a need) or one
 * of the run's own helpers. The Sessions page tells the two apart; neither is ever stopped.
 */
export async function idlePending(
  ctx: Ctx,
  run: RunRecord,
): Promise<{ human: boolean; helper: boolean }> {
  if (!run.taskRuntimeDir) return { human: false, helper: false }
  const task = { runtimeDir: run.taskRuntimeDir }
  const [gate, question, batch, needs, helper] = await Promise.all([
    readGate(ctx, task),
    openQuestion(ctx, task),
    readBatch(ctx, task),
    readNeeds(ctx, task),
    intentHelperRunning(ctx, task, run),
  ])
  const human = [
    gate?.decision === "pending",
    question,
    batch?.questions.length,
    needs.some((need) => need.state === "open" && need.waiting !== null),
  ]
  return { human: human.some(Boolean), helper: !!helper }
}

/** Watches run and human-decision records with one deadline; no recurring idle poll. */
export function watchIdleRun(options: {
  home: string
  id: string
  generation: number
  attached: () => boolean
  blocked: (run: RunRecord) => Promise<boolean>
  stop: (sequence: number, stamp: string) => void
  timeoutMs?: number
  /**
   * A planner marked handed off whose turn has ended and that nobody has told yet (the CLI of the
   * outside session could not reach this host, as from inside an agent's sandbox): the host types the
   * message itself, once nobody has typed for a moment. `quietAt` is when the last typing ends.
   */
  tell?: (run: RunRecord) => void
  quietAt?: () => number
}) {
  const timeout = options.timeoutMs ?? RUN_IDLE_MS
  let telling: ReturnType<typeof setTimeout> | undefined
  let detachedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let revision = 0
  let taskWatcher: FSWatcher | undefined
  let taskDirectory: string | undefined
  const current = () => {
    const run = readRun(options.home, options.id)
    return run?.generation === options.generation ? run : null
  }
  const settle = async (sequence: number, stamp: number) => {
    const candidate = current()
    if (!candidate || idleRunBoundary(candidate) !== sequence) return
    // A planner whose build went outside the App closes at once, watched or not: it is history now.
    const finished = handedOffBoundary(candidate, sequence)
    if (!finished && options.attached()) return
    const state = idleStateStamp(candidate)
    if (!finished && (await options.blocked(candidate))) return
    if (disposed || revision !== stamp || (!finished && options.attached())) return
    const latest = current()
    if (latest && idleRunBoundary(latest) === sequence) options.stop(sequence, state)
  }
  const refresh = () => {
    const stamp = ++revision
    if (timer) clearTimeout(timer)
    timer = undefined
    if (disposed) return
    const run = current()
    if (run?.taskRuntimeDir !== taskDirectory) {
      taskWatcher?.close()
      taskWatcher = undefined
      taskDirectory = run?.taskRuntimeDir
      if (taskDirectory)
        try {
          const watched = watch(taskDirectory, { persistent: false }, (_, name) => {
            if (name === null || HUMAN_FILES.includes(name.toString())) refresh()
          })
          taskWatcher = watched
          watched.on("error", () => {
            watched.close()
            if (taskWatcher === watched) {
              taskWatcher = undefined
              taskDirectory = undefined
            }
          })
        } catch {
          taskDirectory = undefined
        }
    }
    const sequence = run ? idleRunBoundary(run) : undefined
    if (sequence === undefined || !run) return
    if (
      run.handedOff &&
      !run.handedOff.told &&
      sequence <= run.handedOff.sequence &&
      options.tell
    ) {
      if (telling) clearTimeout(telling)
      const tell = options.tell
      // The quiet time is read again when it ends: a person who typed since starts it over.
      const arm = () => {
        telling = setTimeout(
          () => {
            telling = undefined
            if (disposed) return
            if ((options.quietAt?.() ?? 0) > Date.now()) return arm()
            const latest = current()
            if (latest?.handedOff && !latest.handedOff.told)
              if (idleRunBoundary(latest) === sequence) tell(latest)
          },
          Math.max(0, (options.quietAt?.() ?? 0) - Date.now()),
        )
        telling.unref()
      }
      arm()
    }
    const finished = handedOffBoundary(run, sequence)
    if (!finished && options.attached()) return
    const since = Math.max(detachedAt, Date.parse(acceptedStopEvent(run)?.at ?? ""))
    timer = setTimeout(
      () => {
        timer = undefined
        void settle(sequence, stamp).catch(() => {
          // Failed state/ownership inspection leaves the live session alone.
        })
      },
      finished ? 0 : Math.max(0, since + timeout - Date.now()),
    )
    timer.unref()
  }
  let watcher: FSWatcher
  try {
    watcher = watch(runDir(options.home, options.id), { persistent: false }, (_, name) => {
      if (name === null || name.toString() === "run.json") refresh()
    })
  } catch {
    return { changed: () => {}, dispose: () => {} }
  }
  watcher.on("error", () => {
    dispose()
  })
  const dispose = () => {
    disposed = true
    revision++
    if (timer) clearTimeout(timer)
    if (telling) clearTimeout(telling)
    taskWatcher?.close()
    watcher.close()
  }
  refresh()
  return {
    changed: () => {
      detachedAt = Date.now()
      refresh()
    },
    dispose,
  }
}
