// The page picker in an artifact's header, after its name: the open page, where it sits in the list and every
// page in one menu, the way a design tool switches files. A row of tabs ran off the window once an artifact had
// many pages. More than eight pages add a filter at the top of the menu.

import { CheckIcon, ChevronsUpDownIcon, FileIcon, SearchIcon } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * One page of the list: `key` is what `onPick` gets back, `label` is what the person reads. A page with a `group`
 * sits under that heading (with its page count); `groupFolded` makes the group a closed fold, as the explorations of a long list.
 */
export type PageChoice = {
  key: string
  label: string
  mark?: ReactNode
  group?: string
  groupFolded?: boolean
}

export type PageGroup = { name: string | null; folded: boolean; pages: PageChoice[] }

/** The pages under their group headings, groups in the order they first appear; pages without a group lead, unheaded. */
export function groupedPages(pages: readonly PageChoice[]): PageGroup[] {
  const groups: PageGroup[] = []
  for (const page of pages) {
    const name = page.group ?? null
    let group = groups.find((g) => g.name === name)
    if (group === undefined) {
      group = { name, folded: page.groupFolded === true, pages: [] }
      groups.push(group)
    }
    group.pages.push(page)
  }
  return groups.sort((a, b) => Number(a.name !== null) - Number(b.name !== null))
}

/** The widest the picker button grows, in px (artifact.css `.dg-pp`): a longer title is cut by this, not by the room. */
export const PICKER_WIDTH_CAP = 280

/** More pages than this show the filter field. */
export const FILTER_FROM = 8

/** The pages whose label contains what was typed, in their order; everything while the field is empty. */
export function matchingPages(pages: readonly PageChoice[], typed: string): PageChoice[] {
  const wanted = typed.trim().toLowerCase()
  return wanted === "" ? [...pages] : pages.filter((p) => p.label.toLowerCase().includes(wanted))
}

function PagePickerFilter({
  total,
  typed,
  onType,
  firstKey,
  onPick,
  listRef,
}: {
  total: number
  typed: string
  onType: (value: string) => void
  firstKey: string | undefined
  onPick: (key: string) => void
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <label className="dg-pp-find">
      <SearchIcon aria-hidden="true" />
      <input
        // biome-ignore lint/a11y/noAutofocus: the filter is the first thing a long list is for
        autoFocus
        value={typed}
        placeholder={`Find among ${total} pages`}
        aria-label="Find a page"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onType(event.target.value)}
        onKeyDown={(event) => {
          // The menu would take typed letters for its typeahead and the arrows for its own walk.
          if (event.key === "Escape") return
          event.stopPropagation()
          if (event.key === "Enter" && firstKey !== undefined) {
            event.preventDefault()
            onPick(firstKey)
          } else if (event.key === "ArrowDown") {
            event.preventDefault()
            listRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
          }
        }}
      />
    </label>
  )
}

function PageGroupSection({
  group,
  currentKey,
  typed,
  unfolded,
  onToggleGroup,
  onPick,
}: {
  group: PageGroup
  currentKey: string
  typed: string
  unfolded: ReadonlySet<string>
  onToggleGroup: (name: string) => void
  onPick: (key: string) => void
}) {
  // A folded group opens by itself while filtering or when it holds the open page.
  const open =
    !group.folded ||
    typed.trim() !== "" ||
    group.pages.some((p) => p.key === currentKey) ||
    (group.name !== null && unfolded.has(group.name))
  return (
    <div>
      {group.name === null ? null : group.folded ? (
        <button
          type="button"
          className="dg-pp-gh"
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleGroup(group.name as string)
          }}
        >
          <span>{group.name}</span>
          <span className="dg-pp-gn">{group.pages.length}</span>
        </button>
      ) : (
        <div className="dg-pp-gh" role="presentation">
          <span>{group.name}</span>
          <span className="dg-pp-gn">{group.pages.length}</span>
        </div>
      )}
      {open
        ? group.pages.map((p) => (
            <DropdownMenuItem
              key={p.key}
              role="menuitemradio"
              aria-checked={p.key === currentKey}
              onClick={() => onPick(p.key)}
            >
              <FileIcon aria-hidden="true" className="dg-pp-ic" />
              <span className="dg-pp-row">{p.label}</span>
              {p.mark ?? null}
              {p.key === currentKey ? <CheckIcon aria-hidden="true" className="dg-pp-ck" /> : null}
            </DropdownMenuItem>
          ))
        : null}
    </div>
  )
}

export function PagePicker({
  pages,
  value,
  onPick,
}: {
  pages: readonly PageChoice[]
  value: string
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const list = useRef<HTMLDivElement>(null)
  if (pages.length < 2) return null
  const at = Math.max(
    0,
    pages.findIndex((p) => p.key === value),
  )
  const current = pages[at]
  if (current === undefined) return null
  const shown = matchingPages(pages, typed)
  const pick = (key: string) => {
    setOpen(false)
    onPick(key)
  }
  const toggleGroup = (name: string) =>
    setUnfolded((was) => {
      const next = new Set(was)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  return (
    <>
      <span className="dg-pp-sl" aria-hidden="true">
        /
      </span>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setTyped("")
            setUnfolded(new Set())
          }
        }}
      >
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="dg-pp"
              data-testid="artifact-page-picker"
              aria-label={`Page: ${current.label}, ${at + 1} of ${pages.length}`}
              title={current.label}
            />
          }
        >
          <FileIcon aria-hidden="true" />
          <span className="dg-pp-nm">{current.label}</span>
          <span className="dg-pp-n">
            {at + 1}/{pages.length}
          </span>
          <ChevronsUpDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="flex max-h-[min(420px,var(--available-height))] w-[280px] max-w-[280px] min-w-0 flex-col overflow-hidden p-0"
          aria-label="Pages of this artifact"
        >
          {pages.length > FILTER_FROM ? (
            <PagePickerFilter
              total={pages.length}
              typed={typed}
              onType={setTyped}
              firstKey={shown[0]?.key}
              onPick={pick}
              listRef={list}
            />
          ) : null}
          <div className="dg-pp-list" ref={list}>
            {groupedPages(shown).map((group) => (
              <PageGroupSection
                key={group.name ?? ""}
                group={group}
                currentKey={current.key}
                typed={typed}
                unfolded={unfolded}
                onToggleGroup={toggleGroup}
                onPick={pick}
              />
            ))}
            {shown.length === 0 ? (
              <p className="dg-pp-none">No page matches “{typed.trim()}”</p>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
