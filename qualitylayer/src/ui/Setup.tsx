// First start and the selected machine's setup. Native installers and sign-in use its managed
// terminal; the command line, skills and hooks retain the existing first-start procedure.

import { ServerIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { NativeAgent } from "../core/agents/ids.ts"
import {
  api as appApi,
  type Licence as LicenceIdentity,
  type SetupApi,
  type SetupState,
  setupApi,
} from "./api.ts"
import { Disclosure } from "./kit/Fold.tsx"
import { Logo } from "./Logo.tsx"
import { machineFrame } from "./machines/framed.ts"
import { MachineAgents } from "./machines/MachineAgents.tsx"
import { MachineProject } from "./machines/MachineProject.tsx"
import { CornerSwitch } from "./machines/MachineSwitch.tsx"
import type { MachineHealthApi } from "./machines/useMachineSetup.ts"
import type { ProjectTarget } from "./ProjectPicker.tsx"
import { ProjectsStep } from "./SetupProjects.tsx"
import { useSetupFlow } from "./setup-flow.ts"
import {
  Agents,
  CommandLineStep,
  DoneStrip,
  HooksCommand,
  Licence,
  ownCommandLine,
  UNREAD_LICENCE,
} from "./setup-parts.tsx"
import type { ProjectsApi, useFoundProjects } from "./use-found-projects.ts"

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

function SetupNameFields({
  name,
  disabled,
  onChange,
}: {
  name: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  return (
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
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <Disclosure className="text-[13.5px] text-muted-foreground" head="Coming from Pilot Shell?">
        <p>
          Keep using Pilot Shell 11 until you’re ready to switch. Your active licence works here.
          Import project memory in Settings → Memory.
        </p>
      </Disclosure>
    </>
  )
}

function SetupStepsBody({
  state,
  working,
  licenceError,
  onActivate,
  licensed,
  machine,
  machineHealth,
  guided,
  hooksPending,
  api,
  onChecked,
  onReady,
  terminalRoot,
  found,
  projectPath,
  onProjectPath,
}: {
  state: SetupState
  working: "licence" | "open" | null
  licenceError: string | null
  onActivate: (key: string) => void
  licensed: boolean
  machine: Awaited<ReturnType<typeof appApi.agentSetup>> | null
  machineHealth: MachineHealthApi | null
  guided: boolean
  hooksPending: boolean
  api: SetupPageApi
  onChecked: () => void
  onReady: (agent: NativeAgent | null) => void
  terminalRoot: HTMLDivElement | null
  found: ReturnType<typeof useFoundProjects>
  projectPath: string
  onProjectPath: (path: string) => void
}) {
  const showDoneStrip =
    state.licence.state === "active" && state.licence.tier !== "trial" && ownCommandLine(state.app)
  return (
    <div className="q-steps">
      {showDoneStrip ? (
        <DoneStrip licence={state.licence} />
      ) : (
        <>
          <Licence
            state={state.licence}
            disabled={working !== null}
            error={licenceError}
            onActivate={onActivate}
          />
          <CommandLineStep app={state.app} />
        </>
      )}
      {licensed && machine && machineHealth ? (
        <MachineAgents
          state={machine}
          api={machineHealth}
          number={guided ? 1 : 3}
          onReady={onReady}
          terminalRoot={terminalRoot}
        />
      ) : (
        <Agents
          agents={state.agents}
          hooksPending={hooksPending}
          healthApi={api}
          onChecked={onChecked}
        />
      )}
      {guided && machine ? (
        <MachineProject
          found={found}
          value={projectPath}
          onChange={onProjectPath}
          machine={machine.machine}
        />
      ) : found.available ? (
        <ProjectsStep found={found} number={4} />
      ) : null}
    </div>
  )
}

function SetupFooter({
  guided,
  hasStartTask,
  guidedStartable,
  working,
  canOpen,
  hooksPending,
  onStartTask,
  onOpen,
}: {
  guided: boolean
  hasStartTask: boolean
  guidedStartable: boolean
  working: "licence" | "open" | null
  canOpen: boolean
  hooksPending: boolean
  onStartTask: () => void
  onOpen: () => void
}) {
  return (
    <div className="foot">
      {guided && hasStartTask ? (
        <button
          type="button"
          className="q-btn primary end"
          disabled={!guidedStartable}
          onClick={onStartTask}
        >
          {working === "open" ? "Opening…" : "Start a task"}
        </button>
      ) : (
        <button type="button" className="q-btn primary end" disabled={!canOpen} onClick={onOpen}>
          {hooksPending ? "Continue for now" : "Open QualityLayer"}
        </button>
      )}
    </div>
  )
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
  const flow = useSetupFlow(api, onDone, onStartTask)
  return (
    <div
      className="q-onb q-onb-setup"
      data-testid="setup"
      data-ready={flow.state !== null ? "true" : "false"}
    >
      {machineFrame() === null ? null : <CornerSwitch />}
      <div className="q-machine-layout">
        <div className="q-onb-card">
          <h1>
            {flow.guided ? (
              <>
                <ServerIcon className="size-5" />
                {flow.machine.data?.machine}
              </>
            ) : (
              <>
                <Logo className="size-6" />
                Set up QualityLayer
              </>
            )}
          </h1>
          {flow.guided ? null : (
            <SetupNameFields
              name={flow.name}
              disabled={flow.working !== null}
              onChange={(next) => {
                flow.nameDirty.current = true
                flow.setName(next)
              }}
            />
          )}
          {flow.read.error !== null && flow.state === null ? (
            <div className="q-steps" data-testid="setup-unread">
              <p role="alert" className="alert">
                {flow.read.error.message}{" "}
                <button type="button" className="q-link" onClick={() => flow.read.reload()}>
                  Try again
                </button>
              </p>
              <Licence
                state={UNREAD_LICENCE}
                disabled={flow.working !== null}
                error={flow.licenceError}
                onActivate={(key) => void flow.activate(key)}
              />
            </div>
          ) : null}
          {flow.state !== null ? (
            <SetupStepsBody
              state={flow.state}
              working={flow.working}
              licenceError={flow.licenceError}
              onActivate={(key) => void flow.activate(key)}
              licensed={flow.licensed}
              machine={flow.machine.data}
              machineHealth={flow.machineHealth}
              guided={flow.guided}
              hooksPending={flow.hooksPending}
              api={api}
              onChecked={flow.read.reload}
              onReady={flow.setReadyAgent}
              terminalRoot={flow.terminalRoot}
              found={flow.found}
              projectPath={flow.projectPath}
              onProjectPath={flow.setProjectPath}
            />
          ) : null}
          {flow.steps.length > 0 ? (
            <ol className="m-0 grid list-none gap-0.5 p-0 text-[13px] text-muted-foreground">
              {flow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {flow.failure !== null ? (
            <p role="alert" className="alert">
              {flow.failure}
            </p>
          ) : null}
          {flow.hooksPending ? (
            <div className="grid gap-2 text-[13px]" role="alert">
              <p>QualityLayer hooks still need review in Codex.</p>
              <p>
                Open /hooks in Codex and review the QualityLayer entries. You can continue for now.
              </p>
              <HooksCommand />
            </div>
          ) : null}
          {flow.state !== null ? (
            <SetupFooter
              guided={flow.guided}
              hasStartTask={onStartTask !== undefined}
              guidedStartable={flow.guidedStartable}
              working={flow.working}
              canOpen={flow.canOpen}
              hooksPending={flow.hooksPending}
              onStartTask={() => void flow.startTask()}
              onOpen={() => void flow.open()}
            />
          ) : null}
        </div>
        <div className="q-machine-terminal-slot" ref={flow.setTerminalRoot} />
      </div>
    </div>
  )
}
