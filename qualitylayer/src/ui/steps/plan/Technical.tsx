// What the Plan page ends with (Workflow model: Plan): one group of closed folds after Approach
// (Decided with you with Change, Decisions made for you, Prerequisites, Reviews), then Technical, a part
// of closed folds for engineers (Current system, Data and interfaces, Engineering decisions,
// Assumptions) that Details opens or closes together. Each draws from the text the document holds;
// none invents a word.

import {
  BotIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleHelpIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  type LucideIcon,
  PenIcon,
  ScanSearchIcon,
  SplitIcon,
  UserCheckIcon,
  WrenchIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { headingSlug } from "../../../core/docs/anchor.ts"
import type { DocSection } from "../../api.ts"
import { usePlanNow } from "../../docs/context.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { Quiet } from "../../step-page/bands/Fold.tsx"
import { DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import { DecidedBullets } from "../../step-page/kit/DecidedBullets.tsx"
import type { StepLive } from "../../step-page/live.ts"
import { bodyOf, foldFacts, quietLine, sectionId } from "../../step-page/sections.ts"
import type { ItemCard, Mode, StepState } from "../../step-page/state.ts"
import { DataRows, PrerequisiteRows, prerequisiteTable, ReasonRows } from "./BoundaryParts.tsx"
import { TakeawayRows } from "./Decisions.tsx"
import { PlanPart } from "./Pictures.tsx"
import { ReviewBlock } from "./parts.tsx"
import { byYouRows, dataRowsOf, reasonRowsOf, reviewOf, reviewTotal } from "./plan-model.ts"

type Where = { state: StepState; mode: Mode; live: StepLive | undefined }

/** The sections the Technical part holds, in the order the file writes them. */
export const TECHNICAL: readonly { title: string; icon: LucideIcon }[] = [
  { title: "Current system", icon: ScanSearchIcon },
  { title: "Data and interfaces", icon: DatabaseIcon },
  { title: "Engineering decisions", icon: SplitIcon },
  { title: "Assumptions", icon: CircleHelpIcon },
]

/** The titles the page draws itself below the core: its folds are not drawn a second time. */
export const BELOW = [
  ...TECHNICAL.map((t) => t.title),
  "Prerequisites",
  "Decided with you",
  "Decisions made for you",
  "Reviews",
]

/** One closed fold, a row of the page's group: its icon and name, how many rows it holds, and its first row in a few words. */
function TechFold({
  icon: Icon,
  title,
  count,
  gist,
  open,
  children,
}: {
  icon: LucideIcon
  title: string
  count: ReactNode
  gist: string | undefined
  open?: boolean | undefined
  children: ReactNode
}) {
  return (
    <Disclosure
      className="pl-tf"
      summaryProps={{
        id: sectionId(title),
        tabIndex: -1,
        "data-passage-section": headingSlug(title),
      }}
      data-fold={title}
      data-testid="step-fold"
      open={open || undefined}
      head={
        <>
          <Icon className="size-3.5 pl-tf-icon" aria-hidden="true" />
          <b>{title}</b>
          {count !== undefined && count !== null && count !== "" ? (
            <span className="q-disc-n">{count}</span>
          ) : null}
          {gist !== undefined && gist !== "" ? <span className="pl-tf-gist">{gist}</span> : null}
        </>
      }
    >
      <div className="pl-tf-body">{children}</div>
    </Disclosure>
  )
}

/** Details in a part's heading: opens or closes every fold of that part together. */
export function DetailsToggle() {
  const button = useRef<HTMLButtonElement>(null)
  const [all, setAll] = useState(false)
  const Toggle = all ? ChevronsDownUpIcon : ChevronsUpDownIcon
  useEffect(() => {
    const section = button.current?.closest("section")
    if (!section) return
    const sync = () => {
      const folds = Array.from(section.querySelectorAll("details"))
      setAll(folds.length > 0 && folds.every((fold) => fold.open))
    }
    section.addEventListener("toggle", sync, true)
    sync()
    return () => section.removeEventListener("toggle", sync, true)
  }, [])
  return (
    <button
      ref={button}
      type="button"
      className="q-btn quiet xs"
      aria-pressed={all}
      onClick={(event) => {
        const folds = Array.from(
          event.currentTarget.closest("section")?.querySelectorAll("details") ?? [],
        )
        const open = !folds.every((fold) => fold.open)
        for (const fold of folds) fold.open = open
        setAll(open)
      }}
    >
      <Toggle className="size-3" aria-hidden="true" />
      {all ? "Hide details" : "Details"}
    </button>
  )
}

/** The fold of one Technical section: rows where the text has the shape, the document's own drawing otherwise. */
export function TechnicalFold({
  section,
  icon,
  taskId,
  ...where
}: { section: DocSection; icon: LucideIcon; taskId: string } & Where) {
  const inNow = usePlanNow()
  const quiet = quietLine(section.markdown)
  if (quiet !== null)
    return (
      <Quiet title={section.title}>
        <InlineMarkdown text={`${quiet}.`} />
      </Quiet>
    )
  const facts = foldFacts(section.markdown)
  const active = where.mode === "live"
  // A Your call the page itself asks (outside the question layout) stands where it can be answered.
  const callOpen =
    active &&
    !inNow &&
    section.title === "Engineering decisions" &&
    Object.values(where.state.plan?.asking ?? {}).some((card) => card.state === "open")
  const commentLive = where.mode === "live" && !where.state.closed ? where.live : undefined
  let count: ReactNode = facts.count ?? undefined
  const gist: string | undefined = facts.takeaway
  let body: ReactNode = null
  if (section.title === "Data and interfaces") {
    const rows = dataRowsOf(section.markdown)
    if (rows !== null) {
      count = rows.length
      body = <DataRows rows={rows} />
    }
  } else if (section.title === "Engineering decisions") {
    body = <TakeawayRows markdown={section.markdown} {...where} />
  } else if (section.title === "Assumptions") {
    const rows = reasonRowsOf(section.markdown)
    if (rows !== null) body = <ReasonRows rows={rows} taskId={taskId} active={active} lead />
  } else if (section.title === "Prerequisites" && prerequisiteTable(section.markdown) !== null) {
    body = (
      <PrerequisiteRows
        markdown={section.markdown}
        taskId={taskId}
        active={active}
        commentLive={commentLive}
      />
    )
  }
  return (
    <TechFold icon={icon} title={section.title} count={count} gist={gist} open={callOpen}>
      {body ?? (
        <DocMarkdown
          markdown={bodyOf(section.markdown)}
          state={where.state}
          first={false}
          live={commentLive}
        />
      )}
    </TechFold>
  )
}

/** Prerequisites: what the agents cannot create themselves, a closed fold in the group after Approach. */
export function Prerequisites({
  section,
  taskId,
  ...where
}: { section: DocSection; taskId: string } & Where) {
  if (bodyOf(section.markdown) === "") return null
  return <TechnicalFold section={section} icon={FlaskConicalIcon} taskId={taskId} {...where} />
}

/** The Technical part: closed folds, and Details to open or close every one together. */
export function TechnicalPart({
  sections,
  taskId,
  entries = TECHNICAL,
  ...where
}: {
  sections: readonly DocSection[]
  taskId: string
  /** The folds this page's Technical part holds (Implement's is Program design). */
  entries?: readonly { title: string; icon: LucideIcon }[]
} & Where) {
  const list = useRef<HTMLUListElement>(null)
  const [all, setAll] = useState(false)
  const present = entries.flatMap((entry) => {
    const section = sections.find((s) => s.title === entry.title)
    return section === undefined || bodyOf(section.markdown) === ""
      ? []
      : [{ section, icon: entry.icon }]
  })
  if (present.length === 0) return null
  const toggle = () => {
    for (const fold of list.current?.querySelectorAll("details") ?? []) fold.open = !all
    setAll(!all)
  }
  const Toggle = all ? ChevronsDownUpIcon : ChevronsUpDownIcon
  return (
    <PlanPart
      title="Technical"
      icon={WrenchIcon}
      action={
        <button type="button" className="q-btn quiet xs" aria-pressed={all} onClick={toggle}>
          <Toggle className="size-3" aria-hidden="true" />
          {all ? "Hide details" : "Details"}
        </button>
      }
    >
      <ul className="pl-tech" ref={list} data-testid="plan-technical">
        {present.map(({ section, icon }) => (
          <li key={section.title}>
            <TechnicalFold section={section} icon={icon} taskId={taskId} {...where} />
          </li>
        ))}
      </ul>
    </PlanPart>
  )
}

/** Decisions made for you: what the agent settled itself, a closed fold beside Decided with you. */
export function MadeForYou({
  section,
  taskId,
  active,
}: {
  section: DocSection
  taskId: string
  active: boolean
}) {
  const rows = reasonRowsOf(section.markdown)
  if (rows === null || rows.length === 0) return null
  return (
    <Disclosure
      className="pl-tf pl-decided"
      summaryProps={{
        id: sectionId("Decisions made for you"),
        tabIndex: -1,
        "data-passage-section": headingSlug("Decisions made for you"),
      }}
      data-fold="Decisions made for you"
      data-testid="made-for-you"
      count={rows.length}
      head={
        <>
          <BotIcon className="size-3.5 pl-tf-icon" aria-hidden="true" />
          <b>Decisions made for you</b>
        </>
      }
    >
      <div className="pl-tf-body">
        <ReasonRows rows={rows} taskId={taskId} active={active} />
      </div>
    </Disclosure>
  )
}

/** The Plan's own call that a Decided with you row stands for, when one is answered and can be reopened. */
function callFor(row: { step: string; what: string }, state: StepState): ItemCard | undefined {
  if (row.step !== "Plan") return undefined
  return Object.values(state.plan?.asking ?? {}).find(
    (card) => card.state !== "open" && card.what.trim() === row.what.trim(),
  )
}

/** Decided with you: every answer the Plan rests on, with its step; a Plan call can be reopened. */
export function DecidedWithYou({
  section,
  state,
  reopen,
}: {
  section: DocSection
  state: StepState
  /** Reopens an answered call (Undo); absent when the page cannot (read-only, in the terminal, decided). */
  reopen: ((card: ItemCard) => void) | undefined
}) {
  const rows = byYouRows(bodyOf(section.markdown))
  if (rows === null) return null
  return (
    <Disclosure
      className="pl-tf pl-decided"
      summaryProps={{
        id: sectionId("Decided with you"),
        tabIndex: -1,
        "data-passage-section": headingSlug("Decided with you"),
      }}
      data-fold="Decided with you"
      data-testid="decided-with-you"
      count={rows.length}
      head={
        <>
          <UserCheckIcon className="size-3.5 pl-tf-icon" aria-hidden="true" />
          <b>Decided with you</b>
        </>
      }
    >
      <div className="pl-tf-body">
        <DecidedBullets
          testId="decided-rows"
          rows={rows.map((row, at) => {
            const card = callFor(row, state)
            return {
              // an answer can repeat; the rows are fixed in document order
              key: `${at}:${row.what}`,
              question: row.what,
              answer: row.answer.includes("\n") ? "" : row.answer,
              ...(row.answer.includes("\n")
                ? {
                    block: (
                      <DocMarkdown
                        markdown={row.answer}
                        state={state}
                        first={false}
                        live={undefined}
                        bare
                      />
                    ),
                  }
                : {}),
              ...(card !== undefined && reopen !== undefined
                ? {
                    trailing: (
                      <button type="button" className="q-btn quiet xs" onClick={() => reopen(card)}>
                        <PenIcon className="size-3" aria-hidden="true" />
                        Change
                      </button>
                    ),
                  }
                : {}),
            }
          })}
        />
      </div>
    </Disclosure>
  )
}

/** Reviews: who read the Plan and what the planner did with each finding; open while it waits on the review. */
export function Reviews({ section, open }: { section: DocSection; open: boolean }) {
  const review = reviewOf(bodyOf(section.markdown))
  if (review === null) return null
  return (
    <TechFold
      icon={ScanSearchIcon}
      title="Reviews"
      count={reviewTotal(review)}
      gist={review.summary}
      open={open}
    >
      <ReviewBlock review={review} />
    </TechFold>
  )
}
