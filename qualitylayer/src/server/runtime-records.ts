import { readAnswerAsset } from "../core/records/answer-assets.ts"
import { archiveRecords, readArchiveAsset, readArchiveRecord } from "../core/records/archive.ts"
import {
  ANNOTATION_ARCHIVE,
  ARTIFACT_RECORD_LAYOUTS,
  type RecordOwner,
  token,
} from "../core/records/contract.ts"
import {
  currentRecordState,
  deriveRecordOwner,
  registeredRecordRoots,
  validateRecordOwner,
} from "../core/records/owner.ts"
import { readItemAnswers } from "../core/task/item-answer-store.ts"
import type { Ctx } from "../ctx.ts"
import {
  attachmentResponse,
  RECORD_HEADERS,
  standaloneRecordRoute,
} from "./runtime-records-standalone.ts"

export type RuntimeRecordAddress =
  | { scope: "task"; id: string }
  | { scope: "artifact"; id: string; file: string }

function parseAddressOwner(address: RuntimeRecordAddress): { projectId: string; slug?: string } {
  if (address.scope === "task") {
    const [id, task, extra] = address.id.split("~")
    if (!token(id) || !token(task) || extra !== undefined)
      throw new Error("Invalid private task owner")
    return { projectId: id, slug: task }
  }
  if (!token(address.id)) throw new Error("Invalid private artifact project")
  return { projectId: address.id }
}

async function tryOwner(
  ctx: Ctx,
  address: RuntimeRecordAddress,
  owner: RecordOwner,
): Promise<RecordOwner | null> {
  try {
    await validateRecordOwner(ctx, owner)
    if (address.scope === "artifact") await currentRecordState(ctx, owner)
    return owner
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code !== "ENOENT" && address.scope === "artifact") throw cause
    return null
  }
}

async function recordOwner(ctx: Ctx, address: RuntimeRecordAddress): Promise<RecordOwner> {
  const { projectId, slug } = parseAddressOwner(address)
  const layouts = address.scope === "task" ? [undefined] : ARTIFACT_RECORD_LAYOUTS
  for (const root of await registeredRecordRoots(ctx, projectId)) {
    for (const storage of layouts) {
      const candidate = deriveRecordOwner(
        ctx.home,
        address.scope === "task"
          ? { kind: "task", projectId, root, slug: slug as string }
          : { kind: "artifact", projectId, root, file: address.file, storage },
      )
      const matched = await tryOwner(ctx, address, candidate)
      if (matched) return matched
    }
  }
  throw new Error("This private record has no live registered owner")
}

async function recordResponse(ctx: Ctx, owner: RecordOwner, entry?: string, asset?: string) {
  if (entry === undefined) {
    return Response.json(
      { id: ANNOTATION_ARCHIVE, entries: await archiveRecords(ctx, owner) },
      { headers: RECORD_HEADERS },
    )
  }
  if (asset === undefined) {
    return new Response(await readArchiveRecord(ctx, owner, entry), {
      headers: { ...RECORD_HEADERS, "content-type": "application/json; charset=utf-8" },
    })
  }
  return attachmentResponse(await readArchiveAsset(ctx, owner, entry, asset))
}

async function itemAnswerAttachmentResponse(
  ctx: Ctx,
  address: RuntimeRecordAddress,
  owner: RecordOwner,
  entry: string | undefined,
  asset: string | undefined,
): Promise<Response> {
  if (address.scope !== "task") throw new Error("Item attachments belong to a task")
  const answer = (await readItemAnswers(ctx, owner)).find((row) => row.record.id === entry)
  const reference = answer?.attachments?.find(
    (file) => file.ref.entry === entry && file.ref.asset === asset,
  )
  if (!reference) throw new Error("Unknown retained answer attachment")
  return attachmentResponse(await readAnswerAsset(ctx, owner, reference))
}

function isValidRecordRef(parts: readonly string[], currentAnswer: boolean): boolean {
  const entry = parts[1]
  const asset = parts[3]
  if (!currentAnswer && parts.length === 1) return true
  if (!currentAnswer && parts.length === 2 && token(entry)) return true
  return parts.length === 4 && token(entry) && parts[2] === "assets" && token(asset)
}

async function serveReadRecord(
  ctx: Ctx,
  address: RuntimeRecordAddress,
  parts: readonly string[],
  currentAnswer: boolean,
): Promise<Response> {
  try {
    const owner = await recordOwner(ctx, address)
    if (currentAnswer)
      return await itemAnswerAttachmentResponse(ctx, address, owner, parts[1], parts[3])
    return await recordResponse(ctx, owner, parts[1], parts[3])
  } catch {
    return new Response("This private record is unavailable", {
      status: 404,
      headers: RECORD_HEADERS,
    })
  }
}

/** Registered opaque references only; historical content has no action or executable response. */
export async function runtimeRecordRoute(
  ctx: Ctx,
  address: RuntimeRecordAddress,
  parts: readonly string[],
  method: string,
): Promise<Response> {
  if (
    address.scope === "artifact" &&
    parts[0] === ANNOTATION_ARCHIVE &&
    ["status", "upgrade", "snapshots"].includes(parts[1] ?? "")
  )
    return standaloneRecordRoute(ctx, address, parts, method)
  if (method !== "GET")
    return new Response("Read-only record", { status: 405, headers: RECORD_HEADERS })
  const currentAnswer = parts[0] === "item-answers-v1"
  if (parts[0] !== ANNOTATION_ARCHIVE && !currentAnswer)
    return new Response("Unknown record", { status: 404, headers: RECORD_HEADERS })
  if (!isValidRecordRef(parts, currentAnswer))
    return new Response("Unknown record reference", { status: 404, headers: RECORD_HEADERS })
  return serveReadRecord(ctx, address, parts, currentAnswer)
}
