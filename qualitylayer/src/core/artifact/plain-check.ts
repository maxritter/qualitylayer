import { parse } from "parse5"
import { type Ctx, ok } from "../../ctx.ts"
import { packFolderPage } from "../../server/artifact-pack.ts"
import { checkArtifactSource } from "./check.ts"
import type { ArtifactSection } from "./format.ts"
import type { PackOmission } from "./pack.ts"
import type { ArtifactFile } from "./store.ts"
import { type TokenDrift, targetOf, tokenDrift } from "./token-drift.ts"
import { sourceRevision } from "./workspace.ts"

export const packingFindings = (omissions: PackOmission[]) =>
  omissions
    .filter((item) => item.kind !== "asset")
    .map((item) => ({
      rule: "packing-required-dependency",
      message: `${item.kind} ${item.reference} was omitted: ${item.reason}`,
    }))

type PageNode = {
  tagName?: string
  attrs?: { name: string; value: string }[]
  childNodes?: PageNode[]
}
/** Markup in these is text or inert: a script's template string is not a section of the page. */
const INERT = new Set(["script", "style", "template", "noscript"])

/**
 * The page's own sections: elements that carry both an `id` and a `data-screen-label`, in document
 * order. Only real elements count; markup inside a script, style or template (a model's sample
 * backdrop built by JavaScript) is text, not the page. Pass the rendered DOM for a page that builds
 * its sections at run time.
 */
export function pageSections(html: string): ArtifactSection[] {
  const sections: ArtifactSection[] = []
  const seen = new Set<string>()
  const walk = (node: PageNode) => {
    if (node.tagName !== undefined && INERT.has(node.tagName)) return
    const attr = (name: string) => node.attrs?.find((a) => a.name === name)?.value.trim() ?? ""
    const id = attr("id")
    const label = attr("data-screen-label")
    if (node.tagName !== undefined && id !== "" && label !== "" && !seen.has(id)) {
      seen.add(id)
      sections.push({ label, id })
    }
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(parse(html) as PageNode)
  return sections
}

/** The plain command and captured-source checks share packing, finding order and token policy. */
export async function plainArtifactCheck(
  ...[ctx, root, entry, name, lasting, flags]: [
    ctx: Ctx,
    root: string,
    entry: ArtifactFile,
    name: string,
    lasting: boolean,
    flags: Record<string, string | true>,
  ]
) {
  const packed = entry.folder
    ? await packFolderPage(entry.folder.dir, entry.path.split(/[\\/]/).at(-1) ?? "")
    : ok({ html: await ctx.fs.readFile(entry.path), omissions: [] as PackOmission[] })
  if (!packed.ok) return packed
  const checked = checkArtifactSource(packed.data.html)
  const tokens = await tokenDrift(ctx, targetOf(root, entry.path, entry.folder))
  const drift = await plainTokenFinding({ ctx, drift: tokens, entry, name, lasting, flags })
  const findings = [
    ...checked.findings,
    ...packingFindings(packed.data.omissions),
    ...(drift === null ? [] : [drift]),
  ]
  return ok({
    html: packed.data.html,
    packing: packed.data.omissions,
    tokenState: tokens.state,
    source: {
      ...checked,
      sections: pageSections(packed.data.html),
      valid: findings.length === 0,
      findings,
    },
  })
}

type TokenFindingInput = {
  ctx: Ctx
  drift: TokenDrift
  entry: ArtifactFile
  name: string
  lasting: boolean
  flags: Record<string, string | true>
}

/** A prior design-file value is drift; an artifact's independent choice remains its own. */
async function plainTokenFinding({
  ctx,
  drift,
  entry,
  name,
  lasting,
  flags,
}: TokenFindingInput): Promise<{ rule: string; message: string } | null> {
  if (drift.state !== "drifted") return null
  const names = [...new Set((drift.changed ?? []).map((change) => change.name))]
  const count = drift.count ?? names.length
  const listed = `${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}`
  const lead = `${count} design token${count === 1 ? " differs" : "s differ"} from the project's design file: ${listed}.`
  if (lasting)
    return {
      rule: "token-drift",
      message: `${lead} A lasting artifact changes through a task: update it in a task draft (qualitylayer artifact new <draft> --on ${name}); the draft starts with the design file's values.`,
    }
  const revision = sourceRevision(await ctx.fs.readFile(entry.path))
  const scope = `${flags.project === true ? " --project" : ""}${typeof flags.page === "string" ? ` --page ${flags.page}` : ""}`
  return {
    rule: "token-drift",
    message: `${lead} Run qualitylayer artifact tokens ${name}${scope} --refresh --if-match ${revision}.`,
  }
}
