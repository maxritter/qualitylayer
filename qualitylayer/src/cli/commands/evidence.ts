import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { isAbsolute, join, relative, resolve } from "node:path"
import { promisify } from "node:util"
import { byCode } from "../../core/code-order.ts"
import { buildOwnPaths, buildRevision } from "../../core/gate/revision.ts"
import { revisionPaths } from "../../core/git/revision-paths.ts"
import { forTask } from "../../core/handoff/pick-build.ts"
import { SCREEN_MAX_BYTES } from "../../core/home-caps.ts"
import {
  type EvidenceSource,
  isAcceptanceStep,
  isEvidenceMode,
  isRunId,
} from "../../core/review/screen-evidence.ts"
import {
  checkedScreenPng,
  recordEvidence,
  recordScreen,
  type ScreenOutcome,
  screenSurfaces,
} from "../../core/review/screens.ts"
import type { Task } from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { findChrome, loopbackUrl, renderUrl, type UrlShotSpec } from "../../server/render.ts"
import { clickOptions } from "../../server/render-states.ts"
import { parseArgs, requireTask } from "./shared.ts"

const captureGit = promisify(execFile)

/** Stability of local inputs only; a loopback URL does not establish frontend source provenance. */
async function captureSource(ctx: Ctx, task: Task): Promise<string> {
  const scope = revisionPaths(task.repoRoot, (await buildOwnPaths(ctx, task)) ?? ["."])
  const env = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(process.env),
        "HOME",
        "USERPROFILE",
        "PATH",
        "QUALITYLAYER_HOME",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
      ]),
    ].flatMap((name) => {
      const value = ctx.env.get(name)
      return value === undefined ? [] : [[name, value]]
    }),
  )
  const configCount = Number(env.GIT_CONFIG_COUNT ?? 0)
  if (!Number.isSafeInteger(configCount) || configCount < 0 || configCount > 64)
    throw new Error("Capture Git configuration exceeds its safe limit")
  for (let i = 0; i < configCount; i++)
    for (const key of [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`]) {
      const value = ctx.env.get(key)
      if (value !== undefined) env[key] = value
    }
  const git = async (args: string[]) => {
    try {
      return (
        await captureGit("git", ["--no-optional-locks", ...args], {
          cwd: task.repoRoot,
          env,
          timeout: 10_000,
          maxBuffer: 256 * 1024,
          encoding: "buffer",
          windowsHide: true,
        })
      ).stdout
    } catch {
      throw new Error(`Capture source Git ${args[0]} failed or exceeded its output/time limit`)
    }
  }
  const textGit = async (args: string[]) =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await git(args))
  const metadata = relative(task.repoRoot, task.dir)
  const selected = [
    ...scope.local.map((path) => `:(literal)${path}`),
    ...(!isAbsolute(metadata) && !metadata.startsWith("..")
      ? [`:(exclude,literal)${metadata.split("\\").join("/")}`]
      : []),
  ]
  const head = await textGit(["rev-parse", "--verify", "HEAD"])
  if (
    scope.local.length &&
    (await textGit([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...selected,
    ])) !== ""
  )
    throw new Error("Task source is uncommitted; use a clean recorded preview before capture")
  const listed = scope.local.length
    ? await textGit([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...selected,
      ])
    : ""
  const paths = [
    ...new Set([
      ...listed
        .split("\0")
        .filter(Boolean)
        .map((path) => join(task.repoRoot, path)),
      ...scope.external,
    ]),
  ].sort(byCode)
  if (!ctx.fs.readRegularFile || paths.length > 2048)
    throw new Error("Capture source inventory exceeds its safe limit")
  let budget = 32 * 1024 * 1024
  const hash = createHash("sha256").update(head)
  for (const path of paths) {
    hash.update(JSON.stringify(path))
    const info = await ctx.fs.lstat?.(path)
    if (info === null) {
      hash.update("missing")
      continue
    }
    if (info?.kind !== "file") throw new Error("Capture source must contain only regular files")
    const bytes = await ctx.fs.readRegularFile(path, Math.min(budget, 2 * 1024 * 1024))
    budget -= bytes.length
    hash.update(createHash("sha256").update(bytes).digest("hex"))
  }
  return hash.digest("hex")
}

const SHOT_USAGE =
  "usage: qualitylayer evidence shot <key> --url <loopback URL> --run <id> --mode scripted|real-session [--step A<n>] [--width <px>] [--height <px>] [--theme light|dark] [--wait-for <selector>] [--click <selector>]... [--crop <selector>]\nkey: use the Plan's named surface; a single-file task artifact artifacts/page.html#section uses page#section, keeping the section"
const ADD_USAGE =
  "usage: qualitylayer evidence add --run <id> --mode scripted|real-session [--step A<n>] <file>   (a PNG picture or a text output of that run)"

/** Where a record came from: the run, the acceptance step it shows, and how the run happened. */
function source(flags: Record<string, string | true>): EvidenceSource | string {
  const { run, step, mode } = flags
  if (typeof run !== "string" || !isRunId(run))
    return "--run needs the run's name: letters, digits, . _ - (at most 64)"
  if (!isEvidenceMode(mode)) return "--mode needs scripted or real-session: how this run happened"
  if (step === undefined) return { run, mode }
  const named = typeof step === "string" ? step.toUpperCase() : ""
  if (!isAcceptanceStep(named)) return "--step names an acceptance step of the Plan: A1, A2, …"
  return { run, step: named, mode }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** `evidence add`: copy a picture or an output into the task and record whose run it is. */
async function addCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args, ["run", "step", "mode"])
  const bad = (message: string) => err({ code: "bad_args" as const, message })
  const [, file] = positional
  // Named before the usage: an option that is not known leaves its value among the words.
  const unknown = unknownOption(flags, ["run", "step", "mode"], ADD_USAGE)
  if (unknown !== null) return bad(unknown)
  if (!file || positional.length !== 2) return bad(ADD_USAGE)
  const from = source(flags)
  if (typeof from === "string") return bad(from)
  const found = await requireTask(ctx)
  if (!found.ok) return found
  const task = found.data
  if (!ctx.fs.readRegularFile) return bad("Reading a file is not available here")
  let bytes: Uint8Array
  try {
    bytes = await ctx.fs.readRegularFile(resolve(ctx.env.cwd(), file), SCREEN_MAX_BYTES)
  } catch {
    return bad(`${file} is not a readable file of at most ${SCREEN_MAX_BYTES / 1024 / 1024} MB`)
  }
  const kind = PNG_MAGIC.every((byte, i) => bytes[i] === byte) ? "picture" : "output"
  try {
    return ok(
      await recordEvidence(
        ctx,
        task,
        { ...from, kind, buildRevision: await buildRevision(ctx, task) },
        bytes,
      ),
    )
  } catch (cause) {
    return bad((cause as Error).message)
  }
}

/** An option the command does not know, by its name: the reply says which one it was. */
function unknownOption(
  flags: Record<string, string | true>,
  known: readonly string[],
  usage: string,
): string | null {
  const unknown = Object.keys(flags).filter((name) => !known.includes(name))
  if (unknown.length === 0) return null
  return `Unknown evidence option ${unknown.map((name) => `--${name.split("=")[0]}`).join(", ")}. ${usage}`
}

/**
 * `--task <slug>` wherever it stands among the arguments, also as `--task=<slug>`: the task the
 * evidence belongs to. The command line takes the option before the subcommand's own words; a
 * caller that hands the arguments over as written (a judge's `evidence add … <file> --task <slug>`)
 * names the same task.
 */
function namedTask(ctx: Ctx, args: string[]): { ctx: Ctx; args: string[] } | { error: string } {
  const rest: string[] = []
  let slug: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "--task") {
      const value = args[++i]
      if (value === undefined || value.startsWith("--"))
        return { error: "--task needs a task: --task <slug>" }
      slug = value
    } else if (arg.startsWith("--task=")) {
      slug = arg.slice("--task=".length)
      if (slug === "") return { error: "--task needs a task: --task <slug>" }
    } else rest.push(arg)
  }
  // As the command line does for `--task` before the subcommand's words (main.ts).
  return {
    ctx: slug === undefined ? ctx : { ...forTask(ctx, slug), invocationTask: slug },
    args: rest,
  }
}

export async function evidenceCmd(given: Ctx, called: string[]): Promise<Result<unknown>> {
  const named = namedTask(given, called)
  if ("error" in named) return err({ code: "bad_args", message: named.error })
  const { ctx, args } = named
  if (args[0] === "add") return addCmd(ctx, args)
  const SHOT_OPTIONS = [
    "url",
    "width",
    "height",
    "theme",
    "wait-for",
    "crop",
    "click",
    "run",
    "step",
    "mode",
  ]
  const { positional, flags } = parseArgs(args, SHOT_OPTIONS)
  const [verb, key] = positional
  const bad = (message: string) => err({ code: "bad_args" as const, message })
  // Named before the usage: an option that is not known leaves its value among the words.
  const unknown = unknownOption(flags, SHOT_OPTIONS, `${SHOT_USAGE}\n${ADD_USAGE}`)
  if (unknown !== null) return bad(unknown)
  if (verb !== "shot" || !key || positional.length !== 2 || typeof flags.url !== "string")
    return bad(`${SHOT_USAGE}\n${ADD_USAGE}`)
  try {
    loopbackUrl(flags.url)
  } catch (cause) {
    return bad((cause as Error).message)
  }
  const from = source(flags)
  if (typeof from === "string") return bad(from)
  const theme = flags.theme ?? "light"
  if (theme !== "light" && theme !== "dark") return bad("--theme must be light or dark")
  for (const flag of ["wait-for", "crop", "click"])
    if (
      flags[flag] !== undefined &&
      (typeof flags[flag] !== "string" || String(flags[flag]).trim() === "")
    )
      return bad(`--${flag} needs a selector`)
  const found = await requireTask(ctx)
  if (!found.ok) return found
  const task = found.data
  const surface = (await screenSurfaces(ctx, task)).find((surface) => surface.key === key)
  if (!surface)
    return bad(
      `No planned screen surface named ${key}. For artifacts/page.html#section, use page#section. For a separate capture, use qualitylayer evidence add.`,
    )
  const width = flags.width === undefined ? surface.width : Number(flags.width)
  if (!Number.isInteger(width) || width < 240 || width > 8000)
    return bad("--width must be a whole number from 240 to 8000")
  const height = flags.height === undefined ? 900 : Number(flags.height)
  if (
    typeof flags.height === "boolean" ||
    !Number.isInteger(height) ||
    height < 240 ||
    height > 8000
  )
    return bad("--height must be a whole number from 240 to 8000")
  const options: UrlShotSpec = {
    width,
    ...(flags.height === undefined ? {} : { height }),
    theme,
    ...(typeof flags["wait-for"] === "string" ? { waitFor: flags["wait-for"] } : {}),
    ...(typeof flags.crop === "string" ? { crop: flags.crop } : {}),
    ...clickOptions(args),
  }
  const revision = await buildRevision(ctx, task)
  const chrome = findChrome((name) => ctx.env.get(name))
  let outcome: ScreenOutcome = "skipped: no browser"
  let png: Uint8Array | undefined
  if (chrome) {
    try {
      const source = await captureSource(ctx, task)
      png = await renderUrl(chrome, flags.url, options)
      checkedScreenPng(png)
      const current = (await screenSurfaces(ctx, task)).find((row) => row.key === key)
      if (
        (await captureSource(ctx, task)) !== source ||
        (await buildRevision(ctx, task)) !== revision ||
        current?.artifactDigest !== surface.artifactDigest
      )
        throw new Error(
          "Task source or planned screen changed during capture; retry from a stable preview",
        )
      outcome = "captured"
    } catch (cause) {
      png = undefined
      outcome = `unavailable: ${(cause as Error).message.replace(/\s+/g, " ").slice(0, 300)}`
    }
  }
  try {
    return ok(
      await recordScreen(
        ctx,
        task,
        {
          ...from,
          key,
          url: flags.url,
          ...options,
          height,
          outcome,
          artifactDigest: surface.artifactDigest,
          buildRevision: revision,
        },
        png,
      ),
    )
  } catch (cause) {
    return bad((cause as Error).message)
  }
}
