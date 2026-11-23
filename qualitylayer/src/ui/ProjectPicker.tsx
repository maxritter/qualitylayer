import { FolderOpenIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import type { FolderPick, KnownProjectFolders, ProjectFolder } from "../server/projects.ts"
import type { Project } from "./api.ts"
import { offersHostActions } from "./machines/framed.ts"
import { ProjectFolderSelect } from "./ProjectFolderSelect.tsx"
import {
  beginFolderPick,
  type FolderFlowActions,
  GitInitPrompt,
  initializeAndUseFolder,
  inspectFolderPath,
  ManualFolderEntry,
  type PickedFolder,
} from "./project-picker-parts.tsx"

export type ProjectTarget = { project: Project; path: string; available?: boolean }
export type ProjectFolderApi = {
  projectFolders?(): Promise<KnownProjectFolders>
  pickProjectFolder?(path?: string, signal?: AbortSignal): Promise<FolderPick>
  projectFolder(path?: string): Promise<ProjectFolder>
  chooseProjectFolder(path: string, initialize?: boolean): Promise<ProjectTarget>
}

function useFolderAvailability(
  api: ProjectFolderApi | undefined,
  value: ProjectTarget | null,
  onChange: (value: ProjectTarget) => void,
) {
  const [availability, setAvailability] = useState<Map<string, boolean>>()
  const [availabilityFailed, setAvailabilityFailed] = useState(false)
  const listFolders = api?.projectFolders
  useEffect(() => {
    if (!listFolders) return
    let current = true
    void listFolders().then(
      (result) => {
        if (current)
          setAvailability(new Map(result.folders.map((folder) => [folder.path, folder.available])))
      },
      () => {
        if (current) setAvailabilityFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [listFolders])
  useEffect(() => {
    if (!value || !availability?.has(value.path)) return
    const available = availability.get(value.path)
    if (value.available !== available) onChange({ ...value, available })
  }, [value, availability, onChange])
  return { availability, availabilityFailed }
}

function PickerNotices({
  unavailable,
  availabilityFailed,
  canChoose,
  loading,
}: {
  unavailable: boolean
  availabilityFailed: boolean
  canChoose: boolean
  loading: boolean
}) {
  return (
    <>
      {unavailable ? (
        <p className="q-lands-note" role="status">
          This folder is unavailable. Choose an existing checkout or another folder.
        </p>
      ) : null}
      {availabilityFailed ? (
        <p className="q-lands-note">
          Folder availability could not be checked. Choose a folder to verify it.
        </p>
      ) : null}
      {!canChoose ? (
        <p className="q-lands-note">Choose another folder from the App or a browser it opened.</p>
      ) : null}
      {loading ? <p role="status">Choosing a folder…</p> : null}
    </>
  )
}

function buildKnownTargets(
  projects: Project[],
  availability: Map<string, boolean> | undefined,
  value: ProjectTarget | null,
): ProjectTarget[] {
  const known: ProjectTarget[] = projects.flatMap((project) =>
    project.paths.map((at) => ({
      project,
      path: at,
      ...(availability?.has(at) ? { available: availability.get(at) } : {}),
    })),
  )
  if (value && !known.some((item) => item.path === value.path)) known.push(value)
  return known.filter((item) => item.available !== false || item.path === value?.path)
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  api,
  canChoose,
  disabled,
  onBusy,
  label = "Project / folder",
}: {
  projects: Project[]
  value: ProjectTarget | null
  onChange(value: ProjectTarget): void
  api?: ProjectFolderApi
  canChoose: boolean
  disabled: boolean
  onBusy(busy: boolean): void
  label?: string
}) {
  const id = useId()
  const { availability, availabilityFailed } = useFolderAvailability(api, value, onChange)
  const typedOnly = !offersHostActions()
  const [path, setPath] = useState("")
  const [folder, setFolder] = useState<PickedFolder | null>(null)
  const [loading, setLoading] = useState(false)
  const [manual, setManual] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [initialize, setInitialize] = useState(false)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(onBusy)
  busy.current = onBusy
  useEffect(
    () => () => {
      sequence.current++
      controller.current?.abort()
      busy.current(false)
    },
    [],
  )
  const options = buildKnownTargets(projects, availability, value)
  const cancel = () => {
    sequence.current++
    controller.current?.abort()
    setLoading(false)
    setFolder(null)
    setManual(false)
    setProblem(null)
    setInitialize(false)
    onBusy(false)
  }
  const flow: FolderFlowActions = {
    api,
    typedOnly,
    sequence,
    controller,
    setLoading,
    setFolder,
    setManual,
    setProblem,
    setInitialize,
    onBusy,
    onChange,
    cancel,
  }
  const choosing = loading || manual || folder !== null
  const onTypedPath =
    typedOnly && api && canChoose && !disabled
      ? (typed: string) => {
          setPath(typed)
          void inspectFolderPath(flow, loading, manual, typed)
        }
      : undefined
  return (
    <div className="q-project-picker" data-testid="project-picker">
      <span className="q-project-heading">{label}</span>
      <div className="q-project-row">
        <div className="q-project-select">
          <ProjectFolderSelect
            label={label}
            value={value}
            disabled={disabled || choosing}
            onChange={onChange}
            options={options}
            onPath={onTypedPath}
          />
        </div>
        {typedOnly ? null : (
          <button
            type="button"
            className="q-btn q-project-choose"
            disabled={disabled || loading || !canChoose || !api}
            onClick={() => void beginFolderPick(flow, loading, value?.path, offersHostActions())}
          >
            <FolderOpenIcon aria-hidden="true" size={15} />
            Choose folder…
          </button>
        )}
      </div>
      <PickerNotices
        unavailable={value?.available === false}
        availabilityFailed={availabilityFailed}
        canChoose={canChoose}
        loading={loading}
      />
      {manual || (typedOnly && api) ? (
        <ManualFolderEntry
          id={id}
          path={path}
          disabled={loading || disabled || !canChoose}
          onPathChange={(next) => {
            setPath(next)
            setFolder(null)
            setInitialize(false)
          }}
          onInspect={() => void inspectFolderPath(flow, loading, manual, path)}
        />
      ) : null}
      {folder && !folder.checkout ? (
        <GitInitPrompt
          folder={folder}
          initialize={initialize}
          loading={loading}
          onToggle={setInitialize}
          onChoose={() => void initializeAndUseFolder(flow, folder, initialize, loading)}
        />
      ) : null}
      {problem ? (
        <p role="alert" className="q-run-error">
          {problem}
        </p>
      ) : null}
      {choosing ? (
        <button type="button" className="q-link" onClick={cancel}>
          Cancel folder selection
        </button>
      ) : null}
    </div>
  )
}
