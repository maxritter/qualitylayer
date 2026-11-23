// Frozen routing seam; the lanes replace only their surface and retain old content as fallback.

import { api as liveApi } from "../api.ts"
import { viewFile } from "../DocPathChip.tsx"
import { useDocumentFullSize } from "../docs/mode.ts"
import { PlanWork } from "../docs/PlanWork.tsx"
import { stepView, viewedStep } from "../model.ts"
import { StepWork as BuildWork } from "../steps/StepWork.tsx"
import type { TaskSurfaceProps } from "./props.ts"

function isReadingStepView(props: TaskSurfaceProps, step: ReturnType<typeof viewedStep>): boolean {
  if (step === null) return false
  if (props.view === stepView(props.task, step)) return true
  const file = viewFile(props.task, props.view)
  return file?.name === props.view && file.role === step
}

export function StepWork(props: TaskSurfaceProps) {
  const reading = useDocumentFullSize()
  if (props.api !== liveApi && props.api.currentTurnLayout !== true) return props.children
  const step = viewedStep(props.view)
  if (step === "plan") return <PlanWork {...props} />
  const showBuild = reading
    ? isReadingStepView(props, step)
    : step === "implement" || step === "verify"
  return showBuild ? <BuildWork {...props} /> : props.children
}
