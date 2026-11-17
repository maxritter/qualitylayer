import type { VerificationRun } from "../../../core/review/screen-evidence.ts"
import { useQuery } from "../../hooks.ts"
import type { StepPageProps } from "../page-props.ts"
import { loadVerificationScreens } from "./screens-api.ts"

/** Screen records belong to a task and evidence inventory, independently of partial document writes. */
export function useRecordedScreens({
  api,
  task,
  mode,
}: Pick<StepPageProps, "api" | "task" | "mode">) {
  const evidenceVersion = (task.evidence ?? [])
    .filter((file) => /(?:^|\/)screen-[a-f0-9]{24}\.png$/.test(file))
    .join("\n")
  const recorded = useQuery(
    (signal) =>
      api === undefined || mode !== "live"
        ? Promise.resolve(null)
        : loadVerificationScreens(api, task.id, signal),
    [api, task.id, mode, evidenceVersion],
  )
  const runs: readonly VerificationRun[] = recorded.data?.runs ?? []
  return runs
}
