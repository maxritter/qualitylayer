// What tokens cost, at list price: an estimate, labelled as one wherever it is shown. A model
// without a price confirmed from its vendor's published page has none here: its tokens show,
// its cost reads "price unknown". Nothing is invented.

export type Tokens = {
  input: number
  output: number
  cacheRead: number
  /** Cache writes held five minutes and one hour, priced differently. */
  cacheWrite5m: number
  cacheWrite1h: number
}

/** Recorded request metadata; absent tier/region uses standard list price as an estimate. */
export type PricingContext = {
  promptTokens?: number
  serviceTier?: string
  regional?: boolean
  at?: number
  /** A Grok turn can contain several requests; its total is never one request's context. */
  grokAggregate?: { source: "requests" | "native" | "unknown"; usd?: number }
}

export function recordedPricing(value: Record<string, unknown>): PricingContext {
  return {
    ...(typeof value.service_tier === "string" ? { serviceTier: value.service_tier } : {}),
    ...(typeof value.regional_processing === "boolean"
      ? { regional: value.regional_processing }
      : {}),
  }
}

export const zeroTokens = (): Tokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
})

export function addTokens(into: Tokens, more: Tokens): void {
  into.input += more.input
  into.output += more.output
  into.cacheRead += more.cacheRead
  into.cacheWrite5m += more.cacheWrite5m
  into.cacheWrite1h += more.cacheWrite1h
}

/** Every token the model processed, cache reads included: what a budget is measured in. */
export const allTokens = (t: Tokens): number =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h

import { priceRowOf, requestMultipliers } from "./price-table.ts"

/** The words every figure carries. */
export const PRICE_NOTE = "usage value from agent records and model prices"

/** What a price is made of: dollars for each kind of token. Cache writes of both lifetimes are one part. */
export type PriceParts = { input: number; output: number; cacheRead: number; cacheWrite: number }

/**
 * Whether a call was billed on the fast (priority) tier: its recorded tier says so, and the model
 * has a price with tiers. A tier on any other model changes no price, so it is no speed either.
 */
export function isFastTier(model: string, context: PricingContext = {}): boolean {
  const price = priceRowOf(model, context.at)
  const tier = context.serviceTier?.toLowerCase()
  if (tier === "ultrafast") return price?.ultrafast !== undefined
  return price?.family !== undefined && (tier === "priority" || tier === "fast")
}

function validTokens(tokens: Tokens): boolean {
  return !Object.values(tokens).some((n) => !Number.isFinite(n) || n < 0)
}

/** One model's tokens in USD, by kind of token; null when no confirmed price exists for the model. */
export function priceParts(
  model: string,
  tokens: Tokens,
  context: PricingContext = {},
): PriceParts | null {
  if (context.grokAggregate !== undefined) return null
  const price = priceRowOf(model, context.at)
  if (price === undefined || !validTokens(tokens)) return null
  const multipliers = requestMultipliers(price, tokens, context)
  if (multipliers === null) return null
  const { input: inputMultiplier, output: outputMultiplier, tier: modifier } = multipliers
  const perToken = (usd: number) => usd / 1_000_000
  return {
    input: modifier * tokens.input * perToken(price.input) * inputMultiplier,
    output: modifier * tokens.output * perToken(price.output) * outputMultiplier,
    cacheRead: modifier * tokens.cacheRead * perToken(price.cacheRead) * inputMultiplier,
    cacheWrite:
      modifier *
      inputMultiplier *
      (tokens.cacheWrite5m * perToken(price.cacheWrite5m ?? price.input * 1.25) +
        tokens.cacheWrite1h * perToken(price.cacheWrite1h ?? price.input * 2)),
  }
}

function grokAggregateUsd(
  model: string,
  tokens: Tokens,
  aggregate: NonNullable<PricingContext["grokAggregate"]>,
): number | null {
  const leaf = model.split("/").at(-1) ?? ""
  const isGrokModel = /^grok(?![a-z])/i.test(leaf)
  const isNativeUnknown = model === "unknown" && aggregate.source === "native"
  if (!isGrokModel && !isNativeUnknown) return null
  if (aggregate.source !== "requests" && aggregate.source !== "native") return null
  if (typeof aggregate.usd !== "number" || !Number.isFinite(aggregate.usd) || aggregate.usd < 0)
    return null
  return validTokens(tokens) ? aggregate.usd : null
}

/** One model's tokens in USD; null when no confirmed price exists for the model. */
export function priceOf(
  model: string,
  tokens: Tokens,
  context: PricingContext = {},
): number | null {
  if (context.grokAggregate !== undefined)
    return grokAggregateUsd(model, tokens, context.grokAggregate)
  const parts = priceParts(model, tokens, context)
  return parts === null ? null : parts.input + parts.output + parts.cacheRead + parts.cacheWrite
}

/**
 * What reading `cacheRead` tokens from the cache saved against paying the input price for them, at
 * standard rates; null when the model has no price.
 */
export function cacheSaving(model: string, cacheRead: number): number | null {
  const price = priceRowOf(model)
  if (price === undefined) return null
  return (cacheRead * (price.input - price.cacheRead)) / 1_000_000
}

/** Tokens per model in USD; null when any model with tokens has no price. */
export function costOf(byModel: Record<string, Tokens>): number | null {
  let usd = 0
  for (const [model, tokens] of Object.entries(byModel)) {
    if (allTokens(tokens) === 0) continue
    // This aggregate has no individual request lengths or tiers; estimate standard rates.
    const priced = priceOf(model, tokens, { promptTokens: 0 })
    if (priced === null) return null
    usd += priced
  }
  return usd
}

/** Known dollars stay useful even when another model has no confirmed price. */
export function pricedCost(
  byModel: Record<string, Tokens>,
  context?: PricingContext,
): {
  usd: number
  unpriced: { model: string; tokens: number }[]
} {
  let usd = 0
  const unpriced: { model: string; tokens: number }[] = []
  for (const [model, tokens] of Object.entries(byModel)) {
    const all = allTokens(tokens)
    if (all === 0 && context?.grokAggregate?.source !== "native") continue
    const price = priceOf(model, tokens, context ?? { promptTokens: 0 })
    if (price === null) unpriced.push({ model, tokens: all })
    else usd += price
  }
  return { usd, unpriced }
}
