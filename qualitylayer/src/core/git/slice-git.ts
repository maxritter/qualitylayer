// The git calls a slice's commit makes: one place that runs git with literal pathspecs, so the
// commit itself (slice-commit.ts) and the placing of a checked commit on a moved HEAD
// (slice-land.ts) read and write the repository the same way.

export type Run = { code: number; out: Uint8Array; text: string; stderr: string }

export async function git(
  cwd: string,
  args: string[],
  options: {
    env?: Record<string, string | undefined>
    input?: Uint8Array | string
    /** Paths as git's pathspecs, for the commands that refuse literal ones (`check-ignore`). */
    pathspecs?: boolean
  } = {},
): Promise<Run> {
  try {
    const literal = options.pathspecs === true ? [] : ["--literal-pathspecs"]
    const proc = Bun.spawn(["git", ...literal, ...args], {
      cwd,
      env: { ...process.env, ...options.env },
      stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, stderr, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const bytes = new Uint8Array(out)
    return { code, out: bytes, text: new TextDecoder().decode(bytes), stderr }
  } catch (cause) {
    return { code: 127, out: new Uint8Array(), text: "", stderr: String(cause) }
  }
}

export type Entry = { mode: string; sha: string }

/** One NUL-delimited `update-index -z --index-info` entry: the entry a path gets, or none to remove it. */
export const infoLine = (path: string, entry: Entry | null) =>
  entry === null ? `0 ${"0".repeat(40)}\t${path}\0` : `${entry.mode} ${entry.sha}\t${path}\0`
