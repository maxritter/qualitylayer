// A new artifact that is a folder: `artifacts/<name>/index.html` in a task, `docs/artifacts/<name>/index.html`
// in a project. The first page starts from the same template as a single page; more pages, scripts
// (JSX included), styles, fonts and pictures are added beside it by the agent.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import {
  ARTIFACT_NAME,
  fillArtifact,
  PROJECT_ARTIFACTS,
  TASK_ARTIFACTS,
  titleOfName,
} from "./format.ts"
import { type ArtifactFile, type ArtifactHome, artifactFolder } from "./store.ts"
import { type ProductTokens, withTokens } from "./tokens.ts"

export async function createFolderArtifact(
  ...[ctx, home, name, template, purpose, product = null]: [
    ctx: Ctx,
    home: ArtifactHome,
    name: string,
    template: string,
    purpose: string,
    product?: ProductTokens | null,
  ]
): Promise<Result<ArtifactFile>> {
  const base = name.replace(/\.html$/, "")
  if (!ARTIFACT_NAME.test(base))
    return err({
      code: "bad_args",
      message: "artifact names are lower-case letters, digits and dashes",
    })
  const relative = home.scope === "task" ? TASK_ARTIFACTS : PROJECT_ARTIFACTS
  const folder = join(artifactFolder(home), base)
  if ((await ctx.fs.exists(folder)) || (await ctx.fs.exists(`${folder}.html`)))
    return err({
      code: "bad_args",
      message: `${relative}/${base} already exists: change it, then run qualitylayer artifact show ${base}`,
    })
  await ctx.fs.mkdir(folder)
  const path = join(folder, "index.html")
  await ctx.fs.writeFile(
    path,
    fillArtifact(withTokens(template, product), titleOfName(base), purpose),
  )
  return ok({
    file: `${relative}/${base}/index.html`,
    name: base,
    path,
    showMe: false,
    folder: { dir: folder, pages: ["index.html"] },
  })
}
