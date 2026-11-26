// What a task's page marks becomes a quick field: Plan or Review text, an artifact's spot, region
// or words, and code lines in the Review workspace. Each mark knows its place in plain words and,
// once sent, the full context the agent reads (task, page, revision, section or lines, quote).

import type {
  ContextDraftTarget,
  ContextualRequest,
} from "../agent-window/conversation/context-draft.ts"
import { taskPassageContext } from "../agent-window/conversation/context-draft.ts"
import type { ArtifactPageMark } from "../artifact/ArtifactPage.tsx"
import type { ReaderMark } from "../reader/DocReader.tsx"
import type { CodeMark } from "../review-workspace/ReviewWorkspace.tsx"
import { clip, type QuickAskMark, sourceRevision } from "./store.ts"

type Task = { id: string; title: string }

const words = (slug: string) => {
  const text = slug.replace(/[-_]+/g, " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}

/** "03-plan.md" → "Plan"; any other file keeps its name. */
export function pageName(page: string): string {
  const name = page.replace(/^.*\//, "")
  // A step page without its file ("verify") reads like the file's step: "Verify".
  const step = /^\d+-([a-z]+)\.md$/i.exec(name)?.[1] ?? /^[a-z]+$/.exec(name)?.[0]
  return step ? words(step) : name
}

/** Below the last line of the mark, where the field opens. */
const below = (boxes: readonly { x: number; y: number; height: number }[]) => {
  const first = boxes[0]
  const last = boxes.at(-1)
  return { x: first?.x ?? 24, y: (last?.y ?? 24) + (last?.height ?? 0) + 6 }
}

/** Selected words of a task document (the Plan, Review). */
export function passageMark(
  task: Task,
  target: ContextDraftTarget,
  page: string,
  mark: ReaderMark,
): QuickAskMark {
  const section = mark.passage.section && mark.passage.section !== "document-start"
  const place = `${pageName(page)}${section ? ` › ${words(mark.passage.section ?? "")}` : ""}`
  return {
    kind: "passage",
    place,
    quote: mark.passage.quote,
    at: below(mark.boxes),
    boxes: mark.boxes,
    context: async () => ({
      ...(await taskPassageContext({
        target,
        title: task.title,
        page,
        source: mark.source,
        passage: mark.passage,
      })),
      place,
      mark: "passage",
    }),
    onClose: () => window.getSelection()?.removeAllRanges(),
  }
}

type QuoteMarkArgs = [
  task: Task,
  target: ContextDraftTarget,
  page: string,
  source: string,
  quote: string,
  anchor: Element,
]

/** Words quoted by a button on a step page ("Ask why"), opened under that button. */
export function quoteMark(...args: QuoteMarkArgs): QuickAskMark {
  const [task, target, page, source, quote, anchor] = args
  const box = anchor.getBoundingClientRect()
  const place = pageName(page)
  return {
    kind: "passage",
    place,
    quote,
    at: { x: box.left - 300, y: box.bottom + 6 },
    context: async () => ({
      target,
      title: task.title,
      page,
      revision: await sourceRevision(source),
      section: "document-start",
      quote,
      place,
      mark: "passage",
    }),
  }
}

function artifactTargetHint(mark: ArtifactPageMark): string {
  if (mark.target?.selector) return ` · ${mark.target.selector}`
  if (mark.mark !== "region") return ""
  const ids = (mark.targets ?? [])
    .slice(0, 2)
    .map((t) => t.selector)
    .filter(Boolean)
    .join(", ")
  return ids ? ` · ${ids}` : " · region"
}

/** A spot clicked, an element marked, a region dragged or words selected on one of the task's artifacts. */
export function artifactMark(
  task: Task,
  target: ContextDraftTarget,
  title: string,
  file: string,
  mark: ArtifactPageMark,
): QuickAskMark {
  const part = mark.section ? ` › ${mark.section}` : ""
  const place = `${title}${part}${artifactTargetHint(mark)}`
  const quote = mark.quote || mark.target?.selector || title
  const page = mark.file ?? file
  const isBox = mark.mark === "region" || mark.mark === "element"
  const hasSize = isBox && mark.width !== undefined && mark.height !== undefined
  return {
    kind: "artifact",
    place,
    quote,
    at:
      mark.mark === "spot" && mark.point
        ? { x: mark.point.x - 20, y: mark.point.y + 18 }
        : below(mark.boxes),
    boxes: mark.mark === "spot" ? [] : mark.boxes,
    ...(mark.mark === "spot" && mark.point ? { pin: mark.point } : {}),
    ...(isBox ? { region: true } : {}),
    context: async (): Promise<ContextualRequest> => ({
      target,
      title: task.title,
      artifact: { scope: "task", id: task.id, file, title },
      page,
      revision: await sourceRevision(mark.html),
      section: mark.section ?? `${mark.mark}-${mark.x}-${mark.y}`,
      ...(mark.mark === "spot" ? { spot: { x: mark.x, y: mark.y } } : {}),
      ...(hasSize
        ? {
            region: {
              x: mark.x,
              y: mark.y,
              width: mark.width as number,
              height: mark.height as number,
            },
          }
        : {}),
      quote: clip(quote, 600),
      place,
      mark: "artifact",
    }),
  }
}

/** Code lines marked in the Review workspace. */
export function codeMark(task: Task, target: ContextDraftTarget, mark: CodeMark): QuickAskMark {
  const lines = mark.start === mark.end ? `${mark.start}` : `${mark.start}–${mark.end}`
  const place = `${mark.path.replace(/^.*\//, "")} › ${mark.start === mark.end ? "Line" : "Lines"} ${lines}`
  return {
    kind: "code",
    place,
    quote: mark.quote,
    at: mark.at,
    onClose: mark.clear,
    context: async () => ({
      target,
      title: task.title,
      page: mark.path,
      revision: await sourceRevision(`${mark.path}\n${mark.side}\n${mark.quote}`),
      section: `${mark.side === "old" ? "old-" : ""}lines-${mark.start}-${mark.end}`,
      lines,
      quote: mark.quote.slice(0, 4000),
      place,
      mark: "code",
    }),
  }
}
