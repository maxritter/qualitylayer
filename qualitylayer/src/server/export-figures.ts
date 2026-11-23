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

type FigureState = { figure: number; panels: number }

function detailPanelsHtml(
  figure: number,
  width: number,
  height: number,
  columns: number[],
  rows: number[],
): string {
  const tileWidth = Math.min(WIDTH, width)
  const tileHeight = Math.min(HEIGHT, height)
  const total = rows.length * columns.length
  return rows
    .flatMap((top, row) =>
      columns.map((left, column) => {
        const index = row * columns.length + column + 1
        return `<span class="export-detail"><span class="export-caption">Figure ${figure} · detail ${index} of ${total} · row ${row + 1}/${rows.length}, column ${column + 1}/${columns.length}</span><span role="img" aria-label="Figure ${figure} detail, row ${row + 1}, column ${column + 1}" class="export-tile" style="width:${tileWidth}px;height:${tileHeight}px;background-size:${width}px ${height}px;background-position:-${left}px -${top}px"></span></span>`
      }),
    )
    .join("")
}

function expandImage(
  node: Html.Element,
  parent: Html.ParentNode,
  dimensions: (picture: Uint8Array) => { width: number; height: number },
  state: FigureState,
): Html.ChildNode[] {
  state.figure++
  const source = node.attrs.find((attr) => attr.name === "src")?.value ?? ""
  const encoded = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(source)?.[1]
  if (!encoded) return [node]
  const size = dimensions(Buffer.from(encoded, "base64"))
  const scaled = node.attrs.some((attr) => attr.name === "data-export-scale" && attr.value === "2")
  const width = size.width / (scaled ? 2 : 1)
  const height = size.height / (scaled ? 2 : 1)
  if (Math.min(WIDTH / width, HEIGHT / height) >= 0.75) return [node]
  const columns = offsets(width, WIDTH)
  const rows = offsets(height, HEIGHT)
  state.panels += columns.length * rows.length
  if (state.panels > 128) throw new Error("The document needs more than 128 figure detail panels")
  const overview = serialize({ ...parent, childNodes: [node] })
  const details = detailPanelsHtml(state.figure, width, height, columns, rows)
  const replacement = parseFragment(
    `<span class="export-figure" style="--export-picture:url('${source}')"><span class="export-overview">${overview}<span class="export-caption">Figure ${state.figure} · overview</span></span>${details}</span>`,
  ).childNodes
  for (const child of replacement) child.parentNode = parent
  return replacement
}

function visitNode(
  parent: Html.ParentNode,
  dimensions: (picture: Uint8Array) => { width: number; height: number },
  state: FigureState,
): void {
  parent.childNodes = parent.childNodes.flatMap((node) => {
    if (!("tagName" in node)) return [node]
    if (node.tagName === "img") return expandImage(node, parent, dimensions, state)
    visitNode(node, dimensions, state)
    return [node]
  })
}

/** A fit-to-page overview remains complete; the following panels retain readable physical size. */
export function readableFigures(
  body: string,
  dimensions: (picture: Uint8Array) => { width: number; height: number },
): string {
  const tree = parseFragment(body)
  visitNode(tree, dimensions, { figure: 0, panels: 0 })
  return serialize(tree)
}
