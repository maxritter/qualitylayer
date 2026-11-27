# Approved deliberate feedback on artifacts

Max approved the Opus 5.5 high-effort design on 16 November 2026: “Alright, looks good. Please implement it like that”. Approved source: `artifact-feedback.html` (copied unchanged from `docs/artifacts/artifact-interaction-feedback/artifact-canvas.html` in the primary checkout).

Clicking, dragging and selecting text on an artifact always use the artifact. Nothing the page shows decides whether a plain click is feedback.

- **Feedback** toolbar button (message-square-plus icon, `aria-pressed`) sits before Export. It is labelled on wide headers, icon-only with its accessible name in compact headers, and never hidden.
- **Armed, one shot:** the page is held, so no click, key, drag or context menu reaches it. The page shows a crosshair and an accent ring, and a hint pill reads "Click a spot or drag an area" with an Esc chip. One click marks a spot and an 8 px or longer drag marks an area. The quick field opens at the mark and the mode ends.
- **Keyboard:** while armed, focus moves into the page; Tab moves between its controls; Enter or Space marks the focused element instead of pressing it.
- **Words:** selecting text keeps normal selection and copy. A small Feedback chip appears by the selection; choosing it marks the passage.
- **Cancel:** Esc, the pill's Esc chip or the button again leave the mode and return focus to Feedback. Esc or Cancel in the quick field drops the mark and returns focus.
- **Touch and narrow:** while armed, a tap is a spot and a drag is an area. The page only stops scrolling while armed.
- Option-click no longer marks.

Every mark goes into the existing quick field and feedback record; nothing else changes. Marking gives no approval and changes no workflow state.

Bridge messages from the artifact frame stay untrusted: source-window check, shape and bounds validation, sandboxed frame, no network.

## Approved multi-place element/area annotations on planned screens (#268, 26 November 2026)

Max approved `artifact-design-annotations.html` on 26 November 2026: “All right, please exactly do it like that. Implement everything, test everything, and then go ahead and release a new version.”

- **Direct from Plan previews:** `ArtifactPreview` adds an **Annotate** button beside **Open in card** when feedback is available on a live task Plan. Clicking **Annotate** opens `ArtifactPreviewDialog` directly in armed multi-place Annotate mode.
- **Multi-place batching:** Annotate stays armed across multiple clicks (snapping to element bounding boxes) and dragged rectangles (`>= 8 px`), rendering persistent numbered overlays (`1`, `2`, `3`…) inside the frame and accumulating notes in a side tray before sending all pinned notes together in one turn to the planner.
- **Element identity context:** `artifact-bridge.ts` captures sanitized element metadata (`id`, `data-testid`, `tag`, `role`, short visible text, concise CSS selector, bounding `rect`) for element clicks and every identified element overlapping a dragged rectangle (`targets[]`). `ArtifactAnchor` carries these as backward-compatible optional fields (`kind`, `rect`, `target`, `targets`).
- **Use screen preserved:** Switching to **Use screen** or pressing **Esc** restores normal artifact interaction unchanged.

## Approved Option A scroll-safe composer & inline annotation editing (#269, 27 November 2026)

Max approved Option A from the before/after artifact (`annotate-scroll-and-edit`) on 27 November 2026: “Yeah, I will go for option A, so please incorporate and fix everything.”

- **Independent scroll panes & pinned composer slot:** `FullscreenDialog` (`overflowHidden`) + `.dg-ann-split` (`height: 100%`) lock the split view to the dialog height so the screen preview scrolls independently while the right `Annotations` tray stays pinned full-height at any `scrollY`. `DraftMarkEditor` renders in a dedicated non-scrolling top slot (`.dg-ann-composer-slot`) right below the tray tabs, so clicking an element at any scroll depth or with many staged pins keeps the textbox immediately visible and focused. Clicking a staged pin scrolls the preview smoothly to that pin.
- **Inline edit on staged pins:** Each staged pin card in `ArtifactAnnotateTray` adds a Pencil **Edit** button beside Remove (`×`), and clicking the note text also switches the card into inline editing (`Enter` saves, `Shift+Enter` newline, `Esc` cancels) — updating both the card and **Planner context** while preserving the pin number, target `#id`, and bounding box.
