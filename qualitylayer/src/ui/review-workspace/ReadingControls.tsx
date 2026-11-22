import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CodeXmlIcon,
  Columns2Icon,
  FileIcon,
  FileTextIcon,
  LayersIcon,
  ListFilterIcon,
  ListTreeIcon,
  type LucideIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Rows2Icon,
  WorkflowIcon,
} from "lucide-react"
import type { WalkRound } from "../../core/review/walkthrough.ts"
export type ReadingMode = "diff" | "file"
export type MarkdownMode = "source" | "rendered"

function Choice({
  label,
  hint,
  choices,
  value,
  onChange,
  className,
}: {
  label: string
  /** The group's tooltip: what it chooses, in place of a label before it. */
  hint?: string
  choices: readonly { value: string; label: string; icon: LucideIcon; disabled?: boolean }[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <fieldset className={className ? `rw-seg ${className}` : "rw-seg"} title={hint ?? label}>
      <legend className="sr-only">{label}</legend>
      {choices.map(({ value: id, label: text, icon: Icon, disabled }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          <Icon size={13} aria-hidden="true" />
          {text}
        </button>
      ))}
    </fieldset>
  )
}

function FocusToggle({ focus, onFocus }: { focus?: boolean; onFocus?: () => void }) {
  if (!onFocus) return null
  return (
    <button
      type="button"
      className="rw-btn quiet rw-focus-toggle"
      aria-pressed={focus === true}
      title={focus ? "Show file tree" : "Focus mode: hide file tree"}
      onClick={onFocus}
    >
      {focus ? (
        <PanelLeftOpenIcon size={13} aria-hidden="true" />
      ) : (
        <PanelLeftCloseIcon size={13} aria-hidden="true" />
      )}
      {focus ? "Show tree" : "Focus"}
    </button>
  )
}

function RoundScopeChoice({
  rounds,
  sinceRound,
  onSinceRound,
}: {
  rounds?: readonly WalkRound[]
  sinceRound?: string | null
  onSinceRound?: (revision: string | null) => void
}) {
  if (!rounds || rounds.length < 2 || !onSinceRound) return null
  const prevRound = rounds.at(-2)
  const latestRound = rounds.at(-1)
  if (!prevRound || !latestRound) return null
  return (
    <div className="rw-mode">
      <Choice
        label="Review round scope"
        hint="Review the whole change or only files changed since the previous round"
        value={sinceRound === prevRound.revision ? "since" : "all"}
        onChange={(value) => onSinceRound(value === "since" ? prevRound.revision : null)}
        choices={[
          { value: "all", label: `Round ${latestRound.n}`, icon: LayersIcon },
          {
            value: "since",
            label: `Since R${prevRound.n} (${prevRound.files.length})`,
            icon: ClockIcon,
          },
        ]}
      />
    </div>
  )
}

function SliceFlowToggle({
  hasDiagrams,
  showDiagrams,
  onToggleDiagrams,
}: {
  hasDiagrams?: boolean
  showDiagrams?: boolean
  onToggleDiagrams?: () => void
}) {
  if (!hasDiagrams || !onToggleDiagrams) return null
  return (
    <button
      type="button"
      className="rw-btn quiet rw-diagrams-toggle"
      aria-pressed={showDiagrams === true}
      onClick={onToggleDiagrams}
    >
      <WorkflowIcon size={13} aria-hidden="true" />
      {showDiagrams ? "Back to diff" : "Slice flow"}
    </button>
  )
}

export function ReadingControls({
  index,
  count,
  onGo,
  only,
  onOnly,
  mode,
  onMode,
  split,
  onSplit,
  markdown,
  format,
  onFormat,
  modified,
  mobileFileTree,
  focus,
  onFocus,
  rounds,
  sinceRound,
  onSinceRound,
  hasDiagrams,
  showDiagrams,
  onToggleDiagrams,
}: {
  index: number
  count: number
  onGo: (offset: number) => void
  only: boolean
  onOnly: (only: boolean) => void
  mode: ReadingMode
  onMode: (mode: ReadingMode) => void
  split: boolean
  onSplit: (split: boolean) => void
  markdown: boolean
  format: MarkdownMode
  onFormat: (format: MarkdownMode) => void
  modified: boolean
  mobileFileTree?: { open: boolean; toggle: () => void }
  focus?: boolean
  onFocus?: () => void
  rounds?: readonly WalkRound[]
  sinceRound?: string | null
  onSinceRound?: (revision: string | null) => void
  hasDiagrams?: boolean
  showDiagrams?: boolean
  onToggleDiagrams?: () => void
}) {
  return (
    <div className="rw-reading-controls">
      {mobileFileTree && (
        <button
          type="button"
          className="rw-btn rw-mobile-file-toggle"
          aria-expanded={mobileFileTree.open}
          onClick={mobileFileTree.toggle}
        >
          <ListTreeIcon size={13} aria-hidden="true" /> Files ({count})
        </button>
      )}
      <FocusToggle focus={focus} onFocus={onFocus} />
      <div className="rw-navigation">
        <button
          type="button"
          className="rw-btn quiet"
          disabled={index <= 0}
          onClick={() => onGo(-1)}
        >
          <ChevronUpIcon size={13} aria-hidden="true" />
          Previous
        </button>
        <span>{index < 0 ? "Choose a file" : `File ${index + 1} of ${count}`}</span>
        <button
          type="button"
          className="rw-btn quiet"
          disabled={index < 0 || index >= count - 1}
          onClick={() => onGo(1)}
        >
          Next
          <ChevronDownIcon size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="rw-mode">
        <Choice
          label="Files shown"
          hint="Files shown: one at a time or all of them"
          value={only ? "one" : "all"}
          onChange={(value) => onOnly(value === "one")}
          choices={[
            { value: "one", label: "One file", icon: FileIcon },
            { value: "all", label: "All files", icon: ListTreeIcon, disabled: mode === "file" },
          ]}
        />
      </div>
      <div className="rw-mode">
        <Choice
          label="File view"
          hint="View: the diff or the full file"
          value={mode}
          onChange={(value) => onMode(value as ReadingMode)}
          choices={[
            { value: "diff", label: "Diff", icon: ListFilterIcon },
            { value: "file", label: "Full file", icon: FileTextIcon },
          ]}
        />
      </div>
      {mode === "diff" && (!only || modified) ? (
        <Choice
          label="Diff layout"
          className="rw-split-choice"
          value={split ? "split" : "unified"}
          onChange={(value) => onSplit(value === "split")}
          choices={[
            { value: "unified", label: "Unified", icon: Rows2Icon },
            { value: "split", label: "Split", icon: Columns2Icon },
          ]}
        />
      ) : mode === "file" && markdown ? (
        <Choice
          label="Markdown view"
          value={format}
          onChange={(value) => onFormat(value as MarkdownMode)}
          choices={[
            { value: "source", label: "Source", icon: CodeXmlIcon },
            { value: "rendered", label: "Rendered", icon: BookOpenIcon },
          ]}
        />
      ) : null}
      <RoundScopeChoice rounds={rounds} sinceRound={sinceRound} onSinceRound={onSinceRound} />
      <SliceFlowToggle
        hasDiagrams={hasDiagrams}
        showDiagrams={showDiagrams}
        onToggleDiagrams={onToggleDiagrams}
      />
    </div>
  )
}
