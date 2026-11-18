import { fileMtime, nowSeconds } from "../base.ts"
import type { Said } from "../claims.ts"
import {
  agoText,
  type Bounded,
  branchOf,
  DOING_MARK,
  type DoingFrom,
  doingOf,
  type Facts,
  oneLine,
  readBounded,
} from "../doing.ts"
import { currentTaskContext, readTaskStatus } from "../task-status.ts"
import { printable } from "../topics.ts"

export type Seen = {
  cwd: string | null
  launch_cwd: string | null
  cwd_from: "task" | "launch"
  active_task: { project: string; slug: string; title: string; stage: string } | null
  doing: string | null
  doing_from: DoingFrom | null
  branch: string | null
  last_active: string | null
  active_seconds_ago: number | null
}

// Explicit status takes precedence over task, title and transcript hints.
export async function sessionFacts(
  who: string,
  said: Map<string, Said>,
  where: { cwd: string | null; transcript: string | null; name: string | null },
  read: (bounded: Bounded) => Facts,
  fallbackActive: number | null,
): Promise<Seen> {
  const { transcript } = where
  const task = readTaskStatus(who)
  const current = task === null ? null : await currentTaskContext(task)
  const doing = await doingOf({
    hand: said.get(who),
    task,
    currentTask: current,
    name: where.name,
    guess: () => {
      const bounded = transcript === null ? null : readBounded(transcript)
      return bounded === null ? null : read(bounded)
    },
  })
  const active = (transcript === null ? null : fileMtime(transcript)) ?? fallbackActive
  const cwd = current?.checkout ?? where.cwd
  return {
    cwd,
    launch_cwd: where.cwd,
    cwd_from: current ? "task" : "launch",
    active_task: current
      ? { project: current.repo, slug: current.task, title: current.title, stage: current.stage }
      : null,
    doing: doing?.text ?? null,
    doing_from: doing?.from ?? null,
    branch: branchOf(cwd),
    last_active: active === null ? null : new Date(active * 1000).toISOString(),
    active_seconds_ago: active === null ? null : Math.max(0, Math.round(nowSeconds() - active)),
  }
}

/** The rest of a session's first line, and its doing line. */
export const seenText = (s: Seen) =>
  `${s.branch === null ? "" : `  on ${printable(s.branch)}`}${s.active_seconds_ago === null ? "" : `  active ${agoText(s.active_seconds_ago)}`}${s.doing === null || s.doing_from === null ? "" : `\n      ${DOING_MARK[s.doing_from]} ${s.doing}`}${s.active_task && s.doing_from !== "task" ? `\n      task: ${oneLine(`${s.active_task.project}~${s.active_task.slug}`, 240)} (${oneLine(s.active_task.stage)}): ${oneLine(s.active_task.title)}` : ""}`

export const locationText = (s: Seen) =>
  `${s.cwd === null ? "" : printable(s.cwd)} (${s.cwd_from === "task" ? "task checkout" : "launch folder"})${s.cwd_from === "task" && s.launch_cwd && s.launch_cwd !== s.cwd ? `; launched in ${printable(s.launch_cwd)}` : ""}`
