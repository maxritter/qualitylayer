import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import type {
  MemoryApi,
  MemoryRepositoryApi,
  MemoryRepositoryConflicts,
  MemoryRepositoryOperation,
} from "../../../memory-contracts.ts"
import { useEventCount, useQuery } from "../../hooks.ts"
import { SettingRow } from "../Rows.tsx"
import { OperationPreview, ProjectPicker, useProjectChoices } from "./ProjectPicker.tsx"
import { rememberResult } from "./receipt.ts"

type Conflict = NonNullable<MemoryRepositoryConflicts["next"]>
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "This operation could not finish. Try again."

type OperationProps = {
  operation: MemoryRepositoryOperation
  api: MemoryApi
  repository: MemoryRepositoryApi
  paused: boolean
  initialProject?: string
  receipt?: string
  busy: boolean
  setBusy: (busy: boolean) => void
  close: () => void
  changed: () => void
  compare: (conflict: Conflict) => void
}

function useOperation({
  operation,
  api,
  repository,
  paused,
  initialProject,
  receipt,
  setBusy,
  changed,
}: OperationProps) {
  const revision = useEventCount("memory")
  const { page, options, selected, select, loadMore } = useProjectChoices(api, initialProject)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<ReturnType<typeof rememberResult> | null>(
    receipt ? { message: receipt, problem: undefined } : null,
  )
  const [next, setNext] = useState<Conflict>()
  const isExport = operation === "export"
  const consent = selected && (overrides[selected.id] ?? selected.sharing)
  const preview = useQuery(
    () => (selected ? repository.preview(selected.id, operation) : Promise.resolve(null)),
    [repository, selected?.id, operation, revision],
  )
  const action = async (perform: () => Promise<void>) => {
    setBusy(true)
    setFailure(null)
    try {
      await perform()
    } catch (cause) {
      setFailure(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const project = selected?.id
  const unavailable = paused || !preview.data?.count || Boolean(preview.error)
  const exportDisabled = isExport && !consent
  const execute = (project: string) =>
    action(async () => {
      const result = await repository[operation](project)
      setResult(rememberResult(operation, result))
      changed()
      if (result.conflicts > 0) setNext((await repository.conflicts(project)).next)
    })
  const chooseProject = (value: string) => {
    select(value)
    setFailure(null)
    setResult(null)
    setNext(undefined)
  }
  const saveConsent = (enabled: boolean) => {
    if (!selected) return
    void action(async () => {
      const updated = await api.sharing(selected.id, enabled)
      setOverrides((before) => ({ ...before, [updated.id]: updated.sharing }))
      setResult(null)
      changed()
    })
  }
  return {
    page,
    options,
    selected,
    consent,
    preview,
    result,
    next,
    failure,
    chooseProject,
    loadMore: loadMore && (() => void action(loadMore)),
    saveConsent,
    blocked: unavailable || exportDisabled,
    execute: () => {
      if (project) void execute(project)
    },
  }
}

export function RepositoryOperation(props: OperationProps) {
  const { operation, paused, busy, close, compare } = props
  const isExport = operation === "export"
  const {
    page,
    options,
    selected,
    consent,
    preview,
    result,
    next,
    failure,
    chooseProject,
    loadMore,
    saveConsent,
    blocked,
    execute,
  } = useOperation(props)
  return (
    <>
      <DialogTitle>{isExport ? "Project Git storage" : "Restore from repository"}</DialogTitle>
      <DialogDescription className="sr-only">
        {isExport
          ? "Choose which project can export lessons to Git."
          : "Read tracked lessons from a Git project."}
      </DialogDescription>
      <ProjectPicker
        page={page}
        options={options}
        selected={selected}
        disabled={busy}
        choose={chooseProject}
        loadMore={loadMore}
      />
      {isExport && selected ? (
        <SettingRow label="Store project lessons in Git" hint="Changes save immediately." stay>
          <Switch
            checked={Boolean(consent)}
            aria-label={`Store lessons in Git for ${selected.name}`}
            disabled={busy}
            onCheckedChange={saveConsent}
          />
        </SettingRow>
      ) : null}
      {selected && !result ? (
        <OperationPreview preview={preview} name={selected.name} isExport={isExport} />
      ) : null}
      {isExport ? (
        <p className="text-muted-foreground">
          Anyone with repository access can read exported lessons. To remove exported files, delete
          them from the repository and commit that change.
        </p>
      ) : null}
      {paused ? (
        <p className="text-muted-foreground">
          Turn on local memory to {operation === "export" ? "export" : "restore"} lessons.
        </p>
      ) : null}
      {result ? <p role="status">{result.message}</p> : null}
      {result?.problem || failure ? <p role="alert">{failure ?? result?.problem}</p> : null}
      {next ? (
        <SettingRow label="A lesson needs a version choice">
          <Button type="button" variant="outline" onClick={() => compare(next)}>
            Compare versions
          </Button>
        </SettingRow>
      ) : null}
      <OperationFooter
        isExport={isExport}
        result={result}
        failure={failure}
        busy={busy}
        blocked={blocked}
        execute={execute}
        close={close}
      />
    </>
  )
}

function OperationFooter({
  isExport,
  result,
  failure,
  busy,
  blocked,
  execute,
  close,
}: {
  isExport: boolean
  result: ReturnType<typeof rememberResult> | null
  failure: string | null
  busy: boolean
  blocked: boolean
  execute: () => void
  close: () => void
}) {
  const isRestoreInput = !isExport && (!result || Boolean(result.problem))
  const actionLabel = isExport
    ? "Export now"
    : failure || result?.problem
      ? "Try again"
      : "Restore lessons"
  const exit = (
    <Button
      type="button"
      variant={isExport || result ? "default" : "outline"}
      disabled={busy}
      onClick={close}
      className={isRestoreInput ? undefined : "ml-auto"}
    >
      {isExport || result ? "Done" : "Cancel"}
    </Button>
  )
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {isRestoreInput ? exit : null}
      {isExport || isRestoreInput ? (
        <Button
          type="button"
          variant={isExport ? "outline" : "default"}
          disabled={busy || blocked}
          onClick={execute}
        >
          {busy ? "Working…" : actionLabel}
        </Button>
      ) : null}
      {isRestoreInput ? null : exit}
    </div>
  )
}
