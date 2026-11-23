// A project's menu, defined once and drawn two ways: the ⋯ button opens it as a dropdown under the
// button, with the Color row of eight swatches and the folder's path at the foot; a right-click on the
// header opens the same actions at the pointer through the App's point menu, which takes plain items,
// so its "Color…" opens the dropdown for that project. The menu only draws the choices; what each one
// does is the list's (`ProjectList`).

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsDownUpIcon,
  CopyIcon,
  EyeOffIcon,
  FolderOpenIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { PROJECT_COLORS, type ProjectColor } from "../../core/project-look.ts"
import { type PointItem, usePointAnchor, usePointMenu } from "../kit/PointMenu.tsx"
import { offersHostActions } from "../machines/framed.ts"
import type { ProjectFacts } from "./project-model.ts"

/** A project as the menu needs it: its facts and whether it can move up or down. */
export type MenuProject = ProjectFacts & { first: boolean; last: boolean }

/** What each choice does. An absent action leaves its item out of the menu. */
export type MenuActions = {
  newTask?: (id: string) => void
  rename: (id: string) => void
  color: (id: string, color: ProjectColor) => void
  move: (id: string, step: -1 | 1) => void
  foldOthers: (id: string) => void
  reveal?: (id: string) => void
  copyPath: (id: string) => void
  hide: (id: string) => void
}

const COLOR_NAME: Record<ProjectColor, string> = {
  gray: "Gray",
  slate: "Slate",
  teal: "Teal",
  green: "Green",
  olive: "Olive",
  brown: "Brown",
  rose: "Rose",
  plum: "Plum",
}

type Entry =
  | {
      kind: "item"
      label: string
      icon: ReactNode
      /** The key that does the same, shown at the item's end. */
      hint?: string
      disabled?: boolean
      run: () => void
    }
  | { kind: "colors" }
  | { kind: "separator" }

/** The one list of choices both menus draw. */
function entriesOf(p: MenuProject, a: MenuActions): Entry[] {
  const out: Entry[] = []
  const newTask = a.newTask
  if (newTask !== undefined)
    out.push({
      kind: "item",
      label: "New task here",
      icon: <PlusIcon aria-hidden="true" />,
      run: () => newTask(p.id),
    })
  out.push(
    {
      kind: "item",
      label: "Rename",
      icon: <PencilIcon aria-hidden="true" />,
      run: () => a.rename(p.id),
    },
    { kind: "colors" },
    { kind: "separator" },
    {
      kind: "item",
      label: "Move up",
      icon: <ArrowUpIcon aria-hidden="true" />,
      hint: "⌥↑",
      disabled: p.first,
      run: () => a.move(p.id, -1),
    },
    {
      kind: "item",
      label: "Move down",
      icon: <ArrowDownIcon aria-hidden="true" />,
      hint: "⌥↓",
      disabled: p.last,
      run: () => a.move(p.id, 1),
    },
    {
      kind: "item",
      label: "Fold the others",
      icon: <ChevronsDownUpIcon aria-hidden="true" />,
      run: () => a.foldOthers(p.id),
    },
    { kind: "separator" },
  )
  const reveal = a.reveal
  if (reveal !== undefined && p.folder !== "" && offersHostActions())
    out.push({
      kind: "item",
      label: "Open in Finder",
      icon: <FolderOpenIcon aria-hidden="true" />,
      run: () => reveal(p.id),
    })
  if (p.folder !== "")
    out.push({
      kind: "item",
      label: "Copy path",
      icon: <CopyIcon aria-hidden="true" />,
      run: () => a.copyPath(p.id),
    })
  out.push({
    kind: "item",
    label: "Hide from the list",
    icon: <EyeOffIcon aria-hidden="true" />,
    run: () => a.hide(p.id),
  })
  return out
}

/** Separators only between two items, never first, last or doubled. */
function tidy<T extends { kind: string }>(entries: T[]): T[] {
  const out: T[] = []
  for (const entry of entries) {
    if (
      entry.kind === "separator" &&
      (out.length === 0 || out[out.length - 1]?.kind === "separator")
    )
      continue
    out.push(entry)
  }
  while (out[out.length - 1]?.kind === "separator") out.pop()
  return out
}

/** The eight project colors as a row of swatches; the pressed one is the project's. */
export function ColorSwatches({
  color: current,
  onPick,
}: {
  color: ProjectColor
  onPick: (color: ProjectColor) => void
}) {
  return (
    <div className="pj-menu-colors">
      <p className="pj-menu-sh">Color</p>
      <fieldset aria-label="Color" className="pj-swatches">
        {PROJECT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="pj-swatch"
            aria-label={COLOR_NAME[color]}
            aria-pressed={current === color}
            title={COLOR_NAME[color]}
            data-color={color}
            style={{
              background: `var(--ql-proj-${color}-bg)`,
              color: `var(--ql-proj-${color}-ink)`,
            }}
            onClick={() => onPick(color)}
            onKeyDown={(event) => {
              // The swatches are a row: ← and → walk it, as the arrows of a menu would.
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              const row = Array.from(
                event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("button") ?? [],
              )
              const at = row.indexOf(event.currentTarget)
              const step = event.key === "ArrowRight" ? 1 : -1
              const next = row[(at + step + row.length) % row.length]
              if (next !== undefined) {
                event.preventDefault()
                event.stopPropagation()
                next.focus()
              }
            }}
          />
        ))}
      </fieldset>
    </div>
  )
}

type Dropdown = { id: string; x: number; y: number; align: "start" | "end" }

function toPointItems(
  project: MenuProject,
  actions: MenuActions,
  onColor: () => void,
): PointItem[] {
  return tidy(entriesOf(project, actions)).map((entry): PointItem => {
    if (entry.kind === "separator") return "separator"
    if (entry.kind === "colors") {
      return {
        label: "Color…",
        icon: <PaletteIcon aria-hidden="true" />,
        onSelect: onColor,
      }
    }
    return {
      label: entry.label,
      icon: entry.icon,
      disabled: entry.disabled,
      onSelect: entry.run,
    }
  })
}

function ProjectDropdownEntries({
  project,
  actions,
}: {
  project: MenuProject
  actions: MenuActions
}) {
  return (
    <>
      {tidy(entriesOf(project, actions)).map((entry, i) => {
        if (entry.kind === "separator")
          // biome-ignore lint/suspicious/noArrayIndexKey: a separator has no identity but its place
          return <DropdownMenuSeparator key={`sep-${i}`} />
        if (entry.kind === "colors")
          return (
            <ColorSwatches
              key="colors"
              color={project.color}
              onPick={(color) => actions.color(project.id, color)}
            />
          )
        return (
          <DropdownMenuItem key={entry.label} disabled={entry.disabled} onClick={entry.run}>
            {entry.icon}
            <span className="flex-1">{entry.label}</span>
            {entry.hint !== undefined ? (
              <span className="pj-menu-key" aria-hidden="true">
                {entry.hint}
              </span>
            ) : null}
          </DropdownMenuItem>
        )
      })}
      {project.folder !== "" ? (
        <p className="pj-menu-path" title={project.folder}>
          {project.folder}
        </p>
      ) : null}
    </>
  )
}

/**
 * `open(id, event)` is what the header's ⋯ button and its right-click call: a click opens the
 * dropdown under the button, a contextmenu event opens the point menu. Render `node` once.
 */
export function useProjectMenu({
  projects,
  actions,
  focusHeader,
}: {
  projects: MenuProject[]
  actions: MenuActions
  /** Where the focus goes back to when the dropdown closes: the project's header. */
  focusHeader: (id: string) => void
}) {
  const point = usePointMenu()
  const [dropdown, setDropdown] = useState<Dropdown | null>(null)
  const anchor = usePointAnchor(dropdown?.x ?? 0, dropdown?.y ?? 0)
  const project = projects.find((p) => p.id === dropdown?.id)

  const open = (id: string, event: React.MouseEvent) => {
    const target = projects.find((p) => p.id === id)
    if (target === undefined) return
    if (event.type === "contextmenu") {
      // The point menu closes with the choice and the project's dropdown opens at the same spot.
      point.open(
        event,
        toPointItems(target, actions, () =>
          setDropdown({ id, x: event.clientX, y: event.clientY, align: "start" }),
        ),
      )
      return
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setDropdown({ id, x: box.right, y: box.bottom, align: "end" })
  }

  const node = (
    <>
      {point.menu}
      <DropdownMenu
        open={dropdown !== null}
        onOpenChange={(next) => (next ? undefined : setDropdown(null))}
      >
        <DropdownMenuContent
          anchor={anchor}
          align={dropdown?.align ?? "end"}
          sideOffset={4}
          className="pj-menu w-max min-w-56"
          data-testid="project-menu"
          aria-label={project !== undefined ? `${project.label} options` : "Project options"}
          finalFocus={() => {
            // The anchor is not a control: the focus goes back to the project's header.
            if (dropdown !== null) focusHeader(dropdown.id)
            return false
          }}
        >
          {project !== undefined ? (
            <ProjectDropdownEntries project={project} actions={actions} />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
  return { open, node }
}
