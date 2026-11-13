// The Implement step's page of a task: the build as it runs, at a glance. The header says how far it
// is (tasks and slices done, the task in work; a failing check is the agents' to fix and is not shown); the slices are
// the page (every one open for a small build, the one in work for a large one); what the agents
// decided and the limits they could not remove follow. The working record, the checks included, is
// the agents' file, which the Reader lists. The person's move is never here except the agent's own
// card (the build to start, or a stopped session).

import { BanIcon, LayersIcon, SplitIcon } from "lucide-react"
import { useMemo } from "react"
import { shellStatus } from "../../../core/interaction-shell/status.ts"
import { agentName } from "../../../core/live/liveness.ts"
import { buildsNextLine } from "../../outside.ts"
import { AgentTurn } from "../../shell/AgentTurn.tsx"
import { Bands } from "../../step-page/bands/Bands.tsx"
import { FoldedGroup } from "../../step-page/bands/FoldedGroup.tsx"
import { metaLine } from "../../step-page/bands/Gist.tsx"
import { YourMove } from "../../step-page/bands/YourMove.tsx"
import { StepTools } from "../../step-page/StepTools.tsx"
import { sectionId } from "../../step-page/sections.ts"
import { useSteadyStep } from "../../step-page/steady.ts"
import { STEP_TITLES, stepTitleOf } from "../../step-page/titles.ts"
import { useStepSupporting, useStepsNow } from "../context.ts"
import type { StepPageProps } from "../page-props.ts"
import { TechnicalPart } from "../plan/Technical.tsx"
import { readableBuild, restingBuild, stepIsWorking } from "../readiness.ts"
import { StepQuiet } from "../StepQuiet.tsx"
import { buildTiming } from "../summary-facts.ts"
import { agentCardShows } from "./agent-card.ts"
import { Board } from "./Board.tsx"
import { DecisionRows, decisionRowOf, LimitRows, limitsOf } from "./Changes.tsx"
import { IconFold, IconPart, ReadRow } from "./heads.tsx"
import { headerOf } from "./progress.ts"

/** An agent's name in the page's words; one the App does not know is the person's own agent. */
const nameOf = (agent: string) =>
  agent === "other" || agent === "" ? "your agent" : agentName(agent)

/** Implement's Technical part: how the build shaped the code, one closed fold (Workflow model: Implement). */
const PROGRAM_DESIGN = [{ title: "Program design", icon: SplitIcon }] as const

export function ImplementStepPage(props: StepPageProps) {
  const { task, document: incoming, sections: incomingSections, state, mode, live } = props
  const inNow = useStepsNow()
  const supporting = useStepSupporting()
  const readable = readableBuild(state.implement)
  const whole = (task.pages?.find((page) => page.step === "implement")?.problems.length ?? 0) === 0
  const steady = useSteadyStep(
    `${task.id}:implement`,
    { document: incoming, view: readable.view },
    incomingSections,
    readable.complete && whole,
  )
  const { document } = steady.doc
  const sections = steady.sections
  const working = mode !== "live" || stepIsWorking(task, state.at)
  const stopped = shellStatus(task, state.at).state === "stopped"
  const view = working ? steady.doc.view : restingBuild(steady.doc.view, stopped)
  const summary = document.markers.find((m) => m.name === "summary")?.fallback ?? ""
  const timing = buildTiming(summary)
  // Beside the count, the cards the agents work on now: only a live page reads them, never a share.
  const header = headerOf(view, mode === "live" ? task.live?.progress?.underWay : undefined)
  const limitsText = document.markers.find((m) => m.name === "limits")?.fallback ?? ""
  const limits = useMemo(() => limitsOf(limitsText), [limitsText])
  const limitsRecorded =
    (whole || steady.held) && limitsText.replace(/<!--[\s\S]*?-->/g, "").trim() !== ""
  const decisions = useMemo(
    () => (view?.decisions ?? []).map((d, index) => decisionRowOf(d, index)),
    [view?.decisions],
  )
  // The agent's own card (stopped, or the build to start) where no Now column draws it.
  const card =
    mode === "live" && !inNow && live !== undefined && agentCardShows(task) ? (
      <AgentTurn task={task} onCopy={live.copy} view="implement" />
    ) : null
  const stageTitle = stepTitleOf(task.stage)
  const built = view?.slices.every((s) => s.status === "done") === true

  if ((view?.slices.length ?? 0) === 0 && decisions.length === 0 && mode !== "plain")
    return (
      <>
        <YourMove>{card}</YourMove>
        {supporting}
        <StepQuiet step="implement" kind={working ? "writing" : "draft"} back={null} />
      </>
    )

  return (
    <div
      className="sp-page sp-enter"
      data-testid="step-page"
      data-mode={mode}
      data-step="implement"
    >
      <Bands
        yourMove={card}
        gist={{
          actions: (
            <StepTools doc={document} cut={sections} live={mode === "live" ? live : undefined} />
          ),
          title: STEP_TITLES.implement,
          meta: metaLine(
            timing?.built !== undefined
              ? timing.built
              : timing !== null
                ? `started ${timing.started}`
                : (buildsNextLine(task.start, nameOf, task.gate?.decided) ??
                  "the build has not started"),
            timing?.elapsed,
            built && stageTitle !== null && task.stage !== "implement"
              ? `now in ${stageTitle}`
              : undefined,
          ),
          facts: header.facts,
          now: header.now,
        }}
        core={
          <>
            {view !== undefined && view.slices.length > 0 ? (
              <IconPart id={`${sectionId("Slices")}-h`} title="Slices" icon={LayersIcon}>
                <Board slices={view.slices} />
              </IconPart>
            ) : null}
            {limitsRecorded ? (
              <IconPart id={`${sectionId("Known limits")}-h`} title="Known limits" icon={BanIcon}>
                {limits.length > 0 ? (
                  <LimitRows rows={limits} />
                ) : (
                  <p className="ib-none" data-testid="known-limits">
                    None left.
                  </p>
                )}
              </IconPart>
            ) : null}
          </>
        }
        folds={
          decisions.length > 0 ? (
            <FoldedGroup>
              <IconFold
                id={sectionId("Decided while building")}
                title="Decided while building"
                icon={SplitIcon}
                count={decisions.length}
              >
                <DecisionRows rows={decisions} live={mode === "live" ? live : undefined} />
              </IconFold>
            </FoldedGroup>
          ) : undefined
        }
        // How the code is shaped, folded, then the file. The file is written when the build starts;
        // until then there is nothing to read.
        more={
          document.markdown === "" ? undefined : (
            <>
              <TechnicalPart
                sections={sections?.sections ?? []}
                taskId={task.id}
                entries={PROGRAM_DESIGN}
                state={state}
                mode={mode}
                live={mode === "live" ? live : undefined}
              />
              <ReadRow
                taskId={task.id}
                file={document.file}
                label="Read the record"
                text="the build record, as Copy gives it"
              />
            </>
          )
        }
      />
    </div>
  )
}
