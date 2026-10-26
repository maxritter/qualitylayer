/**
 * The shared-plan page's client: read a link and send what a guest wrote.
 *
 *   https://qualitylayer.dev/s/<22 characters>#<43 characters>   sealed plan, 14 days
 *
 * The plan and everything a guest sends are sealed in the browser with a key that only the link's
 * fragment carries, so the server holds ciphertext and never receives the key (a fragment
 * is not sent). Answers and comments go to POST /api/share/feedback in an annotation format, so the
 * owner's App reads them. Anyone with the whole link may read and comment; nobody votes.
 */

import type { FeedbackPayload, SealedPayload } from "./types";
import { publicArtifactPayload, type PublicArtifactPayload } from "../../../../../qualitylayer/src/core/artifact/public-link-format.ts";
import { isBuiltStill, sharedDocuments, sharedScreenStills, stripSharedCode, STEP_DOCS } from "../../../../../qualitylayer/src/core/team/publication.ts";
import { threadUpdates, type ThreadUpdate } from "../../../../../qualitylayer/src/core/team/thread-publication.ts";

export const SHARE_ID = /^[A-Za-z0-9]{22}$/;

/** 32 random bytes, base64url without padding. */
const LINK_KEY = /^[A-Za-z0-9_-]{43}$/;

/** The key a link's fragment carries, or "" when the link has none (or not a whole one). */
export function linkKeyOf(hash: string): string {
  const key = hash.startsWith("#") ? hash.slice(1) : hash;
  return LINK_KEY.test(key) ? key : "";
}

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

/** The seven steps a task goes through, as the App names them. */
export type FlowStep = "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review";

/** The steps a link reviewer reads, as the App names them. */
export type Tab = FlowStep;

/** Every step, in the order the work runs. */
export const ALL_TABS: readonly Tab[] = ["discuss", "research", "plan", "outline", "implement", "verify", "review"];

/** Only raster stills of artifacts referenced by the Plan, never the artifact's source. */
export type PlanStill = { title: string; image: string; built?: string; outcome?: "omitted: size" };

/** What a guest can say to a question: agree, suggest a change, or reply in their own words. */
export type GuestAnswer = "agree" | "change" | "reply";

/** The thing a question is about, drawn under it. Only what a guest can see: no diff of the code. */
export type ItemMedia =
  | { kind: "artifact"; name: string; title?: string }
  | { kind: "mermaid"; source: string; title?: string }
  | { kind: "text"; text: string };

/**
 * One question the owner asks the guest: the App's item (qualitylayer/src/core/items.ts), sent as
 * `items` in the plan, reduced to what a guest can answer. Only the fields this page shows are typed.
 */
export type ShareItem = {
  id: string;
  step: FlowStep;
  family: "decide" | "look";
  kind: string;
  kindLabel: string;
  what: string;
  why?: string;
  /** The buttons, in order. */
  options: GuestAnswer[];
  media?: ItemMedia;
  /** A group ("Decided by the agent · 7"): what its members say. */
  members?: string[];
};

export type LoadedShare =
  | { status: "ready"; kind: "artifact"; id: string; payload: PublicArtifactPayload; expires?: string }
  | {
      status: "ready";
      kind: "v2";
      title: string;
      id?: string;
      threads?: ThreadUpdate[];
      /** Who shared it, as the App names them; the page says "the owner" without it. */
      owner?: string;
      stage?: string;
      /** Documents by name; the page sorts them into steps (`stepDocs`). Research is never among them. */
      docs: Record<string, string>;
      /** The owner's questions for this link. Empty for a link made before the App sent any. */
      items: ShareItem[];
      stills?: Record<string, PlanStill>;
      /** ISO time the link runs out. */
      expires?: string;
      /** The finished, verified change, when the task got that far (v2 only). */
      review?: SharedReview;
    }
  /** Revoked, expired, or never there. */
  | { status: "gone" }
  /** The link was copied without the part after `#`: nothing to open the plan with. */
  | { status: "no-key" }
  | { status: "error"; message: string };

/**
 * What a link reviewer reads of the finished change: the App's SharedReview
 * (qualitylayer/src/core/review/detail.ts), sent as `docs["review.json"]` once a
 * fresh check has passed. It holds the proofs and evidence only, never threads,
 * reviewers, source, the diff or logs. Only the fields this page shows are typed.
 */
export type SharedReview = {
  round: number | null;
  judge: string | null;
  verified: boolean;
  doneMeans: { n: number; head: string; text: string; proven: boolean; proof: string; evidence: string[] }[];
  tiles: {
    key: string;
    label: string;
    passed: number;
    total: number;
    lines: { ok: boolean; label: string; text: string; evidence: string[] }[];
  }[];
  pictures: { file: string; caption: string }[];
  proofs: { file: string; title: string; caption: string }[];
  second: { name: string; state: string; findings: number | null } | null;
  tryIt: { text: string; command: string | null }[];
  notVerified: string[];
  pr: { number: number | null; title: string; url: string; state: string; checks: string; branch: string } | null;
  images: Record<string, string>;
};

/** The change's document in a v2 share; it is data, not a document to read. */
export const REVIEW_DOC = "review.json";

const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/** The shared change from untrusted JSON, or undefined when it is missing or malformed. */
export function parseReview(text: string | undefined): SharedReview | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Partial<SharedReview>;
  if (typeof r.verified !== "boolean" || !isList(r.doneMeans) || !isList(r.tiles)) return undefined;
  return {
    round: typeof r.round === "number" ? r.round : null,
    judge: typeof r.judge === "string" ? r.judge : null,
    verified: r.verified,
    doneMeans: r.doneMeans,
    tiles: r.tiles,
    pictures: isList(r.pictures) ? r.pictures : [],
    proofs: isList(r.proofs) ? r.proofs : [],
    second: r.second ?? null,
    tryIt: isList(r.tryIt) ? r.tryIt : [],
    notVerified: isList(r.notVerified) ? r.notVerified : [],
    pr: r.pr ?? null,
    // Only inline images: a picture never makes the page fetch from elsewhere.
    images: Object.fromEntries(
      Object.entries(r.images ?? {}).filter(([, url]) => typeof url === "string" && url.startsWith("data:image/")),
    ),
  };
}

/** The step each shared document belongs to: the seven numbered files, by their exact names. */
const STEP_OF_DOC = new Map<string, Tab>(ALL_TABS.flatMap((tab) => STEP_DOCS[tab].map((name) => [name, tab] as const)));

const byName = (a: string, b: string) => a.replace(/\.md$/, "").localeCompare(b.replace(/\.md$/, ""));

/**
 * The documents a link reader sees under the step tabs, never their file names: only the seven
 * step files. Anything else a link carries (data, mockups, a stray file) is not shown as a document.
 */
export function stepDocs(docs: Record<string, string>): Record<Tab, string[]> {
  const steps: Record<Tab, string[]> = { discuss: [], research: [], plan: [], outline: [], implement: [], verify: [], review: [] };
  for (const name of Object.keys(docs).sort(byName)) {
    const tab = STEP_OF_DOC.get(name);
    if (tab !== undefined) steps[tab].push(name);
  }
  return steps;
}

/** A question stays under the step that asked it. */
export const tabOfStep = (step: FlowStep): Tab => step;

/** The App's answers, read as a guest's three. */
const AS_GUEST: Record<string, GuestAnswer> = {
  agree: "agree",
  accept: "agree",
  fine: "agree",
  keep: "agree",
  add: "agree",
  change: "change",
  fix: "change",
  "ask-why": "change",
  skip: "change",
  record: "change",
  reply: "reply",
};

/** What a guest is asked: decisions and things to look at. A question for the agent, a stop, a teammate's question and another agent's finding stay in the App. */
const GUEST_KINDS = new Set(["decision", "decided", "scope", "done", "asked", "mockup", "result", "diagram"]);

const STEPS: readonly string[] = ALL_TABS;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function parseMedia(value: unknown): ItemMedia | undefined {
  const m = value as { kind?: unknown; name?: unknown; source?: unknown; title?: unknown; text?: unknown } | null;
  if (typeof m !== "object" || m === null) return undefined;
  const title = str(m.title);
  if (m.kind === "artifact" && str(m.name) !== undefined) return { kind: "artifact", name: m.name as string, ...(title ? { title } : {}) };
  if (m.kind === "mermaid" && str(m.source) !== undefined) return { kind: "mermaid", source: m.source as string, ...(title ? { title } : {}) };
  if (m.kind === "text" && str(m.text) !== undefined) return { kind: "text", text: m.text as string };
  return undefined;
}

/**
 * The owner's questions from untrusted JSON. A guest is asked what a guest can judge: decisions
 * and things to look at. What only the owner can confirm or fix stays in the App, and so does
 * anything already settled.
 */
export function parseItems(value: unknown): ShareItem[] {
  if (!isList(value)) return [];
  const items: ShareItem[] = [];
  for (const raw of value) {
    const i = raw as Record<string, unknown> | null;
    if (typeof i !== "object" || i === null || str(i.id) === undefined || str(i.what) === undefined) continue;
    const family = i.family === undefined ? "decide" : i.family;
    if (family !== "decide" && family !== "look") continue;
    if (!GUEST_KINDS.has(str(i.kind) ?? "decision")) continue;
    if (i.state === "settled" || i.state === "sent") continue;
    const asked = (i.answers as { options?: unknown } | undefined)?.options;
    const options = [
      ...new Set((isList(asked) ? asked : []).flatMap((o) => (typeof o === "string" && AS_GUEST[o] !== undefined ? [AS_GUEST[o] as GuestAnswer] : []))),
    ];
    const members = isList(i.children) ? i.children.flatMap((c) => str((c as { what?: unknown } | null)?.what) ?? []) : [];
    const media = parseMedia(i.media);
    const why = str(i.why);
    items.push({
      id: i.id as string,
      step: STEPS.includes(i.step as string) ? (i.step as FlowStep) : "plan",
      family,
      kind: str(i.kind) ?? "decision",
      kindLabel: str(i.kindLabel) ?? "Question",
      what: i.what as string,
      ...(why ? { why } : {}),
      options: options.length > 0 ? options : ["agree", "change"],
      ...(media ? { media } : {}),
      ...(members.length > 0 ? { members } : {}),
    });
  }
  return items;
}

/** The button's words: the App's for a mockup (Looks right), a decision (Agree) and any change (Suggest a change). */
export function answerWords(item: Pick<ShareItem, "family">, answer: GuestAnswer): string {
  if (answer === "agree") return item.family === "look" ? "Looks right" : "Agree";
  return answer === "change" ? "Suggest a change" : "Reply";
}

type Plan = { task: string; owner?: string; stage?: string; docs: Record<string, string>; items: ShareItem[]; stills?: Record<string, PlanStill>; threads?: ThreadUpdate[] };

/** The plan a link holds: its title and the documents, as text. What opened is still untrusted, so it is rebuilt. */
export function parsePlan(plain: string | null): Plan | null {
  if (plain === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(plain);
  } catch {
    return null;
  }
  const plan = value as { task?: unknown; owner?: unknown; docs?: unknown; items?: unknown; stage?: unknown; stills?: unknown; threads?: unknown } | null;
  if (typeof plan !== "object" || plan === null || typeof plan.docs !== "object" || plan.docs === null) return null;
  const all = Object.fromEntries(
    Object.entries(plan.docs).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  // Research stays with the agent: even a link that carries it does not hand it to the page.
  const docs = sharedDocuments(all, typeof plan.stage === "string" ? plan.stage : undefined);
  const owner = str(plan.owner)?.trim().slice(0, 80);
  const stills: Record<string, PlanStill> = sharedScreenStills(plan.stills);
  let used = Object.values(stills).reduce((n, still) => n + still.image.length + (still.built?.length ?? 0), 0);
  let count = Object.values(stills).filter((still) => !still.outcome).length;
  if (typeof plan.stills === "object" && plan.stills !== null) {
    for (const [name, raw] of Object.entries(plan.stills)) {
      const still = raw as Partial<PlanStill> | null;
      if (/^(?:artifact|artifacts)\/[a-z0-9][a-z0-9-]*\.html$/.test(name) && typeof still?.title === "string" && typeof still.image === "string" && still.image.length <= 400_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(still.image)) {
        if (still.built !== undefined && !isBuiltStill(still.built)) continue;
        const size = still.image.length + (still.built?.length ?? 0);
        if (count >= 6 || used + size > 400_000) continue;
        stills[name] = { title: still.title.slice(0, 160), image: still.image, ...(still.built ? { built: still.built } : {}) };
        used += size;
        count++;
      }
    }
  }
  return {
    task: typeof plan.task === "string" ? stripSharedCode(plan.task) : "Shared task",
    ...(owner ? { owner: stripSharedCode(owner) } : {}),
    ...(typeof plan.stage === "string" ? { stage: plan.stage } : {}),
    docs,
    items: [],
    threads: threadUpdates(plan.threads, docs),
    ...(Object.keys(stills).length > 0 ? { stills } : {}),
  };
}

/** Read a share link's plan: fetch the sealed copy and open it with the link's key. */
export type ShareUpdate =
  | { kind: "loaded"; state: LoadedShare; rev?: number }
  | { kind: "unchanged" }
  | { kind: "retry"; message: string; retryAfter?: number };

/** A visible guest polls only this link's sealed payload, never team changes or feedback. */
export async function readShareUpdate(id: string, key: string, since?: number, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<ShareUpdate> {
  if (!SHARE_ID.test(id)) return { kind: "loaded", state: { status: "error", message: "This does not look like a share link." } };
  if (key === "") return { kind: "loaded", state: { status: "no-key" } };
  let res: Response;
  try {
    const url = `/api/share?id=${encodeURIComponent(id)}${since === undefined ? "" : `&since=${since}`}`;
    res = await (signal === undefined ? fetchFn(url) : fetchFn(url, { signal }));
  } catch {
    return { kind: "retry", message: "The share service could not be reached. Try again in a moment." };
  }
  if (res.status === 304 && since !== undefined) return { kind: "unchanged" };
  if (res.status === 404) return { kind: "loaded", state: { status: "gone" } };
  if (!res.ok) {
    const raw = res.headers.get("Retry-After");
    const seconds = raw === null ? Number.NaN : Number(raw);
    const wait = Number.isFinite(seconds) ? seconds * 1000 : raw === null ? Number.NaN : Date.parse(raw) - Date.now();
    return { kind: "retry", message: "The shared content could not be loaded. Try again in a moment.", ...(res.status === 429 && wait > 0 ? { retryAfter: Math.min(wait, 86_400_000) } : {}) };
  }

  const body = (await res.json().catch(() => null)) as { expires?: string; rev?: number } | null;
  const plain = await openFromLink(key, "plan", body);
  let decoded: unknown;
  try { decoded = plain === null ? null : JSON.parse(plain); } catch { decoded = null; }
  const kind = decoded && typeof decoded === "object" && "kind" in decoded ? decoded.kind : undefined;
  if (kind === "artifact") {
    const payload = publicArtifactPayload(decoded);
    return { kind: "loaded", ...(Number.isSafeInteger(body?.rev) ? { rev: body!.rev } : {}), state: payload
      ? { status: "ready", kind: "artifact", id, payload, expires: body?.expires }
      : { status: "error", message: "This shared artifact could not be opened. Ask the owner for a new link." } };
  }
  if (kind !== undefined && kind !== "v2") return { kind: "loaded", state: { status: "error", message: "This link contains an unsupported kind of shared content." } };
  const plan = parsePlan(plain);
  if (plan === null)
    return { kind: "retry", message: "The shared content could not be opened. Check that the whole link was copied." };
  const review = parseReview(plan.docs[REVIEW_DOC]);
  const { [REVIEW_DOC]: _review, "items.json": _items, ...docs } = plan.docs;
  return { kind: "loaded", ...(Number.isSafeInteger(body?.rev) && (body?.rev ?? -1) >= 0 ? { rev: body!.rev } : {}), state: {
    status: "ready",
    kind: "v2",
    title: plan.task,
    id,
    threads: plan.threads ?? [],
    ...(plan.owner !== undefined ? { owner: plan.owner } : {}),
    ...(plan.stage !== undefined ? { stage: plan.stage } : {}),
    docs,
    items: plan.items,
    ...(plan.stills !== undefined ? { stills: plan.stills } : {}),
    expires: body?.expires,
    ...(review !== undefined ? { review } : {}),
  } };
}

export async function loadShare(id: string, key: string, fetchFn: typeof fetch = fetch): Promise<LoadedShare> {
  const update = await readShareUpdate(id, key, undefined, fetchFn);
  return update.kind === "loaded" ? update.state : { status: "error", message: update.kind === "retry" ? update.message : "The shared content could not be loaded. Try again in a moment." };
}

export type SubmitResult = { ok: true } | { ok: false; reason: "gone" | "rate_limited" | "too_large" | "network" };

/** A place in the shared change a comment is about, as the App anchors it. */
export type ChangeAnchor = { kind: "doneMeans" | "picture" | "check"; id: string; quote?: string };

/**
 * What a guest wrote and has not sent yet. Each becomes an annotation the App already reads:
 * an answer or a passage comment on the step's document, a thread or a reply on the change.
 */
export type Remark =
  | { kind: "passage"; id?: string; doc: string; quote: string; text: string; for?: "agent" | "person"; before?: string; after?: string; section?: string }
  | { kind: "item"; id: string; step: FlowStep; doc: string; what: string; answer: GuestAnswer; label: string; note: string }
  | { kind: "thread"; thread: string; anchor: ChangeAnchor; text: string }
  | { kind: "reply"; thread: string; text: string };

/** A check line's anchor id, as the App forms it: "scenario 1" → "scenario:1". */
export const checkId = (label: string) => label.replace(" ", ":");

/** A new thread id, in the form the App gives guest threads. */
export const newThreadId = () => `g-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/**
 * The document an answer is recorded against: the step's own, as the App names it.
 */
export function docOfStep(step: FlowStep): string {
  return STEP_DOCS[step][0] ?? "";
}

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
  if (r.kind === "item") {
    const note = r.note.trim();
    return annotation(r.doc, r.what.slice(0, 300), note === "" ? r.label : `${r.label}: ${note}`, now);
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

/**
 * Everything a guest wrote, as one batch in the annotation format. A link reviewer sends comments
 * only: there is no verdict to send.
 */
export function remarksPayload(author: string, remarks: Remark[], now = Date.now()): FeedbackPayload {
  return { author: author.trim() || "Guest", createdAt: now, annotations: remarks.map((r) => toAnnotation(r, now)) };
}

/** What the owner's machine keeps of a comment: it drops a longer one, and the server cannot say so any more (it holds ciphertext). */
const MAX_AUTHOR = 80;
const MAX_TEXT = 4_000;
const fits = (p: FeedbackPayload) =>
  p.author.length <= MAX_AUTHOR && p.annotations.every((a) => a.text.length <= MAX_TEXT && a.originalText.length <= MAX_TEXT);

/** Send what a guest wrote to the link's owner, sealed with the link's key, in one request. */
export async function submitRemarks(
  id: string,
  key: string,
  author: string,
  remarks: Remark[],
  fetchFn: typeof fetch = fetch,
): Promise<SubmitResult> {
  if (remarks.length === 0) return { ok: true };
  const payload = remarksPayload(author, remarks);
  return submitFeedback(id, key, payload, fetchFn);
}

export type ArtifactRemark = { id: string; page: string | null; revision: string; text: string; for: "agent" | "person" };

export function artifactRemarkPayload(author: string, remark: ArtifactRemark, payload: PublicArtifactPayload, now = Date.now()): FeedbackPayload | null {
  const page = remark.page === null ? null : payload.pages.find((page) => page.id === remark.page);
  if (remark.revision !== payload.revision || (remark.page !== null && !page)) return null;
  return { author: author.trim() || "Guest", createdAt: now, annotations: [{
    id: remark.id, blockId: remark.for === "person" ? "review" : page?.doc ?? "artifact",
    originalText: JSON.stringify({ artifact: 1, page: page?.id ?? null, revision: remark.revision, quote: "" }),
    text: remark.text, createdAt: now, for: remark.for,
  }] };
}

export async function submitArtifactRemark(id: string, key: string, author: string, remark: ArtifactRemark, artifact: PublicArtifactPayload, fetchFn: typeof fetch = fetch): Promise<SubmitResult> {
  const payload = artifactRemarkPayload(author, remark, artifact);
  return payload ? submitFeedback(id, key, payload, fetchFn) : { ok: false, reason: "network" };
}

async function submitFeedback(id: string, key: string, payload: FeedbackPayload, fetchFn: typeof fetch): Promise<SubmitResult> {
  if (!fits(payload)) return { ok: false, reason: "too_large" };
  let res: Response;
  try {
    res = await fetchFn("/api/share/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, payload: await sealForLink(key, "feedback", JSON.stringify(payload)) }),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 404) return { ok: false, reason: "gone" };
  if (res.status === 413) return { ok: false, reason: "too_large" };
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  return { ok: false, reason: "network" };
}

/** Where a comment on the change is, in words, the way the App labels it. */
export function where(anchor: ChangeAnchor): string {
  if (anchor.kind === "doneMeans") return `Done means ${anchor.id}`;
  if (anchor.kind === "picture") return "A picture";
  return `Check ${anchor.id.replace(":", " ")}`;
}
