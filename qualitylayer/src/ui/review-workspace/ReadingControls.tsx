import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CodeXmlIcon,
  Columns2Icon,
  FileIcon,
  FileTextIcon,
  ListFilterIcon,
  ListTreeIcon,
  type LucideIcon,
  Rows2Icon,
} from "lucide-react"
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
    </div>
  )
}
