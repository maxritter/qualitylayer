// Settings › Appearance › Font, put on the root as data-font ("system" or "atkinson"; Geist has none),
// which globals.css turns into --ql-font-text and so --font-sans. Text-size writes stay ordered here;
// the installed window applies its own zoom from config.json, and a browser keeps its own zoom.

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import {
  stepTextSize,
  TEXT_SIZES,
  type TextSize,
  textSizeOf,
  type UiFont,
  uiFontOf,
} from "../core/config-values.ts"
import { PREF, store, stored } from "./prefs.ts"

/** Put the font on the root; with no choice given, the one kept in this browser. */
export function applyUiFont(choice?: unknown): UiFont {
  const font = uiFontOf(choice ?? stored(PREF.font, "geist"))
  const root = document.documentElement
  if (font === "geist") delete root.dataset.font
  else root.dataset.font = font
  return font
}

/** Follows the config's font, and keeps it in this browser for the next first paint. */
export function useUiFont(choice: unknown): UiFont {
  const font = uiFontOf(choice)
  useLayoutEffect(() => {
    applyUiFont(font)
    store(PREF.font, font)
  }, [font])
  return font
}

function isSingleTextSizePatch(patch: unknown): patch is { textSize: TextSize } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return false
  if (Object.keys(patch).length !== 1 || !("textSize" in patch)) return false
  return TEXT_SIZES.includes(patch.textSize as TextSize)
}

/** Relative shortcuts and absolute Settings choices share one ordered text-size writer. */
export function useTextSize(
  value: unknown,
  ready: boolean,
  persist: (patch: unknown) => Promise<string | null>,
) {
  const saved = useRef(textSizeOf(value))
  const writer = useRef(persist)
  writer.current = persist
  const pending = useRef(0)
  const tail = useRef(Promise.resolve())
  const [, settled] = useState(0)
  useLayoutEffect(() => {
    // A delayed reload must not overwrite a newer acknowledged write or a queued choice.
    if (ready && pending.current === 0) saved.current = textSizeOf(value)
  })
  const enqueue = useCallback((next: (current: TextSize) => TextSize) => {
    pending.current++
    const result = tail.current
      .then(async () => {
        const size = next(saved.current)
        const error = await writer.current({ textSize: size })
        if (error === null) saved.current = size
        return error
      })
      .finally(() => {
        pending.current--
        if (pending.current === 0) settled((before) => before + 1)
      })
    tail.current = result.then(
      () => {},
      () => {},
    )
    return result
  }, [])
  const step = useCallback(
    (by: 1 | -1 | 0) => enqueue((current) => (by === 0 ? 100 : stepTextSize(current, by))),
    [enqueue],
  )
  const save = useCallback(
    (patch: unknown): Promise<string | null> => {
      if (isSingleTextSizePatch(patch)) {
        const size = patch.textSize
        return enqueue(() => size)
      }
      return writer.current(patch)
    },
    [enqueue],
  )
  return {
    step,
    save,
  }
}
