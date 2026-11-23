// The answers a person picks on a step's items, kept until the step's main button sends them. The
// server stores each as a draft comment with the item's id and the answer's kind, so a reload (or
// another tab) shows the same picks; this hook lays the picks made here over what the server
// stores, and saves them a moment after the last one (Undo is the same save without it).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Item, ItemAnswer } from "../core/items.ts"
import { type Api, api as liveApi, type TaskDetail } from "./api.ts"
import { useItemAnswers } from "./turn/actions.ts"
import {
  type AnswerOverlay,
  draftsFor,
  mergeAnswerOverlay,
  pruneSyncedOverlay,
  SAVE_AFTER_MS,
  storedAnswers,
  touchedAnswerDocs,
} from "./useAnswers-helpers.ts"

export { SAVE_AFTER_MS } from "./useAnswers-helpers.ts"

type Snapshot = {
  task: TaskDetail
  answers: Record<string, ItemAnswer>
  mine: AnswerOverlay | undefined
}

async function persistAnswersSnapshot(
  api: Api,
  snapshot: Snapshot,
  reload: () => void,
): Promise<void> {
  const { task: now, answers: picks, mine: touched } = snapshot
  const docs = touchedAnswerDocs(now.items, touched)
  for (const doc of docs) await api.putComments(now.id, doc, draftsFor(now, doc, picks))
  reload()
}

function useAnswerPersistence(api: Api, snapshot: Snapshot, reload: () => void) {
  const latest = useRef<Snapshot>(snapshot)
  latest.current = snapshot
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())

  const persist = useCallback(
    (snap: Snapshot) => persistAnswersSnapshot(api, snap, reload),
    [api, reload],
  )
  const save = useCallback(async () => {
    timer.current = null
    await persist(latest.current)
  }, [persist])
  const persistNow = useRef(persist)
  persistNow.current = persist

  const schedule = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      saving.current = saving.current.catch(() => {}).then(save)
      void saving.current.catch(() => {})
    }, SAVE_AFTER_MS)
  }, [save])

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      saving.current = saving.current.catch(() => {}).then(save)
    }
    try {
      await saving.current
    } catch {
      saving.current = save()
      await saving.current
    }
  }, [save])

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(
    () => () => {
      if (timer.current === null) return
      clearTimeout(timer.current)
      const current = latest.current
      saving.current = saving.current
        .catch(() => {})
        .then(() => persistNow.current(current))
        .catch(() => {})
    },
    [],
  )

  return { timer, schedule, flush, cancelTimer }
}

export function useAnswers(api: Api, task: TaskDetail, reload: () => void) {
  const immediateAnswer = useItemAnswers(task, reload)
  const stored = useMemo(() => storedAnswers(task.items), [task.items])
  const [overlays, setOverlays] = useState<Record<string, AnswerOverlay>>({})
  const mine = overlays[task.id]
  const answers = useMemo(
    () => mergeAnswerOverlay(stored, mine, task.items),
    [stored, mine, task.items],
  )

  const { timer, schedule, flush, cancelTimer } = useAnswerPersistence(
    api,
    { task, answers, mine },
    reload,
  )

  /** Answer an item, or Undo with null. */
  const answer = useCallback(
    (item: Item, next: ItemAnswer | null) => {
      if (api === liveApi && item.kind !== "question" && item.kind !== "confirm") {
        void immediateAnswer(item, next)
        return
      }
      setOverlays((was) => ({
        ...was,
        [task.id]: { ...(was[task.id] ?? {}), [item.id]: { answer: next, digest: item.digest } },
      }))
      schedule()
    },
    [task.id, schedule, api, immediateAnswer],
  )

  /** What was sent has gone with the decision: the picks start clean. */
  const clear = useCallback(() => {
    cancelTimer()
    setOverlays((was) => ({ ...was, [task.id]: {} }))
  }, [task.id, cancelTimer])

  // Once the server shows what was picked, the pick is the server's: the overlay lets go of it.
  useEffect(() => {
    if (timer.current !== null) return
    setOverlays((was) => {
      const current = was[task.id]
      if (current === undefined) return was
      const next = pruneSyncedOverlay(current, stored)
      return next === null ? was : { ...was, [task.id]: next }
    })
  }, [stored, task.id, timer])

  return { answers, answer, flush, clear }
}
