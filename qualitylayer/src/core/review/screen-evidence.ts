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

const optionalSize = (value: unknown, least: number, most: number) =>
  value === undefined ||
  (Number.isInteger(value) && Number(value) >= least && Number(value) <= most)

const shared = (item: Record<string, unknown>): boolean =>
  isEvidenceSource(item) && typeof item.buildRevision === "string" && typeof item.at === "number"

/** A picture of a planned screen validates apart from an added picture or output. */
function isSurfaceRow(item: Record<string, unknown>): boolean {
  const captured = item.outcome === "captured"
  return (
    item.kind === "picture" &&
    shared(item) &&
    typeof item.key === "string" &&
    safeScreenKey(item.key) &&
    typeof item.url === "string" &&
    Number.isInteger(item.width) &&
    Number(item.width) >= 240 &&
    Number(item.width) <= 8000 &&
    optionalSize(item.height, 240, 8000) &&
    (item.theme === "light" || item.theme === "dark") &&
    typeof item.artifactDigest === "string" &&
    (captured
      ? isPictureFile(item.file) && typeof item.shotDigest === "string"
      : item.file === null &&
        (item.outcome === "skipped: no browser" ||
          (typeof item.outcome === "string" && /^unavailable: .+/.test(item.outcome))))
  )
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
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  if (item.kind === "output") return !("key" in item) && isAddedOutput(item)
  return "key" in item ? isSurfaceRow(item) : isAddedPicture(item)
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

const isVerificationRun = (value: unknown): value is VerificationRun => {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    isRunId(item.run) &&
    isEvidenceMode(item.mode) &&
    typeof item.at === "number" &&
    typeof item.passed === "boolean" &&
    Array.isArray(item.files) &&
    item.files.every((file: unknown) => {
      if (typeof file !== "object" || file === null) return false
      const entry = file as Record<string, unknown>
      return (
        (entry.kind === "picture" ? isPictureFile(entry.file) : isOutputFile(entry.file)) &&
        (entry.kind === "picture" || entry.kind === "output") &&
        (entry.step === undefined || isAcceptanceStep(entry.step)) &&
        (entry.cites === undefined || typeof entry.cites === "string") &&
        typeof entry.at === "number"
      )
    })
  )
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

/** Reject an incompatible response instead of treating missing evidence as an empty success. */
export function isVerificationScreens(value: unknown): value is VerificationScreens {
  if (typeof value !== "object" || value === null || !("screens" in value)) return false
  if (
    "runs" in value &&
    value.runs !== undefined &&
    !(Array.isArray(value.runs) && value.runs.every(isVerificationRun))
  )
    return false
  const rows = value.screens
  return (
    Array.isArray(rows) &&
    rows.every((row: unknown) => {
      if (typeof row !== "object" || row === null) return false
      const item = row as Record<string, unknown>
      return (
        typeof item.key === "string" &&
        typeof item.title === "string" &&
        Number.isSafeInteger(item.width) &&
        Number(item.width) > 0 &&
        (item.height === undefined ||
          (Number.isSafeInteger(item.height) && Number(item.height) > 0)) &&
        (item.theme === "light" || item.theme === "dark") &&
        typeof item.outcome === "string" &&
        (item.outcome === "captured" ||
          item.outcome === "not captured" ||
          item.outcome === "skipped: no browser" ||
          item.outcome === "omitted: size" ||
          item.outcome.startsWith("unavailable: ")) &&
        // A surface nobody captured has no run to name; every record names one.
        (item.outcome === "not captured" || isEvidenceSource(item)) &&
        typeof item.stale === "boolean" &&
        (item.staleReason === undefined || typeof item.staleReason === "string") &&
        (item.file === null || isPictureFile(item.file)) &&
        (item.outcome !== "captured" || item.file !== null)
      )
    })
  )
}
