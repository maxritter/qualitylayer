// Who made a model, read from its id: the one place that says "this id is Claude, that one is GPT".
// A second opinion is only independent when another maker's model gives it, whatever agent runs it,
// so the reviewer pick compares makers, not tools. Pure: the App's Settings page reads it too.

import { lastLineBreak } from "../text-boundaries.ts"

export const MODEL_MAKERS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "deepseek",
  "alibaba",
  "moonshot",
  "zhipu",
  "mistral",
  "meta",
  "microsoft",
] as const
export type ModelMaker = (typeof MODEL_MAKERS)[number]

/** The company, as a sentence names it: "Only Anthropic models are available". */
export const MAKER_NAMES: Record<ModelMaker, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  alibaba: "Alibaba",
  moonshot: "Moonshot",
  zhipu: "Zhipu",
  mistral: "Mistral",
  meta: "Meta",
  microsoft: "Microsoft",
}

/** The maker's models by the name people know them as: "Codex (GPT) checks Claude's work". */
export const MAKER_FAMILIES: Record<ModelMaker, string> = {
  anthropic: "Claude",
  openai: "GPT",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  alibaba: "Qwen",
  moonshot: "Kimi",
  zhipu: "GLM",
  mistral: "Mistral",
  meta: "Llama",
  microsoft: "MAI",
}

/**
 * The start of a model name, then the maker. A name is a word of its own or the word followed by a
 * version (`opus-5`, `o3-mini`, `gpt-6.1-sol`, `qwen3-coder`), so `octopus` and `opusx` are no one's.
 */
const NAMES: readonly [RegExp, ModelMaker][] = [
  [/^(?:claude|opus|sonnet|haiku|fable)(?![a-z])/, "anthropic"],
  [/^(?:gpt|chatgpt|codex)(?![a-z])/, "openai"],
  [/^o\d/, "openai"],
  [/^(?:gemini|gemma)(?![a-z])/, "google"],
  [/^grok(?![a-z])/, "xai"],
  [/^deepseek(?![a-z])/, "deepseek"],
  [/^(?:qwen|qwq)(?![a-z])/, "alibaba"],
  [/^(?:kimi|moonshot)(?![a-z])/, "moonshot"],
  [/^(?:glm|chatglm)(?![a-z])/, "zhipu"],
  [/^(?:mistral|mixtral|codestral|devstral|magistral|ministral)(?![a-z])/, "mistral"],
  [/^(?:llama|meta-llama)(?![a-z])/, "meta"],
  [/^mai(?![a-z])/, "microsoft"],
]

/**
 * The maker of a model id, or null when it cannot be told (Cursor's and Copilot's `auto`, an id of no known
 * maker, no id). A provider or gateway prefix (`openai-codex/gpt-6.1-sol`, `alibaba-token-plan/deepseek-v4`)
 * says who serves the model, not who made it: the model part, after the last slash, decides. A
 * Cursor parameter list (`claude-opus-4-8[context=1m]`) and the case are ignored.
 */
export function modelMaker(id: string | null | undefined): ModelMaker | null {
  if (id === null || id === undefined) return null
  const name = id.slice(id.lastIndexOf("/") + 1)
  const parameters = name.indexOf("[", lastLineBreak(name) + 1)
  const model = (parameters === -1 ? name : name.slice(0, parameters)).trim().toLowerCase()
  for (const [pattern, maker] of NAMES) if (pattern.test(model)) return maker
  return null
}
