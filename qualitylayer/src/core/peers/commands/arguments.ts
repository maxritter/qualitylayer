import { readFileSync } from "node:fs"
import { MAX_TEXT_CHARS, PeerError, utf8Len } from "../base.ts"

export type Args = { positional: string[]; opts: Record<string, string | true> }

export const opt = (args: Args, name: string): string | undefined => {
  const value = args.opts[name]
  return typeof value === "string" ? value : undefined
}
export const flag = (args: Args, name: string) => args.opts[name] !== undefined
export const out = (line: string) => process.stdout.write(`${line}\n`)
export const fail = (message: string, code = 1): number => {
  process.stderr.write(`error: ${message}\n`)
  return code
}
export const printResult = (args: Args, payload: unknown, human: string) =>
  out(flag(args, "json") ? JSON.stringify(payload) : human)

// Standard input supports replies without a shared writable folder; all sources share the size cap.
export function messageFrom(args: Args): string {
  const path = opt(args, "message-file")
  let value = opt(args, "message")
  if (path !== undefined) {
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(
        readFileSync(path === "-" ? 0 : path),
      )
    } catch (cause) {
      throw new PeerError(`cannot read message file ${path}: ${(cause as Error).message}`, 2)
    }
  }
  if (value === undefined) throw new PeerError("one of --message or --message-file is required", 2)
  if (value.length > MAX_TEXT_CHARS || utf8Len(value) > MAX_TEXT_CHARS) {
    throw new PeerError(`message is over the ${MAX_TEXT_CHARS} character/byte cap`, 2)
  }
  return value
}

export function asOption(args: Args): Args["opts"] {
  const as = opt(args, "as")
  return as === undefined ? {} : { as }
}
