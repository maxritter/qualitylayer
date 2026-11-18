// `artifact review <name> [--page <page>] [--request "<words>"]` and `--done --report <file>`: the same
// fresh check the Plan step hands out, for an artifact outside a task. It prints the brief for the
// calling agent's fresh subagent, records where the report goes beside the artifact's QualityLayer
// state, is idempotent per artifact revision and follows Settings › Workflow › Reviews › Design review.

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { phaseText } from "#workflow"
import { artifactCmd } from "../../src/cli/commands/artifact.ts"
import { projectArtifactsRuntime } from "../../src/core/artifact/store.ts"
import { writeConfig } from "../../src/core/config.ts"
import { page, type World, world } from "../helpers/lastingWorld.ts"

let fixture: World
beforeAll(async () => {
  fixture = await world({ offlineTrial: true })
})
afterEach(async () => {
  await writeConfig(fixture.ctxAt(fixture.root), { designReview: "designs" })
})
afterAll(async () => {
  await fixture?.cleanup()
})

type Repo = Awaited<ReturnType<World["repo"]>>

async function run(repo: Repo, ...args: string[]) {
  const result = await artifactCmd(repo.ctx, args)
  if (!result.ok) throw new Error(result.error.message)
  // biome-ignore lint/suspicious/noExplicitAny: the tests read loosely shaped command output
  return result.data as Record<string, any>
}

const refused = async (repo: Repo, ...args: string[]) => {
  const result = await artifactCmd(repo.ctx, args)
  if (result.ok) throw new Error("expected a refusal")
  return result.error.message
}

/** A repository with a finished project artifact `landing` that says what it is for. */
async function withLanding(name: string) {
  const repo = await fixture.repo(name)
  await run(repo, "new", "landing", "--purpose", "A landing page with three plans")
  return repo
}

const REPORT = `Result: needs work

1. Blocker · The phone layout, light: the plan cards overflow at 390. Stack them.
2. Quality · The empty state is not drawn. Draw it.

Not checked: the keyboard path.
`

test("the brief is the fresh-check text with the four pictures and the artifact's purpose as the acceptance point", async () => {
  const repo = await withLanding("review-brief")
  const handed = await run(repo, "review", "landing")
  expect(handed.status).toBe("handed")
  expect(handed.artifact).toBe("landing")
  const brief = await readFile(handed.brief_file, "utf8")
  expect(brief).toContain(phaseText("artifact-check") ?? "missing")
  expect(brief).toContain("A landing page with three plans")
  const commands = brief
    .split("\n")
    .filter((line) => line.startsWith("- `qualitylayer artifact shot"))
  expect(commands).toHaveLength(4)
  for (const [index, picture] of [
    "1280 --theme light",
    "1280 --theme dark",
    "390 --theme light",
    "390 --theme dark",
  ].entries())
    expect(commands[index]).toContain(`artifact shot landing --width ${picture}`)
  expect(brief).toContain(repo.dir)
  const runtime = projectArtifactsRuntime(repo.ctx, repo.ref.id)
  expect(handed.report.startsWith(runtime)).toBe(true)
  expect(handed.effort).toBe("high")
  expect(handed.message).toContain("at high effort")
})

test("standalone design review uses the configured model and keeps the This session choice", async () => {
  const repo = await withLanding("review-staffing")
  const previousEnv = repo.ctx.env
  repo.ctx.env = {
    ...previousEnv,
    get: (name) =>
      name === "CLAUDE_CODE_SESSION_ID" ? "artifact-review-test" : previousEnv.get(name),
  }
  try {
    await writeConfig(repo.ctx, { models: { "claude-code": { design: "sonnet" } } })
    const handed = await run(repo, "review", "landing")
    expect(handed).toMatchObject({ status: "handed", model: "sonnet", effort: "high" })

    await run(repo, "new", "solo", "--purpose", "A summary reader")
    await writeConfig(repo.ctx, { models: { "claude-code": { helpers: "session" } } })
    const own = await run(repo, "review", "solo")
    expect(own.status).toBe("handed")
    expect(own.model).toBeUndefined()
    expect(own.effort).toBeUndefined()
    expect(own.message).toContain("Review solo in this session")
  } finally {
    await writeConfig(repo.ctx, {
      models: { "claude-code": { helpers: "sonnet", design: "opus" } },
    })
  }
})

test("the person's request replaces the purpose as the acceptance points", async () => {
  const repo = await withLanding("review-request")
  const handed = await run(
    repo,
    "review",
    "landing",
    "--request",
    "People can compare the plans side by side",
  )
  const brief = await readFile(handed.brief_file, "utf8")
  expect(brief).toContain("People can compare the plans side by side")
  expect(brief).not.toContain("A landing page with three plans")
})

test("a page drawn for a width is looked at at that width and at 390", async () => {
  const repo = await fixture.repo("review-width")
  await run(repo, "new", "wide", "--purpose", "A dashboard")
  const file = join(repo.dir, "docs/artifacts/wide.html")
  const html = await readFile(file, "utf8")
  await writeFile(
    file,
    html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="viewport" content="width=1440">',
    ),
  )
  const handed = await run(repo, "review", "wide")
  const brief = await readFile(handed.brief_file, "utf8")
  expect(brief).toContain("artifact shot wide --width 1440 --theme light")
  expect(brief).toContain("artifact shot wide --width 390 --theme dark")
  expect(brief).not.toContain("--width 1280")
})

test("a second call on the same revision says it was reviewed and where the report is; a changed revision is reviewed again", async () => {
  const repo = await withLanding("review-idempotent")
  const first = await run(repo, "review", "landing")
  expect(first.status).toBe("handed")
  const again = await run(repo, "review", "landing")
  expect(again.status).toBe("already-reviewed")
  expect(again.report).toBe(first.report)
  expect(again.revision).toBe(first.revision)
  expect(again.brief_file).toBeUndefined()
  expect(again.message).toContain(first.report)

  const file = join(repo.dir, "docs/artifacts/landing.html")
  await writeFile(file, `${await readFile(file, "utf8")}<!-- fixed -->\n`)
  const changed = await run(repo, "review", "landing")
  expect(changed.status).toBe("handed")
  expect(changed.revision).not.toBe(first.revision)
})

test("--done --report records the finished report and a later call finds it", async () => {
  const repo = await withLanding("review-done")
  const handed = await run(repo, "review", "landing")
  const finished = join(repo.dir, "..", "review-done-report.md")
  await writeFile(finished, REPORT)
  const done = await run(repo, "review", "landing", "--done", "--report", finished)
  expect(done.status).toBe("recorded")
  expect(done.report).toBe(handed.report)
  expect(done.findings).toBe(2)
  expect(done.result).toBe("needs work")
  expect(await readFile(handed.report, "utf8")).toBe(REPORT)
  const again = await run(repo, "review", "landing")
  expect(again.status).toBe("already-reviewed")
  expect(again.reported).toBe(true)
  expect(again.message).toContain(handed.report)
})

test("--done needs a review that was handed out and a report that reads", async () => {
  const repo = await withLanding("review-done-refused")
  const finished = join(repo.dir, "..", "review-done-refused-report.md")
  await writeFile(finished, REPORT)
  expect(await refused(repo, "review", "landing", "--done", "--report", finished)).toContain(
    "no review was handed out",
  )
  await run(repo, "review", "landing")
  expect(await refused(repo, "review", "landing", "--done")).toContain("--report")
  expect(
    await refused(repo, "review", "landing", "--done", "--report", join(repo.dir, "missing.md")),
  ).toContain("missing.md")
  const empty = join(repo.dir, "..", "review-done-refused-empty.md")
  await writeFile(empty, "\n")
  expect(await refused(repo, "review", "landing", "--done", "--report", empty)).toContain("empty")
})

test("a report recorded after the page was fixed still belongs to the revision that was reviewed", async () => {
  const repo = await withLanding("review-fixed-first")
  const handed = await run(repo, "review", "landing")
  const file = join(repo.dir, "docs/artifacts/landing.html")
  await writeFile(file, `${await readFile(file, "utf8")}<!-- fixed -->\n`)
  const finished = join(repo.dir, "..", "review-fixed-first-report.md")
  await writeFile(finished, REPORT)
  const done = await run(repo, "review", "landing", "--done", "--report", finished)
  expect(done.revision).toBe(handed.revision)
})

test("with design review off it hands out nothing and says so", async () => {
  const repo = await withLanding("review-off")
  await writeConfig(repo.ctx, { designReview: "off" })
  const reply = await run(repo, "review", "landing")
  expect(reply.status).toBe("off")
  expect(reply.brief_file).toBeUndefined()
  expect(reply.message).toContain("Design review is off")
  const finished = join(repo.dir, "..", "review-off-report.md")
  await writeFile(finished, REPORT)
  expect(await refused(repo, "review", "landing", "--done", "--report", finished)).toContain(
    "no review was handed out",
  )
  await writeConfig(repo.ctx, { designReview: "designs" })
  const handed = await run(repo, "review", "landing")
  expect(handed.status).toBe("handed")
  // A review already handed out can still be recorded after the person turns the setting off.
  await writeConfig(repo.ctx, { designReview: "off" })
  expect((await run(repo, "review", "landing", "--done", "--report", finished)).status).toBe(
    "recorded",
  )
})

test("a wireframe is not reviewed", async () => {
  const repo = await fixture.repo("review-wireframe")
  await run(repo, "new", "sketch", "--wire")
  const reply = await run(repo, "review", "sketch")
  expect(reply.status).toBe("wireframe")
  expect(reply.brief_file).toBeUndefined()
  expect(reply.message).toContain("wireframes are not reviewed")
})

test("a page of a folder artifact is reviewed with --page, and a change in the folder is a new revision", async () => {
  const repo = await fixture.repo("review-folder")
  await run(repo, "new", "gallery", "--folder", "--purpose", "Browse the gallery")
  await repo.write({ "docs/artifacts/gallery/detail.html": page("Detail") })
  const handed = await run(repo, "review", "gallery", "--page", "detail")
  expect(handed.page).toBe("detail.html")
  const brief = await readFile(handed.brief_file, "utf8")
  expect(brief).toContain("artifact shot gallery --page detail --width 1280 --theme light")
  expect(brief).toContain("page `detail` of the artifact `gallery`")
  expect((await run(repo, "review", "gallery", "--page", "detail")).status).toBe("already-reviewed")
  // The entry page has its own record.
  expect((await run(repo, "review", "gallery")).status).toBe("handed")
  await repo.write({ "docs/artifacts/gallery/style.css": "body { color: red }\n" })
  expect((await run(repo, "review", "gallery", "--page", "detail")).status).toBe("handed")
  expect(await refused(repo, "review", "gallery", "--page", "nothing")).toContain("no page")
})

test("an unknown artifact and a malformed call are refused with their usage", async () => {
  const repo = await withLanding("review-usage")
  expect(await refused(repo, "review", "missing")).toContain('no artifact "missing"')
  expect(await refused(repo, "review", "landing", "--render")).toContain("usage:")
  expect(await refused(repo, "review", "landing", "extra")).toContain("usage:")
  expect(await refused(repo, "review", "landing", "--report", "x.md")).toContain("--done")
  expect(await refused(repo, "review", "landing", "--done", "--request", "words")).toContain(
    "usage:",
  )
})
