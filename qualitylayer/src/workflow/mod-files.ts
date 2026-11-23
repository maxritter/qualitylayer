// The files of the Claude Code mod (workflow/mod/qualitylayer), embedded as text for the installer.
// The mod draws the CLI's reported state. The local workflow manifest records these
// bootstrap inputs too; the installer imports them directly to render the installed files.

// TypeScript reads these as modules, which they are not here: they are text.
import pluginJson from "./mod/qualitylayer/.claude-plugin/plugin.json" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import atoms from "./mod/qualitylayer/hooks/atoms.ts" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import band from "./mod/qualitylayer/hooks/band.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import bandLayout from "./mod/qualitylayer/hooks/band-layout.ts" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import bandLine from "./mod/qualitylayer/hooks/band-line.ts" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import bandModel from "./mod/qualitylayer/hooks/band-model.ts" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import board from "./mod/qualitylayer/hooks/board.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import boardModel from "./mod/qualitylayer/hooks/board-model.ts" with { type: "text" }
import hooksJson from "./mod/qualitylayer/hooks/hooks.json" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import palette from "./mod/qualitylayer/hooks/palette.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import pane from "./mod/qualitylayer/hooks/pane.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import paneSections from "./mod/qualitylayer/hooks/pane-sections.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import registerTest from "./mod/qualitylayer/hooks/register.test.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import register from "./mod/qualitylayer/hooks/register.tsx" with { type: "text" }
// @ts-expect-error a module without a default export, imported as text
import status from "./mod/qualitylayer/hooks/status.ts" with { type: "text" }
// @ts-expect-error a declaration file, imported as text
import types from "./mod/qualitylayer/types/index.d.ts" with { type: "text" }

export type ModFile = { path: string; text: string }

/** Where the installer puts the binary's path in the mod. */
export const MOD_BIN_PLACEHOLDER = "{{QUALITYLAYER_BIN}}"

export const MOD_FILES: readonly ModFile[] = [
  { path: ".claude-plugin/plugin.json", text: pluginJson },
  { path: "hooks/atoms.ts", text: atoms },
  { path: "hooks/band-layout.ts", text: bandLayout },
  { path: "hooks/band-line.ts", text: bandLine },
  { path: "hooks/band-model.ts", text: bandModel },
  { path: "hooks/band.tsx", text: band },
  { path: "hooks/board-model.ts", text: boardModel },
  { path: "hooks/board.tsx", text: board },
  { path: "hooks/hooks.json", text: hooksJson },
  { path: "hooks/palette.tsx", text: palette },
  { path: "hooks/pane-sections.tsx", text: paneSections },
  { path: "hooks/pane.tsx", text: pane },
  { path: "hooks/register.tsx", text: register },
  { path: "hooks/register.test.tsx", text: registerTest },
  { path: "hooks/status.ts", text: status },
  { path: "types/index.d.ts", text: types },
]

/** The shipped mod, pointing at the same installed entry as the skills and hooks. */
export function renderModFiles(binary: string): ModFile[] {
  const path = JSON.stringify(binary).slice(1, -1)
  return MOD_FILES.map((file) => ({
    path: file.path,
    text: file.text.replaceAll(MOD_BIN_PLACEHOLDER, path),
  }))
}
