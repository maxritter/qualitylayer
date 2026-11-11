/**
 * The wire format of a public share link, which older Apps still use with /api/share:
 *
 *   https://qualitylayer.dev/s/<22 characters>#<43 characters>
 *
 * A plan and the feedback on it are sealed with a key only the link's fragment carries, so the server
 * holds ciphertext. The site's /s/<id> page is retired and reads nothing; the App's tests seal and open
 * links and build guest feedback with these functions, as the retired page did.
 */

import type { FeedbackPayload, SealedPayload } from "./types";

/** What a seal is for: the key is the link's, the purpose keeps a comment from passing as a plan. */
type Purpose = "plan" | "feedback";

const utf8 = (text: string) => new TextEncoder().encode(text);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const aesKey = (key: string, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", fromBase64(key.replace(/-/g, "+").replace(/_/g, "/") + "=") as BufferSource, "AES-GCM", false, [usage]);

const additionalData = (purpose: Purpose) => utf8(`ql-link|${purpose}`) as BufferSource;

/** Seal `plain` with the link's key (AES-GCM, a fresh 12-byte iv, both base64). */
export async function sealForLink(key: string, purpose: Purpose, plain: string): Promise<SealedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: additionalData(purpose) },
    await aesKey(key, "encrypt"),
    utf8(plain) as BufferSource,
  );
  return { v: 3, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** What a seal holds, or null when it is not one, was sealed for another purpose or with another key. */
export async function openFromLink(key: string, purpose: Purpose, sealed: unknown): Promise<string | null> {
  const s = sealed as Partial<SealedPayload> | null;
  if (typeof s !== "object" || s === null || s.v !== 3 || typeof s.iv !== "string" || typeof s.ct !== "string") return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(s.iv) as BufferSource, additionalData: additionalData(purpose) },
      await aesKey(key, "decrypt"),
      fromBase64(s.ct) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** A place in the shared change a comment is about, as the App anchors it. */
export type ChangeAnchor = { kind: "doneMeans" | "picture" | "check"; id: string; quote?: string };

/** What a guest wrote: a comment on a passage, or a thread or a reply on the change. */
export type Remark =
  | { kind: "passage"; id?: string; doc: string; quote: string; text: string; for?: "agent" | "person"; before?: string; after?: string; section?: string }
  | { kind: "thread"; thread: string; anchor: ChangeAnchor; text: string }
  | { kind: "reply"; thread: string; text: string };

const annotation = (blockId: string, originalText: string, body: string, now: number) => ({
  id: crypto.randomUUID(),
  blockId,
  originalText,
  text: body.trim(),
  createdAt: now,
});

function toAnnotation(r: Remark, now: number) {
  if (r.kind === "passage") {
    const context = { ...(r.before !== undefined ? { before: r.before } : {}), ...(r.after !== undefined ? { after: r.after } : {}), ...(r.section !== undefined ? { section: r.section } : {}) };
    return { ...annotation(r.for === "person" ? "review" : r.doc, r.for === "person" ? JSON.stringify({ t: "thread", note: true, for: "person", doc: r.doc, quote: r.quote, ...context }) : r.quote, r.text, now), ...context, ...(r.for ? { for: r.for } : {}), ...(r.id ? { id: r.id } : {}) };
  }
  // The change's threads carry a small JSON head the App decodes (core/review/threads.ts fromWire).
  const head =
    r.kind === "reply"
      ? { t: "reply", thread: r.thread }
      : {
          t: "thread",
          thread: r.thread,
          anchor: { ...r.anchor, ...(r.anchor.quote ? { quote: r.anchor.quote.slice(0, 300) } : {}) },
        };
  return annotation("review", JSON.stringify(head), r.text, now);
}

/** Everything a guest wrote, as one batch in the annotation format the App reads. */
export function remarksPayload(author: string, remarks: Remark[], now = Date.now()): FeedbackPayload {
  return { author: author.trim() || "Guest", createdAt: now, annotations: remarks.map((r) => toAnnotation(r, now)) };
}
