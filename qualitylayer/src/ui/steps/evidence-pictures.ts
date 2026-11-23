// Pictures from a task's evidence folder, as the picture viewer needs them: one `src` per file, read
// through the App's evidence call. The first files load first, a few at a time, so a task with many
// pictures shows its strip at once and fills the index as the rest arrive. A picture that could not
// be read keeps an empty frame and stays out of the retry loop until the files change.

import { useEffect, useMemo, useState } from "react"
import type { Evidence } from "../api.ts"

export type LoadEvidence = (name: string) => Promise<Evidence>

/** A transparent pixel: the frame stands where a picture has not arrived. */
export const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

const AT_ONCE = 3
const EMPTY: ReadonlyMap<string, string> = new Map()

/** The evidence name a recorded file is read by: `evidence/screen-ab.png` → `screen-ab.png`. */
export const evidenceName = (file: string): string => file.replace(/^evidence\//, "")

async function readEvidenceImage(load: LoadEvidence, file: string): Promise<string | null> {
  try {
    const found = await load(evidenceName(file))
    return found.kind === "image" ? `data:${found.type};base64,${found.base64}` : null
  } catch {
    // An unreadable picture keeps its empty frame.
    return null
  }
}

async function drainEvidenceQueue(
  list: readonly string[],
  load: LoadEvidence,
  state: { active: boolean; next: number },
  onLoaded: (file: string, src: string) => void,
): Promise<void> {
  while (state.active && state.next < list.length) {
    const file = list[state.next++]
    if (file === undefined) break
    const src = await readEvidenceImage(load, file)
    if (state.active && src !== null) onLoaded(file, src)
  }
}

/**
 * The source of each file, in the order given. `files` is read by value: the same list of names
 * loads once per loader, however often the page draws. A task or content-version change supplies
 * another loader; its pictures start empty and late reads from the old one cannot populate them.
 */
export function useEvidenceSources(
  files: readonly string[],
  load: LoadEvidence | undefined,
): ReadonlyMap<string, string> {
  const key = files.join("\n")
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined names stand for the list
  const list = useMemo(() => [...new Set(files)], [key])
  const [loaded, setLoaded] = useState({ load, list, sources: EMPTY })
  useEffect(() => {
    if (load === undefined) return
    const state = { active: true, next: 0 }
    setLoaded({ load, list, sources: EMPTY })
    const onLoaded = (file: string, src: string) => {
      setLoaded((before) =>
        before.load === load && before.list === list
          ? { load, list, sources: new Map(before.sources).set(file, src) }
          : before,
      )
    }
    for (let i = 0; i < AT_ONCE; i++) void drainEvidenceQueue(list, load, state, onLoaded)
    return () => {
      state.active = false
    }
  }, [list, load])
  return loaded.load === load && loaded.list === list ? loaded.sources : EMPTY
}
