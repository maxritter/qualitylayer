/**
 * The hosts the person already named in their ssh config, offered when a machine is added. Only the
 * `Host` lines of `~/.ssh/config` are read: no key, no address, no included file.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { skipWhitespace, trimmedLineTail } from "../../core/text-boundaries.ts"
import type { Ctx } from "../../ctx.ts"
import { isTarget } from "./store.ts"

/** A `Host` name that stands for one machine: no pattern, no negation. */
const isPlain = (name: string): boolean => !/[*?!]/.test(name) && isTarget(name)

/** The plain `Host` names of an ssh config, in its order, each once. */
export function hostsOf(config: string): string[] {
  const names = config.split(/\r?\n/).flatMap((line) => {
    const start = skipWhitespace(line, 0)
    if (!/^host/i.test(line.slice(start, start + 4))) return []
    const afterHost = start + 4
    let tail = trimmedLineTail(line, afterHost, 1)
    if (tail === null) {
      const equals = skipWhitespace(line, afterHost)
      if (line.charAt(equals) !== "=") return []
      tail = trimmedLineTail(line, equals + 1, 0)
    }
    return tail === null ? [] : tail.split(/\s+/).map((name) => name.replace(/"/g, ""))
  })
  return [...new Set(names.filter(isPlain))]
}

/** Where the person's ssh config lies. */
export const sshConfigPath = (ctx: Ctx): string =>
  join(ctx.env.get("HOME") ?? ctx.env.get("USERPROFILE") ?? homedir(), ".ssh", "config")

/** The config's plain hosts that are not a machine yet; a missing config gives none. */
export async function sshHosts(ctx: Ctx, added: ReadonlySet<string>): Promise<string[]> {
  try {
    return hostsOf(await ctx.fs.readFile(sshConfigPath(ctx))).filter((name) => !added.has(name))
  } catch {
    return []
  }
}
