// New artifact starts as one blank page in a registered project checkout.
// An explicit checkout selects that root; older callers retain the first available root.

import { realpath } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import type { KeepResult } from "../core/artifact/format.ts"
import { readLasting } from "../core/artifact/lasting.ts"
import { newLastingArtifact } from "../core/artifact/lasting-new.ts"
import { type Ctx, err, type Result } from "../ctx.ts"
import { findProject, projectHomes } from "./artifacts.ts"

const bad = (message: string) => err({ code: "bad_args", message })

type NewLastingInput = { name: string; title: string; purpose: string; checkout?: string }

function parseNewLastingBody(body: Record<string, unknown>): Result<NewLastingInput> {
  if (typeof body.name !== "string" || typeof body.title !== "string")
    return bad("name and title are needed")
  if (body.purpose !== undefined && typeof body.purpose !== "string")
    return bad("purpose is a sentence")
  const invalidCheckout =
    body.checkout !== undefined && (typeof body.checkout !== "string" || !isAbsolute(body.checkout))
  if (invalidCheckout) return bad("Choose a registered project checkout")
  return {
    ok: true,
    data: {
      name: body.name,
      title: body.title,
      purpose: typeof body.purpose === "string" ? body.purpose : "",
      checkout: typeof body.checkout === "string" ? body.checkout : undefined,
    },
  }
}

async function selectHome(
  homes: { root: string }[],
  checkout: string | undefined,
): Promise<Result<{ root: string }>> {
  if (checkout === undefined) {
    return homes[0] ? { ok: true, data: homes[0] } : bad("The project's checkout is not on disk")
  }
  const wanted = await realpath(checkout).catch(() => null)
  if (wanted === null) return bad("Choose a registered project checkout")
  for (const candidate of homes) {
    if ((await realpath(candidate.root).catch(() => null)) === wanted)
      return { ok: true, data: candidate }
  }
  return bad("Choose a registered project checkout")
}

async function hasDuplicateInOtherCheckout(
  homes: { root: string }[],
  selectedRoot: string,
  name: string,
): Promise<boolean> {
  for (const candidate of homes) {
    if (candidate.root !== selectedRoot && (await readLasting(candidate.root, name)).ok) return true
  }
  return false
}

export async function newLasting(
  ctx: Ctx,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Result<KeepResult>> {
  const project = await findProject(ctx, projectId)
  if (!project.ok) return project
  const parsed = parseNewLastingBody(body)
  if (!parsed.ok) return parsed
  const { name, title, purpose, checkout } = parsed.data
  return ctx.fs.withLock(
    join(ctx.home, "projects", project.data.id, "artifact-new.lock"),
    async () => {
      const homes = (await projectHomes(ctx, project.data)) as { root: string }[]
      const selected = await selectHome(homes, checkout)
      if (!selected.ok) return selected
      if (await hasDuplicateInOtherCheckout(homes, selected.data.root, name))
        return bad(`Artifact ${name} already exists in another checkout of this project`)
      return newLastingArtifact(ctx, selected.data.root, { name, title, purpose })
    },
  )
}
