import { outsideState, sendFromApp, targetOf } from "../core/integrations/approval-app.ts"
import { readReviewCandidates, selectReviewCandidate } from "../core/review-candidate.ts"
import type { Task } from "../core/task/store.ts"
import { type Ctx, err, ok } from "../ctx.ts"
import { locate } from "./api.ts"
import { body, json } from "./http-result.ts"
import { readArtifactBody } from "./request-body.ts"

async function reviewCandidate(ctx: Ctx, task: Task, request: Request) {
  if (request.method === "GET") return json(ok(await readReviewCandidates(ctx, task)))
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  const bytes = await readArtifactBody(request, 16 * 1024)
  let input: unknown
  try {
    input = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return json(err({ code: "bad_args", message: "The review choice must be valid JSON." }))
  }
  return json(await selectReviewCandidate(ctx, task, input))
}

export async function taskDecisionRoute(
  ctx: Ctx,
  id: string,
  parts: string[],
  request: Request,
  mayChoose: boolean,
) {
  const route = parts[3]
  if (parts.length !== 4 || (route !== "review-candidate" && route !== "outside-approval"))
    return null
  if (!mayChoose && (route === "review-candidate" || request.method === "POST"))
    return new Response("This browser may only watch", { status: 403 })
  const found = await locate(ctx, id)
  if (!found.ok) return json(found)
  const { task } = found.data
  if (route === "review-candidate") return reviewCandidate(ctx, task, request)
  return outsideApproval(ctx, task, request)
}

async function outsideApproval(ctx: Ctx, task: Task, request: Request) {
  if (request.method === "GET")
    return json(
      ok(await outsideState(ctx, task, targetOf(new URL(request.url).searchParams.get("target")))),
    )
  if (request.method === "POST")
    return json(await sendFromApp(ctx, task, targetOf((await body(request)).target)))
  return null
}
