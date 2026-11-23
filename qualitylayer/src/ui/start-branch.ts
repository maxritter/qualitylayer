// The start card's *Lands on* row: where the build lands, read from git through the App, and the one
// click that creates a branch for it. The reads and the click go through `branchApi`, which the
// website's demonstration replaces; the hook keeps what the card shows: what was picked, what the
// click made, and why git refused.

import { useCallback, useEffect, useRef, useState } from "react"
import type { BranchState } from "../core/git/branch.ts"

export type { BranchState }

export type BranchApi = {
  read: (task: string) => Promise<BranchState>
  /** Create the branch (the suggested name without one), switch to it and record it; the row's new state comes back. */
  create: (task: string, name?: string) => Promise<BranchState>
}

async function call(path: string, init?: RequestInit): Promise<BranchState> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const payload = (await response.json().catch(() => null)) as
    | (BranchState & { ok?: boolean; error?: { message?: string } })
    | null
  if (!response.ok || payload === null || payload.ok !== true) {
    throw new Error(payload?.error?.message ?? "The App did not accept that. Try again.")
  }
  const { branch, base, onBase, suggested } = payload
  return { branch, base, onBase, suggested }
}

const path = (task: string) => `/api/tasks/${encodeURIComponent(task)}/branch`

const fetched: BranchApi = {
  read: (task) => call(path(task)),
  create: (task, name) =>
    call(path(task), { method: "POST", body: JSON.stringify(name === undefined ? {} : { name }) }),
}

let current: BranchApi = fetched

/** The demonstration answers from its own data; null puts the App's own routes back. */
export function setBranchApi(api: BranchApi | null): void {
  current = api ?? fetched
}

export const branchApi: BranchApi = {
  read: (task) => current.read(task),
  create: (task, name) => current.create(task, name),
}

export type BranchPick = "stay" | "new"

export type StartBranchView = {
  /** What git says now; null while it is read and when it cannot be (the card then has no row). */
  state: BranchState | null
  /** True until the first read has answered: the card holds the row's room so the buttons below do not jump. */
  loading: boolean
  /** The choice in force: the click, else the recommendation. */
  choice: BranchPick
  /** The recommendation: the new branch when HEAD is the base branch or on no branch. */
  recommended: BranchPick
  /** The branch the click made, once it did. */
  made: string | null
  /** Git's reason when the switch was refused. */
  refused: string | null
  busy: boolean
  pick: (which: BranchPick) => void
  /** The branch to type `git switch -c` for: chosen, but the App has not made it. */
  byHand: string | null
}

type BranchRefs = {
  live: React.RefObject<boolean>
  clicked: React.RefObject<boolean>
  currentTask: React.RefObject<string | null>
  readRevision: React.RefObject<number>
}

function readTaskBranch(
  task: string,
  refs: BranchRefs,
  setAnswered: (task: string) => void,
  setState: (state: BranchState | null) => void,
): void {
  const revision = ++refs.readRevision.current
  const isStale = () =>
    !refs.live.current ||
    refs.currentTask.current !== task ||
    revision !== refs.readRevision.current
  branchApi.read(task).then(
    (next) => {
      if (isStale()) return
      setAnswered(task)
      if (!refs.clicked.current) setState(next)
    },
    () => {
      if (isStale()) return
      setAnswered(task)
      if (!refs.clicked.current) setState(null)
    },
  )
}

function createTaskBranch(
  task: string,
  refs: BranchRefs,
  handlers: {
    setState: (state: BranchState) => void
    setMade: (branch: string | null) => void
    setRefused: (message: string) => void
    setBusy: (busy: boolean) => void
  },
): void {
  refs.clicked.current = true
  handlers.setBusy(true)
  branchApi.create(task).then(
    (next) => {
      if (!refs.live.current || refs.currentTask.current !== task) return
      handlers.setState(next)
      handlers.setMade(next.branch)
      handlers.setBusy(false)
    },
    (cause: unknown) => {
      if (!refs.live.current || refs.currentTask.current !== task) return
      refs.clicked.current = false
      handlers.setRefused(cause instanceof Error ? cause.message : "git refused the new branch.")
      handlers.setBusy(false)
    },
  )
}

/** The row's state for one task; `task` is the App's task id, null when the card has no task. */
export function useStartBranch(
  task: string | null,
  deferred = false,
  defaultPick?: BranchPick,
): StartBranchView {
  const [state, setState] = useState<BranchState | null>(null)
  const [picked, setPicked] = useState<BranchPick | null>(null)
  const [made, setMade] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [answered, setAnswered] = useState<string | null>(null)
  const live = useRef(true)
  const clicked = useRef(false)
  const currentTask = useRef(task)
  currentTask.current = task
  const readRevision = useRef(0)
  const refs = { live, clicked, currentTask, readRevision }
  useEffect(() => {
    currentTask.current = task
    clicked.current = false
    setState(null)
    setPicked(null)
    setMade(null)
    setRefused(null)
    setBusy(false)
    setAnswered(null)
  }, [task])
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const read = useCallback(() => {
    if (task !== null)
      readTaskBranch(task, { live, clicked, currentTask, readRevision }, setAnswered, setState)
  }, [task])
  useEffect(() => {
    read()
    // A branch switched in the terminal is read again when the window comes back.
    window.addEventListener("focus", read)
    return () => window.removeEventListener("focus", read)
  }, [read])

  const recommended: BranchPick =
    state !== null && (state.onBase || state.branch === null) ? "new" : "stay"
  const choice: BranchPick =
    made !== null ? "new" : (picked ?? defaultPick ?? (deferred ? "stay" : recommended))

  const pick = (which: BranchPick) => {
    if (task === null || state === null || busy || made !== null) return
    setRefused(null)
    setPicked(which)
    if (deferred || which === "stay") return
    createTaskBranch(task, refs, { setState, setMade, setRefused, setBusy })
  }

  return {
    state,
    loading: task !== null && answered !== task,
    choice,
    recommended,
    made,
    refused,
    busy,
    pick,
    byHand: state !== null && made === null && choice === "new" ? state.suggested : null,
  }
}
