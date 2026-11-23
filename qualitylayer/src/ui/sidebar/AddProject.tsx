// Add a project, in two steps in a card under the list header's Add button: the folder (the same
// folder browser New task uses), then the name it shows in the list and its color. Add project saves
// the look and closes; Cancel, Esc or a press outside at either step closes it and changes no look.
// Choosing the folder registers the repository, as New task does, so it can be picked again later.

import { useEffect, useId, useRef, useState } from "react"
import type { ProjectColor } from "../../core/project-look.ts"
import type { Project } from "../api.ts"
import { offersHostActions } from "../machines/framed.ts"
import { type ProjectFolderApi, ProjectPicker, type ProjectTarget } from "../ProjectPicker.tsx"
import { useProjectLooks } from "./look-context.tsx"
import { ColorSwatches } from "./ProjectMenu.tsx"
import { defaultColor } from "./project-model.ts"

/** What the second step decides: the name in the list (null: the folder's own) and the color. */
export type AddedLook = { label: string | null; color: ProjectColor }

/** The last folder of a path: what the name field starts from. */
function folderName(path: string, fallback: string): string {
  const last = path.split(/[\\/]/).filter(Boolean).pop()
  return last ?? fallback
}

function useDismissAddProject(card: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  // Esc closes it; so does a press outside it and outside the Add buttons.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (document.querySelector('[data-slot$="-positioner"][data-open]')) return
      onClose()
    }
    const press = (event: PointerEvent) => {
      const at = event.target as Element | null
      if (at === null || card.current?.contains(at)) return
      if (at.closest('[data-add-project-toggle], [data-slot$="-positioner"][data-open]')) return
      onClose()
    }
    document.addEventListener("keydown", key)
    document.addEventListener("pointerdown", press)
    return () => {
      document.removeEventListener("keydown", key)
      document.removeEventListener("pointerdown", press)
    }
  }, [card, onClose])
}

function addProjectCardStyle(anchor: HTMLElement | null, compact: boolean): React.CSSProperties {
  const box = anchor?.getBoundingClientRect() ?? null
  const top = box === null ? 60 : Math.round(box.bottom + 6)
  const base: React.CSSProperties = compact
    ? { top, left: 8, right: 8 }
    : {
        top,
        left: Math.max(16, Math.min(Math.round(box?.left ?? 16), window.innerWidth - 436)),
        width: 420,
      }
  return { ...base, maxHeight: `calc(100dvh - ${top + 16}px)` }
}

function AddProjectNameForm({
  path,
  nameId,
  name,
  setName,
  color,
  setColor,
  problem,
  saving,
  onClose,
  onSave,
}: {
  path: string
  nameId: string
  name: string
  setName: (name: string) => void
  color: ProjectColor
  setColor: (color: ProjectColor) => void
  problem: string | null
  saving: boolean
  onClose: () => void
  onSave: () => void
}) {
  return (
    <form
      className="pj-add-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <p className="pj-add-folder" title={path}>
        {path}
      </p>
      <label className="pj-add-field" htmlFor={nameId}>
        Name in the list
        <input
          id={nameId}
          className="q-input pj-add-name"
          value={name}
          maxLength={40}
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: the second step starts at its one text field
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <ColorSwatches color={color} onPick={setColor} />
      {problem !== null ? (
        <p role="alert" className="q-run-error">
          {problem}
        </p>
      ) : null}
      <div className="pj-add-actions">
        <button type="button" className="q-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="q-btn primary" disabled={saving || name.trim() === ""}>
          Add project
        </button>
      </div>
    </form>
  )
}

export function AddProject({
  projects,
  folderApi,
  canChoose,
  anchor,
  compact,
  onClose,
  onAdd,
}: {
  projects: Project[]
  folderApi?: ProjectFolderApi
  /** Whether this window may choose folders (the App, or a browser it opened). */
  canChoose: boolean
  /** The list header's Add button the card hangs under. */
  anchor: HTMLElement | null
  /** A narrow window: a sheet under the top bar. */
  compact: boolean
  onClose: () => void
  /** Save the project's look. A rejection is shown in the card and the card stays open. */
  onAdd: (project: Project, look: AddedLook) => Promise<void>
}) {
  const [target, setTarget] = useState<ProjectTarget | null>(null)
  const looks = useProjectLooks()
  const [browsing, setBrowsing] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState<ProjectColor>("slate")
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const nameId = useId()

  useDismissAddProject(card, onClose)

  const choose = (picked: ProjectTarget) => {
    setTarget(picked)
    setName(
      looks.projects[picked.project.id]?.label?.trim() ||
        folderName(picked.path, picked.project.name),
    )
    setColor(defaultColor(picked.project.id))
    setProblem(null)
  }
  const save = async () => {
    if (target === null || saving) return
    const label = name.replace(/\s+/g, " ").trim()
    setSaving(true)
    setProblem(null)
    try {
      await onAdd(target.project, {
        label: label === "" || label === target.project.name ? null : label,
        color,
      })
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The project could not be added.")
      setSaving(false)
    }
  }

  return (
    <div
      ref={card}
      className="pj-add"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="add-project"
      data-step={target === null ? "folder" : "name"}
      style={addProjectCardStyle(anchor, compact)}
    >
      <div className="pj-add-h">
        <b id={titleId}>Add a project</b>
        <span className="flex-1" />
        <button type="button" className="q-link" title="Close · Esc" onClick={onClose}>
          Close · Esc
        </button>
      </div>
      {target === null ? (
        <>
          <p className="pj-add-lead">
            {offersHostActions()
              ? "A repository on this computer. Its tasks group under it. A project also appears by itself when you start a task in a repository."
              : "A repository on this machine. Type its folder’s path. Its tasks group under it."}
          </p>
          <ProjectPicker
            projects={projects}
            value={null}
            onChange={choose}
            api={folderApi}
            canChoose={canChoose}
            disabled={false}
            onBusy={setBrowsing}
          />
          <div className="pj-add-actions">
            <button type="button" className="q-btn" disabled={browsing} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <AddProjectNameForm
          path={target.path}
          nameId={nameId}
          name={name}
          setName={setName}
          color={color}
          setColor={setColor}
          problem={problem}
          saving={saving}
          onClose={onClose}
          onSave={() => void save()}
        />
      )}
    </div>
  )
}
