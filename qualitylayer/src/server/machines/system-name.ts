function withoutLts(text: string): string {
  const suffix = /LTS$/.exec(text)
  if (suffix === null) return text
  let start = suffix.index
  while (start > 0 && /\s/.test(text.charAt(start - 1))) start--
  return start === suffix.index ? text : text.slice(0, start) + text.slice(suffix.index + 3)
}

function withoutPatch(text: string): string {
  let at = 0
  while (at < text.length) {
    if (!/[0-9]/.test(text.charAt(at))) {
      at++
      continue
    }
    const start = at
    while (/[0-9]/.test(text.charAt(at))) at++
    if (text.charAt(at) !== "." || !/[0-9]/.test(text.charAt(at + 1))) continue
    at++
    while (/[0-9]/.test(text.charAt(at))) at++
    const minorEnd = at
    if (text.charAt(at) !== "." || !/[0-9]/.test(text.charAt(at + 1))) continue
    at++
    while (/[0-9]/.test(text.charAt(at))) at++
    return text.slice(0, start) + text.slice(start, minorEnd) + text.slice(at)
  }
  return text
}

export function linuxSystemName(text: string): string {
  return withoutPatch(withoutLts(text)).slice(0, 40)
}
