import { Button } from "@/components/ui/button"
import { PERSONAL_PROJECT } from "../../../memory-contracts.ts"
import type { PilotGroup, PilotMigrationApi } from "../../../pilot-memory-contracts.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { ModelPick } from "../../ModelPick.tsx"
import { PilotRecords } from "./Records.tsx"
import { AdditionalFolders } from "./Source.tsx"
import type { PilotDestination, usePilotMigration } from "./usePilotMigration.ts"

type Migration = ReturnType<typeof usePilotMigration>
function DestinationPick({
  group,
  value,
  disabled,
  choose,
  change,
}: {
  group: PilotGroup
  value: PilotDestination | null | undefined
  disabled: boolean
  choose: () => void
  change: (destination: PilotDestination | null) => void
}) {
  const options = [
    { id: "leave-out", name: "Leave out" },
    { id: PERSONAL_PROJECT, name: "Yours · every project" },
  ]
  if (value && value.id !== PERSONAL_PROJECT) options.push(value)
  options.push({ id: "choose-project", name: "Choose project…" })
  return (
    <div className="q-pilot-destination">
      <span>Destination</span>
      <ModelPick
        look="setting"
        label={`Destination for ${group.roots.join(", ") || group.name}`}
        disabled={disabled}
        value={value?.id ?? "leave-out"}
        options={options}
        onChange={(id) => {
          if (id === "choose-project") choose()
          else
            change(
              id === "leave-out"
                ? null
                : { id, name: options.find((option) => option.id === id)?.name ?? id },
            )
        }}
      />
    </div>
  )
}

function MappingReviewStatus({
  migration: m,
  disabled,
}: {
  migration: Migration
  disabled: boolean
}) {
  return (
    <>
      {m.reviewing ? (
        <p role="status">Checking selected destinations…</p>
      ) : m.currentReview ? (
        <p role="status">
          <strong>{m.currentReview.toImport} to import</strong> · {m.currentReview.alreadyImported}{" "}
          already imported · {m.currentReview.leftOut} left out · {m.currentReview.conflicts}{" "}
          changed records left out
        </p>
      ) : null}
      {m.reviewError ? (
        <div role="alert">
          <p>{m.reviewError}</p>
          <Button type="button" variant="outline" disabled={disabled} onClick={m.retryReview}>
            Retry review
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => void m.scanSource()}
          >
            Scan source again
          </Button>
        </div>
      ) : null}
      {m.busy === "apply" ? (
        <p role="status">
          {m.stopping
            ? "Stopping import. Finishing the current memory…"
            : "Importing memories. You can stop; memories already saved will be kept."}
        </p>
      ) : null}
    </>
  )
}

export function PilotMapping({
  api,
  migration: m,
  choose,
}: {
  api: PilotMigrationApi
  migration: Migration
  choose: (group: string) => void
}) {
  const scan = m.scan
  if (!scan) return null
  const disabled = m.busy !== null || m.stopping
  return (
    <>
      <div className="q-pilot-body" id="pilot-mapping">
        <p>
          {scan.counts.observation + scan.counts.knowledge + scan.counts.learning} memories found.
          Choose where each group belongs.
        </p>
        <p className="q-pilot-muted">
          Pilot’s private knowledge stays with its original project unless you choose Yours.
        </p>
        {scan.archiveAt ? (
          <p>Archive source: {scan.archiveAt}. Changes made after this backup are not included.</p>
        ) : null}
        {!scan.groups.length ? (
          <p>No importable memory groups were found. Choose another source.</p>
        ) : null}
        {scan.groups.map((group) => (
          <section
            className="q-pilot-group"
            key={group.id}
            aria-label={`Pilot group ${group.name}`}
          >
            <strong>{group.name}</strong>
            {group.roots.length ? (
              group.roots.map((root) => <code key={root}>{root}</code>)
            ) : (
              <span>Original checkout not recorded</span>
            )}
            <span className="q-pilot-muted">
              {group.counts.observation} observations · {group.counts.knowledge} knowledge ·{" "}
              {group.counts.learning} session learnings
            </span>
            <DestinationPick
              group={group}
              value={m.destinations[group.id]}
              disabled={disabled}
              choose={() => choose(group.id)}
              change={(destination) =>
                m.setDestinations((current) => ({ ...current, [group.id]: destination }))
              }
            />
            <PilotRecords
              key={`${scan.id}-${group.id}`}
              api={api}
              scan={scan.id}
              group={group.id}
            />
          </section>
        ))}
        <AdditionalFolders input={m.input} onChange={m.setInput} busy={disabled} />
        {m.sourceChanged ? (
          <div role="status">
            <p>Scan the selected folders before importing.</p>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => void m.scanSource()}
            >
              Scan selected folders
            </Button>
          </div>
        ) : null}
        <label className="q-pilot-check">
          <input
            type="checkbox"
            checked={m.includeLearnings}
            disabled={disabled}
            onChange={(event) => m.setIncludeLearnings(event.target.checked)}
          />
          Include {scan.counts.learning} saved session learnings
        </label>
        <Disclosure className="q-pilot-details" head="Review records and exclusions">
          <p>
            {scan.counts.invalid} invalid · {scan.counts.excluded} excluded. Retired records and
            changed records that conflict with an existing lesson are left out. Prompts and session
            history are not imported.
          </p>
          <p>
            Same project names do not establish a match. Choose each destination explicitly.
            Imported lessons remain private and are not marked verified.
          </p>
          {scan.issues.length ? (
            <ul>
              {[...new Set(scan.issues)].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Disclosure>
        <MappingReviewStatus migration={m} disabled={disabled} />
      </div>
      <footer className="q-pilot-actions">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => void m.back()}>
          Back
        </Button>
        {m.busy === "apply" ? (
          <Button
            type="button"
            variant="outline"
            disabled={m.stopping}
            onClick={() => void m.stop()}
          >
            {m.stopping ? "Stopping…" : "Stop import"}
          </Button>
        ) : (
          <Button type="button" disabled={!m.canImport} onClick={() => void m.apply()}>
            Import {m.currentReview?.toImport ?? 0} memories
          </Button>
        )}
      </footer>
    </>
  )
}
