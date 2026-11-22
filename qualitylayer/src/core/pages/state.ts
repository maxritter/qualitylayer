// What a task's document sections are drawn from, read once: the documents and logs, the
// questions answered in the App, the answers stored as comments, the gate decisions, the
// attestations and the build's records. render.ts turns it into Markdown.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { proofOf } from "../acceptance.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { artifactReferenceSource } from "../artifact/reference-source.ts"
import { readAttestations } from "../attestations.ts"
import { decisionsOf, implementAgentsPath, parseNotes, readBuildRecord } from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { parseMarkers } from "../docs/markers.ts"
import { folderDoc } from "../docs/names.ts"
import { dependenciesOf, type Outline } from "../docs/outline.ts"
import { doneMeansOf } from "../done-means.ts"
import { withoutExemptNotes } from "../exempt-notes.ts"
import { type Comment, readComments } from "../gate/comments.ts"
import { readDecided } from "../gate/decided.ts"
import { scopeWalkthrough, workflowChanges } from "../git/workflow-changes.ts"
import { readLimits } from "../limits.ts"
import { currentPlanAsset } from "../plan-assets.ts"
import { parseQualityPass, readQualityLog } from "../polish.ts"
import { roundVerdicts as verdictsOfRound } from "../recheck.ts"
import { requiredLimits } from "../required-lines.ts"
import { isPersonMode } from "../review/in-review.ts"
import { readWalkthrough } from "../review/walkthrough.ts"
import { withPointVerdicts } from "../said.ts"
import { storedUrl } from "../ship/pull-request.ts"
import { findingAnswers } from "../small-findings.ts"
import { planningQuestionAnswers } from "../task/planning-answers.ts"
import { readmeFrontmatter, type Task, taskDocPath } from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import { checkedWithoutIndependentJudge } from "../verification.ts"
import { planReviews } from "./plan-reviews.ts"
import { decidedByYou } from "./plan-state.ts"
import { stepRecords } from "./records.ts"
import {
  type Answered,
  decidedRows,
  evidenceRows,
  firstSentence,
  type PageState,
  type ProofRow,
  type SliceRow,
  when,
} from "./render.ts"
import { yourCallsOf } from "./your-calls.ts"

const IMAGE = /\.(png|jpe?g|webp|gif)$/i

const read = async (ctx: Ctx, path: string) =>
  (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""

const plain = (text: string) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()

/** A recorded line as a sentence: its first letter up, a full stop at its end, its paths out. */
const sentence = (text: string) => {
  const summary = text.replace(/ ?\(`(?:evidence|records)\/[^`\n]+`\)/g, "")
  const bare = plain(summary.replace(/(?<!\s)\s*(?:[—–-]\s*)?`(?:evidence|records)\/[^`]+`/g, ""))
  if (bare === "") return ""
  const upper = bare.charAt(0).toUpperCase() + bare.slice(1)
  return /[.!?]$/.test(upper) ? upper : `${upper}.`
}

/** The latest answer stored for one of these items. */
function answerTo(comments: readonly Comment[], ids: readonly string[]): Answered | undefined {
  const last = [...comments]
    .reverse()
    .find((c) => c.item !== undefined && ids.includes(c.item) && c.kind !== undefined)
  if (last?.kind === undefined) return undefined
  return {
    kind: last.kind,
    at: last.created,
    ...(last.remark.trim() !== "" ? { note: last.remark.trim() } : {}),
  }
}

/** An artifact's display name and purpose, from its `<title>` and description. */
async function artifactOf(ctx: Ctx, task: Task, name: string) {
  const reference = parseArtifactReference(name)
  if (!reference) return null
  const source =
    reference.scope === "project"
      ? await artifactReferenceSource(
          ctx,
          { taskDir: task.dir, repoRoot: task.repoRoot },
          reference,
          { pack: false },
        ).catch(() => null)
      : await read(ctx, join(task.dir, reference.file)).then((html) => ({ html }))
  if (!source?.html) return null
  const html = source.html
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? name
  const purpose =
    html.match(/<meta\s+name=["']description["']\s+content=(["'])(.*?)\1/i)?.[2]?.trim() ?? ""
  // A two-file Plan's picture of this exact source revision, when `plan draft` captured one.
  const picture = await currentPlanAsset(ctx, task, name).catch(() => null)
  return {
    title: title === "" ? name : title,
    purpose,
    ...(picture !== null ? { picture: { file: picture.file, state: picture.state } } : {}),
  }
}

/** Where each slice stands: done, the task the build is on, next, or the slices it waits for. */
function sliceRows(task: Task, outline: Outline | null): SliceRow[] {
  if (outline === null) return []
  const building = ["implement", "verify", "shipped"].includes(task.stage)
  const done = (n: number) => {
    const slice = outline.slices.find((s) => s.n === n)
    return slice !== undefined && slice.tasks.length > 0 && slice.tasks.every((t) => t.checked)
  }
  let nextGiven = false
  return outline.slices.map((slice) => {
    const total = slice.tasks.length
    const checked = slice.tasks.filter((t) => t.checked).length
    const waiting = dependenciesOf(outline, slice).filter((n) => !done(n))
    let now: string
    if (total > 0 && checked === total) now = "done"
    else if (!building) now = "planned"
    else if (checked > 0) now = `task ${checked + 1} of ${total}`
    else if (waiting.length > 0) now = `after ${waiting.join(", ")}`
    else if (!nextGiven) {
      now = "next"
      nextGiven = true
    } else now = "next"
    return {
      n: slice.n,
      title: slice.title,
      plain: firstSentence(slice.summary),
      tasks: total,
      checked,
      now,
    }
  })
}

/**
 * Everything the sections of a task's documents draw from. `review`: the person's review is being
 * written (the final approval saves it), whatever Verify's mode says.
 */
export async function pageState(
  ctx: Ctx,
  task: Task,
  options: { review?: true } = {},
): Promise<PageState> {
  const [comments, decided, answered, flowed, record, attestations, fm, verifyMode] =
    await Promise.all([
      readComments(ctx, task),
      readDecided(ctx, task),
      planningQuestionAnswers(ctx, task),
      taskFlow(ctx, task),
      readBuildRecord(ctx, task),
      readAttestations(ctx, task),
      readmeFrontmatter(ctx, task),
      readVerifyMode(ctx, task),
    ])
  const outline = flowed.plan
  const reviewing = options.review === true || (task.stage === "verify" && isPersonMode(verifyMode))
  const asked = decidedRows(answered)
  const done = await doneMeansOf(ctx, task)
  const plan = parseDoc(await read(ctx, taskDocPath(task, "plan"))).body

  // The artifacts and decisions the Plan names with its markers.
  const artifacts: PageState["artifacts"] = {}
  const decides: PageState["decides"] = {}
  for (const marker of parseMarkers(plan).markers) {
    const name = marker.args[0]
    if (name === undefined) continue
    if (marker.name === "artifact") artifacts[name] = await artifactOf(ctx, task, name)
    if (marker.name === "decide") decides[name] = answerTo(comments, [`plan:decision:${name}`])
  }
  const yourCalls = Object.keys(yourCallsOf(plan))

  const planTarget = folderDoc("plan")
  const planDecision = [...decided].reverse().find((d) => d.target === planTarget)
  const planDoc = parseDoc(await read(ctx, taskDocPath(task, "plan"))).frontmatter ?? {}
  const approval: PageState["approval"] =
    planDecision?.decision === "approved" || planDoc.approved === true
      ? { state: "approved", ...(planDecision !== undefined ? { at: planDecision.at } : {}) }
      : planDecision?.decision === "changes"
        ? { state: "changes", at: planDecision.at }
        : { state: "waiting" }

  // The build's own decisions, each with its slice.
  const sliceOf = (id: string | null) =>
    id === null ? null : (outline?.slices.find((s) => s.tasks.some((t) => t.id === id))?.n ?? null)
  const decisions = decisionsOf(parseNotes(await read(ctx, implementAgentsPath(task)))).map(
    ({ note, replaced }) => ({
      slice: sliceOf(note.task),
      text: sentence(note.text),
      ...(replaced.length > 0 ? { replaced: replaced.map((n) => sentence(n.text)) } : {}),
    }),
  )

  // The last round: what it found for the build session to answer, what it left failing, and the
  // proof of each point.
  const last = record.verification.at(-1)
  const attested = new Map(attestations.map((a) => [a.item, a]))
  const findings: PageState["findings"] = []
  const seen = new Set<string>()
  const kept = await findingAnswers(ctx, task)
  for (const verdict of await withoutExemptNotes(ctx, task, last?.verdicts ?? [])) {
    if (verdict.verdict !== "NOTE" || seen.has(verdict.text)) continue
    seen.add(verdict.text)
    const written = kept(verdict)
    findings.push({
      text: sentence(verdict.text),
      ...(written !== undefined
        ? { answer: { kind: written.stance, at: written.at, note: written.text } }
        : {}),
    })
  }
  const fixNeeds: PageState["fixNeeds"] =
    last === undefined
      ? undefined
      : last.verdicts
          .filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING")
          .map((v) => ({ kind: v.kind, subject: v.subject, text: sentence(v.text) }))

  const pictures = new Map((last?.pictures ?? []).map((p) => [p.file, p.caption]))
  // A points Plan proves a Done means point from its steps: the round's lines carry that result.
  const roundVerdicts = withPointVerdicts(
    await proofOf(ctx, task),
    last === undefined ? [] : await verdictsOfRound(ctx, task, last),
  )
  const proof: ProofRow[] =
    last === undefined
      ? []
      : done.map((point) => {
          const verdict = roundVerdicts.find(
            (v) => v.kind === "done" && v.subject === String(point.n),
          )
          const cited = verdict?.text.match(/`(evidence\/[^`\s]+)`/)?.[1]
          const picture =
            cited !== undefined && IMAGE.test(cited)
              ? {
                  file: cited,
                  caption: pictures.get(cited) ?? sentence(verdict?.text ?? "").replace(/\.$/, ""),
                }
              : null
          const status: ProofRow["status"] =
            verdict === undefined
              ? "checking"
              : verdict.verdict === "PASS"
                ? "passed"
                : verdict.verdict === "FAIL"
                  ? "failed"
                  : verdict.verdict === "MISSING"
                    ? "missing"
                    : attested.has(`done:${point.n}`)
                      ? "confirmed by you"
                      : "yours to confirm"
          return {
            n: point.n,
            outcome: point.outcome,
            proof: verdict !== undefined ? sentence(verdict.text) : "",
            picture,
            status,
          }
        })

  const quality = parseQualityPass(await readQualityLog(ctx, task))
  const checks: PageState["checks"] = []
  // After a fix the re-check's result is the one that stands: the first review's counts are of
  // findings that may be fixed by now.
  const securityBlock = quality.get("security")
  const security = securityBlock?.recheckResult ?? securityBlock?.result
  if (security !== undefined && security !== null)
    checks.push({ label: "Security review", result: security })

  const finalDecision = [...decided].reverse().find((d) => d.target === "final")
  const url = await storedUrl(ctx, task)
  const pr = url?.match(/\/pull\/(\d+)/)?.[1]
  const branch = task.branch ?? (typeof fm.branch === "string" ? fm.branch : null)

  const slices = sliceRows(task, outline)
  const records = await stepRecords(ctx, task, {
    flowed,
    record,
    slices,
    proof,
    verifyMode,
    reviewing,
    now: ctx.clock.now(),
    when,
  })
  const ship: PageState["ship"] = {
    branch,
    shipped: task.stage === "shipped",
    pr: pr !== undefined ? Number(pr) : null,
    ...(finalDecision?.decision === "approved" ? { approvedAt: finalDecision.at } : {}),
  }
  // Verify's review sections follow the change while the person reviews it; once shipped they keep
  // what the person approved. A walkthrough git cannot read now is read at the next refresh.
  const walkthrough =
    reviewing && (await ctx.fs.exists(taskDocPath(task, "verify")))
      ? await readWalkthrough(ctx, task, { sources: { done, proof, records, ship } })
          .then(async (view) => {
            if (task.type === "chat") return view
            const projection = await workflowChanges(ctx, task)
            return projection.tracked ? scopeWalkthrough(view, projection) : view
          })
          .catch(() => undefined)
      : undefined

  return {
    title: task.title,
    checkedWithoutJudge: await checkedWithoutIndependentJudge(ctx, task),
    done,
    ...(() => {
      const answer = answerTo(comments, ["plan:done:1"])
      return answer !== undefined ? { doneAnswer: answer } : {}
    })(),
    decided: asked,
    // The agents' record of where each answered choice's facts came from.
    evidence: evidenceRows(answered),
    artifacts,
    decides,
    ...(yourCalls !== undefined ? { yourCalls } : {}),
    slices,
    approval,
    decisions,
    findings,
    ...(fixNeeds !== undefined ? { fixNeeds } : {}),
    proof,
    checks,
    records,
    // Required lines skipped, not done or failed are limits the person accepts with the change.
    limits: [...(await readLimits(ctx, task)), ...(await requiredLimits(ctx, task))],
    // The Plan: its review and the answers it rests on.
    byYou: await decidedByYou(ctx, task, plan, decides, asked),
    ...(await planReviews(ctx, task)),
    ...(walkthrough !== undefined ? { walkthrough } : {}),
    ship,
  }
}
