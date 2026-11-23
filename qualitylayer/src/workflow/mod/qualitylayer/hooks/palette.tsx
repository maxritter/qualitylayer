// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin validate` and `claude plugin test` check it.
export type Turn = 'you' | 'agents' | 'failed' | null
/** One tone: the stripe and bar colour, and the row's tint behind it (none where the theme is unknown). */
export type Tone = { ink?: string; tint?: string; track?: string }
export type Palette = Record<'you' | 'agents' | 'failed' | 'checked', Tone>
/** The surface's own elements: the module has none, so each drawing is handed them. */
export type Ui = { Box: any; Text: any }

/**
 * The App's colours (DESIGN.md) for Claude Code's light and dark themes: amber for your turn, blue
 * while agents work, red for a failure, violet for what agents checked. An ANSI or unknown theme gets
 * the terminal's own named colours and no tint, so nothing is drawn against a background it cannot see.
 */
const PALETTES: Record<'dark' | 'light' | 'ansi', Palette> = {
  dark: {
    you: { ink: '#f7b23b', tint: '#2a2112', track: '#5c4419' },
    agents: { ink: '#5da3e5', tint: '#132235', track: '#2c4a6b' },
    failed: { ink: '#ff6166', tint: '#2d1416' },
    checked: { ink: '#b28be0' },
  },
  light: {
    you: { ink: '#9d6607', tint: '#fff4dc', track: '#e9cf98' },
    agents: { ink: '#2076c5', tint: '#e8f1fb', track: '#b4cfec' },
    failed: { ink: '#c9292f', tint: '#fdecec' },
    checked: { ink: '#7a3fb8' },
  },
  ansi: {
    you: { ink: 'yellow' },
    agents: { ink: 'blue' },
    failed: { ink: 'red' },
    checked: { ink: 'magenta' },
  },
}

const PALETTE_KEYS = ['dark', 'light'] as const

/** Claude Code's theme setting in the palette's terms: `dark`, `light` and their daltonized forms have one; ANSI and the rest do not. */
export const paletteOf = (setting: string | null): Palette => {
  const key = setting && !/ansi/.test(setting) ? PALETTE_KEYS.find(k => setting.startsWith(k)) : undefined
  return key ? PALETTES[key] : PALETTES.ansi
}

export const toneOf = (palette: Palette, turn: Turn): Tone => (turn === null ? {} : palette[turn])

/** Completion and remaining work differ in shape as well as colour. */
const barRuns = (done: number, total: number, cells = 10): [string, string] => {
  const full = total === 0 ? 0 : Math.max(0, Math.min(cells, Math.round((done / total) * cells)))
  return ['━'.repeat(full), '·'.repeat(cells - full)]
}

/** How many cells a bar takes with its count: the runs, a space and `done/total`. */
export const barWidth = (done: number, total: number, cells = 10) => cells + 1 + `${done}/${total}`.length

/** A bar drawn in a tone: the done run in its ink, the rest in its track colour (dimmed where it has none), then the count. */
export const drawBar = (
  { Text }: Ui,
  tone: Tone,
  count: { done: number; total: number },
  opts: { cells?: number; tasks?: boolean } = {},
) => {
  const { cells = 10, tasks = false } = opts
  const [full, rest] = barRuns(count.done, count.total, cells)
  return (
    <Text>
      <Text color={tone.ink}>{full}</Text>
      <Text color={tone.track ?? tone.ink} dimColor={tone.track === undefined}>
        {rest}
      </Text>
      <Text dimColor>{` ${count.done}/${count.total}${tasks ? ' tasks' : ''}`}</Text>
    </Text>
  )
}

/**
 * A row in the App's step-line form: a stripe in the tone's ink, the words, and on the right what
 * goes with them (a bar), over the tone's tint across the whole width. A row without a tone is dim.
 */
export const drawRow = ({ Box, Text }: Ui, tone: Tone, text: string, right: unknown = null, width?: number) => (
  <Box width={width} backgroundColor={tone.tint} justifyContent="space-between">
    <Box flexShrink={1}>
      <Text color={tone.ink} dimColor={tone.ink === undefined}>
        {'▎ '}
      </Text>
      <Text wrap="truncate-end" dimColor={tone.ink === undefined}>
        {text}
      </Text>
    </Box>
    {right !== null ? (
      <Box flexShrink={0} paddingLeft={2} paddingRight={1}>
        {right}
      </Box>
    ) : null}
  </Box>
)

const WIDE_CODE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x10ffff],
]

/** One terminal line; long prose stays intact in the pane. */
export const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')

const glyphWidth = (glyph: string): number => {
  const code = glyph.codePointAt(0) ?? 0
  if (/\p{Mark}/u.test(glyph) || code === 0x200d || code === 0xfe0e || code === 0xfe0f) return 0
  return WIDE_CODE_RANGES.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1
}

export const cellsOf = (text: string): number => [...text].reduce((sum, glyph) => sum + glyphWidth(glyph), 0)

export const clip = (text: string, cells: number): string => {
  text = oneLine(text)
  if (cellsOf(text) <= cells) return text
  if (cells <= 0) return ''
  let result = ''
  for (const glyph of text) {
    if (cellsOf(result) + glyphWidth(glyph) > cells - 1) break
    result += glyph
  }
  return `${result.trimEnd()}…`
}
