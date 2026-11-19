import { runningHelpers } from "../../core/interaction-shell/status.ts"
import { livenessOf } from "../../core/live/liveness.ts"
import type { TaskDetail } from "../api.ts"
import { projectCheckWords } from "../steps/verify/checks.ts"
import "./verify-activity.css"

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

const peerAt = (task: TaskDetail, now: number) => {
  const peer = task.verifyActivity?.peer
  return peer && peer.expires > now ? peer : undefined
}

export function verifyPause(task: TaskDetail, now: number) {
  if (task.stage !== "verify" || runningHelpers(task, now).length > 0) return null
  const signals = task.live?.signals
  const life = signals ? livenessOf(signals, now) : null
  const refusal = task.verifyActivity?.judgeRefusal
  const peer = peerAt(task, now)
  const movedOn = life?.state === "working" && life.last.at > (refusal?.at ?? 0)
  if (life?.state === "permission" || life?.state === "stopped" || movedOn) return null
  if (peer) return { title: "Waiting for a peer agent", detail: peer.name }
  if (refusal) return { title: "Review could not start", detail: refusal.reason }
  return life?.state === "turn-end"
    ? { title: "No active turn", detail: `The lead ended its turn at ${clock(life.at)}.` }
    : null
}

const VERIFY_EVENTS: Readonly<Record<string, string>> = {
  verify_ready: "Ready for your review",
  round_started: "Fix round started",
  verify_exit: "Verify asked for a decision",
}

type ActivityEvent = { at: number; text: string }

function reviewEventText(event: Record<string, unknown>) {
  if (typeof event.event !== "string") return undefined
  if (event.event !== "verify_result") return VERIFY_EVENTS[event.event]
  const passed = event.passed
  if (passed === true || event.result === "passed") return "Independent review passed"
  if (passed === false || event.result === "failed") return "Independent review failed"
  return "Independent review recorded"
}

function liveEvents(task: TaskDetail, now: number): ActivityEvent[] {
  const rows: ActivityEvent[] = []
  const { projectChecks, judgeRefusal } = task.verifyActivity ?? {}
  if (projectChecks?.commands.length)
    rows.push({ at: projectChecks.at, text: projectCheckWords(projectChecks.commands) })
  if (judgeRefusal) rows.push({ at: judgeRefusal.at, text: "Independent review could not start" })
  const peer = peerAt(task, now)
  if (peer) rows.push({ at: peer.at, text: `Asked peer agent ${peer.name}` })
  const signals = task.live?.signals
  if (signals) {
    const life = livenessOf(signals, now)
    if (life.state === "permission") rows.push({ at: life.at, text: "Agent requested permission" })
    if (life.state === "turn-end") rows.push({ at: life.at, text: "Lead ended its turn" })
  }
  return rows
}

function recordedActivity(task: TaskDetail, now: number) {
  const source = task.events ?? []
  const start = source.findLast((event) => event.to === "verify" && typeof event.ts === "number")
  const since = typeof start?.ts === "number" ? start.ts : 0
  const events = new Map<string, ActivityEvent>()
  const add = ({ at, text }: ActivityEvent) => {
    if (Number.isFinite(at) && at >= since && at <= now) events.set(`${at}:${text}`, { at, text })
  }
  if (since > 0) add({ at: since, text: "Verify started" })
  for (const event of source) {
    const text = reviewEventText(event)
    if (typeof event.ts === "number" && text) add({ at: event.ts, text })
  }
  for (const event of liveEvents(task, now)) add(event)
  return [...events.values()].sort((a, b) => b.at - a.at).slice(0, 6)
}

export function VerifyActivityTimeline({ task, now }: { task: TaskDetail; now: number }) {
  if (task.stage !== "verify") return null
  const events = recordedActivity(task, now)
  if (events.length === 0) return null
  return (
    <section className="verify-activity-events" aria-label="Recorded activity">
      <h3>Recorded activity</h3>
      <ol>
        {events.map((event) => (
          <li key={`${event.at}:${event.text}`}>
            <time dateTime={new Date(event.at).toISOString()}>{clock(event.at)}</time>
            <span>{event.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
