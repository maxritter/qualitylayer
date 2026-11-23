// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
import { computeBandLayout, isBarShown, type BandArgs } from './band-layout'
import { buildCount } from './band-model'
import { cellsOf, drawBar, toneOf, type Palette, type Tone } from './palette'

const renderFailedBand = (ui: any, palette: Palette, width: number, controlWidth: number, button: unknown) => {
  const { Box, Text } = ui
  return (
    <Box key="ql-band" width={width} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text dimColor>QL · </Text>
        <Text color={palette.failed.ink}>Status unavailable</Text>
        <Text>{' '.repeat(Math.max(2, width - 23 - controlWidth))}</Text>
      </Text>
      <Box flexShrink={0} width={controlWidth}>{button}</Box>
    </Box>
  )
}

const renderBandLineText = (
  ui: any,
  tone: Tone,
  layout: ReturnType<typeof computeBandLayout>,
  barState: { bar: boolean; count: { done: number; total: number }; barCells: number; cue: boolean },
) => {
  const { Text } = ui
  return (
    <Text wrap="truncate-end">
      <Text dimColor>QL</Text>
      {layout.step !== '' ? <Text> <Text bold color={tone.ink}>{layout.step}</Text></Text> : null}
      {layout.title !== '' ? <Text><Text dimColor> · </Text><Text>{layout.title}</Text></Text> : null}
      {layout.place !== '' ? <Text><Text dimColor>{layout.separator}</Text><Text>{layout.place}</Text></Text> : null}
      {layout.extras.map(part => <Text><Text dimColor> · </Text><Text dimColor>{part}</Text></Text>)}
      <Text>{' '.repeat(layout.gap)}</Text>
      {layout.message !== '' ? <Text><Text color={tone.ink}>{layout.message}</Text><Text>{'  '}</Text></Text> : null}
      {barState.bar ? <Text>{drawBar(ui, tone, barState.count, { cells: barState.barCells, tasks: true })}<Text color={tone.ink}>{barState.cue ? ' ↑' : '  '}</Text><Text>{'  '}</Text></Text> : null}
    </Text>
  )
}

/** The band owns its explicit spaces, so the kit can inspect its complete single row. */
export function drawBand(onOpen: () => void, args: BandArgs) {
  const { ui, palette, line, snap, width, cue, isWorking, failed = false } = args
  const { Box, Text, Button } = ui
  const turn = line.turn ?? (snap?.task.stage === 'plan' && isWorking ? 'agents' : null)
  const tone = toneOf(palette, turn)
  const details = snap !== null || failed
  const control = details ? 'd: Details' : '/ql answer'
  const controlWidth = cellsOf(control)
  const button = <Button key="ql-details" label="Details" plain dimColor hotkey="d" onPress={onOpen} />
  if (failed) return renderFailedBand(ui, palette, width, controlWidth, button)
  const count = snap === null ? { done: 0, total: 0 } : buildCount(snap)
  const bar = isBarShown(snap, turn, count)
  const barCells = width <= 55 ? 5 : 10
  const layout = computeBandLayout(args, { bar, barCells, controlWidth, count })
  return (
    <Box key="ql-band" width={width} flexShrink={0} backgroundColor={turn === 'you' ? tone.tint : undefined}>
      {renderBandLineText(ui, tone, layout, { bar, count, barCells, cue })}
      <Box flexShrink={0} width={controlWidth}>
        {details ? button : <Text>{control}</Text>}
      </Box>
    </Box>
  )
}
