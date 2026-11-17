import { type DefaultTreeAdapterTypes as Html, parseFragment, serialize } from "parse5"

const WIDTH = 680
const HEIGHT = 880
const OVERLAP = 40

export const figureStyles = `.export-figure{display:block;margin:20px 0}.export-overview{display:block;text-align:center;break-inside:avoid}.export-overview img{max-width:100%;max-height:${HEIGHT}px;width:auto;height:auto;object-fit:contain}.export-caption{display:block;font-size:12px;color:#444;margin:8px 0}.export-detail{display:block;break-inside:avoid;margin:12px 0}.export-tile{display:block;max-width:100%;background-image:var(--export-picture);background-repeat:no-repeat;print-color-adjust:exact;-webkit-print-color-adjust:exact}@media screen{.export-detail{margin:28px 0;padding-top:12px;border-top:1px solid #bbb}.export-tile{overflow:hidden}}`

function offsets(size: number, viewport: number): number[] {
  const values = [0]
  while ((values.at(-1) ?? 0) + viewport < size)
    values.push(Math.min((values.at(-1) ?? 0) + viewport - OVERLAP, size - viewport))
  return values
}

/** A fit-to-page overview remains complete; the following panels retain readable physical size. */
export function readableFigures(
  body: string,
  dimensions: (picture: Uint8Array) => { width: number; height: number },
): string {
  const tree = parseFragment(body)
  let figure = 0
  let panels = 0
  const visit = (parent: Html.ParentNode) => {
    parent.childNodes = parent.childNodes.flatMap((node) => {
      if (!("tagName" in node)) return [node]
      if (node.tagName !== "img") {
        visit(node)
        return [node]
      }
      figure++
      const source = node.attrs.find((attr) => attr.name === "src")?.value ?? ""
      const encoded = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(source)?.[1]
      if (!encoded) return [node]
      const size = dimensions(Buffer.from(encoded, "base64"))
      const scale = node.attrs.some(
        (attr) => attr.name === "data-export-scale" && attr.value === "2",
      )
        ? 2
        : 1
      const width = size.width / scale
      const height = size.height / scale
      if (Math.min(WIDTH / width, HEIGHT / height) >= 0.75) return [node]
      const columns = offsets(width, WIDTH)
      const rows = offsets(height, HEIGHT)
      panels += columns.length * rows.length
      if (panels > 128) throw new Error("The document needs more than 128 figure detail panels")
      const overview = serialize({ ...parent, childNodes: [node] })
      const details = rows
        .flatMap((top, row) =>
          columns.map(
            (left, column) =>
              `<span class="export-detail"><span class="export-caption">Figure ${figure} · detail ${row * columns.length + column + 1} of ${rows.length * columns.length} · row ${row + 1}/${rows.length}, column ${column + 1}/${columns.length}</span><span role="img" aria-label="Figure ${figure} detail, row ${row + 1}, column ${column + 1}" class="export-tile" style="width:${Math.min(WIDTH, width)}px;height:${Math.min(HEIGHT, height)}px;background-size:${width}px ${height}px;background-position:-${left}px -${top}px"></span></span>`,
          ),
        )
        .join("")
      const replacement = parseFragment(
        `<span class="export-figure" style="--export-picture:url('${source}')"><span class="export-overview">${overview}<span class="export-caption">Figure ${figure} · overview</span></span>${details}</span>`,
      ).childNodes
      for (const child of replacement) child.parentNode = parent
      return replacement
    })
  }
  visit(tree)
  return serialize(tree)
}
