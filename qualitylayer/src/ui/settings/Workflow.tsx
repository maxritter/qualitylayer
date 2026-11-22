// Global workflow preferences; agent, model and workspace choices belong to each launch.

import {
  AppWindowIcon,
  BadgeCheckIcon,
  MessageCircleQuestionMarkIcon,
  MessageSquarePlusIcon,
  ScrollTextIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import type { Answers } from "../../core/config-values.ts"
import { requiredLines } from "../../core/required-parse.ts"
import type { Api, Config, InstructionsText, SubagentModels } from "../api.ts"
import { whenWords } from "./About.tsx"
import { InstructionsSheet, requiredSummary } from "./Instructions.tsx"
import { ReviewsGroups } from "./Reviews.tsx"
import { Choice, SettingRow, SettingsGroup } from "./Rows.tsx"

/**
 * Your own instructions, the first row of Your agent: what is written and when, and Edit. The file is read
 * again when Edit is pressed, so the sheet opens on the version it will save against.
 */
function InstructionsRow({ api }: { api: Api }) {
  const [file, setFile] = useState<InstructionsText | null>(null)
  const [problem, setProblem] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    Promise.resolve()
      .then(() => api.instructions())
      .then((found) => live && setFile(found))
      .catch(() => live && setProblem(true))
    return () => {
      live = false
    }
  }, [api])
  const edit = async () => {
    try {
      setFile(await api.instructions())
      setProblem(false)
      setOpen(true)
    } catch {
      setProblem(true)
    }
  }
  const lines = file === null ? 0 : file.text.trimEnd().split("\n").length
  const required = file === null ? [] : requiredLines(null, file.text)
  const says = requiredSummary(required)
  const where =
    file === null
      ? problem
        ? "Could not read your instructions. Try again."
        : "Reading your instructions…"
      : file.updated === 0
        ? "None yet. Your coding standards, tools and rules, like an AGENTS.md. The agent follows them in every task."
        : `${lines} ${lines === 1 ? "line" : "lines"}${says === null ? "" : ` · ${says}`} · saved ${whenWords(file.updated)}.`
  return (
    <SettingRow
      icon={<ScrollTextIcon className="size-[15px]" />}
      label="Your instructions"
      hint={where}
      testId="instructions-row"
    >
      <button
        type="button"
        className="q-btn"
        disabled={file === null && !problem}
        onClick={() => void edit()}
      >
        Edit
      </button>
      {file !== null ? (
        <InstructionsSheet
          open={open}
          onOpenChange={setOpen}
          title="Your instructions"
          intro="The agent follows these in every task, like an AGENTS.md. They never appear in your documents."
          text={file.text}
          base={file.updated}
          save={api.putInstructions}
          onSaved={setFile}
        />
      ) : null}
    </SettingRow>
  )
}

/** What "In my own agent" covers (Max, 11 November 2026). */
export const OWN_AGENT_HINT = "Your terminal, IDE or agent app: Claude Code, Codex, T3 Code, Orca…"

/** App or your own agent, each led by its icon: the two places a task started in an agent can use. */
export const PLACES: { id: Answers; name: string; icon: ReactNode; hint?: string }[] = [
  { id: "app", name: "In the App", icon: <AppWindowIcon className="size-[13px]" /> },
  {
    id: "terminal",
    name: "In my own agent",
    icon: <SquareTerminalIcon className="size-[13px]" />,
    hint: OWN_AGENT_HINT,
  },
]

export type SavedPlace = Pick<Config, "answers" | "approvals" | "answerPlaceChosen">

/**
 * Show the effective defaults even before a preference was explicitly saved. The first-use
 * choice marker governs onboarding, not whether the existing App default is selected.
 */
export function placeOf(config: SavedPlace): {
  answers: Answers
  approvals: Answers
} {
  return { answers: config.answers, approvals: config.approvals ?? config.answers }
}

/** A pick in one row; once chosen, the other row keeps what it shows, so one pick never moves both. */
export function placePatch(
  config: SavedPlace,
  row: "answers" | "approvals",
  next: Answers,
): Record<string, Answers> {
  const other = row === "answers" ? "approvals" : "answers"
  const kept = placeOf(config)[other]
  return { [row]: next, [other]: kept }
}

/**
 * How your agent works with you: whether it offers QualityLayer, your instructions, and where a task
 * started in your own agent asks its questions and its approvals.
 */
function YourAgentGroup({
  config,
  onChange,
  api,
}: {
  config: Config
  onChange: (patch: unknown) => void
  api?: Api | undefined
}) {
  const { answers, approvals } = placeOf(config)
  return (
    <SettingsGroup title="Your agent" testId="in-your-agent">
      <SettingRow
        icon={<MessageSquarePlusIcon className="size-[15px]" />}
        label="Offer QualityLayer"
        hint="Your agent asks once when you ask it to plan without naming QualityLayer."
        stay
      >
        <Switch
          checked={config.offerWorkflow}
          aria-label="Offer QualityLayer"
          onCheckedChange={(offerWorkflow) => onChange({ offerWorkflow })}
        />
      </SettingRow>
      {api !== undefined ? <InstructionsRow api={api} /> : null}
      <SettingRow
        icon={<MessageCircleQuestionMarkIcon className="size-[15px]" />}
        label="Answer questions in"
        hint="For tasks you start in your own agent. You can always answer in the App."
      >
        <Choice
          label="Answer questions in"
          value={answers}
          options={PLACES}
          onChange={(next) => onChange(placePatch(config, "answers", next))}
        />
      </SettingRow>
      <SettingRow
        icon={<BadgeCheckIcon className="size-[15px]" />}
        label="Approve in"
        hint="Where you approve the Plan and the change."
      >
        <Choice
          label="Approve in"
          value={approvals}
          options={PLACES}
          onChange={(next) => onChange(placePatch(config, "approvals", next))}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

export function WorkflowTab({
  config,
  subagents,
  onChange,
  api,
}: {
  config: Config
  /** The App's API: Your instructions reads and saves through it; without it the row is not shown. */
  api?: Api
  /** The installed agents: which the defaults offer, and which cannot start a second opinion; null while loading. */
  subagents?: SubagentModels[] | null
  onChange: (patch: unknown) => void
}) {
  // The coding agents that can run on this computer; undefined while they are being read.
  const available = subagents?.filter((entry) => entry.runnable).map((entry) => entry.agent)
  return (
    <div className="q-sgs">
      <YourAgentGroup config={config} onChange={onChange} api={api} />
      <ReviewsGroups config={config} available={available} onChange={onChange} />
    </div>
  )
}
