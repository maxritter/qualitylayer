// Where the focus starts when a dialog or popover opens: its first field or first actionable row,
// never its close control or a link, which only lead out of it (DESIGN.md › Dialogs and popovers).

/** Everything a Tab can land on: a native control, a link, a summary, editable text, a frame, media with controls, or a `tabindex`. */
export const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), iframe, audio[controls], video[controls], [tabindex]'

/** Controls that close or leave the surface, or only explain it (an info mark): a fine Tab stop, never the first one. */
const LEAVES =
  '[data-slot="dialog-close"], [data-close], a[href], [aria-label^="Close"], .q-info-hint'

export function enabledTabStop(el: HTMLElement): boolean {
  return el.tabIndex >= 0 && !el.matches(":disabled")
}

/**
 * Focus the first control that does not leave the surface. A field that took the focus when it
 * mounted (autoFocus) keeps it, its text selected. With nothing else to focus yet (content still
 * loading), the surface itself takes the focus so a Tab reaches the first control. Returns what
 * Base UI's `initialFocus` expects: false once the focus is placed, true for its own default
 * (a touch open keeps the keyboard closed).
 */
export function focusFirstControl(popup: HTMLElement | null, openType: string): boolean {
  if (openType === "touch") return true
  const active = document.activeElement
  if (popup && active !== popup && popup.contains(active)) {
    if (active instanceof HTMLInputElement) active.select()
    return false
  }
  const stops = [...(popup?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])].filter(enabledTabStop)
  const first = stops.find((el) => !el.matches(LEAVES))
  if (first) {
    first.focus({ preventScroll: true })
    if (first instanceof HTMLInputElement) first.select()
    return false
  }
  if (!popup) return true
  if (!popup.hasAttribute("tabindex")) popup.tabIndex = -1
  popup.focus({ preventScroll: true })
  return false
}
