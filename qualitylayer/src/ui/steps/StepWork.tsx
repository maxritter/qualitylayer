import type { TaskSurfaceProps } from "../interaction/props.ts"
import { fileOf, viewedStep } from "../model.ts"
import { StepsNowContext } from "./context.ts"
import { StepQuiet } from "./StepQuiet.tsx"
import { STEPS_TURN_READY } from "./StepTurn.tsx"
import "./steps.css"
export function StepWork({ task, view, children, onOpenDoc }: TaskSurfaceProps) {
  // The approved Plan waits to be started: the Plan page carries the start.
  const outside = task.start?.route === true && task.start.where === "here"
  const starting =
    STEPS_TURN_READY && viewedStep(view) === "implement" && task.action === "implement" && !outside
  return (
    <StepsNowContext value={STEPS_TURN_READY}>
      <div className="ir-steps-work">
        {starting ? (
          <StepQuiet
            step="implement"
            kind="future"
            line="The build session cuts the approved Plan into slices, then builds here."
            back={null}
            action={{
              label: "Start the build on the Plan",
              open: () => onOpenDoc(fileOf(task, "plan")),
            }}
          />
        ) : (
          children
        )}
      </div>
    </StepsNowContext>
  )
}
