// Open in: a file or folder of a task's checkout, started in the editor the person chose (Settings › Git
// and editor). The folder and the file both go through realpath before containment is checked, so a
// link cannot lead out; the path is one argv element, never a shell string.

import { realpath, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { EDITORS, type Editor } from "../core/config-values.ts"
import { insidePath } from "../core/platform.ts"
import type { Task } from "../core/task/store.ts"
import { err, ok, type Result } from "../ctx.ts"
import { type Opener, openerArgv, plainName, refuse } from "./open-file.ts"

/** What starts each editor: the macOS application it is opened with, and the command it installs elsewhere. */
const EDITOR_PROGRAMS: Record<
  "vscode" | "cursor" | "zed",
  { app: string; linux: string; win32: string }
> = {
  vscode: { app: "Visual Studio Code", linux: "code", win32: "code.cmd" },
  cursor: { app: "Cursor", linux: "cursor", win32: "cursor.cmd" },
  zed: { app: "Zed", linux: "zed", win32: "zed.exe" },
}

/** The folder a shell opens in: the folder itself, or the one that holds the file. */
const shellFolder = (path: string, isFolder: boolean) => (isFolder ? path : dirname(path))

type Launch = { argv: string[]; cwd?: string }

/** How each platform opens a shell in a folder; any other starts the system's terminal emulator there. */
const TERMINALS: Record<string, (folder: string) => Launch> = {
  darwin: (folder) => ({ argv: ["/usr/bin/open", "-a", "Terminal", folder] }),
  win32: (folder) => ({ argv: ["wt.exe", "-d", folder] }),
}
const terminalLaunch = (folder: string, platform: string): Launch =>
  TERMINALS[platform]?.(folder) ?? { argv: ["x-terminal-emulator"], cwd: folder }

function programArgv(
  editor: "vscode" | "cursor" | "zed",
  path: string,
  platform: string,
): string[] {
  const program = EDITOR_PROGRAMS[editor]
  if (platform === "darwin") return ["/usr/bin/open", "-a", program.app, path]
  return [platform === "win32" ? program.win32 : program.linux, path]
}

/** A folder the system treats as a program or a document package: opening it would start it. */
const BUNDLE = /\.(app|bundle|framework|plugin|prefpane|saver|workflow|action|xpc|kext|scptd)$/i

/** Only the checkout itself is opened in Finder, and never when it is named like a bundle. */
const opensInFinder = (path: string, root: boolean) => root && !BUNDLE.test(path)

/**
 * The command that opens a file or folder of a checkout in `editor`, as one argv and the folder it
 * starts in (a terminal opens there). Finder opens the checkout itself (`root`) and shows everything
 * else in its folder, so a folder named like an application bundle is revealed, never launched. The
 * path is one argv element, never a shell string.
 */
export function editorArgv(
  editor: Exclude<Editor, "custom">,
  path: string,
  isFolder: boolean,
  platform: string,
  root = false,
): Launch {
  if (editor === "finder")
    return { argv: openerArgv(opensInFinder(path, root) ? "folder" : "reveal", path, platform) }
  if (editor === "terminal") return terminalLaunch(shellFolder(path, isFolder), platform)
  return { argv: programArgv(editor, path, platform) }
}

/** A name inside the checkout, with links followed: its real path, or why it cannot be opened. */
async function placeInside(
  realRoot: string,
  file: string,
): Promise<Result<{ path: string; isFolder: boolean }>> {
  try {
    const real = await realpath(join(realRoot, file))
    if (!insidePath(realRoot, real)) return refuse(`"${file}" is not inside the checkout`)
    return ok({ path: real, isFolder: (await stat(real)).isDirectory() })
  } catch {
    return err({ code: "no_task", message: `${file} does not exist in the checkout` })
  }
}

/**
 * The real path of a file or folder of the task's checkout that Open in may start, and whether it is a
 * folder: `.` is the checkout itself. A name that climbs out, or a link that leads out, is refused.
 */
export async function openablePlace(
  task: Pick<Task, "repoRoot">,
  file: unknown,
): Promise<Result<{ path: string; isFolder: boolean }>> {
  let realRoot: string
  try {
    realRoot = await realpath(task.repoRoot)
  } catch {
    return err({ code: "no_task", message: "the task's checkout does not exist" })
  }
  if (file === ".") return ok({ path: realRoot, isFolder: true })
  if (!plainName(file)) return refuse(`"${String(file)}" is not a file of this checkout`)
  return placeInside(realRoot, file)
}

/** Open a file or folder of the checkout in one of the editors Settings › Git and editor lists. */
export async function openInEditor(
  task: Pick<Task, "repoRoot">,
  editor: unknown,
  file: unknown,
  opener: Opener,
  custom?: { program: string; args: string[] },
): Promise<Result<Record<string, never>>> {
  if (typeof editor !== "string" || !EDITORS.includes(editor as Editor))
    return refuse(`"${String(editor)}" is not a place to open in`)
  const place = await openablePlace(task, file)
  if (!place.ok) return place
  const selected = editor as Editor
  let launch: Launch
  if (selected === "custom") {
    if (!custom?.program.trim())
      return refuse("Save a custom editor in Settings → Git and editor first.")
    launch = { argv: [custom.program, ...custom.args, place.data.path] }
  } else {
    launch = editorArgv(
      selected,
      place.data.path,
      place.data.isFolder,
      opener.platform,
      file === ".",
    )
  }
  const { argv, cwd } = launch
  let code: number
  try {
    code = await opener.run(argv, cwd)
  } catch {
    return err({ code: "open_failed", message: "The editor could not be started." })
  }
  // Explorer exits 1 on success; every editor's own command exits 0 when it started.
  if (code !== 0 && argv[0] !== "explorer.exe")
    return err({ code: "open_failed", message: `The editor stopped with exit code ${code}.` })
  return ok({})
}
