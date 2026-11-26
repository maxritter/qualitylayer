import {
  AppWindowIcon,
  ChevronDownIcon,
  FocusIcon,
  HistoryIcon,
  MessageSquarePlusIcon,
} from "lucide-react"
import { Fragment, type MouseEvent, type ReactNode } from "react"

/** "50 min ago" as the header draws it: a history mark and the age, the full words in the tooltip. */
export function UpdatedAgo({ ago }: { ago: string }) {
  return (
    <span className="preview-ago" title={`Updated ${ago}`}>
      <HistoryIcon aria-hidden="true" />
      <span className="sr-only">Updated </span>
      {ago}
    </span>
  )
}

/**
 * The header of a preview: its name, its facts (age, comments) and one control. An embed in a
 * document has Open in card, a labelled button (disabled while the page loads); the card carries
 * Open full size, so leaving the workflow is a deliberate second step. The picture is the same
 * control: a click on it opens the card too.
 */
export function PreviewHeader({
  name,
  meta,
  onCard,
  onAnnotate,
  cardDisabled = false,
}: {
  name: string
  /** Each fact of the line under the name, joined by dots. */
  meta: readonly ReactNode[]
  /** Open the card; the button is where focus returns to when it closes. */
  onCard?: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  /** Open the card armed for multi-place element/area annotations (#268). */
  onAnnotate?: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  cardDisabled?: boolean
}) {
  return (
    <div className="bar">
      <AppWindowIcon aria-hidden="true" />
      <div className="preview-heading">
        <b title={name}>{name}</b>
        {meta.length > 0 ? (
          <span className="meta">
            {meta.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the facts are a fixed list in order
              <Fragment key={index}>
                {index > 0 ? " · " : null}
                {part}
              </Fragment>
            ))}
          </span>
        ) : null}
      </div>
      <div className="preview-actions">
        {onCard ? (
          <button type="button" className="q-btn sm" disabled={cardDisabled} onClick={onCard}>
            <FocusIcon aria-hidden="true" />
            Open in card
          </button>
        ) : null}
        {onAnnotate ? (
          <button
            type="button"
            className="q-btn sm"
            disabled={cardDisabled}
            data-testid="preview-annotate"
            onClick={onAnnotate}
          >
            <MessageSquarePlusIcon aria-hidden="true" />
            Annotate
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A preview's facts and Open in card without its name: what a tab row or a row that already names
 * the screen carries at its end, in place of the header.
 */
export function PreviewActions({
  name,
  meta,
  onCard,
  onAnnotate,
  cardDisabled = false,
}: {
  /** The screen's name, for the button's accessible name: the row's tab carries it on screen. */
  name: string
  meta: readonly ReactNode[]
  onCard?: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  onAnnotate?: ((event: MouseEvent<HTMLButtonElement>) => void) | null
  cardDisabled?: boolean
}) {
  return (
    <span className="preview-actions-row" data-testid="preview-actions">
      {meta.length > 0 ? (
        <span className="meta">
          {meta.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the facts are a fixed list in order
            <Fragment key={index}>
              {index > 0 ? " · " : null}
              {part}
            </Fragment>
          ))}
        </span>
      ) : null}
      {onCard ? (
        <button
          type="button"
          className="q-btn sm"
          aria-label={`Open ${name} in card`}
          disabled={cardDisabled}
          onClick={onCard}
        >
          <FocusIcon aria-hidden="true" />
          Open in card
        </button>
      ) : null}
      {onAnnotate ? (
        <button
          type="button"
          className="q-btn sm"
          aria-label={`Annotate ${name}`}
          disabled={cardDisabled}
          data-testid="preview-annotate"
          onClick={onAnnotate}
        >
          <MessageSquarePlusIcon aria-hidden="true" />
          Annotate
        </button>
      ) : null}
    </span>
  )
}

/** A whole page taller than its preview says so until it is scrolled to its end. */
export function PreviewScrollHint({ vertical, atEnd }: { vertical: boolean; atEnd: boolean }) {
  if (!vertical || atEnd) return null
  return (
    <span className="dg-prv-more" aria-hidden="true">
      <ChevronDownIcon />
      Scroll for the rest
    </span>
  )
}
