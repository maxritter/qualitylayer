// How QualityLayer draws a Mermaid diagram: one configuration for the App, the shared pages, Copy
// formatted and `plan export`, so a picture looks the same wherever QualityLayer draws it. Colours
// are literal per theme: an exported SVG is read without the page's CSS, so it must carry them.
// The CSS changes colour, stroke and radius only; a font family or size changed after Mermaid
// measured the text would break its spacing, so those go through the configuration.

export type DiagramTheme = "light" | "dark"

export type DiagramPalette = {
  /** The page a diagram sits on (`--ql-bg-sunken`); edge labels are masked with it. */
  paper: string
  /** A node's fill. */
  surface: string
  /** A group's wash. */
  surface2: string
  text: string
  muted: string
  /** A node's outline: at least 3:1 against the paper, as an essential mark. */
  node: string
  /** A group's outline; the wash and the title carry it. */
  group: string
  /** Connectors and arrowheads. */
  line: string
  accent: string
  /** Text inside a focal node. */
  accentInk: string
  accentSoft: string
  /** The App's colour for human attention: a part marked risk. */
  amber: string
}

/** From `src/ui/brand/palette.css`; a test keeps the two equal. */
export const DIAGRAM_PALETTES: Record<DiagramTheme, DiagramPalette> = {
  light: {
    paper: "#fafafa",
    surface: "#ffffff",
    surface2: "#f2f2f2",
    text: "#171717",
    muted: "#4d4d4d",
    node: "#6b6b6b",
    group: "#a8a8a8",
    line: "#4d4d4d",
    accent: "#2076c5",
    accentInk: "#1a649f",
    accentSoft: "rgb(32 118 197 / 8%)",
    amber: "#9d6607",
  },
  dark: {
    paper: "#000000",
    surface: "#0a0a0a",
    surface2: "#1a1a1a",
    text: "#ededed",
    muted: "#a1a1a1",
    node: "#737373",
    group: "#737373",
    line: "#a1a1a1",
    accent: "#5da3e5",
    accentInk: "#79b5ec",
    accentSoft: "rgb(93 163 229 / 10%)",
    amber: "#f7b23b",
  },
}

export const DIAGRAM_FONT = "Geist, system-ui, sans-serif"

const DIAGRAM_KINDS: Record<string, string> = {
  sequenceDiagram: "sequence",
  classDiagram: "class",
  erDiagram: "data",
  mindmap: "commands",
}

/**
 * What kind of diagram a source draws, in the word the App names it by: "sequence", "flow",
 * "architecture". The diagram frame and the Plan's decision cards both use it.
 */
export function diagramKind(source: string): string {
  const head = /^\s*(?:%%\{[^\n]*\}%%\s*)?([A-Za-z-]+)/.exec(source)?.[1] ?? ""
  if (head.startsWith("state")) return "state"
  const mapped = DIAGRAM_KINDS[head]
  if (mapped !== undefined) return mapped
  // A flowchart with a question in it (a diamond) is a decision; without one it shows the parts.
  return /\w\s*\{[^{}]+\}/.test(source) ? "flow" : "architecture"
}

/** A diagram's source without its parts' marks (`:::focal`), for a renderer that cannot show them. */
export function withoutMarks(source: string): string {
  return source.replace(/:::[A-Za-z][\w-]*/g, "")
}

function themeCss(p: DiagramPalette): string {
  return [
    // No shadows; hairlines carry the shapes.
    ".node, .cluster, .actor, .classGroup, .er { filter: none !important; }",
    ".node rect, .node polygon, .node path, .node circle { stroke: " +
      `${p.node} !important; stroke-width: 1px !important; }`,
    // A label's own background stays unstroked.
    ".node .label rect, .node rect.background { stroke: none !important; }",
    ".node rect { rx: 6px; ry: 6px; }",
    // A group is an outline on the page, no wash: a line label inside it is masked with the page
    // colour, which then matches its surroundings.
    `.cluster rect { fill: ${p.paper} !important; stroke: ${p.group} !important; stroke-width: 1px !important; rx: 8px; ry: 8px; }`,
    `.cluster-label text, .cluster text { fill: ${p.muted} !important; }`,
    // A node's first line is its name; a line after `<br/>` is a detail, quieter. Mermaid writes
    // font-weight on every inner span, so the rule names the spans.
    // An ER table's cells are labels too: they keep Mermaid's own weights.
    '.node .label:not([class*="attribute-"]) .row:first-child .text-inner-tspan { font-weight: 600 !important; }',
    `.node .label:not([class*="attribute-"]) .row:not(:first-child) .text-inner-tspan { fill: ${p.muted} !important; }`,
    // A class's members and methods are one line each, at the text's own weight (as specific as the
    // name rule above, and after it).
    `.node .members-group .label .row:first-child .text-inner-tspan, .node .methods-group .label .row:first-child .text-inner-tspan { font-weight: normal !important; fill: ${p.text} !important; }`,
    "text, tspan { stroke: none; }",
    // An edge label sits on an opaque mask of the page, so the line never shows through the words.
    `.edgeLabel text, .edgeLabel tspan { fill: ${p.muted} !important; }`,
    `.edgeLabel rect, .edgeLabel .label rect, .labelBkg { fill: ${p.paper} !important; opacity: 1 !important; }`,
    `.flowchart-link, .edgePath path, path.transition, .relation, .relationshipLine { stroke: ${p.line} !important; stroke-width: 1.25px !important; }`,
    // Arrowheads are filled; a notation's markers (ER crow's feet, class triangles and diamonds) keep
    // their own fill, so a hollow head stays hollow, and take only the line colour.
    `marker path, .arrowheadPath, .arrowMarkerPath { fill: ${p.line} !important; stroke: ${p.line} !important; }`,
    `marker[id*="_er-"] path, marker[id*="_er-"] line { fill: none !important; stroke: ${p.line} !important; }`,
    `marker[id*="extension"] path, marker[id*="realization"] path, marker[id*="aggregation"] path, marker[id*="dependency"] path, marker[id*="lollipop"] path { fill: ${p.surface} !important; stroke: ${p.line} !important; }`,
    // Sequence: actors in hairlines, dashed lifelines, frames in the group colour.
    `rect.actor { fill: ${p.surface} !important; stroke: ${p.node} !important; stroke-width: 1px !important; rx: 6px; ry: 6px; }`,
    `text.actor > tspan, .actor-man text, .actor-man tspan { fill: ${p.text} !important; font-weight: 600; }`,
    `.actor-man circle, .actor-man line { stroke: ${p.text} !important; fill: none !important; }`,
    `line.actor-line { stroke: ${p.group} !important; stroke-dasharray: 3 4 !important; }`,
    `.messageLine0, .messageLine1 { stroke: ${p.line} !important; stroke-width: 1.25px !important; }`,
    `.loopLine { stroke: ${p.group} !important; } .labelBox { fill: ${p.surface2} !important; stroke: ${p.group} !important; }`,
    `.labelText, .labelText tspan, .loopText, .loopText tspan { fill: ${p.muted} !important; }`,
    // State: the start dot in the text colour, in both themes (the end ring takes specialStateColor).
    `.node circle.state-start { fill: ${p.text} !important; stroke: ${p.text} !important; }`,
    // ER and class: table and compartment lines as node outlines.
    `.er .entityBox, .er .attributeBoxOdd, .er .attributeBoxEven, .classGroup rect, .classGroup line, .divider { stroke: ${p.node} !important; stroke-width: 1px !important; }`,
    `[id*="ZERO"] circle, marker circle { fill: ${p.paper} !important; stroke: ${p.line} !important; }`,
    // The marks. Focal: the one or two parts the reader must notice.
    // Its box is tinted with an accent outline (a class or a table draws its box as an outer path:
    // a filled path, then the stroked one); only its name takes the accent ink.
    `.focal > rect, .focal > polygon, .focal > path, .focal > circle, .focal rect.basic, .focal .outer-path > path:first-child { fill: ${p.accentSoft} !important; }`,
    `.focal > rect, .focal > polygon, .focal > path, .focal > circle, .focal rect.basic, .focal .outer-path > path:last-child { stroke: ${p.accent} !important; stroke-width: 1.5px !important; }`,
    `.node.focal .label:not([class*="attribute-"]) .row:first-child .text-inner-tspan { fill: ${p.accentInk} !important; }`,
    `.node.focal .members-group .label .row:first-child .text-inner-tspan, .node.focal .methods-group .label .row:first-child .text-inner-tspan, .node.focal .annotation-group .label .row:first-child .text-inner-tspan { fill: ${p.text} !important; }`,
    // The change marks, on a plain box and on a class's or a table's outer path alike.
    ".new > rect, .new > path, .new > polygon, .new > circle, .new rect.basic, .new .outer-path > path:last-child { stroke-dasharray: 5 3 !important; stroke-width: 2px !important; }",
    `.changed > rect, .changed > path, .changed > polygon, .changed > circle, .changed rect.basic, .changed .outer-path > path:first-child { fill: ${p.accentSoft} !important; }`,
    ".changed > rect, .changed > path, .changed > polygon, .changed > circle, .changed rect.basic, .changed .outer-path > path:last-child { stroke-width: 2px !important; }",
    ".removed { opacity: .65; } .removed text, .removed .nodeLabel { text-decoration: line-through; }",
    `.risk > rect, .risk > path, .risk > polygon, .risk > circle, .risk rect.basic, .risk .outer-path > path:last-child, .risky > rect, .risky > path, .risky > polygon, .risky > circle, .risky rect.basic, .risky .outer-path > path:last-child { stroke: ${p.amber} !important; stroke-width: 3px !important; }`,
  ].join("\n")
}

/**
 * Mermaid centres a group's title on its top edge, where an arrow from above enters the group, so
 * the line runs through the words. The title moves to the group's top-left corner instead.
 */
export function titleGroupsLeft(svg: string, inset = 12): string {
  // A group is `<g class="cluster …">`, its box the first `<rect x=…>` in it, then its title
  // `<g class="cluster-label …" transform="translate(x, y)">`; attributes in any order.
  return svg.replace(
    /(<g\b(?=[^>]*\bclass="cluster\b)[^>]*>\s*<rect\b(?=[^>]*\bx="(-?[\d.]+)")[^>]*>(?:\s*<\/rect>)?\s*<g\b(?=[^>]*\bclass="cluster-label\b)[^>]*\btransform="translate\(\s*)-?[\d.]+(\s*[, ])/g,
    (_match, head: string, x: string, separator: string) =>
      `${head}${Number(x) + inset}${separator}`,
  )
}

/**
 * A sequence diagram without the mirrored actors at the bottom leaves its lifelines at Mermaid's
 * default length, a screen or two tall. Cut them where the last message, note or box ends and
 * shrink the drawing to match. It needs a DOM (a page, or a test's); without one it changes nothing.
 * Self-contained, so `plan export` can send it into its drawing page as source text.
 */
export function endLifelines(svg: string): string {
  if (typeof DOMParser === "undefined" || !svg.includes('aria-roledescription="sequence"'))
    return svg
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  const root = doc.documentElement
  const lifelines = [...root.querySelectorAll("line.actor-line")]
  if (lifelines.length === 0 || root.querySelector("parsererror") !== null) return svg
  const num = (el: Element, name: string) => Number.parseFloat(el.getAttribute(name) ?? "")
  let bottom = 0
  const reach = (value: number) => {
    if (Number.isFinite(value)) bottom = Math.max(bottom, value)
  }
  for (const el of root.querySelectorAll("text.messageText, text.noteText, text.loopText"))
    reach(num(el, "y"))
  for (const el of root.querySelectorAll("line.messageLine0, line.messageLine1, line.loopLine")) {
    reach(num(el, "y1"))
    reach(num(el, "y2"))
  }
  for (const el of root.querySelectorAll("rect.note, rect[class^='activation']"))
    reach(num(el, "y") + num(el, "height"))
  // Not the lifelines themselves, and no message found: leave Mermaid's drawing alone.
  if (bottom === 0) return svg
  const end = bottom + 24
  for (const line of lifelines) line.setAttribute("y2", String(end))
  const box = (root.getAttribute("viewBox") ?? "").split(/\s+/).map(Number)
  if (box.length === 4 && box.every(Number.isFinite)) {
    const height = end - (box[1] as number) + 12
    root.setAttribute("viewBox", `${box[0]} ${box[1]} ${box[2]} ${height}`)
    root.setAttribute("height", String(height))
  }
  return new XMLSerializer().serializeToString(root)
}

/** The Geist face the App's stylesheet carries (a `data:` woff2), as base64; null when it has none. */
export function geistFromStylesheet(css: string): string | null {
  return (
    /@font-face\s*\{\s*font-family:\s*["']?Geist["']?\s*;[^}]*?url\(\s*["']?data:font\/woff2;base64,([A-Za-z0-9+/=]+)/.exec(
      css,
    )?.[1] ?? null
  )
}

/**
 * An SVG that leaves the page (Copy formatted, `plan export`) is read as an image, which cannot use
 * the page's fonts: without Geist inside it, its text falls back to another face whose widths
 * Mermaid did not measure. This puts the font in the drawing's own style, once.
 */
export function withEmbeddedFont(svg: string, woff2Base64: string): string {
  if (svg.includes("data-ql-font")) return svg
  const face = `<style data-ql-font="">@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${woff2Base64}) format("woff2")}</style>`
  return svg.replace(/(<svg\b[^>]*>)/, `$1${face}`)
}

/** What `mermaid.initialize` takes to draw in QualityLayer's style. */
export function mermaidConfig(theme: DiagramTheme) {
  const p = DIAGRAM_PALETTES[theme]
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    look: "classic" as const,
    layout: "elk",
    fontFamily: DIAGRAM_FONT,
    // SVG text labels: HTML labels are measured through the page's CSS, and a global reset
    // (Tailwind's preflight) blows the layout up to ten times its size.
    htmlLabels: false,
    // Natural size, long messages wrapped: a wide diagram scrolls sideways instead of
    // shrinking its text below reading size. Lines break only where the source says `<br/>`.
    flowchart: {
      useMaxWidth: false,
      htmlLabels: false,
      curve: "linear" as const,
      padding: 16,
      wrappingWidth: 400,
      nodeSpacing: 48,
      rankSpacing: 56,
    },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    // A class without attributes draws no empty compartment.
    class: { useMaxWidth: false, hideEmptyMembersBox: true },
    sequence: {
      useMaxWidth: false,
      // The actors are named once, at the top: the lifelines are not drawn twice.
      mirrorActors: false,
      wrap: true,
      width: 140,
      // A person (`actor`) is drawn as a figure taller than a box: at 56 its name clears the
      // first message.
      height: 56,
      actorMargin: 56,
      boxMargin: 10,
      messageMargin: 32,
      actorFontSize: 13,
      messageFontSize: 13,
      noteFontSize: 13,
    },
    themeVariables: {
      darkMode: theme === "dark",
      fontFamily: DIAGRAM_FONT,
      fontSize: "14px",
      background: p.paper,
      mainBkg: p.surface,
      primaryColor: p.surface,
      primaryTextColor: p.text,
      primaryBorderColor: p.node,
      secondaryColor: p.surface2,
      secondaryTextColor: p.text,
      secondaryBorderColor: p.group,
      tertiaryColor: p.surface2,
      tertiaryTextColor: p.text,
      tertiaryBorderColor: p.group,
      nodeBorder: p.node,
      nodeTextColor: p.text,
      textColor: p.text,
      titleColor: p.text,
      lineColor: p.line,
      defaultLinkColor: p.line,
      clusterBkg: p.paper,
      clusterBorder: p.group,
      edgeLabelBackground: p.paper,
      labelBackground: p.paper,
      noteBkgColor: p.surface2,
      noteTextColor: p.muted,
      noteBorderColor: p.group,
      actorBkg: p.surface,
      actorBorder: p.node,
      actorTextColor: p.text,
      actorLineColor: p.group,
      signalColor: p.line,
      signalTextColor: p.text,
      labelBoxBkgColor: p.surface2,
      labelBoxBorderColor: p.group,
      labelTextColor: p.muted,
      loopTextColor: p.muted,
      activationBkgColor: p.surface2,
      activationBorderColor: p.node,
      sequenceNumberColor: p.paper,
      stateBkg: p.surface,
      stateLabelColor: p.text,
      compositeBackground: p.surface2,
      compositeTitleBackground: p.surface2,
      altBackground: p.surface2,
      transitionColor: p.line,
      transitionLabelColor: p.muted,
      specialStateColor: p.text,
      innerEndBackground: p.text,
      classText: p.text,
      attributeBackgroundColorOdd: p.surface,
      attributeBackgroundColorEven: p.surface2,
      relationColor: p.line,
      relationLabelColor: p.muted,
      relationLabelBackground: p.paper,
    },
    themeCSS: themeCss(p),
  }
}
