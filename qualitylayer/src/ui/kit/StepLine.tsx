// The one row under the step tabs: whose turn it is, the state in bold, one sentence, and the
// step's actions: at most one main button (optionally split, with a menu), a secondary, and
// "Comments · N" when there are comments. An amber band when it is your turn, neutral otherwise.
// On a finished step it says what happened and links to where the task is now.

import { cn } from "cn"
import { InfoIcon } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type Who, WhoMark } from "./WhoMark.tsx"

export type StepAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Why it is disabled, or what it does. */
  title?: string
}

export type MenuEntry = {
  label: string
  hint?: string
  onSelect: () => void
  disabled?: boolean
  /** A rule above the entry. */
  separate?: boolean
}

export type StepMain = StepAction & {
  menu?: MenuEntry[]
  /** The button itself opens the menu: it does nothing on its own until the person picks an entry. */
  opensMenu?: boolean
  /**
   * The button does what it says on a click, but ⌘↵ only opens the menu: an action with side
   * effects outside the App (a push, a pull request) is never started by a key pressed anywhere.
   */
  keyOpensMenu?: boolean
}

/** Says what the mark means to a reader, in the words the glossary uses. */
const WHO_LABEL: Partial<Record<Who, string>> = {
  you: "Your turn",
  agent: "An agent works",
  done: "Done",
  stop: "Stopped",
}

const editable = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  return (
    el !== null && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  )
}

/** A dialog or sheet is open, or the key came from inside one: the page behind it is not the one being answered. */
const behindDialog = (target: EventTarget | null): boolean =>
  (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null) ||
  document.querySelector('[role="dialog"][data-open], [role="alertdialog"][data-open]') !== null

/** ⌘↵ and Ctrl+Enter run the main button, unless a field is being typed in, a dialog is open or it is disabled. */
export function useMainShortcut(main: StepAction | undefined) {
  const latest = useRef(main)
  latest.current = main
  useEffect(() => {
    const on = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented)
        return
      if (editable(event.target) || behindDialog(event.target)) return
      const current = latest.current
      if (current === undefined || current.disabled === true) return
      event.preventDefault()
      current.onClick()
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [])
}

function ActionButton({
  action,
  kind,
  extra,
}: {
  action: StepAction
  kind: "primary" | "quiet" | "plain"
  extra?: string
}) {
  return (
    <button
      type="button"
      className={cn("q-btn", kind !== "plain" && kind, extra)}
      disabled={action.disabled}
      title={action.title}
      onClick={action.onClick}
      data-testid={kind === "primary" ? "step-main" : undefined}
    >
      {action.label}
    </button>
  )
}

function SplitMainButton({
  main,
  primaryAction,
  menu,
  menuOpen,
  setMenuOpen,
}: {
  main: StepMain
  primaryAction: StepAction
  menu: readonly MenuEntry[]
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
}) {
  return (
    <span className="q-split">
      <ActionButton action={primaryAction} kind="primary" />
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="q-btn primary"
              aria-label="More ways to approve"
              disabled={main.disabled}
            />
          }
        >
          <span className="q-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px]">
          {menu.map((entry) => (
            <Fragment key={entry.label}>
              {entry.separate === true ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={entry.disabled}
                onClick={entry.onSelect}
                className="grid gap-0 px-2.5 py-2"
              >
                <b className="text-[13px] font-medium">{entry.label}</b>
                {entry.hint !== undefined ? (
                  <span className="text-xs text-muted-foreground">{entry.hint}</span>
                ) : null}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/**
 * A step's buttons: other controls first, the secondary, "Comments · N", then at most one main
 * button (split, with a menu, when it has one). ⌘↵ runs the main button, or opens its menu.
 */
export function StepButtons({
  actions,
  main,
  secondary,
  comments,
}: {
  actions?: ReactNode
  main?: StepMain | undefined
  secondary?: StepAction | null | undefined
  comments?: { count: number; onClick: () => void; open?: boolean } | null | undefined
}) {
  // A main button that only opens its menu: it opens it for ⌘↵ too, and sends nothing itself.
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = main?.menu
  const hasMenu = menu !== undefined && menu.length > 0
  const opens = main?.opensMenu === true && hasMenu
  const primaryAction =
    main !== undefined && opens ? { ...main, onClick: () => setMenuOpen(true) } : main
  const shortcutAction =
    main !== undefined && main.keyOpensMenu === true && hasMenu
      ? { ...main, onClick: () => setMenuOpen(true) }
      : primaryAction
  useMainShortcut(shortcutAction)
  return (
    <>
      {actions}
      {secondary ? <ActionButton action={secondary} kind="quiet" /> : null}
      {comments ? (
        <button
          type="button"
          className="q-btn quiet"
          aria-expanded={comments.open}
          onClick={comments.onClick}
          data-testid="comments-button"
        >
          Feedback · {comments.count}
        </button>
      ) : null}
      {main === undefined ? null : hasMenu && primaryAction !== undefined ? (
        <SplitMainButton
          main={main}
          primaryAction={primaryAction}
          menu={menu}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
        />
      ) : (
        <ActionButton action={main} kind="primary" />
      )}
    </>
  )
}

export function StepLine({
  who,
  running = false,
  state,
  say,
  hint,
  detail,
  main,
  secondary,
  comments,
  actions,
  finished,
  progress,
  below,
  tone,
  testId = "step-line",
}: {
  who: Who | "quiet"
  /** An agent's ring turns while it runs. */
  running?: boolean
  /** The bold state: "Waits for your approval". */
  state: ReactNode
  say?: ReactNode
  /** A detail the line keeps out of its sentence, shown when the pointer rests on it. */
  hint?: string
  /** Right after the sentence: what runs, a command to copy. */
  detail?: ReactNode
  main?: StepMain
  secondary?: StepAction | null
  comments?: { count: number; onClick: () => void; open?: boolean } | null
  /** Other controls of the step, before its buttons. */
  actions?: ReactNode
  /** A finished step: what happened, and the link to where the task is now. */
  finished?: { text: ReactNode; link: string; onLink: () => void }
  /** 0..1 while a build runs: a thin line under the row. */
  progress?: number | null
  /** Full-width rows under the line: what runs now, what teammates said. */
  below?: ReactNode
  /** The band's colour when it is not the mark's own: a stop is red even though the agent ended it. */
  tone?: "you" | "stop" | "plain"
  testId?: string
}) {
  const mark: Who = who === "quiet" ? "todo" : who
  const band = tone ?? (who === "you" ? "you" : who === "stop" ? "stop" : "plain")
  return (
    <div className={cn("q-step", band !== "plain" && band)} data-testid={testId} data-who={who}>
      <div className="who" role="status" title={hint}>
        <WhoMark who={mark} running={running} label={WHO_LABEL[mark]} />
        <b className="state">{state}</b>
        {say !== undefined ? <span className="say">{say}</span> : null}
        {hint !== undefined ? (
          <span className="hint" data-testid="step-hint">
            <InfoIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{hint}</span>
          </span>
        ) : null}
        {detail}
      </div>
      {finished !== undefined ? (
        <div className="elsewhere">
          <span>{finished.text}</span>
          <button type="button" className="q-link" onClick={finished.onLink}>
            {finished.link}
          </button>
        </div>
      ) : null}
      {actions !== undefined || main !== undefined || secondary || comments ? (
        <div className="act">
          <StepButtons actions={actions} main={main} secondary={secondary} comments={comments} />
        </div>
      ) : null}
      {below !== undefined ? <div className="below">{below}</div> : null}
      {progress !== undefined && progress !== null ? (
        <div className="bar">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
    </div>
  )
}
