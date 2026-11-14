import type { MemoryRecord } from "../../memory-contracts.ts"
import { skipWhitespace } from "../text-boundaries.ts"
export function safeText(text: string): void {
  if (Buffer.from(text, "utf8").toString("utf8") !== text || text.includes(String.fromCharCode(0)))
    throw new Error("Memory must contain valid text")
  if (
    /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,})/i.test(
      text,
    ) ||
    credentialUrl(text)
  )
    throw new Error("Memory contains a possible credential; remove it before saving")
}

function credentialUrl(text: string): boolean {
  for (const match of text.matchAll(/\bhttps?:\/\/([^\s/@]+)@/gi))
    if (match[1]?.slice(1, -1).includes(":")) return true
  return false
}

export function publicationText(record: MemoryRecord): void {
  const text = `${JSON.stringify(record)}\n${[record.title, record.content, ...record.tags, ...record.files, ...(record.evidence?.checks ?? []), record.author ?? "", record.sourceId ?? ""].join("\n")}`
  safeText(text)
  if (
    record.kind === "preference" ||
    /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\|~\/|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b)/i.test(text)
  )
    throw new Error("Personal preferences, contact details and home paths cannot be shared")
  if (
    /\b(?:user prompt|system prompt|transcript|terminal stream)\b/i.test(text) ||
    hasRoleLine(text)
  )
    throw new Error("Prompts, transcripts and terminal streams cannot be shared")
}

function hasRoleLine(text: string): boolean {
  let at = 0
  while (at < text.length) {
    at = skipWhitespace(text, at)
    if (/^(?:USER|ASSISTANT|SYSTEM):/i.test(text.slice(at, at + 10))) return true
    // The next line start, including bare CR and Unicode line separators, may name a role.
    while (at < text.length && !/[\r\n\u2028\u2029]/.test(text.charAt(at))) at++
    if (at < text.length) at++
  }
  return false
}
