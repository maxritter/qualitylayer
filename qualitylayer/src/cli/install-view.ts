// The install screen, in the shape people know from `npx skills add`: the
// wordmark, a badge, one line per step as it finishes, a summary of what was
// installed, and "Done!" with the first command to type. On a terminal it is
// drawn in the brand blue; piped, in CI, with NO_COLOR or TERM=dumb the same
// lines come without colour or animation. `--json` never comes here.

import { realpathSync } from "node:fs"
import { intro, note, outro, spinner } from "@clack/prompts"
import type { InstallReport } from "../core/install/install.ts"
import { VERSION } from "../core/version.ts"
import type { Ctx } from "../ctx.ts"
import { installCmd } from "./commands/install.ts"
import {
  AMBER,
  BLUE_LIGHT,
  badge,
  bold,
  counted,
  dim,
  fg,
  GREEN,
  headerLines,
  INSTALL_AGENTS,
  licenceLine,
  nextLines,
  styleFor,
  tilde,
  type ViewStyle,
  wrapList,
  wrapText,
} from "./install-view-format.ts"

export { headerLines, nextLines, styleFor, type ViewStyle }

const LABEL = 13
type AddItem = (label: string, value: string[], warn?: boolean) => void

function addSkillItems(item: AddItem, report: InstallReport, home: string, style: ViewStyle): void {
  for (const agent of INSTALL_AGENTS) {
    const names = [
      ...new Set(
        report.skills
          .filter((skill) => skill.label === agent && skill.path.endsWith("/SKILL.md"))
          .map((skill) => skill.path.split("/").at(-2) as string),
      ),
    ]
    if (names.length > 0) item(agent, [names.join(dim(" · ", style))])
  }
  if (report.skills.length === 0) {
    item(
      "Agents",
      [
        "no supported agent configured",
        `copy the skill folders from ${tilde(report.skillCopy, home)} into your agent's skills directory`,
      ],
      true,
    )
  }
}

function addSettingsItem(
  item: AddItem,
  report: InstallReport,
  room: number,
  style: ViewStyle,
): void {
  if (report.settings.length === 0) return
  const groups = INSTALL_AGENTS.map((agent) => ({
    agent,
    labels: counted(report.settings.filter((s) => s.agent === agent).map((s) => s.label)),
  })).filter((group) => group.labels.length > 0)
  item("Settings", [
    dim(`${report.settings.length} set for QualityLayer, uninstall puts them back`, style),
    ...groups.flatMap((group) => {
      const [first = "", ...more] = wrapList(group.labels, room - 13)
      return [
        `${dim(group.agent.padEnd(13), style)}${first}`,
        ...more.map((line) => `${" ".repeat(13)}${line}`),
      ]
    }),
  ])
}

function addTailItems(item: AddItem, report: InstallReport, home: string, style: ViewStyle): void {
  for (const message of report.declined) item("Kept yours", [message])
  if (report.memoryTools.length > 0)
    item(
      "Memory tools",
      report.memoryTools.map((row) => row.message),
      report.memoryTools.some((row) => row.state === "skipped" || row.state === "failed"),
    )
  if (report.kept.length > 0) {
    item(
      "Left alone",
      ["changed by you, so not replaced:", ...report.kept.map((path) => tilde(path, home))],
      true,
    )
  }
  if (report.licence !== "") {
    const licence = licenceLine(report.licence)
    item("Licence", [licence.text], licence.warn)
  }
  if (report.pathLine !== null) {
    item(
      "PATH",
      [
        "add this line to your shell profile, then open a new terminal:",
        fg(BLUE_LIGHT, report.pathLine, style),
      ],
      true,
    )
  }
}

/**
 * What was installed, one item each: `✓ Label  value`, a warning `▲` where the
 * user has something to do. The summary note's content.
 */
export function summaryLines(report: InstallReport, home: string, style: ViewStyle): string[] {
  // The note's frame and the item's own columns take about 22 characters.
  const room = Math.max(28, style.width - LABEL - 10)
  const lines: string[] = []
  const item: AddItem = (label, value, warn = false) => {
    const symbol = warn ? fg(AMBER, "▲", style) : fg(GREEN, "✓", style)
    const [first = "", ...rest] = value.flatMap((line) => wrapText(line, room))
    lines.push(`${symbol} ${bold(label.padEnd(LABEL), style)}${first}`)
    for (const line of rest) lines.push(`  ${" ".repeat(LABEL)}${line}`)
  }

  item("Binary", [
    tilde(report.binary, home),
    ...(report.linked !== null ? [dim(`linked from ${tilde(report.linked, home)}`, style)] : []),
    ...(report.shortcut !== null
      ? [
          `${dim("short command:", style)} ${bold("ql", style)} ${dim("(ql app, ql --help)", style)}`,
        ]
      : []),
  ])
  if (report.shortcut === null && report.shortcutTaken !== null) {
    item(
      "Short name",
      [
        `another command named ql is kept at ${tilde(report.shortcutTaken, home)}; use qualitylayer`,
      ],
      true,
    )
  }
  addSkillItems(item, report, home, style)
  addSettingsItem(item, report, room, style)
  addTailItems(item, report, home, style)
  return lines
}

/** Each step as it finishes, said the way `npx skills` says it. */
const DONE: Record<string, string> = {
  "Placing the binary": "Binary in place",
  "Adding the skills": "Skills added",
  "Checking your licence": "Licence checked",
  "Fetching the workflow": "Workflow fetched",
  "Setting up your agents": "Agents set up",
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `qualitylayer install` in text mode: the screen above around the install itself. */
export async function installView(ctx: Ctx, args: string[]): Promise<number> {
  const out = process.stdout
  const style = styleFor(ctx.env, out)
  const live = style.color && out.isTTY === true && ctx.env.get("CI") !== "true"
  const shown = live ? style : { ...style, color: false }
  const write = (lines: string[]) => out.write(`${lines.join("\n")}\n`)
  const home = realHome(ctx.env.get("HOME") ?? "")

  if (!live) {
    const result = await installCmd(ctx, args)
    if (!result.ok) {
      write([`▲ ${result.error.message}`])
      return 1
    }
    const report = result.data as InstallReport
    write([
      `QualityLayer ${VERSION}`,
      "",
      ...summaryLines(report, home, shown),
      "",
      "Done. Start your first task:",
      ...nextLines(report, shown).map((line) => `  ${line}`),
    ])
    return 0
  }

  // The wordmark draws in line by line: well under a quarter of a second.
  for (const line of headerLines(VERSION, style)) {
    out.write(`${line}\n`)
    await pause(18)
  }
  intro(badge("qualitylayer", style), { output: out })

  let current: string | null = null
  const steps = spinner({ output: out })
  const result = await installCmd(ctx, args, {
    progress: (label) => {
      if (current !== null) steps.stop(DONE[current] ?? current)
      steps.start(label)
      current = label
    },
  })
  if (current !== null) {
    if (result.ok) steps.stop(DONE[current] ?? current)
    else steps.error(result.error.message)
  }
  if (!result.ok) {
    outro(fg(AMBER, "Nothing more was changed.", style), { output: out })
    return 1
  }
  const report = result.data as InstallReport
  note(summaryLines(report, home, style).join("\n"), fg(GREEN, "Installed", style), {
    output: out,
  })
  // Under "└  Done!", each following line lines up with the first.
  outro(
    [
      `${fg(GREEN, "Done!", style)}  Start your first task:`,
      ...nextLines(report, style).map((line) => `   ${line}`),
    ].join("\n"),
    { output: out },
  )
  return 0
}

/** HOME as install records paths: macOS's temp and home folders can sit behind a link. */
function realHome(home: string): string {
  try {
    return realpathSync(home)
  } catch {
    return home
  }
}
