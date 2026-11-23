/** Pure transport types shared by the App and the logged-out page. */
/** A document note is carried as a review event so older queues leave it alone. */
function isPersonNoteHead(
  head: unknown,
): head is { doc: string; quote: string; [key: string]: unknown } {
  if (typeof head !== "object" || head === null) return false
  const record = head as Record<string, unknown>
  if (record.t !== "thread" || record.note !== true || record.for !== "person") return false
  return typeof record.doc === "string" && typeof record.quote === "string"
}

export function personNote(c: {
  doc: string
  quote: string
  for?: "person" | "agent"
}): { doc: string; quote: string; before?: string; after?: string; section?: string } | null {
  if (c.doc !== "review") return c.for === "person" ? c : null
  try {
    const head = JSON.parse(c.quote) as unknown
    if (!isPersonNoteHead(head)) return null
    return {
      doc: head.doc,
      quote: head.quote,
      ...Object.fromEntries(
        ["before", "after", "section"].flatMap((key) =>
          typeof head[key] === "string" ? [[key, head[key]]] : [],
        ),
      ),
    }
  } catch {
    return null
  }
}

export type ThreadReply = {
  id: string
  author: { name: string; email: string }
  text: string
  at: number
  via: "app" | "agent" | "slack"
  agent?: string
  /** A fresh helper gave this answer: its model's name, "" when unknown. The agent did not. */
  helper?: string
}
