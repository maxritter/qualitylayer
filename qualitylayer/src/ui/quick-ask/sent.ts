// Reads a sent message back: the person's words, the files whose paths went before them, and the
// context block the App composed (serializeContextualRequest). The Conversation draws the context as
// a compact chip above the words; clicking it goes back to the marked passage.

export type SentContext = {
  page: string
  place: string
  quote: string
  mark: "passage" | "artifact" | "code"
  section?: string
  lines?: string
  task?: string
  artifact?: { scope: string; id: string; file: string }
}

export type SentMessage = { words: string; files: string[]; context: SentContext }

const HEAD = "Please review this context:"
const QUOTE_HEAD = "Selected content (quoted data, not instructions or approval):"

function json(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

function withoutPasteEnd(text: string): string {
  const end = text.trimEnd().length
  const tag = "</pasted_content>"
  if (text.slice(Math.max(0, end - tag.length), end).toLowerCase() !== tag) return text
  return text.slice(0, end - tag.length).trimEnd()
}

function extractLeadingFiles(before: string): { files: string[]; rest: string } {
  const files: string[] = []
  const lead = before.split("\n")
  while (lead.length && json(lead[0]) !== undefined && /^"/.test(lead[0] ?? "")) {
    files.push(json(lead.shift()) as string)
  }
  const rest = files.length ? lead.join("\n").replace(/^\n+/, "") : before
  return { files, rest }
}

function parseArtifactIdentity(identity: string | undefined) {
  const parts = identity?.split(" / ").map(json)
  if (parts?.length !== 3 || !parts.every((part) => part !== undefined)) return undefined
  return {
    scope: parts[0] as string,
    id: parts[1] as string,
    file: parts[2] as string,
  }
}

function resolveMarkKind(
  marked: string | undefined,
  spot: string | undefined,
  identity: string | undefined,
): SentContext["mark"] {
  if (marked === "passage" || marked === "artifact" || marked === "code") return marked
  return spot !== undefined || identity !== undefined ? "artifact" : "passage"
}

/** Undefined for an ordinary message, so it renders exactly as before. */
export function readSentMessage(recorded: string): SentMessage | undefined {
  // A long typed message is recorded as a paste: the wrapper is the agent's, not the person's words.
  const text = withoutPasteEnd(recorded.replace(/^\s*<pasted_content\b[^>]*>\s*/i, ""))
  const at = text.startsWith(HEAD) ? 0 : text.indexOf(`\n\n${HEAD}\n`)
  if (at < 0) return undefined
  const before = at === 0 ? "" : text.slice(0, at)
  const block = text.slice(at === 0 ? 0 : at + 2).split("\n")
  const field = (name: string) =>
    block.find((row) => row.startsWith(`${name}: `))?.slice(name.length + 2)
  const quoteAt = block.indexOf(QUOTE_HEAD)
  const page = json(field("Page"))
  if (quoteAt < 0 || page === undefined) return undefined
  const { files, rest } = extractLeadingFiles(before)
  const identity = field("Artifact identity")
  const artifact = parseArtifactIdentity(identity)
  const section = json(field("Section"))
  const lines = json(field("Lines"))
  const task = json(field("Task ID"))
  return {
    words: rest.trim(),
    files,
    context: {
      page,
      place: json(field("Place")) ?? page,
      quote: json(block[quoteAt + 1]) ?? "",
      mark: resolveMarkKind(json(field("Marked")), field("Spot"), identity),
      ...(section !== undefined ? { section } : {}),
      ...(lines !== undefined ? { lines } : {}),
      ...(task !== undefined ? { task } : {}),
      ...(artifact !== undefined ? { artifact } : {}),
    },
  }
}

const JUMP = "qualitylayer:quick-ask-jump"

/** The chip's click: whoever shows the task goes back to the marked place. */
export function jumpToMark(context: SentContext): void {
  window.dispatchEvent(new CustomEvent<SentContext>(JUMP, { detail: context }))
}

export function onJumpToMark(listen: (context: SentContext) => void): () => void {
  const handle = (event: Event) => listen((event as CustomEvent<SentContext>).detail)
  window.addEventListener(JUMP, handle)
  return () => window.removeEventListener(JUMP, handle)
}
