import { buildRevision } from "../../core/gate/revision.ts"
import { forTask } from "../../core/handoff/pick-build.ts"
import type { EvidenceSource } from "../../core/review/screen-evidence.ts"
import {
  checkedScreenPng,
  recordScreen,
  type ScreenOutcome,
  screenSurfaces,
} from "../../core/review/screens.ts"
import type { Task } from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { findChrome, loopbackUrl, renderUrl, type UrlShotSpec } from "../../server/render.ts"
import { clickOptions } from "../../server/render-states.ts"
import {
  ADD_USAGE,
  addEvidenceCmd,
  captureSource,
  evidenceSource,
  unknownEvidenceOption,
} from "./evidence-capture.ts"
import { parseArgs, requireTask } from "./shared.ts"

const SHOT_USAGE =
  "usage: qualitylayer evidence shot <key> --url <loopback URL> --run <id> --mode scripted|real-session [--step A<n>] [--width <px>] [--height <px>] [--theme light|dark] [--wait-for <selector>] [--click <selector>]... [--crop <selector>]\nkey: use the Plan's named surface; a single-file task artifact artifacts/page.html#section uses page#section, keeping the section"

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

const bad = (message: string) => err({ code: "bad_args" as const, message })

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

type ParsedShot = {
  key: string
  url: string
  from: EvidenceSource
  theme: "light" | "dark"
  flags: Record<string, string | true>
}

function validateSelectorFlags(flags: Record<string, string | true>): string | null {
  for (const flag of ["wait-for", "crop", "click"]) {
    if (
      flags[flag] !== undefined &&
      (typeof flags[flag] !== "string" || String(flags[flag]).trim() === "")
    )
      return `--${flag} needs a selector`
  }
  return null
}

function validateShotFlags(flags: Record<string, string | true>): Result<"light" | "dark"> {
  const theme = flags.theme ?? "light"
  if (theme !== "light" && theme !== "dark") return bad("--theme must be light or dark")
  const badFlag = validateSelectorFlags(flags)
  return badFlag !== null ? bad(badFlag) : ok(theme)
}

function parseShotArgs(args: string[]): Result<ParsedShot> {
  const { positional, flags } = parseArgs(args, SHOT_OPTIONS)
  const [verb, key] = positional
  // Named before the usage: an option that is not known leaves its value among the words.
  const unknown = unknownEvidenceOption(flags, SHOT_OPTIONS, `${SHOT_USAGE}\n${ADD_USAGE}`)
  if (unknown !== null) return bad(unknown)
  if (verb !== "shot" || !key || positional.length !== 2 || typeof flags.url !== "string")
    return bad(`${SHOT_USAGE}\n${ADD_USAGE}`)
  try {
    loopbackUrl(flags.url)
  } catch (cause) {
    return bad((cause as Error).message)
  }
  const from = evidenceSource(flags)
  if (typeof from === "string") return bad(from)
  const checked = validateShotFlags(flags)
  return checked.ok ? ok({ key, url: flags.url, from, theme: checked.data, flags }) : checked
}

function buildShotOptions(
  args: string[],
  parsed: ParsedShot,
  defaultWidth: number,
): Result<{ options: UrlShotSpec; height: number }> {
  const { flags, theme } = parsed
  const width = flags.width === undefined ? defaultWidth : Number(flags.width)
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
  return ok({
    height,
    options: {
      width,
      ...(flags.height === undefined ? {} : { height }),
      theme,
      ...(typeof flags["wait-for"] === "string" ? { waitFor: flags["wait-for"] } : {}),
      ...(typeof flags.crop === "string" ? { crop: flags.crop } : {}),
      ...clickOptions(args),
    },
  })
}

async function captureSurfacePng(
  ctx: Ctx,
  task: Task,
  surface: { key: string; artifactDigest?: string },
  spec: { url: string; options: UrlShotSpec; revision: string },
): Promise<{ outcome: ScreenOutcome; png?: Uint8Array }> {
  const chrome = findChrome((name) => ctx.env.get(name))
  if (!chrome) return { outcome: "skipped: no browser" }
  try {
    const source = await captureSource(ctx, task)
    const png = await renderUrl(chrome, spec.url, spec.options)
    checkedScreenPng(png)
    const current = (await screenSurfaces(ctx, task)).find((row) => row.key === surface.key)
    if (
      (await captureSource(ctx, task)) !== source ||
      (await buildRevision(ctx, task)) !== spec.revision ||
      current?.artifactDigest !== surface.artifactDigest
    )
      throw new Error(
        "Task source or planned screen changed during capture; retry from a stable preview",
      )
    return { outcome: "captured", png }
  } catch (cause) {
    return {
      outcome: `unavailable: ${(cause as Error).message.replace(/\s+/g, " ").slice(0, 300)}`,
    }
  }
}

async function saveScreenRecord(
  ctx: Ctx,
  task: Task,
  parsed: ParsedShot,
  surface: { key: string; artifactDigest: string },
  spec: { options: UrlShotSpec; height: number },
): Promise<Result<unknown>> {
  const revision = await buildRevision(ctx, task)
  const { outcome, png } = await captureSurfacePng(ctx, task, surface, {
    url: parsed.url,
    options: spec.options,
    revision,
  })
  try {
    return ok(
      await recordScreen(
        ctx,
        task,
        {
          ...parsed.from,
          key: parsed.key,
          url: parsed.url,
          ...spec.options,
          height: spec.height,
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

async function runShot(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const parsed = parseShotArgs(args)
  if (!parsed.ok) return parsed
  const found = await requireTask(ctx)
  if (!found.ok) return found
  const task = found.data
  const surface = (await screenSurfaces(ctx, task)).find((row) => row.key === parsed.data.key)
  if (!surface)
    return bad(
      `No planned screen surface named ${parsed.data.key}. For artifacts/page.html#section, use page#section. For a separate capture, use qualitylayer evidence add.`,
    )
  const spec = buildShotOptions(args, parsed.data, surface.width)
  if (!spec.ok) return spec
  return saveScreenRecord(ctx, task, parsed.data, surface, spec.data)
}

export async function evidenceCmd(given: Ctx, called: string[]): Promise<Result<unknown>> {
  const named = namedTask(given, called)
  if ("error" in named) return bad(named.error)
  const { ctx, args } = named
  if (args[0] === "add") return addEvidenceCmd(ctx, args)
  return runShot(ctx, args)
}
