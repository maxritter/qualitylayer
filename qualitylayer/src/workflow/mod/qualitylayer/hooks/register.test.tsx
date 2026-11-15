// @ts-nocheck: typed by Claude Code's own declarations; `claude plugin test` runs it.
import { expect, mock, test } from 'claude-code/testing'

const APP_LINK = 'http://127.0.0.1:41888/#/task/repo~demo'
/** This Claude Code session's id, as `$.session.id()` returns it. */
const SESSION = '2f6c0a1e-5b7d-4c3a-9e21-7a8b9c0d1e2f'

/** The three steps the CLI reports, as `trackOf` makes them, grouped Plan, Build and Check. */
const STEPS = [
  ['plan', 'Plan', 'Plan'],
  ['implement', 'Implement', 'Build'],
  ['verify', 'Verify', 'Check'],
] as const
/** The track at a stage: a shipped task has every step done. */
const trackAt = (at: string) => {
  const now = at === 'shipped' ? STEPS.length : STEPS.findIndex(([id]) => id === at)
  return STEPS.map(([id, label, group], i) => ({ id, label, group, state: i < now ? 'done' : i === now ? 'now' : 'todo' }))
}

const WAITING = {
  ok: true,
  task: { id: 'repo~demo', slug: 'demo', title: 'Version flag', kind: 'Feature', stage: 'plan' },
  track: trackAt('plan'),
  gate: { target: '01-plan.md', minutes: 12, cockpit: APP_LINK },
  build: {
    slices: [
      { n: 1, title: 'One step registry', done: 1, total: 3 },
      { n: 2, title: 'Config and models', done: 0, total: 4 },
    ],
  },
  quality: [{ step: 'security', state: 'fixing', open: 1 }],
  helpers: [{ id: 's2-ab', role: 'slice', model: 'sonnet', line: 'T4: writing the carry-over test', minutes: 1 }],
  review: { name: 'Codex', model: 'gpt-6.1-sol', state: 'done', findings: 10, line: null },
  needs_you: { words: 'Plan waits for your approval' },
}
/** The CLI's answer that the task stands in Home's Needs you, in the App's words. */
const YOURS = { words: 'Your move' }
const DECIDED = { ...WAITING, gate: null, needs_you: null }
const NO_TASK = { ok: true, task: null }

/** The other tasks, as `status --json --board` reports them. */
const NOW = 1_800_000_000_000
const MIN = 60_000
const row = (id: string, title: string, words: string, extra: any = {}) => ({
  id, title, project: 'shop-api', words, since: null, link: null, command: null, agent: null, pr: null, progress: null, ...extra,
})
const EMPTY_BOARD = { needs: { rows: [], count: 0 }, running: { rows: [], count: 0 }, prs: { rows: [], count: 0 }, home: null }
const BOARD = {
  needs: {
    rows: [
      row('p~refund', 'Refund webhooks', 'Plan waits for your approval', { link: 'http://127.0.0.1:41888/#/task/p~refund' }),
      row('w~login', 'Login rate limit', 'Answer in Codex', { project: 'web', command: 'codex resume 019a2f3c' }),
      row('p~csv', 'CSV export', 'Pull request · 2 threads', { pr: { number: 412, url: 'https://github.com/o/r/pull/412', readAt: 0 } }),
    ],
    count: 4,
  },
  running: {
    rows: [row('p~search', 'Search index', 'Building slice 3 of 5', { agent: 'Codex', progress: { done: 9, total: 17 } })],
    count: 1,
  },
  prs: { rows: [row('p~orders', 'Order history paging', 'Pull request · open · checks passed', { pr: { number: 418, url: 'https://github.com/o/r/pull/418', readAt: 0 } })], count: 1 },
  home: 'http://127.0.0.1:41888/',
}
const boardAnswer = (board: unknown) => ({ ok: true, board })
/** A task in the stage the test names, with no gate open. */
const at = (stage: string) => ({
  ...WAITING,
  task: { ...WAITING.task, stage },
  track: trackAt(stage),
  gate: null,
  needs_you: null,
})

/** Answers the engine's side: the CLI's report (changeable between refreshes), the clock, the toasts. */
function world(on: any, first: unknown) {
  const world = {
    report: first as unknown,
    toasts: [] as string[],
    statuses: 0,
    runs: [] as string[][],
    registered: [] as string[],
    opened: [] as unknown[],
    fail: false,
    exitCode: 0,
    stdout: null as string | null,
    slow: false,
    complete: null as null | (() => void),
    /** The board's own calls: what they answer, and whether they hang. */
    board: boardAnswer(EMPTY_BOARD) as unknown,
    boardRuns: [] as string[][],
    boardSlow: false,
    boardFail: false,
    prRuns: [] as string[][],
    copied: [] as string[],
  }
  on('process.run', (_$: any, e: any) => {
    const argv = e.argv ?? e.command ?? []
    if (argv.includes('--board')) {
      world.boardRuns.push(argv)
      if (world.boardFail) throw new Error('the board cannot be read')
      if (world.boardSlow) return new Promise(() => {})
      return { value: { exitCode: 0, stdout: JSON.stringify(world.board), stderr: '' } }
    }
    if (argv.includes('pr')) {
      world.prRuns.push(argv)
      return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, read: 1 }), stderr: '' } }
    }
    world.runs.push(argv)
    if (world.fail) throw new Error('the binary cannot start')
    if (world.slow) return new Promise(resolve => {
      world.complete = () => resolve({ value: { exitCode: 0, stdout: JSON.stringify(world.report), stderr: '' } })
    })
    return { value: { exitCode: world.exitCode, stdout: world.stdout ?? JSON.stringify(world.report), stderr: '' } }
  })
  on('ui.toast', (_$: any, e: any) => {
    world.toasts.push(String(e.text ?? e.message ?? ''))
    return { value: undefined }
  })
  on('ui.status', () => {
    world.statuses += 1
    return { value: undefined }
  })
  on('ui.open', (_$: any, e: any) => {
    world.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.copy', (_$: any, e: any) => {
    world.copied.push(String(e.text))
    return { value: { isCopied: true } }
  })
  on('command.register', (_$: any, e: any) => {
    world.registered.push(JSON.stringify(e))
    return { value: undefined }
  })
  // What the engine draws when the mod has nothing to show: an empty box.
  on('ui.render', async ($: any, e: any, next: any) => {
    const { Box } = $.ui.resolve(e)
    try {
      return (await next(e)) ?? <Box />
    } catch (failure) {
      if (!String(failure).includes('no implementation for ui.render')) throw failure
      return <Box />
    }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  return { world, clock: mock.clock(on, { now: NOW }) }
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

test('the mod registers only task-pane and it opens the QualityLayer pane', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  await start($)
  const commands = seen.registered.map(value => JSON.parse(value).name)
  expect(commands).toEqual(['task-pane'])
  expect(commands.filter(name => name.startsWith('ql'))).toEqual([])
  await $.command.run({ command: 'task-pane' } as any)
  expect(seen.opened.at(-1)).toMatchObject({ id: 'ql-progress', title: 'QualityLayer' })
})

const band = ($: any, columns = 100, props: any = {}) =>
  $.ui.mount({
    plugin: 'qualitylayer',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: { columns, rows: 30 },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns - 5, ...props } as any,
  } as any)

const pane = ($: any, surface = 'terminal') =>
  $.ui.mount({ plugin: 'qualitylayer', surface, component: 'Pane', requestId: 'ql-progress', props: {} as any } as any)

/** The kit returns validated trees, not terminal paint. Flatten only the explicitly drawn row. */
function textOf(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node == null) return ''
  if (node.type === 'Button') {
    const { label, plain, hotkey } = node.props
    return plain ? `${hotkey ? `${hotkey}: ` : ''}${label}` : `[ ${label} ]`
  }
  return (node.children ?? []).map(textOf).join('')
}
const bandText = async (ui: any) => textOf(await ui.find({ type: 'Box', key: 'ql-band' }))
const leafText = async (ui: any, text: string) => (await ui.findAll({ type: 'Text' })).filter((row: any) => row.text?.trim() === text).at(-1)
const SAMPLE_BUILD = {
  ...at('implement'),
  task: { ...WAITING.task, title: 'Flag', stage: 'implement' },
  quality: [],
  build: { slices: [
    { n: 1, title: 'Registry', done: 2, total: 2 },
    { n: 2, title: 'Models', done: 1, total: 3 },
  ] },
}

test('the step is bold, QL is dim, the title is normal, and a whole request wins over a long title', async ($, on) => {
  world(on, { ...WAITING, task: { ...WAITING.task, title: 'A very long title that must yield to the approval request' } })
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await start($)
  for (const columns of [100, 60]) {
    const ui = await band($, columns)
    expect((await leafText(ui, 'QL'))?.props.dimColor).toBe(true)
    const step = await leafText(ui, '○ Plan')
    expect(step?.props.bold).toBe(true)
    expect(step?.props.color).toBe('#f7b23b')
    const request = await leafText(ui, 'Waits for your approval')
    expect(request?.props.color).toBe('#f7b23b')
    expect((await bandText(ui)).length).toBe(columns - 5)
    expect(await leafText(ui, 'A very long title that must yield to the approval request')).toBeUndefined()
    const title = (await ui.findAll({ type: 'Text' })).filter((row: any) => /^A very.*…$/.test(row.text)).at(-1)
    if (title !== undefined) {
      expect(title.props.bold).toBeUndefined()
      expect(title.props.dimColor).toBeUndefined()
    }
    expect(await ui.find({ type: 'Text', text: '▎' })).toBeUndefined()
    await ui.unmount()
  }
})

test('100 and 60 columns retain the slice, measured task count, distinct bar glyphs and Details', async ($, on) => {
  world(on, SAMPLE_BUILD)
  await start($)
  for (const columns of [100, 60]) {
    const ui = await band($, columns)
    const text = await bandText(ui)
    expect(text.length).toBe(columns - 5)
    expect(text).toContain(columns === 100 ? '1 of 2 slices' : '1/2 slices')
    expect(text).toContain(columns === 100 ? '━━━━━━···· 3/5 tasks' : '━━━·· 3/5 tasks')
    expect(text).toContain('d: Details')
    expect(await ui.find({ type: 'Text', text: '↑' })).toBeUndefined()
    if (columns === 60) expect(text).not.toContain('Flag')
    console.log(`BAND ${columns}: ${text}`)
    await ui.unmount()
  }
})

test('Details is a plain secondary button and pressing it opens the existing pane', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  await start($)
  for (const surface of ['terminal', 'desktop']) {
    const ui = await $.ui.mount({ plugin: 'qualitylayer', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95 } } as any)
    const details = await ui.find({ type: 'Button', key: 'ql-details' })
    expect(details?.props).toMatchObject({ label: 'Details', plain: true, dimColor: true, hotkey: 'd' })
    await ui.press({ key: 'ql-details' })
    expect(seen.opened.at(-1)).toMatchObject({ id: 'ql-progress', title: 'QualityLayer' })
    expect(seen.registered.join(' ')).toContain('task-pane')
    await ui.unmount()
  }
})

test('a recorded increase shows the cue for exactly 900 ms, without a progress toast or shifting cells', async ($, on) => {
  const { world: seen, clock } = world(on, SAMPLE_BUILD)
  await start($)
  const ui = await band($, 60)
  const resting = await bandText(ui)
  expect(resting).not.toContain('↑')
  seen.report = { ...SAMPLE_BUILD, build: { slices: [SAMPLE_BUILD.build.slices[0], { ...SAMPLE_BUILD.build.slices[1], done: 2 }] } }
  await clock.advance(5000)
  expect(await bandText(ui)).toContain('━━━━· 4/5 tasks ↑')
  expect((await bandText(ui)).indexOf('d: Details')).toBe(resting.indexOf('d: Details'))
  await clock.advance(899)
  expect(await bandText(ui)).toContain('↑')
  await clock.advance(1)
  expect(await bandText(ui)).not.toContain('↑')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
})

test('equal or lower counts, changed totals, another task, and a stage change never raise a cue', async ($, on) => {
  const { world: seen } = world(on, SAMPLE_BUILD)
  await start($)
  const ui = await band($)
  for (const report of [
    SAMPLE_BUILD,
    { ...SAMPLE_BUILD, build: { slices: [{ n: 1, title: 'Models', done: 2, total: 5 }] } },
    { ...SAMPLE_BUILD, build: { slices: [{ n: 1, title: 'Models', done: 4, total: 6 }] } },
    { ...SAMPLE_BUILD, task: { ...SAMPLE_BUILD.task, id: 'repo~other' }, build: { slices: [{ n: 1, title: 'Models', done: 5, total: 6 }] } },
    { ...at('verify'), quality: [] },
    { ...SAMPLE_BUILD, build: { slices: [{ n: 1, title: 'Models', done: 5, total: 5 }] } },
  ]) {
    seen.report = report
    await start($)
    expect(await bandText(ui)).not.toContain('↑')
  }
  await ui.unmount()
})

test('a pending cue clears immediately on a stage change and an older timeout cannot clear a newer cue', async ($, on) => {
  const { world: seen, clock } = world(on, SAMPLE_BUILD)
  await start($)
  const ui = await band($)
  const increased = { ...SAMPLE_BUILD, build: { slices: [SAMPLE_BUILD.build.slices[0], { ...SAMPLE_BUILD.build.slices[1], done: 2 }] } }
  seen.report = increased
  await start($)
  expect(await bandText(ui)).toContain('↑')
  await clock.advance(500)
  seen.report = { ...increased, build: { slices: [SAMPLE_BUILD.build.slices[0], { ...SAMPLE_BUILD.build.slices[1], done: 3 }] } }
  await start($)
  await clock.advance(400)
  expect(await bandText(ui)).toContain('↑')
  seen.report = { ...at('verify'), quality: [] }
  await start($)
  expect(await bandText(ui)).not.toContain('↑')
  await ui.unmount()
})

test('the static progress setting disables the cue', { options: { progressCue: false } }, async ($, on) => {
  const { world: seen } = world(on, SAMPLE_BUILD)
  await start($)
  seen.report = { ...SAMPLE_BUILD, build: { slices: [SAMPLE_BUILD.build.slices[0], { ...SAMPLE_BUILD.build.slices[1], done: 2 }] } }
  await start($)
  const ui = await band($)
  expect(await bandText(ui)).toContain('4/5 tasks')
  expect(await bandText(ui)).not.toContain('↑')
  await ui.unmount()
})

test('every failed status read replaces stale progress with a red row and Details, then recovers without a cue', async ($, on) => {
  const { world: seen } = world(on, SAMPLE_BUILD)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'light' }] }))
  await start($)
  const ui = await band($, 60)
  for (const failure of ['throw', 'exit', 'json']) {
    seen.fail = failure === 'throw'
    seen.exitCode = failure === 'exit' ? 1 : 0
    seen.stdout = failure === 'json' ? 'not JSON' : null
    await start($)
    expect(await bandText(ui)).toMatch(/^QL · Status unavailable\s+d: Details$/)
    expect((await leafText(ui, 'Status unavailable'))?.props.color).toBe('#c9292f')
    expect(await bandText(ui)).not.toMatch(/tasks|slice|↑/)
    await ui.press({ key: 'ql-details' })
    const details = await pane($)
    expect(await details.find({ type: 'Text', text: /qualitylayer status/ })).toBeDefined()
    await details.unmount()
    seen.fail = false
    seen.exitCode = 0
    seen.stdout = null
    seen.report = { ...SAMPLE_BUILD, build: { slices: [{ n: 1, title: 'Models', done: 4, total: 5 }] } }
    await start($)
    expect(await bandText(ui)).toContain('4/5 tasks')
    expect(await bandText(ui)).not.toContain('↑')
  }
  await ui.unmount()
})

test('long questions keep their kind in the band and their full text in the pane', async ($, on) => {
  const question = 'Should we keep the existing defaults for every customer, including the older installations and their saved preferences?'
  world(on, { ...at('plan'), question, needs_you: YOURS })
  await start($)
  const ui = await band($, 60)
  expect(await bandText(ui)).toContain('the agent asks next:')
  expect(await bandText(ui)).toContain('…')
  expect((await bandText(ui)).length).toBe(55)
  await ui.press({ key: 'ql-details' })
  const details = await pane($)
  expect(await details.find({ type: 'Text', text: question })).toBeDefined()
  await details.unmount()
  await ui.unmount()
})

test('the Plan is neutral while idle and blue only while its model turn runs', async ($, on) => {
  world(on, at('plan'))
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await start($)
  const ui = await band($)
  expect((await leafText(ui, '○ Plan'))?.props.color).toBeUndefined()
  await ui.redraw({ hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 95 } as any)
  expect((await leafText(ui, '○ Plan'))?.props.color).toBe('#5da3e5')
  expect(await bandText(ui)).not.toMatch(/tasks|↑/)
  await ui.unmount()
})

test('unknown or zero task totals show no bar, and Verify never shows build progress', async ($, on) => {
  const { world: seen } = world(on, at('implement'))
  await start($)
  const ui = await band($, 60)
  for (const report of [
    { ...at('implement'), build: null },
    { ...at('implement'), build: { slices: [] } },
    { ...at('implement'), build: { slices: [{ n: 1, title: 'Models', done: 0, total: 0 }] } },
    at('verify'),
  ]) {
    seen.report = report
    await start($)
    expect(await bandText(ui)).not.toMatch(/━|tasks|↑/)
    expect(await ui.find({ key: 'ql-details' })).toBeDefined()
  }
  expect(await bandText(ui)).toContain('Agents are checking')
  await ui.unmount()
})

function withoutHostPart(node: any) {
  const { part, ...tree } = node
  if (part !== undefined) expect(part).toEqual({ plugin: 'test' })
  return tree
}

test('a survey or idle returns the other band unchanged, even after a failed read', async ($, on) => {
  const { world: seen } = world(on, NO_TASK)
  const other = { type: 'Text', props: {}, children: ['Auto · ready  Router'] }
  on('ui.render', { component: 'AbovePrompt' }, () => other)
  await start($)
  const idle = await band($)
  expect(withoutHostPart(await idle.drawn())).toEqual(other)
  await idle.unmount()
  seen.report = WAITING
  seen.fail = true
  await start($)
  const survey = await band($, 60, { hasSurvey: true })
  expect(withoutHostPart(await survey.drawn())).toEqual(other)
  await survey.unmount()
})

test('every live row, including questions and errors, stacks once above the other mod', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  const other = { type: 'Text', props: {}, children: ['Auto · ready  Router'] }
  on('ui.render', { component: 'AbovePrompt' }, () => other)
  await start($)
  const ui = await band($, 60)
  for (const report of [WAITING, SAMPLE_BUILD, at('verify'), { ...at('verify'), gate: { ...WAITING.gate, target: 'final' } }]) {
    seen.report = report
    await start($)
    const tree = await ui.drawn()
    expect(tree.props.flexDirection).toBe('column')
    expect(tree.children).toHaveLength(2)
    const firstPart = tree.children[0]
    const hostOwnsPart = firstPart.props.key === undefined && firstPart.part?.plugin === 'qualitylayer'
    if (hostOwnsPart) {
      expect(firstPart.type).toBe('Box')
      expect(firstPart.props.flexDirection).toBe('column')
      expect(firstPart.children).toHaveLength(2)
      expect(firstPart.children[1].type).toBe('engine')
    }
    expect((hostOwnsPart ? firstPart.children[0] : firstPart).props.key).toBe('ql-band')
    expect(await ui.findAll({ key: 'ql-band' })).toHaveLength(1)
    expect(withoutHostPart(tree.children[1])).toEqual(other)
    expect((await bandText(ui)).length).toBe(55)
  }
  seen.fail = true
  await start($)
  expect(withoutHostPart((await ui.drawn()).children[1])).toEqual(other)
  await ui.unmount()
})

test('every task state fits both terminal widths, with the recorded meaning and semantic colours', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  const cases = [
    { report: at('plan'), step: '○ Plan', ink: undefined, words: 'Version flag' },
    { report: WAITING, step: '○ Plan', ink: '#f7b23b', words: 'Waits for your approval' },
    { report: SAMPLE_BUILD, step: '○ Implement', ink: '#5da3e5', words: '3/5 tasks' },
    { report: at('verify'), step: '○ Verify', ink: '#5da3e5', words: 'Agents are checking' },
    { report: { ...at('verify'), gate: { ...WAITING.gate, target: 'final' }, needs_you: YOURS }, step: '○ Verify', ink: '#f7b23b', words: 'Waits for your review' },
    { report: { ...at('plan'), question: 'Keep?', needs_you: YOURS }, step: '○ Plan', ink: '#f7b23b', words: 'the agent asks next: Keep?' },
  ]
  for (const columns of [100, 60]) {
    for (const sample of cases) {
      seen.report = sample.report
      await start($)
      const ui = await band($, columns)
      expect((await leafText(ui, sample.step))?.props.color).toBe(sample.ink)
      expect(await bandText(ui)).toContain(sample.words)
      expect((await bandText(ui)).length).toBe(columns - 5)
      if (sample.report.task?.stage !== 'implement') expect(await bandText(ui)).not.toMatch(/━|tasks|↑/)
      await ui.unmount()
    }
    seen.report = NO_TASK
    await start($)
    const idle = await band($, columns)
    expect(await idle.find({ key: 'ql-band' })).toBeUndefined()
    expect(await idle.find({ key: 'ql-details' })).toBeUndefined()
    await idle.unmount()
  }
})

test('a failed first read shows the error row, and a later failure cancels an already visible cue', async ($, on) => {
  const { world: seen, clock } = world(on, SAMPLE_BUILD)
  seen.exitCode = 1
  await start($)
  const ui = await band($, 60)
  expect(await bandText(ui)).toContain('Status unavailable')
  seen.exitCode = 0
  await start($)
  expect(await bandText(ui)).not.toContain('↑')
  seen.report = { ...SAMPLE_BUILD, build: { slices: [SAMPLE_BUILD.build.slices[0], { ...SAMPLE_BUILD.build.slices[1], done: 2 }] } }
  await start($)
  expect(await bandText(ui)).toContain('↑')
  seen.exitCode = 1
  await start($)
  expect(await bandText(ui)).not.toMatch(/↑|tasks|slice/)
  await clock.advance(900)
  expect(await bandText(ui)).toContain('Status unavailable')
  await ui.unmount()
})

test('long build needs keep their kind and full wording in Details, with no bar or cue', async ($, on) => {
  const what = 'A login for the integration environment before the remaining slice can complete its validation'
  world(on, { ...SAMPLE_BUILD, needs: [{ for: 'T14', what, waiting: true }], needs_you: YOURS })
  await start($)
  const ui = await band($, 60)
  expect(await bandText(ui)).toContain('the build waits for you:')
  expect(await bandText(ui)).toContain('…')
  expect(await bandText(ui)).not.toMatch(/━|tasks|↑/)
  expect((await bandText(ui)).length).toBe(55)
  await ui.press({ key: 'ql-details' })
  const details = await pane($)
  expect(await leafText(details, `the build waits for you: ${what}`)).toBeDefined()
  await details.unmount()
  await ui.unmount()
})

test('valid JSON with an invalid status shape is unavailable and cannot poison the next snapshot', async ($, on) => {
  const { world: seen } = world(on, SAMPLE_BUILD)
  await start($)
  const ui = await band($, 60)
  for (const report of [{}, false, [], { ok: false, task: null }, { ...SAMPLE_BUILD, quality: null }]) {
    seen.report = report
    await start($)
    expect(await bandText(ui)).toContain('Status unavailable')
    seen.report = SAMPLE_BUILD
    await start($)
    expect(await bandText(ui)).toContain('3/5 tasks')
    expect(await bandText(ui)).not.toContain('↑')
  }
  await ui.unmount()
})

test('a cue left in session state by a reload is cleared on the first read, including static mode', { options: { progressCue: false } }, async ($, on) => {
  world(on, SAMPLE_BUILD)
  let staleCue: unknown = { task: SAMPLE_BUILD.task.id, version: 3 }
  let version = 0
  on('state.get', { plugin: 'qualitylayer', key: 'snapshot' }, () => ({ value: { value: SAMPLE_BUILD, version: 0 } }))
  on('state.get', { plugin: 'qualitylayer', key: 'progressCue' }, () => ({ value: { value: staleCue, version } }))
  on('state.set', { plugin: 'qualitylayer', key: 'progressCue' }, (_$: any, e: any) => {
    staleCue = e.value
    return { value: { isSet: true, version: ++version } }
  })
  await start($)
  const ui = await band($)
  expect(await bandText(ui)).toContain('3/5 tasks')
  expect(await bandText(ui)).not.toContain('↑')
  await ui.unmount()
})

test('the pane shows the kind, the three steps, slices with bars, the security review, subagents and the second opinion', async ($, on) => {
  world(on, { ...at('verify') })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /Feature · Verify/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ Implement/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /One step registry/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^━{3}$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 1\/3$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Security review.*1 to fix/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /writing the carry-over test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /10 findings/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a security review that is off for the task is not listed', async ($, on) => {
  world(on, { ...at('verify'), quality: [{ step: 'security', state: 'off' }] })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /One step registry/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Security/ })).toBeUndefined()
  await ui.unmount()
})

test('a bug takes the same three steps, with its kind named', async ($, on) => {
  world(on, { ...at('plan'), task: { ...WAITING.task, title: 'Pager crash', kind: 'Bug fix', stage: 'plan' }, build: null, quality: [] })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Bug fix · Plan/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● Plan/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ Verify/ })).toBeDefined()
  await ui.unmount()
})

test('a shipped task stands on Verify with every step done', async ($, on) => {
  world(on, { ...at('shipped'), build: null, quality: [] })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '○ Verify')).toBeDefined()
  await ui.unmount()
})

test('the band is one line in the step line\'s words: the task, the step, how many items need you', async ($, on) => {
  world(on, { ...WAITING, open_items: 5 })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '5 items need you')).toBeDefined()
  expect(await leafText(ui, 'Version flag')).toBeDefined()
  expect(await leafText(ui, '○ Plan')).toBeDefined()
  await ui.unmount()
})

test('the band shares its place: another mod\'s band still shows beneath QualityLayer\'s line', async ($, on) => {
  world(on, { ...WAITING, open_items: 5 })
  // A mod beneath this one (a router, say) draws its own row in the same band.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['Auto · ready  Router'] }))
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '5 items need you')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Auto · ready  Router' })).toBeDefined()
  // The test's hooks stand for the engine, so its row arrives as the engine's drawing: what counts is
  // that the band keeps it, under QualityLayer's line, instead of drawing in its place.
  const outer = await ui.find({ type: 'Box' })
  expect(outer?.props?.flexDirection).toBe('column')
  expect(outer?.children).toHaveLength(2)
  await ui.unmount()
})

test('the count comes from the task summary too, and one item reads in the singular', async ($, on) => {
  world(on, { ...WAITING, task: { ...WAITING.task, openItems: 1 } })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '1 item needs you')).toBeDefined()
  await ui.unmount()
})

test('without a count the band still says that the Plan waits for your approval, and a review for your review', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  await start($)
  const ui = await band($)
  expect(await leafText(ui, 'Waits for your approval')).toBeDefined()
  await ui.unmount()

  seen.report = { ...WAITING, task: { ...WAITING.task, stage: 'verify' }, track: trackAt('verify'), gate: { ...WAITING.gate, target: 'final' } }
  await start($)
  const final = await band($)
  expect(await leafText(final, '○ Verify')).toBeDefined()
  expect(await leafText(final, 'Waits for your review')).toBeDefined()
  await final.unmount()
})

test('the band uses none of the words or decorative glyphs the App retired', async ($, on) => {
  world(on, { ...WAITING, open_items: 3 })
  await start($)
  const ui = await band($)
  for (const text of [/judge|gate|helper|verdict/i, /◆|↗|⏸/]) {
    expect(await ui.find({ type: 'Text', text })).toBeUndefined()
  }
  await ui.unmount()
})

test('the band goes at the first refresh after the gate was decided in the App', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  await start($)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /Waits for your approval/ })).toBeDefined()
  seen.report = DECIDED
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: /Waits for your/ })).toBeUndefined()
  expect(await leafText(ui, '○ Plan')).toBeDefined()
  expect(await leafText(ui, 'Version flag')).toBeDefined()
  await ui.unmount()
})

test('a build shows its slice and a task-labelled bar, and no checkpoint', async ($, on) => {
  world(on, {
    ...at('implement'),
    build: {
      slices: [
        { n: 1, title: 'One step registry', done: 2, total: 2 },
        { n: 2, title: 'Config and models', done: 1, total: 3 },
      ],
    },
  })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '○ Implement')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 of 2 slices/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /checkpoint/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^━{6}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^·{4}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3\/5 tasks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waits for you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\/ql-app/ })).toBeUndefined()
  await ui.unmount()
})

/** Routine work has a neutral ground; the step carries the semantic ink. */
const colours = async (ui: any) => {
  const tints = (await ui.findAll({ type: 'Box' })).map((box: any) => box.props.backgroundColor).filter(Boolean)
  const step = (await ui.findAll({ type: 'Text' })).filter((row: any) => /^○ \w+$/.test(row.text?.trim())).at(-1)
  return { tint: tints[0], ink: step?.props.color }
}

test("the band takes the App's colours for Claude Code's theme: blue while agents build, amber on your turn, named colours for ANSI", async ($, on) => {
  const { world: seen, clock } = world(on, {
    ...at('implement'),
    build: { slices: [{ n: 1, title: 'One step registry', done: 1, total: 3 }] },
  })
  let setting = 'dark'
  on('config.list', () => ({ value: [{ key: 'theme', value: setting }] }))
  await start($)
  const building = await band($)
  expect(await colours(building)).toEqual({ tint: undefined, ink: '#5da3e5' })
  await building.unmount()

  seen.report = WAITING
  setting = 'light'
  await clock.advance(5000)
  const yours = await band($)
  expect(await colours(yours)).toEqual({ tint: '#fff4dc', ink: '#9d6607' })
  expect(await yours.find({ type: 'Text', text: /━/ })).toBeUndefined()
  await yours.unmount()

  setting = 'dark-ansi'
  await clock.advance(5000)
  const named = await band($)
  expect(await colours(named)).toEqual({ tint: undefined, ink: 'yellow' })
  await named.unmount()
})

test('a narrow band gives up the title, and keeps the step, the slice and the bar', async ($, on) => {
  world(on, {
    ...at('implement'),
    task: { ...WAITING.task, stage: 'implement', title: 'Document header and team asks' },
    build: {
      slices: [
        { n: 1, title: 'One step registry', done: 2, total: 2 },
        { n: 2, title: 'Config and models', done: 1, total: 3 },
      ],
    },
  })
  await start($)
  const narrow = await band($, 60)
  expect(await bandText(narrow)).toContain('QL ○ Implement 1/2 slices')
  expect(await bandText(narrow)).not.toContain('Document')
  expect(await narrow.find({ type: 'Text', text: /3\/5 tasks/ })).toBeDefined()
  await narrow.unmount()
})

/**
 * The report's progress during a build. The band takes the task from it and counts the finished
 * slices itself, as the App's Implement page does: the fixture's two slices are both unfinished.
 */
const PROGRESS = { words: { place: 'slice 3 of 10 · task 4 of 7 (T13)' } }

test('wide bands show the build place; smaller bands keep the slice and measured count', async ($, on) => {
  world(on, { ...at('implement'), progress: PROGRESS })
  await start($)
  const wide = await $.ui.mount({
    plugin: 'qualitylayer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 } as any,
  } as any)
  expect(await bandText(wide)).toContain('QL ○ Implement · Version flag · 0 of 2 slices · task 4 of 7 (T13)')
  expect(await bandText(wide)).not.toContain('slice 3 of 10')
  expect(await bandText(wide)).not.toMatch(/min left|checkpoint/)
  await wide.unmount()
  const ui = await band($)
  expect(await bandText(ui)).toContain('0 of 2 slices')
  expect(await bandText(ui)).toContain('1/7 tasks')
  await ui.unmount()
})

test('the pane gives the build its place, with no time left or slice minutes', async ($, on) => {
  world(on, { ...at('implement'), progress: PROGRESS })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /^0 of 2 slices · task 4 of 7 \(T13\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / min$|min left/ })).toBeUndefined()
  await ui.unmount()
})

test('during the build the band never names a question, even a stale one', async ($, on) => {
  const { world: seen } = world(on, { ...at('implement'), progress: PROGRESS, question: 'Approve the Plan?' })
  await start($)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /asks next|Approve the Plan/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /0 of 2 slices/ })).toBeDefined()
  await ui.unmount()
  seen.report = { ...at('verify'), question: 'Approve the Plan?' }
  await start($)
  const checks = await band($)
  expect(await leafText(checks, '○ Verify')).toBeDefined()
  expect(await leafText(checks, 'Agents are checking')).toBeDefined()
  await checks.unmount()
})

test('a need of the build is kept for Verify while agents build, said at once when it is yours, and plainly once the build waits for it', async ($, on) => {
  const { world: seen } = world(on, {
    ...at('implement'),
    progress: PROGRESS,
    needs: [{ for: 'T14', what: 'A Stripe test key for slice 4', waiting: false }],
  })
  await start($)
  const kept = await band($)
  expect(await bandText(kept)).toContain('kept for your review: A Stripe test key')
  expect(await bandText(kept)).not.toMatch(/needs? you/)
  await kept.unmount()
  seen.report = {
    ...at('implement'),
    progress: PROGRESS,
    needs: [{ for: 'T14', what: 'A Stripe test key for slice 4', waiting: false }],
    needs_you: YOURS,
  }
  await start($)
  const ui = await band($)
  expect(await leafText(ui, 'needs you: A Stripe test key for slice 4 (T14) · the build goes on')).toBeDefined()
  await ui.unmount()
  seen.report = { ...at('implement'), needs: [{ for: 'T14', what: 'A Stripe test key for slice 4', waiting: true }], needs_you: YOURS }
  await start($)
  const waits = await band($)
  expect(await leafText(waits, 'the build waits for you: A Stripe test key for slice 4')).toBeDefined()
  await waits.unmount()
})

const REFUSED = { lead: 'Plan refused', words: 'two slices change the same file' }

test('refusals with no open item are the agent\'s work: the band says working, never needs you', async ($, on) => {
  const { world: seen } = world(on, { ...at('plan'), refusal: { ...REFUSED, count: 1, errors: 1 } })
  await start($)
  const once = await band($)
  expect(await leafText(once, 'working: fixing 1 validation error')).toBeDefined()
  await once.unmount()
  seen.report = { ...at('plan'), refusal: { ...REFUSED, count: 2, errors: 2 } }
  await start($)
  const twice = await band($)
  expect(await leafText(twice, 'working: fixing 2 validation errors')).toBeDefined()
  expect(await bandText(twice)).not.toMatch(/needs? you/)
  expect((await leafText(twice, '○ Plan'))?.props.color).not.toBe('#f7b23b')
  await twice.unmount()
})

test('the band counts the errors of the latest refusal, not how often it repeated', async ($, on) => {
  const { world: seen } = world(on, { ...at('plan'), refusal: { ...REFUSED, count: 3, errors: 2 } })
  await start($)
  const repeated = await band($)
  expect(await leafText(repeated, 'working: fixing 2 validation errors')).toBeDefined()
  await repeated.unmount()
  seen.report = { ...at('plan'), refusal: { ...REFUSED, count: 4, errors: 1 } }
  await start($)
  const one = await band($)
  expect(await leafText(one, 'working: fixing 1 validation error')).toBeDefined()
  await one.unmount()
})

test('an open question, gate or need keeps the band on needs you, whatever the refusals say', async ($, on) => {
  const refusal = { ...REFUSED, count: 3 }
  const { world: seen } = world(on, { ...at('plan'), question: 'Keep the defaults?', refusal, needs_you: YOURS })
  await start($)
  const batch = await band($)
  expect(await leafText(batch, 'the agent asks next: Keep the defaults?')).toBeDefined()
  expect(await bandText(batch)).not.toContain('working')
  await batch.unmount()
  seen.report = { ...WAITING, refusal }
  await start($)
  const gate = await band($)
  expect(await leafText(gate, 'Waits for your approval')).toBeDefined()
  expect(await bandText(gate)).not.toContain('working')
  await gate.unmount()
  seen.report = { ...at('implement'), needs: [{ for: 'T14', what: 'A Stripe test key', waiting: false }], refusal, needs_you: YOURS }
  await start($)
  const need = await band($)
  expect(await leafText(need, 'needs you: A Stripe test key (T14) · the build goes on')).toBeDefined()
  expect(await bandText(need)).not.toContain('working')
  await need.unmount()
})

test('a build that has not planned its slices says that agents are building', async ($, on) => {
  world(on, { ...at('implement'), build: null })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, 'Agents are building')).toBeDefined()
  await ui.unmount()
})

test('verify with no gate open says that agents are checking', async ($, on) => {
  world(on, at('verify'))
  await start($)
  const ui = await band($)
  expect(await leafText(ui, 'Agents are checking')).toBeDefined()
  await ui.unmount()
})

test('a build with items for you says so, like any other step', async ($, on) => {
  world(on, { ...at('implement'), open_items: 2, needs_you: YOURS })
  await start($)
  const ui = await band($)
  expect(await leafText(ui, '2 items need you')).toBeDefined()
  await ui.unmount()
})

test('the band says needs you only when the CLI says the task stands in Home\'s Needs you', async ($, on) => {
  const { world: seen } = world(on, { ...at('plan'), open_items: 2, question: 'Keep?' })
  await start($)
  const ui = await band($)
  expect(await bandText(ui)).not.toMatch(/needs? you|asks next/)
  await ui.unmount()
  // Home's words when the band has none of its own.
  seen.report = { ...at('plan'), needs_you: { words: 'No agent is attached' } }
  await start($)
  const words = await band($)
  expect(await leafText(words, 'No agent is attached')).toBeDefined()
  await words.unmount()
})

test('with no open task and nothing elsewhere no band shows, and the pane says so', async ($, on) => {
  world(on, NO_TASK)
  await start($)
  const ui = await band($)
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'task-pane' } as any)
  const shown = await pane($)
  expect(await shown.find({ type: 'Text', text: /No open QualityLayer task/ })).toBeDefined()
  await shown.unmount()
})

test("the band names the question the agent asks next, in place of a count, and the mod registers no ql-app command", async ($, on) => {
  const { world: seen } = world(on, { ...WAITING, open_items: 5, question: 'Approve the Plan?' })
  await start($)
  const ui = await band($)
  expect(
    await leafText(ui, 'the agent asks next: Approve the Plan?'),
  ).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /items? needs? you/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ql-app/ })).toBeUndefined()
  await ui.unmount()
  expect(seen.registered.join(' ')).toContain('task-pane')
  expect(seen.registered.join(' ')).not.toContain('ql-app')
  // Once the question is answered the band is the step's own words again.
  seen.report = { ...WAITING, open_items: 5 }
  await start($)
  const again = await band($)
  expect(await again.find({ type: 'Text', text: /the agent asks next/ })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: /5 items need you/ })).toBeDefined()
  await again.unmount()
})

test('a toast tells when a gate opens, once, and when the security review needs a fix', async ($, on) => {
  const { world: seen, clock } = world(on, { ...WAITING, gate: null, quality: [] })
  await start($)
  expect(seen.toasts).toEqual([])
  seen.report = { ...WAITING, quality: [] }
  await clock.advance(5000)
  await clock.advance(5000)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toBe('QualityLayer: the Plan waits for your approval in the App')
  seen.report = WAITING
  await clock.advance(5000)
  expect(seen.toasts).toHaveLength(2)
  expect(seen.toasts[1]).toBe('QualityLayer: security review found 1 to fix')
})

test('a toast says that the final review waits for your review, without the retired words', async ($, on) => {
  const { world: seen, clock } = world(on, { ...at('verify'), quality: [] })
  await start($)
  seen.report = { ...at('verify'), quality: [], gate: { ...WAITING.gate, target: 'final' } }
  await clock.advance(5000)
  expect(seen.toasts).toEqual(['QualityLayer: the change waits for your review in the App'])
  for (const toast of seen.toasts) expect(toast).not.toMatch(/judge|gate|helper|verdict|stopped/i)
})

test('a gate with a name the band does not know is told in step words, never a file name', async ($, on) => {
  const { world: seen, clock } = world(on, { ...at('plan'), quality: [] })
  await start($)
  seen.report = { ...at('plan'), quality: [], gate: { target: '05-amend.md', minutes: 1, cockpit: null } }
  await clock.advance(5000)
  expect(seen.toasts.at(-1)).toBe('QualityLayer: a review waits for you in the App')
  for (const toast of seen.toasts) expect(toast).not.toMatch(/\.md/)
})

test('the pane keeps to the App\'s words: no glyph for a wait, no checkpoint, Checked by agents, Agents working', async ($, on) => {
  world(on, { ...WAITING, task: { ...WAITING.task, stage: 'verify' }, track: trackAt('verify'), helpers: [{ id: 'j', role: 'judge', model: null, line: 'reading the diff', minutes: 2 }, { id: 'h', role: null, model: null, line: 'a test', minutes: 1 }] })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /^Waits for your approval · 12 min$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Checked by agents$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Agents working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^final check · reading the diff/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^agent · a test/ })).toBeDefined()
  // The slice's own row (the innermost Box that holds its title) is its mark, title and bar only.
  const rows = (await ui.findAll({ type: 'Box' })).map((row: any) => JSON.stringify(row.children))
  const slice = rows.filter((row: string) => row.includes('Config and models')).sort((a, b) => a.length - b.length)[0]
  expect(slice).toMatch(/0\/4/)
  expect(slice).not.toMatch(/checkpoint/)
  expect(slice).not.toMatch(/One step registry/)
  for (const retired of [/⏸|◆/, /Quality pass|Subagents|helper|judge/i]) {
    expect(await ui.find({ type: 'Text', text: retired })).toBeUndefined()
  }
  await ui.unmount()
})

test('one refresh timer runs however often a session starts', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  await start($)
  await start($)
  await start($)
  const before = seen.runs.length
  await clock.advance(5000)
  expect(seen.runs.length - before).toBe(1)
})

for (const [name, failure] of [
  ['missing CLI', { fail: true }],
  ['non-zero exit', { exitCode: 1 }],
  ['invalid JSON', { stdout: '{bad json' }],
]) test(`${name} clears the previous task and the next refresh recovers`, async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  await start($)
  const ui = await band($)
  expect(await leafText(ui, 'Version flag')).toBeDefined()
  Object.assign(seen, failure)
  await clock.advance(5000)
  expect(await leafText(ui, 'Status unavailable')).toBeDefined()
  expect(await leafText(ui, 'Version flag')).toBeUndefined()
  Object.assign(seen, { fail: false, exitCode: 0, stdout: null, report: NO_TASK })
  await clock.advance(5000)
  expect(await leafText(ui, 'Status unavailable')).toBeUndefined()
  expect(await leafText(ui, 'Version flag')).toBeUndefined()
  await ui.unmount()
})

test('a slow CLI becomes unavailable within a refresh and its late answer cannot restore stale task text', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  await start($)
  const ui = await band($)
  seen.slow = true
  await clock.advance(5000)
  await clock.advance(2000)
  expect(await leafText(ui, 'Status unavailable')).toBeDefined()
  expect(await leafText(ui, 'Version flag')).toBeUndefined()
  seen.complete?.()
  await clock.advance(0)
  expect(await leafText(ui, 'Status unavailable')).toBeDefined()
  expect(await leafText(ui, 'Version flag')).toBeUndefined()
  seen.slow = false
  seen.report = NO_TASK
  await clock.advance(3000)
  expect(await leafText(ui, 'Status unavailable')).toBeUndefined()
  expect(await leafText(ui, 'Version flag')).toBeUndefined()
  await ui.unmount()
})

test('a status call that fails draws "qualitylayer status failed", and the next refresh recovers', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  await start($)
  seen.fail = true
  await clock.advance(5000)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /qualitylayer status failed/ })).toBeDefined()
  seen.fail = false
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: /qualitylayer status failed/ })).toBeUndefined()
  await ui.unmount()
})

test('a status call that fails at the session start does not stop the session', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  seen.fail = true
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /qualitylayer status failed/ })).toBeDefined()
  await ui.unmount()
})

test('the mod adds no status line of its own, and only reads the CLI about its own session', async ($, on) => {
  const { world: seen, clock } = world(on, at('plan'))
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  await clock.advance(65_000)
  expect(seen.statuses).toBe(0)
  expect(seen.runs.length).toBeGreaterThan(0)
  // Each status read names this session: another session's task in the same repository never shows.
  for (const run of seen.runs) expect(run.slice(-4)).toEqual(['status', '--json', '--session', SESSION])
  // The board's reads leave this session's own task out, and no pull request is read while none is old.
  expect(seen.boardRuns.length).toBeGreaterThan(0)
  for (const run of seen.boardRuns) expect(run.slice(-5)).toEqual(['status', '--json', '--board', '--except', 'repo~demo'])
  expect(seen.prRuns).toEqual([])
})

test('Plan review work never asks for approval until the CLI says it is the person’s turn', async ($, on) => {
  const reviewing = {
    ...WAITING,
    quality: [],
    helpers: [],
    waiting_on: { kind: 'agent', reason: 'review', since: 1 },
    review: { ...WAITING.review, state: 'running' },
    needs_you: null,
  }
  const { world: seen, clock } = world(on, reviewing)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await start($)
  let ui = await band($)
  expect(await bandText(ui)).toContain('Reviewing Plan')
  expect(await bandText(ui)).not.toContain('Waits for your approval')
  expect((await leafText(ui, '○ Plan'))?.props.color).toBe('#5da3e5')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
  const details = await pane($)
  expect(await leafText(details, 'Reviewing Plan · 12 min')).toBeDefined()
  expect(await leafText(details, 'Waits for your approval · 12 min')).toBeUndefined()
  await details.unmount()
  seen.report = { ...reviewing, review: { ...reviewing.review, state: 'done' } }
  await clock.advance(5000)
  ui = await band($)
  expect(await bandText(ui)).toContain('Updating Plan')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
  seen.report = { ...reviewing, review: { ...reviewing.review, state: 'failed' } }
  await clock.advance(5000)
  ui = await band($)
  expect(await bandText(ui)).toContain('Review paused')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
  seen.report = { ...reviewing, question: 'Which option should we use?', waiting_on: { kind: 'person', reason: 'question', since: 2 }, needs_you: YOURS }
  await clock.advance(5000)
  ui = await band($)
  expect(await bandText(ui)).toContain('the agent asks next: Which option should we use?')
  expect(seen.toasts).toEqual([])
  await ui.unmount()
  seen.report = { ...reviewing, waiting_on: { kind: 'person', reason: 'plan_approval', since: 2 }, needs_you: YOURS }
  await clock.advance(5000)
  ui = await band($)
  expect(await bandText(ui)).toContain('Waits for your approval')
  expect((await leafText(ui, '○ Plan'))?.props.color).toBe('#f7b23b')
  await ui.unmount()
  await clock.advance(5000)
  expect(seen.toasts).toEqual(['QualityLayer: the Plan waits for your approval in the App'])
})

// ---------------------------------------------------------------- the other tasks (the board)

const othersText = async (ui: any) => {
  const line = await ui.find({ type: 'Box', key: 'ql-others' })
  return line === undefined ? '' : textOf(line)
}
/** The SDK draws the open button's explicit label. */
const openLabel = async (ui: any) => {
  const button = await ui.find({ type: 'Button', key: 'ql-others-open' })
  return button?.props.label ?? ''
}

test('a second band line says how many other tasks need you, the first one, and what runs, wide and at 55 columns', async ($, on) => {
  const { world: seen, clock } = world(on, SAMPLE_BUILD)
  seen.board = boardAnswer(BOARD)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await start($)
  await clock.settle()
  const wide = await band($, 130)
  expect(await openLabel(wide)).toBe('! 4 other tasks need you')
  const openButton = await wide.find({ type: 'Button', key: 'ql-others-open' })
  expect(openButton?.props.plain).toBe(true)
  expect(openButton?.props.label).toBe('! 4 other tasks need you')
  const text = await othersText(wide)
  expect(text.length).toBe(125)
  expect(text).toContain('Refund webhooks')
  expect(text).toContain('Plan waits for your approval')
  expect(text).toContain('+3')
  expect(text).toContain('1 running')
  expect(text).toContain('1 PR')
  expect((await leafText(wide, 'Plan waits for your approval'))?.props.color).toBe('#f7b23b')
  // The task's own line stays first and whole.
  const lines = (await wide.find({ type: 'Box', key: 'ql-lines' }))?.children ?? []
  expect(lines.map((one: any) => one.props.key)).toEqual(['ql-band', 'ql-others'])
  await wide.unmount()
  const narrow = await band($, 60)
  expect(await openLabel(narrow)).toBe('! 4 others')
  expect(await othersText(narrow)).not.toContain('Plan waits')
  expect(await othersText(narrow)).not.toContain('running')
  expect((await othersText(narrow)).length).toBe(55)
  await narrow.unmount()
  // In between, the words give way first and the counts keep theirs.
  const middle = await band($, 105)
  expect(await othersText(middle)).toContain('Refund webhooks')
  expect(await othersText(middle)).not.toContain('Plan waits')
  expect(await othersText(middle)).toContain('1 running')
  await middle.unmount()
})

// Closing the pane (the engine's `ui.close` with origin `person`) gives the line back; the kit
// cannot raise a person's close, so the real Claude Code run checks that part.
test('the count opens the pane, and while it is open the band keeps one line', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  seen.board = boardAnswer(BOARD)
  await start($)
  await clock.settle()
  const ui = await band($)
  await ui.press({ key: 'ql-others-open' })
  expect(seen.opened.at(-1)).toMatchObject({ id: 'ql-progress', title: 'QualityLayer' })
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'ql-band' })).toBeDefined()
  await ui.unmount()
})

test('with no task here the board is the band itself, with QL, the count and Details; nothing waiting draws nothing', async ($, on) => {
  const { world: seen, clock } = world(on, NO_TASK)
  seen.board = boardAnswer({ ...BOARD, needs: { rows: BOARD.needs.rows.slice(0, 1), count: 1 } })
  await start($)
  await clock.settle()
  const ui = await band($, 130)
  expect(await openLabel(ui)).toBe('! 1 task needs you')
  expect(textOf(await ui.find({ type: 'Box', key: 'ql-band' }))).toMatch(/^QL .*Refund webhooks · Plan waits for your approval.*d: Details$/)
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeUndefined()
  seen.board = boardAnswer({ ...BOARD, needs: { rows: [], count: 0 } })
  await clock.advance(15_000)
  expect(await ui.find({ type: 'Box', key: 'ql-band' })).toBeUndefined()
  await ui.unmount()
})

test('the pane lists All tasks in three parts with ages, links, +N more, and every heading folds', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  seen.board = boardAnswer({
    ...BOARD,
    needs: { ...BOARD.needs, rows: BOARD.needs.rows.map((one, i) => ({ ...one, since: NOW - (12 - i * 4) * MIN })) },
  })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'All tasks' })).toBeDefined()
  expect(await ui.find({ type: 'Link', props: { label: 'Home ↗' } })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ql-fold-needs', props: { label: '▾ Needs you · 4' } })).toBeDefined()
  const headingButton = await ui.find({ type: 'Button', key: 'ql-fold-needs' })
  expect(headingButton?.props.plain).toBe(true)
  expect(headingButton?.props.label).toBe('▾ Needs you · 4')
  expect(await ui.find({ type: 'Button', key: 'ql-fold-running', props: { label: '▾ Running · 1' } })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ql-fold-prs', props: { label: '▾ Pull requests · 1' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '12m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  +1 more' })).toBeDefined()
  expect(await ui.find({ type: 'Link', props: { href: 'http://127.0.0.1:41888/#/task/p~refund' } })).toBeDefined()
  expect(await ui.find({ type: 'Link', props: { label: '#418' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '9/17' }) ?? await ui.find({ type: 'Text', text: ' 9/17' })).toBeDefined()
  await ui.press({ key: 'ql-fold-needs' })
  expect(await ui.find({ type: 'Button', key: 'ql-fold-needs', props: { label: '▸ Needs you · 4' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  +1 more' })).toBeUndefined()
  await ui.press({ key: 'ql-fold-needs' })
  expect(await ui.find({ type: 'Button', key: 'ql-fold-needs', props: { label: '▾ Needs you · 4' } })).toBeDefined()
  await ui.unmount()
})

test('a pull request says when it was read: "read just now", then "read 4m ago"', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  const readAt = (at: number) => boardAnswer({ ...BOARD, prs: { ...BOARD.prs, rows: [{ ...BOARD.prs.rows[0], pr: { ...BOARD.prs.rows[0].pr, readAt: at } }] } })
  seen.board = readAt(NOW - 10_000)
  await start($)
  await clock.settle()
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'read just now' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /now ago/ })).toBeUndefined()
  seen.board = readAt(NOW - 4 * MIN)
  await clock.advance(15_000)
  expect(await ui.find({ type: 'Text', text: 'read 4m ago' })).toBeDefined()
  await ui.unmount()
})

test('⧉ resume copies the command that resumes an agent outside the App, and says so', async ($, on) => {
  const { world: seen } = world(on, WAITING)
  seen.board = boardAnswer(BOARD)
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  await ui.press({ key: 'ql-copy-w~login' })
  expect(seen.copied).toEqual(['codex resume 019a2f3c'])
  expect(seen.toasts.at(-1)).toBe('Copied codex resume 019a2f3c')
  await ui.unmount()
})

test('with no task and an empty board the pane says so; parts with no rows are left out', async ($, on) => {
  const { world: seen } = world(on, NO_TASK)
  seen.board = boardAnswer({ ...EMPTY_BOARD, running: BOARD.running })
  await start($)
  await $.command.run({ command: 'task-pane' } as any)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /No open QualityLayer task/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ql-fold-running', props: { label: '▾ Running · 1' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Needs you/ })).toBeUndefined()
  seen.board = boardAnswer(EMPTY_BOARD)
  await ui.unmount()
})

test('the board reads on its own 15-second clock, and a slow or failed board read never holds the band', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  seen.board = boardAnswer(BOARD)
  await start($)
  await clock.settle()
  const ui = await band($)
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeDefined()
  const before = seen.boardRuns.length
  await clock.advance(5000)
  expect(seen.boardRuns.length).toBe(before)
  await clock.advance(10_000)
  expect(seen.boardRuns.length).toBe(before + 1)
  // A board read that hangs: the task's band refreshes on, and the last board stays.
  seen.boardSlow = true
  seen.report = DECIDED
  await clock.advance(15_000)
  await clock.advance(5_000)
  expect(await leafText(ui, 'Status unavailable')).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeDefined()
  // After the read gave up, a failing one keeps the last board too.
  await clock.advance(10_000)
  seen.boardSlow = false
  seen.boardFail = true
  await clock.advance(15_000)
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeDefined()
  await ui.unmount()
})

test('a pull request read long ago starts one background pr read, not again within two minutes', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  seen.board = boardAnswer(BOARD)
  await start($)
  await clock.settle()
  expect(seen.prRuns.length).toBe(1)
  expect(seen.prRuns[0].slice(-3)).toEqual(['pr', 'read', '--stale'])
  await clock.advance(60_000)
  expect(seen.prRuns.length).toBe(1)
  await clock.advance(75_000)
  expect(seen.prRuns.length).toBe(2)
  // Fresh records start nothing.
  const fresh = (one: any) => ({ ...one, pr: one.pr === null ? null : { ...one.pr, readAt: NOW + 10 * MIN } })
  seen.board = boardAnswer({
    ...BOARD,
    needs: { ...BOARD.needs, rows: BOARD.needs.rows.map(fresh) },
    prs: { ...BOARD.prs, rows: BOARD.prs.rows.map(fresh) },
  })
  await clock.advance(150_000)
  expect(seen.prRuns.length).toBe(2)
})

test('an answer that is not a board is ignored, and the band keeps what it showed', async ($, on) => {
  const { world: seen, clock } = world(on, WAITING)
  seen.board = boardAnswer(BOARD)
  await start($)
  await clock.settle()
  const ui = await band($)
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeDefined()
  seen.board = { ok: true, board: { needs: 'nope' } }
  await clock.advance(15_000)
  expect(await ui.find({ type: 'Box', key: 'ql-others' })).toBeDefined()
  await ui.unmount()
})
