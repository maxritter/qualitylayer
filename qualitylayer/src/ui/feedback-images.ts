// Screenshots for a report: PNG, JPEG or WebP, each cut down to 2,000 px on the long side and under
// 5 MB, and under 4 MB together (the site takes 4.5 MB of request). A browser without a canvas
// (a test) passes an image through when it is small enough already.

import {
  type FeedbackImage,
  type ImageType,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_TOTAL_BYTES,
  sniffImage,
} from "../core/feedback/report.ts"

export const MAX_SIDE = 2000

export type Shot = FeedbackImage & { id: string; url: string }

async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

async function encode(
  source: ImageBitmap,
  width: number,
  height: number,
  type: ImageType,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (context === null) return null
  // A JPEG has no transparency: a screenshot with some goes onto white, not black.
  if (type === "image/jpeg") {
    context.fillStyle = "#fff"
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(source, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Cut an image to MAX_SIDE and, when it is still large, to a JPEG; null when no canvas can or nothing
 * needs doing. A JPEG is always drawn again: the new file carries none of the old one's metadata
 * (camera, place), which a screenshot has no use for.
 */
async function shrink(
  file: Blob,
  type: ImageType,
): Promise<{ bytes: Uint8Array; type: ImageType; scaled: boolean } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    if (scale === 1 && file.size <= MAX_IMAGE_BYTES / 2 && type !== "image/jpeg") return null
    let blob = await encode(bitmap, width, height, type, 0.9)
    // A large PNG becomes a JPEG: the shape of a screen survives, the size does not.
    if (blob !== null && blob.size > MAX_IMAGE_BYTES / 2 && type === "image/png") {
      type = "image/jpeg"
      blob = await encode(bitmap, width, height, type, 0.85)
    }
    bitmap.close()
    return blob === null || blob.type !== type
      ? null
      : { bytes: await readBytes(blob), type, scaled: scale < 1 }
  } catch {
    return null
  }
}

export type Prepared = { ok: true; shot: Shot } | { ok: false; message: string }

type PngResult = { ok: true; bytes: Uint8Array } | { ok: false; message: string }

async function convertToPublicPng(
  file: File,
  type: ImageType,
  original: Uint8Array,
): Promise<PngResult> {
  if (typeof createImageBitmap !== "function") {
    if (type === "image/png") return { ok: true, bytes: original }
    return {
      ok: false,
      message: "PNG conversion is unavailable. Export this screenshot as PNG and add it again.",
    }
  }
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const blob = await encode(
      bitmap,
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
      "image/png",
      1,
    )
    if (blob?.type !== "image/png") throw new Error("PNG conversion unavailable")
    return { ok: true, bytes: await readBytes(blob) }
  } catch {
    return {
      ok: false,
      message: "This image could not be converted to PNG. Export it as PNG and add it again.",
    }
  } finally {
    bitmap?.close()
  }
}

function validatePublicFileMeta(file: File, taken: Shot[]): string | null {
  if (taken.length >= MAX_IMAGES) return "Use at most five screenshots."
  if (file.size > MAX_IMAGE_BYTES) return "Choose an image up to 5 MB."
  return null
}

/** Public preparation always produces PNG; the server independently strips and validates it. */
export async function preparePublicImage(file: File, taken: Shot[]): Promise<Prepared> {
  const metaError = validatePublicFileMeta(file, taken)
  if (metaError !== null) return { ok: false, message: metaError }
  const original = await readBytes(file)
  const type = sniffImage(original)
  if (type === null) return { ok: false, message: "Choose a PNG, JPEG or WebP screenshot." }
  const converted = await convertToPublicPng(file, type, original)
  if (!converted.ok) return converted
  const { bytes } = converted
  if (taken.reduce((sum, shot) => sum + shot.bytes.length, 0) + bytes.length > MAX_TOTAL_BYTES)
    return { ok: false, message: "Screenshots must be up to 4 MB together. Use a smaller image." }
  return {
    ok: true,
    shot: {
      id: crypto.randomUUID(),
      name: file.name || "Screenshot",
      type: "image/png",
      bytes,
      url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" })),
    },
  }
}

/** One chosen, pasted or dropped file, made ready; or why it cannot be sent. */
export async function prepareImage(file: File, taken: Shot[]): Promise<Prepared> {
  if (taken.length >= MAX_IMAGES)
    return { ok: false, message: `At most ${MAX_IMAGES} screenshots can be sent.` }
  let bytes = await readBytes(file)
  let type = sniffImage(bytes)
  if (type === null) return { ok: false, message: "Screenshots must be PNG, JPEG or WebP images." }
  const smaller = await shrink(file, type)
  // A cut-down image is taken even when its re-encoding is bigger: 2,000 px is the promise, not the size.
  if (
    smaller !== null &&
    (smaller.scaled || type === "image/jpeg" || smaller.bytes.length < bytes.length)
  ) {
    bytes = smaller.bytes
    type = smaller.type
  }
  if (bytes.length > MAX_IMAGE_BYTES)
    return { ok: false, message: "That screenshot is over 5 MB, even made smaller." }
  const total = taken.reduce((sum, shot) => sum + shot.bytes.length, 0) + bytes.length
  if (total > MAX_TOTAL_BYTES)
    return { ok: false, message: "The screenshots are too large to send together (4 MB at most)." }
  const name =
    file.name !== "" ? file.name : `screenshot.${type === "image/jpeg" ? "jpg" : type.slice(6)}`
  const url =
    typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
      : ""
  return { ok: true, shot: { id: crypto.randomUUID(), name, type, bytes, url } }
}

export function forgetShot(shot: Shot): void {
  if (shot.url !== "" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(shot.url)
}
