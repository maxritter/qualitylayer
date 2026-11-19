import type { ReviewCandidateInput, ReviewCandidateState } from "../../core/review-candidate.ts"
import { DEMO_TASK_ID } from "./identity.ts"

export function demoReviewCandidate() {
  if (
    typeof location === "undefined" ||
    new URLSearchParams(location.search).get("review-candidate") !== "rebased"
  )
    return {}
  const candidateExample: ReviewCandidateState = {
    eligible: true,
    repository: "acme/platform",
    version: "example",
    prior: {
      branch: "feature/address-import",
      head: "83e12c79b2e32d57cd041d53e2f1c40ef26028ae",
      commits: 16,
      slices: 4,
      stale: 13,
    },
    choices: [
      {
        checkout: "worktrees/address-import",
        branch: "feature/address-import",
        head: "fbd70e2fa8012074b89b35393aad1ac8fa429f08",
        subject: "Validate addresses before import",
        shared: false,
      },
      {
        checkout: "platform",
        branch: "develop",
        head: "4ab67d2ef1ab900e5a2711d4931618359bad42cb",
        subject: "Merge address import with the batch update",
        shared: true,
      },
    ],
  }
  return {
    reviewCandidates: async (id: string) =>
      id === DEMO_TASK_ID
        ? { ...candidateExample }
        : { eligible: false, repository: "", version: "", choices: [] },
    selectReviewCandidate: async (id: string, input: ReviewCandidateInput) => {
      const choice = candidateExample.choices.find(
        (c) => c.checkout === input.checkout && c.head === input.head,
      )
      if (
        id !== DEMO_TASK_ID ||
        !choice ||
        input.version !== candidateExample.version ||
        (choice.shared && !input.acknowledgeShared)
      )
        throw Error("Choose the checkout and current commit again.")
      candidateExample.selected = { ...choice, selectedAt: Date.now(), state: "pending" }
      return { ...candidateExample }
    },
  }
}
