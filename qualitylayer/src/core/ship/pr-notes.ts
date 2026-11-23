// The person approved with comments on lines still open (Max, 20 October: allowed). They are not work
// for the agent: they go to the pull request as notes, once, when it opens. All of them travel as one
// review on their lines; a Replace with becomes a suggested change the author can apply. GitHub takes
// a review whole or not at all, so when it refuses one (a line it does not show in the diff), the
// notes go again as one review whose text lists them.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { type Comment, markPullRequestNotes, readComments } from "../gate/comments.ts"
import type { Task } from "../task/store.ts"
import { run } from "./pull-request.ts"

/** A comment on a line of the change that asks for something and waits for no one: a note now. */
export function pullRequestNote(c: Comment): boolean {
  if (c.doc !== "final" || c.anchor === undefined || c.ask === "question") return false
  // A message of a team review thread was said in that thread, not left for the pull request.
  if (c.source !== undefined || c.thread !== undefined) return false
  return c.answer === undefined && c.resolved === undefined && c.prNote === undefined
}

const LEAD = "Notes from the review in QualityLayer, left open when the change was approved."

/** What a note says on GitHub: its words, and a Replace with as a suggested change. */
export function noteBody(c: Comment): string {
  return c.ask === "replace" && c.replace !== undefined
    ? `${c.remark}\n\n\`\`\`suggestion\n${c.replace}\n\`\`\``
    : c.remark
}

/** The review GitHub is sent: every note on its line. */
export function reviewOf(notes: readonly Comment[]) {
  return {
    event: "COMMENT",
    body: LEAD,
    comments: notes.map((c) => ({
      path: c.anchor?.file,
      line: c.anchor?.line,
      side: c.anchor?.side === "old" ? "LEFT" : "RIGHT",
      body: noteBody(c),
    })),
  }
}

/** The same notes as one review's text, for a review GitHub would not take on its lines. */
export function listedReviewOf(notes: readonly Comment[]) {
  const listed = notes.map(
    (c) => `- \`${c.anchor?.file}:${c.anchor?.line}\` ${noteBody(c).replace(/\n/g, "\n  ")}`,
  )
  return { event: "COMMENT", body: [LEAD, "", ...listed].join("\n") }
}

/** A pull request GitHub refused notes for is tried again only after this long: every read posts. */
const RETRY_MS = 10 * 60_000
const refused = new Map<string, number>()

async function sendReview(
  ctx: Ctx,
  task: Task,
  endpoint: string,
  review: object,
): Promise<{ code: number; stderr: string } | null> {
  const file = join(task.runtimeDir, "pull-request-notes.json")
  await ctx.fs.writeFile(file, JSON.stringify(review))
  try {
    return await run(ctx, task.repoRoot, [
      "gh",
      "api",
      endpoint,
      "--method",
      "POST",
      "--input",
      file,
    ])
  } finally {
    await ctx.fs.remove(file).catch(() => {})
  }
}

function reviewEndpoint(url: string): string | null {
  const where = url.match(/^https:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  return where === null ? null : `repos/${where[1]}/${where[2]}/pulls/${where[3]}/reviews`
}

/**
 * Post the open line comments to the pull request at `url` and mark them sent; how many went, and
 * why none did when GitHub refused both ways. Every read of an open pull request calls this, so a
 * pull request the person opened themselves gets the notes too.
 */
export async function postPullRequestNotes(
  ctx: Ctx,
  task: Task,
  url: string,
): Promise<{ posted: number; error?: string }> {
  const notes = (await readComments(ctx, task)).filter(pullRequestNote)
  if (notes.length === 0) return { posted: 0 }
  const last = refused.get(url)
  if (last !== undefined && ctx.clock.now() - last < RETRY_MS)
    return { posted: 0, error: "GitHub refused the notes a moment ago; they are tried again soon" }
  const endpoint = reviewEndpoint(url)
  if (endpoint === null) return { posted: 0, error: "the pull request's address could not be read" }
  let sent = await sendReview(ctx, task, endpoint, reviewOf(notes))
  if (sent === null || sent.code !== 0)
    sent = await sendReview(ctx, task, endpoint, listedReviewOf(notes))
  if (sent === null || sent.code !== 0) {
    refused.set(url, ctx.clock.now())
    return {
      posted: 0,
      error: `GitHub did not take the notes: ${sent?.stderr.trim() || "gh is not installed"}`,
    }
  }
  refused.delete(url)
  await markPullRequestNotes(
    ctx,
    task,
    notes.map((c) => c.id),
    url,
  )
  return { posted: notes.length }
}
