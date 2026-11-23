// The parts the Plan draws over its document's marked sections: the artifacts under Interface, each
// engineering decision's call and "Approve the Plan?".

import { referenceName } from "../../core/artifact/reference.ts"
import { usePlanNow } from "../docs/context.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { YourCall } from "../steps/plan/parts.tsx"
import { Answers, markOf, Pin } from "./Answers.tsx"
import { ArtifactSlot } from "./ArtifactSlot.tsx"
import type { StepMarker } from "./document.ts"
import { NamedScreen } from "./kit/GalleryTabs.tsx"
import type { StepLive } from "./live.ts"
import type { Drawer } from "./RecordDrawer.tsx"
import { jumpId, type Mode, type StepState } from "./state.ts"

export type PartProps = {
  marker: StepMarker
  state: StepState
  mode: Mode
  live: StepLive | undefined
  show: (drawer: Drawer) => void
}

/**
 * An artifact a `ql:artifact <name>` marker names: the Plan's Interface (the preview and its look).
 * A picture in a lead section is drawn where it stands, never folded.
 */
export function Artifact({ marker, state, mode, live }: PartProps) {
  const name = marker.args[0] ?? ""
  const artifact = state.plan?.artifacts[name]
  if (artifact === undefined) return null
  const title = artifact.title === name ? referenceName(name) : artifact.title
  return (
    <NamedScreen name={title}>
      <ArtifactSlot artifact={{ ...artifact, title }} mode={mode} live={live} />
    </NamedScreen>
  )
}

/** One engineering decision's call, under the decision as the Plan states it. */
export function Decide({ marker, state, mode, live }: PartProps) {
  const inNow = usePlanNow() && mode === "live"
  const card = state.plan?.decisions[marker.args[0] ?? ""]
  // The unified reader is documentary; its actual questions and final approval live in
  // the focused workspace/header. A historical proposal must not advertise another vote.
  if (card === undefined || inNow) return null
  // A Your call is the one decision of a task's Plan that asks something of the person.
  if (card.call !== undefined) return <YourCall card={card} mode={mode} live={live} />
  if (card.documentary) return null
  return (
    <div
      className={card.state === "open" && mode === "live" && !inNow ? "sp-dk" : "sp-dk done"}
      id={card.target}
      tabIndex={-1}
      data-testid="decide"
    >
      <span className="w">
        {inNow && card.state === "open" ? null : <WhoMark who={markOf(card)} />}
        <span className="kd">Your call</span>
        {card.state === "open" ? <InlineMarkdown text={card.what} /> : null}
        <Pin n={card.pins} />
      </span>
      <Answers card={card} mode={mode} live={live} />
    </div>
  )
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

type PlanApproval = NonNullable<NonNullable<StepState["plan"]>["approve"]>

const jumpToTarget = (target: string) => {
  const el = document.getElementById(target)
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
  el?.focus?.({ preventScroll: true })
}

function DecidedApproval({ approval }: { approval: PlanApproval }) {
  return (
    <div className="sp-ap done" id={jumpId("approve")} data-testid="approve-plan">
      <div className="sp-ap-h">
        <WhoMark who="done" />
        <b>{approval.decided?.decision === "changes" ? "Changes sent" : "Plan approved"}</b>
        {approval.decided?.at !== undefined ? (
          <span className="s">{clock(approval.decided.at)}</span>
        ) : null}
      </div>
      {approval.amends.length > 0 ? (
        <div className="sp-ap-b" data-testid="changed-after-approval">
          <b className="sp-ap-sub">What changed after your approval</b>
          <ul className="sp-ap-amends">
            {approval.amends.map((amend) => (
              <li key={`${amend.at}-${amend.note}`}>
                {amend.note}
                <span className="s">{clock(amend.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ApprovalRows({ rows }: { rows: PlanApproval["rows"] }) {
  if (rows.length === 0) return null
  return (
    <div className="sp-ap-b">
      {rows.map((row) => (
        <div className="sp-ap-r" key={row.id}>
          <WhoMark who={row.open ? "you" : "done"} />
          <span>{row.label}</span>
          {row.open ? (
            <button type="button" className="r y" onClick={() => jumpToTarget(row.target)}>
              open ↑
            </button>
          ) : (
            <span className="r">{row.answer}</span>
          )}
        </div>
      ))}
    </div>
  )
}

const approvalHint = (approval: PlanApproval, agent: string): string =>
  approval.phase === "writing"
    ? `${agent} is still writing the Plan. Approve opens when it asks for your review.`
    : (approval.locked ??
      "Approving takes the open ones as they are. A Change turns this into Send N changes.")

/** "Approve the Plan?": what you answered, what is open, and the one main button. */
export function ApprovePlan({ state, mode, live }: PartProps) {
  const a = state.plan?.approve
  if (a === undefined) return null
  if (a.phase === "decided") return <DecidedApproval approval={a} />
  const acts = mode === "live" && a.phase === "open" ? live : undefined
  return (
    <div className="sp-ap" id={jumpId("approve")} tabIndex={-1} data-testid="approve-plan">
      <div className="sp-ap-h">
        <WhoMark who={a.phase === "open" ? "you" : "agent"} />
        <b>Approve the Plan?</b>
        <span className="s">
          {a.rows.length > 0 ? `${a.answered} of ${a.rows.length} answered` : ""}
        </span>
      </div>
      <ApprovalRows rows={a.rows} />
      <div className="sp-ap-f">
        <span>{approvalHint(a, state.agent)}</span>
        <span className="sp" />
        {mode === "live" ? (
          <button
            type="button"
            className="q-btn primary"
            data-testid="approve-plan-main"
            disabled={acts === undefined || a.locked !== null || live?.busy === true}
            onClick={() => acts?.decide(a.main.kind === "changes" ? "changes" : "approved")}
          >
            {a.main.label}
            <span className="aa-k">⌘↵</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
