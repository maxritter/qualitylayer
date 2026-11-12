// The artifact format: one self-contained HTML page an agent draws for the person. Its name, purpose
// and last change are read from the file itself (<title>, the description, `ql:changed`), and the
// parts the App can jump to are its elements with `data-screen-label` and an id. Free of imports, so
// the App's browser bundle reads it as it is.

/** An artifact's name: lower-case letters, digits and dashes. */
export const ARTIFACT_NAME = /^[a-z0-9][a-z0-9-]*$/

/** Where artifacts live: a task's `artifacts/` and the project's `docs/artifacts/`. */
export const TASK_ARTIFACTS = "artifacts"
export const PROJECT_ARTIFACTS = "docs/artifacts"
/** A task's show-me pages sit in the same folder, named `show-me-<topic>.html`. */
export const SHOW_ME_PAGES = TASK_ARTIFACTS

/** A page of a folder artifact: a plain file name at the top of the folder, ending in `.html`. */
export const ARTIFACT_PAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.html$/

/**
 * The most files one folder artifact may hold (an artifact is pages, scripts, styles, fonts, pictures).
 * A guard against a runaway folder, not a size budget: the byte caps below bound what is read and packed.
 * Raised from 300 on 4 November 2026 (Max): the App Model alone holds about 300 files.
 */
export const ARTIFACT_FOLDER_MAX_FILES = 1000
/** The most bytes one file of an artifact may hold; the same as a single page's source. */
export const ARTIFACT_FILE_MAX_BYTES = 10 * 1024 * 1024
/** The most bytes one packed page may hold (fonts and pictures grow by a third as `data:` URLs). */
export const ARTIFACT_PACKED_MAX_BYTES = 16 * 1024 * 1024
/** How many packed pages are kept in memory, and the most bytes they may hold together. */
export const ARTIFACT_PACK_CACHE_ENTRIES = 8
export const ARTIFACT_PACK_CACHE_MAX_BYTES = 40 * 1024 * 1024

/**
 * Lasting artifacts: artifacts every task of a project builds on, kept in the repository as
 * `.qualitylayer/artifacts/<name>/artifact.json` (and its files, or the folder `source` names).
 */
export const LASTING_ARTIFACTS = ".qualitylayer/artifacts"
export const LASTING_CONFIG = "artifact.json"
/** `artifact.json` of a lasting artifact or a draft: far more than it ever needs. */
export const LASTING_CONFIG_MAX_BYTES = 64 * 1024
export const LASTING_NAME_MAX = 60
export const LASTING_TITLE_MAX = 120
export const LASTING_PURPOSE_MAX = 600
export const LASTING_URL_MAX = 500
/**
 * Where designs were stored before the rename. They are read as artifacts and never written: the
 * next save goes to the artifact folders above, and where both hold the name, the new one wins.
 */
export const STORED_TASK_DESIGNS = "design"
export const STORED_PROJECT_DESIGNS = "docs/designs"
export const STORED_LASTING_DESIGNS = ".qualitylayer/designs"
export const STORED_LASTING_CONFIG = "design.json"
/** The most lasting artifacts one project lists. */
export const LASTING_PER_PROJECT_MAX = 1000
/** The most commits one artifact's history lists. */
export const LASTING_HISTORY_MAX = 100
/** How many artifacts' histories are kept in memory (each is at most `LASTING_HISTORY_MAX` lines). */
export const LASTING_HISTORY_KEPT = 60
/** The most "also in another project" entries one project may keep. */
export const LASTING_ALSO_MAX = 50

/**
 * An artifact's file, as a comment names it: not a document but one of the artifact folders' pages, or a
 * page of an artifact that is a folder of its own (`artifacts/<name>/<page>.html`, and a project's lasting
 * artifact `.qualitylayer/artifacts/<name>/<page>.html`).
 */
export const isArtifactDoc = (doc: string): boolean =>
  /^(?:artifacts|docs\/artifacts|design|docs\/designs)\/[^/\\]+\.html$/.test(doc) ||
  folderArtifactOf(doc) !== null

export type FolderArtifactRoot =
  | "artifacts"
  | "docs/artifacts"
  | typeof LASTING_ARTIFACTS
  | typeof STORED_TASK_DESIGNS
  | typeof STORED_PROJECT_DESIGNS
  | typeof STORED_LASTING_DESIGNS

/** A page of a folder artifact, as `artifacts/<name>/<page>.html` names it; null for anything else. */
export function folderArtifactOf(
  doc: string,
): { root: FolderArtifactRoot; name: string; page: string } | null {
  const match = doc.match(
    /^(artifacts|docs\/artifacts|\.qualitylayer\/artifacts|design|docs\/designs|\.qualitylayer\/designs)\/([a-z0-9][a-z0-9-]*)\/([^/\\]+)$/,
  )
  if (match === null || !ARTIFACT_PAGE_NAME.test(match[3] as string)) return null
  return {
    root: match[1] as FolderArtifactRoot,
    name: match[2] as string,
    page: match[3] as string,
  }
}

/** The page of a project's lasting artifact a doc names, or null. */
export function lastingDocOf(doc: string): { name: string; page: string } | null {
  const named = folderArtifactOf(doc)
  return named !== null &&
    (named.root === LASTING_ARTIFACTS || named.root === STORED_LASTING_DESIGNS)
    ? { name: named.name, page: named.page }
    : null
}

/** The doc name of a lasting artifact's page, as comments and routes call it. */
export const lastingDoc = (name: string, page: string): string =>
  `${LASTING_ARTIFACTS}/${name}/${page}`

/**
 * What a draft says it was copied from. In a folder draft it is `artifact.json`'s `draftOn`; a
 * single-page draft says it with `<meta name="ql:draft-on" content="<artifact>[/<page>]">`, which
 * carries neither `project` nor `base`.
 */
export type DraftOn = {
  /** The lasting artifact's name. */
  artifact: string
  /** The project (id) the lasting artifact belongs to; absent: the draft's own project. */
  project?: string
  /** The one page the draft drafts on, as a file name (`sidebar.html`); absent: the whole artifact. */
  page?: string
  /** The git blob id of each file as it was copied (the pages and what they use), by path from the folder. */
  base?: Record<string, string>
}

/** "app-model" or "app-model/sidebar" or "app-model/sidebar.html" as `ql:draft-on` says it. */
export function parseDraftOn(content: string): DraftOn | null {
  const [artifact, page, ...more] = content.trim().split("/")
  if (artifact === undefined || more.length > 0 || !ARTIFACT_NAME.test(artifact)) return null
  if (page === undefined || page === "") return { artifact }
  const file = page.endsWith(".html") ? page : `${page}.html`
  return ARTIFACT_PAGE_NAME.test(file) ? { artifact, page: file } : null
}

/** A file of an artifact folder as a path from it: no climbing, no dot-files, no backslash. */
export const plainRel = (rel: string): boolean =>
  rel !== "" &&
  rel.length <= 300 &&
  !rel.includes("\\") &&
  !rel.includes("\0") &&
  rel
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."))

/** A draft's `draftOn` as `artifact.json` holds it; null for anything that does not read. */
export function draftOnFrom(value: unknown): DraftOn | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  // A draft stored before the rename names its lasting artifact `design`.
  const named = raw.artifact ?? raw.design
  if (typeof named !== "string" || !ARTIFACT_NAME.test(named)) return null
  const found: DraftOn = { artifact: named }
  if (typeof raw.project === "string" && raw.project !== "" && raw.project.length <= 200)
    found.project = raw.project
  if (typeof raw.page === "string" && ARTIFACT_PAGE_NAME.test(raw.page)) found.page = raw.page
  if (typeof raw.base === "object" && raw.base !== null && !Array.isArray(raw.base)) {
    const base: Record<string, string> = {}
    for (const [file, blob] of Object.entries(raw.base as Record<string, unknown>))
      if (plainRel(file) && typeof blob === "string" && /^[0-9a-f]{40}$/.test(blob))
        base[file] = blob
    found.base = base
  }
  return found
}

export type ArtifactSection = { label: string; id: string }

export type ArtifactMeta = {
  title: string
  /** The one-line purpose, from `<meta name="description">`. */
  purpose: string
  /** What the last update changed, from `<meta name="ql:changed">`; null when it says nothing. */
  changed: string | null
  sections: ArtifactSection[]
  /** The width the page is drawn for, from `<meta name="viewport" content="width=…">`; null for none. */
  width: number | null
  /** The heading the page picker lists it under, from `<meta name="ql:group">`; null for none. */
  group?: string | null
  /** The group is a closed fold in the picker (`<meta name="ql:group-folded" content="true">`). */
  groupFolded?: boolean
}

/** One artifact as the App and `artifact list` show it. */
export type Artifact = {
  /**
   * Its path from the folder that holds it, which also names it in a comment: `artifacts/<name>.html`
   * and a show-me page's `artifacts/show-me-<topic>.html` from the task folder,
   * `docs/artifacts/<name>.html` from the repository.
   */
  file: string
  name: string
  scope: "task" | "project"
  title: string
  purpose: string
  changed: string | null
  /** The file's change time; `artifact show` sets it. */
  updated: number
  /** A folder's dependency stamp when the viewer needs more than its newest file time. */
  revision?: string
  sections: ArtifactSection[]
  width: number | null
  /** A show-me page under `artifacts/`: an answer in the chat, not an artifact of the task. */
  showMe?: true
  /** The cached thumbnail's key, or null while it has none (none is drawn without a Chrome). */
  thumb: string | null
  /** The open comments on it, on every page of a folder artifact. */
  comments: number
  /**
   * An artifact that is a folder lists once, with its pages (the entry first); `file` is the entry
   * page. A single-page artifact has none.
   */
  pages?: ArtifactPageInfo[]
  /** What a draft was copied from: a lasting artifact, and the page when it is one. */
  draftOn?: DraftOn
  /** The artifact the Plan's Interface shows. */
  inPlan?: true
}

/** One page of a folder artifact: its file as a comment names it, its file name, title and picture. */
export type ArtifactPageInfo = {
  file: string
  page: string
  title: string
  /** The cached thumbnail's key for this page, or null while it has none. */
  thumb: string | null
  /** The heading the page picker lists it under (`ql:group`); absent for a page that names none. */
  group?: string
  /** The group opens closed in the picker (`ql:group-folded`). */
  groupFolded?: true
}

/**
 * Where a comment on an artifact points: page CSS pixels at 100 %, and the part it is in. `page` names
 * the page of a folder artifact (`settings.html`); a comment without one belongs to the entry page.
 */
export type ArtifactAnchor = { x: number; y: number; section?: string; page?: string }

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  mdash: "—",
  ndash: "–",
  hellip: "…",
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number(code.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

const escapeAttr = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** The value of one attribute in a tag's text, or null. */
function attr(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(
      `\\s${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  )
  if (match === null) return null
  return decode(match[1] ?? match[2] ?? match[3] ?? "")
}

/** The head of the page, where the metadata is; the whole text when it has no head. */
const headOf = (html: string): string => {
  const end = html.search(/<\/head\s*>|<body[\s>]/i)
  return end === -1 ? html : html.slice(0, end)
}

/** The content of `<meta name="<name>">`, or null. */
export function metaContent(html: string, name: string): string | null {
  for (const tag of headOf(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "name") ?? "").toLowerCase() === name.toLowerCase()) return attr(tag, "content")
  }
  return null
}

/** The page's sections the App can jump to: elements with `data-screen-label` and an id, in order. */
export function artifactSections(html: string): ArtifactSection[] {
  const sections: ArtifactSection[] = []
  const seen = new Set<string>()
  for (const tag of html.match(/<[a-zA-Z][\w-]*\b[^>]*\bdata-screen-label\s*=[^>]*>/g) ?? []) {
    const label = (attr(tag, "data-screen-label") ?? "").trim()
    const id = (attr(tag, "id") ?? "").trim()
    if (label === "" || id === "" || seen.has(id)) continue
    seen.add(id)
    sections.push({ label, id })
  }
  return sections
}

/** "settings-page" → "Settings page": the name a new artifact starts with. */
export function titleOfName(name: string): string {
  const words = name
    .replace(/\.html$/, "")
    .replaceAll("-", " ")
    .trim()
  return words === "" ? "Artifact" : words.charAt(0).toUpperCase() + words.slice(1)
}

export function artifactMeta(html: string, fallbackName = ""): ArtifactMeta {
  const titled = headOf(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title = decode((titled ?? "").replace(/\s+/g, " ").trim())
  const changed = (metaContent(html, "ql:changed") ?? "").trim()
  const viewport = metaContent(html, "viewport") ?? ""
  const group = decode((metaContent(html, "ql:group") ?? "").replace(/\s+/g, " ").trim())
  const width = Number(viewport.match(/(?:^|[\s,])width\s*=\s*(\d{3,5})\b/)?.[1] ?? Number.NaN)
  return {
    title: title !== "" ? title : titleOfName(fallbackName),
    purpose: (metaContent(html, "description") ?? "").replace(/\s+/g, " ").trim(),
    changed: changed !== "" ? changed : null,
    sections: artifactSections(html),
    width: Number.isFinite(width) && width >= 320 && width <= 4000 ? width : null,
    group: group !== "" ? group : null,
    groupFolded: group !== "" && (metaContent(html, "ql:group-folded") ?? "").trim() === "true",
  }
}

/** Put `tag` into the head: after `<title>…</title>`, else after `<head>`, else at the top. */
function intoHead(html: string, tag: string): string {
  const title = html.match(/<\/title\s*>/i)
  if (title?.index !== undefined) {
    const at = title.index + title[0].length
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`
  }
  const head = html.match(/<head\b[^>]*>/i)
  if (head?.index !== undefined) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`
  }
  return `${tag}\n${html}`
}

/** The page with `<meta name="<name>" content="<value>">`, replaced or added. */
export function withMeta(html: string, name: string, value: string): string {
  const tag = `<meta name="${name}" content="${escapeAttr(value)}">`
  const head = headOf(html)
  for (const found of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(found, "name") ?? "").toLowerCase() !== name.toLowerCase()) continue
    const at = html.indexOf(found)
    return `${html.slice(0, at)}${tag}${html.slice(at + found.length)}`
  }
  return intoHead(html, tag)
}

/** The page with this `<title>`, replaced or added. */
export function withTitle(html: string, title: string): string {
  const found = headOf(html).match(/<title[^>]*>[\s\S]*?<\/title>/i)
  const tag = `<title>${escapeText(title)}</title>`
  if (found?.index !== undefined)
    return `${html.slice(0, found.index)}${tag}${html.slice(found.index + found[0].length)}`
  const head = html.match(/<head\b[^>]*>/i)
  if (head?.index !== undefined) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`
  }
  return `${tag}\n${html}`
}

/** A template filled for a new artifact: its name as the title and its purpose as the description. */
export function fillArtifact(template: string, title: string, purpose: string): string {
  const filled = template
    .replaceAll("{{TITLE}}", escapeText(title))
    .replaceAll("{{PURPOSE}}", escapeAttr(purpose))
  const titled = /<title[^>]*>[\s\S]*?<\/title>/i.test(headOf(filled))
    ? filled
    : withTitle(filled, title)
  return metaContent(titled, "description") === null
    ? withMeta(titled, "description", purpose)
    : titled
}

/**
 * The wireframe template for one screen, or for two side by side (`options`): the second screen
 * stands between `options:start` and `options:end` comments, which go either way.
 */
export function wireframePage(template: string, options: boolean): string {
  return options
    ? template.replace(/<!-- options:(?:start|end) -->\n?/g, "")
    : template.replace(/<!-- options:start -->[\s\S]*?<!-- options:end -->\n?/g, "")
}

/** The parts of a section's label: "3 Plan · 03-plan.md" is number 3, "Plan · 03-plan.md". */
export function labelParts(label: string): { n: string | null; text: string } {
  const match = label.match(/^(\d+[a-z]?)\s+(.+)$/)
  return match !== null
    ? { n: match[1] as string, text: match[2] as string }
    : { n: null, text: label }
}

// ---------------------------------------------------------------- what the lasting artifacts' routes answer

/** A task as the Artifacts place marks it: the step it is at and who has the move. */
export type TaskMark = {
  /** `<project id>~<slug>`. */
  id: string
  title: string
  /** The step it is at: discuss, research, plan, outline, implement, verify, review. */
  step: string
  /** `you`: waits for the person; `work`: the agent works; `quiet`: nothing happens; `stop`: the agent stopped. */
  state: "you" | "work" | "quiet" | "stop"
}

/** One commit of a lasting artifact's history; a commit a task recorded names the task. */
export type HistoryEntry = {
  sha: string
  /** When it was committed, in milliseconds. */
  at: number
  subject: string
  task?: { id: string; title: string }
}

export type LastingPage = {
  /** The page as a comment and the project artifact routes name it: `.qualitylayer/artifacts/<name>/<page>`. */
  file: string
  page: string
  title: string
  thumb: string | null
}

/** An open task that changes a lasting artifact, with the pages it changes. */
export type Changing = {
  task: TaskMark
  /** The task's draft, by name and by the file its entry page is. */
  draft: string
  file: string
  pages: string[]
}

/**
 * Whether a page still uses the project's design file values (`core/artifact/token-drift.ts`).
 * `count` is the number of design tokens whose value differs; `reason` says why a page is `n/a` or
 * `unassessed`.
 */
export type TokenSummary = {
  state: "current" | "drifted" | "n/a" | "unassessed"
  count?: number
  reason?: string
}

export type LastingArtifact = {
  name: string
  title: string
  purpose: string
  entry: string
  /** Where its files are, from the repository's root. */
  folder: string
  claudeDesign?: string
  /** The entry page first. */
  pages: LastingPage[]
  /** The entry page's picture. */
  thumb: string | null
  /** The newest change of any of its files. */
  updated: number
  /** All dependency paths, sizes and times; a newer entry page cannot hide another file's edit. */
  revision?: string
  /** Optimistic revision for library metadata and copy operations. */
  managerRevision?: string
  /** Hidden from the active Library; existing references remain readable. */
  archivedAt?: number
  /** Recoverable deletion; files and source are retained until restored. */
  deletedAt?: number
  /** The latest commit that touched its files; null while none did. */
  lastChange: HistoryEntry | null
  /** Open tasks that change it. */
  changing: Changing[]
  /** The other projects (ids) that list it under theirs. */
  alsoIn: string[]
}

/** A `artifact.json` that does not read: listed, never breaking the list. */
export type BrokenArtifact = { name: string; broken: true; reason: string }

/** Another project's lasting artifact this project lists under its own. */
export type AlsoArtifact = { project: string; artifact: LastingArtifact }

/** A draft in an open task. */
export type DraftEntry = {
  task: TaskMark
  name: string
  /** The draft's file (its entry page), as the task's artifact routes name it. */
  file: string
  title: string
  purpose: string
  updated: number
  thumb: string | null
  pages?: ArtifactPageInfo[]
  draftOn?: DraftOn
}

export type ProjectArtifacts = {
  id: string
  name: string
  lasting: (LastingArtifact | BrokenArtifact)[]
  also: AlsoArtifact[]
  /** The artifacts only on this computer (`docs/artifacts/`). */
  personal: Artifact[]
  /** Drafts of the project's open tasks. */
  drafts: DraftEntry[]
}

export type ArtifactsOverview = { projects: ProjectArtifacts[] }

/** One lasting artifact as the overview lists it, with the project that owns it: an artifact opens from this. */
export type LastingLookup = {
  project: { id: string; name: string }
  artifact: LastingArtifact | BrokenArtifact
}

export type ArtifactHistoryList = { entries: HistoryEntry[]; truncated: boolean }

export type FoldConflict = {
  page: string
  /** The file the page uses that the conflict is about; absent when it is the page itself. */
  file?: string
  /**
   * `changed`: the lasting artifact's page differs from the one the draft began from; `removed`: it is
   * gone; `exists`: a page of that name was added meanwhile; `also-drafted`: another open task
   * drafts on the same page.
   */
  kind: "changed" | "removed" | "exists" | "also-drafted"
  /** A blocking conflict stops the fold until the person goes on anyway (`force`). */
  blocking: boolean
  tasks?: { id: string; title: string }[]
}

export type FoldPage = {
  page: string
  status: "new" | "changed" | "unchanged"
  /** The lasting artifact's page now (null for a new page) and the draft's, as doc names. */
  before: string | null
  after: string
  /** The files the page uses that the fold would copy too, from the draft's folder. */
  files: string[]
}

export type FoldPreview = {
  draft: string
  artifact: string
  project: string
  /** Where the pages land, from the repository's root. */
  folder: string
  /** The message the fold commits with. */
  message: string
  pages: FoldPage[]
  conflicts: FoldConflict[]
}

export type FoldResult =
  | { folded: false; preview: FoldPreview }
  | {
      folded: true
      /** The commit's short hash; null when the chosen pages already matched the lasting artifact. */
      commit: string | null
      subject: string | null
      files: string[]
      preview: FoldPreview
    }

export type KeepResult = {
  name: string
  where: "repository" | "mac"
  /** The artifact's folder (or page) from the repository's root. */
  path: string
  files: number
}
