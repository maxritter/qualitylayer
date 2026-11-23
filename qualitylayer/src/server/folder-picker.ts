import { existsSync } from "node:fs"
import { stopOwnedSubprocess } from "../core/platform.ts"
import { boundedText, FolderPickerError, folderPickerCommand } from "./folder-picker-command.ts"

export { FolderPickerError, folderPickerCommand } from "./folder-picker-command.ts"

/** Human selection may stay open; idle servers never start a chooser. */
export const FOLDER_PICK_MS = 5 * 60_000

export type FolderPicker = {
  pick(path: string, signal?: AbortSignal): Promise<string | null>
  close(): Promise<void>
}

type Child = Pick<Bun.Subprocess, "exited" | "kill"> & {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

type PickerHost = {
  platform: string
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
  spawn(argv: string[], path: string): Child
  lifetimeMs?: number
}

type ActiveSlot = {
  abort: AbortController
  done: Promise<string | null>
  cleanupError: Error | null
}

function defaultPickerHost(): PickerHost {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    spawn: (argv, path) =>
      Bun.spawn(argv, {
        env: { ...process.env, QUALITYLAYER_PICKER_PATH: path },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      }),
  }
}

function wasPickerCancelled(platform: string, code: number, stderr: string): boolean {
  if (platform === "linux" && code === 1 && stderr.trim() === "") return true
  return platform === "darwin" && /\(-128\)\s*$/.test(stderr)
}

function parsePickerOutput(
  platform: string,
  json: boolean,
  result: [string, string, number],
): string | null {
  const [stdout, stderr, code] = result
  if (code !== 0) {
    if (wasPickerCancelled(platform, code, stderr)) return null
    throw new Error(
      "The native folder picker could not select a folder. Try again or enter a path.",
    )
  }
  const value = json
    ? (JSON.parse(stdout) as { path?: unknown }).path
    : stdout.replace(/\r?\n$/, "")
  if (value === null) return null
  if (typeof value !== "string" || value === "")
    throw new Error("The folder picker returned no folder.")
  return value
}

async function runPickerSlot(
  own: PickerHost,
  slot: ActiveSlot,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let child: Child | undefined
  let reading: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => slot.abort.abort(new Error("Folder selection was cancelled."))
  let rejectAbort = (_cause: unknown) => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort(slot.abort.signal.reason)
  slot.abort.signal.addEventListener("abort", onAbort, { once: true })
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    const command = folderPickerCommand(own.platform, path, own.env, own.exists)
    child = own.spawn(command.argv, path)
    timer = setTimeout(
      () => slot.abort.abort(new Error("Folder selection timed out. Try again.")),
      own.lifetimeMs ?? FOLDER_PICK_MS,
    )
    const io = Promise.all([boundedText(child.stdout), boundedText(child.stderr), child.exited])
    reading = io
    return parsePickerOutput(own.platform, command.json, await Promise.race([io, aborted]))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
    slot.abort.signal.removeEventListener("abort", onAbort)
    if (child) {
      await stopOwnedSubprocess(child).catch((cause) => {
        slot.cleanupError =
          cause instanceof Error ? cause : new Error("The folder picker could not be stopped.")
        throw slot.cleanupError
      })
    }
    await reading?.catch(() => {})
  }
}

export function systemFolderPicker(host?: PickerHost): FolderPicker {
  const own = host ?? defaultPickerHost()
  let active: ActiveSlot | null = null
  return {
    pick(path, signal) {
      if (active)
        return Promise.reject(
          new FolderPickerError("picker_busy", "A folder picker is already open."),
        )
      if (signal?.aborted) return Promise.reject(new Error("Folder selection was cancelled."))
      const slot: ActiveSlot = {
        abort: new AbortController(),
        done: Promise.resolve<string | null>(null),
        cleanupError: null,
      }
      active = slot
      slot.done = runPickerSlot(own, slot, path, signal).finally(() => {
        if (active === slot && !slot.cleanupError) active = null
      })
      return slot.done
    },
    async close() {
      const held = active
      held?.abort.abort(new Error("The folder picker closed with its server."))
      await held?.done.catch(() => {
        if (held.cleanupError) throw held.cleanupError
      })
    },
  }
}
