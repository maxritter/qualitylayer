// The choices of a question, as one compact column (layout "A" of the question redesign), shared by
// every card that asks. Grade 1 and a choice without details: the row is the answer itself. Grade 2
// and 3: the row is a disclosure with its key, the recommended mark, the label and the first fact
// (two lines while closed); the recommended row opens by default, any row opens and closes, and the
// open body holds the facts, the diagram thumbnail under them at the card's width, drawn left to right,
// and Choose this. The card shows only what helps the person decide: a choice's evidence goes to the
// step's agents file (*Evidence behind the choices*). The card owns what an answer does
// and the keys 1 to 9.

import { type ReactNode, useState } from "react"
import type { QuestionChoice } from "../../core/task/question.ts"
import {
  ChoiceCopy,
  type ChoiceMulti,
  type ChoiceRowData,
  InteractiveChoiceRow,
  leftToRight,
  Thumbnail,
} from "./ChoiceListRows.tsx"
import "./choice-list.css"

export { leftToRight, Thumbnail }

/** A fact as the card lists it: "Tests run on: main's runtime" is a term and its value. */
function factParts(fact: string): { term?: string; value: string } {
  const split = fact.match(/^([^:]{1,28}):\s+(.+)$/s)
  return split?.[1] !== undefined && split[2] !== undefined
    ? { term: split[1].trim(), value: split[2].trim() }
    : { value: fact }
}

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

function rowsOf(
  choices: QuestionChoice[],
  recommended: number[],
  grade: 1 | 2 | 3,
  inOrder: boolean,
  screens: boolean,
): ChoiceRowData[] {
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

function InertChoiceList({
  rows,
  name,
  listTestId,
  testId,
  markdown,
}: {
  rows: ChoiceRowData[]
  name: string
  listTestId?: string
  testId: string
  markdown: boolean
}) {
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
            <ChoiceCopy row={row} gist={false} markdown={markdown} />
          </li>
        ))}
      </ol>
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
  const [touched, setTouched] = useState<ReadonlyMap<number, boolean>>(new Map())
  const isOpenAt = (row: ChoiceRowData) =>
    row.details && (touched.get(row.index) ?? row.recommended)
  const flip = (row: ChoiceRowData) =>
    setTouched((was) => new Map(was).set(row.index, !isOpenAt(row)))
  const name = label ?? (multi !== undefined ? "Choices, pick one or more" : "Choices")

  if (inert) {
    return (
      <InertChoiceList
        rows={rows}
        name={name}
        listTestId={listTestId}
        testId={testId}
        markdown={markdown}
      />
    )
  }

  const Box = multi !== undefined ? "fieldset" : "div"
  return (
    <div className="cl">
      <Box
        className="cl-list"
        aria-label={name}
        {...(multi === undefined ? { role: "group" } : {})}
        data-testid={listTestId}
      >
        {rows.map((row) => (
          <InteractiveChoiceRow
            key={row.index}
            row={row}
            idPrefix={idPrefix}
            theme={theme}
            testId={testId}
            disabled={disabled}
            markdown={markdown}
            isOpen={isOpenAt(row)}
            screen={screen}
            onFlip={() => flip(row)}
            onChoose={onChoose}
            multi={multi}
            chosen={chosen}
          />
        ))}
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
