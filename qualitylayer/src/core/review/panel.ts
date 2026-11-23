// A Plan's review panel: two or three reviewers read the Plan side by side (round one), each then
// reads the others' findings once and says agree or disagree (round two), and their answers are
// merged into the one review file the gate and the Plan page already read. This module runs the
// rounds, reads the second-round stances and writes the merged text. It starts no process and knows
// nothing of gates or pages: `cross.ts` hands it the function that runs one reviewer.
//
// A reviewer's text is data. Another reviewer's findings are quoted into a brief under a heading
// that says so, and a stance is read only from a reviewer's own lines of the form
// `<number>: AGREE|DISAGREE` (or `M<number>: SAME AS <number>` for one of its own findings).

import { mergePanel } from "./panel-merge.ts"
import {
  approves,
  findingsOf,
  firstRound,
  readStances,
  secondRoundFindings,
} from "./panel-parse.ts"

export { findingsOf, mergePanel, readStances, secondRoundFindings }

/** One seat of the panel: who reviews, on which model, and at which effort when not the panel's. */
export type PanelSeat = {
  by: string
  name: string
  model: string
  effort?: string
}

export type MemberState = "running" | "done" | "failed" | "timed_out" | "skipped"

/** What the run record keeps of a member. */
export type PanelMemberRun = PanelSeat & {
  round1: MemberState
  round2?: MemberState
  /** The findings of its first-round review. */
  findings?: number
  /** Why it did not answer, in plain words. */
  reason?: string
}

export type PanelProgress = { round: 1 | 2; members: PanelMemberRun[] }

/** How one run of one member ended. */
export type MemberAnswer = {
  good: boolean
  timedOut: boolean
  answer: string
  /** Why it did not answer, when it did not. */
  reason: string
}

export type PanelDeps = {
  /** Run one member for one round to its end or its hard stop; never throws. `findings` is the second round's part of the brief. */
  run(seat: PanelSeat, round: 1 | 2, findings?: string): Promise<MemberAnswer>
  /** Keep a member's own answer of a round (`reviews/plan-<agent>-<round>.md`). */
  save(seat: PanelSeat, round: 1 | 2, text: string): Promise<void>
  /** The round or a member's state changed. */
  progress(state: PanelProgress): Promise<void>
}

/** A finding of the panel, numbered across all reviewers in seat order. */
export type PanelFinding = {
  /** Its number in the second round's briefs. */
  n: number
  /** The seat of the reviewer that raised it. */
  author: number
  text: string
  /** Raised in the second round: nobody else read it. */
  late?: boolean
}

export type Stance = { kind: "agree" } | { kind: "disagree"; reason: string }

/** What a member's second-round answer says, as far as it could be read. */
export type StancesRead = {
  /** By finding number. */
  stances: Map<number, Stance>
  /** Its own findings it folds into another's: own number → the other's number. */
  same: Map<number, number>
  /** Findings it adds. */
  added: string[]
}

export type PanelResult =
  /** Two or more reviewers answered: the merged review. */
  | {
      kind: "panel"
      text: string
      verdict: string
      findings: number
      members: PanelMemberRun[]
    }
  /** One reviewer answered: its review stands alone, as a single review does. */
  | { kind: "single"; seat: PanelSeat; answer: string; members: PanelMemberRun[] }
  /** Nobody answered. */
  | { kind: "empty"; reason: string; timedOut: boolean; members: PanelMemberRun[] }

const stateOf = (a: MemberAnswer): MemberState =>
  a.good ? "done" : a.timedOut ? "timed_out" : "failed"

// An answer with neither a verdict nor a finding ("I could not open the repository") is no review.
const reviewed = (a: MemberAnswer): MemberAnswer =>
  !a.good || firstRound(a.answer).verdict === "APPROVE" || findingsOf(a.answer).length > 0
    ? a
    : { ...a, good: false, reason: "it gave no readable review" }

async function runFirstRoundMember(
  seat: PanelSeat,
  member: PanelMemberRun,
  members: PanelMemberRun[],
  deps: PanelDeps,
): Promise<MemberAnswer> {
  let answer = reviewed(await deps.run(seat, 1))
  if (!answer.good && !answer.timedOut) answer = reviewed(await deps.run(seat, 1))
  if (answer.good) await deps.save(seat, 1, answer.answer)
  member.round1 = stateOf(answer)
  if (answer.good) member.findings = approves(answer.answer) ? 0 : findingsOf(answer.answer).length
  else member.reason = answer.reason
  await deps.progress({ round: 1, members })
  return answer
}

function collectFirstRoundFindings(
  standing: readonly number[],
  first: readonly MemberAnswer[],
): PanelFinding[] {
  const findings: PanelFinding[] = []
  for (const seat of standing) {
    const answer = first[seat]?.answer ?? ""
    if (approves(answer)) continue
    for (const text of findingsOf(answer)) {
      findings.push({ n: findings.length + 1, author: seat, text })
    }
  }
  return findings
}

async function runSecondRoundMember(
  seat: number,
  seats: readonly PanelSeat[],
  findings: readonly PanelFinding[],
  members: PanelMemberRun[],
  deps: PanelDeps,
): Promise<StancesRead | null> {
  const member = members[seat] as PanelMemberRun
  const brief = secondRoundFindings(seat, seats, findings)
  if (brief.shown.size === 0) {
    member.round2 = "skipped"
    return { stances: new Map(), same: new Map(), added: [] }
  }
  const readable = (a: MemberAnswer): StancesRead | null => {
    if (!a.good) return null
    const said = readStances(a.answer, brief.shown, brief.own)
    return said.stances.size + said.same.size === 0 ? null : said
  }
  let answer = await deps.run(seats[seat] as PanelSeat, 2, brief.text)
  let said = readable(answer)
  if (said === null && !answer.timedOut) {
    answer = await deps.run(seats[seat] as PanelSeat, 2, brief.text)
    said = readable(answer)
  }
  if (answer.good) await deps.save(seats[seat] as PanelSeat, 2, answer.answer)
  member.round2 = said !== null ? "done" : answer.timedOut ? "timed_out" : "failed"
  await deps.progress({ round: 2, members })
  return said
}

/**
 * Run the panel. Round one: every member side by side; one that fails is tried once more as it was
 * (never after running out of time), then dropped. No survivor: `empty`. One: its review stands alone.
 * Otherwise, when round one found anything, round two: each survivor gets the others' findings; an
 * answer with no readable stance counts as not answered and is tried once more.
 */
export async function runPanel(
  seats: readonly PanelSeat[],
  deps: PanelDeps,
  effort = "high",
): Promise<PanelResult> {
  const members: PanelMemberRun[] = seats.map((seat) => ({ ...seat, round1: "running" }))
  await deps.progress({ round: 1, members })
  const first = await Promise.all(
    seats.map((seat, i) => runFirstRoundMember(seat, members[i] as PanelMemberRun, members, deps)),
  )
  const standing = seats.map((_, i) => i).filter((i) => first[i]?.good === true)
  const dropped = seats.flatMap((seat, i) =>
    first[i]?.good === true
      ? []
      : [
          `${seat.name} did not answer: ${first[i]?.timedOut === true ? "it ran out of time" : (first[i]?.reason ?? "it stopped")}.`,
        ],
  )
  if (standing.length === 0) {
    return {
      kind: "empty",
      reason: [...new Set(first.map((a) => a.reason))].join("; "),
      timedOut: first.every((a) => a.timedOut),
      members,
    }
  }
  if (standing.length === 1) {
    const only = standing[0] as number
    return {
      kind: "single",
      seat: seats[only] as PanelSeat,
      answer: first[only]?.answer ?? "",
      members,
    }
  }

  const findings = collectFirstRoundFindings(standing, first)
  const read = new Map<number, StancesRead | null>()
  if (findings.length > 0) {
    for (const seat of standing) (members[seat] as PanelMemberRun).round2 = "running"
    await deps.progress({ round: 2, members })
    await Promise.all(
      standing.map(async (seat) => {
        read.set(seat, await runSecondRoundMember(seat, seats, findings, members, deps))
      }),
    )
  }
  const merged = mergePanel(seats, standing, findings, read, dropped, effort)
  return { kind: "panel", ...merged, members }
}
