/** Replace complete inline links in order; a null replacement leaves the original source. */
export function replaceInlineLinks(
  text: string,
  replace: (label: string, target: string) => string | null,
): string {
  const parts: string[] = []
  let copied = 0
  let from = 0
  while (from < text.length) {
    const open = text.indexOf("[", from)
    if (open === -1) break
    const close = text.indexOf("]", open + 1)
    if (close === -1) break
    from = close + 1
    if (close === open + 1 || text.charAt(from) !== "(") continue
    const end = text.indexOf(")", from + 1)
    if (end === -1) break
    const replacement = replace(text.slice(open + 1, close), text.slice(from + 1, end))
    from = end + 1
    if (replacement === null) continue
    parts.push(text.slice(copied, open), replacement)
    copied = from
  }
  return parts.join("") + text.slice(copied)
}

/** The lesson format needs a target and keeps labels and targets on one LF-delimited line. */
export function replaceInlineLinksOnLines(
  text: string,
  replace: (label: string, target: string) => string,
): string {
  return text
    .split("\n")
    .map((line) =>
      replaceInlineLinks(line, (label, target) => (target === "" ? null : replace(label, target))),
    )
    .join("\n")
}
