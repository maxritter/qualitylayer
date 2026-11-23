// The one row under the message box: the model with its mark, the effort, the permission mode, then on the
// right the files this session changed, the usage chip and the context ring. A state word shows here only
// while the window is being watched, loading or retrying; subagents are listed above the box. The chips
// fold to the row's measured width (use-chip-fold.ts) so the pickers and the ring keep one line.

import { cn } from "cn"
import { CoinsIcon, FileDiffIcon, GaugeIcon } from "lucide-react"
import { useRef, useState } from "react"
import { PopoverTrigger } from "@/components/ui/popover"
import { automaticModel, modelName } from "../../../core/agents/model-values.ts"
import type { ConversationUsage } from "../../../core/conversation/types.ts"
import type { Usage as UsageAnswer, UsagePeriod } from "../../../core/cost/usage.ts"
import type { AgentLimits } from "../../../core/limits/index.ts"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { useUsageDisplay } from "../../usage/display-context.tsx"
import { type SessionChanges, type SessionUse, sessionUse } from "./footer-usage.ts"
import { effortLabel, type FooterStatus, sessionSource } from "./footer-values.ts"
import { SessionSettings, type SessionSettingsProps } from "./SessionSettings.tsx"
import { type ObservedModel, Usage, type UsageSection } from "./Usage.tsx"
import { useAgentBilling } from "./use-agent-billing.ts"
import { useChipFold } from "./use-chip-fold.ts"
import { useAgentLimits } from "./useAgentLimits.ts"
import "./footer.css"

type SessionFooterProps = SessionSettingsProps & {
  /** Whether the window shows: plan limits are read only then. */
  on: boolean
  /** Reads the agents' plan limits; without it no limits are shown. */
  loadLimits?: (() => Promise<readonly AgentLimits[] | undefined>) | undefined
  /** Reads what the agents used in a period: it tells how this session's agent is billed. */
  loadUsage?: ((period: UsagePeriod) => Promise<UsageAnswer | undefined>) | undefined
  /** The last turn that ended: when it changes, the plan limits have moved. */
  turn: string | undefined
  status?: FooterStatus | undefined
  usage?: ConversationUsage | undefined
  usageOpen: boolean
  onUsageOpen(open: boolean): void
  /** How long the session ran, when its record has times. */
  span?: number | undefined
  /** What this session changed in the worktree; none until it changes a file. */
  changes?: SessionChanges | null | undefined
  /** Opens the task's Changes. */
  onViewChanges?: (() => void) | undefined
}

/** The files chip: an icon, the count and the lines, from the whole row down to an icon and a number. */
function FilesChip({
  changes,
  fold,
  onView,
}: {
  changes: SessionChanges
  fold: number
  onView: (() => void) | undefined
}) {
  const word = `${changes.files} ${changes.files === 1 ? "file" : "files"}`
  return (
    <button
      type="button"
      className="cv-chip cv-files"
      title={`Changed in this session: ${word}, +${changes.added} −${changes.removed} · open the changes`}
      aria-label={`${word} changed in this session, ${changes.added} lines added, ${changes.removed} removed · open the changes`}
      data-testid="session-files"
      onClick={onView}
    >
      <FileDiffIcon className="size-3.5" aria-hidden="true" />
      <span>{fold < 2 ? word : changes.files}</span>
      {fold === 0 ? (
        <>
          <span className="cv-add">+{changes.added}</span>
          <span className="cv-del">−{changes.removed}</span>
        </>
      ) : null}
    </button>
  )
}

/** The usage chip's icon: the plan's gauge, or the dollar sign of an estimated cost. */
function UseIcon({ use }: { use: SessionUse }) {
  const Icon = use.kind === "plan" ? GaugeIcon : CoinsIcon
  return <Icon className="size-3.5" aria-hidden="true" />
}

function observedModelFor(
  agent: SessionFooterProps["run"]["agent"],
  source: ReturnType<typeof sessionSource>,
  observedId: string | undefined,
): ObservedModel | undefined {
  if (agent === "other" || observedId === undefined) return undefined
  const routed = automaticModel(agent, source.model)
  // The selection is what the footer names; a call's model is named apart, never as the person's choice.
  return routed || observedId !== source.model
    ? { name: modelName(agent, observedId), selected: source.name, routed }
    : undefined
}

function FooterChips({
  changes,
  use,
  fold,
  onViewChanges,
  onOpenUsage,
}: {
  changes: SessionChanges | null | undefined
  use: SessionUse | null
  fold: number
  onViewChanges: (() => void) | undefined
  onOpenUsage: () => void
}) {
  const shownChanges = changes && fold < 4 ? changes : null
  const shownUse = use && fold < 5 ? use : null
  return (
    <>
      {shownChanges ? (
        <FilesChip changes={shownChanges} fold={fold} onView={onViewChanges} />
      ) : null}
      {shownUse ? (
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "cv-chip cv-use",
                shownUse.kind === "plan" && shownUse.ahead && "ahead",
              )}
              title={shownUse.title}
              aria-label={shownUse.label}
              aria-haspopup="dialog"
              data-testid="usage-chip"
              onClick={onOpenUsage}
            />
          }
        >
          <UseIcon use={shownUse} />
          {fold < 3 ? <span>{shownUse.word}</span> : null}
        </PopoverTrigger>
      ) : null}
    </>
  )
}

function ChipMeasure({
  changes,
  use,
  measureRef,
}: {
  changes: SessionChanges | null | undefined
  use: SessionUse | null
  measureRef: React.RefObject<HTMLSpanElement | null>
}) {
  return (
    <span className="cv-chip-measure" aria-hidden="true" ref={measureRef}>
      {changes ? (
        <>
          <FormFiles m="files-0" changes={changes} counts />
          <FormFiles m="files-1" changes={changes} />
          <FormFiles m="files-2" changes={changes} short />
        </>
      ) : null}
      {use ? (
        <>
          <span className="cv-chip" data-m="use-0">
            <UseIcon use={use} />
            <span>{use.word}</span>
          </span>
          <span className="cv-chip" data-m="use-1">
            <UseIcon use={use} />
          </span>
        </>
      ) : null}
    </span>
  )
}

export function SessionFooter(props: SessionFooterProps) {
  const { percent } = useUsageDisplay()
  const { run, agentName, status, usage, usageOpen, onUsageOpen, changes } = props
  const { limits, reload } = useAgentLimits(props.loadLimits, run.agent, props.on, props.turn)
  const billing = useAgentBilling(props.loadUsage, run.agent, props.on)
  const use = sessionUse({
    billing,
    limits,
    estimatedUsd: usage?.estimatedUsd,
    now: Date.now(),
    percentMode: percent,
  })
  const source = sessionSource(run, { model: props.model, effort: props.effort }, props.unknown)
  const effortSuffix = source.effort ? ` · ${effortLabel(source.effort).toLowerCase()} effort` : ""
  const model = source.name ? `${source.name}${effortSuffix}` : undefined
  const [section, setSection] = useState<UsageSection>("context")
  const observed = observedModelFor(run.agent, source, usage?.observedModel)
  const meta = useRef<HTMLDivElement>(null)
  const forms = useRef<HTMLSpanElement>(null)
  const cluster = useRef<HTMLSpanElement>(null)
  const fold = useChipFold(meta, forms, [
    run.agent,
    status?.text,
    source.name,
    source.effort,
    source.perm,
    run.pendingSettings?.id,
    run.pendingSettings?.error,
    changes?.files,
    use?.word,
  ])
  const chips = (
    <FooterChips
      changes={changes}
      use={use}
      fold={fold}
      onViewChanges={props.onViewChanges}
      onOpenUsage={() => setSection("usage")}
    />
  )
  return (
    <div className="cv-session-meta" ref={meta}>
      <SessionSettings key={run.generation} {...props} />
      {status ? (
        <span
          className={`cv-state ${status.who}`}
          role="status"
          aria-live="off"
          title={status.text}
        >
          <WhoMark who={status.who} running={status.who === "agent"} />
          {status.text}
        </span>
      ) : null}
      {usage && run.agent !== "other" ? (
        <span className="cv-ctx-anchor" ref={cluster}>
          <Usage
            usage={usage}
            open={usageOpen}
            onOpenChange={(open) => {
              if (open) reload()
              else setSection("context")
              onUsageOpen(open)
            }}
            section={section}
            onSection={setSection}
            observed={observed}
            agent={run.agent}
            agentName={agentName}
            model={model}
            span={props.span}
            limits={limits}
            use={use}
            unpriced={use === null && billing !== "plan" && usage.estimatedUsd === undefined}
            before={chips}
            anchor={cluster}
          />
        </span>
      ) : null}
      {/* Every form the two chips can take, drawn out of sight so the fold is chosen from their real widths. */}
      <ChipMeasure changes={changes} use={use} measureRef={forms} />
    </div>
  )
}

function FormFiles({
  m,
  changes,
  counts = false,
  short = false,
}: {
  m: string
  changes: SessionChanges
  counts?: boolean
  short?: boolean
}) {
  return (
    <span className="cv-chip" data-m={m}>
      <FileDiffIcon className="size-3.5" aria-hidden="true" />
      <span>
        {short ? changes.files : `${changes.files} ${changes.files === 1 ? "file" : "files"}`}
      </span>
      {counts ? (
        <>
          <span className="cv-add">+{changes.added}</span>
          <span className="cv-del">−{changes.removed}</span>
        </>
      ) : null}
    </span>
  )
}
