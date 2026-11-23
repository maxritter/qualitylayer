// What the person confirmed with their own hands (a live call, a deploy, an account): kept in
// `attestations.json` in the task's runtime folder, written by the Confirm answer in the App and
// by the agent's `qualitylayer attest`. It is never a line of the build's `## Notes`, so
// recording it cannot make a judgement stale.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { proofOf } from "./acceptance.ts"
import { isProofPath, RECORDS_DIR } from "./docs/names.ts"
import { personPointIds } from "./said.ts"
import type { Task } from "./task/store.ts"
import { itemId } from "./verdicts.ts"

export type Attestation = {
  /** The point, named like a verdict's item: `done:8`. Attesting it settles the user steps under it. */
  item: string
  /** What the person said or showed, in words. */
  text: string
  /** `you`: the Confirm answer in the App; `agent`: recorded on their behalf after they said so. */
  by: "you" | "agent"
  at: number
  /** A file under evidence/ that shows it. */
  evidence?: string
}

const attestationsPath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "attestations.json")

/** Every point with its latest attestation. */
export async function readAttestations(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Attestation[]> {
  try {
    const raw = JSON.parse(await ctx.fs.readFile(attestationsPath(task))) as unknown
    return Array.isArray(raw) ? (raw as Attestation[]) : []
  } catch {
    return []
  }
}

async function validateEvidence(
  ctx: Ctx,
  task: Task,
  raw: string | undefined,
): Promise<Result<string | undefined>> {
  if (raw === undefined || raw === "") return ok(undefined)
  const path = raw.replace(/^\.\//, "")
  if (!isProofPath(path)) {
    return err({
      code: "bad_args",
      message: `\`${raw}\` is not a file under evidence/ or ${RECORDS_DIR}/`,
    })
  }
  if (!(await ctx.fs.exists(join(task.dir, path)))) {
    return err({ code: "bad_args", message: `\`${path}\` is not in the task folder` })
  }
  return ok(path)
}

export async function recordAttestation(
  ctx: Ctx,
  task: Task,
  input: { item: string; text: string; by: Attestation["by"]; evidence?: string },
): Promise<Result<Attestation>> {
  const item = itemId(input.item)
  if (item === null || item === "check") {
    return err({
      code: "bad_args",
      message: `"${input.item}" is not a point to attest; name the Done means point, as in done <n>`,
    })
  }
  // Only what is the person's can be confirmed on their behalf: an attestation never turns a check
  // an agent judges (or failed) into a pass.
  const personal = await personPointIds(ctx, task)
  if (!personal.has(item)) {
    // A step the person checks is attested through the point it proves.
    const step = item.startsWith("acceptance:") ? item.slice("acceptance:".length) : null
    const through = (await proofOf(ctx, task)).steps
      .find((s) => s.id === step)
      ?.points.find((n) => personal.has(`done:${n}`))
    return err({
      code: "bad_args",
      message:
        `${item.replace(":", " ")} is judged by the checking agents: only a point the judge recorded as user can be attested` +
        (through === undefined
          ? ""
          : `. Attest the point it proves, as in attest done ${through} "<what the person said>"`),
    })
  }
  const text = input.text.replace(/\s+/g, " ").trim()
  if (text === "") {
    return err({ code: "bad_args", message: "an attestation needs the person's words" })
  }
  const checkedEvidence = await validateEvidence(ctx, task, input.evidence)
  if (!checkedEvidence.ok) return checkedEvidence
  const evidence = checkedEvidence.data
  const attestation: Attestation = {
    item,
    text,
    by: input.by,
    at: ctx.clock.now(),
    ...(evidence !== undefined ? { evidence } : {}),
  }
  await ctx.fs.mkdir(task.runtimeDir)
  const kept = (await readAttestations(ctx, task)).filter((a) => a.item !== item)
  await ctx.fs.atomicWrite(
    attestationsPath(task),
    `${JSON.stringify([...kept, attestation], null, 2)}\n`,
  )
  return ok(attestation)
}
