import { marked } from "marked"
import { useEffect, useMemo, useRef, useState } from "react"
import type { WalkFile } from "../../core/review/walkthrough.ts"
import { sanitize } from "../reader/DocReader.tsx"
import type { FilePart } from "./parts.ts"

export type SourceRequest = { path: string; stamp: string; side: "old" | "new" }
export type ReviewSource = SourceRequest & { content: string }
export type SourceLoader = (request: SourceRequest) => Promise<ReviewSource>

function buildSourceRequest(
  file: WalkFile | undefined,
  enabled: boolean,
  part?: FilePart,
): SourceRequest | null {
  if (!enabled || !file) return null
  return {
    path: file.path,
    stamp: part?.stamp ?? file.stamp ?? "",
    side: (part?.part?.status ?? file.status) === "D" ? "old" : "new",
  }
}

async function fetchValidatedSource(
  request: SourceRequest,
  load: SourceLoader,
): Promise<ReviewSource> {
  const source = await load(request)
  if (
    source.path !== request.path ||
    source.stamp !== request.stamp ||
    source.side !== request.side
  ) {
    throw new Error("The file revision changed. Refresh Review before reading this source.")
  }
  return source
}

type SourceResult = { identity: string; data?: ReviewSource; error?: string }

function subscribeSourceLoad(
  request: SourceRequest | null,
  identity: string,
  load: SourceLoader | undefined,
  cache: Map<string, ReviewSource>,
  setResult: (next: SourceResult) => void,
): (() => void) | undefined {
  if (request === null) return undefined
  if (!request.stamp || !load) {
    setResult({
      identity,
      error: "An exact task-owned file revision is not available. Read the diff instead.",
    })
    return undefined
  }
  const known = cache.get(identity)
  if (known) {
    setResult({ identity, data: known })
    return undefined
  }
  let live = true
  setResult({ identity })
  void fetchValidatedSource(request, load)
    .then((source) => {
      if (!live) return
      cache.set(identity, source)
      setResult({ identity, data: source })
    })
    .catch((cause: unknown) => {
      if (live)
        setResult({ identity, error: cause instanceof Error ? cause.message : String(cause) })
    })
  return () => {
    live = false
  }
}

export function useReviewSource(
  file: WalkFile | undefined,
  enabled: boolean,
  load: SourceLoader | undefined,
  part?: FilePart,
) {
  const request = useMemo(() => buildSourceRequest(file, enabled, part), [enabled, file, part])
  const [attempt, retry] = useState(0)
  const identity = JSON.stringify([request, attempt])
  const cache = useRef(new Map<string, ReviewSource>())
  const [result, setResult] = useState<SourceResult | null>(null)
  useEffect(
    () => subscribeSourceLoad(request, identity, load, cache.current, setResult),
    [request, identity, load],
  )
  return {
    source: result?.identity === identity ? result.data : undefined,
    error: result?.identity === identity ? result.error : undefined,
    retry: () => retry((value) => value + 1),
  }
}

/** Arbitrary repository prose uses generic Markdown, without workflow directives or remote media. */
export function sourceMarkdownHtml(content: string): string {
  const escapeSourceHtml = (text: string) =>
    text.replace(
      /[&<>"]/g,
      (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[value] ?? value,
    )
  const renderer = new marked.Renderer()
  renderer.html = ({ text }) => escapeSourceHtml(text)
  renderer.image = ({ text }) => escapeSourceHtml(text)
  const template = document.createElement("template")
  template.innerHTML = sanitize(marked.parse(content, { async: false, renderer }))
  for (const media of template.content.querySelectorAll(
    "script,iframe,object,embed,style,img,picture,video,audio,source,track,svg,link,meta,base",
  )) {
    media.replaceWith(document.createTextNode(media.getAttribute("alt") ?? ""))
  }
  for (const control of template.content.querySelectorAll("input,button,textarea,select"))
    control.setAttribute("disabled", "")
  return template.innerHTML
}

export function SourceMarkdown({ content, onSource }: { content: string; onSource: () => void }) {
  const html = useMemo(() => sourceMarkdownHtml(content), [content])
  return (
    <div className="rw-rendered">
      <div className="rw-rendered-note">
        <span>Line comments remain attached to the source.</span>
        <button type="button" className="rw-lnk" onClick={onSource}>
          View source
        </button>
      </div>
      <article
        className="rw-prose"
        aria-label="Rendered Markdown"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shared DocReader sanitizer, then all source media removed in inert template
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
