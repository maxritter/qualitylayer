import { agentIdOf, asksInChat, shellStatus } from "../../core/interaction-shell/status.ts"
import type { TaskSummary } from "../api.ts"
import { finalApproved, historyAt, openWaits } from "./lines.ts"

/**
 * The groups of the sidebar and Home, from one status for every surface. Your turn holds what
 * waits on the person; Running holds the remaining open tasks. Human attention takes precedence
 * even while an agent works in the background. A task whose final approval is saved is finished
 * from the click on: nothing runs, so it stands with the shipped ones, its pull request open or
 * not. It comes back to Your turn only while something of it needs the person (a thread or a
 * failing check on its pull request, changes after the approval, a question of its agent). `open`
 * is every task of the open list, the number beside the project picker.
 */
export function shellGroups(
  tasks: TaskSummary[],
  project: string,
  agent: string,
  now = Date.now(),
) {
  const all = tasks.filter(
    (t) => (project === "" || t.project === project) && (agent === "" || agentIdOf(t) === agent),
  )
  /** The work is over: approved (applied or not yet), abandoned, handed back or of an earlier workflow. */
  const finished = (t: TaskSummary) =>
    finalApproved(t) || t.stage === "abandoned" || t.handedBack !== undefined || t.earlier === true
  /** What still needs the person after their approval. */
  const waitsAfterApproval = (t: TaskSummary) =>
    openWaits(t) || t.live?.question != null || shellStatus(t, now).state === "waits-for-you"
  const attention = (t: TaskSummary) => {
    if (finalApproved(t)) return waitsAfterApproval(t)
    const s = shellStatus(t, now)
    return (
      s.openItems > 0 ||
      t.live?.question != null ||
      t.action !== null ||
      // The final review stays available during a recheck. An exit question counts only while open.
      (t.stage === "verify" && (t.verifyMode === "yours" || t.verifyMode === "rechecking")) ||
      s.state === "stopped" ||
      s.state === "waits-for-you" ||
      // The build's lead ended its turn and waits for an answer in its chat.
      asksInChat(t, now)
    )
  }
  const active = all.filter(
    (t) => !t.archived && (!finished(t) || (finalApproved(t) && waitsAfterApproval(t))),
  )
  const you = active.filter(attention)
  const running = active.filter((t) => !you.includes(t))
  return {
    all,
    open: active,
    you: [...you].sort((a, b) => (a.waitingSince ?? a.created) - (b.waitingSince ?? b.created)),
    progress: running,
    running,
    shipped: all
      .filter((t) => !t.archived && finished(t) && !active.includes(t))
      .sort((a, b) => historyAt(b) - historyAt(a)),
    archived: all.filter((t) => t.archived).sort((a, b) => historyAt(b) - historyAt(a)),
  }
}

export type ShellGroups = ReturnType<typeof shellGroups>
