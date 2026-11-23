// A draft the task already made, recorded as a draft on a lasting artifact: "Add as a page of <artifact>",
// and the draft of an artifact just kept. Nothing is copied. A folder draft says it in its `artifact.json`
// (`draftOn: { artifact, project, page? }`, no base: every page is compared with the artifact as it is), a
// single page with `<meta name="ql:draft-on" content="<artifact>/<page>">`, the page it will be called in
// the artifact. The fold at Review does the rest.

import { lstat, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ok, type Result } from "../../ctx.ts"
import {
  ARTIFACT_NAME,
  ARTIFACT_PAGE_NAME,
  type DraftOn,
  LASTING_CONFIG,
  LASTING_CONFIG_MAX_BYTES,
  TASK_ARTIFACTS,
  withMeta,
} from "./format.ts"
import { fileBlobId, readLasting } from "./lasting.ts"
import { bad, listFiles, readDraft, type WriteTask } from "./lasting-write.ts"

export type AdoptInput = {
  /** The task's draft by name. */
  draft: string
  artifact: string
  /** A single page: the name it takes in the artifact. A folder: the one page of it to fold in. */
  page?: string
}

const pageName = (page: string): string => (page.endsWith(".html") ? page : `${page}.html`)

type AdoptOutcome = { draft: string; file: string; draftOn: DraftOn; copied: string[] }

async function adoptSinglePageDraft(
  draft: { name: string; dir: string; pages: { file: string }[] },
  artifact: string,
  asked: string | undefined,
): Promise<Result<AdoptOutcome>> {
  // One page: the meta tag names the page it becomes in the artifact.
  const target = asked ?? `${draft.name}.html`
  if (!ARTIFACT_PAGE_NAME.test(target))
    return bad(`"${target}" is not a page name: give the page a name`)
  const file = draft.pages[0]?.file as string
  const path = join(draft.dir, file)
  await writeFile(
    path,
    withMeta(await readFile(path, "utf8"), "ql:draft-on", `${artifact}/${target}`),
  )
  return ok({
    draft: draft.name,
    file: `${TASK_ARTIFACTS}/${file}`,
    draftOn: { artifact, page: target },
    copied: [],
  })
}

async function readExistingDraftConfig(
  configPath: string,
  draftName: string,
): Promise<Result<Record<string, unknown>>> {
  const seen = await lstat(configPath).catch(() => null)
  if (seen === null) return ok({})
  if (!seen.isFile() || seen.size > LASTING_CONFIG_MAX_BYTES)
    return bad(`artifacts/${draftName}/${LASTING_CONFIG} cannot be changed`)
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error()
    return ok(parsed as Record<string, unknown>)
  } catch {
    return bad(`artifacts/${draftName}/${LASTING_CONFIG} does not read as JSON`)
  }
}

async function collectUnchangedBase(
  draftDir: string,
  lastingDir: string,
): Promise<Record<string, string>> {
  // A file the artifact already has, byte for byte, is where the draft begins: it is no change until the
  // draft edits it (a draft just kept is identical to what it became). The others are new.
  const base: Record<string, string> = {}
  const files = await listFiles(draftDir)
  if (!files.ok) return base
  for (const rel of files.data) {
    if (rel === LASTING_CONFIG) continue
    const mine = await fileBlobId(join(draftDir, rel))
    if (mine !== null && mine === (await fileBlobId(join(lastingDir, rel)))) base[rel] = mine
  }
  return base
}

async function adoptFolderDraft(
  task: Pick<WriteTask, "dir" | "repoRoot" | "repoId">,
  draft: { name: string; dir: string; config: string; pages: { file: string }[] },
  lastingDir: string,
  artifact: string,
  asked: string | undefined,
): Promise<Result<AdoptOutcome>> {
  if (asked !== undefined && !draft.pages.some((p) => p.file === asked))
    return bad(`${draft.name} has no page ${asked}`)
  const raw = await readExistingDraftConfig(draft.config, draft.name)
  if (!raw.ok) return raw
  const base = await collectUnchangedBase(draft.dir, lastingDir)
  const draftOn: DraftOn = {
    artifact,
    project: task.repoId,
    ...(asked !== undefined ? { page: asked } : {}),
    ...(Object.keys(base).length > 0 ? { base } : {}),
  }
  await writeFile(draft.config, `${JSON.stringify({ v: 1, ...raw.data, draftOn }, null, 2)}\n`)
  return ok({
    draft: draft.name,
    file: `${TASK_ARTIFACTS}/${draft.name}/${draft.pages[0]?.file}`,
    draftOn,
    copied: [],
  })
}

async function validateAdoptInputs(
  task: Pick<WriteTask, "dir" | "repoRoot" | "repoId">,
  input: AdoptInput,
) {
  if (!ARTIFACT_NAME.test(input.artifact)) return bad(`"${input.artifact}" is not an artifact name`)
  const draft = await readDraft(task, input.draft)
  if (!draft.ok) return draft
  if (draft.data.draftOn !== null)
    return bad(`${input.draft} already drafts on ${draft.data.draftOn.artifact}`)
  const lasting = await readLasting(task.repoRoot, input.artifact)
  if (!lasting.ok) return bad(`${input.artifact}: ${lasting.error.message}`)
  return ok({ draft: draft.data, lasting: lasting.data })
}

export async function adoptDraft(
  task: Pick<WriteTask, "dir" | "repoRoot" | "repoId">,
  input: AdoptInput,
): Promise<Result<AdoptOutcome>> {
  const asked = input.page === undefined ? undefined : pageName(input.page)
  if (asked !== undefined && !ARTIFACT_PAGE_NAME.test(asked))
    return bad(
      `"${input.page}" is not a page name (letters, digits, dots and dashes, ending in .html)`,
    )
  const validated = await validateAdoptInputs(task, input)
  if (!validated.ok) return validated
  const { draft, lasting } = validated.data
  if (draft.config === null) return adoptSinglePageDraft(draft, input.artifact, asked)
  return adoptFolderDraft(
    task,
    { ...draft, config: draft.config },
    lasting.dir,
    input.artifact,
    asked,
  )
}
