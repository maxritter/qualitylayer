// The one place the step pages read the task's three step documents from: `TaskDetail.pages`
// (src/core/pages/detail.ts). Each page is its document's body cut at its markers,
// `<!-- ql:NAME [args] -->` … `<!-- /ql:NAME -->`, with the plain fallback QualityLayer keeps
// between them. The App draws its live parts over the markers; nothing else in the App reads the
// documents' shape.

import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { DocBlock } from "../../core/docs/markers.ts"
import { NAMES } from "../../core/docs/names.ts"
import type { FlowStepId } from "../../core/flow.ts"
import { flattenItems, type Item } from "../../core/items.ts"
import type { PageMarker, StepPage as ServedPage } from "../../core/pages/detail.ts"
import type { TaskDetail } from "../api.ts"

// The server's shape, as it is sent; the pages and the tests read it through these names.
export type { DocBlock, PageMarker, ServedPage }

/** A step's document as the step page renders it. */
export type StepDocument = {
  step: FlowStepId
  /** The file's name in the task folder: `01-plan.md`. */
  file: string
  markdown: string
  markers: PageMarker[]
  blocks: DocBlock[]
}

/** Our own name for a marker, as the pages key it. */
export type StepMarker = PageMarker

/** One step's document, or null when the step's file is not written yet. */
export function stepDocumentOf(
  task: Pick<TaskDetail, "pages">,
  step: FlowStepId,
): StepDocument | null {
  const page = (task.pages ?? []).find((p) => p.step === step)
  if (page === undefined || !page.exists) return null
  return {
    step,
    file: page.name,
    markdown: page.body,
    markers: page.markers,
    blocks: page.blocks,
  }
}

/**
 * The step's document, or for the step the task is at an empty one when its file is not written
 * yet (Implement, Verify): the page draws its board from the task's own records. A step the task
 * has not reached has none.
 */
export function stepDocumentOrPending(
  task: Pick<TaskDetail, "pages" | "stage">,
  step: FlowStepId,
): StepDocument | null {
  const doc = stepDocumentOf(task, step)
  // The Plan before its first draft is the quiet "being written" state, not an empty page.
  if (doc !== null || step === "plan") return doc
  const here = task.stage === "shipped" ? "verify" : task.stage
  if (here !== step) return null
  const page = (task.pages ?? []).find((p) => p.step === step)
  return { step, file: page?.name ?? NAMES[step], markdown: "", markers: [], blocks: [] }
}

// ---------------------------------------------------------------- a marker's state

/** The Plan's decision a `ql:decide <id>` marker stands over: `plan:decision:<id>`, else the Nth for `d<N>`. */
export function decisionItem(items: readonly Item[], id: string): Item | undefined {
  // "Decided with you" is a decision item too, but a record, not one of the Plan's.
  const decisions = items.filter(
    (i) => i.step === "plan" && i.kind === "decision" && i.id.startsWith("plan:decision:"),
  )
  const exact = decisions.find((i) => i.id === `plan:decision:${id}`)
  if (exact !== undefined) return exact
  const nth = /^d(\d+)$/.exec(id)?.[1]
  return nth !== undefined ? decisions[Number(nth) - 1] : undefined
}

const artifactName = (media: Item["media"]) =>
  media?.kind === "artifact" ? (media.name.split("/").pop() ?? "").replace(/\.html$/, "") : ""

/**
 * The item a `ql:artifact <name>` marker stands over: the Plan's `plan:artifact:<name>`, else the
 * Plan's one showing it.
 */
export function artifactItem(items: readonly Item[], name: string): Item | undefined {
  const plan = items.filter((i) => i.step === "plan")
  return (
    plan.find((i) => i.id === `plan:artifact:${name}`) ??
    plan.find((i) => i.kind === "mockup" && artifactName(i.media) === name) ??
    (plan.filter((i) => i.kind === "mockup").length === 1
      ? plan.find((i) => i.kind === "mockup")
      : undefined)
  )
}

/** The artifact's file as the App loads it: the item's own (`artifacts/<name>.html`), else by its name. */
export const artifactFile = (name: string, item: Item | undefined): string => {
  const reference = parseArtifactReference(name)
  if (reference && (name.includes("/") || reference.section))
    return reference.file + (reference.section ? `#${reference.section}` : "")
  return item?.media?.kind === "artifact"
    ? item.media.name
    : (reference?.file ?? `artifacts/${name}.html`)
}

/** The Plan's "Decisions made for you": the members of the agent's decided group. */
export const madeForYouItems = (items: readonly Item[]): Item[] =>
  items.find((i) => i.step === "plan" && i.kind === "decided")?.children ?? []

const isGroupAgreed = (group: Item | undefined): group is Item =>
  group?.answer?.kind === "agree" && group.updated !== true && group.changedSinceReview !== true

const canInheritAgreement = (point: Item): boolean =>
  point.state === "open" && point.answer === undefined && point.changedSinceReview !== true

/** The Plan's Done means: each point's own answer, or the agreement covering the whole group. */
export function donePointItems(items: readonly Item[]): Item[] {
  const group = items.find((i) => i.step === "plan" && i.kind === "done")
  const agreed = isGroupAgreed(group)
  return (group?.children ?? []).map((point) =>
    agreed && canInheritAgreement(point)
      ? { ...point, state: group.state, answer: group.answer }
      : point,
  )
}

/**
 * Verify's items: what the checks found and what only the person can confirm. A stop is a need of
 * the build, drawn apart.
 */
export const checkItems = (items: readonly Item[]): Item[] =>
  flattenItems(items).filter(
    (i) => i.step === "verify" && (i.kind === "found" || i.kind === "confirm"),
  )
