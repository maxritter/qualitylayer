import type { TaskSurfaceProps } from "../interaction/props.ts"
import { fileOf } from "../model.ts"
import { StepsNowContext } from "./context.ts"
import { STEPS_TURN_READY } from "./StepTurn.tsx"
import "./steps.css"
export function StepWork({ task, view, children, onOpenDoc }: TaskSurfaceProps) {
  // The approved Plan waits to be started: the Plan page carries the start.
  const outside = task.start?.route === true && task.start.where === "here"
  const starting =
    STEPS_TURN_READY && view === "implement" && task.action === "implement" && !outside
  return (
    <StepsNowContext value={STEPS_TURN_READY}>
      <div className="ir-steps-work">
        {starting ? (
          <div className="ir-start-work">
            <h2>Not started yet</h2>
            <p>The build session cuts the approved Plan into slices, then builds here.</p>
            <button
              type="button"
              className="q-btn sm"
              onClick={() => onOpenDoc(fileOf(task, "plan"))}
            >
              Start the build on the Plan
            </button>
          </div>
        ) : (
          children
        )}
      </div>
    </StepsNowContext>
  )
}
