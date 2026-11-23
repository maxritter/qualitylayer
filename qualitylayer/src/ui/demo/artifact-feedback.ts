// The demo's feedback on the visitor's own artifacts: an in-memory stand-in for the App's local
// artifact feedback routes. A comment queues for the busy artifact agent, a helper steps in after a
// short wait and answers; nothing leaves the page. State is bounded; the oldest entries go first.

import type { CommentThread } from "../../interaction/contracts.ts"
import type { ArtifactFeedbackAddress, ArtifactFeedbackApi } from "../artifact/feedback-api.ts"
import {
  addComment,
  clone,
  DEMO_PICK_MS,
  type DemoLocalSource,
  listForAddress,
  resolveLocalSource,
  runAgentChange,
  runHelperAnswer,
  threadIn,
  withThreadHandling,
} from "./artifact-feedback-helpers.ts"

export type { DemoLocalSource }

export type DemoArtifactFeedbackOptions = {
  /** Reads the local artifact behind an address; without it a single page is derived from the file name. */
  localSource?: (address: ArtifactFeedbackAddress) => Promise<DemoLocalSource>
  /**
   * Feedback the agent takes and changes the page for (the story's billing-mode page), in place of a
   * helper's answer: its answer, and the change it makes when it answers.
   */
  agentChanges?: (
    address: ArtifactFeedbackAddress,
  ) => { answer: string; apply: () => void } | undefined
}

export function createDemoArtifactFeedback(
  options: DemoArtifactFeedbackOptions = {},
): ArtifactFeedbackApi<ArtifactFeedbackAddress> {
  let serial = 0
  const nextId = (prefix: string) => `${prefix}-${++serial}`
  const threads = new Map<string, CommentThread[]>()
  const listOf = (address: ArtifactFeedbackAddress) => listForAddress(threads, address)

  return {
    read: async (address) => ({
      threads: clone(listOf(address).map(withThreadHandling)),
      capabilities: { team: false },
    }),
    helper: async (address, id) => {
      const found = threadIn(listOf(address), address.file, id)
      runHelperAnswer(found, 2500, nextId)
      return clone(withThreadHandling(found))
    },
    context: async (address) => {
      const source = await resolveLocalSource(address, options.localSource)
      return {
        revision: source.revision,
        prompt: `Artifact: ${source.title}\nScope: ${address.scope}\nProject or task: ${address.id}\nSource: ${address.file}\nPages: ${source.pages.join(", ")}`,
      }
    },
    post: async (address, input) => {
      const added = addComment(listOf(address), address.file, input, nextId, Date.now())
      const stored = listOf(address).find((one) => one.id === added.id)
      const change = options.agentChanges?.(address)
      if (stored && !input.thread && input.for !== "person") {
        if (change) setTimeout(() => runAgentChange(stored, change, nextId), 2_000)
        else setTimeout(() => runHelperAnswer(stored, 3500, nextId), DEMO_PICK_MS)
      }
      return added
    },
    state: async (address, thread, open) => {
      const found = threadIn(listOf(address), address.file, thread)
      found.state = open ? "open" : "resolved"
      return clone(found)
    },
    attachment: (_address, comment, name) =>
      `data:text/plain;charset=utf-8,${encodeURIComponent(`Demo attachment ${name} (${comment})`)}`,
  }
}
