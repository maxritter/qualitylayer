import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type {
  MemoryRepositoryApi,
  MemoryRepositoryComparison,
  MemoryRepositoryConflicts,
  MemoryRepositoryVersion,
} from "../../../memory-contracts.ts"
import { useQuery } from "../../hooks.ts"

type Conflict = NonNullable<MemoryRepositoryConflicts["next"]>

function changedText(text: string, other: string) {
  if (text === other) return text
  const words = text.match(/\s+|\S+/g) ?? []
  const comparison = other.match(/\s+|\S+/g) ?? []
  let start = 0
  while (start < words.length && words[start] === comparison[start]) start++
  let end = 0
  while (
    end < Math.min(words.length, comparison.length) - start &&
    words.at(-1 - end) === comparison.at(-1 - end)
  )
    end++
  const changed = words.slice(start, words.length - end).join("")
  if (changed.trim() === "") return text
  return (
    <>
      {words.slice(0, start).join("")}
      <strong>{changed}</strong>
      {words.slice(words.length - end).join("")}
    </>
  )
}

export function CompareVersions({
  repository,
  conflict,
  busy,
  setBusy,
  back,
  saved,
}: {
  repository: MemoryRepositoryApi
  conflict: Conflict
  busy: boolean
  setBusy: (busy: boolean) => void
  back: () => void
  saved: (revision: number) => void
}) {
  const comparison = useQuery(
    () => repository.compare(conflict.project, conflict.id),
    [repository, conflict.project, conflict.id],
  )
  const [choice, setChoice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const compare = comparison.data
  const keep = async () => {
    if (!compare || !choice) return
    setBusy(true)
    try {
      const result = await repository.reconcile(conflict.project, conflict.id, {
        revision: compare.local.revision,
        candidate: choice,
        fingerprints: compare.candidates.map((item) => item.fingerprint),
      })
      saved(result.revision)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The version could not be saved."
      setFailure(
        /^The (lesson|versions) changed/.test(message)
          ? "The lesson changed while you were choosing."
          : message,
      )
      setChoice(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DialogTitle>Choose a lesson version</DialogTitle>
      <DialogDescription>
        Changed on this computer and in the repository for {conflict.name}.
      </DialogDescription>
      {comparison.loading ? <p role="status">Loading versions…</p> : null}
      {failure || comparison.error ? (
        <p role="alert">
          {failure ?? comparison.error?.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setFailure(null)
              setChoice(null)
              comparison.reload()
            }}
          >
            Refresh versions
          </button>
        </p>
      ) : null}
      {compare ? (
        <>
          <h3 className="text-sm font-medium">{compare.local.title}</h3>
          <VersionChoices
            compare={compare}
            choice={choice}
            choose={setChoice}
            disabled={busy || Boolean(failure) || comparison.loading}
          />
          <p>Keeping a version creates a new revision and preserves both histories.</p>
        </>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" onClick={back} disabled={busy}>
          Back
        </Button>
        <Button
          type="button"
          disabled={!choice || !compare || busy || Boolean(failure)}
          onClick={() => void keep()}
        >
          {busy ? "Saving…" : "Keep selected version"}
        </Button>
      </div>
    </>
  )
}

function VersionChoices({
  compare,
  choice,
  choose,
  disabled,
}: {
  compare: MemoryRepositoryComparison
  choice: string | null
  choose: (choice: string) => void
  disabled: boolean
}) {
  return (
    <fieldset className="grid min-w-0 gap-3" disabled={disabled}>
      <legend className="mb-2 text-sm text-muted-foreground">Version to keep using</legend>
      <Version
        name="This computer"
        value="local"
        checked={choice === "local"}
        choose={choose}
        version={compare.local}
        other={compare.candidates.length === 1 ? compare.candidates[0]?.version : undefined}
        title={compare.local.title}
      />
      {compare.candidates.map(({ fingerprint, version }, index) => (
        <Version
          key={fingerprint}
          name={
            compare.candidates.length === 1
              ? "Repository version"
              : `Repository version ${index + 1}`
          }
          value={fingerprint}
          checked={choice === fingerprint}
          choose={choose}
          version={version}
          other={compare.local}
          title={compare.local.title}
        />
      ))}
    </fieldset>
  )
}

function Version({
  name,
  value,
  checked,
  choose,
  version,
  other,
  title,
}: {
  name: string
  value: string
  checked: boolean
  choose: (value: string) => void
  version: MemoryRepositoryVersion
  other?: MemoryRepositoryVersion
  title: string
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
      <input
        type="radio"
        name="lesson-version"
        checked={checked}
        onChange={() => choose(value)}
        className="mt-1"
      />
      <span className="grid min-w-0 gap-1">
        <b>
          {name} · revision {version.revision}
          {version.state === "retired" ? " · Retired" : ""}
        </b>
        {version.title !== title ? <span className="font-medium">{version.title}</span> : null}
        <span className="whitespace-pre-wrap break-words">
          {other ? changedText(version.content, other.content) : version.content}
        </span>
      </span>
    </label>
  )
}
