import { afterAll, afterEach, expect, mock, test } from "bun:test"
import type { ReviewCandidateState } from "../../src/core/review-candidate.ts"
import { mountDom, type Rtl, unmountDom } from "../helpers/dom.ts"

const rtl: Rtl = await mountDom()
const { ReviewCandidate } = await import("../../src/ui/steps/verify/ReviewCandidate.tsx")
afterEach(() => rtl.cleanup())
afterAll(() => unmountDom(rtl))

test("a stale displayed choice requires a new confirmation for the refreshed commit", async () => {
  const choice = {
    checkout: "/local/feature",
    branch: "feature/import",
    head: "a".repeat(40),
    subject: "Validate imported addresses",
    shared: false,
  }
  const old: ReviewCandidateState = {
    repository: "platform",
    version: "first",
    eligible: true,
    choices: [choice],
  }
  const current = { ...choice, head: "b".repeat(40), subject: "Handle empty addresses" }
  const latest: ReviewCandidateState = { ...old, version: "second", choices: [current] }
  let changed = false
  const read = mock(async () => (changed ? latest : old))
  const save = mock(async (_id: string, input: { version: string }) => {
    if (input.version === "first") {
      changed = true
      throw Error("The review choices changed. Open the candidate chooser again.")
    }
    return { ...latest, selected: { ...current, selectedAt: 100, state: "pending" as const } }
  })
  const view = rtl.render(
    <ReviewCandidate id="task-a" reviewCandidates={read} selectReviewCandidate={save} />,
  )
  const open = await view.findByRole("button", { name: "Choose review commit…" })
  rtl.fireEvent.click(open)
  rtl.fireEvent.click(await view.findByRole("button", { name: "Start fresh review" }))
  expect((await view.findByRole("alert")).textContent).toContain("choices changed")
  expect(save).toHaveBeenCalledTimes(1)
  rtl.fireEvent.click(open)
  expect(await view.findByText(current.subject)).toBeTruthy()
  rtl.fireEvent.click(view.getByRole("button", { name: "Start fresh review" }))
  expect(await view.findByText("Fresh review requested")).toBeTruthy()
  expect(save.mock.calls[1]?.[1]).toMatchObject({
    version: "second",
    head: current.head,
    checkout: current.checkout,
  })
})
