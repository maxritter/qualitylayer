# Approved compact export card

Max approved the Opus 5.5 high-effort design on16November2026: “looks good, go ahead and implement that”. Approved source: docs/artifacts/artifact-workflow-export/artifact-header.html in the primary checkout.

Export opens a compact anchored card, about320px wide, with three icon-labelled format choices, filename, one export action, and a small result. No destination, appearance, include form or universal format grid. Preserve existing Copy controls.

Artifacts: PDF / Images (PNG) / Web page (HTML). This page / All pages scope. Plan and Review: PDF / Markdown with pictures / Web page. Use light export appearance independently of viewer theme.

Plan and Review export only the human-facing step document; preserve recorded revision/approval and evidence mode. Export never approves, changes workflow state or publishes externally. No authored active scripts in a readable exported HTML file. Interactive artifacts become stills, labelled by page.

An embedded design reference keeps its authored width and exact named section. Two references to different sections of one file remain distinct pictures; exporting a focused reference must not include the rest of that file.

Actual file generation must succeed before success is shown. Browser downloads can confirm only initiation: use “Download started” rather than claiming a saved local path. Show/reveal is offered only with a real local capability and confirmed saved file. File generation failures retain choices and offer retry.

The desktop App accepts downloads only from its trusted local App origins. Bytes are staged in an owned temporary directory under the viewing computer's Downloads and published without overwriting an existing file. A native save failure shows the existing App error toast: “The download could not be saved to Downloads. Check folder permissions and try again.” No path or private content is exposed in that event.

Opening, closing, outside click, Escape, arrow keys, focus return, disabled/busy, success and error are covered. Keep the button reachable in compact headers (overflow action if necessary). No uploads, external connectors, OAuth or direct Jira/Confluence/Git publishing.

Implementation: native Base UI Popover, existing Button and Lucide icons. PDF/PNG generation uses the existing bounded no-network Chrome renderer. Export generation is on-demand and reaps temporary processes/files; no new watchers or polls.
