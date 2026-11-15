import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { PilotMigrationApi, PilotRecordPreview } from "../../../pilot-memory-contracts.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { importError } from "./Source.tsx"

export function PilotRecords({
  api,
  scan,
  group,
}: {
  api: PilotMigrationApi
  scan: string
  group: string
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PilotRecordPreview[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const load = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const page = await api.records(scan, group, items.length)
      if (live.current) {
        setItems((current) => [...current, ...page.items])
        setTotal(page.total)
      }
    } catch (cause) {
      if (live.current) setError(importError(cause))
    } finally {
      if (live.current) setBusy(false)
    }
  }
  return (
    <Disclosure
      head="Review records"
      className="q-pilot-details"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
        if (event.currentTarget.open && total === null && !busy && !error) void load()
      }}
    >
      {items.length ? (
        <ul className="q-pilot-records">
          {items.map((record, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: records are appended from an immutable scan; mirrored source identities may repeat
            <li key={`${record.id}-${index}`}>
              <strong>{record.title}</strong>
              <span className="q-pilot-muted">
                {record.category === "learning"
                  ? "Session learning"
                  : record.category === "knowledge"
                    ? "Knowledge document"
                    : "Observation"}{" "}
                · {record.state === "retired" ? "Retired · left out" : "Active"}
              </span>
              <p className="q-memory-content">{record.preview}</p>
              {record.excluded ? <p>Left out: {record.excluded}</p> : null}
            </li>
          ))}
        </ul>
      ) : !busy && !error && total === 0 ? (
        <p>No records in this group.</p>
      ) : null}
      {busy ? <p role="status">Loading records…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error || (total !== null && items.length < total) ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
          {error ? "Retry records" : "More records"}
        </Button>
      ) : null}
      {total !== null ? (
        <p className="q-pilot-muted">
          {items.length} of {total} records
        </p>
      ) : null}
    </Disclosure>
  )
}
