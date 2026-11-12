import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { RunWindow } from "../../run-context.tsx"
import {
  type ContextDraftTarget,
  type ContextualRequest,
  contextTargetKey,
  contextualDraft,
} from "./context-draft.ts"
import {
  artifactContextWaiting,
  ContextDraftSlot,
  type ContextLaunch,
  contextTargetMatchesRun,
} from "./context-launch.ts"
import {
  completeDraftHandoff,
  prependDrafts,
  type RetainedDrafts,
  releaseDraftHandoff,
  reserveDraftHandoff,
  retainDrafts,
  retainedDrafts,
} from "./draft-handoff.ts"

export {
  contextMatchesOwner,
  hasUnsupportedContextOwner,
} from "./context-launch.ts"

import { chooseWindowView } from "./view-choice.ts"

// Slots retain identities only; text and File references remain in the existing draft budget.
const slots = new Map<string, ContextDraftSlot>()
const listeners = new Map<string, Set<() => void>>()
const notify = (key: string) => {
  for (const listen of listeners.get(key) ?? []) listen()
}

export function pendingContextDraft(target: ContextDraftTarget) {
  const token = slots.get(contextTargetKey(target))?.token
  return token ? retainedDrafts(token) : undefined
}

export function stageContextDraft(request: ContextualRequest): boolean {
  const key = contextTargetKey(request.target)
  const old = slots.get(key)
  const incoming = { current: contextualDraft(request), previous: [] }
  const before = old ? retainedDrafts(old.token) : undefined
  if (old && before) {
    if (!retainDrafts(old.token, prependDrafts(before, incoming))) return false
    notify(key)
    return true
  }
  const token = reserveDraftHandoff(incoming)
  if (!token) return false
  slots.set(key, new ContextDraftSlot(token))
  if (old) releaseDraftHandoff(old.token)
  notify(key)
  return true
}

/** Opening stages editable input only. The caller reveals its existing Conversation surface. */
export function openContextualDraft(request: ContextualRequest, open: () => void): boolean {
  if (!stageContextDraft(request)) return false
  open()
  return true
}

export function handoffContextDraft(target: ContextDraftTarget, run: string): boolean {
  const key = contextTargetKey(target)
  const slot = slots.get(key)
  const token = slot?.token
  const entry = token ? retainedDrafts(token) : undefined
  if (!token || !entry || slot?.launching) return false
  completeDraftHandoff(token, run, entry, true)
  slots.delete(key)
  notify(key)
  chooseWindowView(run, "conversation")
  return true
}

export function beginContextLaunch(
  target: ContextDraftTarget,
  pending: RetainedDrafts,
  selection?: string,
) {
  const slot = slots.get(contextTargetKey(target))
  if (
    target.kind !== "artifact" ||
    !slot ||
    retainedDrafts(slot.token)?.current !== pending.current
  )
    return undefined
  return slot.begin(pending.current, selection)
}

export function bindContextLaunch(
  target: ContextDraftTarget,
  launch: ContextLaunch,
  run: RunWindow,
) {
  if (!contextTargetMatchesRun(target, run)) return false
  const bound = slots.get(contextTargetKey(target))?.bind(launch, run) ?? false
  if (bound) notify(contextTargetKey(target))
  return bound
}

export function identifyContextLaunch(
  target: ContextDraftTarget,
  launch: ContextLaunch,
  key: string,
  revision: string,
) {
  slots.get(contextTargetKey(target))?.identify(launch, key, revision)
}

export function cancelContextLaunch(target: ContextDraftTarget, launch: ContextLaunch) {
  slots.get(contextTargetKey(target))?.cancel(launch)
  notify(contextTargetKey(target))
}

export function contextLaunchOwner(target: ContextDraftTarget | undefined) {
  return target ? slots.get(contextTargetKey(target))?.owner : undefined
}

export function contextLaunchPending(target: ContextDraftTarget, run: RunWindow) {
  return artifactContextWaiting(target, run, slots.get(contextTargetKey(target)))
}

export function handoffContextDraftToRun(target: ContextDraftTarget, run: RunWindow) {
  const slot = slots.get(contextTargetKey(target))
  const entry = slot && retainedDrafts(slot.token)
  if (!slot || !entry || !contextTargetMatchesRun(target, run)) return false
  return slot.deliver(entry, run, {
    handoff: () => handoffContextDraft(target, run.id),
    changed: () => notify(contextTargetKey(target)),
  })
}

export function onContextDraft(target: ContextDraftTarget, receive: () => void): () => void {
  const key = contextTargetKey(target)
  const set = listeners.get(key) ?? new Set()
  set.add(receive)
  listeners.set(key, set)
  return () => {
    set.delete(receive)
    if (set.size) return
    listeners.delete(key)
    if (slots.get(key)?.releaseIfEmpty()) slots.delete(key)
  }
}

export function discardContextDraft(target: ContextDraftTarget): void {
  const key = contextTargetKey(target)
  const token = slots.get(key)?.token
  if (token) releaseDraftHandoff(token)
  slots.delete(key)
  notify(key)
}

export function editPendingContextDraft(
  target: ContextDraftTarget,
  entry: RetainedDrafts,
): boolean {
  const key = contextTargetKey(target)
  if (
    [entry.current, ...entry.previous].some(
      (draft) =>
        draft.nativeQuestionId || (draft.context && contextTargetKey(draft.context.target) !== key),
    )
  )
    return false
  const token = slots.get(key)?.token
  if (!token || !retainDrafts(token, entry)) return false
  notify(key)
  return true
}

export function usePendingContextDraft(target: ContextDraftTarget | undefined) {
  const key = target ? contextTargetKey(target) : undefined
  const owner = useRef(target)
  owner.current = target
  const subscribe = useCallback(
    (receive: () => void) =>
      key !== undefined && owner.current ? onContextDraft(owner.current, receive) : () => {},
    [key],
  )
  const snapshot = useCallback(
    () => (key !== undefined && owner.current ? pendingContextDraft(owner.current) : undefined),
    [key],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useContextDraftHandoff(
  target: ContextDraftTarget | undefined,
  run: RunWindow,
  enabled: boolean,
  opened: () => void,
  limited: () => void,
): void {
  useEffect(() => {
    if (!target || !enabled || run.agent === "other" || !contextTargetMatchesRun(target, run))
      return
    const receive = () => {
      try {
        if (handoffContextDraftToRun(target, run)) opened()
      } catch {
        limited()
      }
    }
    const off = onContextDraft(target, receive)
    receive()
    return off
  }, [target, run, enabled, opened, limited])
}
