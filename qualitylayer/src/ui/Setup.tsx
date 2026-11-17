// First start and the selected machine's setup. Native installers and sign-in use its managed
// terminal; the command line, skills and hooks retain the existing first-start procedure.

import { CheckIcon, ServerIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import type { AgentHealth } from "../core/agents/health-types.ts"
import type { NativeAgent } from "../core/agents/ids.ts"
import {
  api as appApi,
  type Licence as LicenceIdentity,
  type SetupApi,
  type SetupState,
  setupApi,
} from "./api.ts"
import { useQuery } from "./hooks.ts"
import { AgentHealthStatuses } from "./kit/AgentHealthStatus.tsx"
import { Disclosure } from "./kit/Fold.tsx"
import { Logo } from "./Logo.tsx"
import { machineFrame } from "./machines/framed.ts"
import { MachineAgents } from "./machines/MachineAgents.tsx"
import { MachineProject } from "./machines/MachineProject.tsx"
import { CornerSwitch } from "./machines/MachineSwitch.tsx"
import type { MachineHealthApi } from "./machines/useMachineSetup.ts"
import type { ProjectTarget } from "./ProjectPicker.tsx"
import { addCheckedProjects, ProjectsStep } from "./SetupProjects.tsx"
import { useAgentHealth } from "./settings/AgentHealth.tsx"
import { useIntegration } from "./settings/useIntegration.ts"
import { markCodexHooksPending } from "./tour/session.ts"
import { type ProjectsApi, useFoundProjects } from "./use-found-projects.ts"

type Agent = SetupState["agents"][number]

/** The setup routes; `putConfig` is `PUT /api/config`, the App's own when absent. */
export type SetupPageApi = SetupApi &
  ProjectsApi & {
    putConfig?: (patch: { profile: { name: string } }) => Promise<unknown>
    identity?: () => Promise<Pick<LicenceIdentity, "name" | "email">>
    agentHealth?: typeof appApi.agentHealth
    checkAgents?: typeof appApi.checkAgents
    agentSignIns?: typeof appApi.agentSignIns
    agentIntegration?: typeof appApi.agentIntegration
    repairAgent?: typeof appApi.repairAgent
    agentSetup?: typeof appApi.agentSetup
  }

const words = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Puts text on the clipboard; false when the browser will not let the page. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Mark({ done, number }: { done: boolean; number: number }) {
  return done ? (
    <span className="n ok">
      <CheckIcon className="size-3.5" aria-label="Done" />
    </span>
  ) : (
    <span className="n you">{number}</span>
  )
}

/** Whether this server's command line can set itself up: an App's own, or a machine's with no App at all. */
const ownCommandLine = (app: SetupState["app"]): boolean =>
  app.folder !== null || app.installed || app.cliOnly === true

/** The command line the App sets up for agents: nothing for the person to do inside the App. */
function CommandLineStep({ app }: { app: SetupState["app"] }) {
  const own = ownCommandLine(app)
  return (
    <div className="q-onb-st" data-testid="command-line-step">
      <Mark done={own} number={2} />
      <span className="t">Command line</span>
      <span className="r">{own ? "Included" : "Open the App"}</span>
      <div className="d">
        {own ? null : (
          <div style={{ marginTop: 6 }}>
            This is not the QualityLayer App's own command line, so it cannot set the App up. Open
            the App to continue.
          </div>
        )}
      </div>
    </div>
  )
}

/** Manual recovery only when configuration reports that Codex's hooks still need review. */
function HooksCommand() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const [copying, setCopying] = useState(false)
  const copy = async () => {
    setCopying(true)
    setError(false)
    setCopied(false)
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText("/hooks")
      setCopied(true)
    } catch {
      setError(true)
    } finally {
      setCopying(false)
    }
  }
  return (
    <>
      <div className="q-cmdline" data-testid="codex-hooks">
        /hooks
        <button
          type="button"
          className="q-btn quiet sm"
          disabled={copying}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : copying ? "Copying…" : error ? "Retry copy" : "Copy"}
        </button>
      </div>
      {error ? <p role="alert">Could not copy. Select /hooks to copy it, or try again.</p> : null}
    </>
  )
}

type AgentsApi = Pick<
  SetupPageApi,
  "agentHealth" | "checkAgents" | "agentSignIns" | "agentIntegration" | "repairAgent"
>

/** The seven rows, with Repair for the one whose hooks are out of date and what a repair said. */
function AgentRows({
  health,
  checking,
  api,
}: {
  health: AgentHealth[]
  checking: boolean
  api?: AgentsApi
}) {
  const integration = useIntegration(api)
  // A check that ends reads QualityLayer's part of each agent again: one just started is now there.
  const { reload } = integration
  const was = useRef(checking)
  useEffect(() => {
    if (was.current && !checking) void reload()
    was.current = checking
  }, [checking, reload])
  return (
    <>
      <AgentHealthStatuses
        agents={health}
        checking={checking}
        integration={integration.rows}
        reading={integration.reading}
        repairing={integration.repairing}
        onRepair={api?.repairAgent ? (agent) => void integration.repair(agent) : undefined}
        onCopy={copyText}
      />
      {integration.said !== null ? <p className="q-onb-small">{integration.said}</p> : null}
      {integration.problem !== null ? (
        <p role="alert" className="m-0 text-destructive">
          {integration.problem}
        </p>
      ) : null}
    </>
  )
}

function Agents({
  agents,
  hooksPending,
  healthApi,
  onChecked,
}: {
  agents: Agent[]
  hooksPending: boolean
  healthApi?: AgentsApi
  onChecked?: () => void
}) {
  const {
    agents: health,
    checking,
    error,
    check,
  } = useAgentHealth(healthApi, { checkOnMount: true })
  const initialized = agents.some((agent) => agent.path !== null && agent.ready)
  return (
    <div className="q-onb-st" data-testid="agents-step">
      <Mark done={initialized && !hooksPending} number={3} />
      <span className="t">Your agents</span>
      <span className="r">
        <button
          type="button"
          className="q-link"
          onClick={async () => {
            await check()
            onChecked?.()
          }}
          disabled={checking || (!healthApi?.checkAgents && !onChecked)}
          aria-label="Check agents again"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </span>
      <div className="d grid gap-1" aria-busy={checking}>
        <AgentRows health={health} checking={checking} api={healthApi} />
        {!initialized ? (
          <p className="m-0 text-muted-foreground">
            {agents.some((agent) => agent.path !== null)
              ? "Start an installed agent once, then check again to connect QualityLayer."
              : "Install one of these agents and start it once, then check again to connect QualityLayer."}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** What the licence row says when it is done: the tier and who it is for. */
const licenceSays = (state: SetupState["licence"]): string =>
  `${state.tier === "team" ? "Team" : "Solo"}${state.email !== "" ? ` · ${state.email}` : ""}`

/**
 * Licence and Command line once both are finished: one quiet strip of small neutral checks, since nothing
 * is left to do in them. They keep their own test ids; before then each is a full row.
 */
function DoneStrip({ licence }: { licence: SetupState["licence"] }) {
  return (
    <div className="q-onb-done" data-testid="setup-done">
      <span data-testid="licence-step">
        <CheckIcon className="size-3.5" aria-label="Done" />
        <b>Licence</b> {licenceSays(licence)}
      </span>
      <span data-testid="command-line-step">
        <CheckIcon className="size-3.5" aria-label="Done" />
        <b>Command line</b>
        <span className="sr-only">Included</span>
      </span>
    </div>
  )
}

/** The licence row while setup cannot be read: it takes a key, and starts no trial. */
const UNREAD_LICENCE: SetupState["licence"] = {
  state: "validation_required",
  tier: null,
  email: "",
  expires: null,
  daysLeft: null,
  portal: "",
  buy: "",
}

function Licence({
  state,
  disabled,
  error,
  onActivate,
}: {
  state: SetupState["licence"]
  disabled: boolean
  error: string | null
  onActivate: (key: string) => void
}) {
  const [key, setKey] = useState("")
  const [keying, setKeying] = useState(false)
  const active = state.state === "active"
  const trial = active && state.tier === "trial"
  const form = (!active || keying) && (
    <div className="d">
      <div className="key">
        <Input
          aria-label="Licence key"
          placeholder="Licence key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="q-btn sm"
          disabled={disabled || key.trim() === ""}
          onClick={() => onActivate(key)}
        >
          Activate
        </button>
        {state.state === "missing" ? (
          <button
            type="button"
            className="q-btn quiet sm"
            disabled={disabled}
            onClick={() => onActivate("")}
          >
            Start a trial
          </button>
        ) : null}
      </div>
      {error !== null ? (
        <p role="alert" className="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      ) : null}
    </div>
  )
  return (
    <div className="q-onb-st" data-testid="licence-step">
      <Mark done={active} number={1} />
      <span className="t">Licence</span>
      <span className="r">
        {trial ? (
          <>
            {`Trial · ${state.daysLeft ?? 0} ${state.daysLeft === 1 ? "day" : "days"} left · `}
            <button type="button" className="q-link" onClick={() => setKeying((on) => !on)}>
              I have a licence key
            </button>
          </>
        ) : active ? (
          `${state.tier === "team" ? "Team" : "Solo"}${state.email !== "" ? ` · ${state.email}` : ""}`
        ) : state.state === "trial_expired" ? (
          "Your trial has ended"
        ) : (
          "needed"
        )}
      </span>
      {form || null}
    </div>
  )
}

export const defaultSetupPageApi: SetupPageApi = {
  ...setupApi,
  identity: appApi.licence,
  agentHealth: appApi.agentHealth,
  checkAgents: appApi.checkAgents,
  agentSignIns: appApi.agentSignIns,
  agentIntegration: appApi.agentIntegration,
  repairAgent: appApi.repairAgent,
  agentSetup: appApi.agentSetup,
  foundProjects: appApi.foundProjects,
  chooseProjectFolder: appApi.chooseProjectFolder,
  pickProjectFolder: appApi.pickProjectFolder,
  projectFolder: appApi.projectFolder,
}

export function Setup({
  api = defaultSetupPageApi,
  onDone = () => {
    window.location.hash = "#/"
  },
  onStartTask,
}: {
  api?: SetupPageApi
  onDone?: () => void
  onStartTask?: (target: ProjectTarget, agent: NativeAgent) => void
}) {
  const read = useQuery(() => api.state(), [])
  const state = read.data
  const machine = useQuery(() => api.agentSetup?.() ?? Promise.resolve(null), [api])
  const machineHealth = useMemo<MachineHealthApi | null>(() => {
    const { agentHealth, checkAgents, agentSignIns } = api
    if (!agentHealth || !checkAgents) return null
    return {
      agentHealth: () => agentHealth.call(api),
      checkAgents: (agent) => checkAgents.call(api, agent),
      agentSignIns: () => (agentSignIns ?? agentHealth).call(api),
    }
  }, [api])
  const [readyAgent, setReadyAgent] = useState<NativeAgent | null>(null)
  const [projectPath, setProjectPath] = useState("")
  const [terminalRoot, setTerminalRoot] = useState<HTMLDivElement | null>(null)
  const identity = useQuery(() => api.identity?.() ?? Promise.resolve(null), [api])
  const [name, setName] = useState("")
  const nameDirty = useRef(false)
  const savedName = useRef("")
  const opening = useRef(false)
  useEffect(() => {
    if (nameDirty.current || identity.data == null) return
    const known = (identity.data.name ?? "").trim()
    const email = (identity.data.email ?? "").trim()
    const next = known.toLowerCase() === email.toLowerCase() ? "" : known
    setName(next)
    savedName.current = next
  }, [identity.data])
  const [working, setWorking] = useState<"licence" | "open" | null>(null)
  const [licenceError, setLicenceError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [hooksPending, setHooksPending] = useState(false)
  const trialTried = useRef(false)

  const activate = async (key: string) => {
    setWorking("licence")
    setLicenceError(null)
    try {
      await api.licence(key)
      read.reload()
    } catch (cause) {
      setLicenceError(words(cause))
      // The server may have recorded why (an ended trial): the row follows it.
      read.reload()
    }
    setWorking(null)
  }

  // A fresh computer starts its 7-day trial by itself; a key can be entered instead. A trial that
  // waits for its clock to be vouched for (its mark was lost) is checked again the same way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per page, when the licence is first seen missing
  useEffect(() => {
    const licence = state?.licence.state
    if ((licence !== "missing" && licence !== "validation_required") || trialTried.current) return
    trialTried.current = true
    void activate("")
  }, [state?.licence.state])

  const licensed = state?.licence.state === "active"
  // An agent search that could not run never keeps a paying customer out of the App.
  const anyReady =
    state?.agentsUnread === true || state?.agents.some((a) => a.path !== null && a.ready) === true
  const canInstall =
    state !== undefined &&
    state !== null &&
    (state.app.folder !== null || state.app.cliOnly === true)
  const installed = state?.app.installed === true
  const guided = machine.data !== null && licensed && (installed || state?.app.cliOnly === true)
  const agentsReady = machine.data && machineHealth ? readyAgent !== null : anyReady
  const canOpen = licensed && agentsReady && (installed || canInstall) && working === null
  const found = useFoundProjects(api, licensed)
  /**
   * Leave Setup: the checked projects go in first, each through the add-project route. One that
   * cannot be added never holds Setup up; a message outlives the page and names it.
   */
  const leave = async () => {
    if (found.chosen.size > 0) await addCheckedProjects(found)
    // Home keeps one quiet line about it until the first task starts.
    if (hooksPending) markCodexHooksPending()
    onDone()
  }

  const open = async () => {
    if (opening.current || !canOpen) return
    opening.current = true
    setWorking("open")
    setFailure(null)
    setSteps([])
    try {
      const trimmed = name.trim()
      if (nameDirty.current && trimmed.length > 80)
        throw new Error("Use 80 characters or fewer for your name.")
      if (nameDirty.current && trimmed !== savedName.current) {
        await (api.putConfig ?? appApi.putConfig)({ profile: { name: trimmed } })
        savedName.current = trimmed
        nameDirty.current = false
      }
      if (hooksPending || installed) {
        await leave()
        return
      }
      const finished = await api.finish((step) => setSteps((seen) => [...seen, step]))
      setWorking(null)
      read.reload()
      if (finished?.codexHooks === "pending") {
        setHooksPending(true)
        return
      }
      await leave()
    } catch (cause) {
      setFailure(words(cause))
    } finally {
      opening.current = false
      setWorking(null)
    }
  }

  const startTask = async () => {
    if (!onStartTask || !readyAgent || !licensed || !projectPath.trim() || opening.current) return
    if (!api.projectFolder || !api.chooseProjectFolder) return
    opening.current = true
    setWorking("open")
    setFailure(null)
    try {
      const folder = await api.projectFolder(projectPath.trim())
      if (!folder.checkout) throw new Error("That folder has no Git repository.")
      const target = await api.chooseProjectFolder(folder.checkout)
      if (hooksPending) markCodexHooksPending()
      onStartTask(target, readyAgent)
    } catch (cause) {
      setFailure(words(cause))
    } finally {
      opening.current = false
      setWorking(null)
    }
  }

  return (
    <div
      className="q-onb q-onb-setup"
      data-testid="setup"
      data-ready={state !== null ? "true" : "false"}
    >
      {machineFrame() === null ? null : <CornerSwitch />}
      <div className="q-machine-layout">
        <div className="q-onb-card">
          <h1>
            {guided ? (
              <>
                <ServerIcon className="size-5" />
                {machine.data?.machine}
              </>
            ) : (
              <>
                <Logo className="size-6" />
                Set up QualityLayer
              </>
            )}
          </h1>
          {guided ? null : (
            <>
              <div className="grid gap-1.5">
                <label htmlFor="setup-name" className="flex items-center gap-2 text-sm">
                  What should we call you?{" "}
                  <span id="setup-name-optional" className="text-muted-foreground">
                    Optional
                  </span>
                </label>
                <Input
                  id="setup-name"
                  aria-label="What should we call you?"
                  aria-describedby="setup-name-optional"
                  autoComplete="name"
                  maxLength={80}
                  value={name}
                  disabled={working !== null}
                  onChange={(event) => {
                    nameDirty.current = true
                    setName(event.target.value)
                  }}
                />
              </div>
              <Disclosure
                className="text-[13.5px] text-muted-foreground"
                head="Coming from Pilot Shell?"
              >
                <p>
                  Keep using Pilot Shell 11 until you’re ready to switch. Your active licence works
                  here. Import project memory in Settings → Memory.
                </p>
              </Disclosure>
            </>
          )}
          {read.error !== null && state === null ? (
            // Setup could not be read: a bought key is still taken here, and the page asks again.
            <div className="q-steps" data-testid="setup-unread">
              <p role="alert" className="alert">
                {read.error.message}{" "}
                <button type="button" className="q-link" onClick={() => read.reload()}>
                  Try again
                </button>
              </p>
              <Licence
                state={UNREAD_LICENCE}
                disabled={working !== null}
                error={licenceError}
                onActivate={(key) => void activate(key)}
              />
            </div>
          ) : null}
          {state !== null ? (
            <div className="q-steps">
              {state.licence.state === "active" &&
              state.licence.tier !== "trial" &&
              ownCommandLine(state.app) ? (
                <DoneStrip licence={state.licence} />
              ) : (
                <>
                  <Licence
                    state={state.licence}
                    disabled={working !== null}
                    error={licenceError}
                    onActivate={(key) => void activate(key)}
                  />
                  <CommandLineStep app={state.app} />
                </>
              )}
              {licensed && machine.data && machineHealth ? (
                <MachineAgents
                  state={machine.data}
                  api={machineHealth}
                  number={guided ? 1 : 3}
                  onReady={setReadyAgent}
                  terminalRoot={terminalRoot}
                />
              ) : (
                <Agents
                  agents={state.agents}
                  hooksPending={hooksPending}
                  healthApi={api}
                  onChecked={read.reload}
                />
              )}
              {guided && machine.data ? (
                <MachineProject
                  found={found}
                  value={projectPath}
                  onChange={setProjectPath}
                  machine={machine.data.machine}
                />
              ) : found.available ? (
                <ProjectsStep found={found} number={4} />
              ) : null}
            </div>
          ) : null}
          {steps.length > 0 ? (
            <ol className="m-0 grid list-none gap-0.5 p-0 text-[13px] text-muted-foreground">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {failure !== null ? (
            <p role="alert" className="alert">
              {failure}
            </p>
          ) : null}
          {hooksPending ? (
            <div className="grid gap-2 text-[13px]" role="alert">
              <p>QualityLayer hooks still need review in Codex.</p>
              <p>
                Open /hooks in Codex and review the QualityLayer entries. You can continue for now.
              </p>
              <HooksCommand />
            </div>
          ) : null}
          {state !== null ? (
            <div className="foot">
              {guided && onStartTask ? (
                <button
                  type="button"
                  className="q-btn primary end"
                  disabled={
                    !readyAgent ||
                    !projectPath.trim() ||
                    !api.projectFolder ||
                    !api.chooseProjectFolder ||
                    working !== null
                  }
                  onClick={() => void startTask()}
                >
                  {working === "open" ? "Opening…" : "Start a task"}
                </button>
              ) : (
                <button
                  type="button"
                  className="q-btn primary end"
                  disabled={!canOpen}
                  onClick={() => void open()}
                >
                  {hooksPending ? "Continue for now" : "Open QualityLayer"}
                </button>
              )}
            </div>
          ) : null}
        </div>
        <div className="q-machine-terminal-slot" ref={setTerminalRoot} />
      </div>
    </div>
  )
}
