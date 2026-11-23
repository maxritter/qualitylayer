// The App's side of artifacts: a task's and a project's artifacts as the Artifacts tab lists them, one
// artifact's page for the sandboxed frame (with the policy and the bridge put in here, on the server),
// its thumbnail, comments on a spot of it, and Open in browser. An artifact is read only from the folder
// that holds artifacts: a name that climbs out, or a file of any other kind, is refused.

import { ARTIFACT_PAGE_NAME, type ArtifactAnchor } from "../core/artifact/format.ts"
import { commentsHolder } from "../core/artifact/store.ts"
import {
  addArtifactComment,
  type Comment,
  readComments,
  resolveArtifactComment,
} from "../core/gate/comments.ts"
import { resolveThread } from "../core/interaction-docs/threads.ts"
import { startAnswering } from "../core/review/answers.ts"
import { isArchived } from "../core/task/archive.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { locate } from "./api.ts"
import { locateArtifact } from "./artifacts-locate.ts"
import { type Opener, openableArtifact, openFile } from "./open-file.ts"

export {
  findProject,
  projectArtifacts,
  projectHomes,
  projectList,
  type TaskArtifacts,
  taskArtifacts,
  taskHome,
  thumbOf,
} from "./artifacts-list.ts"
export { artifactPage, type Located, locateArtifact } from "./artifacts-locate.ts"
export {
  artifactThumb,
  artifactWorkspaceRead,
  artifactWorkspaceWrite,
} from "./artifacts-workspace.ts"

export const spotOf = (value: unknown): ArtifactAnchor | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { x, y, section, page } = value as Record<string, unknown>
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))
    return undefined
  if (x < 0 || y < 0 || x > 100_000 || y > 1_000_000) return undefined
  return {
    x: Math.round(x),
    y: Math.round(y),
    ...(typeof section === "string" && section.trim() !== ""
      ? { section: section.trim().slice(0, 200) }
      : {}),
    ...(typeof page === "string" && ARTIFACT_PAGE_NAME.test(page) ? { page } : {}),
  }
}

function validateCommentBody(
  body: Record<string, unknown>,
): Result<{ remark: string; spot: ArtifactAnchor | undefined }> {
  const remark = typeof body.remark === "string" ? body.remark.trim() : ""
  if (remark === "") return err({ code: "bad_args", message: "a comment needs words" })
  if (remark.length > 8000) {
    return err({
      code: "bad_args",
      message: "Shorten the comment to 8000 characters; your words have not been saved.",
    })
  }
  const spot = body.spot === undefined ? undefined : spotOf(body.spot)
  if (body.spot !== undefined && spot === undefined) {
    return err({
      code: "bad_args",
      message: "This pin has invalid coordinates. Pick the spot again.",
    })
  }
  return ok({ remark, spot })
}

async function ensureTaskCommentable(ctx: Ctx, id: string): Promise<Result<true>> {
  const task = await locate(ctx, id)
  if (!task.ok) return task
  if (await isArchived(ctx, task.data.task)) {
    return err({
      code: "bad_args",
      message: "Restore this task before commenting on its artifacts.",
    })
  }
  if (["shipped", "abandoned"].includes(task.data.task.stage)) {
    return err({
      code: "bad_args",
      message: "This task is closed; its artifact comments are kept.",
    })
  }
  return ok(true)
}

/** A comment on an artifact: on a spot of it, or on the page. It goes to the agent at once. */
export async function postArtifactComment(
  ctx: Ctx,
  scope: "task" | "project",
  id: string,
  file: string,
  body: Record<string, unknown>,
): Promise<Result<{ comment: Comment }>> {
  if (scope === "project") {
    return err({
      code: "bad_args",
      message: "Standalone artifact feedback is retired; its history is read-only.",
    })
  }
  const parsed = validateCommentBody(body)
  if (!parsed.ok) return parsed
  const open = await ensureTaskCommentable(ctx, id)
  if (!open.ok) return open
  const found = await locateArtifact(ctx, scope, id, file)
  if (!found.ok) return found
  const comment = await addArtifactComment(
    ctx,
    commentsHolder(ctx, found.data.home),
    file,
    parsed.data.remark,
    parsed.data.spot,
  )
  // The backstop: a comment the artifact's agent does not read in time goes to a helper.
  const task = await locate(ctx, id)
  if (task.ok) await startAnswering(ctx, task.data.task).catch(() => {})
  return ok({ comment })
}

/** The person resolved a comment on an artifact. */
export async function resolveArtifact(
  ctx: Ctx,
  scope: "task" | "project",
  id: string,
  file: string,
  body: Record<string, unknown>,
): Promise<Result<Record<string, never>>> {
  if (scope === "project") {
    return err({
      code: "bad_args",
      message: "Standalone artifact feedback is retired; its history is read-only.",
    })
  }
  const task = await locate(ctx, id)
  if (!task.ok) return task
  if (await isArchived(ctx, task.data.task)) {
    return err({
      code: "bad_args",
      message: "Restore this task before resolving artifact comments.",
    })
  }
  const found = await locateArtifact(ctx, scope, id, file)
  if (!found.ok) return found
  const holder = commentsHolder(ctx, found.data.home)
  const comment = (await readComments(ctx, holder)).find((c) => c.id === body.id && c.doc === file)
  const done = comment !== undefined && (await resolveArtifactComment(ctx, holder, comment.id))
  if (done && comment) await resolveThread(ctx, holder, comment.thread?.id ?? comment.id)
  return done ? ok({}) : err({ code: "bad_args", message: "no such comment on this artifact" })
}

/** Open in browser, or show the file in its folder: the system's opener, on the artifact's own file. */
export type ArtifactBrowser = (
  scope: "task" | "project",
  id: string,
  file: string,
  section?: string,
) => Promise<Result<Record<string, never>>>

function openInViewer(
  scope: "task" | "project",
  id: string,
  file: string,
  body: Record<string, unknown>,
  browser?: ArtifactBrowser,
): Promise<Result<Record<string, never>>> {
  if (!browser) {
    return Promise.resolve(
      err({
        code: "bad_args",
        message: "The artifact viewer could not be opened in a browser",
      }),
    )
  }
  if (body.section !== undefined && typeof body.section !== "string")
    return Promise.resolve(err({ code: "bad_args", message: "section needs an exact id or label" }))
  return browser(scope, id, file, body.section as string | undefined)
}

export async function openArtifact(
  ...args: [
    ctx: Ctx,
    scope: "task" | "project",
    id: string,
    file: string,
    body: Record<string, unknown>,
    opener: Opener,
    browser?: ArtifactBrowser,
  ]
): Promise<Result<Record<string, never>>> {
  const [ctx, scope, id, file, body, opener, browser] = args
  const found = await locateArtifact(ctx, scope, id, file)
  if (!found.ok) return found
  const path = await openableArtifact(found.data.folder, found.data.path, body.how)
  if (!path.ok) return path
  if (body.how === "browser" && body.viewer === true)
    return openInViewer(scope, id, file, body, browser)
  return openFile(path.data.how, path.data.path, opener.platform, opener.run)
}
