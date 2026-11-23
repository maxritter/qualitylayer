// STEPS owns this adapter and /interaction/steps/* (proof, accept, retry, reopen Review).

import { confirmPoint } from "../core/interaction-steps/confirm.ts"
import { pointProof } from "../core/interaction-steps/proof.ts"
import type { Ctx } from "../ctx.ts"
import type { StepsSnapshot } from "../interaction/contracts.ts"
import { locate, type TaskDetail, taskDetail } from "./api.ts"
import { type InteractionRoute, laneStub } from "./interaction-route.ts"
export const stepsCapabilities = { pointProof: true }
export function stepsSnapshot(task: TaskDetail, _ctx: Ctx): StepsSnapshot {
  return { proof: pointProof(task) }
}
async function parseConfirmBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text()
    if (text.length > 12_000) return null
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

async function confirmStepRoute(ctx: Ctx, id: string, request: Request): Promise<Response> {
  const found = await locate(ctx, id)
  if (!found.ok) return Response.json(found, { status: 404 })
  const body = await parseConfirmBody(request)
  if (!body) {
    return Response.json(
      { ok: false, error: { code: "bad_args", message: "Expected a confirmation and note." } },
      { status: 400 },
    )
  }
  const result = await confirmPoint(ctx, found.data.task, body)
  return Response.json(result.ok ? { ok: true, ...result.data } : result, {
    status: result.ok ? 200 : 409,
  })
}

async function proofStepRoute(ctx: Ctx, id: string): Promise<Response> {
  const task = await taskDetail(ctx, id, { proofFiles: true })
  return task.ok
    ? Response.json({ ok: true, proof: pointProof(task.data) })
    : Response.json(task, { status: task.error.code === "no_task" ? 404 : 400 })
}

export const stepsRoute: InteractionRoute = async (ctx, id, path, request) => {
  if (path[0] !== "steps") return null
  if (path[1] === "confirm" && request.method === "POST" && id !== null)
    return confirmStepRoute(ctx, id, request)
  if (path[1] === "proof" && request.method === "GET" && id !== null) return proofStepRoute(ctx, id)
  return laneStub("steps")
}
