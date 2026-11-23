// Open and Reveal: the system opener, started for one file inside a task's folder. The folder and the
// file both go through realpath before containment is checked, so a link cannot lead out; the path
// is one argv element, never a shell string.

import { realpath } from "node:fs/promises"
import { extname, join, posix, win32 } from "node:path"
import { insidePath } from "../core/platform.ts"
import type { Task } from "../core/task/store.ts"
import { err, ok, type Result } from "../ctx.ts"
import { type OpenHow, TEXT_FILES } from "./open-file-platform.ts"

export {
  linuxOpener,
  type Opener,
  type OpenerHost,
  type OpenHow,
  openerArgv,
  openFile,
  systemOpener,
  windowsPath,
} from "./open-file-platform.ts"

const TEXT_ONLY = "Open starts text files only; Reveal shows any file in its folder."

export const refuse = (message: string) => err({ code: "bad_args", message } as const)

/** A name that is empty, absolute or climbs out with `..` is refused before the disk is asked. */
export function plainName(file: unknown): file is string {
  if (typeof file !== "string" || file === "" || file.includes("\0")) return false
  if (posix.isAbsolute(file) || win32.isAbsolute(file)) return false
  return !file.split(/[\\/]/).includes("..")
}

async function openableTaskFolder(task: Pick<Task, "dir">, file: unknown): Promise<Result<string>> {
  if (file !== ".") return refuse("only the task folder opens as a folder")
  try {
    return ok(await realpath(task.dir))
  } catch {
    return err({ code: "no_task", message: "the task folder does not exist" })
  }
}

async function resolveInsideTask(
  task: Pick<Task, "dir">,
  file: string,
  how: "open" | "reveal",
): Promise<Result<string>> {
  let realFolder: string
  let realFile: string
  try {
    realFolder = await realpath(task.dir)
    realFile = await realpath(join(task.dir, file))
  } catch {
    return err({ code: "no_task", message: `${file} does not exist` })
  }
  if (!insidePath(realFolder, realFile)) return refuse(`"${file}" is not inside the task folder`)
  // A link named like text can lead to a program: Open judges the file it reaches.
  if (how === "open" && !TEXT_FILES.has(extname(realFile).toLowerCase())) return refuse(TEXT_ONLY)
  return ok(realFile)
}

/**
 * The real path of a file Open or Reveal may start: one inside the task folder, and nothing else.
 * Open is for text only.
 */
export async function openablePath(
  task: Pick<Task, "dir">,
  file: unknown,
  how: unknown,
): Promise<Result<string>> {
  // The task folder itself, for "Open the task folder".
  if (how === "folder") return openableTaskFolder(task, file)
  if (how !== "open" && how !== "reveal") return refuse(`"${String(how)}" is not a way to open`)
  if (!plainName(file)) return refuse(`"${String(file)}" is not a file of this task`)
  if (how === "open" && !TEXT_FILES.has(extname(file).toLowerCase())) return refuse(TEXT_ONLY)
  return resolveInsideTask(task, file, how)
}

/**
 * The real path of an artifact Open in browser or Reveal may start: an `.html` file inside the folder
 * that holds it, after links are followed.
 */
export async function openableArtifact(
  folder: string,
  path: string,
  how: unknown,
): Promise<Result<{ path: string; how: OpenHow }>> {
  if (how !== "browser" && how !== "reveal")
    return refuse(`"${String(how)}" is not a way to open an artifact`)
  let realFolder: string
  let realFile: string
  try {
    realFolder = await realpath(folder)
    realFile = await realpath(path)
  } catch {
    return err({ code: "no_task", message: "the artifact does not exist" })
  }
  if (!insidePath(realFolder, realFile) || extname(realFile).toLowerCase() !== ".html")
    return refuse("only an artifact's page opens here")
  return ok({ path: realFile, how })
}
