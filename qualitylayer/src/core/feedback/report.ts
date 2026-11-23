// A feedback report as the App and the command line build it, and the checks both run before
// anything is written or sent. The site checks the same limits again.

import type { Diagnostics } from "./words.ts"

export const MAX_TEXT = 5000
export const MAX_IMAGES = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Vercel refuses a request over 4.5 MB: screenshots and text together stay under 4 MiB. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024

export type FeedbackKind = "bug" | "idea"
export type Sender = { name: string; email: string }
export type ImageType = "image/png" | "image/jpeg" | "image/webp"
export type FeedbackImage = { name: string; type: ImageType; bytes: Uint8Array }

export type Report = {
  /** Sent along, so a retry from the outbox never files the report twice. */
  id: string
  kind: FeedbackKind
  text: string
  /** Name and e-mail, which a trial report must carry; a licence report is vouched for by its key. */
  sender: Sender | null
  diagnostics: Diagnostics | null
  images: FeedbackImage[]
}

const EXTENSION: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}
export const imageExtension = (type: ImageType) => EXTENSION[type]

/** The image type the first bytes name, or null: a file's own name or type is not believed. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (offset: number, ...expected: number[]) =>
    expected.every((value, index) => bytes[offset + index] === value)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
  // RIFF....WEBP
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"
  return null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validEmail = (value: string) => value.length <= 254 && EMAIL.test(value)

function imagesProblem(images: FeedbackImage[], textBytes: number): string | null {
  if (images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} screenshots can be sent.`
  let total = textBytes
  for (const image of images) {
    if (image.bytes.length > MAX_IMAGE_BYTES) return "A screenshot can be at most 5 MB."
    total += image.bytes.length
  }
  return total > MAX_TOTAL_BYTES
    ? "The screenshots are too large to send together (4 MB at most)."
    : null
}

function trialSenderProblem(sender: Sender | null): string | null {
  if (sender === null || sender.name.trim() === "") return "Your name is needed to send."
  return validEmail(sender.email.trim()) ? null : "A valid e-mail is needed to send."
}

/** Why a report cannot be sent as it stands, in a sentence for the person, or null. */
export function problemWith(report: Report, trial: boolean): string | null {
  const text = report.text.trim()
  if (text === "") return "Write what happened or what you would like."
  if ([...text].length > MAX_TEXT) return `The text can be at most ${MAX_TEXT} characters.`
  const imageError = imagesProblem(report.images, Buffer.byteLength(text))
  if (imageError !== null) return imageError
  return trial ? trialSenderProblem(report.sender) : null
}
