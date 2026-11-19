// Under the review (Workflow model: verify.html): the checks as they ended, one closed fold with the
// board's four stages, and every picture the verdicts cite, a second closed fold. The board is the
// page the person saw while the agents checked; once the review is theirs it waits here, folded.

import { ClipboardCheckIcon, ImageIcon } from "lucide-react"
import { useMemo } from "react"
import type { VerificationRun } from "../../../core/review/screen-evidence.ts"
import { useQuery } from "../../hooks.ts"
import { FoldedGroup } from "../../step-page/bands/FoldedGroup.tsx"
import { sectionId } from "../../step-page/sections.ts"
import { IconFold } from "../implement/heads.tsx"
import type { StepPageProps } from "../page-props.ts"
import { VerifyBoard } from "./Board.tsx"
import { picturesOf, VerifyPictures } from "./Pictures.tsx"
import { verifyView } from "./progress.ts"
import { loadVerificationScreens } from "./screens-api.ts"

export function ReviewFolds({ task, state, mode, live, api }: StepPageProps) {
  const view = useMemo(
    () => verifyView(task, task.verifyLanes ?? [], state.verify?.proof.rows ?? [], Date.now()),
    [task, state.verify?.proof.rows],
  )
  const recorded = useQuery(
    (signal) =>
      api === undefined || mode !== "live"
        ? Promise.resolve(null)
        : loadVerificationScreens(api, task.id, signal),
    [api, task.id, mode],
  )
  const runs: readonly VerificationRun[] = recorded.data?.runs ?? []
  const pictures = picturesOf(runs, new Map()).files.length
  const checks = view.stages.filter((stage) => stage.checks.length > 0).length
  if (checks === 0 && pictures === 0) return null
  return (
    <FoldedGroup>
      {checks > 0 ? (
        <IconFold
          id={sectionId("Checks")}
          title="Checks"
          icon={ClipboardCheckIcon}
          count={view.stages.length}
          takeaway={[view.roundWords, view.phase === "verified" ? "all passed" : ""]
            .filter((part) => part !== "")
            .join(" · ")}
        >
          <VerifyBoard stages={view.stages} receipt={task.verifyActivity?.projectChecks} />
        </IconFold>
      ) : null}
      {pictures > 0 ? (
        <IconFold
          id={sectionId("Pictures")}
          title="Pictures"
          icon={ImageIcon}
          count={pictures}
          takeaway="every capture the reviewers took, latest run first"
        >
          <VerifyPictures runs={runs} loadEvidence={live?.loadEvidence} />
        </IconFold>
      ) : null}
    </FoldedGroup>
  )
}
