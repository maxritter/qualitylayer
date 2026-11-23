// What a stretch of use adds up to (usage-count.ts counts calls into these): calls, sessions, tokens,
// the estimated cost with its split by kind of token and by speed, the tokens that had no price, and
// what the cache saved. A stretch is a period, a day, an agent or a model.

import { addAccounting, emptyAccounting, type UsageAccounting } from "./accounting.ts"
import { addTokens, cacheSaving, priceParts, type Tokens, zeroTokens } from "./prices.ts"

/** Dollars by kind of token. */
export type CostKinds = { cacheRead: number; cacheWrite: number; input: number; output: number }

export type Spend = {
  calls: number
  /** Transcripts (a session and its helpers count once) with calls in the stretch. */
  sessions: number
  tokens: Tokens
  /** The estimate in USD for the calls that have a price. */
  costUsd: number
  /** `costUsd` by kind of token; the four add up to it. */
  costKinds: CostKinds
  /** The part of `costUsd` billed on the fast (priority) tier. */
  fastUsd: number
  /** Tokens of calls on a model without a confirmed price: counted, never in `costUsd`. */
  unpricedTokens: number
  /** What reading from the cache saved against the input price for the same tokens. */
  cacheSavedUsd: number
  accounting?: UsageAccounting
}

const zeroKinds = (): CostKinds => ({ cacheRead: 0, cacheWrite: 0, input: 0, output: 0 })

export const zeroSpend = (): Spend => ({
  calls: 0,
  sessions: 0,
  tokens: zeroTokens(),
  costUsd: 0,
  costKinds: zeroKinds(),
  fastUsd: 0,
  unpricedTokens: 0,
  cacheSavedUsd: 0,
})

/** Several stretches as one: calls, tokens and dollars add up, and so do sessions (the stretches share none). */
export function sumSpends(spends: readonly Spend[]): Spend {
  const out = zeroSpend()
  for (const one of spends) {
    out.calls += one.calls
    out.sessions += one.sessions
    addTokens(out.tokens, one.tokens)
    out.costUsd += one.costUsd
    out.costKinds.cacheRead += one.costKinds.cacheRead
    out.costKinds.cacheWrite += one.costKinds.cacheWrite
    out.costKinds.input += one.costKinds.input
    out.costKinds.output += one.costKinds.output
    out.fastUsd += one.fastUsd
    out.unpricedTokens += one.unpricedTokens
    out.cacheSavedUsd += one.cacheSavedUsd
    if (one.accounting) {
      out.accounting ??= emptyAccounting()
      addAccounting(out.accounting, one.accounting)
    }
  }
  return out
}

export const tokensIn = (t: Tokens): number =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h

/** One call as the accumulators take it; the counting loop fills one and reuses it. */
export type Piece = {
  session: number
  tokens: Tokens
  /** USD; negative when the model has no price. */
  usd: number
  fast: boolean
  kinds: CostKinds
  saved: number
  billing: number
  reportedUsd: number
  missingTokens: boolean
}

export const newPiece = (): Piece => ({
  session: 0,
  tokens: zeroTokens(),
  usd: -1,
  fast: false,
  kinds: zeroKinds(),
  saved: 0,
  billing: 0,
  reportedUsd: -1,
  missingTokens: false,
})

/** A stretch being added up. */
export class Acc {
  private calls = 0
  private tokens = zeroTokens()
  private costUsd = 0
  private costKinds = zeroKinds()
  private fastUsd = 0
  private unpricedTokens = 0
  private cacheSavedUsd = 0
  private files = new Set<number>()
  private accounting = emptyAccounting()
  private hasAccounting = false

  private recordSpendBilling(piece: Piece): void {
    this.accounting.spendCalls++
    const amount = piece.reportedUsd >= 0 ? piece.reportedUsd : piece.usd
    if (amount >= 0) this.accounting.spendUsd += amount
    else this.accounting.spendUnpriced++
  }

  private recordAccounting(piece: Piece): void {
    this.hasAccounting ||= piece.billing > 0 || piece.reportedUsd >= 0 || piece.missingTokens
    if (piece.billing === 0) this.accounting.unknownCalls++
    if (piece.missingTokens) this.accounting.missingTokens++
    if (piece.billing === 1) {
      this.accounting.planCalls++
      this.accounting.planTokens += tokensIn(piece.tokens)
      if (piece.usd >= 0) this.accounting.planValueUsd += piece.usd
    }
    if (piece.reportedUsd >= 0) {
      this.accounting.nativeUsd += piece.reportedUsd
      this.accounting.nativeCalls++
    }
    if (piece.billing === 2 || piece.billing === 3) this.recordSpendBilling(piece)
  }

  add(piece: Piece): void {
    this.calls++
    this.files.add(piece.session)
    addTokens(this.tokens, piece.tokens)
    this.recordAccounting(piece)
    if (piece.usd < 0) {
      this.unpricedTokens += tokensIn(piece.tokens)
      return
    }
    this.costUsd += piece.usd
    if (piece.fast) this.fastUsd += piece.usd
    this.costKinds.input += piece.kinds.input
    this.costKinds.output += piece.kinds.output
    this.costKinds.cacheRead += piece.kinds.cacheRead
    this.costKinds.cacheWrite += piece.kinds.cacheWrite
    this.cacheSavedUsd += piece.saved
  }

  /** Whether a model had no price for any of its calls here. */
  get unpriced(): boolean {
    return this.unpricedTokens > 0
  }

  spend(): Spend {
    return {
      calls: this.calls,
      sessions: this.files.size,
      tokens: this.tokens,
      costUsd: this.costUsd,
      costKinds: this.costKinds,
      fastUsd: this.fastUsd,
      unpricedTokens: this.unpricedTokens,
      cacheSavedUsd: this.cacheSavedUsd,
      ...(this.hasAccounting ? { accounting: this.accounting } : {}),
    }
  }
}

/** What one million tokens of each kind cost a model at standard rates, and what its cache saves. */
export type UnitPrice = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  saved: number
}

const MILLION = 1_000_000

/** The unit price of a model per token; null when the model has no price. */
export function unitPriceOf(model: string): UnitPrice | null {
  const probe = (kind: keyof Tokens) => {
    const parts = priceParts(model, { ...zeroTokens(), [kind]: MILLION }, { promptTokens: 0 })
    return parts === null ? null : parts.input + parts.output + parts.cacheRead + parts.cacheWrite
  }
  const input = probe("input")
  if (input === null) return null
  return {
    input: input / MILLION,
    output: (probe("output") ?? 0) / MILLION,
    cacheRead: (probe("cacheRead") ?? 0) / MILLION,
    cacheWrite5m: (probe("cacheWrite5m") ?? 0) / MILLION,
    cacheWrite1h: (probe("cacheWrite1h") ?? 0) / MILLION,
    saved: (cacheSaving(model, MILLION) ?? 0) / MILLION,
  }
}

/**
 * Fill a piece's cost by kind and its cache saving from the call's own price. The kinds are worked out
 * at standard rates and scaled to the stored price, so a tier or a long prompt moves every kind alike
 * and the four still add up to the call's cost.
 */
export function splitPiece(piece: Piece, unit: UnitPrice | null): void {
  const kinds = piece.kinds
  kinds.input = kinds.output = kinds.cacheRead = kinds.cacheWrite = 0
  piece.saved = 0
  if (unit === null || piece.usd < 0) return
  const t = piece.tokens
  const input = t.input * unit.input
  const output = t.output * unit.output
  const cacheRead = t.cacheRead * unit.cacheRead
  const cacheWrite = t.cacheWrite5m * unit.cacheWrite5m + t.cacheWrite1h * unit.cacheWrite1h
  const sum = input + output + cacheRead + cacheWrite
  if (sum <= 0) return
  const scale = piece.usd / sum
  kinds.input = input * scale
  kinds.output = output * scale
  kinds.cacheRead = cacheRead * scale
  kinds.cacheWrite = cacheWrite * scale
  piece.saved = t.cacheRead * unit.saved * scale
}
