import { PeerError } from "../base.ts"
import { reconcileLockPath } from "../codex.ts"

export async function underReconcileLock<T>(action: () => Promise<T>): Promise<T> {
  const path = reconcileLockPath()
  const deadline = Date.now() + 60_000
  const { tryLock, releaseLock } = await import("../lock.ts")
  while (!tryLock(path)) {
    if (Date.now() > deadline) throw new PeerError(`another peers command holds ${path}; try again`)
    await Bun.sleep(50)
  }
  try {
    return await action()
  } finally {
    releaseLock(path)
  }
}
