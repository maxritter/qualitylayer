type Rgba = [number, number, number, number]

function parseHexColor(value: string): Rgba | undefined {
  if (/^#[\da-f]{3,4}$/i.test(value))
    return parseHexColor(`#${[...value.slice(1)].map((c) => c + c).join("")}`)
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return undefined
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1,
  ]
}

function validChannel(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 255
}

function validAlpha(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function parseRgbColor(value: string): Rgba | undefined {
  const match = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (!match) return undefined
  const parts = (match[1] ?? "").replaceAll(",", " ").replace("/", " ").trim().split(/\s+/)
  const badParts =
    (parts.length !== 3 && parts.length !== 4) ||
    parts.some((part) => !/^\d*(?:\.\d+)?%?$/.test(part) || part === "")
  if (badParts) return undefined
  const channels = parts
    .slice(0, 3)
    .map((part) =>
      part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part),
    )
  const alpha =
    parts[3] === undefined ? 1 : Number.parseFloat(parts[3]) * (parts[3].endsWith("%") ? 0.01 : 1)
  if (!channels.every(validChannel) || !validAlpha(alpha)) return undefined
  return [
    Math.round(channels[0] ?? 0),
    Math.round(channels[1] ?? 0),
    Math.round(channels[2] ?? 0),
    alpha,
  ]
}

function numericColor(value: string): Rgba | undefined {
  return parseHexColor(value) ?? parseRgbColor(value)
}

export function computedCssColor(value: string, root: HTMLElement): Rgba | undefined {
  const numeric = numericColor(value.trim())
  if (numeric) return numeric
  const probe = document.createElement("span")
  probe.style.display = "none"
  probe.style.color = value
  if (!probe.style.color) return undefined
  root.append(probe)
  try {
    const resolved = getComputedStyle(probe).color
    const parsed = numericColor(resolved)
    if (parsed) return parsed
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 1
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return undefined
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = resolved
    context.fillRect(0, 0, 1, 1)
    const p = context.getImageData(0, 0, 1, 1).data
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, (p[3] ?? 255) / 255]
  } finally {
    probe.remove()
  }
}

export const rgbNumber = (rgb: readonly number[]) =>
  ((rgb[0] ?? 0) << 16) | ((rgb[1] ?? 0) << 8) | (rgb[2] ?? 0)
export function compositeColor(fg: Rgba, bg: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round((fg[i] ?? 0) * fg[3] + (bg[i] ?? 0) * (1 - fg[3]))) as [
    number,
    number,
    number,
  ]
}
export function colorContrast(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]) =>
    rgb
      .slice(0, 3)
      .map((c) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0)
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
