export type RolloutFrame = { size: number; head: Buffer; tail: Buffer }

/** Accumulate only the requested byte windows while a rollout streams past. */
export class RolloutWindow {
  private readonly head: Buffer[] = []
  private readonly tail: Buffer[] = []
  private size = 0
  private headSize = 0
  private tailSize = 0

  constructor(
    private readonly headBytes: number,
    private readonly tailBytes: number,
  ) {
    if (
      !Number.isSafeInteger(headBytes) ||
      headBytes < 0 ||
      !Number.isSafeInteger(tailBytes) ||
      tailBytes <= 0
    )
      throw new RangeError("Rollout windows need nonnegative head and positive tail byte counts")
  }

  append(piece: Buffer): void {
    this.size += piece.length
    const prefix = piece.subarray(0, Math.max(0, this.headBytes - this.headSize))
    if (prefix.length > 0) {
      this.head.push(prefix)
      this.headSize += prefix.length
    }
    this.tail.push(piece)
    this.tailSize += piece.length
    this.trimTail()
  }

  private trimTail(): void {
    while (this.tailSize > this.tailBytes) {
      const first = this.tail.shift()
      if (first === undefined) throw new Error("Rollout tail lost its retained bytes")
      const trim = Math.min(this.tailSize - this.tailBytes, first.length)
      if (trim < first.length) this.tail.unshift(first.subarray(trim))
      this.tailSize -= trim
    }
  }

  frame(): RolloutFrame {
    return {
      size: this.size,
      head: Buffer.concat(this.head, this.headSize),
      tail: Buffer.concat(this.tail, this.tailSize),
    }
  }
}
