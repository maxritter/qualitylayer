// What a new artifact starts from: the product's own tokens and fonts, read from the project's design
// file, so a first draft already looks like the product instead of a generic sample. Without a design
// file the page keeps scaffold tokens and its comment says so.

import { join, relative, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { fontFaces } from "./tokens-fonts.ts"
import { type Palette, parsePalette, withPalette } from "./tokens-palette.ts"
import { type Colour, familyOf, parseDesign, type Tree } from "./tokens-parse.ts"

export { parsePalette } from "./tokens-palette.ts"
export { type Colour, parseDesign } from "./tokens-parse.ts"

export type ProductTokens = {
  /** The design file the tokens were read from, from the repository root. */
  source: string
  colours: Map<string, Colour>
  /** Everything that does not change with the theme: type, radii and spacing, by variable name. */
  others: Map<string, string>
  /** One `@font-face` per selected font file. */
  faces: string[]
  /** Folder starters keep the exact bytes beside their page instead of embedding them. */
  fontFiles?: { name: string; bytes: Uint8Array }[]
  /** The design file exists but holds no tokens: the page keeps the scaffold values and says why. */
  empty: boolean
}

const SCAFFOLD_COLOURS: [string, string, string][] = [
  ["bg", "#ffffff", "#0e1116"],
  ["surface", "#f6f7f9", "#161a21"],
  ["border", "#dfe3e8", "#2a303a"],
  ["text", "#15181d", "#eef1f5"],
  ["muted", "#667085", "#8b95a5"],
  ["accent", "#2563eb", "#6ea8fe"],
]
const SCAFFOLD_OTHERS: [string, string][] = [
  ["--ql-radius-control", "8px"],
  ["--font-sans", 'system-ui, -apple-system, "Segoe UI", sans-serif'],
  ["--font-mono", 'ui-monospace, "SF Mono", Menlo, monospace'],
]

const topLevelFolders = async (ctx: Ctx, root: string): Promise<string[]> =>
  (await ctx.fs.entries(root))
    .filter((e) => e.kind === "directory" && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort()

/** The design file: `DESIGN.md` at the repository root, else the first one under a top-level folder. */
async function designFiles(ctx: Ctx, root: string): Promise<string[]> {
  const found: string[] = []
  if (await ctx.fs.exists(join(root, "DESIGN.md"))) found.push("DESIGN.md")
  for (const folder of await topLevelFolders(ctx, root)) {
    if (await ctx.fs.exists(join(root, folder, "DESIGN.md"))) found.push(`${folder}/DESIGN.md`)
  }
  return found
}

const firstFamily = (stack: string): string =>
  (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "")

function extractTypographyFamilies(typography: string | Tree | undefined): string[] {
  const roles = typeof typography === "object" ? Object.keys(typography) : []
  return [
    ...new Set(
      roles
        .map((role) => familyOf(typography, role))
        .flatMap((stack) => (stack === null ? [] : [firstFamily(stack)]))
        .filter((family) => /^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(family)),
    ),
  ]
}

/** The product's palette file (`src/ui/brand/palette.css`, at the root or under a top-level folder). */
async function paletteFile(ctx: Ctx, root: string): Promise<string | null> {
  for (const folder of ["", ...(await topLevelFolders(ctx, root))]) {
    const path = join(root, folder, "src", "ui", "brand", "palette.css")
    if (await ctx.fs.exists(path)) return path
  }
  return null
}

/** The palette file's light block and its dark block, for the dark twins a design file leaves out. */
async function productPalette(ctx: Ctx, root: string): Promise<Palette | null> {
  const path = await paletteFile(ctx, root)
  return path === null ? null : parsePalette(await ctx.fs.readFile(path))
}

/**
 * The product's tokens and fonts from its design file; null when the project has no design file. A
 * design file that holds no tokens (and no later one does) comes back `empty`, so the page can say so.
 */
export async function productTokens(
  ctx: Ctx,
  root: string,
  /** `none`: no font files are read (comparing a page's tokens with the design file needs none). */
  options: { fontMode?: "inline" | "files" | "none" } = {},
): Promise<ProductTokens | null> {
  let tokenless: string | null = null
  for (const source of await designFiles(ctx, root)) {
    const { tree, colours, others } = parseDesign(await ctx.fs.readFile(join(root, source)))
    if (colours.size === 0 && others.size === 0) {
      tokenless ??= source
      continue
    }
    const families = extractTypographyFamilies(tree.typography)
    withPalette(colours, colours.size === 0 ? null : await productPalette(ctx, root))
    const fontFiles: ProductTokens["fontFiles"] = options.fontMode === "files" ? [] : undefined
    const faces = options.fontMode === "none" ? [] : await fontFaces(ctx, root, families, fontFiles)
    return {
      source,
      colours,
      others,
      faces,
      empty: false,
      ...(fontFiles === undefined ? {} : { fontFiles }),
    }
  }
  return tokenless === null
    ? null
    : { source: tokenless, colours: new Map(), others: new Map(), faces: [], empty: true }
}

/** The files the tokens come from, as paths from the repository's root with `/`: the design files and the palette. */
export async function tokenFiles(
  ctx: Ctx,
  root: string,
): Promise<{ designs: string[]; palette: string | null }> {
  const palette = await paletteFile(ctx, root)
  return {
    designs: await designFiles(ctx, root),
    palette: palette === null ? null : relative(root, palette).split(sep).join("/"),
  }
}

/**
 * Where the tokens come from and how they stood: the path, change time and size of every design file
 * and of the palette, so a cached comparison knows when the design file changed. Cheap: a folder
 * listing and a few stats.
 */
export async function designStamp(
  ctx: Ctx,
  root: string,
  files?: Awaited<ReturnType<typeof tokenFiles>>,
): Promise<string> {
  const { designs, palette } = files ?? (await tokenFiles(ctx, root))
  const paths = designs.map((source) => join(root, source))
  if (palette !== null) paths.push(join(root, palette))
  const parts: string[] = []
  for (const path of paths) {
    const stamp = await ctx.fs.stat?.(path)
    parts.push(stamp ? `${path}:${stamp.mtimeMs}:${stamp.size}` : `${path}:missing`)
  }
  return parts.join("|")
}

const NO_TWIN = "/* no dark twin in the design file: the light value */"

function formatTokensNote(product: ProductTokens | null): string {
  if (product === null)
    return "Tokens: no design file was found in this repository, so the colours, type and spacing below are scaffold values. Replace them with the product's before you draw."
  if (product.empty)
    return `Tokens: the design file holds no tokens (${product.source} has no colours, type, radii or spacing in its frontmatter), so the colours, type and spacing below are scaffold values. Add the product's tokens to that file, or replace these before you draw.`
  const count = product.faces.length
  const fonts =
    count === 0
      ? "no font file was found, so the page uses the stack"
      : product.fontFiles !== undefined
        ? `${count} font file${count === 1 ? " sits" : "s sit"} beside this page`
        : `${count} font file${count === 1 ? " is" : "s are"} embedded`
  return `Tokens: read from ${product.source}: its colours (a dark twin where the file has one), type, radii and spacing; ${fonts}. Draw with these and add no colour of your own.`
}

/** The template with its token placeholders filled: the product's tokens, else the scaffold. */
export function withTokens(template: string, product: ProductTokens | null): string {
  const colours = new Map<string, Colour>(
    SCAFFOLD_COLOURS.map(([name, light, dark]) => [name, { light, dark, twin: true }]),
  )
  const others = new Map<string, string>(SCAFFOLD_OTHERS)
  if (product !== null) {
    for (const [name, colour] of product.colours) colours.set(name, colour)
    for (const [name, value] of product.others) others.set(name, value)
  }
  const light = [
    ...[...colours].map(([name, c]) => `    --ql-${name}: ${c.light};`),
    ...[...others].map(([name, value]) => `    ${name}: ${value};`),
  ]
  const dark = [...colours].map(
    ([name, c]) => `      --ql-${name}: ${c.dark};${c.twin ? "" : ` ${NO_TWIN}`}`,
  )
  return template
    .replaceAll("{{TOKENS_NOTE}}", formatTokensNote(product))
    .replaceAll("{{FONT_FACES}}", product?.faces.join("\n") ?? "")
    .replaceAll("{{TOKENS_LIGHT}}", light.join("\n"))
    .replaceAll("{{TOKENS_DARK}}", dark.join("\n"))
}
