import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { useId, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ProjectTarget } from "./ProjectPicker.tsx"
import { useProjectLooks } from "./sidebar/look-context.tsx"
import { projectLabel } from "./sidebar/project-model.ts"

function isTypedFolderPath(
  typedPath: string,
  onPath: ((path: string) => void) | undefined,
  options: ProjectTarget[],
): boolean {
  if (onPath === undefined || !/^(?:[/~]|[A-Za-z]:[\\/])/.test(typedPath)) return false
  return !options.some((item) => item.path === typedPath)
}

function FolderOptionRow({
  id,
  name,
  item,
  selected,
  highlighted,
  onActive,
  onChoose,
}: {
  id: string
  name: string
  item: ProjectTarget
  selected: boolean
  highlighted: boolean
  onActive: () => void
  onChoose: () => void
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-label={`${name} · ${item.path}`}
      aria-selected={selected}
      aria-disabled={item.available === false}
      disabled={item.available === false}
      tabIndex={-1}
      data-active={highlighted || undefined}
      title={item.path}
      onMouseMove={onActive}
      onClick={onChoose}
    >
      <span>
        <b>{item.path.split(/[\\/]/).filter(Boolean).at(-1) ?? name}</b>
        <small>{item.path}</small>
      </span>
      {item.available === false ? <small>Unavailable</small> : null}
      <span className="q-project-option-mark">
        {selected ? <CheckIcon size={13} aria-hidden="true" /> : null}
      </span>
    </button>
  )
}

function FolderOptionGroup({
  id,
  name,
  rows,
  options,
  valuePath,
  highlightedPath,
  onActive,
  onChoose,
}: {
  id: string
  name: string
  rows: ProjectTarget[]
  options: ProjectTarget[]
  valuePath: string | undefined
  highlightedPath: string | undefined
  onActive: (path: string) => void
  onChoose: (item: ProjectTarget) => void
}) {
  return (
    <fieldset aria-label={name}>
      <legend className="q-project-group" title={name}>
        {name}
      </legend>
      {rows.map((item) => (
        <FolderOptionRow
          key={item.path}
          id={`${id}-option-${options.indexOf(item)}`}
          name={name}
          item={item}
          selected={item.path === valuePath}
          highlighted={item.path === highlightedPath}
          onActive={() => onActive(item.path)}
          onChoose={() => onChoose(item)}
        />
      ))}
    </fieldset>
  )
}

function handleFolderSearchKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  ctx: {
    id: string
    options: ProjectTarget[]
    enabled: ProjectTarget[]
    selected: number
    highlighted: ProjectTarget | undefined
    pathTyped: boolean
    onActive: (path: string) => void
    onChoose: (item: ProjectTarget) => void
    onTakePath: () => void
  },
): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    if (!ctx.enabled.length) return
    const step = event.key === "ArrowDown" ? 1 : -1
    const item =
      ctx.enabled[(Math.max(0, ctx.selected) + step + ctx.enabled.length) % ctx.enabled.length]
    if (!item) return
    ctx.onActive(item.path)
    document
      .getElementById(`${ctx.id}-option-${ctx.options.indexOf(item)}`)
      ?.scrollIntoView({ block: "nearest" })
    return
  }
  if (event.key !== "Enter") return
  if (ctx.highlighted) {
    event.preventDefault()
    ctx.onChoose(ctx.highlighted)
  } else if (ctx.pathTyped) {
    event.preventDefault()
    ctx.onTakePath()
  }
}

function ProjectFolderMenu({
  id,
  inputRef,
  options,
  shown,
  groups,
  looks,
  value,
  highlighted,
  search,
  typedPath,
  pathTyped,
  onSearch,
  onKeyDown,
  onActive,
  onChoose,
  onTakePath,
}: {
  id: string
  inputRef: React.RefObject<HTMLInputElement | null>
  options: ProjectTarget[]
  shown: ProjectTarget[]
  groups: string[]
  looks: ReturnType<typeof useProjectLooks>
  value: ProjectTarget | null
  highlighted: ProjectTarget | undefined
  search: string
  typedPath: string
  pathTyped: boolean
  onSearch: (next: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onActive: (path: string) => void
  onChoose: (item: ProjectTarget) => void
  onTakePath: () => void
}) {
  return (
    <PopoverContent
      className="q-project-menu"
      align="start"
      collisionPadding={16}
      initialFocus={inputRef}
    >
      <input
        ref={inputRef}
        className="q-input"
        aria-label="Search projects or folders"
        aria-controls={`${id}-folders`}
        aria-activedescendant={
          highlighted ? `${id}-option-${options.indexOf(highlighted)}` : undefined
        }
        value={search}
        placeholder="Search projects or folders…"
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div
        id={`${id}-folders`}
        className="q-project-options"
        role="listbox"
        aria-label="Project folders"
      >
        {groups.map((group) => {
          const rows = shown.filter((item) => item.project.id === group)
          const first = rows[0]
          if (!first) return null
          return (
            <FolderOptionGroup
              key={group}
              id={id}
              name={projectLabel(first.project, looks)}
              rows={rows}
              options={options}
              valuePath={value?.path}
              highlightedPath={highlighted?.path}
              onActive={onActive}
              onChoose={onChoose}
            />
          )
        })}
        {pathTyped ? (
          <button
            type="button"
            role="option"
            aria-selected={false}
            tabIndex={-1}
            data-active={!highlighted || undefined}
            title={typedPath}
            onClick={onTakePath}
          >
            <span>
              <b>Use this folder</b>
              <small>{typedPath}</small>
            </span>
            <span className="q-project-option-mark" />
          </button>
        ) : !shown.length ? (
          <p>No matching project folders.</p>
        ) : null}
      </div>
    </PopoverContent>
  )
}

/** The path stays searchable in full; the menu presents one group per registered project. */
export function ProjectFolderSelect({
  options,
  value,
  onChange,
  disabled,
  label,
  onPath,
}: {
  options: ProjectTarget[]
  value: ProjectTarget | null
  onChange(value: ProjectTarget): void
  disabled: boolean
  label: string
  /** Where folders are typed (a machine's page): a typed absolute path no project matches is used as it is. */
  onPath?(path: string): void
}) {
  const looks = useProjectLooks()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState("")
  const needle = search.trim().toLocaleLowerCase()
  const shown = options.filter((item) =>
    `${projectLabel(item.project, looks)} ${item.path}`.toLocaleLowerCase().includes(needle),
  )
  const enabled = shown.filter((item) => item.available !== false)
  const selected = enabled.findIndex((item) => item.path === active)
  const highlighted = enabled[Math.max(0, selected)]
  const groups = [...new Set(shown.map((item) => item.project.id))]
  const typedPath = search.trim()
  const pathTyped = isTypedFolderPath(typedPath, onPath, options)
  const openMenu = () => {
    setSearch("")
    setActive(value?.path ?? "")
    setOpen(true)
  }
  const takePath = () => {
    if (!pathTyped) return
    onPath?.(typedPath)
    setOpen(false)
  }
  const choose = (item: ProjectTarget) => {
    if (item.available === false) return
    onChange(item)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={(next) => (next ? openMenu() : setOpen(false))}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="q-project-trigger"
            role="combobox"
            aria-label={label}
            aria-controls={`${id}-folders`}
            aria-expanded={open}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                openMenu()
              }
            }}
          />
        }
      >
        <span>
          <b>{value ? projectLabel(value.project, looks) : "Choose a project folder"}</b>
          {value ? (
            <small title={value.path}>
              {value.path}
              {value.available === false ? " · Unavailable" : ""}
            </small>
          ) : null}
        </span>
        <ChevronDownIcon size={14} aria-hidden="true" />
      </PopoverTrigger>
      <ProjectFolderMenu
        id={id}
        inputRef={input}
        options={options}
        shown={shown}
        groups={groups}
        looks={looks}
        value={value}
        highlighted={highlighted}
        search={search}
        typedPath={typedPath}
        pathTyped={pathTyped}
        onSearch={setSearch}
        onKeyDown={(event) =>
          handleFolderSearchKey(event, {
            id,
            options,
            enabled,
            selected,
            highlighted,
            pathTyped,
            onActive: setActive,
            onChoose: choose,
            onTakePath: takePath,
          })
        }
        onActive={setActive}
        onChoose={choose}
        onTakePath={takePath}
      />
    </Popover>
  )
}
