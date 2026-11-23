// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
import type { Board, BoardPartKey, BoardRow } from '../types'
import { age } from './board-model'
import { drawBar, type Palette } from './palette'

/** What every row of All tasks draws with. */
export type Kit = { ui: any; palette: Palette; clock: number; surface: unknown; columns: number }
export type BoardActions = {
  onToggleFold: (key: BoardPartKey) => void
  onCopy: (command: string) => void
}

const ago = (kit: Kit, at: number | null): string => (at === null ? '' : age(kit.clock - at))

/** A title that opens its page while the App runs, else bold text. */
const titled = ({ ui }: Kit, url: string | null, label: string) =>
  url !== null && ui.Link !== undefined ? <ui.Link href={url} label={label} /> : <ui.Text bold>{label}</ui.Text>

type RowSpec = {
  key: string
  top: [unknown, unknown, unknown]
  row: BoardRow
  words: unknown
  end?: unknown
}

/** A row's two lines: the mark and title with what goes on the right, then the project and words. */
const rowLines = (kit: Kit, spec: RowSpec) => {
  const { Box, Text } = kit.ui
  const { key, top, row, words, end = null } = spec
  return (
    <Box key={key} flexDirection="column">
      <Box width={kit.columns} justifyContent="space-between">
        <Box flexShrink={1}>{top[0]}{top[1]}</Box>
        {top[2]}
      </Box>
      <Box width={kit.columns} justifyContent="space-between">
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text>{'  '}</Text>
            {row.project !== '' ? <Text dimColor>{`${row.project} · `}</Text> : null}
            {words}
          </Text>
        </Box>
        {end}
      </Box>
    </Box>
  )
}

const dimRight = ({ ui }: Kit, words: string) => <ui.Box flexShrink={0} paddingLeft={2}><ui.Text dimColor>{words}</ui.Text></ui.Box>

function needRow(actions: BoardActions, kit: Kit, row: BoardRow) {
  const { Box, Text, Button } = kit.ui
  const ink = kit.palette.you.ink
  const words = (
    <Text>
      {row.pr?.number != null ? <Text dimColor>{`#${row.pr.number} · `}</Text> : null}
      <Text color={ink}>{row.words}</Text>
    </Text>
  )
  const resume = row.command === null ? null : (
    <Box flexShrink={0} paddingLeft={2}>
      <Button key={`ql-copy-${row.id}`} label="⧉ resume" plain dimColor onPress={() => actions.onCopy(row.command as string)} />
    </Box>
  )
  return rowLines(kit, {
    key: `need-${row.id}`,
    top: [<Text bold color={ink}>! </Text>, titled(kit, row.link, row.title), dimRight(kit, ago(kit, row.since))],
    row,
    words,
    end: resume,
  })
}

const runRow = (kit: Kit, row: BoardRow) => {
  const { Box, Text } = kit.ui
  const ink = kit.palette.agents.ink
  const end = (
    <Box flexShrink={0} paddingLeft={2}>
      {row.progress !== null ? <Text>{drawBar(kit.ui, kit.palette.agents, row.progress)}{'  '}</Text> : null}
      <Text dimColor>{ago(kit, row.since)}</Text>
    </Box>
  )
  const words = (
    <Text>
      {row.agent !== null ? <Text><Text bold>{row.agent}</Text><Text dimColor> · </Text></Text> : null}
      <Text color={row.pr !== null ? ink : undefined} dimColor={row.pr === null}>{row.words}</Text>
    </Text>
  )
  return rowLines(kit, {
    key: `run-${row.id}`,
    top: [<Text color={ink}>◐ </Text>, titled(kit, row.link, row.title), end],
    row,
    words,
  })
}

const prRow = (kit: Kit, row: BoardRow) => {
  const { Text } = kit.ui
  const pr = row.pr
  const title = (
    <Text>
      {pr?.number != null ? titled(kit, pr.url, `#${pr.number}`) : null}
      <Text>{` ${row.title}`}</Text>
    </Text>
  )
  const when = pr !== null && pr.readAt > 0 ? ago(kit, pr.readAt) : ''
  const read = when === '' ? '' : when === 'now' ? 'read just now' : `read ${when} ago`
  return rowLines(kit, {
    key: `pr-${row.id}`,
    top: [<Text>⑂ </Text>, title, dimRight(kit, read)],
    row,
    words: <Text dimColor>{row.words}</Text>,
  })
}

const PARTS_DRAWN: { key: BoardPartKey; title: string; ink: (palette: Palette) => string | undefined }[] = [
  { key: 'needs', title: 'Needs you', ink: palette => palette.you.ink },
  { key: 'running', title: 'Running', ink: palette => palette.agents.ink },
  { key: 'prs', title: 'Pull requests', ink: () => undefined },
]

function drawBoardRow(actions: BoardActions, kit: Kit, key: BoardPartKey, row: BoardRow) {
  if (key === 'needs') return needRow(actions, kit, row)
  return key === 'running' ? runRow(kit, row) : prRow(kit, row)
}

/** One part: its heading (which folds it), its rows and how many more there are. */
function drawPart(actions: BoardActions, kit: Kit, now: Board, part: (typeof PARTS_DRAWN)[number], isFolded: boolean) {
  const { Box, Text, Button } = kit.ui
  const { rows, count } = now[part.key]
  return (
    <Box key={`ql-part-${part.key}`} flexDirection="column" marginTop={1}>
      <Button key={`ql-fold-${part.key}`} label={`${isFolded ? '▸' : '▾'} ${part.title} · ${count}`} plain onPress={() => actions.onToggleFold(part.key)} />
      {isFolded ? null : rows.map(row => drawBoardRow(actions, kit, part.key, row))}
      {!isFolded && count > rows.length ? <Text dimColor>{`  +${count - rows.length} more`}</Text> : null}
    </Box>
  )
}

/** The pane's All tasks: Needs you, Running and Pull requests, three rows each, every heading folds. */
export function drawAllTasks(actions: BoardActions, kit: Kit, now: Board, folded: BoardPartKey[]) {
  const { Box, Text, Link } = kit.ui
  const shown = PARTS_DRAWN.filter(part => now[part.key].count > 0)
  return (
    <Box key="ql-all-tasks" flexDirection="column" marginTop={1}>
      <Box width={kit.columns} justifyContent="space-between">
        <Text bold>All tasks</Text>
        {now.home !== null && Link !== undefined ? <Link href={now.home} label="Home ↗" /> : null}
      </Box>
      {shown.length === 0 ? <Text dimColor>Nothing needs you</Text> : null}
      {shown.map(part => drawPart(actions, kit, now, part, folded.includes(part.key)))}
    </Box>
  )
}
