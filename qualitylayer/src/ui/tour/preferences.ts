const PREFIX = "qualitylayer-"
const RECOVERY = "ql-tour-preferences-v1"
const MAX_SNAPSHOT_CHARS = 1_048_576

export type TourPreferences = {
  restore: () => boolean
  dispose: () => void
}

function isPreferencePair(pair: unknown): pair is [string, string] {
  if (!Array.isArray(pair) || pair.length !== 2) return false
  return typeof pair[0] === "string" && pair[0].startsWith(PREFIX) && typeof pair[1] === "string"
}

function parseSavedSnapshot(saved: string): Map<string, string> | null {
  if (saved.length > MAX_SNAPSHOT_CHARS) return null
  const values: unknown = JSON.parse(saved)
  if (!Array.isArray(values) || values.length > 1000) return null
  return values.every(isPreferencePair) ? new Map(values) : null
}

function readLocalPreferences(): Map<string, string> {
  return new Map(
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => [key, localStorage.getItem(key) ?? ""]),
  )
}

function saveSnapshot(kept: Map<string, string>): void {
  const text = JSON.stringify([...kept])
  if (kept.size > 1000 || text.length > MAX_SNAPSHOT_CHARS)
    throw new Error("Tour preference snapshot is too large")
  sessionStorage.setItem(RECOVERY, text)
}

function restorePreferences(kept: Map<string, string>, finished: boolean): boolean {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(PREFIX) && !kept.has(key)) localStorage.removeItem(key)
    for (const [key, value] of kept) localStorage.setItem(key, value)
    if (finished) sessionStorage.removeItem(RECOVERY)
    return true
  } catch {
    return false
  }
}

function updateKeptFromStorage(kept: Map<string, string>, event: StorageEvent): boolean {
  if (event.storageArea !== localStorage) return false
  if (event.key === null) {
    kept.clear()
    return true
  }
  if (!event.key.startsWith(PREFIX)) return false
  if (event.newValue === null) kept.delete(event.key)
  else kept.set(event.key, event.newValue)
  return true
}

export function beginTourPreferences(): TourPreferences | null {
  let kept = new Map<string, string>()
  let clearing = false
  try {
    const saved = sessionStorage.getItem(RECOVERY)
    const loaded = saved !== null ? parseSavedSnapshot(saved) : readLocalPreferences()
    if (loaded === null) return null
    kept = loaded
    saveSnapshot(kept)
    clearing = true
    for (const key of Object.keys(localStorage))
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {
    if (clearing) restorePreferences(kept, false)
    return null
  }

  const onHide = () => restorePreferences(kept, false)
  const onStorage = (event: StorageEvent) => {
    if (!updateKeptFromStorage(kept, event)) return
    try {
      saveSnapshot(kept)
    } catch {
      restorePreferences(kept, false)
    }
  }
  window.addEventListener("pagehide", onHide)
  window.addEventListener("storage", onStorage)
  return {
    restore: () => restorePreferences(kept, true),
    dispose: () => {
      window.removeEventListener("pagehide", onHide)
      window.removeEventListener("storage", onStorage)
    },
  }
}
