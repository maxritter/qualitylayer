// One story at every moment. The demo task starts from the flagship demo task's timeline and
// checklist because they are the closest finished shapes; this area, the last to patch, puts the App
// Model's usage-billing story into them: its 12 Done means points, its eleven slices and the lines the
// build decided on its own.

import type { Checklist, CheckRow } from "../../../core/checklist.ts"
import type { Note, TimelineSlice, TimelineTask } from "../../../core/timeline.ts"
import type { TaskDetail } from "../../api.ts"
import { verifyChecklist } from "../verify.ts"
import type { Area } from "./area.ts"
import { demoSliceFiles } from "./diffs.ts"
import { atReview, type Moment } from "./moments.ts"
import { BUILD_DECISIONS, DEMO_SLICE_COLUMNS, DONE_MEANS, SLICES } from "./story-data.ts"

/** The live-admin point is settled by a simulated answer before Verify turns to the person. */
const FINANCE_POINT = 7
export const FINANCE_CONFIRMATION =
  "Illustrative confirmation: Finance schedules the test account's switch at renewal; support cannot use the switch."
/** The point that stays open after the fix rounds, and whose fix is rechecked after the person's comment. */
const FAILING = 3
const FAILING_WORDS =
  "2 proration tests still fail: a mid-cycle downgrade prorated the lower tier half a cent off"
/** The points Verify has passed while it works, and the one it is checking now. */
const PASSED_WHILE_WORKING = [1, 2, 4, 5]
const CHECKING_NOW = 6

const POINTS = DONE_MEANS.filter((p) => !p.withdrawn)

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

/** Each point's state at a moment of Verify. */
export function pointState(n: number, moment: Moment): CheckRow["state"] {
  if (moment === "verify-rechecking") {
    return n === FAILING ? "running" : "passed"
  }
  if (moment === "verify-asked") {
    return n === FINANCE_POINT ? "user" : n === FAILING ? "failed" : "passed"
  }
  if (moment === "verify-fixing") {
    // After the fix round: every point but the Finance one and the one being rechecked stands.
    return n === FINANCE_POINT ? "user" : n === CHECKING_NOW ? "running" : "passed"
  }
  if (moment === "verify-checking" || moment === "verify-red") {
    if (n === FINANCE_POINT) return "user"
    // The model's order: point 3 failed in the first run, the next point is being checked, the rest wait.
    if (n === FAILING) return "failed"
    if (PASSED_WHILE_WORKING.includes(n)) return "passed"
    return n === CHECKING_NOW ? "running" : "waiting"
  }
  return "passed"
}

/** The words under a point that failed: the tests that still fail. */
export const failedWords = (_n: number): string => FAILING_WORDS

function storyChecklist(list: Checklist, moment: Moment): Checklist {
  const groups = list.groups.map((group) =>
    group.id !== "done"
      ? group
      : {
          ...group,
          rows: POINTS.map((p): CheckRow => {
            const state = pointState(p.n, moment)
            return {
              id: `done:${p.n}`,
              label: p.text,
              state,
              ...(state === "failed"
                ? { text: failedWords(p.n) }
                : state === "user"
                  ? { text: "it needs a Finance login on the live admin" }
                  : state === "passed"
                    ? {
                        text:
                          p.n === FINANCE_POINT
                            ? FINANCE_CONFIRMATION
                            : "proved on the running program",
                      }
                    : {}),
            }
          }),
        },
  )
  const rows = groups.flatMap((g) => g.rows)
  const counted = rows.filter((r) => r.off !== true && r.state !== "user" && r.extra !== true)
  return {
    ...list,
    groups,
    total: counted.length,
    passed: counted.filter((r) => r.state === "passed").length,
    failed: rows.filter((r) => r.state === "failed").length,
    user: rows.filter((r) => r.state === "user"),
  }
}

export const story: Area = {
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    const settled = atReview(moment) || moment.startsWith("pr-")
    const finished =
      ["verify-checking", "verify-red", "verify-fixing", "verify-asked"].includes(moment) || settled
    // The review keeps the finished checks and the illustrative answer that settled its live-admin point.
    const base = task.checklist ?? (settled ? verifyChecklist("passed") : null)
    const checklist = base === null ? task.checklist : storyChecklist(base, moment)
    const confirmation = settled
      ? {
          answeredQuestions: [
            ...(task.answeredQuestions ?? []).filter(
              (answer) => answer.id !== "demo-finance-confirmation",
            ),
            {
              id: "demo-finance-confirmation",
              number: 9,
              question: "Can Finance schedule the billing-mode switch while support cannot?",
              choice: FINANCE_CONFIRMATION,
              at:
                (task.gate?.opened ?? task.shipped?.approvedAt ?? Date.now() - 4 * 3_600_000) -
                60_000,
              via: "app" as const,
              delivered: true,
            },
          ],
        }
      : {}
    if (task.timeline === null)
      return { ...task, ...confirmation, ...(checklist === undefined ? {} : { checklist }) }
    const slices = storySlices(finished)
    const building = task.stage === "implement"
    const now = Date.now()
    return {
      ...task,
      ...confirmation,
      ...(checklist === undefined ? {} : { checklist }),
      // The slices the build reads beside the timeline.
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
      timeline: {
        ...task.timeline,
        slices,
        columns: DEMO_SLICE_COLUMNS,
        builder: building
          ? moment === "impl-fix"
            ? {
                task: "T16",
                line: "fixing the proration test in slice 4 · slice 6 goes on after",
                at: now - 6_000,
              }
            : {
                task: "T16",
                line: "building slice 6 · 14 of 28 tasks",
                at: now - 6_000,
              }
          : null,
        notes: [...task.timeline.notes.filter((n) => n.kind === "baseline"), ...storyNotes()],
      },
    }
  },
}
