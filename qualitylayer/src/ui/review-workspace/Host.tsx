// The task page's holder of the Review workspace. Anything on the page can ask for it (open.ts): the
// Review page's cards, a Files row, a Conversation chip, ⌘K. It reads the change when it is asked, so a
// task page that never opens it never reads it, and opens at the file that was asked for.

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import type { Walkthrough as WalkthroughView } from "../../core/review/walkthrough.ts"
import type { TaskDetail } from "../api.ts"
import { openInEditor, useEditor } from "../files/editor.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { offersHostActions } from "../machines/framed.ts"
import type { StepLive } from "../step-page/live.ts"
import { useWalkthrough } from "../steps/verify/use-walkthrough.ts"
import { rowsOf } from "../timeline/Walkthrough.tsx"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { useFocusLayer } from "./focus.ts"
import { lineComments, lineDraftsAfter } from "./line-drafts.ts"
import { publishWorkspaceShown, useReviewWorkspaceOpener } from "./open.ts"
import { type CodeMark, ExitButton, ReviewWorkspace } from "./ReviewWorkspace.tsx"

type Props = {
  task: TaskDetail
  api: WalkthroughApi
  live: StepLive | undefined
  reload: (() => void) | undefined
  /** Lines marked in the code: the quick field opens there, whenever the workspace is open. */
  onMark?: (mark: CodeMark) => void
}

/** The workspace for one opening: the change is read first, then drawn at the file asked for. */
function ReadFailure({
  reason,
  retry,
  close,
}: {
  reason: string
  retry: () => void
  close: () => void
}) {
  const focus = useFocusLayer<HTMLDivElement>()
  return createPortal(
    <div
      ref={focus}
      tabIndex={-1}
      className="rw"
      role="dialog"
      aria-modal="true"
      aria-label="Review the code"
      data-testid="review-workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          close()
        }
      }}
    >
      <header className="rw-top">
        <b>Code</b>
        <span className="rw-sp" />
        <span>— Changes unreadable</span>
        <ExitButton onClick={close} primary />
      </header>
      <main className="rw-main" role="alert">
        <div className="rw-note">
          <h2>Couldn't load changes</h2>
          <p>Try again or exit.</p>
          <button type="button" className="rw-btn" onClick={retry}>
            Try again
          </button>
          <Disclosure head="Details">
            <p>{reason}</p>
          </Disclosure>
        </div>
      </main>
    </div>,
    document.body,
  )
}

function Opened({
  file,
  slice,
  checked,
  onClose,
  ...page
}: Props & {
  file: string | null
  slice: number | null
  checked?: string | undefined
  onClose: () => void
}) {
  const view = useWalkthrough(page.api, page.task.id, "workspace", checked)
  if (view.error !== null)
    return <ReadFailure reason={view.error.message} retry={view.reload} close={onClose} />
  return view.data === null ? null : (
    <Workspace
      {...page}
      view={view.data}
      file={file}
      slice={slice}
      checked={checked}
      onClose={onClose}
    />
  )
}

function Workspace({
  task,
  api,
  reload,
  onMark,
  view: walkthrough,
  file,
  slice,
  checked,
  onClose,
}: Props & {
  view: WalkthroughView
  file: string | null
  slice: number | null
  checked?: string | undefined
  onClose: () => void
}) {
  const { editor } = useEditor(api)
  const comments = useMemo(() => lineComments(task), [task])
  const readOnly = walkthrough.changeScope?.history !== undefined || checked !== undefined
  const deciding =
    task.gate !== null &&
    task.gate.target === "final" &&
    task.gate.decision === "pending" &&
    !task.gate.settled
  return (
    <ReviewWorkspace
      taskId={task.id}
      title={task.title}
      view={walkthrough}
      comments={comments}
      deciding={!readOnly && deciding}
      {...(!readOnly && onMark ? { onMark } : {})}
      loadDiff={(path, signal, revision, since) =>
        api.fileDiff(task.id, path, {
          signal,
          ...(walkthrough.changeScope && revision && !since ? { revision } : {}),
          ...(checked ? { checked } : {}),
          ...(since ? { since } : {}),
        })
      }
      loadSource={(request) => api.reviewFileSource(task.id, request, checked)}
      {...(!readOnly && offersHostActions()
        ? { open: { editor, run: (path) => void openInEditor(api, task.id, editor, path) } }
        : {})}
      {...(!readOnly && task.findings !== undefined ? { findings: task.findings } : {})}
      onFinding={async (f, kind, reason) => {
        const file = rowsOf(walkthrough)
          .flatMap((row) => row.files)
          .find((entry) => entry.path === f.file)
        const stamp =
          file?.parts?.length === 1
            ? file.parts[0]?.stamp
            : file?.parts?.length
              ? undefined
              : file?.stamp
        // Made a change request, it is the person's own draft on its line, as if they wrote it.
        if (kind === "adopted")
          await api.putComments(
            task.id,
            "final",
            lineDraftsAfter(task, {
              add: {
                anchor: { file: f.file, side: "new", line: f.line, ...(stamp ? { stamp } : {}) },
                remark: `${f.by}: ${f.what}`,
                text: "",
                ask: "change",
              },
            }),
          )
        await api.finding(task.id, f.id, { kind, ...(reason !== undefined ? { reason } : {}) })
        reload?.()
      }}
      file={file}
      initialSlice={slice}
      onClose={onClose}
      {...(!readOnly && typeof api.clearTaskChanges === "function"
        ? {
            onClearChanges: async () => {
              await api.clearTaskChanges(task.id)
              reload?.()
              onClose()
            },
          }
        : {})}
    />
  )
}

export function ReviewWorkspaceHost(props: Props) {
  const [asked, setAsked] = useState<{
    file: string | null
    slice: number | null
    n: number
    checked?: string
  } | null>(null)
  useReviewWorkspaceOpener(
    props.task.id,
    useCallback(
      (file: string | null, checked?: string, slice?: number | null) =>
        setAsked((was) => ({
          file,
          slice: slice ?? null,
          n: (was?.n ?? 0) + 1,
          ...(checked ? { checked } : {}),
        })),
      [],
    ),
  )
  const onClose = useCallback(() => setAsked(null), [])
  useEffect(() => {
    publishWorkspaceShown(asked === null ? null : props.task.id)
    return () => publishWorkspaceShown(null)
  }, [asked, props.task.id])
  return asked === null ? null : (
    <Opened
      key={asked.n}
      {...props}
      file={asked.file}
      slice={asked.slice}
      checked={asked.checked}
      onClose={onClose}
    />
  )
}
