import { dirname, join, sep } from "node:path"
import { scanPublicationRoot } from "./watch-publications-scan.ts"
import {
  admitScanBatch,
  advanceRootGroup,
  NativeReceiptCache,
  topLevelRoots,
} from "./watch-publications-state.ts"
import {
  fileStamp,
  isPermittedPath,
  PUBLICATION_SCANS_MAX,
  PUBLICATION_STAMP_BYTES_MAX,
  PUBLICATION_STAMPS_MAX,
  PUBLICATION_WORK_LIMIT,
  type PublicationRoot,
} from "./watch-publications-types.ts"

export {
  atomicStaging,
  PUBLICATION_CHECK_MS,
  PUBLICATION_QUIET_MS,
  PUBLICATION_QUIET_STRIDE,
  PUBLICATION_WORK_LIMIT,
  recoveryStride,
} from "./watch-publications-types.ts"

/** Exact identities while bounded; oversized roots keep a streaming metadata digest instead. */
export class PublicationRecovery {
  private roots = new Map<string, PublicationRoot>()
  private stopped = false
  private kept = 0
  private keptBytes = 0
  private nextRoot = 0
  private readonly nativeReceipts = new NativeReceiptCache()
  private readonly startedAt = BigInt(
    Math.trunc((performance.timeOrigin + performance.now()) * 1_000_000),
  )

  constructor(
    private runs: string,
    private publish: (path: string, aggregate?: boolean) => void,
  ) {}

  get retainedStamps(): number {
    return this.kept
  }
  get retainedBytes(): number {
    return this.keptBytes
  }
  get overflowRoots(): string[] {
    return [...this.roots.values()].filter((root) => root.overflow).map((root) => root.path)
  }

  setRoots(roots: string[]): void {
    if (this.stopped) return
    const wanted = topLevelRoots(roots)
    for (const [path, root] of this.roots) {
      if (wanted.has(path)) continue
      root.work?.return(undefined)
      this.kept -= root.files.size
      this.keptBytes -= root.bytes
      this.roots.delete(path)
    }
    for (const path of wanted) {
      if (!this.roots.has(path))
        this.roots.set(path, { path, files: new Map(), bytes: 0, overflow: false, seeded: false })
    }
  }

  private duringSeed(stamp: string): boolean {
    return BigInt(stamp.slice(stamp.lastIndexOf(":") + 1)) >= this.startedAt
  }

  notice(path: string): void {
    if (this.stopped || !isPermittedPath(this.runs, path)) return
    const root = [...this.roots.values()].find((item) => path.startsWith(`${item.path}${sep}`))
    if (!root) return
    const stamp = fileStamp(path)
    if (!root.overflow) this.record(root, path, stamp, true)
    if (root.overflow && this.nativeReceipts.recordAndShouldPublish(path, stamp)) {
      this.publish(path)
    }
  }

  private overflowRoot(root: PublicationRoot): void {
    this.kept -= root.files.size
    this.keptBytes -= root.bytes
    root.files.clear()
    root.bytes = 0
    root.overflow = true
  }

  private shouldNotifyChange(
    previous: string | undefined,
    current: string | null,
    notify: boolean,
  ): boolean {
    if (previous === current || (previous === undefined && current === null)) return false
    return notify || (current !== null && this.duringSeed(current))
  }

  private record(
    root: PublicationRoot,
    path: string,
    current: string | null,
    notify: boolean,
  ): void {
    const previous = root.files.get(path)
    const before =
      previous === undefined ? 0 : Buffer.byteLength(path) + Buffer.byteLength(previous)
    const after = current === null ? 0 : Buffer.byteLength(path) + Buffer.byteLength(current)
    if (current === null) {
      if (root.files.delete(path)) this.kept--
    } else {
      const overCap =
        (previous === undefined && this.kept >= PUBLICATION_STAMPS_MAX) ||
        this.keptBytes + after - before > PUBLICATION_STAMP_BYTES_MAX
      if (overCap) {
        this.overflowRoot(root)
        return
      }
      if (previous === undefined) this.kept++
      root.files.set(path, current)
    }
    this.keptBytes += after - before
    root.bytes += after - before
    if (this.shouldNotifyChange(previous, current, notify)) this.publish(path)
  }

  private isRuntimeRoot(root: PublicationRoot): boolean {
    return root.path === this.runs || root.path === join(dirname(this.runs), "projects")
  }

  private admitRoots(roots: PublicationRoot[], active: PublicationRoot[], notify: boolean): void {
    const hooks = {
      isStopped: () => this.stopped,
      permitted: (path: string, dir?: boolean) => isPermittedPath(this.runs, path, dir),
      duringSeed: (stamp: string) => this.duringSeed(stamp),
      record: (r: PublicationRoot, path: string, cur: string | null, n: boolean) =>
        this.record(r, path, cur, n),
      publish: (path: string, aggregate?: boolean) => this.publish(path, aggregate),
    }
    this.nextRoot = admitScanBatch(roots, active, this.nextRoot, {
      maxScans: PUBLICATION_SCANS_MAX,
      isRuntime: (root) => this.isRuntimeRoot(root),
      startScan: (root) => scanPublicationRoot(root, notify, hooks),
    })
  }

  /** All roots share one work budget; runtime roots are admitted before source roots. */
  tick(notify = true): boolean {
    if (this.stopped) return true
    const roots = [...this.roots.values()]
    const active = roots.filter((root) => root.work)
    this.admitRoots(roots, active, notify)
    const priority = active.filter((root) => this.isRuntimeRoot(root))
    const sources = active.filter((root) => !this.isRuntimeRoot(root))
    // Runtime publications keep half the beat; either side lends its unused work to the other.
    let used = advanceRootGroup(priority, PUBLICATION_WORK_LIMIT / 2)
    used += advanceRootGroup(sources, PUBLICATION_WORK_LIMIT - used)
    advanceRootGroup(priority, PUBLICATION_WORK_LIMIT - used)
    return notify
      ? active.every((root) => !root.work) && roots.every((root) => root.seeded)
      : roots.every((root) => root.seeded)
  }

  async seed(): Promise<void> {
    while (!this.tick(false)) await new Promise<void>((resolve) => setImmediate(resolve))
  }

  stop(): void {
    this.stopped = true
    for (const root of this.roots.values()) root.work?.return(undefined)
    this.roots.clear()
    this.nativeReceipts.clear()
    this.kept = 0
    this.keptBytes = 0
  }
}
