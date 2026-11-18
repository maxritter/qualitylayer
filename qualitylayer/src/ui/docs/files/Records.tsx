// The Records group of the Files tab (App Model: Files · records): one row for `records/`,
// `evidence/` and `agents/`, the raw output and the pictures the build and its checks saved beside the
// three documents, and the agents' own files. It shows from Implement on, with how many files each
// holds; each folder has its own Reveal inside the row, since the system's file manager shows one
// folder at a time. `agents/` is not listed file by file: people rarely open it, so the row only
// says it is there. The Files tab renders it for a task.

import { FileTextIcon, FolderIcon } from "lucide-react"
import { AGENTS_DIR, CHECKS_RECORD } from "../../../core/docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../../../core/flow.ts"
import type { Api, TaskDetail } from "../../api.ts"
import { offersHostActions } from "../../machines/framed.ts"

/** Whether the task has reached the step that starts writing records. */
function started(task: Pick<TaskDetail, "stage">): boolean {
  const steps = FLOW_STEPS.map((step) => step.id)
  const at = steps.indexOf(flowStepOf(task.stage) ?? "plan")
  return at >= steps.indexOf("implement")
}

export function FilesRecords({
  task,
  api,
  checks,
}: {
  task: Pick<TaskDetail, "id" | "stage" | "evidence" | "records" | "agents">
  api?: Pick<Api, "openFile">
  checks?: { selected: boolean; open: () => void }
}) {
  if (!started(task)) return null
  const folders = [
    { name: "records", count: task.records?.length ?? 0 },
    { name: "evidence", count: task.evidence.length },
    { name: AGENTS_DIR, count: task.agents?.length ?? 0 },
  ]
  return (
    <section aria-label="Task records" data-testid="files-records">
      <h3>
        <span>Records</span>
        <span>raw output and pictures</span>
      </h3>
      <div
        className="ir-file-row ir-file-row-pair"
        data-testid="records-row"
        title="records/, evidence/ and agents/ in the task folder"
      >
        <FolderIcon size={13} aria-hidden="true" />
        <span>records · evidence · agents</span>
        <small>{folders.map((folder) => folder.count).join(" · ")} files</small>
        {offersHostActions() ? (
          <span className="ir-reveals">
            {folders.map((folder) => (
              <button
                key={folder.name}
                type="button"
                className="rs-act"
                aria-label={`Reveal ${folder.name}/`}
                disabled={api === undefined || folder.count === 0}
                onClick={() => void api?.openFile(task.id, folder.name, "reveal")}
              >
                {folder.name}/
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {checks ? (
        <button
          type="button"
          className="ir-file-row"
          data-record-path={CHECKS_RECORD}
          aria-current={checks.selected ? "page" : undefined}
          title={CHECKS_RECORD}
          onClick={checks.open}
        >
          <FileTextIcon size={13} aria-hidden="true" />
          <span>Checks</span>
        </button>
      ) : null}
    </section>
  )
}
