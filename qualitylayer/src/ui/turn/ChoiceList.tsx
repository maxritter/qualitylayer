import { withoutRecommendationMarker } from "../../interaction/question-recommendations.ts"
// The choices of a question, as one compact column (layout "A" of the question redesign), shared by
// every card that asks. Grade 1 and a choice without details: the row is the answer itself. Grade 2
// and 3: the row is a disclosure with its key, the recommended mark, the label and the first fact
// (two lines while closed); the recommended row opens by default, any row opens and closes, and the
// open body holds the facts, the diagram thumbnail under them at the card's width, drawn left to right,
// and Choose this. The card shows only what helps the person decide: a choice's evidence goes to the
// step's agents file (*Evidence behind the choices*). The card owns what an answer does
// and the keys 1 to 9.

import {
  CheckIcon,
  ChevronDownIcon,
  CirclePlusIcon,
  ClipboardCheckIcon,
  ClockIcon,
  InfoIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import type { QuestionChoice } from "../../core/task/question.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { MermaidBlock } from "../reader/MermaidBlock.tsx"
import { FACT_KIND_WORDS, type FactKind, factKind } from "./fact-kind.ts"
import "./choice-list.css"

/** A fact as the card lists it: "Tests run on: main's runtime" is a term and its value. */
function factParts(fact: string): { term?: string; value: string } {
  const split = fact.match(/^([^:]{1,28}):\s+(.+)$/s)
  return split?.[1] !== undefined && split[2] !== undefined
    ? { term: split[1].trim(), value: split[2].trim() }
    : { value: fact }
}

/** A choice that asks for words (Change…, Request changes…) reads so, and moves to the field. */
const choiceLabel = (choice: Pick<QuestionChoice, "label" | "words">) =>
  choice.words === true && !choice.label.endsWith("…") ? `${choice.label}…` : choice.label

const FACT_ICON = {
  timing: ClockIcon,
  adds: CirclePlusIcon,
  why: InfoIcon,
  evidence: ClipboardCheckIcon,
} satisfies Record<FactKind, unknown>

function FactMark({ kind }: { kind: FactKind }) {
  const Icon = FACT_ICON[kind]
  return (
    <span
      className="cl-fk"
      data-kind={kind}
      title={FACT_KIND_WORDS[kind]}
      role="img"
      aria-label={FACT_KIND_WORDS[kind]}
    >
      <Icon aria-hidden="true" />
    </span>
  )
}

/** The toggles of a multi-select question: which choices are on, and the way to turn one. */
type ChoiceMulti = { on: number[]; toggle: (index: number) => void }

type ChoiceListProps = {
  choices: QuestionChoice[]
  /** The indices the agent recommends (`recommendedIndices(question)`). */
  recommended: number[]
  grade: 1 | 2 | 3
  /** The page theme: a diagram is drawn in literal colours. */
  theme: string
  /** Unique to the question; the open bodies take their ids from it. */
  idPrefix: string
  /** The row or the Choose this button was pressed: the answer, or (a words choice) the field. */
  onChoose?: (index: number) => void
  /** Several choices may be on: real checkboxes, and the card's one Send. */
  multi?: ChoiceMulti | undefined
  /** An answer is being saved: nothing can be chosen. */
  disabled?: boolean
  /** The terminal's preview of the choices: a dashed list, no controls. */
  inert?: boolean
  /** The row's test id; its parts add `-head`, `-facts` and `-diagram`. */
  testId?: string
  listTestId?: string
  /** The list's name for a screen reader. */
  label?: string
  /** The agent's order (a batch) or the recommended choices first (a single question). */
  inOrder?: boolean
  /** The choice that is the answer now (Change on a receipt): marked with a check. */
  chosen?: number | undefined
  /** The labels are Markdown (a Plan call's options carry `code` and **bold**). */
  markdown?: boolean
  /** Draws the screen a choice names in its `artifact`, under its facts; without it no choice shows one. */
  screen?: ((reference: string) => ReactNode) | undefined
}

type Row = {
  choice: QuestionChoice
  index: number
  key: number
  recommended: boolean
  facts: ReturnType<typeof factParts>[]
  diagram: string | undefined
  /** The screen the choice leads to, when the card can draw it. */
  artifact: string | undefined
  details: boolean
}

function rowsOf(
  choices: QuestionChoice[],
  recommended: number[],
  grade: 1 | 2 | 3,
  inOrder: boolean,
  screens: boolean,
): Row[] {
  const all = choices.map((choice, index) => ({ choice, index, on: recommended.includes(index) }))
  const shown = inOrder ? all : [...all.filter((r) => r.on), ...all.filter((r) => !r.on)]
  return shown.map(({ choice, index, on }, place) => {
    const facts = grade > 1 ? (choice.facts ?? []).map(factParts) : []
    const diagram = grade === 3 ? choice.diagram : undefined
    const artifact = screens ? choice.artifact : undefined
    return {
      choice,
      index,
      key: place + 1,
      recommended: on,
      facts,
      diagram,
      artifact,
      details:
        choice.words !== true &&
        (facts.length > 0 || diagram !== undefined || artifact !== undefined),
    }
  })
}

function Copy({ row, gist, markdown }: { row: Row; gist: boolean; markdown: boolean }) {
  const first = row.choice.facts?.[0]
  const label = row.recommended
    ? choiceLabel({ ...row.choice, label: withoutRecommendationMarker(row.choice.label) })
    : choiceLabel(row.choice)
  return (
    <span className="cl-copy">
      {row.recommended ? <span className="cl-rec">Recommended</span> : null}
      <span className="cl-label">{markdown ? <InlineMarkdown text={label} /> : label}</span>
      {gist && first !== undefined ? (
        <span className="cl-gist">
          <InlineMarkdown text={first} />
        </span>
      ) : null}
    </span>
  )
}

function Facts({ row, testId }: { row: Row; testId: string }) {
  if (row.facts.length === 0) return null
  return (
    <ul className="cl-facts" data-testid={`${testId}-facts`}>
      {row.facts.map((fact) => (
        <li key={fact.term === undefined ? fact.value : `${fact.term}:${fact.value}`}>
          <FactMark kind={factKind(fact.value, fact.term)} />
          <span>
            {fact.term !== undefined ? <b className="cl-term">{fact.term}: </b> : null}
            <InlineMarkdown text={fact.value} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A flowchart written top to bottom, drawn left to right: under the facts the frame has the card's width. */
export function leftToRight(source: string): string {
  return source.replace(/^([^\S\r\n\u2028\u2029]*(?:flowchart|graph)\s+)(?:TB|TD)\b/im, "$1LR")
}

/**
 * A diagram as a thumbnail at the card's width: drawn left to right, scaled to fit whole, in a frame
 * reserved before it loads (Enlarge shows it full size). Nothing sits beside it, so a short list of
 * facts above never leaves a hole.
 */
export function Thumbnail({
  source,
  theme,
  testId,
}: {
  source: string
  theme: string
  testId: string
}) {
  const drawn = leftToRight(source)
  return (
    <div className="cl-dg" data-testid={`${testId}-diagram`}>
      <MermaidBlock key={`${theme}:${drawn}`} source={drawn} theme={theme} enlarge />
    </div>
  )
}

/** What an open row holds: the facts, then the diagram and the choice's screen under them. */
function Body({
  row,
  id,
  theme,
  testId,
  screen,
  children,
}: {
  row: Row
  id: string
  theme: string
  testId: string
  screen: ChoiceListProps["screen"]
  children?: ReactNode
}) {
  return (
    <div className="cl-body" id={id}>
      <Facts row={row} testId={testId} />
      {row.diagram !== undefined ? (
        <Thumbnail source={row.diagram} theme={theme} testId={testId} />
      ) : null}
      {row.artifact !== undefined ? screen?.(row.artifact) : null}
      {children}
    </div>
  )
}

export function ChoiceList({
  choices,
  recommended,
  grade,
  theme,
  idPrefix,
  onChoose,
  multi,
  disabled = false,
  inert = false,
  testId = "choice",
  listTestId,
  label,
  inOrder = true,
  chosen,
  markdown = false,
  screen,
}: ChoiceListProps) {
  const rows = rowsOf(choices, recommended, grade, inOrder, screen !== undefined)
  // The recommended rows with details start open; what the person opens or closes is theirs, and
  // survives the card being republished with more to show.
  const [touched, setTouched] = useState<ReadonlyMap<number, boolean>>(new Map())
  const isOpenAt = (row: Row) => row.details && (touched.get(row.index) ?? row.recommended)
  const flip = (row: Row) => setTouched((was) => new Map(was).set(row.index, !isOpenAt(row)))
  const name = label ?? (multi !== undefined ? "Choices, pick one or more" : "Choices")

  if (inert)
    return (
      <div className="cl">
        <ol className="cl-list inert" aria-label={name} data-testid={listTestId}>
          {rows.map((row) => (
            <li
              key={row.index}
              className="cl-row cl-pick"
              data-testid={testId}
              data-recommended={row.recommended ? "true" : undefined}
            >
              <span className="cl-key">{row.key}</span>
              <Copy row={row} gist={false} markdown={markdown} />
            </li>
          ))}
        </ol>
      </div>
    )

  const rendered = rows.map((row) => {
    const common = {
      "data-testid": testId,
      "data-index": row.index,
      "data-recommended": row.recommended ? "true" : undefined,
    }
    const shortcut = row.key <= 9 ? String(row.key) : undefined
    const id = `${idPrefix}-choice-${row.index}`
    const isOpen = isOpenAt(row)

    if (multi !== undefined && row.choice.words !== true) {
      const on = multi.on.includes(row.index)
      return (
        <div key={row.index} className={rowClass("cl-row cl-multi", row, isOpen)}>
          <label className="cl-multi-pick" {...common} data-disabled={disabled || undefined}>
            <input
              type="checkbox"
              className="sr-only"
              checked={on}
              disabled={disabled}
              aria-keyshortcuts={shortcut}
              onChange={() => multi.toggle(row.index)}
            />
            <span className="cl-tick" aria-hidden="true">
              {on ? <CheckIcon /> : null}
            </span>
            <Copy row={row} gist={row.details && !isOpen} markdown={markdown} />
            <span className="cl-key" aria-hidden="true">
              {row.key}
            </span>
          </label>
          {row.details ? (
            <button
              type="button"
              className="cl-chev-btn"
              aria-expanded={isOpen}
              aria-controls={id}
              aria-label={`Details of choice ${row.key}`}
              data-testid={`${testId}-head`}
              onClick={() => flip(row)}
            >
              <ChevronDownIcon aria-hidden="true" />
            </button>
          ) : null}
          {isOpen ? <Body row={row} id={id} theme={theme} testId={testId} screen={screen} /> : null}
        </div>
      )
    }

    if (!row.details)
      return (
        <button
          key={row.index}
          type="button"
          className={rowClass("cl-row cl-pick", row, false)}
          disabled={disabled}
          aria-keyshortcuts={shortcut}
          aria-current={chosen === row.index ? "true" : undefined}
          onClick={() => onChoose?.(row.index)}
          {...common}
        >
          <span className="cl-key">{row.key}</span>
          <Copy row={row} gist={false} markdown={markdown} />
          {chosen === row.index ? <CheckIcon className="cl-chosen" aria-hidden="true" /> : null}
        </button>
      )

    return (
      <div key={row.index} className={rowClass("cl-row", row, isOpen)} {...common}>
        <button
          type="button"
          className="cl-head"
          aria-expanded={isOpen}
          aria-controls={id}
          aria-keyshortcuts={shortcut}
          data-testid={`${testId}-head`}
          onClick={() => flip(row)}
        >
          <span className="cl-key">{row.key}</span>
          <Copy row={row} gist={!isOpen} markdown={markdown} />
          <span className="cl-chev" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </button>
        {isOpen ? (
          <Body row={row} id={id} theme={theme} testId={testId} screen={screen}>
            <div className="cl-go">
              <button
                type="button"
                className={row.recommended ? "q-btn primary" : "q-btn"}
                disabled={disabled}
                data-testid={`${testId}-choose`}
                onClick={() => onChoose?.(row.index)}
              >
                <CheckIcon aria-hidden="true" />
                Choose this
              </button>
            </div>
          </Body>
        ) : null}
      </div>
    )
  })

  const Box = multi !== undefined ? "fieldset" : "div"
  return (
    <div className="cl">
      <Box
        className="cl-list"
        aria-label={name}
        {...(multi === undefined ? { role: "group" } : {})}
        data-testid={listTestId}
      >
        {rendered}
      </Box>
    </div>
  )
}

/**
 * Puts the keyboard on the list's recommended row (else its first): the one place a question takes focus
 * that is a real control, so a focus ring shows on the keyboard only. Returns whether a row took it.
 */
export function focusChoice(card: ParentNode | null | undefined, options?: FocusOptions): boolean {
  const row =
    card?.querySelector<HTMLElement>('[data-recommended="true"]') ??
    card?.querySelector<HTMLElement>(".cl-row")
  const control = row?.matches("button, input")
    ? row
    : row?.querySelector<HTMLElement>("button, input")
  control?.focus(options)
  return control !== null && control !== undefined
}

function rowClass(base: string, row: Row, open: boolean) {
  return [base, row.recommended ? "rec" : "", open ? "open" : ""]
    .join(" ")
    .replace(/ +/g, " ")
    .trim()
}
