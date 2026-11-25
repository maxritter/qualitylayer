import { shellStatus } from "../../core/interaction-shell/status.ts"
import { agoShort } from "../../core/live/liveness.ts"
import type { TaskDetail } from "../api.ts"
import type { ImplementView } from "../step-page/state.ts"

const QUIET_THINKING_MS = 15_000
const GENERIC_HOOK_WORDS = new Set(["you wrote to it", "its turn ended", "the session ended"])

/** A draft names work only while an attached agent is actually working. */
export function stepIsWorking(task: TaskDetail, now = Date.now()): boolean {
  const attached =
    task.session != null ||
    task.live?.signals != null ||
    task.helpers.some((helper) => helper.state === "running")
  return attached && shellStatus(task, now).state === "working"
}

function quietThinkingText(task: TaskDetail, now: number): string | null {
  const signals = task.live?.signals
  if (signals?.modelWaiting !== true || signals.tool != null) return null
  const last = shellStatus(task, now).lastActivity
  if (last === null) return null
  const age = Math.max(0, now - last)
  return age >= QUIET_THINKING_MS ? `Thinking for ${agoShort(age)}` : null
}

function fallbackActivity(task: TaskDetail): string | undefined {
  const hook = task.live?.signals?.hook
  const words = hook?.event !== "SessionEnd" ? hook?.words?.trim() || null : null
  if (words !== null && !GENERIC_HOOK_WORDS.has(words)) return `Last: ${words}`
  return task.helpers.find((one) => one.state === "running")?.line?.trim() || undefined
}

/** Concise live activity line for a step still being written, or undefined when none is active. */
export function stepActivity(task: TaskDetail, now = Date.now()): string | undefined {
  if (!stepIsWorking(task, now)) return undefined
  const signals = task.live?.signals
  const todo = signals?.todo?.items.find((item) => item.state === "now")?.text.trim() || null
  const tool = signals?.tool?.words?.trim() || null
  const thinking = quietThinkingText(task, now)
  if (todo !== null) {
    const detail = tool ?? thinking
    return detail && detail !== todo ? `${todo} · ${detail}` : todo
  }
  return tool ?? thinking ?? fallbackActivity(task)
}

const named = (title: string, fallback: string): boolean => {
  const label =
    title
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/[`*_~]/g, "")
      .match(/[\p{L}\p{N}](?:[\s\S]*[\p{L}\p{N}])?/u)?.[0] ?? ""
  return (
    /[\p{L}\p{N}]/u.test(label) &&
    label.toLowerCase() !== fallback.toLowerCase() &&
    !/^(?:untitled|(?:slice\s*|task\s*)?(?:T\d+|\d+))$/i.test(label)
  )
}

/** Readable rows only; a partly written replacement does not displace a complete board. */
export function readableBuild(view: ImplementView | undefined): {
  view: ImplementView | undefined
  complete: boolean
} {
  if (!view) return { view, complete: false }
  let complete = view.slices.length > 0
  const slices = view.slices.flatMap((slice) => {
    const cards = slice.cards?.filter((card) => named(card.title, card.id))
    if (!named(slice.title, `Slice ${slice.n}`) || slice.tasks === 0 || cards?.length === 0) {
      complete = false
      return []
    }
    if (cards === undefined || cards.length === slice.cards?.length) return [slice]
    complete = false
    const kept = new Set(cards.map((card) => card.id))
    const segs = slice.segs.filter((_, index) => kept.has(slice.cards?.[index]?.id ?? ""))
    const status =
      slice.status === "run" && !segs.includes("r")
        ? segs.includes("d")
          ? ("progress" as const)
          : ("wait" as const)
        : slice.status
    return [{ ...slice, cards, tasks: cards.length, segs, status }]
  })
  const now =
    view.now &&
    named(view.now.title, view.now.id) &&
    slices.some(
      (slice) => slice.cards === undefined || slice.cards.some((card) => card.id === view.now?.id),
    )
      ? view.now
      : undefined
  return { view: { ...view, slices, now }, complete }
}

export function verificationReady(task: TaskDetail): boolean {
  return (
    (task.verifyLanes ?? []).some(
      (lane) =>
        lane.who.trim() !== "" ||
        lane.result.trim() !== "" ||
        !["waiting", "skipped"].includes(lane.state),
    ) || (task.checkProgress?.length ?? 0) > 0
  )
}

/** Retained board words never retain a stopped agent's working mark. */
export function restingBuild(
  view: ImplementView | undefined,
  stopped: boolean,
): ImplementView | undefined {
  if (!view) return view
  return {
    ...view,
    now: undefined,
    slices: view.slices.map((slice) => ({
      ...slice,
      status:
        slice.status === "run"
          ? slice.segs.includes("d")
            ? ("progress" as const)
            : ("wait" as const)
          : slice.status,
      segs: slice.segs.map((segment) => (segment === "r" ? ("" as const) : segment)),
      cards: slice.cards?.map((card) =>
        card.state === "building"
          ? { ...card, state: stopped ? ("stopped" as const) : ("next" as const) }
          : card,
      ),
    })),
  }
}
