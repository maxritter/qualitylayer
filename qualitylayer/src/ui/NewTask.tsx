// New task: a dialog over a dimmed page, as the App Model draws it. What kind of work, the request with its
// files, and where the agent runs. In the App a fresh native agent session opens beside the task and every question and comment happens in the App.
// In the person's terminal they copy one prompt into any coding agent. An open terminal
// session keeps its own settings and conversation; neither way clears it or changes its model.

import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog"
import { permissionDescription } from "../core/run/launch-spec.ts"
import { InfoHint } from "./kit/InfoHint.tsx"
import {
  NewTaskFooter,
  NewTaskHeader,
  RequestField,
  ResumeList,
  StartFields,
} from "./NewTaskParts.tsx"
import { EXISTING, KIND_ICONS, KINDS, STARTS, WHERE } from "./new-task-copy.tsx"
import { TicketCard } from "./new-task-link.tsx"
import { type NewTaskProps, useNewTaskModel } from "./new-task-model.ts"
import { ExtraPlanners } from "./run/ExtraPlanners.tsx"
import { LaunchAttachments } from "./run/LaunchAttachments.tsx"
import { TerminalHandoff } from "./run/LaunchPrompt.tsx"
import { Segmented } from "./Segmented.tsx"
import "./start-model.css"
import "./project-picker.css"

function NewTaskKindControls({ m }: { m: ReturnType<typeof useNewTaskModel> }) {
  return (
    <div className="q-nt-kind">
      <Segmented
        size="md"
        label="New task: kind"
        value={m.taskKind}
        options={(["feature", "bugfix"] as const).map((id) => ({
          id,
          label: KINDS[id].label,
          icon: KIND_ICONS[id],
          disabled: m.starting || m.copying,
        }))}
        onChange={m.setKind}
      />
      <Segmented
        size="md"
        label="New task: how it starts"
        value={m.startMode}
        options={STARTS.map((option) => ({
          ...option,
          disabled: m.starting || m.copying,
        }))}
        onChange={m.setStartMode}
      />
      {m.existing ? (
        <p className="q-nt-hint">
          {EXISTING.line}
          <InfoHint text={EXISTING.hint} />
        </p>
      ) : null}
    </div>
  )
}

function NewTaskLaunchSection({
  props,
  m,
}: {
  props: NewTaskProps
  m: ReturnType<typeof useNewTaskModel>
}) {
  const defaults = props.config.planning.defaults
  return (
    <>
      {m.inApp ? (
        <StartFields
          permissions={permissionDescription(m.agent, m.permission.perm, m.permission.permMode)}
          projects={props.projects}
          target={m.target}
          onTarget={m.chooseTarget}
          folderApi={props.folderApi}
          canConfigure={m.canConfigure}
          onChoosing={m.setChoosingFolder}
          chat={m.kind === "chat"}
          disabled={m.starting}
          onLeave={props.onClose}
          branch={{
            state: m.branchState,
            resolved: m.resolved,
            current: m.shownBranch,
            onChange: (patch) => {
              m.setBranchState((current) => ({ ...current, ...patch }))
              m.setProblem(null)
            },
          }}
          agent={{
            value: {
              agent: m.agent,
              model: m.values.model,
              effort: m.values.effort,
              runWhere: "app",
            },
            installed: props.installed,
            supported: m.supported,
            defaultModel: m.own ? defaults[m.own].model : undefined,
            onChange: m.changeAgent,
          }}
          {...(m.plannable ? { planners: { value: m.planners, onChange: m.setPlanners } } : {})}
        />
      ) : m.plannable ? (
        <ExtraPlanners
          main="other"
          installed={props.installed}
          value={m.planners}
          onChange={m.setPlanners}
          disabled={m.copying}
        />
      ) : null}
      {m.chatCard && m.inApp && m.target !== null && m.target.available !== false ? (
        <ResumeList
          label={m.target.project.name}
          path={m.target.path}
          list={m.sessions}
          busy={m.resuming}
          disabled={!m.canStart || m.starting}
          onResume={(session) => void m.resume(session)}
        />
      ) : null}
      {m.inApp ? null : (
        <TerminalHandoff
          prompt={m.done && m.copied ? m.copied.text : m.previewText}
          files={m.files.length}
          empty={m.empty}
          testId="new-task-command"
          copyTestId="new-task-copy"
          disabled={m.copyBlocked}
          onCopy={() => void m.copy()}
          copied={m.done}
          copying={m.copying}
          folder={m.target && m.target.available !== false ? m.target.path : null}
          folderLabel="project folder"
          onCopyFolder={async (path) =>
            (await props.onCopy(path, "Copied the project folder")) !== false
          }
        />
      )}
    </>
  )
}

function NewTaskWhereSection({ m }: { m: ReturnType<typeof useNewTaskModel> }) {
  return (
    <section className="q-nt-sec" aria-labelledby={m.whereId}>
      <div className="q-nt-where">
        <span className="q-nt-k" id={m.whereId}>
          Where the agent runs
        </span>
        <Segmented
          size="md"
          label="New task: where the agent runs"
          value={m.where}
          options={WHERE.map((option) => ({
            ...option,
            disabled: m.starting || m.copying || (option.id === "app" && m.appOff !== null),
          }))}
          onChange={m.setChosenWhere}
        />
      </div>
      {m.appOff !== null ? (
        <p className="q-nt-hint" role="status">
          {m.appOff}
        </p>
      ) : null}
    </section>
  )
}

export function NewTask(props: NewTaskProps) {
  const m = useNewTaskModel(props)
  const words = KINDS[m.kind]
  const startLabel =
    m.kind === "chat" ? "Start chat" : m.existing ? "Start from this plan" : "Start planning"
  return (
    // Esc, a press on the dimmed page and the close button all close it; a menu open inside closes first.
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        className="q-nt flex w-[600px] max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-none"
        data-testid="new-task"
        data-agent={m.agent}
        finalFocus={() => !m.startedChat.current}
      >
        <NewTaskHeader title={m.chatCard ? "New chat" : "New task"} />
        <DialogDescription className="sr-only">
          {m.chatCard
            ? "Describe what you want to work on, choose the project and agent, and start a chat."
            : "Describe what you want to work on, choose the project and agent, and start a task."}
        </DialogDescription>
        <div className="q-nt-body">
          {m.chatCard ? null : <NewTaskKindControls m={m} />}
          <RequestField
            id={m.fieldId}
            label={m.existing ? EXISTING.ask : words.ask}
            value={m.prompt}
            placeholder={m.existing ? EXISTING.placeholder : words.placeholder}
            disabled={m.starting}
            onChange={m.onPrompt}
            onFiles={m.addFiles}
            onSubmit={() => {
              if (m.inApp) void m.start()
            }}
          />
          {m.kind === "chat" || m.existing ? null : <TicketCard ticket={m.ticket} />}
          <LaunchAttachments
            scope="New task"
            files={m.files}
            disabled={m.starting || m.copying || (m.inApp && !m.canStart)}
            onChange={(next) => {
              m.setFiles(next)
              m.setFileRevision((value) => value + 1)
            }}
          />
          <NewTaskWhereSection m={m} />
          <NewTaskLaunchSection props={props} m={m} />
          {m.problem ? (
            <p role="alert" className="q-run-error">
              {m.problem}
            </p>
          ) : null}
        </div>
        <NewTaskFooter
          startLabel={startLabel}
          credits={m.credits}
          reason={m.reason}
          inApp={m.inApp}
          start={{ blocked: m.startBlocked, busy: m.starting, run: () => void m.start() }}
        />
      </DialogContent>
    </Dialog>
  )
}
