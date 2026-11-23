// The demo's content for the person's review of the task ("Usage-based billing") once Verify turns
// to them (`verify`): "2 things, then approve". The description they read is `03-verify.md`
// (`description.ts`); the lanes that ran are drawn as the strip, from the same Verify files. The
// person's own question on line 7 of the first file is the one comment the demo holds on the diff. At
// `verify-rechecking` the person's comment reopened the pass: its fix is rechecked and Approve stays.

import type { Comment } from "../../../core/gate/comments.ts"
import type { Item } from "../../../core/items.ts"
import type { TaskDetail } from "../../api.ts"
import { exportReview } from "../person.ts"
import type { Area } from "./area.ts"
import { atReview, type Moment } from "./moments.ts"
import { demoLanes } from "./verify.ts"
import { DEMO_DIFF_FILE, DEMO_THREAD_LINE } from "./walkthrough.ts"

/** The person's own question on a line of the first file, drawn under that line, with the agent's answer. */
const LINE_THREAD: Comment = {
  id: "demo-wt-thread-1",
  doc: "final",
  quote: `${DEMO_DIFF_FILE}:${DEMO_THREAD_LINE}  const key = request.headers.get("x-request-id") ?? request.id`,
  remark: "Does a retry with a new request id count twice?",
  created: 1_791_000_000_000,
  answer:
    "No. The gateway keeps the first request id through every retry, so a retry is counted once.",
  answered: 1_791_000_300_000,
  anchor: { file: DEMO_DIFF_FILE, side: "new", line: DEMO_THREAD_LINE },
}

/** The illustrative proration finding whose fix `verify-rechecking` is rechecking. */
export const DEMO_OPEN_ITEM: Item = {
  id: "verify:open:demo-dir",
  step: "verify",
  family: "fix",
  kind: "found",
  kindLabel: "Decide · still open after checking",
  what: "Point 3 · Tiered invoices prorate a mid-cycle change: 2 proration tests still fail",
  why: "Failed in the review and again in the recheck after the build session's fix.",
  details:
    "**Review:** a mid-cycle downgrade prorated the lower tier half a cent off — `evidence/it1-proration.txt`\n\n**Recheck:** the same two proration tests still fail; the session fixed 2 of 3 gaps before it — `evidence/it2-proration.txt`",
  answers: { options: ["fix", "accept"], labels: { fix: "Fix it", accept: "Accept as is" } },
  blocking: false,
  state: "open",
}

/** What the judges noted on the way: one line each under the decision, waiting for nobody. */
export const DEMO_NOTES: Item[] = [
  {
    id: "verify:found:demo-help",
    step: "verify",
    family: "fix",
    kind: "found",
    kindLabel: "Found while checking",
    what: "The usage API's documentation does not name the window size",
    details:
      "The usage API's documentation does not name the window size. `GET /v1/usage` describes `meter` and `period` only — `evidence/it2-api-docs.txt`",
    tag: "follow-up",
    uncounted: true,
    answers: { options: ["accept", "fix"] },
    blocking: false,
    state: "open",
  },
  {
    id: "verify:found:demo-poll",
    step: "verify",
    family: "fix",
    kind: "found",
    kindLabel: "Found while checking",
    what: "Two aggregators on one partition flushed twice as often",
    details:
      "Two aggregators on one partition flushed twice as often. Both read `services/aggregator/src/window.ts` on their own timer — `evidence/it2-flush.txt`",
    tag: "changed in slice 3",
    uncounted: true,
    answers: { options: ["accept", "fix"] },
    blocking: false,
    state: "open",
  },
]

type DecisionSpec = {
  id: string
  family: Item["family"]
  kind: Item["kind"]
  kindLabel: string
  what: string
  patch: Partial<Item>
}

const decision = ({ id, family, kind, kindLabel, what, patch }: DecisionSpec): Item => ({
  id: `verify:${id}`,
  step: "verify",
  family,
  kind,
  kindLabel,
  what,
  answers: { options: ["fix", "accept"] },
  blocking: false,
  state: "open",
  ...patch,
})

/**
 * The one item only the person can confirm (Done 7): the `review-limits` demo fixture adds it to the
 * review's items.
 */
export const DEMO_DECISIONS: Item[] = [
  decision({
    id: "confirm:done:7",
    family: "confirm",
    kind: "confirm",
    kindLabel: "Only you can confirm",
    what: "Finance controls each account's billing mode",
    patch: {
      why: "Done 7 asks for a Finance login on the live admin. The agents checked the switch in staging; only you can confirm it on the live admin.",
      answers: { options: ["confirm", "record"] },
      blocking: true,
    },
  }),
]

export const review: Area = {
  patch: (task: TaskDetail, moment: Moment): TaskDetail =>
    !atReview(moment)
      ? task
      : moment === "verify-rechecking"
        ? {
            ...task,
            reviewFix: "judge",
            session: task.session ? { ...task.session, state: "busy" } : null,
            verifyLanes: demoLanes("rechecking"),
            comments: [...task.comments, LINE_THREAD],
            changesRequested: {
              at: Date.now() - 8 * 60_000,
              notes: [
                {
                  id: DEMO_OPEN_ITEM.id,
                  label: "Your feedback",
                  what: DEMO_OPEN_ITEM.what,
                  state: "done",
                  reply: "Illustrative proration fix; the agents are rechecking it.",
                },
              ],
            },
            review: {
              ...exportReview(),
              round: 3,
              verified: false,
              openItems: [],
            },
          }
        : { ...task, verifyLanes: demoLanes("yours"), comments: [...task.comments, LINE_THREAD] },
}
