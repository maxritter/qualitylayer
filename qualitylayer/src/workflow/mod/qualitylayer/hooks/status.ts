// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
import type { Timer } from 'claude-code'
import type { Snapshot } from '../types'
import { buildCount, gateReady, QUALITY, waitingWords } from './band-model'

export type CueControl = {
  enabled: boolean
  ready: boolean
  timer: Timer | null
  version: number
  refreshing: boolean
  lastGoodSession: string | null
}

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object'

const validTaskShape = (task: any): boolean =>
  [task?.id, task?.title, task?.stage].every(v => typeof v === 'string')

const validReportCollections = (report: any): boolean =>
  [report.track, report.quality, report.helpers].every(Array.isArray)

const validReportOptionals = (report: any): boolean =>
  (report.gate === null || typeof report.gate?.target === 'string') &&
  (report.build === null || Array.isArray(report.build?.slices))

/** Reject a payload its band or pane cannot read. */
const validReport = (report: any): boolean => {
  if (!isObj(report) || Array.isArray(report) || report.ok === false) return false
  if (report.task === null) return true
  return [validTaskShape(report.task), validReportCollections(report), validReportOptionals(report)].every(Boolean)
}

export function parseStatusReport(stdout: string): Snapshot | null {
  let report: (Snapshot & { task: Snapshot['task'] | null }) | null
  try {
    report = JSON.parse(stdout)
  } catch {
    throw new Error('answered something else than JSON')
  }
  if (!validReport(report)) throw new Error('answered an invalid report')
  return report !== null && report.task !== null ? (report as Snapshot) : null
}

const isSameImplementBuild = (
  before: Snapshot | null,
  next: Snapshot | null,
  priorCount: { done: number; total: number } | null,
  nextCount: { done: number; total: number } | null,
): boolean => {
  if (before === null || next === null || before.task.id !== next.task.id) return false
  if (before.task.stage !== 'implement' || next.task.stage !== 'implement') return false
  return priorCount?.total === nextCount?.total && (nextCount?.total ?? 0) > 0
}

export function progressCueAction(
  cues: CueControl,
  state: { before: Snapshot | null; next: Snapshot | null; wasFailed: boolean },
): 'clear' | 'keep' | 'bump' {
  const priorCount = state.before === null ? null : buildCount(state.before)
  const nextCount = state.next === null ? null : buildCount(state.next)
  const canCue = cues.enabled && cues.ready && !state.wasFailed
  const sameBuild = isSameImplementBuild(state.before, state.next, priorCount, nextCount)
  if (!canCue || !sameBuild || (nextCount?.done ?? 0) < (priorCount?.done ?? 0)) return 'clear'
  return (nextCount?.done ?? 0) > (priorCount?.done ?? 0) ? 'bump' : 'keep'
}

export function statusToastMessages(before: Snapshot | null, next: Snapshot): string[] {
  const messages: string[] = []
  const gateChanged = before === null || !gateReady(before) || next.gate?.target !== before.gate?.target
  if (gateReady(next) && gateChanged) {
    messages.push(`QualityLayer: ${waitingWords(next)} in the App`)
  }
  const fixing = next.quality.find(row => row.state === 'fixing')
  if (fixing !== undefined && fixing.open !== before?.quality.find(row => row.step === fixing.step)?.open) {
    messages.push(`QualityLayer: ${(QUALITY[fixing.step] ?? fixing.step).toLowerCase()} found ${fixing.open ?? 0} to fix`)
  }
  return messages
}
