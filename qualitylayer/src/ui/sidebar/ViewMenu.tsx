// The View menu under the sliders button of the list header: how the list is grouped (Project or
// Status), which tasks it shows (All open, What needs you, Running, Shipped, each with its
// count), which agent's, how tall the rows are, and Fold all / Unfold all projects, with the keys
// the list answers to. Group by, rows and folds are the viewer's own; Show and Agent are the filter
// the page keeps. The button marks active filters and the open panel.

import { cn } from "cn"
import {
  AlignJustifyIcon,
  CheckIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleDotIcon,
  EqualIcon,
  FolderIcon,
  RectangleHorizontalIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { AGENT_DISPLAY_ORDER, AGENT_NAMES, isNativeAgent } from "../../core/agents/ids.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { InfoHint } from "../kit/InfoHint.tsx"
import { ModelPick } from "../ModelPick.tsx"
import type { Need } from "../model.ts"
import { Segmented } from "../Segmented.tsx"
import { ACTIVITY_CHOICES, type ActivityWindow } from "./activity.ts"

export type GroupBy = "project" | "status"
/** How tall the task rows are: detailed (the default), two lines or one. */
export const ROW_HEIGHTS = ["detailed", "two", "one"] as const
export type RowsHeight = (typeof ROW_HEIGHTS)[number]

/** The Show choices, in the menu's words, with the filter value each one sets. */
export const SHOW_CHOICES: { need: Need; label: string; mark: string | null }[] = [
  { need: "", label: "All open", mark: null },
  { need: "you", label: "What needs you", mark: "q-m-you" },
  { need: "running", label: "Running", mark: "q-m-agent" },
  { need: "shipped", label: "Shipped", mark: "q-m-done" },
]

export type ViewMenuProps = {
  /** What the name filter holds: the list shows the tasks and projects whose name has these words. */
  query: string
  onQuery: (query: string) => void
  groupBy: GroupBy
  onGroupBy: (value: GroupBy) => void
  need: Need
  /** How many tasks each Show choice lists, by its `need`. */
  counts: Record<Need, number>
  onNeed: (need: Need) => void
  agent: string
  onAgent: (agent: string) => void
  activity: ActivityWindow
  onActivity: (activity: ActivityWindow) => void
  rows: RowsHeight
  onRows: (rows: RowsHeight) => void
  onFoldAll: () => void
  onUnfoldAll: () => void
}

function Key({ children }: { children: string }) {
  return <kbd className="vm-kbd">{children}</kbd>
}

export function ViewMenu(props: ViewMenuProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const anchor = useRef({
    contextElement: undefined as HTMLElement | undefined,
    getBoundingClientRect: () => {
      const button = trigger.current?.getBoundingClientRect()
      const sidebar = trigger.current?.closest(".q-side")?.getBoundingClientRect()
      return new DOMRect(
        sidebar?.right ?? button?.right ?? 0,
        button?.top ?? 0,
        0,
        button?.height ?? 0,
      )
    },
  })
  const filtered =
    props.query.trim() !== "" || props.need !== "" || props.agent !== "" || props.activity !== "any"
  const byStatus = props.groupBy === "status"
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        ref={(node) => {
          trigger.current = node
          anchor.current.contextElement = node ?? undefined
        }}
        className={cn("q-ic", (open || filtered) && "on")}
        aria-label="View options"
        title="View options"
        data-changed={filtered ? "true" : undefined}
      >
        <SlidersHorizontalIcon className="size-[13px]" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        anchor={() => anchor.current}
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="vm max-h-(--available-height) w-64 gap-0 overflow-y-auto p-1.5"
        data-testid="view-menu"
        aria-label="View options"
      >
        <div className="vm-head">
          <b>View options</b>
          <button
            type="button"
            className="q-ic"
            aria-label="Close view options"
            onClick={() => setOpen(false)}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        <input
          type="text"
          className="vm-find"
          aria-label="Filter by name"
          placeholder="Filter by name"
          value={props.query}
          autoComplete="off"
          spellCheck={false}
          data-testid="find-field"
          onChange={(event) => props.onQuery(event.target.value)}
        />
        <div className="vm-filter-heading">
          <p className="vm-sh">Show</p>
          <button
            type="button"
            className="vm-reset"
            disabled={!filtered}
            onClick={() => {
              props.onQuery("")
              props.onNeed("")
              props.onAgent("")
              props.onActivity("any")
            }}
          >
            Reset filters
          </button>
        </div>
        <RadioGroup
          aria-label="Show"
          value={props.need || "open"}
          onValueChange={(value) => props.onNeed(value === "open" ? "" : (value as Need))}
        >
          {SHOW_CHOICES.map((choice) => (
            <RadioGroupItem
              key={choice.need}
              value={choice.need || "open"}
              className="vm-item vm-show"
            >
              <span className="vm-mark" aria-hidden="true">
                {choice.mark === null ? null : <i className={cn("q-m", choice.mark)} />}
              </span>
              <span className="vm-label">{choice.label}</span>
              <span className="vm-count">{props.counts[choice.need]}</span>
              <span className="vm-check">
                {props.need === choice.need ? (
                  <CheckIcon className="size-4" aria-hidden="true" />
                ) : null}
              </span>
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <p className="vm-sh">Agent</p>
        <ModelPick
          look="row"
          label="Agent"
          value={isNativeAgent(props.agent) ? props.agent : "any"}
          onChange={(next) => props.onAgent(next === "any" ? "" : next)}
          options={[
            { id: "any", name: "Any" },
            ...AGENT_DISPLAY_ORDER.map((agent) => ({ id: agent, name: AGENT_NAMES[agent] })),
          ]}
        />
        <p className="vm-sh vm-sh-info">
          Last activity
          <InfoHint text="Task changes, plus tasks working now" />
        </p>
        <ModelPick
          look="row"
          label="Last activity"
          value={props.activity}
          onChange={(next) => props.onActivity(next as ActivityWindow)}
          options={ACTIVITY_CHOICES}
        />
        <div className="vm-sep" aria-hidden="true" />
        <p className="vm-sh">Group by</p>
        <Segmented<GroupBy>
          size="sm"
          label="Group by"
          value={props.groupBy}
          onChange={props.onGroupBy}
          options={[
            {
              id: "project",
              label: "Project",
              icon: <FolderIcon aria-hidden="true" />,
              hint: "Project",
            },
            {
              id: "status",
              label: "Status",
              icon: <CircleDotIcon aria-hidden="true" />,
              hint: "Status",
            },
          ]}
        />
        <p className="vm-sh">Rows</p>
        <Segmented<RowsHeight>
          size="sm"
          label="Rows"
          value={props.rows}
          onChange={props.onRows}
          options={[
            {
              id: "detailed",
              label: "Detailed",
              icon: <AlignJustifyIcon aria-hidden="true" />,
              hint: "Detailed",
            },
            {
              id: "two",
              label: "Two lines",
              icon: <EqualIcon aria-hidden="true" />,
              hint: "Two lines",
            },
            {
              id: "one",
              label: "One line",
              icon: <RectangleHorizontalIcon aria-hidden="true" />,
              hint: "One line",
            },
          ]}
        />
        {!byStatus ? (
          <>
            <div className="vm-sep" aria-hidden="true" />
            <button type="button" className="vm-item" onClick={props.onFoldAll}>
              <ChevronsDownUpIcon className="size-4" aria-hidden="true" />
              <span className="vm-label">Fold all projects</span>
            </button>
            <button type="button" className="vm-item" onClick={props.onUnfoldAll}>
              <ChevronsUpDownIcon className="size-4" aria-hidden="true" />
              <span className="vm-label">Unfold all projects</span>
            </button>
          </>
        ) : null}
        <div className="vm-sep" aria-hidden="true" />
        <Disclosure className="vm-keys" head="Keyboard shortcuts">
          <p className="vm-hint">
            <Key>↑</Key> <Key>↓</Key> move · <Key>←</Key> <Key>→</Key> fold
            <br />
            <Key>⌥↑</Key> <Key>⌥↓</Key> move a project
          </p>
        </Disclosure>
      </PopoverContent>
    </Popover>
  )
}
