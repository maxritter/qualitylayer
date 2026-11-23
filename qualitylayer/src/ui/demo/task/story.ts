// One story at every moment. The demo task starts from the flagship demo task's timeline and
// checklist because they are the closest finished shapes; this area, the last to patch, puts the App
// Model's usage-billing story into them: its 12 Done means points, its eleven slices and the lines the
// build decided on its own.

import type { Note, Timeline, TimelineSlice, TimelineTask } from "../../../core/timeline.ts"
import type { TaskDetail } from "../../api.ts"
import { verifyChecklist } from "../verify.ts"
import type { Area } from "./area.ts"
import { demoSliceFiles } from "./diffs.ts"
import { atReview, type Moment } from "./moments.ts"
import { FINANCE_CONFIRMATION, failedWords, pointState, storyChecklist } from "./story-checklist.ts"
import { BUILD_DECISIONS, DEMO_SLICE_COLUMNS, SLICES } from "./story-data.ts"

export { FINANCE_CONFIRMATION, failedWords, pointState }

/** The story's slices as the timeline holds them; `finished` ticks every box (Verify and later). */
function storySlices(finished: boolean): TimelineSlice[] {
  return SLICES.map((s) => ({
    n: s.n,
    title: s.title,
    summary: s.words,
    validation: "",
    risky: null,
    commit: null,
    ...(s.dependsOn?.length ? { dependsOn: s.dependsOn } : {}),
    ...(s.dependsReason ? { dependsReason: s.dependsReason } : {}),
    ...(finished || s.state === "done" ? { filesChanged: demoSliceFiles(s.n).length } : {}),
    tasks: s.tasks.map((line, index): TimelineTask => {
      const [id = "", ...title] = line.split(" ")
      const checked = finished || s.state === "done" || index < s.done
      return {
        id,
        title: title.join(" "),
        checked,
        state: checked ? "done" : "open",
        objective: `${title.join(" ")} through the path the Plan names; the old guesses are deleted. Its tests run beside it.`,
        files: [
          { path: `services/${s.n}/${id.toLowerCase()}.ts`, mark: "~", note: "" },
          { path: `tests/${id.toLowerCase()}.test.ts`, mark: "+", note: "" },
        ],
        testFirst: {
          kind: "test",
          text: `A test for ${id} fails today and passes with the change.`,
        },
        dod: [`${id} does what its headline says`, "Nothing outside its files changes"],
        proof: `bun test tests/${id.toLowerCase()}.test.ts`,
        design: [],
        owner: null,
        userAction: null,
      }
    }),
  }))
}

/** What the build decided on its own: a line each, under the first task of the slice that decided it. */
function storyNotes(): Note[] {
  return BUILD_DECISIONS.map((d, index) => {
    const slice = /^Slice (\d+)$/.exec(d.where)
    const first =
      slice === null ? undefined : SLICES.find((s) => s.n === Number(slice[1]))?.tasks[0]
    return {
      task: first?.split(" ")[0] ?? null,
      // A decision about the Plan is an amendment; the person agreed to one of them.
      kind: d.where === "The Plan" ? (index === 5 ? "agreed" : "amended") : "tactical",
      text: d.what,
      full: null,
      line: index + 1,
    }
  })
}

function financeConfirmation(task: TaskDetail, settled: boolean) {
  if (!settled) return {}
  return {
    answeredQuestions: [
      ...(task.answeredQuestions ?? []).filter(
        (answer) => answer.id !== "demo-finance-confirmation",
      ),
      {
        id: "demo-finance-confirmation",
        number: 9,
        question: "Can Finance schedule the billing-mode switch while support cannot?",
        choice: FINANCE_CONFIRMATION,
        at: (task.gate?.opened ?? task.shipped?.approvedAt ?? Date.now() - 4 * 3_600_000) - 60_000,
        via: "app" as const,
        delivered: true,
      },
    ],
  }
}

function buildStoryTimeline(
  base: Timeline,
  slices: TimelineSlice[],
  building: boolean,
  moment: Moment,
): Timeline {
  const now = Date.now()
  const builder = !building
    ? null
    : {
        task: "T16",
        line:
          moment === "impl-fix"
            ? "fixing the proration test in slice 4 · slice 6 goes on after"
            : "building slice 6 · 14 of 28 tasks",
        at: now - 6_000,
      }
  return {
    ...base,
    slices,
    columns: DEMO_SLICE_COLUMNS,
    builder,
    notes: [...base.notes.filter((n) => n.kind === "baseline"), ...storyNotes()],
  }
}

const VERIFY_WORKING: ReadonlySet<Moment> = new Set([
  "verify-checking",
  "verify-red",
  "verify-fixing",
  "verify-asked",
])

export const story: Area = {
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    const settled = atReview(moment) || moment.startsWith("pr-")
    const finished = VERIFY_WORKING.has(moment) || settled
    const base = task.checklist ?? (settled ? verifyChecklist("passed") : null)
    const checklist = base === null ? task.checklist : storyChecklist(base, moment)
    const confirmation = financeConfirmation(task, settled)
    if (task.timeline === null)
      return { ...task, ...confirmation, ...(checklist === undefined ? {} : { checklist }) }
    const slices = storySlices(finished)
    return {
      ...task,
      ...confirmation,
      ...(checklist === undefined ? {} : { checklist }),
      ...(task.slices.length > 0
        ? {
            slices: slices.map((s) => ({
              n: s.n,
              title: s.title,
              validation: s.validation,
              tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, checked: t.checked })),
              approved: true,
            })),
          }
        : {}),
      progress: {
        total: slices.reduce((sum, s) => sum + s.tasks.length, 0),
        checked: slices.reduce((sum, s) => sum + s.tasks.filter((t) => t.checked).length, 0),
        slices: slices.length,
      },
      timeline: buildStoryTimeline(task.timeline, slices, task.stage === "implement", moment),
    }
  },
}
