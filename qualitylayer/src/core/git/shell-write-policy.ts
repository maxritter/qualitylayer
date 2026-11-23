import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { folderDoc } from "../docs/names.ts"
import { allTasks } from "../docs/outline.ts"
import { approvalCurrent } from "../gate/revision.ts"
import type { Task } from "../task/store.ts"
import { readOutline } from "../task-flow.ts"
import { readBuildStart } from "./build-start.ts"
import { literalWrites, POLICY_SHELLS } from "./shell-policy-writes.ts"
import { covers } from "./slice-commit.ts"

const TOOLS = new Set(["Bash", "bash", "shell", "powershell", "exec_command", "local_shell"])
export const shellWriteTool = (tool: unknown): tool is string =>
  typeof tool === "string" && TOOLS.has(tool)

async function canonical(path: string): Promise<string | null> {
  const suffix: string[] = []
  for (let i = 0; i < 64; i++) {
    try {
      return join(await realpath(path), ...suffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null
      const parent = dirname(path)
      if (parent === path) return null
      suffix.unshift(basename(path))
      path = parent
    }
  }
  return null
}

const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function isInlineShellArgv(raw: unknown): raw is string[] {
  if (!Array.isArray(raw) || !raw.every((word) => typeof word === "string")) return false
  const flag = raw[1] ?? ""
  return POLICY_SHELLS.test(basename(raw[0] ?? "")) && /^-[a-z]+$/.test(flag) && flag.includes("c")
}

function extractCommand(input: Record<string, unknown>): string | null {
  const raw = input.command ?? input.cmd
  if (typeof raw === "string") return raw
  return isInlineShellArgv(raw) ? (raw[2] ?? "") : null
}

async function approvedTaskFiles(ctx: Ctx, task: Task): Promise<string[]> {
  const capture = await readBuildStart(ctx, task)
  const approved = [...(capture?.approvedFiles ?? [])]
  if (await approvalCurrent(ctx, task, folderDoc("plan"))) {
    const outline = await readOutline(ctx, task)
    if (outline) approved.push(...allTasks(outline).flatMap((card) => card.files))
  }
  return approved
}

async function deniedWritePaths(
  ctx: Ctx,
  task: Task,
  paths: string[],
  roots: { root: string; docs: string },
): Promise<string[]> {
  const approved = await approvedTaskFiles(ctx, task)
  const tracked = await ctx.git.run(task.repoRoot, [
    "ls-files",
    "-z",
    "--",
    ...paths.map((path) => `:(literal)${relative(roots.root, path).split(sep).join("/")}`),
  ])
  const trackedPaths = new Set(tracked.code === 0 ? tracked.stdout.split("\0") : [])
  return paths.filter((path) => {
    const rel = relative(roots.root, path).split(sep).join("/")
    if (approved.some((file) => covers(file, rel)) || trackedPaths.has(rel)) return true
    if (!within(roots.docs, path)) return false
    const own = relative(roots.docs, path).split(sep).join("/")
    return !["evidence/", "records/", "attachments/"].some((prefix) => own.startsWith(prefix))
  })
}

/** A workflow-bound pre-tool hint, not a general shell sandbox or an opaque-script detector. */
export async function shellWriteDenial(
  ctx: Ctx,
  task: Task,
  tool: unknown,
  input: unknown,
): Promise<string | null> {
  if (!shellWriteTool(tool) || !input || typeof input !== "object") return null
  const given = input as Record<string, unknown>
  const command = extractCommand(given)
  if (command === null) return null
  const workdir =
    typeof given.workdir === "string"
      ? given.workdir
      : typeof given.cwd === "string"
        ? given.cwd
        : ""
  const candidates = await literalWrites(command, resolve(ctx.env.cwd(), workdir))
  const [root, docs] = candidates.length
    ? await Promise.all([canonical(task.repoRoot), canonical(task.dir)])
    : [null, null]
  if (!root || !docs) return null
  const resolved = await Promise.all(candidates.map(canonical))
  const paths = [
    ...new Set(
      [...candidates, ...resolved].filter(
        (path): path is string => path !== null && within(root, path),
      ),
    ),
  ]
  const denied = paths.length ? await deniedWritePaths(ctx, task, paths, { root, docs }) : []
  if (!denied.length) return null
  const labels = denied
    .slice(0, 6)
    .map((path) => relative(root, path).split(sep).join("/").slice(0, 240))
  return `QualityLayer: this shell command names a literal write path: ${labels.join(", ")}${denied.length > labels.length ? " and other task source files" : ""}. Use your native Edit or Write file tool (apply_patch in Codex) for source and authored task documents. Keep shell commands for reads, checks, builds and generated evidence.`
}
