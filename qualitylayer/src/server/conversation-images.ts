import { createHash } from "node:crypto"
import { cachedEvents, type NativeRun, readConversation } from "../core/conversation/service.ts"
import type { ConversationAttachment, ConversationEvent } from "../core/conversation/types.ts"
import { messageAttachmentType } from "../core/interaction-docs/attachments.ts"
import type { Ctx } from "../ctx.ts"
import { prepareAttachmentEvents } from "./conversation-files.ts"
import { conversationImageBytes } from "./conversation-images-source.ts"

const revision = (image: ConversationAttachment) =>
  createHash("sha256")
    .update(JSON.stringify(image.source ?? null))
    .digest("hex")

const unavailable = () =>
  new Response("This attachment is unavailable.", {
    status: 404,
    headers: { "cache-control": "no-store" },
  })

function canLinkAttachment(
  recordId: unknown,
  pathname: string,
  run: NativeRun,
  available: boolean,
): boolean {
  if (!available || pathname.length > 2048) return false
  return String(recordId).length <= 512 && (run.nativeSession?.length ?? 0) <= 512
}

function wireSingleAttachment(
  image: ConversationAttachment,
  index: number,
  options: {
    recordId: unknown
    pathname: string
    run: NativeRun
    available: boolean
    keepSource: boolean
  },
): ConversationAttachment {
  const { source, url: _url, ...metadata } = image
  if (
    !source ||
    !canLinkAttachment(options.recordId, options.pathname, options.run, options.available)
  )
    return metadata
  const query = new URLSearchParams({
    attachment: String(options.recordId),
    index: String(index),
    generation: String(options.run.generation),
    session: options.run.nativeSession ?? "",
    version: revision(image),
  })
  return {
    ...metadata,
    ...(options.keepSource ? { source } : {}),
    url: `${options.pathname}?${query}`,
  }
}

/** A wire event never contains the source path, record locator or encoded pixels. */
export function wireAttachmentEvents<T>(
  value: T,
  pathname: string,
  run: NativeRun,
  available = true,
  keepSource = false,
): T {
  if (Array.isArray(value))
    return value.map((item) =>
      wireAttachmentEvents(item, pathname, run, available, keepSource),
    ) as T
  if (value === null || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (record.kind === "user" && Array.isArray(record.attachments)) {
    return {
      ...record,
      attachments: record.attachments.map((image: ConversationAttachment, index: number) =>
        wireSingleAttachment(image, index, {
          recordId: record.id,
          pathname,
          run,
          available,
          keepSource,
        }),
      ),
    } as T
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      wireAttachmentEvents(item, pathname, run, available, keepSource),
    ]),
  ) as T
}

async function resolveTargetAttachment(
  ctx: Ctx,
  run: NativeRun,
  params: URLSearchParams,
): Promise<ConversationAttachment | null> {
  const id = params.get("attachment")
  const rawIndex = params.get("index") ?? ""
  const index = Number(rawIndex)
  if (
    params.get("generation") !== String(run.generation) ||
    params.get("session") !== run.nativeSession
  )
    return null
  if (!id || id.length > 512 || !/^\d$/.test(rawIndex) || index >= 6) return null
  readConversation(ctx, run)
  const event = cachedEvents(run).find(
    (entry): entry is Extract<ConversationEvent, { kind: "user" }> =>
      entry.kind === "user" && entry.id === id,
  )
  const prepared = event ? (await prepareAttachmentEvents(ctx, run, [event]))[0] : undefined
  const image = prepared?.kind === "user" ? prepared.attachments?.[index] : undefined
  if (!image) return null
  if (params.has("version") && params.get("version") !== revision(image)) return null
  return image
}

/** Caller already applied the Conversation's paired-session and native-run binding checks. */
export async function conversationAttachmentResponse(
  ctx: Ctx,
  run: NativeRun,
  params: URLSearchParams,
): Promise<Response> {
  const image = await resolveTargetAttachment(ctx, run, params)
  if (!image) return unavailable()
  try {
    const bytes = await conversationImageBytes(ctx, run, image)
    const type = bytes ? messageAttachmentType(image.name, bytes) : null
    if (!bytes || !type) return unavailable()
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "content-type": type,
        "content-length": String(bytes.length),
        "content-disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(image.name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    })
  } catch {
    return unavailable()
  }
}
