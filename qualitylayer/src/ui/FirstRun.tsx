// Home before the first task (App Model: first-run-home): the mark, a welcome, one sentence, one
// action and a quiet tour, then the three steps of a task. An agent or hook problem stays one quiet
// amber line. The shell's sidebar stays as it is; the licence stays in its foot.

import {
  BadgeCheckIcon,
  CodeXmlIcon,
  ExternalLinkIcon,
  MessageCircleQuestionMarkIcon,
  NetworkIcon,
  ShieldCheckIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { isNativeAgent } from "../core/agents/ids.ts"
import type { DefaultsAgent } from "../core/config-values.ts"
import { FLOW_STEPS } from "../core/flow.ts"
import type { SubagentModels } from "./api.ts"
import { Logo } from "./Logo.tsx"
import { agentTabs } from "./settings/Defaults.tsx"
import { Choice, SettingRow } from "./settings/Rows.tsx"
import { PLACES, placeOf, placePatch, type SavedPlace } from "./settings/Workflow.tsx"
import { enteredBefore, type PausedTour } from "./tour/session.ts"

/** The docs guide for working without the App. */
export const WORK_IN_AGENT_DOCS = "https://qualitylayer.dev/docs/work-in-your-agent"

const FIRST_REQUEST = "the export API needs a rate limit per key"

/** What each step adds to its flow line: who has it and its mark, the task header's step icon. The name and caption are the flow's own. */
const PART_LOOK = {
  plan: { who: "You answer and approve", icon: NetworkIcon, you: true },
  implement: { who: "Agents build", icon: CodeXmlIcon, you: false },
  verify: { who: "Agents check, you approve", icon: ShieldCheckIcon, you: true },
} as const

/** How a task runs, in the three steps. Plan and Verify end in the person's two approvals. */
const PARTS = FLOW_STEPS.map((step) => ({
  id: step.id,
  label: step.label,
  steps: step.caption,
  ...PART_LOOK[step.id],
}))

const FIRST_DRAFT_PREF = "qualitylayer-first-task-draft-v1"
function parseFirstDraft(value: unknown): { request: string; agent: DefaultsAgent } | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as { request?: unknown; agent?: unknown }
  if (typeof record.request !== "string") return null
  const agent = record.agent
  if (!isNativeAgent(agent) && agent !== "other") return null
  return { request: record.request, agent }
}

function readFirstDraft(): {
  request: string
  agent: DefaultsAgent
} | null {
  try {
    const raw = localStorage.getItem(FIRST_DRAFT_PREF)
    if (raw === null || raw.length > 256_000) return null
    return parseFirstDraft(JSON.parse(raw))
  } catch {
    return null
  }
}

/** The three steps, played once in sequence on first landing (onboarding.css). */
function FlowRow() {
  return (
    <ol className="q-fr-flow" aria-label="How a task runs" data-testid="flow-strip">
      <i className="q-fr-line" aria-hidden="true">
        <i className="q-fr-fill" />
      </i>
      {PARTS.map((part, i) => (
        <li
          key={part.id}
          className="q-fr-part"
          data-part={part.id}
          data-who={part.you ? "you" : "agent"}
          style={{ "--i": i } as React.CSSProperties}
          title={part.steps}
        >
          <span className="q-fr-ic" aria-hidden="true">
            <part.icon className="size-[18px]" />
            {part.you ? (
              <span className="q-fr-you">
                <UserRoundIcon className="size-2.5" />
              </span>
            ) : null}
          </span>
          <b>{part.label}</b>
          <small>{part.who}</small>
          <span className="sr-only">: {part.steps}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The quiet hint under the flow that the App is optional: the phrase to say in an agent, the same
 * two rows as Settings › Workflow (saved the same way), and the guide.
 */
function StayInAgent({ place, onPlace }: { place: SavedPlace; onPlace: (patch: unknown) => void }) {
  const { answers, approvals } = placeOf(place)
  return (
    <section className="q-fr-sia" data-testid="stay-in-agent" aria-labelledby="q-fr-sia-h">
      <h2 id="q-fr-sia-h" className="q-fr-sia-h">
        <SquareTerminalIcon className="q-fr-sia-ic size-[15px]" aria-hidden="true" />
        Or stay in your agent
      </h2>
      <p className="q-fr-sia-l">
        Say “Using QualityLayer, plan …” in Claude Code, Codex or another agent.
      </p>
      <div className="q-fr-sia-rows">
        <SettingRow
          icon={<MessageCircleQuestionMarkIcon className="size-[15px]" />}
          label="Answer questions in"
        >
          <Choice
            label="Answer questions in"
            value={answers}
            options={PLACES}
            onChange={(next) => onPlace(placePatch(place, "answers", next))}
          />
        </SettingRow>
        <SettingRow icon={<BadgeCheckIcon className="size-[15px]" />} label="Approve in">
          <Choice
            label="Approve in"
            value={approvals}
            options={PLACES}
            onChange={(next) => onPlace(placePatch(place, "approvals", next))}
          />
        </SettingRow>
      </div>
      <a
        className="q-link q-fr-sia-go"
        href={WORK_IN_AGENT_DOCS}
        target="_blank"
        rel="noopener noreferrer"
      >
        Work only in your agent
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </a>
    </section>
  )
}

function FirstRunNotices({
  noAgent,
  onSetup,
  hooksPending,
  copied,
  onCopyHooks,
  copyError,
  draftError,
}: {
  noAgent: boolean
  onSetup?: () => void
  hooksPending: boolean
  copied: boolean
  onCopyHooks: () => void
  copyError: string | null
  draftError: boolean
}) {
  return (
    <>
      {noAgent ? (
        <p className="q-fr-note">
          <TriangleAlertIcon className="q-fr-warn size-3.5" aria-hidden="true" />
          No coding agent found.
          {onSetup !== undefined ? (
            <button type="button" className="q-link" onClick={onSetup}>
              Set up an agent
            </button>
          ) : null}
        </p>
      ) : null}
      {hooksPending ? (
        <p className="q-fr-note">
          <TriangleAlertIcon className="q-fr-warn size-3.5" aria-hidden="true" />
          Codex hooks need a review: run <code>/hooks</code> in Codex.
          <button type="button" className="q-link" onClick={onCopyHooks}>
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : null}
      {copyError !== null ? (
        <p className="q-fr-note" role="alert">
          {copyError}
        </p>
      ) : null}
      {draftError ? (
        <p className="q-fr-note" role="alert">
          Could not keep your request for the tour. Start a task to keep it, or try again.
        </p>
      ) : null}
    </>
  )
}

export function FirstRun({
  draft,
  name = "",
  onTour,
  onStart,
  onSetup,
  installed,
  paused = null,
  hooksPending = false,
  place,
  onPlace,
  children,
}: {
  /** Where tasks started in an agent are answered and approved; with `onPlace` it draws the stay-in-agent block. */
  place?: SavedPlace
  /** Saves a place row as Settings › Workflow does. */
  onPlace?: (patch: unknown) => void
  /** The request kept by the shared launch card while it is closed. */
  draft?: string
  /** What Setup was told to call the person; the welcome uses its first word. */
  name?: string
  /** Starts the tour on an example task, at the stop given; without it the tour action is not drawn. */
  onTour?: (at: number) => void
  onStart?: (request: string, agent: DefaultsAgent, button: HTMLButtonElement) => void
  /** Opens Setup, where an agent is found or installed. */
  onSetup?: () => void
  /** The installed agents supply the shared card's initial agent; null while unknown. */
  installed?: SubagentModels[] | null
  /** A tour the person left with Escape: the stop it can continue from. */
  paused?: PausedTour | null
  /** Codex still has to review QualityLayer's hooks. */
  hooksPending?: boolean
  children?: ReactNode
}) {
  const tabs = agentTabs(installed)
  const [savedDraft] = useState(readFirstDraft)
  const [enter] = useState(() => !enteredBefore())
  const asked = savedDraft?.agent ?? null
  const agent = asked !== null && tabs.includes(asked) ? asked : (tabs[0] ?? "other")
  const idea = draft ?? savedDraft?.request ?? FIRST_REQUEST
  const [draftError, setDraftError] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const first = name.trim().split(/\s+/)[0] ?? ""
  const noAgent = installed != null && installed.length === 0
  const startTour = () => {
    const draft = JSON.stringify({ request: idea, agent })
    try {
      if (draft.length > 256_000) throw new Error("Draft exceeds the local recovery limit")
      localStorage.setItem(FIRST_DRAFT_PREF, draft)
    } catch {
      setDraftError(true)
      return
    }
    setDraftError(false)
    onTour?.(paused?.at ?? 0)
  }
  const copyHooks = async () => {
    try {
      await navigator.clipboard.writeText("/hooks")
      setCopied(true)
      setCopyError(null)
    } catch {
      setCopied(false)
      setCopyError("Could not copy. Select the command to copy it, or try again.")
    }
  }
  return (
    <div className="@container q-motion-own min-h-0 flex-1 overflow-auto" data-testid="first-run">
      <main className="q-fr" aria-labelledby="q-fr-h">
        <div className="q-fr-in" data-enter={enter ? "" : undefined}>
          <Logo className="q-fr-mark" />
          <h1 id="q-fr-h">{first ? `Welcome, ${first}` : "Welcome to QualityLayer"}</h1>
          <p className="q-fr-lead">Chat with your agent, or plan a change before it builds.</p>
          {children}
          <div className="q-fr-acts">
            {onStart !== undefined ? (
              <button
                type="button"
                className="q-btn primary"
                data-testid="first-start"
                onClick={(event) => onStart(idea, agent, event.currentTarget)}
              >
                Start your first task
              </button>
            ) : null}
            {onTour !== undefined ? (
              <button type="button" className="q-btn quiet" onClick={startTour}>
                {paused !== null
                  ? `Continue the tour · ${paused.at + 1} of ${paused.total}`
                  : "Show me around"}
              </button>
            ) : null}
          </div>
          <FirstRunNotices
            noAgent={noAgent}
            onSetup={onSetup}
            hooksPending={hooksPending}
            copied={copied}
            onCopyHooks={() => void copyHooks()}
            copyError={copyError}
            draftError={draftError}
          />
          <FlowRow />
          <p className="q-fr-note">For planned changes</p>
          {place !== undefined && onPlace !== undefined ? (
            <StayInAgent place={place} onPlace={onPlace} />
          ) : null}
        </div>
      </main>
    </div>
  )
}
