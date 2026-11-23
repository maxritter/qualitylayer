// Create the lasting artifact once, then start its native agent or copy its validated context.
// Launch and clipboard retries retain that artifact instead of creating a second one.

import { BotIcon } from "lucide-react"
import { type MutableRefObject, useEffect, useId, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LASTING_NAME_MAX } from "../../core/artifact/format.ts"
import { type Config, DEFAULT_CONFIG } from "../../core/config-values.ts"
import type { KeepResult, NewArtifactRequest, Project, SubagentModels } from "../api.ts"
import { type ArtifactFeedbackApi, artifactFeedbackApi } from "../artifact/feedback-api.ts"
import { type ProjectFolderApi, ProjectPicker, type ProjectTarget } from "../ProjectPicker.tsx"
import { AgentLaunchFields, type AgentLaunchValue } from "../run/AgentLaunchFields.tsx"
import { LaunchWhere } from "../run/LaunchChoice.tsx"
import { TerminalHandoff } from "../run/LaunchPrompt.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import {
  type CreatedArtifact,
  canStartNewArtifact,
  isNewArtifactReady,
  patchLaunchChoice,
  type RunTransaction,
  resolveAppOff,
  resolveLaunchChoice,
  runNewArtifactSubmit,
  submitButtonLabel,
} from "./new-artifact-submit.ts"
import "../project-picker.css"

/** The folder name an artifact's name makes: lower-case letters, digits and dashes. */
export function artifactSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LASTING_NAME_MAX)
    .replace(/-+$/, "")
}

function initialTarget(projects: Project[], initialProject: string): ProjectTarget | null {
  const project = projects.find((item) => item.id === initialProject)
  return project?.paths[0] ? { project, path: project.paths[0] } : null
}

function NewArtifactLaunch({
  inApp,
  choice,
  installed,
  supported,
  busy,
  canConfigure,
  config,
  prompt,
  copied,
  folder,
  onSelect,
  onCopy,
}: {
  inApp: boolean
  choice: AgentLaunchValue
  installed?: readonly SubagentModels[] | null
  supported: boolean
  busy: boolean
  canConfigure: boolean
  config: Config
  prompt: string
  copied: boolean
  folder?: string
  onSelect: (next: AgentLaunchValue) => void
  onCopy: () => void
}) {
  if (inApp)
    return (
      <AgentLaunchFields
        scope="New artifact"
        heading={{ label: "Agent", icon: <BotIcon size={13} aria-hidden="true" /> }}
        nativeOnly
        location={false}
        value={choice}
        installed={installed}
        supported={supported}
        disabled={busy}
        canConfigure={canConfigure}
        onChange={(patch) => onSelect(patchLaunchChoice(choice, patch, config))}
      />
    )
  if (!prompt) return null
  return (
    <TerminalHandoff
      prompt={prompt}
      testId="new-artifact-command"
      copied={copied}
      onCopy={onCopy}
      folder={folder}
      folderLabel="project folder"
      line="Paste into any agent in this project."
    />
  )
}

function NewArtifactFooter({
  ready,
  made,
  busy,
  canSubmit,
  inApp,
  copied,
  onBlank,
  onClose,
}: {
  ready: boolean
  made: KeepResult | null
  busy: boolean
  canSubmit: boolean
  inApp: boolean
  copied: boolean
  onBlank: () => void
  onClose: () => void
}) {
  return (
    <DialogFooter>
      <button
        type="button"
        className="q-btn quiet ds-create-blank"
        disabled={!ready || made !== null}
        onClick={onBlank}
      >
        Create blank
      </button>
      <button type="button" className="q-btn" disabled={busy} onClick={onClose}>
        {made ? "Done" : "Cancel"}
      </button>
      <button type="submit" className="q-btn primary" disabled={!canSubmit}>
        {submitButtonLabel(busy, inApp, copied)}
      </button>
    </DialogFooter>
  )
}

function NewArtifactStatus({
  made,
  problem,
  problemId,
}: {
  made: KeepResult | null
  problem: string | null
  problemId: string
}) {
  return (
    <>
      {made ? (
        <p className="ds-hint" role="status">
          Artifact created. Trying again uses the same artifact.
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} role="alert" className="ds-problem">
          {problem}
        </p>
      ) : null}
    </>
  )
}

function NewArtifactTextFields({
  ids,
  title,
  slug,
  request,
  locked,
  busy,
  hasProblem,
  onTitle,
  onRequest,
}: {
  ids: { name: string; request: string; problem: string }
  title: string
  slug: string
  request: string
  locked: boolean
  busy: boolean
  hasProblem: boolean
  onTitle: (value: string) => void
  onRequest: (value: string) => void
}) {
  return (
    <>
      <label className="ds-field" htmlFor={ids.name}>
        Name
        <input
          id={ids.name}
          type="text"
          value={title}
          disabled={locked}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: dialog opens on its primary name field
          autoFocus
          aria-describedby={ids.problem}
          aria-invalid={hasProblem}
          onChange={(e) => onTitle(e.target.value)}
        />
        {slug === "" ? null : (
          <span className="ds-hint">
            Kept as <code>.qualitylayer/artifacts/{slug}/</code>
          </span>
        )}
      </label>
      <label className="ds-field" htmlFor={ids.request}>
        Describe it
        <textarea
          id={ids.request}
          value={request}
          disabled={busy}
          maxLength={8000}
          autoComplete="off"
          placeholder="Describe the page, diagram or interactive tool…"
          onChange={(e) => onRequest(e.target.value)}
        />
      </label>
    </>
  )
}

function useDialogMounted() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return mounted
}

function useDialogSubmit(params: {
  ready: boolean
  canSubmit: boolean
  target: ProjectTarget | null
  slug: string
  title: string
  request: string
  inApp: boolean
  choice: AgentLaunchValue
  runs: ReturnType<typeof useOptionalRuns>
  contextApi: Pick<ArtifactFeedbackApi, "context">
  created: MutableRefObject<CreatedArtifact | null>
  transaction: MutableRefObject<RunTransaction | null>
  mounted: MutableRefObject<boolean>
  onCreate: (project: string, request: NewArtifactRequest) => Promise<KeepResult>
  onOpen: (project: string, made: KeepResult) => void
  onMade: (made: KeepResult) => void
  onPrompt: (text: string) => void
  onCopied: (value: boolean) => void
  setBusy: (busy: boolean) => void
  setProblem: (problem: string | null) => void
}) {
  const active = useRef(false)
  return async (blank = false) => {
    const blocked =
      active.current || !params.ready || params.target === null || (!blank && !params.canSubmit)
    if (blocked || params.target === null) return
    active.current = true
    params.setBusy(true)
    params.setProblem(null)
    try {
      await runNewArtifactSubmit({
        blank,
        target: params.target,
        slug: params.slug,
        title: params.title,
        request: params.request,
        inApp: params.inApp,
        choice: params.choice,
        runs: params.runs,
        contextApi: params.contextApi,
        created: params.created,
        transaction: params.transaction,
        mounted: params.mounted,
        onCreate: params.onCreate,
        onOpen: params.onOpen,
        onMade: params.onMade,
        onPrompt: params.onPrompt,
        onCopied: params.onCopied,
      })
    } catch (cause) {
      if (params.mounted.current)
        params.setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      active.current = false
      if (params.mounted.current) params.setBusy(false)
    }
  }
}

export function NewArtifactDialog({
  projects,
  initialProject,
  folderApi,
  canChoose = false,
  config = DEFAULT_CONFIG,
  installed,
  contextApi = artifactFeedbackApi,
  onCreate,
  onOpen,
  onClose,
}: {
  projects: Project[]
  folderApi?: ProjectFolderApi
  canChoose?: boolean
  initialProject: string
  config?: Config
  installed?: readonly SubagentModels[] | null
  contextApi?: Pick<ArtifactFeedbackApi, "context">
  onCreate: (project: string, request: NewArtifactRequest) => Promise<KeepResult>
  onOpen: (project: string, made: KeepResult) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState<ProjectTarget | null>(() =>
    initialTarget(projects, initialProject),
  )
  const [choosing, setChoosing] = useState(false)
  const [title, setTitle] = useState("")
  const [request, setRequest] = useState("")
  const [where, setWhere] = useState<"app" | "terminal">("app")
  const [selected, setSelected] = useState<AgentLaunchValue | null>(null)
  const [made, setMade] = useState<KeepResult | null>(null)
  const created = useRef<CreatedArtifact | null>(null)
  const [prompt, setPrompt] = useState("")
  const [copied, setCopied] = useState(false)
  const runs = useOptionalRuns()
  const choice = resolveLaunchChoice(selected, installed, config)
  const appOff = resolveAppOff(runs, installed)
  const inApp = where === "app" && appOff === null
  const mounted = useDialogMounted()
  const transaction = useRef<RunTransaction | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ids = { name: useId(), request: useId(), problem: useId() }
  const slug = artifactSlug(title)
  const ready = isNewArtifactReady({ target, slug, title, busy, choosing })
  const canStart = canStartNewArtifact({
    inApp,
    installed,
    agent: choice.agent,
    canStart: runs?.support?.canStart === true,
  })
  const canSubmit = ready && Boolean(request.trim()) && canStart
  const locked = busy || made !== null
  const submit = useDialogSubmit({
    ready,
    canSubmit,
    target,
    slug,
    title,
    request,
    inApp,
    choice,
    runs,
    contextApi,
    created,
    transaction,
    mounted,
    onCreate,
    onOpen,
    onMade: setMade,
    onPrompt: setPrompt,
    onCopied: setCopied,
    setBusy,
    setProblem,
  })
  const handleCopy = () =>
    void navigator.clipboard.writeText(prompt).then(
      () => setCopied(true),
      () => setProblem("The prompt was not copied. Select it above and copy it."),
    )
  const handleOpenChange = (next: boolean) => {
    if (!next && !busy) onClose()
  }
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="ds-new sm:max-w-[640px]" data-testid="new-artifact">
        <DialogHeader>
          <DialogTitle>New artifact</DialogTitle>
          <DialogDescription className="sr-only">
            Create an artifact with your agent or start with a blank page.
          </DialogDescription>
        </DialogHeader>
        <form
          className="ds-new-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <NewArtifactTextFields
            ids={ids}
            title={title}
            slug={slug}
            request={request}
            locked={locked}
            busy={busy}
            hasProblem={problem !== null}
            onTitle={(value) => {
              setTitle(value)
              setProblem(null)
            }}
            onRequest={(value) => {
              setRequest(value)
              setCopied(false)
              setPrompt("")
            }}
          />
          <div className="q-nt-app">
            <ProjectPicker
              label="Project"
              projects={projects}
              value={target}
              onChange={setTarget}
              api={folderApi}
              canChoose={canChoose}
              disabled={locked}
              onBusy={setChoosing}
            />
          </div>
          <LaunchWhere
            scope="New artifact"
            quiet
            value={inApp ? "app" : "terminal"}
            onChange={(next) => {
              setWhere(next)
              setCopied(false)
            }}
            appOff={appOff}
            disabled={busy}
            descriptions={{
              app: "The agent runs beside your artifact.",
              terminal: "Copy the prompt into any coding agent.",
            }}
          />
          <NewArtifactLaunch
            inApp={inApp}
            choice={choice}
            installed={installed}
            supported={runs?.support?.supported === true}
            busy={busy}
            canConfigure={runs?.support?.canConfigure !== false}
            config={config}
            prompt={prompt}
            copied={copied}
            folder={target?.path}
            onSelect={setSelected}
            onCopy={handleCopy}
          />
          <NewArtifactStatus made={made} problem={problem} problemId={ids.problem} />
          <NewArtifactFooter
            ready={ready}
            made={made}
            busy={busy}
            canSubmit={canSubmit}
            inApp={inApp}
            copied={copied}
            onBlank={() => void submit(true)}
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}
