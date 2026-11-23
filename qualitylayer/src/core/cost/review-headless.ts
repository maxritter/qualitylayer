// The usage a headless review by Cursor, Grok, Copilot or Antigravity reports in its own stream, as the
// calls of a review's cost row. Each prints the run's totals at its end: Cursor in `result`, Grok in
// `end` (per model), Antigravity in `result`, Copilot in its last `session.usage_checkpoint` (per model;
// its `result` line has only the premium requests). Reasoning tokens are already part of the output
// tokens in all four. A run that did not print its totals has no calls, and its row says so.

import type { NativeAgent } from "../agents/ids.ts"
import {
  grokStreamCalls,
  type StreamRow,
  streamCall,
  streamCount,
  streamObject,
} from "./review-headless-grok.ts"
import type { Call } from "./transcripts.ts"

/** Each reader turns one parsed row of the stream into the calls it carries. */
const READERS: Partial<Record<NativeAgent, (row: StreamRow, model: string, at: number) => Call[]>> =
  {
    cursor: (row, model, at) => {
      if (row.type !== "result") return []
      const u = streamObject(row.usage)
      return streamCall(at, model, {
        input: u.inputTokens,
        output: u.outputTokens,
        read: u.cacheReadTokens,
        write: u.cacheWriteTokens,
      })
    },
    copilot: (row, _model, at) => {
      if (row.type !== "session.usage_checkpoint") return []
      const metrics = streamObject(
        streamObject(streamObject(row.data).accountingSnapshot).modelMetrics,
      )
      return Object.entries(metrics).flatMap(([name, entry]) => {
        const u = streamObject(streamObject(entry).usage)
        const input = streamCount(u.inputTokens)
        const read = streamCount(u.cacheReadTokens)
        const write = streamCount(u.cacheWriteTokens)
        // Copilot's input tokens hold the cached ones, read and written.
        return streamCall(at, name, {
          input: input === null ? null : Math.max(0, input - (read ?? 0) - (write ?? 0)),
          output: u.outputTokens,
          read,
          write,
        })
      })
    },
    antigravity: (row, model, at) => {
      if (row.event !== "result") return []
      const u = streamObject(streamObject(row.result).usage)
      return streamCall(at, model, {
        input: u.input_tokens,
        output: u.output_tokens,
        read: u.cache_read_tokens,
      })
    },
  }

/** The agents whose stream repeats running totals, so only its last report counts. */
const CUMULATIVE: ReadonlySet<NativeAgent> = new Set(["copilot"])

/** Whether the agent's headless stream carries its usage, so a review by it can be recorded complete. */
export const hasHeadlessUsage = (agent: NativeAgent): boolean =>
  agent === "grok" || READERS[agent] !== undefined

/** The calls a review's stream reported: its totals, once; none when the run printed none. */
export function headlessCalls(agent: NativeAgent, model: string, text: string, at: number): Call[] {
  if (agent === "grok") return grokStreamCalls(text, at)
  const read = READERS[agent]
  if (read === undefined) return []
  const found: Call[][] = []
  for (const line of text.split("\n")) {
    try {
      const calls = read(streamObject(JSON.parse(line)), model, at)
      if (calls.length > 0) found.push(calls)
    } catch {
      /* A partial line or a diagnostic carries no usage. */
    }
  }
  // Copilot prints a running total at every checkpoint: the last one is the run's.
  return CUMULATIVE.has(agent) ? (found.at(-1) ?? []) : found.flat()
}
