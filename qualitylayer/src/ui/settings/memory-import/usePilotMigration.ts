import { useEffect, useMemo, useRef, useState } from "react"
import type {
  PilotMigrationApi,
  PilotReceipt,
  PilotReview,
  PilotScan,
  PilotSelection,
  PilotSourceInput,
} from "../../../pilot-memory-contracts.ts"
import {
  type MigrationRefs,
  type MigrationSetters,
  runPilotApply,
  runPilotBack,
  runPilotScan,
  runPilotStop,
} from "./pilot-migration-actions.ts"
import { importError } from "./Source.tsx"

export type PilotDestination = { id: string; name: string }

function cleanupMigrationOnUnmount(
  refs: Pick<MigrationRefs, "live" | "scanId" | "controller">,
  callbacks: { cancel: PilotMigrationApi["cancel"]; completed: () => void },
): void {
  refs.live.current = false
  const transport = refs.controller.current
  if (!refs.scanId.current) {
    transport?.abort()
    return
  }
  void callbacks
    .cancel(refs.scanId.current)
    .then((result) => {
      if (result.receipt) callbacks.completed()
    })
    .catch(() => {})
    .finally(() => transport?.abort())
}

function subscribePilotReview(params: {
  api: PilotMigrationApi
  selection: PilotSelection
  selectionKey: string
  setReviewing: (value: boolean) => void
  setReviewError: (value: string | null) => void
  setReview: (value: { key: string; result: PilotReview } | null) => void
}): () => void {
  let current = true
  params.setReviewing(true)
  params.setReviewError(null)
  params.setReview(null)
  void params.api
    .review(params.selection)
    .then((result) => {
      if (current) params.setReview({ key: params.selectionKey, result })
    })
    .catch((cause) => {
      if (current) params.setReviewError(importError(cause))
    })
    .finally(() => {
      if (current) params.setReviewing(false)
    })
  return () => {
    current = false
  }
}

export function usePilotMigration(api: PilotMigrationApi, completed: () => void) {
  const [input, setInput] = useState<PilotSourceInput>({ kind: "folder" })
  const [scannedInput, setScannedInput] = useState<PilotSourceInput | null>(null)
  const [scan, setScan] = useState<PilotScan | null>(null)
  const [destinations, setDestinations] = useState<Record<string, PilotDestination | null>>({})
  const [includeLearnings, setIncludeLearnings] = useState(true)
  const [review, setReview] = useState<{ key: string; result: PilotReview } | null>(null)
  const [receipt, setReceipt] = useState<PilotReceipt | null>(null)
  const [busy, setBusy] = useState<"scan" | "apply" | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const live = useRef(true)
  const scanId = useRef<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const operation = useRef<"scan" | "apply" | null>(null)
  const stopInFlight = useRef(false)
  const recovered = useRef(false)
  const callbacks = useRef({ cancel: api.cancel, completed })
  callbacks.current = { cancel: api.cancel, completed }

  const refs: MigrationRefs = { live, scanId, controller, operation, stopInFlight, recovered }
  const setters: MigrationSetters = {
    setScan,
    setDestinations,
    setScannedInput,
    setReview,
    setReceipt,
    setBusy,
    setReviewing,
    setStopping,
    setStopped,
    setError,
    setReviewError,
    bumpRevision: () => setRevision((value) => value + 1),
  }

  useEffect(() => {
    live.current = true
    return () => cleanupMigrationOnUnmount({ live, scanId, controller }, callbacks.current)
  }, [])

  const selection = useMemo<PilotSelection | null>(
    () =>
      scan
        ? {
            scan: scan.id,
            mappings: scan.groups.map((group) => ({
              group: group.id,
              project: destinations[group.id]?.id ?? null,
            })),
            includeLearnings,
          }
        : null,
    [scan, destinations, includeLearnings],
  )
  const selectionKey = JSON.stringify(selection)
  const sourceChanged = input !== scannedInput
  const selected = selection?.mappings.some((mapping) => mapping.project !== null) ?? false
  const reviewBlocked = Boolean(busy || receipt || sourceChanged || stopping)

  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry rereads current selected destinations
  useEffect(() => {
    if (!selection || reviewBlocked) return
    return subscribePilotReview({
      api,
      selection,
      selectionKey,
      setReviewing,
      setReviewError,
      setReview,
    })
  }, [api, selection, selectionKey, reviewBlocked, revision])

  const currentReview = review?.key === selectionKey && !sourceChanged ? review.result : null
  const idle = !busy && !stopping && !reviewing
  const reviewReady = selected && Boolean(currentReview) && !reviewError
  const canImport = idle && reviewReady && !sourceChanged

  return {
    input,
    setInput,
    scan,
    destinations,
    setDestinations,
    includeLearnings,
    setIncludeLearnings,
    receipt,
    busy,
    reviewing,
    stopping,
    stopped,
    error,
    reviewError,
    currentReview,
    sourceChanged,
    canImport,
    scanSource: () => runPilotScan(api, input, stopping, refs, setters),
    apply: () =>
      runPilotApply({
        api,
        selection,
        selected,
        sourceChanged,
        stopping,
        completed,
        refs,
        set: setters,
      }),
    stop: () => runPilotStop(api, completed, refs, setters),
    back: () => runPilotBack(api, stopping, refs, setters),
    retryReview: setters.bumpRevision,
  }
}
