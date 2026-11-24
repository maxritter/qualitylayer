// HTML the reader's sanitiser made from a step document's Markdown. A table scrolls sideways inside
// its own region, as in the Reader, so a wide one never runs past the column.

const isStandaloneLead = (inner: string, space: string, nextChar: string): boolean => {
  const trimmed = inner.trim()
  if (trimmed === "") return false
  if (space === "" && nextChar !== "" && /^[,;)\-–—]/.test(nextChar)) return false
  return /[.!?:]$/.test(trimmed) || nextChar === "" || !/^[a-z]/.test(nextChar)
}

const labelOpeningLeads = (html: string): string =>
  html.replace(
    /(<li>\s*(?:<p>\s*)?)<strong>([^<]*(?:<(?!\/strong>)[^<]*)*)<\/strong>(\s*)([^\s<]?)/g,
    (full, pre: string, inner: string, space: string, nextChar: string) =>
      isStandaloneLead(inner, space, nextChar)
        ? `${pre}<strong class="sp-item-lead">${inner}</strong>${space}${nextChar}`
        : full,
  )

export function SafeHtml({ html }: { html: string }) {
  if (/^\s*<table[\s>]/.test(html))
    return (
      <section
        className="sp-html table-scroll"
        aria-label="Table"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide table scrolls with the keyboard, as in the Reader
        tabIndex={0}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  // Mark an author's opening bold headline only when it is a standalone lead, never a bold clause
  // followed by a comma/punctuation or lowercase continuation (e.g. "<strong>...</strong>, and...").
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks
  return <div className="sp-html" dangerouslySetInnerHTML={{ __html: labelOpeningLeads(html) }} />
}
