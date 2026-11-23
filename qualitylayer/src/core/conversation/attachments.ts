import {
  asJsonObject,
  asString,
  attachmentDigest,
  attachmentPart,
  MAX_ENCODED_ATTACHMENT,
} from "./attachment-parts.ts"
import type {
  ConversationAttachment,
  ConversationAttachmentSource,
  ConversationEvent,
} from "./types.ts"

const MAX_IMAGES = 6

type VisitState = { found: ConversationAttachment[]; nodes: number }

function visitImageParts(item: unknown, pointer: string[], depth: number, state: VisitState): void {
  if (++state.nodes > 256 || depth > 9 || state.found.length >= MAX_IMAGES) return
  if (Array.isArray(item)) {
    for (
      let index = 0;
      index < item.length && state.nodes < 256 && state.found.length < MAX_IMAGES;
      index++
    )
      visitImageParts(item[index], [...pointer, String(index)], depth + 1, state)
    return
  }
  const record = asJsonObject(item)
  if (!record) return
  const image = attachmentPart(record, pointer)
  if (image) {
    state.found.push(image)
    return
  }
  for (const [key, child] of Object.entries(record))
    if (key.length <= 80 && typeof child === "object")
      visitImageParts(child, [...pointer, key], depth + 1, state)
}

/** Recognized native image parts only; text that merely says [image] is not an attachment. */
export function conversationAttachments(value: unknown): ConversationAttachment[] {
  const state: VisitState = { found: [], nodes: 0 }
  visitImageParts(value, [], 0, state)
  return state.found.map((image, index) => ({
    ...image,
    name: image.name === "Image" ? `Image ${index + 1}` : image.name.slice(0, 160),
  }))
}

/** Native labels decorate structured pictures; literal markers without pictures remain text. */
export function imageMessageText(
  text: string,
  attachments: readonly ConversationAttachment[],
): string {
  let clean = text.trim()
  const imageCount = attachments.filter((file) => file.type.startsWith("image/")).length
  for (let index = 0; index < imageCount; index++) {
    const next = clean.replace(/^\[Image ?#?\d+\]\s*/i, "")
    if (next === clean) break
    clean = next
  }
  return clean
}

export function imageContentText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return asString(asJsonObject(content)?.text) ?? ""
  return content
    .map((part) => asString(asJsonObject(part)?.text) ?? "")
    .filter(Boolean)
    .join("\n")
}

function rememberRecordImages(
  line: string,
  position: number,
  sources: Map<string, ConversationAttachmentSource>,
): void {
  if (!/image|mime|attachment|document|application\/pdf/.test(line)) return
  try {
    for (const image of conversationAttachments(JSON.parse(line))) {
      const source = image.source
      if (source?.kind !== "inline") continue
      sources.set(source.digest, { ...source, offset: position })
      while (sources.size > 256) {
        const oldest = sources.keys().next().value
        if (oldest === undefined) break
        sources.delete(oldest)
      }
    }
  } catch {
    /* Malformed native records are not image sources. */
  }
}

/** Keep only small locators between reads; pixels are read on demand from the native record. */
export function rememberImageSources(
  lines: string,
  offset: number | undefined,
  sources: Map<string, ConversationAttachmentSource>,
): void {
  if (offset === undefined) return
  let position = offset
  for (const line of lines.split("\n")) {
    rememberRecordImages(line, position, sources)
    position += Buffer.byteLength(line) + 1
  }
}

export function bindImageSources(
  events: ConversationEvent[],
  sources: ReadonlyMap<string, ConversationAttachmentSource>,
): ConversationEvent[] {
  return events.map((event) =>
    event.kind !== "user" || !event.attachments
      ? event
      : {
          ...event,
          attachments: event.attachments.map((image) =>
            image.source?.kind === "inline"
              ? {
                  ...image,
                  source: sources.get(image.source.digest) ?? {
                    ...image.source,
                    pointer: undefined,
                  },
                }
              : image,
          ),
        },
  )
}

export function inlineImageData(
  record: unknown,
  source: Extract<ConversationAttachmentSource, { kind: "inline" }>,
  type: string,
): string | undefined {
  let value: unknown = record
  for (const key of source.pointer ?? [])
    value = asJsonObject(value)?.[key] ?? (Array.isArray(value) ? value[Number(key)] : undefined)
  if (typeof value !== "string") return undefined
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,(.*)$/s.exec(value)
  const encoded = match?.[1] ?? value
  return encoded.length <= MAX_ENCODED_ATTACHMENT &&
    attachmentDigest(type, encoded) === source.digest
    ? encoded
    : undefined
}
