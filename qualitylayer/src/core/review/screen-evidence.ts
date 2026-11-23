/**
 * Recorded verification evidence, browser-safe: no executable artifact sources or capture URLs.
 * Every picture and terminal output names the run it came from, the acceptance step it shows
 * (when it shows one), whether it is a picture or an output, and how the run happened.
 */

/** How a run happened: the project's own scripted test, or an agent driving the real program. */
export const EVIDENCE_MODES = ["scripted", "real-session"] as const
export type EvidenceMode = (typeof EVIDENCE_MODES)[number]

export const EVIDENCE_KINDS = ["picture", "output"] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** The name of one run of the acceptance test; evidence of one run shares it. */
export const isRunId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)

/** An acceptance step of the Plan: `A1`, `A2`, … */
export const isAcceptanceStep = (value: unknown): value is string =>
  typeof value === "string" && /^A[1-9]\d{0,2}$/.test(value)

export const isEvidenceMode = (value: unknown): value is EvidenceMode =>
  (EVIDENCE_MODES as readonly unknown[]).includes(value)

export const isPictureFile = (file: unknown): file is string =>
  typeof file === "string" && /^evidence\/screen-[a-f0-9]{24}\.png$/.test(file)

export const isOutputFile = (file: unknown): file is string =>
  typeof file === "string" && /^records\/output-[a-f0-9]{24}\.txt$/.test(file)

/** Where a record came from. `step` is absent for a picture that is not an acceptance step. */
export type EvidenceSource = { run: string; step?: string; mode: EvidenceMode }

/** A record without its run and mode, or with a step that is no `A<n>`, is refused. */
export function isEvidenceSource(item: Record<string, unknown>): boolean {
  return (
    isRunId(item.run) &&
    isEvidenceMode(item.mode) &&
    (item.step === undefined || isAcceptanceStep(item.step))
  )
}

export type ScreenOutcome = "captured" | "skipped: no browser" | `unavailable: ${string}`

/** A capture of a planned screen: bound to the approved picture and to the build it was taken on. */
export type ScreenRow = EvidenceSource & {
  kind: "picture"
  key: string
  url: string
  file: string | null
  width: number
  /** Browser viewport height. */
  height?: number
  imageWidth?: number
  imageHeight?: number
  theme: "light" | "dark"
  outcome: ScreenOutcome
  artifactDigest: string
  /** The digest of the stored file's bytes. */
  shotDigest: string | null
  buildRevision: string
  at: number
  waitFor?: string
  crop?: string
  /** The selectors clicked, in order, before the picture: the dialog or state it shows. */
  clicks?: string[]
}

/** A picture or a terminal output added with `evidence add`; always stored, never an attempt. */
export type AddedRow = EvidenceSource & {
  kind: EvidenceKind
  /** `evidence/screen-<hex>.png` for a picture, `records/output-<hex>.txt` for an output. */
  file: string
  shotDigest: string
  imageWidth?: number
  imageHeight?: number
  buildRevision: string
  at: number
}

export type EvidenceRow = ScreenRow | AddedRow

/** A capture of a planned screen, against an added picture or output. */
export const isScreenRow = (row: EvidenceRow): row is ScreenRow => "key" in row

/** The names of a planned screen: a surface, or an artifact page, with an optional section. */
export const safeScreenKey = (key: string): boolean =>
  key.length <= 500 &&
  /^(?:[a-z0-9][a-z0-9-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*\.html)?|project\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9._-]*\.html)(?:#[A-Za-z][A-Za-z0-9_-]{0,159})?$/.test(
    key,
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isBoundedInt = (value: unknown, least: number, most: number): boolean =>
  Number.isInteger(value) && Number(value) >= least && Number(value) <= most

const isPositiveSafeInt = (value: unknown): boolean =>
  Number.isSafeInteger(value) && Number(value) > 0

const isTheme = (value: unknown): boolean => value === "light" || value === "dark"

const shared = (item: Record<string, unknown>): boolean =>
  isEvidenceSource(item) && typeof item.buildRevision === "string" && typeof item.at === "number"

function hasValidSurfaceOutcome(item: Record<string, unknown>): boolean {
  if (item.outcome === "captured") {
    return isPictureFile(item.file) && typeof item.shotDigest === "string"
  }
  if (item.file !== null) return false
  if (item.outcome === "skipped: no browser") return true
  return typeof item.outcome === "string" && /^unavailable: .+/.test(item.outcome)
}

/** A picture of a planned screen validates apart from an added picture or output. */
function isSurfaceRow(item: Record<string, unknown>): boolean {
  const validMeta =
    item.kind === "picture" &&
    shared(item) &&
    typeof item.key === "string" &&
    safeScreenKey(item.key)
  const validDimensions =
    typeof item.url === "string" &&
    isBoundedInt(item.width, 240, 8000) &&
    (item.height === undefined || isBoundedInt(item.height, 240, 8000))
  const validVisual = isTheme(item.theme) && typeof item.artifactDigest === "string"
  return validMeta && validDimensions && validVisual && hasValidSurfaceOutcome(item)
}

function isAddedPicture(item: Record<string, unknown>): boolean {
  return (
    item.kind === "picture" &&
    shared(item) &&
    isPictureFile(item.file) &&
    typeof item.shotDigest === "string"
  )
}

function isAddedOutput(item: Record<string, unknown>): boolean {
  return (
    item.kind === "output" &&
    shared(item) &&
    isOutputFile(item.file) &&
    typeof item.shotDigest === "string"
  )
}

/** Pictures and outputs validate separately; anything else, or an old record, is refused. */
export function isEvidenceRow(value: unknown): value is EvidenceRow {
  if (!isRecord(value)) return false
  if (value.kind === "output") return !("key" in value) && isAddedOutput(value)
  return "key" in value ? isSurfaceRow(value) : isAddedPicture(value)
}

/** One run of the acceptance test with everything recorded for it. */
export type EvidenceRun = {
  run: string
  mode: EvidenceMode
  /** When the run's first record was made. */
  at: number
  /** Whether the verdicts judged this run, and every one of them passed. */
  passed: boolean
  records: EvidenceRow[]
}

/** Recorded pictures of the planned screens, as the Verify viewer reads them. */
export type VerificationScreen = Partial<EvidenceSource> & {
  key: string
  title: string
  width: number
  height?: number
  theme: "light" | "dark"
  outcome:
    | "captured"
    | "not captured"
    | "skipped: no browser"
    | "omitted: size"
    | `unavailable: ${string}`
  stale: boolean
  staleReason?: string
  file: string | null
}

/** A recorded picture or output a verdict cites, as the Verify viewer lists it. */
export type VerificationFile = {
  file: string
  kind: EvidenceKind
  /** The acceptance step it shows, when it shows one. */
  step?: string
  /** What the verdicts that cite it say it proves: "Done means 3, Scenario 5". */
  cites?: string
  at: number
}

/** The pictures and outputs the verdicts cite that one run recorded. */
export type VerificationRun = {
  run: string
  mode: EvidenceMode
  at: number
  /** Whether the verdicts judged this run, and every one of them passed. */
  passed: boolean
  files: VerificationFile[]
}

/**
 * The Verify viewer's data: the planned screens' captures, and the files the verdicts cite by run,
 * the latest run first.
 */
export type VerificationScreens = { screens: VerificationScreen[]; runs?: VerificationRun[] }

const isVerificationFile = (file: unknown): boolean => {
  if (!isRecord(file)) return false
  const validPath =
    file.kind === "picture"
      ? isPictureFile(file.file)
      : file.kind === "output" && isOutputFile(file.file)
  const validStep = file.step === undefined || isAcceptanceStep(file.step)
  const validCites = file.cites === undefined || typeof file.cites === "string"
  return validPath && validStep && validCites && typeof file.at === "number"
}

const isVerificationRun = (value: unknown): value is VerificationRun => {
  if (!isRecord(value)) return false
  const validMeta =
    isRunId(value.run) &&
    isEvidenceMode(value.mode) &&
    typeof value.at === "number" &&
    typeof value.passed === "boolean"
  return validMeta && Array.isArray(value.files) && value.files.every(isVerificationFile)
}

/** One step of the Plan's acceptance test with the files the run that passed recorded for it. */
export type AcceptanceRow = {
  /** `A1`. */
  id: string
  n: number
  /** The step as the Plan wrote it. */
  text: string
  /** A points Plan's step: what it does and what passes, apart. Absent for numbered steps. */
  action?: string
  expected?: string
  /** A bug's step: what shows the bug before the fix (`expected` is what shows it gone after). */
  before?: string
  evidence: { file: string; kind: EvidenceKind }[]
  /** How this step ran, when its own record says so (a run can mix scripted steps and real sessions). */
  mode?: EvidenceMode
  /** The original run of standing proof carried from an earlier review. */
  run?: string
}

/** A Done means point of a points Plan with the steps that prove it, as the run recorded them. */
export type AcceptancePointRow = {
  n: number
  /** The point as the Plan's heading says it. */
  text: string
  steps: AcceptanceRow[]
}

/**
 * The Plan's acceptance test as it ran: the run that passed, whether it was a scripted run or a real
 * agent session, and each step with its pictures and outputs. `run` and `mode` are null when no run
 * has passed.
 */
export type AcceptanceAsRun = {
  run: string | null
  mode: EvidenceMode | null
  /** Every step passed the independent review on its cited evidence, without an evidence run. */
  judged?: true
  steps: AcceptanceRow[]
  /** A points Plan's Done means points, each with its steps (a step that proves two shows under both). Absent for numbered steps. */
  points?: AcceptancePointRow[]
  /** A bug's baseline run, at the commit before the fix: the steps as that run recorded them. */
  before?: { run: string; mode: EvidenceMode; steps: AcceptanceRow[] }
}

const KNOWN_SCREEN_OUTCOMES = new Set([
  "captured",
  "not captured",
  "skipped: no browser",
  "omitted: size",
])

const isVerificationOutcome = (value: unknown): value is VerificationScreen["outcome"] =>
  typeof value === "string" &&
  (KNOWN_SCREEN_OUTCOMES.has(value) || value.startsWith("unavailable: "))

const isVerificationScreen = (row: unknown): boolean => {
  if (!isRecord(row)) return false
  const validMeta =
    typeof row.key === "string" && typeof row.title === "string" && isTheme(row.theme)
  const validSize =
    isPositiveSafeInt(row.width) && (row.height === undefined || isPositiveSafeInt(row.height))
  const validOutcome =
    isVerificationOutcome(row.outcome) && (row.outcome === "not captured" || isEvidenceSource(row))
  const validStale =
    typeof row.stale === "boolean" &&
    (row.staleReason === undefined || typeof row.staleReason === "string")
  const validFile =
    (row.file === null || isPictureFile(row.file)) &&
    (row.outcome !== "captured" || row.file !== null)
  if (!validMeta || !validSize) return false
  return validOutcome && validStale && validFile
}

/** Reject an incompatible response instead of treating missing evidence as an empty success. */
export function isVerificationScreens(value: unknown): value is VerificationScreens {
  if (!isRecord(value) || !("screens" in value)) return false
  const runsOk =
    !("runs" in value) ||
    value.runs === undefined ||
    (Array.isArray(value.runs) && value.runs.every(isVerificationRun))
  return runsOk && Array.isArray(value.screens) && value.screens.every(isVerificationScreen)
}
