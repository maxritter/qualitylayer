import { type MutableRefObject, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { PilotMigrationApi, PilotRecordPreview } from "../../../pilot-memory-contracts.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { importError } from "./Source.tsx"

const CATEGORY_LABEL: Record<PilotRecordPreview["category"], string> = {
  learning: "Session learning",
  knowledge: "Knowledge document",
  observation: "Observation",
}

function PilotRecordRow({ record }: { record: PilotRecordPreview }) {
  const category = CATEGORY_LABEL[record.category] ?? "Observation"
  const state = record.state === "retired" ? "Retired · left out" : "Active"
  return (
    <li>
      <strong>{record.title}</strong>
      <span className="q-pilot-muted">
        {category} · {state}
      </span>
      <p className="q-memory-content">{record.preview}</p>
      {record.excluded ? <p>Left out: {record.excluded}</p> : null}
    </li>
  )
}

async function fetchRecordPage(params: {
  api: PilotMigrationApi
  scan: string
  group: string
  offset: number
  live: MutableRefObject<boolean>
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setItems: (updater: (current: PilotRecordPreview[]) => PilotRecordPreview[]) => void
  setTotal: (total: number) => void
}): Promise<void> {
  params.setBusy(true)
  params.setError(null)
  try {
    const page = await params.api.records(params.scan, params.group, params.offset)
    if (params.live.current) {
      params.setItems((current) => [...current, ...page.items])
      params.setTotal(page.total)
    }
  } catch (cause) {
    if (params.live.current) params.setError(importError(cause))
  } finally {
    if (params.live.current) params.setBusy(false)
  }
}

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
  const load = () => {
    if (busy) return
    void fetchRecordPage({
      api,
      scan,
      group,
      offset: items.length,
      live,
      setBusy,
      setError,
      setItems,
      setTotal,
    })
  }
  const showEmpty = !items.length && !busy && !error && total === 0
  const hasMore = Boolean(error) || (total !== null && items.length < total)
  return (
    <Disclosure
      head="Review records"
      className="q-pilot-details"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        setOpen(nextOpen)
        if (nextOpen && total === null && !busy && !error) load()
      }}
    >
      {items.length ? (
        <ul className="q-pilot-records">
          {items.map((record, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: records are appended from an immutable scan; mirrored source identities may repeat
            <PilotRecordRow key={`${record.id}-${index}`} record={record} />
          ))}
        </ul>
      ) : showEmpty ? (
        <p>No records in this group.</p>
      ) : null}
      {busy ? <p role="status">Loading records…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {hasMore ? (
        <Button type="button" variant="outline" disabled={busy} onClick={load}>
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
