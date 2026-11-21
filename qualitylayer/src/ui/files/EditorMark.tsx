// The mark of a place a file opens in: VS Code's own logo, Cursor's agent mark, and a plain glyph for
// Zed, Finder and Terminal. Decoration beside the name, so a screen reader skips it.

import { FileCodeIcon, FolderOpenIcon, SquareTerminalIcon } from "lucide-react"
import type { Editor } from "../../core/config-values.ts"
import { AgentMark } from "../kit/marks/index.ts"

/** Visual Studio Code, from Simple Icons 12.4.0 (CC0 1.0); see THIRD_PARTY_NOTICES.md. */
const VSCODE_PATH =
  "M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"

export function EditorMark({ editor, size = 14 }: { editor: Editor; size?: number }) {
  if (editor === "vscode")
    return (
      <svg
        className="q-edm"
        data-editor-mark="vscode"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <path fill="#2f80ed" d={VSCODE_PATH} />
      </svg>
    )
  if (editor === "cursor") return <AgentMark agent="cursor" size={size} />
  const Glyph =
    editor === "zed" || editor === "custom"
      ? FileCodeIcon
      : editor === "finder"
        ? FolderOpenIcon
        : SquareTerminalIcon
  return <Glyph className="q-edm" data-editor-mark={editor} size={size} aria-hidden="true" />
}
