# Approved compact export card

Max approved the Opus 5.5 high-effort design on16November2026: “looks good, go ahead and implement that”. Approved source: docs/artifacts/artifact-workflow-export/artifact-header.html in the primary checkout.

Export opens a compact anchored card, about320px wide, with three icon-labelled format choices, filename, one export action, and a small result. No destination, appearance, include form or universal format grid. Preserve existing Copy controls.

Artifacts: PDF / Images (PNG) / Web page (HTML). This page / All pages scope. Plan and Review: PDF / Markdown with pictures / Web page. Use light export appearance independently of viewer theme.

Plan and Review export only the human-facing step document; preserve recorded revision/approval and evidence mode. Export never approves, changes workflow state or publishes externally. No authored active scripts in a readable exported HTML file. Interactive artifacts become stills, labelled by page.

An embedded design reference keeps its authored width and exact named section, including content populated by its scripts in the bounded no-network renderer. Two references to different sections of one file remain distinct pictures; exporting a focused reference must not include the rest of that file. Formatted copy uses that same capture, includes local PNG/JPEG/WebP/GIF evidence, and puts rendered pictures at their authored positions. Markdown packages preserve source order and captions with relative picture links.

PDF keeps a complete overview of each figure at its source position. When fitting it to the document would make it smaller than 75% of its authored CSS size, readable overlapping continuation panels follow the overview in row-major order. Each panel identifies its figure and position and stays intact. Short panels share a page in normal document flow; tall panels move to the next page when needed. Normal figures remain in the document flow. Short table identifiers and headings stay whole; long paths and URLs wrap within the page. The complete human-facing document is included regardless of visible folds.

Actual file generation must succeed before success is shown. Browser downloads can confirm only initiation: use “Download started” rather than claiming a saved local path. Show/reveal is offered only with a real local capability and confirmed saved file. File generation failures retain choices and offer retry.

The desktop App accepts downloads only from its trusted local App origins. Each export opens the operating system's Save dialog on the viewing computer, with its suggested filename; the person chooses the folder and name and confirms any replacement there. Cancelling writes no export and leaves the card ready to retry. Bytes are staged in an owned private sibling directory and published atomically to that exact selected destination. The selected path stays native and is never sent to the project server. The card reports Saved only after native completion, Cancelled after cancellation, and an actionable failure after a failed save. It never silently falls back to Downloads. Browser exports retain their ordinary browser download and honest Download started result. JavaScript IPC permissions remain unchanged.

Opening, closing, outside click, Escape, arrow keys, focus return, disabled/busy, success and error are covered. Keep the button reachable in compact headers (overflow action if necessary). No uploads, external connectors, OAuth or direct Jira/Confluence/Git publishing.

Implementation: native Base UI Popover, existing Button and Lucide icons. PDF/PNG generation uses the existing bounded no-network Chrome renderer. Export generation is on-demand and reaps temporary processes/files; no new watchers or polls.
