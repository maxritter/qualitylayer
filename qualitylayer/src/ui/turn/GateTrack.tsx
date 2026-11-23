import { BookOpenIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { flattenItems, type Item, type ItemAnswer } from "../../core/items.ts"
import { setDocumentFullSize, setDocumentReturn, useDocumentFullSize } from "../docs/mode.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { fileOf, viewedStep } from "../model.ts"
import { AgentTurn } from "../shell/AgentTurn.tsx"
import { DecisionCard } from "./DecisionCard.tsx"
import { DocumentRow } from "./DocumentRow.tsx"
import {
  enterQuickAgreeKind,
  GateTrackNav,
  isTrackItem,
  persistGateAnswer,
  shouldFallbackToAgentTurn,
  useGateWindowKeys,
} from "./GateTrackParts.tsx"
import { useTurnSnapshot } from "./projection.ts"

const selectedDecisions = new Map<string, string | null>()
type TrackSection = "decisions" | "artifacts"
const selectedSections = new Map<string, TrackSection>()

function initialTrackSection(taskId: string, decisions: Item[], artifacts: Item[]): TrackSection {
  const saved = selectedSections.get(taskId)
  if (saved) return saved
  if (
    decisions.some((item) => item.state === "open" && (item.blocking || item.kind === "decision"))
  ) {
    return "decisions"
  }
  return artifacts.some((item) => item.state === "open") ? "artifacts" : "decisions"
}

function useGateAnswer(
  props: TaskSurfaceProps,
  group: Item[],
  index: number,
  setSelected: (value: string | null) => void,
) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingAnswers = useRef(new Set<string>())

  const answer = async (item: Item, value: ItemAnswer | null, files: File[] = []) => {
    if (pendingAnswers.current.has(item.id)) return false
    pendingAnswers.current.add(item.id)
    setBusy(true)
    setError(null)
    try {
      await persistGateAnswer(props, item, value, files)
      if (value) {
        toast("Answer saved", {
          duration: 5000,
          action: { label: "Undo", onClick: () => void answer(item, null) },
        })
      }
      setSelected(group.slice(index + 1).find((row) => row.state === "open")?.id ?? item.id)
      props.reload()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answer. Try again.")
      return false
    } finally {
      pendingAnswers.current.delete(item.id)
      setBusy(false)
    }
  }
  return { busy, error, answer }
}

export function GateTrack(props: TaskSurfaceProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const reading = useDocumentFullSize()
  const [trackHost, setTrackHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setTrackHost(document.getElementById(`task-gate-track-${props.task.id}`))
  })
  useGateWindowKeys(root, reading)

  const turn = useTurnSnapshot(props.task.id)
  const phase = viewedStep(props.view) ?? "plan"
  const items = flattenItems(turn?.items ?? props.task.items ?? []).filter((item) =>
    isTrackItem(item, phase),
  )
  const decisions = items.filter((item) => item.kind !== "done" && item.kind !== "mockup")
  const artifacts = items.filter((item) => item.kind === "mockup")

  const [section, updateSection] = useState<TrackSection>(() =>
    initialTrackSection(props.task.id, decisions, artifacts),
  )
  const setSection = (value: TrackSection) => {
    selectedSections.set(props.task.id, value)
    updateSection(value)
  }
  const [selected, updateSelected] = useState<string | null>(
    () => selectedDecisions.get(props.task.id) ?? null,
  )
  const setSelected = (value: string | null) => {
    selectedDecisions.set(props.task.id, value)
    updateSelected(value)
  }

  const onArtifacts =
    (section === "artifacts" && artifacts.some((item) => item.state === "open")) ||
    !decisions.some((item) => item.state === "open")
  const group = onArtifacts ? artifacts : decisions
  const current =
    group.find((item) => item.id === selected && item.state === "open") ??
    group.find((item) => item.state === "open")
  const index = current ? group.indexOf(current) : -1
  const { busy, error, answer } = useGateAnswer(props, group, index, setSelected)

  if (shouldFallbackToAgentTurn(props, phase, items)) return <AgentTurn {...props} />

  const track = (
    <GateTrackNav
      phase={phase}
      decisions={decisions}
      artifacts={artifacts}
      hasCurrent={current !== undefined}
      onArtifacts={onArtifacts}
      onSelectSection={setSection}
    />
  )
  const readDocument = () => {
    setDocumentReturn({ taskId: props.task.id, view: props.view })
    setDocumentFullSize(true)
  }
  const contextLink = (
    <button type="button" className="q-btn sm" onClick={readDocument}>
      <BookOpenIcon size={14} aria-hidden="true" />
      Read document context
    </button>
  )
  const folded = current?.call !== undefined

  return (
    <div
      ref={root}
      className="ir-gate-stage"
      data-testid="gate-track"
      onKeyDownCapture={(event) => {
        const kind = enterQuickAgreeKind(event, busy, current)
        if (kind && current) {
          event.preventDefault()
          void answer(current, { kind, at: Date.now() })
        }
      }}
    >
      {trackHost ? createPortal(track, trackHost) : track}
      {error ? <p role="alert">{error}</p> : null}
      {current ? (
        <DecisionCard
          key={current.id}
          item={current}
          index={index}
          total={group.length}
          surface={props}
          busy={busy}
          onAnswer={answer}
          onPrevious={() => setSelected(group[Math.max(0, index - 1)]?.id ?? null)}
          onNext={() => setSelected(group[Math.min(group.length - 1, index + 1)]?.id ?? null)}
          {...(folded ? {} : { foot: contextLink })}
        />
      ) : null}
      {folded ? (
        <DocumentRow
          file={fileOf(props.task, "plan")}
          status="Approve opens after your call"
          read="Read the Plan"
          onRead={readDocument}
          testId="gate-doc"
          readTestId="gate-read-document"
        />
      ) : null}
      {current ? null : contextLink}
    </div>
  )
}
