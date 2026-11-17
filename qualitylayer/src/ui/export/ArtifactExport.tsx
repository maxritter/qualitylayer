import type { Artifact, ArtifactPageInfo } from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import { ExportCard } from "./ExportCard.tsx"
import { exportName, exportRevision } from "./filename.ts"

export function ArtifactExport({
  api,
  artifact,
  title,
  html,
  pages,
  currentFile,
  loadPage,
}: {
  api?: Pick<Api, "exportFile">
  artifact: Artifact | null
  title: string
  html: string | null
  pages: ArtifactPageInfo[]
  currentFile: string | null
  loadPage?: (file: string) => Promise<string>
}) {
  return (
    <ExportCard
      title={title}
      kind="artifact"
      pages={Math.max(1, pages.length)}
      disabled={!html}
      write={api?.exportFile}
      prepare={async (format, scope, signal) => {
        if (!html) throw new Error("The artifact is still loading. Try again in a moment.")
        const width = artifact?.width ?? 1280
        const selected =
          scope === "all" && pages.length > 1
            ? pages
            : [
                {
                  file: currentFile ?? artifact?.file ?? "",
                  title: pages.find((page) => page.file === currentFile)?.title ?? title,
                },
              ]
        const prepared = []
        for (const page of selected) {
          if (signal.aborted) throw new DOMException("Export cancelled", "AbortError")
          const source =
            page.file === currentFile || selected.length === 1 ? html : await loadPage?.(page.file)
          if (!source)
            throw new Error(`Could not include “${page.title}”. Open the page and try again.`)
          prepared.push({ title: page.title, html: source, width })
        }
        return {
          format,
          title,
          name: exportName(title),
          pages: prepared,
          revision: await exportRevision(JSON.stringify(prepared)),
        }
      }}
    />
  )
}
