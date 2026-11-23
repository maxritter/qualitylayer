import { basename } from "node:path"
import { type DefaultTreeAdapterMap, parse } from "parse5"
import { sessionIdentity } from "../../core/agents/detect.ts"
import { type ArtifactFile, type ArtifactHome, commentsHolder } from "../../core/artifact/store.ts"
import { addArtifactComment } from "../../core/gate/comments.ts"
import { heldIn } from "../../core/task/prompts.ts"
import { userMessages } from "../../core/task/session-proof.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

function isHiddenAttr(attr: { name: string; value: string }): boolean {
  if (attr.name === "hidden") return true
  if (attr.name === "aria-hidden") return attr.value === "true"
  return attr.name === "style" && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr.value)
}

function countVisibleSectionMatches(html: string, section: string): number {
  let matches = 0
  const visit = (node: DefaultTreeAdapterMap["node"], hidden = false) => {
    let isHidden = hidden
    if ("tagName" in node) {
      isHidden ||= node.attrs.some(isHiddenAttr)
      if (
        !isHidden &&
        node.attrs.some(
          (a) => (a.name === "id" || a.name === "data-screen-label") && a.value === section,
        )
      )
        matches++
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, isHidden)
  }
  visit(parse(html))
  return matches
}

function validateSection(
  html: string,
  section: string | true | undefined,
): Result<string | undefined> {
  if (section === undefined) return ok(undefined)
  if (typeof section !== "string" || !section.trim())
    return err({
      code: "bad_args",
      message: "--section needs an exact element id or section label",
    })
  if (countVisibleSectionMatches(html, section) !== 1)
    return err({
      code: "bad_args",
      message: `The requested section "${section}" is missing, hidden or ambiguous; no comment was added.`,
    })
  return ok(section)
}

async function hasQuotedUserMessage(ctx: Ctx, asked: string): Promise<boolean> {
  if (!asked) return false
  const identity = sessionIdentity(ctx.env)
  if (!identity) return false
  const said = (await userMessages(ctx, { agent: identity.agent, session: identity.id })) ?? []
  return said.some((m) => m !== null && heldIn(m.prompt, asked))
}

/** Typed feedback keeps the person's words and an exact, unique target. */
export async function addTypedArtifactComment(
  ctx: Ctx,
  home: ArtifactHome,
  entry: ArtifactFile,
  html: string,
  flags: Record<string, string | true>,
): Promise<Result<unknown>> {
  const asked = typeof flags.asked === "string" ? flags.asked.trim() : ""
  if (!(await hasQuotedUserMessage(ctx, asked)))
    return err({
      code: "bad_args",
      message:
        "Quote the person's comment with --asked, exactly as they typed it in one of their messages in this chat.",
    })
  const checkedSection = validateSection(html, flags.section)
  if (!checkedSection.ok) return checkedSection
  const section = checkedSection.data
  const page = entry.folder ? basename(entry.path) : undefined
  const location =
    section === undefined && page === undefined
      ? undefined
      : {
          x: 0,
          y: 0,
          ...(section === undefined ? {} : { section }),
          ...(page === undefined ? {} : { page }),
        }
  const comment = await addArtifactComment(
    ctx,
    commentsHolder(ctx, home),
    entry.file,
    asked,
    location,
  )
  return ok({ artifact: entry.name, file: entry.file, comment })
}
