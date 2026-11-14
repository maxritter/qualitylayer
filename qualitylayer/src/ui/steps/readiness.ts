import { shellStatus } from "../../core/interaction-shell/status.ts"
import { trimEndCharacters } from "../../core/text-boundaries.ts"
import type { TaskDetail } from "../api.ts"
import type { ImplementView } from "../step-page/state.ts"

/** A draft names work only while an attached agent is actually working. */
export function stepIsWorking(task: TaskDetail, now = Date.now()): boolean {
  const attached =
    task.session != null ||
    task.live?.signals != null ||
    task.helpers.some((helper) => helper.state === "running")
  return attached && shellStatus(task, now).state === "working"
}

const named = (title: string, fallback: string): boolean => {
  const label = trimEndCharacters(title.trim(), ".:")
  return (
    label !== "" &&
    label.toLowerCase() !== fallback.toLowerCase() &&
    !/^(?:untitled|…|\.{3})$/i.test(label)
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
