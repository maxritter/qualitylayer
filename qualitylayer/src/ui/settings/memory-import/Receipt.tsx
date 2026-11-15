import { Button } from "@/components/ui/button"
import { PERSONAL_PROJECT } from "../../../memory-contracts.ts"
import type { PilotReceipt, PilotScan } from "../../../pilot-memory-contracts.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { sourceNames } from "./Source.tsx"
import type { PilotDestination } from "./usePilotMigration.ts"

export function PilotReceiptView({
  receipt,
  scan,
  destinations,
  stopped,
  busy,
  retry,
  viewImported,
}: {
  receipt: PilotReceipt
  scan: PilotScan
  destinations: Record<string, PilotDestination | null>
  stopped: boolean
  busy: boolean
  retry: () => void
  viewImported: () => void
}) {
  const title = stopped
    ? "Import stopped"
    : receipt.failed
      ? "Import finished with errors"
      : receipt.imported
        ? "Memories imported"
        : "No new memories to import"
  return (
    <>
      <div className="q-pilot-body" id="pilot-receipt">
        <h3>{title}</h3>
        <p role="status">
          <strong>{receipt.imported} imported</strong> · {receipt.updated} updated ·{" "}
          {receipt.alreadyImported} already imported · {receipt.leftOut} left out · {receipt.failed}{" "}
          failed
        </p>
        {receipt.groups.map((group) => (
          <div className="q-pilot-group" key={`${group.group}-${group.project}`}>
            <strong>
              {scan.groups.find((item) => item.id === group.group)?.name ?? group.group}
            </strong>
            <span>
              {group.project === PERSONAL_PROJECT
                ? "Yours · every project"
                : (destinations[group.group]?.name ?? group.project)}{" "}
              · {group.imported} imported · {group.alreadyImported} already imported ·{" "}
              {group.failed} failed
            </span>
          </div>
        ))}
        {stopped ? (
          <p>
            Memories already saved were kept. Retry the same source to import the rest without
            creating duplicates.
          </p>
        ) : null}
        <p>Imported lessons are private. Your Pilot Shell files are unchanged.</p>
        {scan.archiveAt ? (
          <p>
            Archive source: {scan.archiveAt}. This backup cannot establish changes made after it was
            created.
          </p>
        ) : null}
        <Disclosure className="q-pilot-details" head="Import details">
          <p>
            Read-only source snapshot · {sourceNames[scan.source]}. No existing QualityLayer lesson
            was overwritten. Imported records are not marked verified.
          </p>
          {receipt.issues.length ? (
            <ul>
              {[...new Set(receipt.issues)].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p>No import errors.</p>
          )}
        </Disclosure>
      </div>
      <footer className="q-pilot-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={retry}>
          Import same source again
        </Button>
        <Button type="button" onClick={viewImported}>
          View imported memories
        </Button>
      </footer>
    </>
  )
}
