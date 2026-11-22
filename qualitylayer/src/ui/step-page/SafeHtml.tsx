// HTML the reader's sanitiser made from a step document's Markdown. A table scrolls sideways inside
// its own region, as in the Reader, so a wide one never runs past the column.

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
  // Mark an author's opening bold phrase without splitting emphasis later in the sentence.
  const labelled = html.replace(/(<li>\s*(?:<p>\s*)?)<strong>/g, '$1<strong class="sp-item-lead">')
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks
  return <div className="sp-html" dangerouslySetInnerHTML={{ __html: labelled }} />
}
