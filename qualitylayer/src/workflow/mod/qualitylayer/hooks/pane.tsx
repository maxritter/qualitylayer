// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
import type { Board, BoardPartKey, Snapshot } from '../types'
import { bandLine, building } from './band-line'
import { gateReady, gateWords, planReviewWords, stageLabel } from './band-model'
import { type BoardActions, drawAllTasks, type Kit } from './board'
import { drawRow, toneOf } from './palette'
import { drawQualitySection, drawReviewAndHelpers, drawSlicesSection, drawTrackSection } from './pane-sections'

export function drawPaneContent(
  kit: Kit,
  state: { now: Snapshot | null; failed: string | null; others: Board | null; folded: BoardPartKey[] },
  actions: BoardActions,
) {
  const { ui, palette, columns } = kit
  const { Box, Text, Markdown } = ui
  const { now, failed, others, folded } = state
  const allTasks = others === null ? null : drawAllTasks(actions, kit, others, folded)
  if (failed !== null) {
    return allTasks === null ? drawRow(ui, palette.failed, failed) : <Box flexDirection="column">{drawRow(ui, palette.failed, failed)}{allTasks}</Box>
  }
  if (now === null) return <Box flexDirection="column"><Text dimColor>No open QualityLayer task.</Text>{allTasks}</Box>
  const line = bandLine(now)
  const tone = toneOf(palette, line.turn)
  const showQuestion = typeof now.question === 'string' && now.question !== '' && !building(now)
  const showBand = line.text !== '' && line.turn !== 'agents' && !showQuestion
  const showGate = now.gate !== null && (gateReady(now) || planReviewWords(now) !== null)
  return (
    <Box flexDirection="column">
      <Text bold>{now.task.title}</Text>
      <Text dimColor>{now.task.kind} · {stageLabel(now)}</Text>
      {showBand ? <Box marginTop={1}><Text color={tone.ink}>{line.text}</Text></Box> : null}
      {showQuestion ? <Box marginTop={1}><Text>{now.question}</Text></Box> : null}
      {showGate ? (
        <Box marginTop={1}>{drawRow(ui, gateReady(now) ? palette.you : palette.agents, `${planReviewWords(now) ?? gateWords(now)} · ${now.gate!.minutes} min`, null, columns)}</Box>
      ) : null}
      {drawTrackSection(ui, now.track ?? [], tone)}
      {drawSlicesSection(ui, palette, now, columns)}
      {drawQualitySection(ui, palette, now)}
      {drawReviewAndHelpers(ui, palette, now)}
      {now.gate?.cockpit != null ? <Box marginTop={1}><Markdown text={`[Open the task in the App](${now.gate.cockpit})`} /></Box> : null}
      {allTasks}
    </Box>
  )
}
