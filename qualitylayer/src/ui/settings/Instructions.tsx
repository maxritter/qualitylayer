// The one editor for workflow instructions (Instructions editor): Markdown in a field, a preview, a
// starter outline, a count against the cap, and an explicit Save. The text is filed for the agent's
// steps, so it saves only on Save, never on a keystroke. Settings › Workflow opens it for your own
// text.

import { cn } from "cn"
import { EyeIcon, ListChecksIcon, PencilLineIcon } from "lucide-react"
import { Fragment, type ReactNode, type RefObject, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { FLOW_STEPS } from "../../core/flow.ts"
import { type RequiredLine, requiredLines, stepLabel } from "../../core/required-parse.ts"
import type { InstructionsOutcome, InstructionsText } from "../api.ts"
import { Segmented } from "../Segmented.tsx"
import { InstructionsPreview, InstructionsSteps } from "./InstructionsSteps.tsx"
import { SettingsMore } from "./Rows.tsx"

/** The same cap the server holds (`INSTRUCTIONS_MAX_CHARS`), counted in characters, not bytes. */
export const INSTRUCTIONS_LIMIT = 12_000

/** Each empty bullet is "- " with its space, written as lines so no editor trims it. */
export const STARTER_OUTLINE = [
  ["## Coding standards", "- "],
  ["## Tools to use", "- "],
  ["## Always", "- "],
  ["## Never", "- "],
  ["## Plan", "- Example: name every public API the change touches."],
  ["## Implement", "- Example: run the linter before each commit."],
  ["## Verify", "- Example: also run the browser tests for a screen change."],
]
  .map((section) => section.join("\n"))
  .join("\n\n")
  .concat("\n")

const count = (n: number) => n.toLocaleString("en-US")
/** Characters are code points, as the server counts them. */
const lengthOf = (text: string) => [...text].length

/** The required lines in the person's local instructions, grouped in the hint when possible. */
export function requiredSummary(lines: RequiredLine[]): string | null {
  if (lines.length === 0) return null
  const steps = new Set(lines.map((line) => line.step))
  return `${lines.length} step ${lines.length === 1 ? "check" : "checks"}${steps.size === 1 ? ` in ${stepLabel(lines[0]?.step ?? "verify")}` : ""}`
}

type View = "write" | "steps" | "preview"
const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "write", label: "Write", icon: <PencilLineIcon aria-hidden="true" /> },
  { id: "steps", label: "Steps", icon: <ListChecksIcon aria-hidden="true" /> },
  { id: "preview", label: "Preview", icon: <EyeIcon aria-hidden="true" /> },
]

type Problem = { kind: "conflict"; current: InstructionsText } | { kind: "failed"; message: string }

function InstructionsViewPane({
  view,
  draft,
  filed,
  over,
  help,
  field,
  edit,
}: {
  view: View
  draft: string
  filed: string
  over: boolean
  help: string
  field: RefObject<HTMLTextAreaElement | null>
  edit: (next: string) => void
}) {
  if (view === "steps") {
    return (
      <InstructionsSteps
        draft={draft}
        filed={filed}
        edit={edit}
        help="Changes apply from your next task."
      />
    )
  }
  if (view === "preview") {
    return (
      <>
        {draft.trim() === "" ? (
          <p className="q-dim m-0">Nothing to preview yet.</p>
        ) : (
          <InstructionsPreview text={draft} />
        )}
        <p className="q-ins-help">{help}</p>
      </>
    )
  }
  return (
    <>
      <label className="sr-only" htmlFor="instructions-field">
        Instructions
      </label>
      <textarea
        id="instructions-field"
        ref={field}
        className="q-ins-field"
        value={draft}
        spellCheck={false}
        placeholder="## Coding standards"
        onChange={(event) => edit(event.target.value)}
        aria-invalid={over}
        data-testid="instructions-field"
      />
      <p className="q-ins-help">{help}</p>
      <SettingsMore summary="Step headings and step checks">
        <p className="q-ins-help">
          The headings are{" "}
          {FLOW_STEPS.map(({ id, label }, at) => (
            <Fragment key={id}>
              {at === 0 ? "" : at === FLOW_STEPS.length - 1 ? " and " : ", "}
              <code>{`## ${label}`}</code>
            </Fragment>
          ))}
          . A <code>- [ ]</code> line under one is a step check.
        </p>
      </SettingsMore>
    </>
  )
}

function InstructionsProblem({
  problem,
  onTakeCurrent,
}: {
  problem: Problem | null
  onTakeCurrent: (current: InstructionsText) => void
}) {
  if (problem === null) return null
  if (problem.kind === "conflict") {
    return (
      <p className="q-ins-err" role="alert">
        <b>Changed elsewhere.</b> Newer text was saved while you were editing. Yours stays here
        until you choose.{" "}
        <button type="button" className="q-link" onClick={() => onTakeCurrent(problem.current)}>
          Show the current text
        </button>
      </p>
    )
  }
  return (
    <p className="q-ins-err" role="alert">
      <b>Not saved.</b> {problem.message} Your text is still here; save again when it works.
    </p>
  )
}

function InstructionsFooter({
  asking,
  over,
  countLine,
  dirty,
  saving,
  failed,
  setAsking,
  onClose,
  onSave,
}: {
  asking: boolean
  over: boolean
  countLine: string
  dirty: boolean
  saving: boolean
  failed: boolean
  setAsking: (asking: boolean) => void
  onClose: () => void
  onSave: () => void
}) {
  if (asking) {
    return (
      <footer className="q-ins-foot">
        <span className="q-ins-confirm" role="alert">
          Discard your changes?
        </span>
        <span className="q-ins-sp" />
        <button type="button" className="q-btn quiet" onClick={() => setAsking(false)}>
          Keep editing
        </button>
        <button type="button" className="q-btn quiet danger" onClick={onClose}>
          Discard
        </button>
      </footer>
    )
  }
  const saveTitle = over ? "Shorten the text to save" : !dirty ? "No changes to save" : undefined
  return (
    <footer className="q-ins-foot">
      <span
        className={cn("q-ins-count", over && "over")}
        data-testid="instructions-count"
        aria-live="polite"
      >
        {countLine}
      </span>
      <span className="q-ins-sp" />
      <button
        type="button"
        className="q-btn quiet"
        onClick={() => (dirty ? setAsking(true) : onClose())}
      >
        Cancel
      </button>
      <button
        type="button"
        className="q-btn primary"
        disabled={!dirty || over || saving}
        title={saveTitle}
        onClick={onSave}
      >
        {failed ? "Save again" : "Save"}
      </button>
    </footer>
  )
}

function Body({
  text,
  base: opened,
  save,
  onSaved,
  asking,
  setAsking,
  onDirty,
  onClose,
  help,
}: {
  text: string
  base: number
  save: (text: string, base: number) => Promise<InstructionsOutcome>
  onSaved?: (saved: InstructionsText) => void
  asking: boolean
  setAsking: (asking: boolean) => void
  onDirty: (dirty: boolean) => void
  onClose: () => void
  help: string
}) {
  const [filed, setFiled] = useState(text)
  const [base, setBase] = useState(opened)
  const [draft, setDraft] = useState(text)
  const [started, setStarted] = useState(text !== "")
  const [view, setView] = useState<View>(() =>
    requiredLines(null, text).length > 0 ? "steps" : "write",
  )
  const [saving, setSaving] = useState(false)
  const [savedNow, setSavedNow] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  const length = lengthOf(draft)
  const over = length > INSTRUCTIONS_LIMIT
  const dirty = draft !== filed
  onDirty(dirty)

  const edit = (next: string) => {
    setDraft(next)
    setSavedNow(false)
    setAsking(false)
  }
  const begin = (next: string) => {
    setStarted(true)
    setDraft(next)
    queueMicrotask(() => field.current?.focus())
  }
  const run = async () => {
    setSaving(true)
    setProblem(null)
    try {
      const outcome = await save(draft, base)
      if ("conflict" in outcome) {
        setProblem({ kind: "conflict", current: outcome.conflict })
        return
      }
      setFiled(outcome.saved.text)
      setBase(outcome.saved.updated)
      setSavedNow(true)
      onSaved?.(outcome.saved)
    } catch (cause) {
      setProblem({
        kind: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setSaving(false)
    }
  }
  const takeCurrent = (current: InstructionsText) => {
    setDraft(current.text)
    setFiled(current.text)
    setBase(current.updated)
    setProblem(null)
    setSavedNow(false)
  }
  const countLine = over
    ? `${count(length)} of ${count(INSTRUCTIONS_LIMIT)} characters · shorten by ${count(length - INSTRUCTIONS_LIMIT)} to save`
    : `${count(length)} of ${count(INSTRUCTIONS_LIMIT)} characters`

  return (
    <>
      <div className="q-ins-body">
        {!started ? (
          <div className="q-ins-empty">
            <p>
              Coding standards, tools to use, what to always do and never do. Write it as Markdown,
              as you would an AGENTS.md.
            </p>
            <div className="q-ins-offer">
              <button type="button" className="q-btn" onClick={() => begin(STARTER_OUTLINE)}>
                Start from an outline
              </button>
              <button type="button" className="q-link" onClick={() => begin("")}>
                Start blank
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="q-ins-bar">
              <Segmented label="View" size="sm" value={view} options={VIEWS} onChange={setView} />
              {savedNow ? (
                <span className="q-ins-meta" role="status">
                  Saved
                </span>
              ) : null}
            </div>
            <InstructionsViewPane
              view={view}
              draft={draft}
              filed={filed}
              over={over}
              help={help}
              field={field}
              edit={edit}
            />
          </>
        )}
        <InstructionsProblem problem={problem} onTakeCurrent={takeCurrent} />
      </div>
      <InstructionsFooter
        asking={asking}
        over={over}
        countLine={countLine}
        dirty={dirty}
        saving={saving}
        failed={problem?.kind === "failed"}
        setAsking={setAsking}
        onClose={onClose}
        onSave={() => void run()}
      />
    </>
  )
}

export function InstructionsSheet({
  open,
  onOpenChange,
  title,
  intro,
  text,
  base,
  save,
  onSaved,
  help = "Text under a step heading reaches only that step; everything else reaches every step.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  intro: string
  /** The text the sheet opens with, and the `updated` it came from. */
  text: string
  base: number
  save: (text: string, base: number) => Promise<InstructionsOutcome>
  onSaved?: (saved: InstructionsText) => void
  help?: string
}) {
  const dirty = useRef(false)
  const content = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [asking, setAsking] = useState(false)
  const close = () => {
    dirty.current = false
    setAsking(false)
    onOpenChange(false)
  }
  const request = () => (dirty.current ? setAsking(true) : close())
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : request())}>
      <DialogContent
        ref={content}
        className="q-ins top-[max(24px,8vh)] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[640px] max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:grid-rows-[auto_minmax(0,1fr)_auto] max-sm:rounded-none"
        initialFocus={() => {
          opener.current = document.activeElement as HTMLElement | null
          return (
            content.current?.querySelector<HTMLElement>(
              "textarea, .q-ins-offer button, [data-ins-close]",
            ) ?? false
          )
        }}
        finalFocus={opener}
        data-testid="instructions-sheet"
      >
        <header className="q-ins-head">
          <DialogTitle className="m-0 text-[17px] leading-snug font-semibold">{title}</DialogTitle>
          <DialogDescription className="m-0 text-[13.5px] text-muted-foreground">
            {intro}
          </DialogDescription>
        </header>
        <Body
          text={text}
          base={base}
          save={save}
          onSaved={onSaved}
          asking={asking}
          setAsking={setAsking}
          onDirty={(next) => {
            dirty.current = next
          }}
          onClose={close}
          help={help}
        />
      </DialogContent>
    </Dialog>
  )
}
