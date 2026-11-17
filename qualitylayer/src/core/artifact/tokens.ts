// What a new artifact starts from: the product's own tokens and fonts, read from the project's design
// file, so a first draft already looks like the product instead of a generic sample. Without a design
// file the page keeps scaffold tokens and its comment says so.

import { basename, join, relative, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { isLineText, lastLineBreak, skipWhitespace } from "../text-boundaries.ts"

/** One colour: its light value, and its dark value when the design file names a twin. */
export type Colour = { light: string; dark: string; twin: boolean }

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

type Tree = { [key: string]: string | Tree }

const unquote = (value: string): string => {
  const quoted = /^(["'])(.*)\1\s*(?:#.*)?$/.exec(value)
  if (quoted !== null) return quoted[2] ?? ""
  for (
    let at = value.indexOf("#", lastLineBreak(value) + 1);
    at >= 0;
    at = value.indexOf("#", at + 1)
  ) {
    if (at > 0 && /\s/.test(value.charAt(at - 1))) return value.slice(0, at).trim()
  }
  return value.trim()
}

/** The nested `key: value` lines of a design file's frontmatter (maps and scalars, as the file uses them). */
function frontmatterTree(markdown: string): Tree {
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return {}
  const root: Tree = {}
  const stack: { indent: number; node: Tree }[] = [{ indent: -1, node: root }]
  for (const raw of lines.slice(1)) {
    if (raw.trim() === "---") break
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue
    const match = /^(\s*)([A-Za-z0-9_-]+):/.exec(raw)
    if (match === null) continue
    const value = raw.slice(match[0].length).trimStart()
    if (!isLineText(value)) continue
    const indent = (match[1] ?? "").length
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop()
    const parent = stack[stack.length - 1]?.node ?? root
    const key = match[2] ?? ""
    if (value === "") {
      const child: Tree = {}
      parent[key] = child
      stack.push({ indent, node: child })
    } else parent[key] = unquote(value)
  }
  return root
}

/** A value that is safe to write into a style block: one line, no braces, no markup. */
const cssValue = (value: unknown): string | null =>
  typeof value === "string" && /^[^;{}<>\\\r\n]+$/.test(value) && !value.includes("/*")
    ? value.trim()
    : null

const scalars = (tree: string | Tree | undefined): [string, string][] =>
  typeof tree === "object"
    ? Object.entries(tree).flatMap(([key, value]) => {
        const safe = cssValue(value)
        return safe !== null && /^[A-Za-z0-9-]+$/.test(key) ? [[key, safe] as [string, string]] : []
      })
    : []

const familyOf = (tree: string | Tree | undefined, role: string): string | null => {
  const node = typeof tree === "object" ? tree[role] : undefined
  return typeof node === "object" ? cssValue(node.fontFamily) : null
}

/** The design file: `DESIGN.md` at the repository root, else the first one under a top-level folder. */
async function designFiles(ctx: Ctx, root: string): Promise<string[]> {
  const found: string[] = []
  if (await ctx.fs.exists(join(root, "DESIGN.md"))) found.push("DESIGN.md")
  const folders = (await ctx.fs.entries(root))
    .filter((e) => e.kind === "directory" && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort()
  for (const folder of folders)
    if (await ctx.fs.exists(join(root, folder, "DESIGN.md"))) found.push(`${folder}/DESIGN.md`)
  return found
}

/** A family name as a file name spells it: lower case, letters and digits only. */
const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "")

const firstFamily = (stack: string): string =>
  (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "")

const FONT_MAX_BYTES = 1_000_000

/**
 * `@font-face` rules for the `.woff2` files under any `fonts/` folder of the repository whose name
 * starts with a family's lower-cased name; a file belongs to the longest family name it starts with,
 * so `geist-mono-latin.woff2` is Geist Mono's and never Geist's.
 */
async function fontFaces(
  ctx: Ctx,
  root: string,
  families: string[],
  fontFiles?: NonNullable<ProductTokens["fontFiles"]>,
): Promise<string[]> {
  if (families.length === 0 || ctx.fs.readBytes === undefined) return []
  const listed = await ctx.git.run(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "*.woff2",
  ])
  if (listed.code !== 0) return []
  const files = new Map<string, string>()
  for (const path of listed.stdout.split("\0").sort()) {
    const folders = path.split("/").slice(0, -1)
    if (
      path !== "" &&
      folders.some((f) => f.toLowerCase() === "fonts") &&
      !files.has(basename(path))
    )
      files.set(basename(path), path)
  }
  const faces: string[] = []
  for (const family of families) {
    for (const [name, path] of files) {
      const owner = families
        .filter((f) => squash(name).startsWith(squash(f)))
        .sort((a, b) => squash(b).length - squash(a).length)[0]
      if (owner !== family) continue
      const bytes = await ctx.fs.readBytes(join(root, path))
      if (bytes.length === 0 || bytes.length > FONT_MAX_BYTES) continue
      let url: string
      if (fontFiles !== undefined) {
        let local = /^[A-Za-z0-9][A-Za-z0-9._-]*\.woff2$/.test(name)
          ? name
          : `font-${fontFiles.length + 1}.woff2`
        let suffix = 0
        while (fontFiles.some((file) => file.name.toLowerCase() === local.toLowerCase()))
          local = `font-${fontFiles.length + 1}-${++suffix}.woff2`
        fontFiles.push({ name: local, bytes })
        url = local
      } else url = `data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}`
      faces.push(
        `  @font-face {\n    font-family: "${family}";\n    src: url(${url}) format("woff2");\n    font-weight: 100 900;\n    font-style: normal;\n    font-display: swap;\n  }`,
      )
    }
  }
  return faces
}

/** The product palette's colours by name without `--ql-`: light, and dark where the palette changes it. */
export type Palette = Map<string, { light: string; dark: string }>

const declarations = (css: string): Map<string, string> => {
  const found = new Map<string, string>()
  const statements = css.replace(/\/\*[\s\S]*?\*\//g, "").split(";")
  for (const statement of statements.slice(0, -1)) {
    const declaration = statement.slice(
      Math.max(statement.lastIndexOf("{"), statement.lastIndexOf("}")) + 1,
    )
    for (const name of declaration.matchAll(/[A-Za-z0-9-]+/g)) {
      const prefix = name[0].indexOf("--ql-")
      if (prefix === -1 || prefix + 5 === name[0].length) continue
      const colon = skipWhitespace(declaration, name.index + name[0].length)
      if (declaration[colon] !== ":") continue
      const raw = declaration.slice(colon + 1)
      const value = cssValue(raw.trimStart() || raw.slice(-1))
      if (value !== null) found.set(name[0].slice(prefix + 5), value)
      break
    }
  }
  return found
}

/** The product's palette file (`src/ui/brand/palette.css`, at the root or under a top-level folder). */
async function paletteFile(ctx: Ctx, root: string): Promise<string | null> {
  const folders = (await ctx.fs.entries(root))
    .filter((e) => e.kind === "directory" && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort()
  for (const folder of ["", ...folders]) {
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

/** A palette file's text read into its colours; null when it names none. */
export function parsePalette(css: string): Palette | null {
  const at = css.indexOf("prefers-color-scheme: dark")
  const light = declarations(at < 0 ? css : css.slice(0, at))
  const dark = at < 0 ? new Map<string, string>() : declarations(css.slice(at))
  const palette: Palette = new Map()
  for (const [name, value] of light)
    palette.set(name, { light: value, dark: dark.get(name) ?? value })
  return palette.size === 0 ? null : palette
}

/**
 * The design file's colours completed from the palette: a colour with no twin takes the palette's dark
 * value, and a palette colour the file never names (the text on the accent, say) is added.
 */
function withPalette(colours: Map<string, Colour>, palette: Palette | null): void {
  if (palette === null) return
  for (const [name, colour] of colours) {
    const twin = palette.get(name)
    if (!colour.twin && twin !== undefined)
      colours.set(name, { ...colour, dark: twin.dark, twin: true })
  }
  for (const [name, pair] of palette)
    if (!colours.has(name)) colours.set(name, { ...pair, twin: true })
}

/** What a design file's frontmatter names: the parsed tree, its colours (with dark twins) and the other tokens. */
export function parseDesign(markdown: string): {
  tree: Tree
  colours: Map<string, Colour>
  others: Map<string, string>
} {
  const tree = frontmatterTree(markdown)
  const colours = new Map<string, Colour>()
  const named = scalars(tree.colors)
  const byName = new Map(named)
  for (const [name, light] of named) {
    const base = name.endsWith("-dark") ? name.slice(0, -5) : null
    if (base !== null && byName.has(base)) continue
    const dark = byName.get(`${name}-dark`)
    colours.set(name, { light, dark: dark ?? light, twin: dark !== undefined })
  }
  const others = new Map<string, string>()
  const sans = familyOf(tree.typography, "body")
  const mono = familyOf(tree.typography, "command")
  if (sans !== null) others.set("--font-sans", sans)
  if (mono !== null) others.set("--font-mono", mono)
  for (const [key, value] of scalars(tree.rounded)) others.set(`--ql-radius-${key}`, value)
  for (const [key, value] of scalars(tree.spacing)) others.set(`--ql-space-${key}`, value)
  return { tree, colours, others }
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
    const roles = typeof tree.typography === "object" ? Object.keys(tree.typography) : []
    const families = [
      ...new Set(
        roles
          .map((role) => familyOf(tree.typography, role))
          .flatMap((stack) => (stack === null ? [] : [firstFamily(stack)]))
          .filter((family) => /^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(family)),
      ),
    ]
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
  const count = product?.faces.length ?? 0
  const fonts =
    count === 0
      ? "no font file was found, so the page uses the stack"
      : product?.fontFiles !== undefined
        ? `${count} font file${count === 1 ? " sits" : "s sit"} beside this page`
        : `${count} font file${count === 1 ? " is" : "s are"} embedded`
  const note =
    product === null
      ? "Tokens: no design file was found in this repository, so the colours, type and spacing below are scaffold values. Replace them with the product's before you draw."
      : product.empty
        ? `Tokens: the design file holds no tokens (${product.source} has no colours, type, radii or spacing in its frontmatter), so the colours, type and spacing below are scaffold values. Add the product's tokens to that file, or replace these before you draw.`
        : `Tokens: read from ${product.source}: its colours (a dark twin where the file has one), type, radii and spacing; ${fonts}. Draw with these and add no colour of your own.`
  return template
    .replaceAll("{{TOKENS_NOTE}}", note)
    .replaceAll("{{FONT_FACES}}", product?.faces.join("\n") ?? "")
    .replaceAll("{{TOKENS_LIGHT}}", light.join("\n"))
    .replaceAll("{{TOKENS_DARK}}", dark.join("\n"))
}
