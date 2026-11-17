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

/** USD per million tokens. Cache writes cost 1.25× input (5 minutes) or 2× (1 hour). */
type Price = {
  model: RegExp
  input: number
  output: number
  cacheRead: number
  cacheWrite1h?: number
  cacheWrite5m?: number
  family?: "grok" | "gemini" | "openai"
  next?: { at: number; input: number; output: number; cacheRead: number }
  ultrafast?: { promotionEnds: number }
}

const PRICES: Price[] = [
  // Vendor text-token rates checked 2026-11-02; storage/tools are outside token valuation.
  // https://docs.x.ai/developers/pricing
  {
    model: /^grok-4\.[67]$/i,
    input: 2,
    output: 6,
    cacheRead: 0.5,
    cacheWrite5m: 2,
    cacheWrite1h: 2,
    family: "grok",
  },
  // https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash
  {
    model: /^gemini-3\.8-flash(?:-(?:high|medium|low|minimal|preview))?$/i,
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    cacheWrite5m: 0.75,
    cacheWrite1h: 0.75,
    family: "gemini",
    next: { at: Date.UTC(2027, 0, 1), input: 1.5, output: 7.5, cacheRead: 0.15 },
  },
  // The Claude 5 models, each its own row ahead of the family patterns (the first match wins, so
  // /opus/i, /sonnet/i and /haiku/i keep pricing the older versions). Rates from Anthropic's
  // pricing page, https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-11.
  // Fable 5.2's rates read 2026-11-10 from the same page.
  { model: /fable-5-2(?!\d)/i, input: 8, output: 40, cacheRead: 0.2 },
  { model: /fable-5-1(?!\d)/i, input: 10, output: 50, cacheRead: 0.25 },
  // Fable 5 itself, a dated id included; a later minor version (5-3, 5.3) stays unpriced until its
  // own row is added.
  { model: /fable-5(?![\d.]|-\d{1,2}(?!\d))/i, input: 10, output: 50, cacheRead: 1 },
  { model: /haiku-5-5(?!\d)/i, input: 0.1, output: 0.5, cacheRead: 0.01 },
  { model: /sonnet-5-5(?!\d)/i, input: 2, output: 10, cacheRead: 0.1 },
  { model: /opus/i, input: 4, output: 20, cacheRead: 0.2 },
  { model: /sonnet/i, input: 2, output: 10, cacheRead: 0.2 },
  { model: /haiku/i, input: 1, output: 5, cacheRead: 0.1 },
  // https://developers.openai.com/api/docs/pricing.md
  {
    model: /^gpt-6\.2-astra$/i,
    input: 8,
    output: 40,
    cacheRead: 0.4,
    family: "openai",
    ultrafast: { promotionEnds: Date.UTC(2027, 2, 1, 8) },
  },
  {
    model: /^gpt-6\.2-sol$/i,
    input: 2,
    output: 10,
    cacheRead: 0.1,
    family: "openai",
    ultrafast: { promotionEnds: Date.UTC(2027, 2, 1, 8) },
  },
  {
    model: /^gpt-5\.6-luna$/i,
    input: 0.2,
    output: 1.2,
    cacheRead: 0.02,
    cacheWrite1h: 0.5,
    family: "openai",
  },
  // Current estimate rates verified 2026-10-08, not a reconstruction of historical invoices:
  // https://developers.openai.com/api/docs/models/gpt-6.1-sol
  // Fast's priority alias: https://developers.openai.com/api/docs/guides/fast-mode
  {
    model: /^gpt-6\.1-sol$/i,
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite1h: 2.5,
    family: "openai",
  },
]

/** The words every figure carries. */
export const PRICE_NOTE = "usage value from agent records and model prices"

/** What a price is made of: dollars for each kind of token. Cache writes of both lifetimes are one part. */
export type PriceParts = { input: number; output: number; cacheRead: number; cacheWrite: number }

const priceRowOf = (model: string, at = 0) => {
  const leaf = model.trim().split("/").at(-1) ?? model
  const canonical = leaf.startsWith("claude-")
    ? leaf.replace(/(haiku|sonnet|fable|opus)-(\d+)\.(\d+)/, "$1-$2-$3")
    : leaf
  const row = PRICES.find((price) => price.model.test(canonical))
  return row?.next && at >= row.next.at
    ? { ...row, ...row.next, cacheWrite5m: row.next.input, cacheWrite1h: row.next.input }
    : row
}

/** The tiers that change a price, as a multiplier on it. */
const OPENAI_TIERS: Record<string, number> = {
  standard: 1,
  default: 1,
  auto: 1,
  priority: 2,
  fast: 2,
  batch: 0.5,
  flex: 0.5,
}
const GROK_TIERS: Record<string, number> = {
  standard: 1,
  default: 1,
  auto: 1,
  priority: 2,
  fast: 2,
  batch: 0.8,
}
const GEMINI_TIERS: Record<string, number> = {
  standard: 1,
  default: 1,
  auto: 1,
  priority: 1.8,
  batch: 0.5,
  flex: 0.5,
}

type Multipliers = { input: number; output: number; tier: number }
const STANDARD_MULTIPLIERS: Multipliers = { input: 1, output: 1, tier: 1 }

function openAiTier(price: Price, name: string, at: number | undefined): number | undefined {
  if (price.ultrafast === undefined) return OPENAI_TIERS[name]
  if (name === "flex") return undefined
  if (name === "ultrafast") return (at ?? Date.now()) < price.ultrafast.promotionEnds ? 3 : 6
  return OPENAI_TIERS[name]
}

function serviceTierMultiplier(
  price: Price,
  family: NonNullable<Price["family"]>,
  name: string,
  long: boolean,
  at: number | undefined,
): number | undefined {
  switch (family) {
    case "grok":
      return long && name === "fast" ? 1.5 : GROK_TIERS[name]
    case "gemini":
      return GEMINI_TIERS[name]
    case "openai":
      return openAiTier(price, name, at)
  }
}

/** Determine the applicable context and service-tier rates before pricing each token kind. */
function requestMultipliers(
  price: Price,
  tokens: Tokens,
  context: PricingContext,
): Multipliers | null {
  const family = price.family
  if (family === undefined) return STANDARD_MULTIPLIERS
  const prompt =
    context.promptTokens ??
    tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h
  if (!Number.isFinite(prompt) || prompt < 0) return null
  const long = (family === "grok" && prompt >= 200_000) || (family === "openai" && prompt > 272_000)
  const name = context.serviceTier?.toLowerCase() ?? "standard"
  const tier = serviceTierMultiplier(price, family, name, long, context.at)
  if (typeof tier !== "number") return null
  return {
    input: long ? 2 : 1,
    output: long ? (family === "grok" ? 2 : 1.5) : 1,
    tier: tier * (context.regional && family !== "gemini" ? 1.1 : 1),
  }
}

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

/** One model's tokens in USD, by kind of token; null when no confirmed price exists for the model. */
export function priceParts(
  model: string,
  tokens: Tokens,
  context: PricingContext = {},
): PriceParts | null {
  if (context.grokAggregate !== undefined) return null
  const price = priceRowOf(model, context.at)
  if (price === undefined) return null
  if (Object.values(tokens).some((n) => !Number.isFinite(n) || n < 0)) return null
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

/** One model's tokens in USD; null when no confirmed price exists for the model. */
export function priceOf(
  model: string,
  tokens: Tokens,
  context: PricingContext = {},
): number | null {
  const aggregate = context.grokAggregate
  if (aggregate !== undefined) {
    if (
      (!/^grok(?![a-z])/i.test(model.split("/").at(-1) ?? "") &&
        !(model === "unknown" && aggregate?.source === "native")) ||
      (aggregate?.source !== "requests" && aggregate?.source !== "native") ||
      typeof aggregate.usd !== "number" ||
      !Number.isFinite(aggregate.usd) ||
      aggregate.usd < 0 ||
      Object.values(tokens).some((n) => !Number.isFinite(n) || n < 0)
    )
      return null
    return aggregate.usd
  }
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
