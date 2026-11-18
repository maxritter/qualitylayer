// The model's compact handoff: Start the build. Like New task it asks where the agent runs. In
// QualityLayer a fresh native agent session builds beside the task (agent row, then the branch choice);
// in the person's terminal, app or IDE the card shows the one prompt to copy, which works in the
// planning session or a fresh one.
import {
  ChevronRightIcon,
  CodeXmlIcon,
  FileCodeIcon,
  FileTextIcon,
  InfoIcon,
  SettingsIcon,
  SparklesIcon,
  SplitIcon,
  WalletIcon,
} from "lucide-react"
import { marked } from "marked"
import { useContext, useEffect, useId, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AGENT_NAMES, isNativeAgent, type NativeAgent } from "../core/agents/ids.ts"
import {
  AGENT_OWN,
  canSetBuildWorkers,
  modelName,
  offeredModels,
  orchestratorModel,
  smallChangeModel,
  startsOnOwnModel,
  stepModels,
} from "../core/agents/model-values.ts"
import type { Artifact } from "../core/artifact/format.ts"
import { parseArtifactReference } from "../core/artifact/reference.ts"
import { DEFAULT_CONFIG } from "../core/config-values.ts"
import { agentFileOf, folderDoc } from "../core/docs/names.ts"
import {
  acceptsModel,
  type StartAgent,
  type StartChoice,
  type StartEffort,
  sessionModels,
  startDefaults,
} from "../core/handoff/start-values.ts"
import {
  AGENT_CAPABILITIES,
  agentInvocation,
  defaultPermissionChoice,
  permissionDescription,
} from "../core/run/launch-spec.ts"
import type { Flow } from "../core/scaling.ts"
import type { TaskDetail } from "./api.ts"
import type { ClipboardCopy } from "./clipboard.ts"
import { ModelPick, type PickOption } from "./ModelPick.tsx"
import { retainedPlanningStart } from "./planning-start.ts"
import {
  AgentLaunchFields,
  availableLaunchAgents,
  launchAgentAvailable,
  preferredLaunchAgent,
} from "./run/AgentLaunchFields.tsx"
import { LaunchAttachments } from "./run/LaunchAttachments.tsx"
import {
  INITIAL_BRANCH_STATE,
  LaunchBranch,
  type LaunchBranchResolved,
  type LaunchBranchState,
  resolveLaunchBranch,
} from "./run/LaunchBranch.tsx"
import { LaunchWhere } from "./run/LaunchChoice.tsx"
import { TerminalHandoff } from "./run/LaunchPrompt.tsx"
import { NO_AGENT, NO_RUNS } from "./run/launch-copy.ts"
import { useOptionalRuns } from "./run-context.tsx"
import { buildRunForTask, runColors, runStatusText, uploadHandoffAttachments } from "./runs-api.ts"
import { fromPick, launchModelOptions, toPick } from "./settings/Defaults.tsx"
import { useCreditsNote } from "./sidebar/use-credits-note.ts"
import { useStartBranch } from "./start-branch.ts"
import { StartContext, setStartAgent } from "./start-context.ts"
import "./implement-start.css"
import "./start-model.css"

export type { StartAgent } from "../core/handoff/start-values.ts"

export type BuildLaunchSelection = {
  answers?: "app" | "terminal"
  agent: StartAgent
  model: string
  effort: StartEffort
  runWhere: "app" | "terminal"
  works: "checkout" | "branch" | "worktree"
  branch?: string
  worktreePath?: string
  continuation: "same" | "new"
}

/** The new branch of a build is `ql/` and the task's name; a worktree is named by that name alone. */
const BUILD_BRANCH_PREFIX = "ql/"

/**
 * The task's name without its date, shaped to what a worktree name accepts: lower case, letters,
 * digits and dashes, at most 40 characters. A name nothing is left of is "build".
 */
function buildName(slug: string): string {
  let name = slug
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
  while (name.endsWith("-")) name = name.slice(0, -1)
  return name === "" ? "build" : name
}

/** Why Start in QualityLayer is off, in a sentence for the footer, or null. */
function startReason(facts: {
  opened: boolean
  canStart: boolean
  discovering: boolean
  available: boolean
  reading: boolean
  resolved: LaunchBranchResolved
}): string | null {
  if (!facts.opened) return "Open the task to start its build."
  if (!facts.canStart)
    return "This browser can watch and stop. Start from the App or a browser it opened."
  if (facts.discovering) return "Checking installed agents…"
  if (!facts.available) return "Choose an installed agent."
  if (facts.reading) return "Reading the build branch…"
  if (facts.resolved.problem !== null) return facts.resolved.problem
  if (facts.resolved.works === "worktree" && facts.resolved.plan === null)
    return "The project checkout is unavailable."
  return null
}

type BuildDraft = {
  agent: StartAgent | null
  where: "app" | "terminal" | null
  files: File[]
  picks: Partial<Record<StartAgent, Partial<StartChoice>>>
  branch: LaunchBranchState | null
}
const settingsDrafts = new Map<string, BuildDraft>()
function keepBuildDraft(task: string, draft: BuildDraft) {
  settingsDrafts.delete(task)
  if (
    draft.where === null &&
    draft.files.length === 0 &&
    draft.agent === null &&
    draft.branch === null &&
    Object.keys(draft.picks).length === 0
  )
    return
  settingsDrafts.set(task, draft)
  while (settingsDrafts.size > 32)
    settingsDrafts.delete(settingsDrafts.keys().next().value as string)
}

export type BuildArtifacts = {
  data: readonly Artifact[] | null
  loading: boolean
  error: Error | null
  reload?: () => void
}

function BuildArtifactFiles({
  state,
  task,
  approved = false,
}: {
  state?: BuildArtifacts
  task: TaskDetail | null
  approved?: boolean
}) {
  const [open, setOpen] = useState(false)
  const files = new Map<string, { title: string; referenced?: true }>()
  for (const artifact of state?.data ?? []) {
    files.set(artifact.file, { title: artifact.title })
    for (const page of artifact.pages ?? []) files.set(page.file, { title: page.title })
  }
  const plan = task?.pages?.find((page) => page.step === "plan")
  const refs = (plan?.markers ?? [])
    .filter((marker) => marker.name === "artifact")
    .map((marker) => marker.args[0] ?? "")
  for (const token of marked.lexer(plan?.body ?? ""))
    if (token.type === "code" && token.lang?.trim() === "artifact") refs.push(token.text.trim())
  for (const ref of refs) {
    const parsed = parseArtifactReference(ref)
    if (parsed && !files.has(parsed.file))
      files.set(parsed.file, {
        title: parsed.file.split("/").at(-1) ?? parsed.file,
        referenced: true,
      })
  }
  const docs = new Map((task?.docs ?? []).filter((doc) => doc.exists).map((doc) => [doc.name, doc]))
  if (task?.original)
    docs.set(task.original.file, {
      name: task.original.file,
      label: "Original plan",
      exists: true,
      status: task.original.intact ? "read-only" : "changed",
      approved: false,
    })
  // The Plan's agents' file is read with the Plan; one not written yet is not listed as if it were.
  if (task?.support?.context === "written")
    docs.set(agentFileOf("plan"), {
      name: agentFileOf("plan"),
      label: "Plan context",
      exists: true,
      status: "for the build",
      approved: false,
    })
  const first = [folderDoc("plan"), agentFileOf("plan")]
  const rank = (name: string) => (first.indexOf(name) < 0 ? first.length : first.indexOf(name))
  const orderedDocs = [...docs.values()].sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  )
  const docLabel = (doc: TaskDetail["docs"][number]) =>
    doc.name === folderDoc("plan") && approved ? "Approved Plan" : doc.label
  const count = new Set([...docs.keys(), ...files.keys()]).size
  return (
    <section className="q-start-artifacts" aria-label="Files for implementation">
      <div className="q-start-artifacts-head">
        <b>Files for implementation</b>
        <span className="q-start-files-actions">
          {state?.data && !state.error ? (
            <span data-testid="start-files-count">
              {count} {count === 1 ? "file" : "files"}
            </span>
          ) : null}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<button type="button" className="q-link" />}>
              View files
            </PopoverTrigger>
            <PopoverContent
              className="q-build-files-popover"
              align="end"
              aria-label="Files for implementation"
            >
              <b>Files for implementation</b>
              <section
                className="q-build-files-list"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded file list needs keyboard scrolling.
                tabIndex={0}
                aria-label="Implementation files"
              >
                {orderedDocs.length > 0 ? (
                  <ul aria-label="Task documents">
                    {orderedDocs.map((doc) => (
                      <li key={doc.name} title={doc.name}>
                        <FileTextIcon size={15} aria-hidden="true" />
                        <span>
                          <b>{docLabel(doc)}</b>
                          <small>{doc.name}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {state?.error ? (
                  <div role="alert">
                    Could not read artifact files. {state.error.message}
                    {state.reload ? (
                      <button type="button" className="q-link" onClick={state.reload}>
                        Try again
                      </button>
                    ) : null}
                  </div>
                ) : state?.loading && state.data === null ? (
                  <p role="status">Loading artifact files…</p>
                ) : state?.data === null || state === undefined ? (
                  <p>Artifact files are not available in this view.</p>
                ) : files.size === 0 ? (
                  <p>No artifact files in this task.</p>
                ) : (
                  <ul aria-label="Artifact files">
                    {[...files].map(([file, row]) => (
                      <li key={file} title={file} aria-label={`${row.title} · ${file}`}>
                        <FileCodeIcon size={15} aria-hidden="true" />
                        <span>
                          <b title={row.title}>{row.title}</b>
                          <small>
                            {row.referenced ? "Referenced in Plan" : file.split("/").at(-1)}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </PopoverContent>
          </Popover>
        </span>
      </div>
      <section className="q-start-files-summary" aria-label="Included documents">
        {orderedDocs.map((doc) => (
          <span key={doc.name} title={doc.name}>
            <FileTextIcon size={13} aria-hidden="true" />
            {docLabel(doc)}
          </span>
        ))}
        {state?.error ? (
          <span role="alert">Could not read artifact files.</span>
        ) : state?.loading && state.data === null ? (
          <span role="status">Loading artifact files…</span>
        ) : state?.data === null || state === undefined ? (
          <span>Artifact files unavailable</span>
        ) : (
          <span>
            {files.size} {files.size === 1 ? "artifact" : "artifacts"}
          </span>
        )}
      </section>
    </section>
  )
}

type AgentPicks = Partial<Record<StartAgent, Partial<StartChoice>>>
function updateBuildPicks(
  current: AgentPicks,
  active: StartAgent,
  patch: Partial<StartChoice>,
): AgentPicks {
  const selected = patch.agent ?? active
  return {
    ...current,
    [selected]: {
      ...current[selected],
      ...(!patch.agent && patch.model !== undefined ? { model: patch.model } : {}),
      ...(!patch.agent && patch.effort !== undefined ? { effort: patch.effort } : {}),
      ...(!patch.agent && patch.workers !== undefined ? { workers: patch.workers } : {}),
      where: "new",
    },
  }
}
/** What the card says differs for an agent, from its row in agents.json: question picker, effort, subagent model. */
export function buildDifferences(agent: NativeAgent): string[] {
  const capabilities = AGENT_CAPABILITIES[agent]
  return [
    ...(capabilities.effort === "in-model" ? ["Effort is part of the model"] : []),
    ...(capabilities.picker ? [] : ["Questions as numbered choices"]),
    ...(canSetBuildWorkers(agent) ? [] : ["No subagent model to pick here"]),
  ]
}

/** Under the model row: the recommended model, who writes the code, and what differs for this agent. */
function BuildExplain({
  agent,
  small,
  workers,
}: {
  agent: NativeAgent
  small: boolean
  workers: string
}) {
  const recommended = small ? smallChangeModel(agent) : orchestratorModel(agent)
  const different = buildDifferences(agent)
  const helpers = workers === AGENT_OWN ? "the agent’s settings" : modelName(agent, workers)
  return (
    <div className="q-start-explain">
      {recommended !== "" ? (
        // Shown whatever is picked: the recommendation is what someone new needs (Cursor's default
        // is the agent's own settings, so a line only on a match never appeared).
        <p data-testid="build-recommended">
          <SparklesIcon size={13} aria-hidden="true" />
          <span>
            Recommended · {modelName(agent, recommended)}{" "}
            {small ? "for a small change" : "leads the build"}
          </span>
        </p>
      ) : null}
      <p data-testid="build-who">
        <SplitIcon size={13} aria-hidden="true" />
        <span>
          {canSetBuildWorkers(agent)
            ? small
              ? `Usually writes the change itself. Any subagents use ${helpers}.`
              : `Independent slices may go to subagents on ${helpers}.`
            : `Writes the code itself; ${AGENT_NAMES[agent]} decides whether to start helpers.`}
        </span>
      </p>
      {different.length ? (
        <div className="q-start-different" data-testid="build-different">
          <InfoIcon size={13} aria-hidden="true" />
          <b>What’s different</b>
          <ul>
            {different.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** The subagent model in a fold (closed by default) and Model defaults at the row's end. */
function BuildRoleLine({
  agent,
  workers,
  disabled,
  onPick,
  onDefaults,
}: {
  agent: NativeAgent
  workers: string
  disabled: boolean
  onPick(value: string): void
  onDefaults: (() => void) | null
}) {
  const options = launchModelOptions(
    agent,
    offeredModels(agent, stepModels(agent), [toPick(workers)]),
    DEFAULT_CONFIG.implement.defaults[agent].subagents,
  )
  const name = options.find((option) => option.id === toPick(workers))?.name ?? workers
  return (
    <div className="q-start-role-line">
      {canSetBuildWorkers(agent) ? (
        <details className="q-start-subagents" data-testid="subagent-fold">
          <summary>
            <ChevronRightIcon size={13} aria-hidden="true" />
            <span>Subagent model</span>
            <small>{name}</small>
          </summary>
          <div className="q-model-field">
            <ModelPick
              label="Build subagent model"
              look="row"
              value={toPick(workers)}
              options={options}
              disabled={disabled}
              onChange={(next) => onPick(fromPick(next))}
            />
          </div>
        </details>
      ) : null}
      {onDefaults ? (
        <button
          type="button"
          className="q-link"
          aria-label="Open model defaults in Settings"
          onClick={onDefaults}
        >
          <SettingsIcon size={12} aria-hidden="true" />
          Model defaults
        </button>
      ) : null}
    </div>
  )
}

export function ImplementStart({
  task,
  planned,
  flow,
  onCopy,
  compact = false,
  onStarted,
  onOpened: _onOpened,
  onConfirmStart,
  confirmLabel,
  onRemember,
  onCancel,
  cancelDisabled = false,
  saveAttachments = uploadHandoffAttachments,
  artifacts,
  planApproved,
}: {
  task: string
  planned: string
  flow: Flow | null
  onCopy: ClipboardCopy
  compact?: boolean
  onStarted?: () => void
  onOpened?: () => void
  onConfirmStart?: (launch: () => Promise<void>, selection: BuildLaunchSelection) => Promise<void>
  confirmLabel?: string | ((selection: BuildLaunchSelection) => string)
  /** The location the person chose when they started or copied, so the card can open on it next time. */
  onRemember?: (runWhere: "app" | "terminal") => void
  /** Shows Cancel beside the main button (the dialog); the page that holds the card has none. */
  onCancel?: () => void
  cancelDisabled?: boolean
  /** Saves files attached to a copied prompt on this computer and answers their absolute paths (default: the App's server). */
  saveAttachments?: (files: File[]) => Promise<string[]>
  artifacts?: BuildArtifacts
  planApproved?: boolean
}) {
  const services = useContext(StartContext)
  const detail = services?.task?.slug === task ? services.task : null
  const settingsDraft = useRef(settingsDrafts.get(detail?.id ?? "")).current
  const saved = services?.config ?? DEFAULT_CONFIG
  const runs = useOptionalRuns()
  const planning = detail?.planningStart ?? retainedPlanningStart(detail?.id, runs?.runs ?? [])
  const supported = services?.runSupport?.supported === true && runs !== null
  const canStart = services?.runSupport?.canStart === true
  const canConfigure = services?.runSupport?.canConfigure === true
  const installed = services?.installed
  const discovering = installed == null
  const [askedAgent, setAgent] = useState<StartAgent | null>(settingsDraft?.agent ?? null)
  // The App builds with a native agent only; with none installed the card is the terminal's.
  const plannedAgent = planning?.agent ?? (isNativeAgent(planned) ? planned : undefined)
  // Opens on the agent the last build used, kept apart from the one planning remembers; an agent that
  // is no longer installed is skipped for the one that planned this task.
  const lastBuilt = saved.implement.lastAgent
  const agent =
    askedAgent ??
    (isNativeAgent(lastBuilt) && launchAgentAvailable(lastBuilt, installed)
      ? lastBuilt
      : plannedAgent && launchAgentAvailable(plannedAgent, installed)
        ? plannedAgent
        : preferredLaunchAgent(installed))
  const available = launchAgentAvailable(agent, installed)
  const own = agent !== "other"
  const credits = useCreditsNote(own ? agent : undefined)
  const checkout = detail?.checkout?.trim() || detail?.session?.checkout?.trim() || null
  // The App can run an agent only where the server can, and only with a native agent installed.
  const appOff: string | null = !supported
    ? services?.runSupport?.reason?.trim() || NO_RUNS
    : !discovering && availableLaunchAgents(installed).length === 0
      ? NO_AGENT
      : null
  const [chosenWhere, setChosenWhere] = useState<"app" | "terminal" | null>(
    settingsDraft?.where ?? null,
  )
  const inApp = appOff === null && (chosenWhere ?? planning?.runWhere ?? "app") === "app"
  const where: "app" | "terminal" = inApp ? "app" : "terminal"
  const answers: "app" | "terminal" = where
  const [starting, setStarting] = useState(false)
  const [files, setFiles] = useState<File[]>(settingsDraft?.files ?? [])
  const [fileRevision, setFileRevision] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useRef<{ key: string; id: string; worktreePath?: string }>({ key: "", id: "" })
  const uploaded = useRef<{ files: File[]; paths: string[] } | null>(null)
  const [agentPicks, setAgentPicks] = useState<AgentPicks>(settingsDraft?.picks ?? {})
  const picked = agentPicks[agent] ?? {}
  const whereId = useId()
  const contested = detail?.checkoutBusy ?? null
  const name = buildName(detail?.slug ?? "")
  const [pickedBranch, setPickedBranch] = useState<LaunchBranchState | null>(
    settingsDraft?.branch ?? null,
  )
  const completed = useRef(false)
  const retained = useRef<BuildDraft | null>(null)
  retained.current = {
    agent: askedAgent,
    where: chosenWhere,
    files,
    picks: agentPicks,
    branch: pickedBranch,
  }
  const draftTaskId = detail?.id
  useEffect(
    () => () => {
      if (!draftTaskId || completed.current || !retained.current) return
      keepBuildDraft(draftTaskId, retained.current)
    },
    [draftTaskId],
  )
  const branchState: LaunchBranchState = pickedBranch ?? INITIAL_BRANCH_STATE
  const resolved = resolveLaunchBranch(branchState, {
    defaultBranch: `${BUILD_BRANCH_PREFIX}${detail?.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "") ?? ""}`,
    defaultName: name,
    prefix: BUILD_BRANCH_PREFIX,
    checkout,
  })
  const [copyState, setCopyState] = useState<{
    key: string
    text: string
    copied: boolean
  } | null>(null)
  const [copying, setCopying] = useState(false)
  const copyActive = useRef(false)
  // A small change starts its build session on the small-change model; any other task on the full one.
  const small = flow?.light === true
  const inherited = planning?.agent === agent ? planning : undefined
  const permission = defaultPermissionChoice(saved, agent, inherited)
  const buildWorkers = canSetBuildWorkers(agent)
  const mine = {
    ...startDefaults(saved, agent, small, planned),
    ...(!buildWorkers && inherited ? { model: inherited.model } : {}),
  }
  const workers = buildWorkers ? (picked.workers ?? mine.workers) : AGENT_OWN
  // The models the person's plan offers; a default or a choice it does not offer stays, marked.
  const listedModels =
    agent === "other"
      ? sessionModels(agent)
      : offeredModels(agent, sessionModels(agent), [mine.model, picked.model, inherited?.model])
  const models =
    inherited?.model &&
    agent !== "other" &&
    !listedModels.some((model) => model.id === inherited.model)
      ? [...listedModels, { id: inherited.model, name: modelName(agent, inherited.model) }]
      : listedModels
  const choice: StartChoice = {
    ...mine,
    ...picked,
    answers,
    goal: false,
    where: "new",
    workers,
    model:
      picked.model !== undefined && acceptsModel(agent, models, picked.model)
        ? picked.model
        : mine.model,
  }
  useEffect(() => {
    setStartAgent(inApp ? agent : "other", false, inApp)
    return () => setStartAgent(null)
  }, [agent, inApp])
  // A task's build keeps the checkout recorded when planning began.
  const branch = useStartBranch(detail?.id ?? null, true)
  const sessionOptions: PickOption[] = !own
    ? []
    : launchModelOptions(
        agent,
        models,
        startsOnOwnModel(agent)
          ? AGENT_OWN
          : small
            ? smallChangeModel(agent)
            : orchestratorModel(agent),
      )
  const selection: BuildLaunchSelection = inApp
    ? {
        answers,
        agent,
        model: choice.model,
        effort: choice.effort,
        runWhere: "app",
        works: resolved.works,
        ...(resolved.works !== "checkout" ? { branch: resolved.branch } : {}),
        ...(resolved.plan ? { worktreePath: resolved.plan.folder } : {}),
        continuation: "new",
      }
    : {
        answers,
        agent: "other",
        model: "",
        effort: "high",
        runWhere: "terminal",
        works: "checkout",
        continuation: "new",
      }
  const actionLabel =
    (typeof confirmLabel === "function" ? confirmLabel(selection) : confirmLabel) ??
    (onConfirmStart
      ? inApp
        ? "Approve & start"
        : "Approve"
      : inApp
        ? "Start the build"
        : "Copy request")
  /** The prompt for any agent in the person's terminal: one line, then the attached files' paths or names. */
  const promptFor = (attached: readonly string[]) =>
    `${agentInvocation("other", "terminal")} implement the approved task ${task}.${
      attached.length
        ? `\n\nAttached files:\n${attached.map((path) => `- ${path}`).join("\n")}`
        : ""
    }`
  const previewKey = JSON.stringify([
    task,
    files.map((file) => [file.name, file.size, file.lastModified]),
  ])
  const previewText = promptFor(files.map((file) => file.name))
  const done = copyState?.key === previewKey && copyState.copied

  // One reason, in the footer, for whatever stops the main button; the fields keep their own notes.
  const reason: string | null = inApp
    ? startReason({
        opened: detail !== null,
        canStart,
        discovering,
        available,
        reading: branch.loading,
        resolved,
      })
    : null
  const blocked = inApp ? reason !== null || starting || copying : starting || copying

  // Report an explicit completed choice without rewriting the next fresh launch's default.
  const remember = () => {
    if (appOff !== null) return
    onRemember?.(where)
  }
  // The agent of a build started in the App is the next Start the build's opening agent. Only the agent:
  // the model and effort come from the build defaults. A save that fails never fails the start.
  const rememberBuildAgent = () => {
    if (!isNativeAgent(agent) || lastBuilt === agent) return
    services?.saveConfig({ implement: { lastAgent: agent } }).catch(() => {})
  }
  const readyPaths = (): string[] | null => {
    if (files.length === 0) return []
    const again = uploaded.current
    if (again && again.files.length === files.length && again.files.every((f, i) => f === files[i]))
      return again.paths
    return null
  }
  /** Save the files where the agent outside the App can read them, once for the same files. */
  const savedPaths = async (): Promise<string[]> => {
    const ready = readyPaths()
    if (ready !== null) return ready
    const paths = await saveAttachments(files)
    uploaded.current = { files: [...files], paths }
    return paths
  }
  const copy = async () => {
    if (blocked || copyActive.current) return
    copyActive.current = true
    setCopying(true)
    setProblem(null)
    let resolveText!: (text: string) => void
    let rejectText!: (cause: unknown) => void
    const prepared = new Promise<string>((resolve, reject) => {
      resolveText = resolve
      rejectText = reject
    })
    void prepared.catch(() => {})
    let clipboardCopied = false
    try {
      const ready = onConfirmStart ? null : readyPaths()
      const writing = Promise.resolve(
        onCopy(ready === null ? prepared : promptFor(ready), "Copied the prompt"),
      ).then(
        (accepted) => ({ ok: true as const, accepted }),
        (cause: unknown) => ({ ok: false as const, cause }),
      )
      let performed: Promise<void> | undefined
      const perform = () => {
        performed ??= (async () => {
          const text = promptFor(await savedPaths())
          setCopyState({ key: previewKey, text, copied: false })
          resolveText(text)
          const result = await writing
          if (!result.ok) throw result.cause
          if (result.accepted === false)
            throw new Error(
              "The prompt was not copied. Select the prompt above and copy it, or try Copy prompt again.",
            )
          clipboardCopied = true
          setCopyState({ key: previewKey, text, copied: true })
          if (services !== null && detail !== null)
            await services.recordStart(detail.id, {
              agent: "other",
              answers: "terminal",
              orchestrator: null,
              workers: null,
              effort: null,
              goal: false,
              where: "new",
            })
          remember()
        })()
        return performed
      }
      if (onConfirmStart) await onConfirmStart(perform, selection)
      else await perform()
      if (!performed) throw new Error("Copy was cancelled. The prompt was not copied.")
    } catch (cause) {
      rejectText(cause)
      const message =
        cause instanceof Error ? cause.message : "The prompt could not be prepared. Try again."
      setProblem(
        clipboardCopied
          ? `The prompt was copied, but the App could not save this build setup. ${message}`
          : message,
      )
    } finally {
      copyActive.current = false
      setCopying(false)
    }
  }
  const start = async () => {
    if (blocked || !own || !inApp) return
    // Nothing here may end a click without a word: say why this window cannot start.
    if (runs === null || detail === null) {
      setProblem(
        "This window cannot start an agent yet. Reload the page, or copy the prompt and run it in your own agent.",
      )
      return
    }
    const request = {
      agent,
      purpose: { kind: "task" as const, task: detail.id },
      ...(checkout !== null ? { cwd: checkout } : {}),
      settings: {
        answers: "app" as const,
        model: choice.model,
        effort: choice.effort,
      },
      workers: choice.workers,
      works: resolved.works,
      ...(resolved.works !== "checkout" ? { branch: resolved.branch } : {}),
      mode: choice.goal ? ("goal" as const) : ("plain" as const),
      startAnyway: true,
    }
    const { startAnyway: _confirmation, cwd: _checkout, ...choices } = request
    // The worktree's folder follows the checkout, which a first attempt may already have changed: a
    // retry of the same choices keeps the folder it first sent, under the same key.
    const key = JSON.stringify([choices, resolved.name, fileRevision])
    if (attempt.current.key !== key)
      attempt.current = { key, id: crypto.randomUUID(), worktreePath: resolved.plan?.folder }
    const worktreePath = attempt.current.worktreePath
    setStarting(true)
    setProblem(null)
    try {
      const perform = async () => {
        await runs.start(
          {
            ...request,
            ...(resolved.works === "worktree" && worktreePath ? { worktreePath } : {}),
            idempotencyKey: attempt.current.id,
            colors: runColors(),
          },
          files,
        )
        remember()
        rememberBuildAgent()
        completed.current = true
        settingsDrafts.delete(detail.id)
        onStarted?.()
      }
      if (onConfirmStart) await onConfirmStart(perform, selection)
      else await perform()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The agent could not start.")
    } finally {
      setStarting(false)
    }
  }
  const whereChoices = (
    <section className="q-start-sec" aria-labelledby={whereId}>
      <span className="q-start-k" id={whereId}>
        Where the agent runs
      </span>
      <LaunchWhere
        scope="Build"
        value={where}
        appOff={appOff}
        disabled={starting || copying}
        quiet
        onChange={setChosenWhere}
      />
    </section>
  )
  const openModelDefaults = () => {
    if (detail)
      keepBuildDraft(detail.id, {
        agent,
        where: chosenWhere,
        files,
        picks: agentPicks,
        branch: pickedBranch,
      })
    if (agent !== "other") services?.openSettings?.(agent)
  }
  const activeRun = runs?.runs.find((run) => detail !== null && buildRunForTask(run, detail.id))
  if (activeRun)
    return (
      <section className="q-start q-start-model" data-testid="implement-start">
        <p role="status">{runStatusText(activeRun)}</p>
        <button type="button" className="q-btn" onClick={() => runs?.select(activeRun.id)}>
          Open its window
        </button>
      </section>
    )
  return (
    <section
      className="q-start q-start-model q-start-launch"
      data-testid="implement-start"
      data-agent={inApp ? agent : "other"}
      data-compact={compact}
    >
      <div className="q-start-body">
        {whereChoices}
        {inApp ? (
          <div className="q-start-app">
            <AgentLaunchFields
              scope="Build"
              modelRole="Build model"
              heading={{ label: "Builder", icon: <CodeXmlIcon size={13} aria-hidden="true" /> }}
              defaultModel={mine.model}
              installed={services?.launchAgents ?? services?.installed}
              supported={supported}
              disabled={starting || copying}
              canConfigure={!supported || canConfigure}
              location={false}
              nativeOnly
              value={{
                agent,
                model: choice.model,
                effort: choice.effort,
                runWhere: "app",
              }}
              models={sessionOptions}
              onChange={(patch) => {
                if (patch.agent) setAgent(patch.agent)
                setAgentPicks((current) => updateBuildPicks(current, agent, patch))
              }}
              afterModels={
                agent === "other" ? null : (
                  <div className="q-start-explain-block">
                    <BuildExplain agent={agent} small={small} workers={workers} />
                    <BuildRoleLine
                      agent={agent}
                      workers={workers}
                      disabled={starting || copying || !canConfigure}
                      onPick={(workers) =>
                        setAgentPicks((current) => updateBuildPicks(current, agent, { workers }))
                      }
                      onDefaults={services?.openSettings ? openModelDefaults : null}
                    />
                  </div>
                )
              }
            />
            <p className="q-nt-hint">
              Permissions · {permissionDescription(agent, permission.perm, permission.permMode)} ·{" "}
              <a
                className="q-link"
                href="#/settings/agents"
                aria-label="Change permissions in Agent settings"
              >
                Change
              </a>
            </p>
          </div>
        ) : (
          // In my own agent: the App's one outside hand-off. From the Plan's approval its one button
          // approves and copies; there is no second button below.
          <div data-testid="outside-continue">
            <TerminalHandoff
              prompt={copyState?.key === previewKey ? copyState.text : previewText}
              files={files.length}
              testId="start-command"
              onCopy={() => void copy()}
              action={onConfirmStart && planApproved === false ? "Approve and copy" : undefined}
              copied={done}
              copying={copying}
              folder={checkout}
              folderLabel="project folder"
              onCopyFolder={async (path) =>
                (await onCopy(path, "Copied the project folder")) !== false
              }
            />
          </div>
        )}
        <section className="q-start-context" aria-label="Files for the build">
          <BuildArtifactFiles
            state={artifacts}
            task={detail}
            approved={
              planApproved ??
              (detail !== null && (detail.stage !== "plan" || detail.gate?.decision === "approved"))
            }
          />
          <LaunchAttachments
            scope="Start the build"
            files={files}
            disabled={starting || copying || (inApp && !canStart)}
            onChange={(next) => {
              setFiles(next)
              setFileRevision((value) => value + 1)
            }}
          />
        </section>
        {inApp ? (
          <LaunchBranch
            scope="Build"
            heading="Workspace"
            icons
            state={branchState}
            resolved={resolved}
            current={branch.state?.branch}
            checkout={checkout}
            disabled={starting || copying || (supported && !canConfigure)}
            contested={contested}
            onChange={(patch) => setPickedBranch({ ...branchState, ...patch })}
          />
        ) : null}
        {problem ? (
          <p role="alert" className="q-run-error">
            {problem}
          </p>
        ) : null}
      </div>
      <div className="q-start-go">
        {reason ? (
          <p className="q-start-note" role="status" data-testid="start-note">
            {reason}
          </p>
        ) : null}
        {credits !== null ? (
          <p className="q-start-note q-start-credit" role="status" data-testid="start-credits">
            <WalletIcon className="size-3" aria-hidden="true" />
            {credits}
          </p>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            className="q-btn quiet"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        {inApp ? (
          <button
            type="button"
            className="q-btn primary"
            data-testid="step-main"
            disabled={blocked}
            aria-disabled={blocked}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : copying ? "Preparing…" : actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}
