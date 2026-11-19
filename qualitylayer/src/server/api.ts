// The App's API, as plain functions over a Ctx: thin wrappers around the
// same core modules the CLI commands call, so "the App shows what the CLI
// knows" holds by construction. serve.ts only maps HTTP onto these.

import { basename, join } from "node:path"
import { NATIVE_AGENTS } from "../core/agents/ids.ts"
import { AGENT_OWN } from "../core/agents/model-values.ts"
import { adoptionSummary } from "../core/approved-basis.ts"
import { SHOW_ME_PAGES } from "../core/artifact/format.ts"
import { activeChatHelpers } from "../core/chat/build.ts"
import { chatDocuments, currentChat } from "../core/chat/documents.ts"
import { promoteChat } from "../core/chat/promote.ts"
import { type CheckProgress, readCheckProgress } from "../core/check-progress.ts"
import { type Checklist, readChecklist } from "../core/checklist.ts"
import { readCheckRecords } from "../core/checks.ts"
import { type Config, readConfig, refuseSettingsPatch, writeConfig } from "../core/config.ts"
import type { Answers, PlanningLaunch } from "../core/config-values.ts"
import { decidePicker } from "../core/conversation/pickers.ts"
import { type TaskCost, taskCost } from "../core/cost/index.ts"
import { taskTokenWarning } from "../core/cost/token-warning.ts"
import { addedBlocks } from "../core/docs/added.ts"
import { implementLogPath, readBuildRecord } from "../core/docs/build-log.ts"
import {
  AGENTS_DIR,
  agentFileOf,
  COMMENTABLE_FILES,
  type DocRole,
  folderDoc,
  NAMES,
  RECORDS_DIR,
  type TaskFile,
  taskFiles,
  taskRoles,
} from "../core/docs/names.ts"
import { type Outline, parseOutline, progress } from "../core/docs/outline.ts"
import { cardsPath } from "../core/docs/outline-files.ts"
import { validateDoc } from "../core/docs/validate.ts"
import { artifactPath } from "../core/docs/visuals.ts"
import { scan } from "../core/find/scan.ts"
import {
  addBuildComment,
  answerKind,
  askAgain,
  BUILD_KINDS,
  BUILD_DOC as BUILD_VIEW,
  buildAnchor,
  type Comment,
  diffAnchor,
  helperOpen,
  putDrafts,
  readComments,
  reviewAsk,
} from "../core/gate/comments.ts"
import { readDecided } from "../core/gate/decided.ts"
import {
  approvalWouldAskChanges,
  ensureFinalReview,
  FINAL,
  type GateFile,
  lateAnswerAt,
  lateAnswerLock,
  markGateShown,
  readGate,
  record,
  reviewStanding,
  settle,
} from "../core/gate/gate.ts"
import { planChanges } from "../core/gate/plan-diff.ts"
import { approvalCurrent, reviewTargets, revisionMatches } from "../core/gate/revision.ts"
import { buildBase } from "../core/git/base.ts"
import {
  type BranchState,
  baseBranchRefusal,
  baseWhenOn,
  branchState,
  createBranch,
} from "../core/git/branch.ts"
import { readBuildStart } from "../core/git/build-start.ts"
import { type Changes, changedPaths } from "../core/git/changes.ts"
import { currentBranch } from "../core/git/repo.ts"
import { scopeWalkthrough, workflowChangesView } from "../core/git/workflow-changes.ts"
import { forgetWorkingPatches } from "../core/git/working-patch-cache.ts"
import { clearWorkingRecords } from "../core/git/working-records.ts"
import {
  answeredHereMessage,
  builtPlace,
  type OutsideLead,
  outsideLead,
  plannedPlace,
  type StepPlace,
  wakeOutsideSession,
} from "../core/handoff/outside.ts"
import { agentEntry, implementPrompt } from "../core/handoff/prompt.ts"
import {
  dropRoute,
  parseStart,
  readStart,
  recordRoute,
  recordStart,
} from "../core/handoff/start.ts"
import type { StartRecord } from "../core/handoff/start-values.ts"
import { type Activity, activity, type BuildLine, buildLine } from "../core/helpers.ts"
import { startScriptTask } from "../core/integrations/start.ts"
import {
  type DecidedElsewhere,
  flattenItems,
  type Item,
  openCount,
  type StepChecks,
  type StepParts,
} from "../core/items.ts"
import type { LiveSignals } from "../core/live/liveness.ts"
import {
  type BuildProgress,
  type ProgressWords,
  progressWords,
  readBuildProgress,
} from "../core/live/progress.ts"
import { readBackground, readLive, readRefusal } from "../core/live/read.ts"
import { markSet, type Need, readNeeds } from "../core/need/need.ts"
import { type NeedItem, needsOf } from "../core/needs.ts"
import { readBuildLead } from "../core/next/build-lead.ts"
import type { StepPage } from "../core/pages/detail.ts"
import type { LaneRow } from "../core/pages/lanes.ts"
import { readVerifyLanes } from "../core/pages/record.ts"
import { checksLaneOf } from "../core/pages/records.ts"
import { refreshPages } from "../core/pages/refresh.ts"
import { pageState } from "../core/pages/state.ts"
import { projectRuntimeDir, type RepoRef } from "../core/paths.ts"
import { ASSETS_DIR } from "../core/plan-assets.ts"
import { passRoles, type QualityRow, qualityRowsFor } from "../core/polish.ts"
import { profileOf } from "../core/profile/name.ts"
import { type RequiredView, requiredViewIfTaken } from "../core/required-lines.ts"
import { startAnotherReview } from "../core/review/another.ts"
import { type AnswerRun, liveAnswerRun, startAnswering } from "../core/review/answers.ts"
import { reviewComments } from "../core/review/comments.ts"
import { lockReason, readRun } from "../core/review/cross.ts"
import { approveChoices, reviewChangesOf, reviewOf } from "../core/review/detail.ts"
import type { ReviewFileSource, SourceRequest } from "../core/review/file-source.ts"
import {
  type AnotherRun,
  disposeFinding,
  type LineFinding,
  lineFindings,
  readAnotherRuns,
} from "../core/review/findings.ts"
import { inPersonReview } from "../core/review/in-review.ts"
import { type ChangesRequested, changesRequested } from "../core/review/notes.ts"
import { type ApproveChoices, type ReviewDetail, shipBlockers } from "../core/review/summary.ts"
import { type ReviewAction, readReview, sayInReview } from "../core/review/threads.ts"
import { readWalkthrough, type WalkFile, type Walkthrough } from "../core/review/walkthrough.ts"
import { type CheckoutBusy, checkoutBusy } from "../core/run/checkout-busy.ts"
import { readPlanningStart } from "../core/run/planning-start.ts"
import { listRuns } from "../core/run/registry.ts"
import { belongsToTask, stopTaskRuns } from "../core/run/task-stop.ts"
import { usesGitCrypt } from "../core/run/worktree.ts"
import { applyOverrides, type Flow } from "../core/scaling.ts"
import {
  clearShipRecord,
  readShipRecord,
  type ShipChoice,
  writeShipRecord,
} from "../core/ship/choice.ts"
import { type ClosedPass, descriptionPath, readClosedPass } from "../core/ship/closing-record.ts"
import { approveChange, type LandingState, landingView, markMerged } from "../core/ship/landing.ts"
import { diffBetween } from "../core/ship/landing-diff.ts"
import {
  leavePullRequest,
  type PullRequestLife,
  pullRequestLife,
  pushFix,
} from "../core/ship/pr-life.ts"
import { postPullRequestNotes } from "../core/ship/pr-notes.ts"
import { readPullRequestRecord } from "../core/ship/pr-record.ts"
import { createPullRequest, ghInstalled, wrongBranch } from "../core/ship/pull-request.ts"
import { type ShippedFacts, shippedFacts } from "../core/ship/shipped.ts"
import { ORIGINAL_MAX_BYTES } from "../core/task/adoption.ts"
import { deleteTask, isArchived, readArchivedAt, setArchived } from "../core/task/archive.ts"
import { boundSlug, claimedByOthers, keyOf } from "../core/task/binding.ts"
import { handbackTask, listHandbacks, readHandback } from "../core/task/handback.ts"
import { taskItems, taskPage } from "../core/task/items.ts"
import { STAGE_ORDER, type Stage } from "../core/task/machine.ts"
import {
  type AnswerChange,
  type AnsweredQuestion,
  answeredQuestions,
  cancelMore,
  changeAnswer,
  type Heartbeat,
  openQuestion,
  type Question,
  questionsAhead,
  readHeartbeat,
} from "../core/task/question.ts"
import {
  answerFromApp,
  appAnswerOf,
  type HomeHost,
  homeQuestionDir,
} from "../core/task/question-app.ts"
import { batchStrip, readBatch } from "../core/task/question-batch.ts"
import { approvalsOf } from "../core/task/sides.ts"
import type { VerifyMode } from "../core/task/stages.ts"
import {
  appendEvent,
  isCurrentLayout,
  isTerminal,
  listTasks,
  loadTask,
  patchReadme,
  readEvents,
  readmePath,
  readSession,
  type Session,
  type Task,
  TaskUnreadable,
  taskDocPath,
} from "../core/task/store.ts"
import { readVerifyMode } from "../core/task/verify-mode.ts"
import { type Intake, intakeOf, plannedSizeOf, taskFlow } from "../core/task-flow.ts"
import { asComment, isStructured, readTeamComments } from "../core/team/comments.ts"
import type { Person } from "../core/team/people.ts"
import { type Timeline, timeline } from "../core/timeline.ts"
import { readAssignment } from "../core/verification.ts"
import { readVerifyActivity, type VerifyActivity } from "../core/verify-activity.ts"
import { writeViewing } from "../core/viewing.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { filesIn } from "../files.ts"
import { projectMemory } from "../memory-runtime.ts"
import { publicationContext } from "../publication-fs.ts"
import { crashLine } from "./crash.ts"
import { cachedBuildLog, cachedDoc, cachedFrontmatter, docCache } from "./doc-cache.ts"
import { type Opener, type OpenHow, openablePath, openFile } from "./open-file.ts"
import { openInEditor } from "./open-in-editor.ts"
import { cachedPullRequest } from "./pull-request-poll.ts"
import { stepPages } from "./step-pages.ts"
import { recheckAfterChannelChange } from "./update.ts"
import { ownsWorkflowAnchor, workflowProjection, workflowReviewSource } from "./workflow-review.ts"

export type Project = {
  id: string
  name: string
  paths: string[]
  lastSeen: number
  commonDir?: string
}

export type { TaskFile }

export type TaskSummary = {
  /**
   * The way to build the person chose after approving the Plan: the outside panel shows it, and
   * the header and the task's row say who builds next until the build starts.
   */
  start?: {
    where: StartRecord["where"]
    /** The agent the choice names, and when it was made. */
    agent?: StartRecord["agent"]
    at?: number
    compact?: boolean
    /** A known outside session builds it: the planner the person approved in. */
    route?: boolean
  }
  original?: { file: string; sha256: string; intact: boolean }
  /** Made with an earlier workflow: listed, its files open as plain files, never continued. Absent otherwise. */
  earlier?: true
  answers: Answers
  /** Where the approvals happen; unset in older payloads, where they follow `answers`. */
  approvals?: Answers
  /** `<project id>~<slug>`: unique across every repository on the machine. */
  id: string
  files: TaskFile[]
  /**
   * What Verify is doing (core/task/stages.ts `verifyModeOf`): the agents check or fix, an exit
   * question is open, or the person reviews. Null outside Verify.
   */
  verifyMode: VerifyMode | null
  project: string
  projectName: string
  slug: string
  title: string
  /** Original task request; older servers may expose only its title. */
  request?: string
  type: string
  /** The user's words recorded as switches of the scaling rules. */
  overrides: string[]
  stage: Stage
  iterations: number
  created: number
  dir: string
  gate: {
    id?: string
    revision?: string
    targets?: string[]
    target: string
    opened: number
    decision: string
    settled: boolean
    /** When it was decided, and where: `cockpit` (the App), `chat`, `policy`. */
    decided?: number
    by?: string
    /** The agent recorded the decision at the person's request: their words. */
    asked?: string
    /** Approved outside (`by: outside`): the reviewer and the pull request. */
    outside?: { via: "github"; url: string; login: string }
    /** The earlier opening of the Review the approving page showed, when it was not this one. */
    approvedOn?: string
    /** The step the task was in when the approval was saved after Review went back for a recheck. */
    approvedDuring?: string
    /** Why Approve is locked (a second opinion is still to come in), or null when it is not. */
    locked?: string | null
    /** The Plan's Approve waits on a late answer: when the person sent it (the header's "answer sent HH:MM"). */
    folding?: number
    /** The Plan changed after the other agent's review settled: no reviewer read the last change. */
    reviewedBefore?: true
    /** A review exists without a recorded input revision. */
    reviewInputUnknown?: true
    /** Which round of review this is: 2 after changes were sent once, and so on. */
    round?: number
  } | null
  session: Session | null
  /** Actual registered checkout; available before a native session is started. */
  checkout?: string
  progress: { total: number; checked: number; slices: number } | null
  /**
   * The helpers handed out in the task's current stage and the other agent's
   * reviews, each with its state, start time and latest line.
   */
  helpers: (Pick<Activity, "id" | "line" | "at"> & Partial<Activity>)[]
  reviewFix?: "fix" | "judge"
  /** Put away by the user: out of the working lists, kept until deleted. */
  archived: boolean
  archivedAt?: number
  /** The branch the user had checked out when the work started; null before the build or when detached. */
  branch: string | null
  /**
   * What the human has to do, if anything: review the Plan, start Implement (the Plan is approved
   * and no build has started), approve the change.
   */
  action: "review" | "implement" | "final" | null
  waitingSince: number | null
  closing: {
    shipped: string | null
    slices: number
    firstPass: boolean
    touched: string[]
    /** How it closed, in a few words: "PR #412", "approved", "closed without shipping". */
    how?: string
    /**
     * What the agents' passes cover of the approved code, from the closing record: `stands` when
     * they were given on it; else the commit they were given on (null when none was recorded) and
     * how many commits followed it up to the approved head. Absent without a closing record.
     */
    pass?: ClosedPass
  } | null
  /**
   * A shipped task's pull request as last read: its state, checks and threads, and what of it
   * waits on the person. Absent for a task with no pull request. A task whose pull request is
   * open stays under Open now, and what waits on the person counts in Home and the sidebar.
   */
  pullRequest?: PullRequestLife
  /**
   * A shipped task after the approval: landing until its change reached the base branch, then
   * landed, with the changes made since the approval (`since`). Absent before it ships.
   */
  landing?: LandingState | null
  /** How many items wait for the person, once the server computes them; the sidebar says so beside the step. */
  openItems?: number
  /** The batch of questions the task asks now, every member in order with its answer; Home lists its open ones. */
  batch?: import("../interaction/contracts.ts").BatchStrip | null
  /** Those items as Home lists them across tasks: the line of each, without its picture or members. */
  needs?: NeedItem[]
  /** The change was too small for a plan: it was handed back to the plain agent with this prompt. */
  handedBack?: { reason: string; prompt: string; words: string }
  /** The live status: the agent's signs of life, the build's place, its needs, a refusal; absent once closed. */
  live?: LiveReport
}

/** What the App's pill, its panel and the sidebar row are drawn from (core/live, core/need). */
export type LiveReport = {
  signals: LiveSignals | null
  /**
   * A shell command the lead started in the background still runs (its transcript says so): its
   * harness wakes it when the command ends, so a turn end now is no wait on the person.
   */
  backgroundRunning?: boolean
  /** The build's place during Implement, with its words. */
  progress: (BuildProgress & { words: ProgressWords }) | null
  /** Every need of the build: open ones ask the person, resolved ones are the receipt. */
  needs: Need[]
  /** QualityLayer's own refusal, and how often it came in a row. */
  refusal: { lead: string; words: string; count: number; at: number; since: number } | null
  /** The question the agent waits on, for the sidebar and the notifications. */
  question: {
    number: number
    text: string
    ahead: number | null
    gate: string | null
    settles?: string[]
    /** The first question after /ql: the CLI brought the App forward and notified for it. */
    front: boolean
    /** When the `ask` that waited was interrupted; the answer given now is kept. */
    stopped: number | null
    /** Tell me more was handed to the agent and it looks into it: the agent works, the card waits. */
    looking?: boolean
  } | null
}

export type DocEntry = {
  name: string
  label: string
  exists: boolean
  status: string
  approved: boolean
  /** An allowlisted private runtime record; never a filesystem path. */
  runtimeRecord?: { id: "annotations-v1"; scope: "task" | "artifact"; file?: string }
  /** Later findings written into this document as `> [!ADDED] <stage> · <reason>` blocks. */
  added?: { stage: string; reason: string }[]
}

export type SliceView = {
  n: number
  title: string
  validation: string
  tasks: { id: string; title: string; checked: boolean }[]
}

/** One slice of the Plan as the Implement view shows it. */
export type BuildSlice = SliceView

/** The prompt that starts Implement in one agent, as the CLI prints it at the stop. */
export type ImplementOption = {
  agent: string
  name: string
  /** What the user types in a fresh session: `/ql implement <task>`. */
  prompt: string
  /** One line: a fresh session, and the model recommended for it. */
  advice: string
}

/** The Implement start: the prompt per agent, what the scaling rules applied, and the Plan's size. */
export type ImplementStart = {
  slices: number
  tasks: number
  /** Claude Code, Codex, then any other agent. */
  agents: ImplementOption[]
  flowLine: string
}

export type TaskDetail = TaskSummary & {
  planningStart?: PlanningLaunch | null
  /**
   * The task's lead when a session outside the App runs it (planned or built in the person's own
   * terminal, app or IDE): the Agent tab follows it. Absent while the App runs the lead or none runs.
   */
  outside?: OutsideLead
  /** Where the task was planned: an App planning session or one outside the App. */
  planned?: StepPlace
  /** Where the task is built, once a build session took the approved Plan. */
  built?: StepPlace
  /** The fresh helper answering questions on the change now, if one runs; null with none open. */
  answering?: {
    helper: AnswerRun["helper"] | null
    /** How many comments wait for an answer now, and since when the oldest does (the Feedback tab's badge and the Agent tab say so). */
    waiting?: number
    since?: number
  } | null
  /** A workflow session is joined to this task, so App navigation can inform its prompt hook. */
  viewingEligible?: boolean
  /** The task's repository holds git-crypt keys, so a copied worktree command must copy them in. */
  gitCrypt?: boolean
  /** Worker progress and unchanged passing commands, shown in the agent's turn. */
  checkProgress?: CheckProgress[]
  /** The owning task's explicit progress line, including its recorded workflow step. */
  taskProgress?: BuildLine | null
  reusedChecks?: string[]
  verifyActivity?: VerifyActivity
  /** The task's required lines and what became of each; absent when its instructions required none. */
  required?: RequiredView
  /** Source identity only, not a pass verdict: do outcome records match the displayed code/basis? */
  reviewEvidence?: { current: boolean; currentCode: string; checkedCode: string | null }
  /** Every slice of the approved Plan; empty before there is one. */
  slices: BuildSlice[]
  /** Implement, Verify and Review: whole cards, notes, commits and the plan's diff. */
  timeline: Timeline | null
  /** Net changed paths against the build's base; null when git could not determine them. */
  changedFiles?: string[] | null
  /** At Review: what the agents found on lines of the change, with what the person did with each. */
  findings?: LineFinding[]
  /** At Review: the reviewers asked from the workspace, newest last, without their findings. */
  anotherReviews?: Omit<AnotherRun, "findings" | "pid">[]
  /** The build log's own sections, as written. */
  buildLog: { deviations: string } | null
  /** Verify's quality pass: the security review, across a trust boundary. */
  quality: QualityRow[]
  /**
   * Every check of Verify from its first moment, each with its state, who runs it and what it found,
   * plus the header facts (passed of total, minutes, what each checking agent does now). Null before
   * Verify; the App draws it and never parses the build log for it.
   */
  checklist?: Checklist | null
  /** What the scaling rules applied to this task; null before the Plan exists. */
  flow: Flow | null
  /** How the task runs, while the choice is real (before the Plan is approved): the Plan's quiet row. Null otherwise. */
  intake?: Intake | null
  /** The prompt that starts Implement, once the Plan exists. */
  implementStart: ImplementStart | null
  /**
   * Why this checkout is contested before a build starts in it: another agent session works there
   * (`session`) or it holds uncommitted work from elsewhere (`changes`, with the file count). The
   * start card then proposes a worktree. Absent once the build has started.
   */
  checkoutBusy?: CheckoutBusy | null
  docs: DocEntry[]
  comments: Comment[]
  events: Record<string, unknown>[]
  prDescription: string | null
  verification: {
    n: number
    result: string | null
    judge: string | null
    verdicts: { verdict: string; kind: string; subject: string; text: string }[]
  }[]
  /** Pages the agent drew for "show me", under artifacts/show-me-*.html. */
  showMe: { name: string; title: string }[]
  /** Files the judge saved under evidence/. */
  evidence: string[]
  /** A task's raw command output under records/, for the Files tab's Records row; absent otherwise. */
  records?: string[]
  /** The agents' own files under agents/, counted by the Files tab's Records row, never listed; absent otherwise. */
  agents?: string[]
  /**
   * The Plan's supporting files: its agents' file (agents/01-plan.md), written or not yet, and the
   * pictures `plan draft` captured under assets/. Absent for an earlier task, which has neither.
   */
  support?: { context: "written" | "missing"; assets: string[] }
  /** The team's review of the verified change, once a judge has passed it; null before. */
  review: ReviewDetail | null
  /** Final approval stays available when verification has no readable review record. */
  reviewApproval?: ApproveChoices
  /** Review 1c: the person's notes sent to the agent, each sent, picked up or done; absent otherwise. */
  changesRequested?: ChangesRequested | null
  /** Review 1e: what a shipped task shows, from the approval to its cost; absent before it ships. */
  shipped?: ShippedFacts | null
  /** Who the person is, for the initials on their own comments. */
  me: Person
  /**
   * What needs a person, per step, in one shape (core/items.ts). The server computes it from the
   * documents and state; absent until it does, and a page then shows no Needs you card.
   */
  items?: Item[]
  /** The lists and records the Plan page draws around its items. */
  parts?: StepParts
  /** The facts the agents proved, for the violet line of the Plan. */
  checked?: StepChecks
  /** The question the App's card asks while the Plan or Verify waits for the answer; null when none. */
  question?: Question | null
  /** The batch the question belongs to, every member in order with its answer; null or absent for a single question. */
  batch?: import("../interaction/contracts.ts").BatchStrip | null
  /** The questions answered so far, in the App or the agent's chat, oldest first. */
  answeredQuestions?: AnsweredQuestion[]
  /** The last heartbeat of the `question ask` that waits (or waited), for "Claude Code waits". */
  questionWait?: Heartbeat | null
  /** What changed in the Plan since the person last sent changes on it, as diff lines; absent before a second round. */
  planDiff?: string
  /**
   * The gate was decided in the agent's window while answers were still unsent here: where and
   * when. The answers stay as comments, not delivered behind the person's back.
   */
  decidedElsewhere?: DecidedElsewhere
  /**
   * The three step documents, each cut at its `ql:` markers.
   */
  pages?: StepPage[]
  /** Verify's lanes as the board draws them (who runs each check, how it stands), from the last refresh. */
  verifyLanes?: LaneRow[]
}

/** Stored registration is retained even when none of its checkout folders is available. */
export async function registeredProjects(ctx: Ctx): Promise<Project[]> {
  const dir = join(ctx.home, "projects")
  if (!(await ctx.fs.exists(dir))) return []
  const projects: Project[] = []
  for (const id of (await ctx.fs.readdir(dir)).sort()) {
    const path = join(dir, id, "project.json")
    if (!(await ctx.fs.exists(path))) continue
    try {
      const raw = JSON.parse(await ctx.fs.readFile(path)) as Partial<Project>
      projects.push({
        id,
        name: raw.name ?? id,
        paths: raw.paths ?? [],
        lastSeen: raw.lastSeen ?? 0,
        ...(typeof raw.commonDir === "string" ? { commonDir: raw.commonDir } : {}),
      })
    } catch {
      // an unreadable project file hides that project, nothing else
    }
  }
  return projects
}

/** The live list contains only usable checkout folders; listing never changes registration. */
export async function listProjects(ctx: Ctx): Promise<Project[]> {
  const projects: Project[] = []
  for (const project of await registeredProjects(ctx)) {
    const paths: string[] = []
    for (const path of Array.isArray(project.paths) ? project.paths : []) {
      if (typeof path !== "string") continue
      try {
        await ctx.fs.readdir(path)
        paths.push(path)
      } catch {
        // A missing or unreadable checkout stays registered, but is not a live launch target.
      }
    }
    if (paths.length > 0) projects.push({ ...project, paths })
  }
  return projects
}

const stageRank = (stage: Stage) => STAGE_ORDER.indexOf(stage)

/** The agents the Implement page offers a prompt for, then any other. */
const IMPLEMENT_AGENTS = [...NATIVE_AGENTS, "unknown"] as const

/** Task folders already named in crash.log this run: a broken one is logged once, not at every poll. */
const reportedBroken = new Set<string>()

/** A task folder that could not be read: one crash.log line the first time, nothing after. */
function taskBroken(ctx: Ctx, folder: string, error: unknown): void {
  const slug = basename(folder)
  if (reportedBroken.has(slug)) return
  reportedBroken.add(slug)
  const kind = (error as NodeJS.ErrnoException | undefined)?.code ?? (error as Error)?.name
  // The first line of what failed: a log that says only "Error" cannot be acted on.
  const detail = String((error as Error | undefined)?.message ?? "")
    .split("\n")[0]
    ?.slice(0, 160)
  crashLine(
    ctx.home,
    "task",
    new Error(`task folder ${slug} unreadable (${kind}${detail ? `: ${detail}` : ""})`),
  )
}

/** Every task of a project, one entry per slug: the copy in the checkout where the task lives. */
async function projectTasks(ctx: Ctx, project: Project): Promise<Task[]> {
  const bySlug = new Map<string, Task[]>()
  for (const root of project.paths) {
    if (!(await ctx.fs.exists(root))) continue
    const repo: RepoRef = { root, id: project.id, commonDir: "" }
    for (const task of await listTasks(ctx, repo, (folder, error) =>
      taskBroken(ctx, folder, error),
    )) {
      bySlug.set(task.slug, [...(bySlug.get(task.slug) ?? []), task])
    }
  }
  const tasks: Task[] = []
  for (const copies of bySlug.values()) {
    const session = await readSession(ctx, copies[0] as Task)
    const home = copies.find((t) => t.repoRoot === session?.checkout)
    tasks.push(
      home ?? ([...copies].sort((a, b) => stageRank(b.stage) - stageRank(a.stage))[0] as Task),
    )
  }
  // A change handed back as too small is a record, not a task folder; the lists show it too.
  for (const record of await listHandbacks(ctx, project.id)) {
    if (!tasks.some((t) => t.slug === record.slug)) tasks.push(handbackTask(ctx, record))
  }
  return tasks
}

/**
 * Approve is locked while the gate waits for the other agent's review and the agent's re-check;
 * the Plan's also while the planner folds a late answer in.
 */
async function approveLock(ctx: Ctx, task: Task, gate: GateFile): Promise<string | null> {
  if (gate.decision !== "pending" || gate.settled === true) return null
  if (gate.target === FINAL) return null
  if (gate.waitsFor !== undefined) {
    const run = await readRun(ctx, task, gate.waitsFor)
    if (run !== null) return lockReason(run, ctx.clock.now())
  }
  return gate.target === folderDoc("plan") ? lateAnswerLock(ctx, task) : null
}

/** The lock, and when the Plan's lock is a late answer the planner still folds in, when it was sent. */
async function planGateLock(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
): Promise<{ locked: string | null; folding?: number }> {
  const locked = await approveLock(ctx, task, gate)
  if (locked === null || gate.target !== folderDoc("plan")) return { locked }
  const at = await lateAnswerAt(ctx, task)
  return at === null ? { locked } : { locked, folding: at }
}

/** How a finished task closed, for Home's list of shipped work. */
async function closedHow(ctx: Ctx, task: Task): Promise<string> {
  if (task.stage === "abandoned") return "closed without shipping"
  // The pull request's own end: merged closes the task, closed without a merge says so.
  const life = await readPullRequestRecord(ctx, task)
  if (life?.state === "merged")
    return life.number !== null ? `merged · PR #${life.number}` : "merged"
  if (life?.state === "closed") return "closed"
  const record = await readShipRecord(ctx, task)
  if (record?.choice === "pull-request" && record.url !== undefined) {
    const number = /\/pull\/(\d+)/.exec(record.url)?.[1]
    return number !== undefined ? `PR #${number}` : "pull request"
  }
  if (record?.choice === "commands") return "approved, pushed by you"
  return "approved"
}

/**
 * The approval chose a pull request and it is opening or open, but no read of it was kept yet (the
 * poll reads it within a minute): the address alone, as a record that was never read (`readAt` 0),
 * so the task stays in the open list from the click on instead of passing through Shipped.
 */
async function pullRequestOpening(ctx: Ctx, task: Task): Promise<PullRequestLife | null> {
  const ship = await readShipRecord(ctx, task)
  if (ship?.choice !== "pull-request" || (ship.state !== "opening" && ship.state !== "open"))
    return null
  const number = Number(/\/pull\/(\d+)\/?$/.exec(ship.url ?? "")?.[1] ?? Number.NaN)
  return {
    url: ship.url ?? "",
    number: Number.isFinite(number) ? number : null,
    state: "open",
    head: "",
    base: "",
    branch: task.branch ?? "",
    checks: [],
    threads: [],
    changesRequested: false,
    reviewers: [],
    stats: null,
    readAt: 0,
    followed: ghInstalled(ctx),
    waiting: {
      threads: 0,
      threadIds: [],
      failing: 0,
      changes: false,
      fixReady: false,
      left: false,
      since: null,
    },
  }
}

/** A shipped task's pull request as last read, when it has one: no `gh` call, only what the task keeps. */
async function pullRequestOfSummary(
  ctx: Ctx,
  task: Task,
): Promise<{ pullRequest?: PullRequestLife; waitingSince?: number }> {
  if (task.stage !== "shipped") return {}
  const life = (await pullRequestLife(ctx, task)) ?? (await pullRequestOpening(ctx, task))
  if (life === null) return {}
  // What waits on the person waits since it first showed on a read, not since the task began.
  const since = life.waiting.since
  return { pullRequest: life, ...(since !== null ? { waitingSince: since } : {}) }
}

/** The shipped tasks whose pull request is open (or never read yet), wherever their repository is: what the poll follows. */
export async function shippedWithOpenPullRequest(ctx: Ctx): Promise<{ id: string; task: Task }[]> {
  const found: { id: string; task: Task }[] = []
  for (const project of await listProjects(ctx)) {
    for (const task of await projectTasks(ctx, project)) {
      if (task.stage !== "shipped") continue
      const record = await readPullRequestRecord(ctx, task)
      if (record !== null && record.state === "open")
        found.push({ id: `${project.id}~${task.slug}`, task })
    }
  }
  return found
}

/** The shipped tasks, wherever their repository is: what the landing poll looks through. */
export async function shippedTasks(ctx: Ctx): Promise<{ id: string; task: Task }[]> {
  const found: { id: string; task: Task }[] = []
  for (const project of await listProjects(ctx))
    for (const task of await projectTasks(ctx, project))
      if (task.stage === "shipped") found.push({ id: `${project.id}~${task.slug}`, task })
  return found
}

/**
 * `items` are the task's items when the caller computed them already (the detail does); the list
 * counts them only for a task whose gate waits, the one place an item can be open today.
 */
/** An explicitly started build, including the time before its agent reports in. */
function buildRunLive(ctx: Ctx, id: string): boolean {
  return listRuns(ctx.home).some(
    (run) =>
      run.purpose.kind === "task" &&
      run.purpose.phase !== "planning" &&
      (run.task === id || run.purpose.task === id) &&
      (run.status === "starting" || run.status === "running" || run.status === "validated"),
  )
}

/** The recorded build choice as a summary carries it; nothing when none was made. */
function startChoice(start: Awaited<ReturnType<typeof readStart>>): Pick<TaskSummary, "start"> {
  if (start === null) return {}
  return {
    start: {
      where: start.where,
      agent: start.agent,
      at: start.at,
      ...(start.compact === true ? { compact: true } : {}),
      ...(start.session !== undefined ? { route: true } : {}),
    },
  }
}

async function summarise(
  ctx: Ctx,
  project: Project,
  task: Task,
  items?: Item[],
): Promise<TaskSummary> {
  const archived = await isArchived(ctx, task)
  const archivedAt = archived ? await readArchivedAt(ctx, task) : undefined
  const archive = { archived, ...(archivedAt !== undefined ? { archivedAt } : {}) }
  if (task.type === "chat") {
    const readme = await cachedFrontmatter(ctx, task)
    return {
      id: `${project.id}~${task.slug}`,
      project: project.id,
      projectName: project.name,
      slug: task.slug,
      title: task.title,
      request: typeof readme.request === "string" ? readme.request : task.title,
      type: "chat",
      files: [],
      verifyMode: null,
      answers: task.answers,
      approvals: approvalsOf(task),
      overrides: [],
      stage: task.stage,
      iterations: 0,
      created: task.created,
      dir: task.dir,
      gate: null,
      session: await readSession(ctx, task),
      checkout: task.repoRoot,
      progress: null,
      helpers: await activity(ctx, task),
      ...archive,
      branch: task.branch ?? null,
      action: null,
      waitingSince: null,
      closing: null,
      openItems: 0,
      needs: [],
      ...(isTerminal(task.stage) ? {} : { live: await liveReport(ctx, task) }),
    }
  }
  const gateFile: GateFile | null = await currentTaskGate(ctx, task)
  const reviewGate =
    gateFile !== null
      ? {
          id: gateFile.id,
          revision: gateFile.revision,
          targets: reviewTargets(gateFile.target, task),
          target: gateFile.target,
          opened: gateFile.opened,
          decision: gateFile.decision,
          settled: gateFile.settled === true,
          ...(gateFile.decided !== undefined ? { decided: gateFile.decided } : {}),
          ...(gateFile.by !== undefined ? { by: gateFile.by } : {}),
          ...(gateFile.asked !== undefined ? { asked: gateFile.asked } : {}),
          ...(gateFile.outside !== undefined
            ? {
                outside: {
                  via: gateFile.outside.via,
                  url: gateFile.outside.url,
                  login: gateFile.outside.login,
                },
              }
            : {}),
          ...(gateFile.approvedOn !== undefined ? { approvedOn: gateFile.approvedOn } : {}),
          ...(gateFile.approvedDuring !== undefined
            ? { approvedDuring: gateFile.approvedDuring }
            : {}),
          ...(await planGateLock(ctx, task, gateFile)),
          ...(gateFile.planReviewCoverage === "earlier" ? { reviewedBefore: true as const } : {}),
          ...(gateFile.planReviewCoverage === "unknown" ||
          (gateFile.planReviewCoverage === undefined && gateFile.reviewed !== undefined)
            ? { reviewInputUnknown: true as const }
            : {}),
          round:
            (await readDecided(ctx, task)).filter(
              (d) => d.target === gateFile.target && d.decision === "changes",
            ).length + 1,
        }
      : null
  const gate: TaskSummary["gate"] = reviewGate
  const session = await readSession(ctx, task)
  const readme = await cachedFrontmatter(ctx, task)
  const handback = await readHandback(ctx, task)

  let taskProgress: TaskSummary["progress"] = null
  const outline = await docCache.read(ctx, cardsPath(task.dir), "cards", parseOutline)
  if (outline !== null) {
    const { total, checked } = progress(outline)
    taskProgress = { total, checked, slices: outline.slices.length }
  }

  const verifyMode = await readVerifyMode(ctx, task)
  const pending = reviewGate !== null && reviewGate.decision === "pending" && !reviewGate.settled
  // Approved, and no build started: the user's move is the Implement prompt, until a build session
  // takes it.
  const awaitingImplement =
    task.stage === "implement" &&
    !(await ctx.fs.exists(implementLogPath(task))) &&
    (await readBuildLead(ctx, task)) === null &&
    // A build started in the App is not the person's move while its agent boots and before it
    // reports in: the task is running, not waiting on Home's Your turn.
    !buildRunLive(ctx, `${project.id}~${task.slug}`)
  let action: TaskSummary["action"] = null
  if (pending)
    action = reviewGate.target === "final" ? "final" : reviewGate.locked ? null : "review"
  else if (awaitingImplement) action = "implement"

  let closing: TaskSummary["closing"] = null
  if (isTerminal(task.stage)) {
    const fm = (await cachedDoc(ctx, readmePath(task)))?.frontmatter ?? {}
    closing = {
      shipped: fm.shipped != null ? String(fm.shipped) : null,
      slices: typeof fm.slices === "number" ? fm.slices : 0,
      firstPass: task.iterations <= 1,
      touched: Array.isArray(fm.touched) ? fm.touched.map(String) : [],
      how: await closedHow(ctx, task),
    }
    const pass = task.stage === "shipped" ? await readClosedPass(ctx, task) : null
    if (pass !== null) closing.pass = pass
  }

  const allWaiting =
    items ?? (pending || task.stage === "plan" ? await taskItems(ctx, task, gateFile) : [])
  // Per-point answers settle a group without another group-level answer.
  const waiting = allWaiting.filter(
    (i) => !(i.children !== undefined && openCount(i.children) === 0),
  )
  // The Plan's batch is the current human turn. Its framing items are folded back to the agent
  // after the last answer, including in a fresh App that has no local turn projection yet.
  const batch = task.stage === "plan" && !pending ? await readBatch(ctx, task) : null

  return {
    id: `${project.id}~${task.slug}`,
    project: project.id,
    projectName: project.name,
    slug: task.slug,
    title: task.title,
    request: typeof readme.request === "string" ? readme.request : task.title,
    type: task.type,
    ...(await adoptionSummary(ctx, task)),
    ...(isCurrentLayout(task) ? {} : { earlier: true as const }),
    files: await filesOf(ctx, task, project.name),
    answers: task.answers,
    approvals: approvalsOf(task),
    overrides: task.overrides,
    stage: task.stage,
    iterations: task.iterations,
    created: task.created,
    dir: task.dir,
    gate,
    session,
    checkout: task.repoRoot,
    progress: taskProgress,
    helpers: await activity(ctx, task),
    ...archive,
    branch: task.branch ?? null,
    verifyMode,
    action,
    waitingSince: pending ? reviewGate.opened : action !== null ? (session?.since ?? null) : null,
    closing,
    ...(await pullRequestOfSummary(ctx, task)),
    ...(task.stage === "shipped" ? { landing: await landingView(ctx, task) } : {}),
    ...(handback !== null
      ? { handedBack: { reason: handback.reason, prompt: handback.prompt, words: handback.words } }
      : {}),
    // Between the approval and the build's start, the row says who builds next.
    ...(action === "implement" ? startChoice(await readStart(ctx, task)) : {}),
    // A gate that waits, or a planning step still open, can hold items; the other steps hold none the list needs.
    openItems: batch?.questions.length ?? openCount(waiting),
    needs: batch ? [] : needsOf(waiting),
    ...(batch ? { batch: await batchStrip(ctx, task) } : {}),
    ...(isTerminal(task.stage) ? {} : { live: await liveReport(ctx, task) }),
  }
}

/** Tell me more is with the agent: taken by a waiting `ask`, not cancelled, no answer found yet. */
const lookingInto = (question: Question): boolean =>
  question.more?.taken !== undefined && question.more.cancelled === undefined

/** The live part of a task: read every poll, so only small files, a stat and a process check. */
async function liveReport(ctx: Ctx, task: Task): Promise<LiveReport> {
  let question = await openQuestion(ctx, task).catch(() => null)
  if (task.stage === "plan" && question?.gate === folderDoc("plan") && question.item === undefined)
    question = null
  const progress = await readBuildProgress(ctx, task).catch(() => null)
  return {
    signals: await readLive(ctx, task).catch(() => null),
    backgroundRunning: await readBackground(ctx, task).catch(() => false),
    progress: progress !== null ? { ...progress, words: progressWords(progress) } : null,
    needs: await readNeeds(ctx, task),
    refusal: await readRefusal(ctx, task),
    question:
      question !== null
        ? {
            number: question.number,
            text: question.question,
            ahead: questionsAhead(question) ?? null,
            gate: question.gate ?? null,
            ...(question.settles ? { settles: question.settles } : {}),
            front: question.front === true,
            stopped: question.stopped?.at ?? null,
            looking: lookingInto(question),
          }
        : null,
  }
}

/** The person's "Done, it's set" for a need of the build, with an optional note that is never a key. */
export async function postNeedSet(ctx: Ctx, id: string, need: string, body: unknown) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const note =
    typeof (body as { note?: unknown })?.note === "string" ? (body as { note: string }).note : ""
  const set = await markSet(ctx, found.data.task, need, note)
  return set.ok ? ok({ need: set.data }) : set
}

/** Where a decision made outside the App was made: the agent the task's session runs in. */
async function decidedElsewhereOf(
  ctx: Ctx,
  task: Task,
  gate: GateFile | null,
): Promise<DecidedElsewhere | undefined> {
  if (gate === null || gate.decision === "pending" || gate.by === "cockpit") return undefined
  const decision = gate.decision === "approved" ? "approved" : "changes"
  const targets = reviewTargets(gate.target, task)
  const kept = (await readComments(ctx, task)).filter(
    (c) =>
      c.delivered !== true &&
      c.build === undefined &&
      c.source === undefined &&
      targets.includes(c.doc),
  )
  // An approval that left no answer unsent has nothing to say; changes sent from the agent's window always do.
  if (kept.length === 0 && decision === "approved") return undefined
  const session = await readSession(ctx, task)
  return {
    decision,
    by: gate.by ?? "chat",
    where: session !== null ? agentEntry(session.agent).name : "your agent",
    at: gate.decided ?? gate.opened,
    drafts: kept.length,
  }
}

export async function listAllTasks(ctx: Ctx, projectId?: string): Promise<TaskSummary[]> {
  const summaries: TaskSummary[] = []
  for (const project of await listProjects(ctx)) {
    if (projectId !== undefined && projectId !== "" && project.id !== projectId) continue
    for (const task of await projectTasks(ctx, project)) {
      try {
        summaries.push(await summarise(ctx, project, task))
      } catch (error) {
        // One task that cannot be summarised leaves the list without it, never the whole list.
        taskBroken(ctx, task.dir, error)
      }
    }
  }
  return summaries.sort((a, b) => b.created - a.created)
}

/** Status does not need the step documents' bodies, evidence, diffs or cost history. */
export async function taskSummary(ctx: Ctx, id: string): Promise<Result<TaskSummary>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  return ok(await summarise(ctx, found.data.project, found.data.task))
}

export async function locate(
  ctx: Ctx,
  id: string,
): Promise<Result<{ project: Project; task: Task }>> {
  const [projectId, slug] = id.split("~")
  const project = (await listProjects(ctx)).find((p) => p.id === projectId)
  if (project === undefined || slug === undefined) {
    return err({ code: "no_task", message: `unknown task "${id}"` })
  }
  // A URL names one task. Reading the whole inventory in every checkout first delayed even a
  // tiny Plan page; only Home needs that inventory.
  if (slug === "" || slug === "." || slug === ".." || /[\\/\0]/.test(slug))
    return err({ code: "no_task", message: `unknown task "${id}"` })
  let unreadable: unknown = null
  const copies = (
    await Promise.all(
      project.paths.map(async (root) => {
        if (!(await ctx.fs.exists(root))) return null
        try {
          return await loadTask(ctx, { root, id: project.id, commonDir: "" }, slug, true)
        } catch (error) {
          // A folder whose front matter cannot be used is a broken task, not an unknown one.
          if (!(error instanceof TaskUnreadable)) throw error
          unreadable = error
          return null
        }
      }),
    )
  ).filter((t): t is Task => t !== null)
  const session = copies[0] !== undefined ? await readSession(ctx, copies[0]) : null
  let task =
    copies.find((t) => t.repoRoot === session?.checkout) ??
    copies.sort((a, b) => stageRank(b.stage) - stageRank(a.stage))[0]
  if (task === undefined && unreadable !== null) {
    taskBroken(ctx, slug, unreadable)
    return err({ code: "task_unreadable", message: "This task cannot be read." })
  }
  if (task === undefined) task = (await projectTasks(ctx, project)).find((t) => t.slug === slug)
  if (task === undefined) return err({ code: "no_task", message: `unknown task "${id}"` })
  return ok({ project, task })
}

/** The documents a task's sidebar lists: one per step, each holding its working sections. */
function docList(): [string, string][] {
  return [
    [folderDoc("plan"), "Plan"],
    [folderDoc("implement"), "Implement"],
    [folderDoc("verify"), "Verify"],
  ]
}

async function taskDocs(ctx: Ctx, task: Task): Promise<DocEntry[]> {
  if (!isCurrentLayout(task)) return earlierDocs(ctx, task)
  const docs: DocEntry[] = []
  for (const [name, label] of docList()) {
    const path = join(task.dir, name)
    const parsed = await cachedDoc(ctx, path)
    const exists = parsed !== null
    const fm = parsed?.frontmatter ?? {}
    const added = parsed !== null ? addedBlocks(parsed.body) : []
    const approved =
      fm.approved === true && (isTerminal(task.stage) || (await approvalCurrent(ctx, task, name)))
    docs.push({
      name,
      label,
      exists,
      status:
        fm.approved === true && !approved
          ? "needs review"
          : typeof fm.status === "string"
            ? fm.status
            : "",
      approved,
      ...(added.length > 0 ? { added: added.map(({ stage, reason }) => ({ stage, reason })) } : {}),
    })
  }
  return docs
}

function currentTaskGate(ctx: Ctx, task: Task) {
  return isCurrentLayout(task) ? readGate(ctx, task) : null
}

const NUMBERED_DOC_NAME = /^\d{2}-([a-z-]+)\.md$/
const EARLIER_AGENT_NAME = /^agents?\/\d{2}-[a-z-]+\.md$/

const SEVEN_STEP_DOCS = [
  "01-discuss.md",
  "02-research.md",
  "03-plan.md",
  "04-outline.md",
  "05-implement.md",
  "06-verify.md",
  "07-review.md",
]

// The historical layouts used fixed names. Probe them through the document guard without walking
// the folder or its optional agent directories.
const EARLIER_DOCS = [
  ...SEVEN_STEP_DOCS,
  ...Object.values(NAMES),
  ...SEVEN_STEP_DOCS.map((name) => `${AGENTS_DIR}/${name}`),
  "00-discuss.md",
  "00-discuss-details.md",
  "01-diagnosis.md",
  "01-discuss-details.md",
  "01-discuss-diagnosis.md",
  "01-discuss-research.md",
  "01-research.md",
  "02-plan.md",
  "02-plan-details.md",
  "03-build.md",
  "03-build-details.md",
  "03-implement.md",
  "03-implement-details.md",
  "04-verify.md",
  "05-review.md",
  "agent/01-discuss-details.md",
  "agent/01-discuss-diagnosis.md",
  "agent/01-discuss-research.md",
  "agent/02-plan-details.md",
  "agent/03-implement-details.md",
].sort((left, right) => left.localeCompare(right, "en"))

async function earlierDocs(ctx: Ctx, task: Task): Promise<DocEntry[]> {
  const safe = publicationContext(ctx, task)
  const docs: DocEntry[] = []
  for (const name of EARLIER_DOCS) {
    const path = join(task.dir, name)
    try {
      if (safe.fs.readRegularFile) await safe.fs.readRegularFile(path, ORIGINAL_MAX_BYTES)
      else if (!(await safe.fs.exists(path))) continue
    } catch {
      continue
    }
    const title = basename(name)
      .slice(3, -3)
      .replaceAll("-", " ")
      .replace(/^./, (c) => c.toUpperCase())
    docs.push({
      name,
      label: name.includes("/") ? `${title} · agents` : title,
      exists: true,
      status: "",
      approved: false,
    })
  }
  return docs
}

/** The task's files, one per role in flow order, so the App takes every name and path from here. */
async function filesOf(ctx: Ctx, task: Task, projectName: string): Promise<TaskFile[]> {
  const present = new Set<DocRole>()
  for (const role of taskRoles(task.type))
    if (await ctx.fs.exists(taskDocPath(task, role))) present.add(role)
  return taskFiles(projectName, task.slug, task.type, (role) => present.has(role))
}

const EVIDENCE_NAME = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/

async function listNames(ctx: Ctx, dir: string): Promise<string[]> {
  if (!(await ctx.fs.exists(dir))) return []
  try {
    return await filesIn(ctx.fs, dir)
  } catch {
    return []
  }
}

/** The start card's reason for a worktree: read only until the build has started in the checkout. */
async function startCheckoutBusy(
  ctx: Ctx,
  task: Task,
): Promise<{ checkoutBusy?: CheckoutBusy | null }> {
  if (!["plan", "implement"].includes(task.stage)) return {}
  if ((await readBuildStart(ctx, task)) !== null) return {}
  return { checkoutBusy: await checkoutBusy(ctx, task) }
}

export async function taskDetail(
  ctx: Ctx,
  id: string,
  /** `shown`: a page asked, so an open final gate counts as on a screen (gate.shown). */
  options: { proofFiles?: boolean; shown?: boolean } = {},
): Promise<Result<TaskDetail>> {
  try {
    return await readTaskDetail(ctx, id, options)
  } catch (error) {
    taskBroken(ctx, id.split("~")[1] ?? id, error)
    return err({ code: "task_unreadable", message: "This task cannot be read." })
  }
}

async function readTaskDetail(
  ctx: Ctx,
  id: string,
  options: { proofFiles?: boolean; shown?: boolean },
): Promise<Result<TaskDetail>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { project, task } = found.data
  if (task.type === "chat") {
    const outside = isTerminal(task.stage) ? null : await outsideLead(ctx, task)
    const chatDocs = await chatDocuments(ctx, task)
    return ok({
      ...(await summarise(ctx, project, task)),
      ...(outside === null ? {} : { outside }),
      slices: [],
      timeline: null,
      buildLog: null,
      quality: [],
      flow: null,
      implementStart: null,
      docs: [
        {
          name: folderDoc("plan"),
          label: "Chat",
          exists: true,
          status: "task",
          approved: false,
        },
        ...Object.values(chatDocs).map((doc) => ({
          name: doc.name,
          label: doc.name === "chat-plan.md" ? "Chat plan" : "Chat slices",
          exists: doc.exists,
          status: "",
          approved: false,
        })),
      ],
      comments: [],
      events: (await readEvents(ctx, task)).slice(-200),
      prDescription: null,
      verification: [],
      showMe: [],
      evidence: [],
      review: null,
      me: await profileOf(ctx),
      items: [],
      parts: {},
      checked: { discuss: [], plan: [] },
      pages: [],
    })
  }
  const docs = await taskDocs(ctx, task)

  const record = await readBuildRecord(ctx, task)
  const verification: TaskDetail["verification"] = record.verification.map((i) => ({
    n: i.n,
    result: i.result,
    judge: i.judge,
    verdicts: i.verdicts.map(({ verdict, kind, subject, text }) => ({
      verdict,
      kind,
      subject,
      text,
    })),
  }))

  const flowed = await taskFlow(ctx, task)
  const outline: Outline | null = flowed.plan
  const cachedLog = await cachedBuildLog(ctx, task)
  const logText = cachedLog?.text ?? null
  const parsedLog = cachedLog?.log ?? null
  const slices: BuildSlice[] = (outline?.slices ?? []).map((s) => ({
    n: s.n,
    title: s.title,
    validation: s.validation,
    tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, checked: t.checked })),
  }))

  const buildLog: TaskDetail["buildLog"] =
    parsedLog !== null ? { deviations: parsedLog.deviations } : null

  // The same prompt the CLI prints at the Implement stop, for each agent.
  let implementStart: ImplementStart | null = null
  // Before the build session writes the Outline, the Plan's Size line says how big the build is.
  const planPath = taskDocPath(task, "plan")
  const planned =
    outline === null && task.stage !== "plan" && (await ctx.fs.exists(planPath))
      ? plannedSizeOf(await ctx.fs.readFile(planPath))
      : null
  if ((outline !== null || planned !== null) && flowed !== null && task.stage !== "plan") {
    const size =
      outline !== null
        ? { slices: outline.slices.length, tasks: progress(outline).total }
        : { slices: planned?.slices ?? 0, tasks: planned?.tasks ?? 0, planned: true }
    const agents: ImplementOption[] = []
    for (const agent of IMPLEMENT_AGENTS) {
      const start = implementPrompt(task, agent, flowed.line, size)
      agents.push({
        agent: agent === "unknown" ? "other" : agent,
        name: agent === "unknown" ? "Other agent" : agentEntry(agent).name,
        prompt: start.prompt,
        advice: start.advice,
      })
    }
    implementStart = {
      slices: size.slices,
      tasks: size.tasks,
      agents,
      flowLine: flowed.line,
    }
  }

  const showMe = (await listNames(ctx, join(task.dir, "artifacts")))
    .filter((name) => name.startsWith("show-me-") && name.endsWith(".html"))
    .map((name) => ({
      name,
      title: name
        .replace(/^show-me-/, "")
        .replace(/\.html$/, "")
        .replaceAll("-", " "),
    }))
  const evidence = (await filesIn(ctx.fs, join(task.dir, "evidence"), true)).filter((name) =>
    EVIDENCE_NAME.test(name),
  )
  // A task's raw command output, for the Files tab's Records row (records/ beside evidence/).
  const records = await filesIn(ctx.fs, join(task.dir, RECORDS_DIR), true)
  // The agents' own files (agents/NN-step.md): the same row counts them, so people know the folder is there.
  const agents = isCurrentLayout(task)
    ? await filesIn(ctx.fs, join(task.dir, AGENTS_DIR), true)
    : docs
        .filter(({ name }) => name.startsWith(`${AGENTS_DIR}/`))
        .map(({ name }) => name.slice(AGENTS_DIR.length + 1))
  // The Plan's agents' file, a regular file only: the Files tab folds it under Build context.
  const support = await planSupport(ctx, task)

  const prPath = descriptionPath(task)
  // A shipped task's pull request is read first: the summary below says what waits from what this read keeps.
  const shippedPr = task.stage === "shipped" ? await cachedPullRequest(ctx, task) : null
  // The parts that do not need each other are read side by side.
  // Verify turned to the person: the final approval is theirs to give.
  const reviewing = isCurrentLayout(task) && (await inPersonReview(ctx, task))
  const gateFile = reviewing ? await ensureFinalReview(ctx, task) : await currentTaskGate(ctx, task)
  const hasVerification = ["verify", "shipped"].includes(task.stage)
  const checkedSource =
    task.stage === "verify" || gateFile?.finalReview?.code ? await readAssignment(ctx, task) : null
  if (options.shown === true && gateFile?.target === FINAL && gateFile.shown === undefined)
    await markGateShown(ctx, task)
  const [
    { summary, items, parts, checked },
    timelineView,
    comments,
    events,
    prDescription,
    review,
    decidedElsewhere,
    planDiff,
    changedFiles,
  ] = await Promise.all([
    taskPage(ctx, task, gateFile).then(async (found) => ({
      items: found.items,
      parts: found.parts,
      checked: found.checked,
      summary: await summarise(ctx, project, task, found.items),
    })),
    outline !== null ? timeline(ctx, task, outline, logText ?? "") : null,
    Promise.all([readComments(ctx, task), readTeamComments(ctx, task), readReview(ctx, task)]).then(
      ([own, team, review]) => [
        ...own,
        ...team.filter((c) => !isStructured(c)).map(asComment),
        // The team's review threads on the change join the comments the panel lists.
        ...reviewComments(review),
      ],
    ),
    readEvents(ctx, task).then((all) => all.slice(-200)),
    ctx.fs.exists(prPath).then((there) => (there ? ctx.fs.readFile(prPath) : null)),
    reviewOf(ctx, task, record, evidence, {
      withChanges: false,
      pullRequest: cachedPullRequest,
    }),
    decidedElsewhereOf(ctx, task, gateFile),
    planChanges(ctx, task),
    (async () => {
      // Proof links belong to Verify. Reading hundreds of dirty encrypted files must
      // not hold the task shell or its independent native terminal behind a Git scan.
      const needed = options.proofFiles ?? ["verify", "shipped"].includes(task.stage)
      if (!needed) return null
      const base = await buildBase(ctx, task)
      if (base === null) return null
      // File links need names, not decrypted patches or line counts for every binary blob.
      return changedPaths(ctx, task.repoRoot, base, {
        since: await buildBegan(ctx, task),
      })
    })(),
  ])
  const gate = summary.gate
  const outside = isTerminal(task.stage) ? null : await outsideLead(ctx, task)
  // Also between the approval and the build's start, so the page says which session builds next.
  const start =
    outside === null && summary.action !== "implement" ? null : await readStart(ctx, task)
  const plannedIn = await plannedPlace(ctx, task)
  const builtIn = await builtPlace(ctx, task)
  return ok({
    ...summary,
    planningStart: await readPlanningStart(ctx, task),
    ...(outside === null ? {} : { outside }),
    ...startChoice(start),
    ...(plannedIn === null ? {} : { planned: plannedIn }),
    ...(builtIn === null ? {} : { built: builtIn }),
    viewingEligible: (await claimedByOthers(ctx, task.repoId, null)).has(task.slug),
    ...((await usesGitCrypt(ctx, task.repoRoot)) ? { gitCrypt: true } : {}),
    ...(gate !== null ? { gate } : {}),
    checkProgress: await readCheckProgress(ctx, task),
    taskProgress: await buildLine(ctx, task),
    reusedChecks: [
      ...new Map(
        (await readCheckRecords(ctx, task))
          .filter((r) => r.scope !== "base")
          .map((r) => [r.command, r]),
      ).values(),
    ]
      .filter((r) => r.reused && r.exit === 0)
      .map((r) => r.command),
    ...(await (async () => {
      const required = await requiredViewIfTaken(ctx, task)
      return required === null ? {} : { required }
    })()),
    items,
    parts,
    checked,
    question: gateFile?.finalReview ? null : await openQuestion(ctx, task),
    answeredQuestions: await answeredQuestions(ctx, task),
    questionWait: await readHeartbeat(ctx, task),
    ...(planDiff !== null ? { planDiff } : {}),
    ...(decidedElsewhere !== undefined ? { decidedElsewhere } : {}),
    ...(gateFile?.finalReview?.code
      ? {
          reviewEvidence: {
            // The one answer `next`, Approve and `gate open final` read, so the page cannot disagree.
            current: (await reviewStanding(ctx, task)).passStands,
            currentCode: gateFile.finalReview.code,
            checkedCode: checkedSource?.revision ?? null,
          },
        }
      : {}),
    slices,
    // From the outline on: the plan view reads it before the build, the build views after.
    timeline: timelineView,
    changedFiles,
    // What the agents found on lines of the change, and the reviewer asked from the workspace.
    ...(reviewing || task.stage === "shipped"
      ? await (async () => ({
          findings: await lineFindings(ctx, task, changedFiles ?? []),
          anotherReviews: (await readAnotherRuns(ctx, task)).map(
            ({ findings: _f, pid: _p, ...run }) => run,
          ),
        }))()
      : {}),
    buildLog,
    // Verify's stages keep their results after the checks: while the person reviews and once shipped.
    ...(hasVerification
      ? {
          verifyLanes: await servedVerifyLanes(ctx, task),
          verifyActivity: await readVerifyActivity(
            ctx,
            task,
            outside?.sessionId ?? summary.live?.signals?.sessionId ?? null,
            events,
            checkedSource?.head,
          ),
        }
      : {}),
    checklist: hasVerification
      ? await readChecklist(ctx, task, { helpers: summary.helpers })
      : null,
    quality:
      flowed !== null
        ? await qualityRowsFor(
            ctx,
            task,
            passRoles(flowed.flow),
            summary.helpers.map((h) => h.id),
          )
        : [],
    flow:
      outline !== null || task.stage === "implement" || gate?.target === folderDoc("plan")
        ? flowed.flow
        : null,
    intake: await intakeOf(ctx, task),
    implementStart,
    ...(await startCheckoutBusy(ctx, task)),
    docs,
    // What the team said sits beside the owner's drafts; the Cockpit's draft saving never rewrites it.
    comments,
    answering: await answering(ctx, task, comments),
    events,
    prDescription,
    verification,
    showMe,
    evidence,
    records,
    agents,
    ...(support !== null ? { support } : {}),
    review,
    ...(reviewing &&
    gateFile?.target === FINAL &&
    gateFile.decision === "pending" &&
    !review?.approve
      ? { reviewApproval: await approveChoices(ctx, task, await currentBranch(ctx, task.repoRoot)) }
      : {}),
    changesRequested: await changesRequested(ctx, task, gateFile),
    ...(task.stage === "shipped"
      ? {
          shipped: await (async () => {
            const total = (await taskCost(ctx, task)).total
            return shippedFacts(ctx, task, {
              pr: shippedPr,
              usd: total.usd,
              // Part of the usage has no list price (often a Codex session): the figure is not all of it.
              unpriced: total.usd === null || (total.unpriced ?? []).some((row) => row.tokens > 0),
            })
          })(),
        }
      : {}),
    me: await profileOf(ctx),
    pages: await stepPages(ctx, task),
  })
}

/** After an answer or a decision in the App: the task's documents show it. */
export async function refreshTaskPages(ctx: Ctx, id: string): Promise<void> {
  const found = await locate(ctx, id)
  if (found.ok) await refreshPages(ctx, found.data.task)
}

export async function postViewing(ctx: Ctx, id: string, body: unknown) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  return isCurrentLayout(found.data.task) ? writeViewing(ctx, found.data.task, body) : ok({})
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}
const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024

/** What a task cost so far, from the agents' transcripts on this machine: per step, per helper, in total. */
export async function taskCostOf(ctx: Ctx, id: string): Promise<Result<TaskCost>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const cost = await taskCost(ctx, found.data.task)
  const warning = await taskTokenWarning(ctx, found.data.task, cost).catch(() => null)
  return ok(warning === null ? cost : { ...cost, tokenWarning: warning })
}

export type Evidence =
  | { name: string; kind: "image"; type: string; base64: string }
  | { name: string; kind: "text"; text: string }

/**
 * One evidence file: an image as base64 (shown as a data: URL, never as a
 * page), anything else as text. Names are relative file paths under evidence/.
 */
export async function evidenceContent(
  ctx: Ctx,
  id: string,
  name: string,
): Promise<Result<Evidence>> {
  try {
    return await readEvidence(ctx, id, name)
  } catch (cause) {
    return err({
      code: "bad_args",
      message: `Cannot read evidence/${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}

async function readEvidence(ctx: Ctx, id: string, name: string): Promise<Result<Evidence>> {
  if (!EVIDENCE_NAME.test(name)) {
    return err({ code: "bad_args", message: `"${name}" is not an evidence file` })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const path = join(found.data.task.dir, "evidence", name)
  if (!(await ctx.fs.exists(path))) {
    return err({ code: "no_task", message: `evidence/${name} does not exist` })
  }
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  const type = IMAGE_TYPES[extension]
  if (type !== undefined) {
    if (ctx.fs.readBytes === undefined) {
      return err({ code: "bad_args", message: "this server cannot read binary evidence" })
    }
    const bytes = await ctx.fs.readBytes(path)
    if (bytes.byteLength > EVIDENCE_MAX_BYTES) {
      return err({ code: "bad_args", message: `evidence/${name} is larger than 4 MB` })
    }
    return ok({ name, kind: "image", type, base64: Buffer.from(bytes).toString("base64") })
  }
  const text = await ctx.fs.readFile(path)
  return ok({ name, kind: "text", text: text.slice(0, 200_000) })
}

const DOC_NAME = /^(?:\d{2}-[a-z-]+|chat-plan|chat-slices|original-plan)\.md$/
/** The other agents' reviews of a task, read-only: the Plan review and the second opinion. */
const REVIEW_NAME = /^reviews\/(?:plan|outline|verify)\.md$/
/** A step's agents' file, read-only. */
const AGENT_NAME = /^agents\/\d{2}-[a-z-]+\.md$/

export async function docContent(ctx: Ctx, id: string, name: string) {
  const earlierAgent = EARLIER_AGENT_NAME.test(name)
  if (!DOC_NAME.test(name) && !REVIEW_NAME.test(name) && !earlierAgent)
    return err({ code: "bad_args", message: `"${name}" is not a task document` })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  if (isCurrentLayout(task) && name.startsWith("agent/"))
    return err({ code: "bad_args", message: `"${name}" is not a task document` })
  return readDocument(ctx, task, name)
}

async function readDocument(ctx: Ctx, task: Task, name: string) {
  if (name === "original-plan.md" && task.origin !== "existing-plan")
    return err({ code: "no_task", message: "This task has no original plan." })
  if (name === "chat-plan.md" || name === "chat-slices.md" || name === "original-plan.md")
    ctx = publicationContext(ctx, task)
  const archivedDoc =
    !isCurrentLayout(task) && (NUMBERED_DOC_NAME.test(name) || EARLIER_AGENT_NAME.test(name))
  const regular = archivedDoc || name === "original-plan.md" || AGENT_NAME.test(name)
  const path = join(task.dir, name)
  let markdown: string
  try {
    if (archivedDoc) ctx = publicationContext(ctx, task)
    if (!(await ctx.fs.exists(path)))
      return err({ code: "no_task", message: `${name} does not exist yet` })
    // The original and the agent-written build context are read as regular files only.
    markdown =
      regular && ctx.fs.readRegularFile
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            await ctx.fs.readRegularFile(path, ORIGINAL_MAX_BYTES),
          )
        : await ctx.fs.readFile(path)
  } catch {
    return err({ code: "no_task", message: `${name} is missing or outside the task` })
  }
  const report = regular
    ? null
    : await validateDoc(ctx, task.dir, name, { runtimeDir: task.runtimeDir })
  return ok({
    name,
    markdown,
    validation:
      report === null
        ? { valid: true, doc: name, errors: [] }
        : report.ok
          ? report.data
          : { valid: false, doc: name, errors: [] },
  })
}

export async function postChatPromote(ctx: Ctx, id: string, input: unknown) {
  const type = (input as { type?: unknown } | null)?.type
  const fromSavedPlan = (input as { fromSavedPlan?: unknown } | null)?.fromSavedPlan
  if (fromSavedPlan !== undefined && typeof fromSavedPlan !== "boolean")
    return err({ code: "bad_args", message: "fromSavedPlan must be true or false" })
  if (type !== "feature" && type !== "bugfix")
    return err({ code: "bad_args", message: "Choose feature or bugfix" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const refused = await refuseArchived(ctx, found.data.task, "starting the workflow")
  if (!refused.ok) return refused
  return promoteChat(ctx, found.data.task, type, { fromSavedPlan })
}

export async function chatPromotionState(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const current = await currentChat(ctx, found.data.task)
  const active = current ? await activeChatHelpers(ctx, current) : []
  return ok({
    allowed: current !== null && active.length === 0,
    running: active,
  })
}

/**
 * Open a file of the task in its editor, or show it in the file manager: only files inside its folder.
 * `how: "editor"` opens a file or folder of the task's checkout (`.` is the checkout) in the `editor`
 * the request names, one of the places Settings › Git and editor lists.
 */
export async function openTaskFile(
  ctx: Ctx,
  id: string,
  input: Record<string, unknown>,
  opener: Opener,
): Promise<Result<Record<string, never>>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  return input.how === "editor"
    ? openInEditor(found.data.task, input.editor, input.file, opener)
    : openTaskDocument(found.data.task, input, opener)
}

async function openTaskDocument(
  task: Task,
  input: Record<string, unknown>,
  opener: Opener,
): Promise<Result<Record<string, never>>> {
  const path = await openablePath(task, input.file, input.how)
  if (!path.ok) return path
  return openFile(input.how as OpenHow, path.data, opener.platform, opener.run)
}

/** Raw HTML of a committed artifact. The SPA mounts it in a sandboxed frame; it is never served as a page. */
/** A show-me page's file name, as `showMeName` makes it. */
const SHOW_ME_NAME = /^show-me-[a-z0-9-]+\.html$/

export async function artifactContent(
  ctx: Ctx,
  id: string,
  name: string,
): Promise<Result<{ html: string }>> {
  // An artifact names its folder (`artifacts/<name>.html`); a show-me page is named alone and kept in
  // `artifacts/` (`show-me-<topic>.html`).
  const resolved = name.startsWith("artifacts/")
    ? artifactPath({ kind: "artifact", lang: "artifact", body: name, line: 0, endLine: 0 })
    : SHOW_ME_NAME.test(name)
      ? { path: `${SHOW_ME_PAGES}/${name}` }
      : { error: "not a show-me page" }
  if ("error" in resolved) {
    return err({ code: "bad_args", message: `"${name}" is not an artifact of this task` })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const path = join(found.data.task.dir, resolved.path)
  if (!(await ctx.fs.exists(path)))
    return err({ code: "no_task", message: `${resolved.path} does not exist` })
  return ok({ html: await ctx.fs.readFile(path) })
}

export type TaskChanges = Omit<Changes, "files"> & {
  files: (Omit<Changes["files"][number], "additions" | "deletions"> &
    Pick<WalkFile, "parts" | "current" | "stamp" | "additions" | "deletions">)[]
  review?: Awaited<ReturnType<typeof reviewChangesOf>>
}

export async function taskChanges(
  ctx: Ctx,
  id: string,
  options: { withDiff?: boolean } = {},
): Promise<Result<TaskChanges>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const scoped = await workflowProjection(ctx, task, {
    metadata: options.withDiff === false,
    browse: true,
  })
  if (!scoped.ok) return scoped
  const diff = workflowChangesView(scoped.data)
  return ok({
    ...diff,
    ...(!scoped.data.history &&
    (task.stage === "shipped" || (await inPersonReview(ctx, task))) &&
    measuredChanges(diff)
      ? { review: await reviewChangesOf(ctx, task, diff) }
      : {}),
  })
}

function measuredChanges(
  value: Changes | ReturnType<typeof workflowChangesView>,
): value is Changes {
  return value.files.every((file) => file.additions !== null && file.deletions !== null)
}

/** When the build began: the handoff marker's `shown` time. A task without a marker has no such moment. */
async function buildBegan(ctx: Ctx, task: Task): Promise<number | undefined> {
  try {
    const marker = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, "handoff.json")))
    return typeof marker.shown === "number" ? marker.shown : undefined
  } catch {
    return undefined
  }
}

export async function taskFileDiff(
  ctx: Ctx,
  id: string,
  path: string,
  continuation: { after?: string; revision?: string } = {},
): Promise<Result<{ diff: string; revision?: string; next?: string }>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const scoped = await workflowProjection(ctx, task, {
    page: { path, ...continuation },
    browse: true,
  })
  if (!scoped.ok) return scoped
  const page = scoped.data.page
  return page === undefined
    ? err({ code: "bad_args", message: "This path is not part of this task’s change." })
    : ok(page)
}

/** A task's change top to bottom, as the Review page draws it; each file's diff loads as above. */
export async function taskWalkthrough(ctx: Ctx, id: string): Promise<Result<Walkthrough>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const scoped = await workflowProjection(ctx, task, { metadata: true, browse: true })
  if (!scoped.ok) return scoped
  const state = await pageState(ctx, task)
  const view =
    state.walkthrough ??
    (await readWalkthrough(ctx, task, {
      sources: state,
      ...(scoped.data.history ? { byTask: null } : {}),
    }))
  return ok(scopeWalkthrough(view, scoped.data))
}

export async function clearTaskChanges(ctx: Ctx, id: string): Promise<Result<{ cleared: true }>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  try {
    await clearWorkingRecords(ctx, found.data.task)
    forgetWorkingPatches(found.data.task)
    return ok({ cleared: true })
  } catch {
    return err({
      code: "bad_args",
      message: "Saved change history could not be cleared. Try again.",
    })
  }
}

export async function taskReviewFileSource(
  ctx: Ctx,
  id: string,
  request: SourceRequest,
): Promise<Result<ReviewFileSource>> {
  const git = ctx.git
  ctx = {
    ...ctx,
    git: { ...git, run: (cwd, args, options) => git.run(cwd, args, { ...options, fresh: true }) },
  }
  if (!request.path || !request.stamp || !["old", "new"].includes(request.side))
    return err({
      code: "bad_args",
      message: "Expected a file path, revision stamp and old or new side.",
    })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  return workflowReviewSource(ctx, found.data.task, request)
}

/** The documents a comment can be on: the files that take comments, the final review and the build view. */
function knownDoc(doc: string): boolean {
  return doc === "final" || doc === BUILD_VIEW || COMMENTABLE_FILES.includes(doc)
}

export type CommentsBody = { doc?: unknown; comments?: unknown }

export async function putComments(
  ctx: Ctx,
  id: string,
  body: CommentsBody,
): Promise<Result<{ comments: Comment[] }>> {
  if (typeof body.doc !== "string" || !Array.isArray(body.comments)) {
    return err({
      code: "bad_args",
      message: "expected { doc, comments: [{ id?, quote, remark }] }",
    })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  if (!knownDoc(body.doc)) {
    return err({ code: "bad_args", message: `the task has no document "${body.doc}"` })
  }
  const raw = body.comments.filter(
    (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
  )
  if (body.doc === "final") {
    const anchored = raw.filter(
      (c) => c.anchor !== undefined && typeof c.remark === "string" && c.remark.trim() !== "",
    )
    if (anchored.length) {
      const current = new Map((await readComments(ctx, found.data.task)).map((c) => [c.id, c]))
      const scoped = await workflowProjection(ctx, found.data.task)
      for (const draft of anchored) {
        const anchor = diffAnchor(draft.anchor)
        if (!anchor)
          return err({
            code: "bad_args",
            message: "This line comment has no valid file version. Refresh the change.",
          })
        const previous = typeof draft.id === "string" ? current.get(draft.id)?.anchor : undefined
        if (
          previous &&
          previous.file === anchor.file &&
          previous.side === anchor.side &&
          previous.line === anchor.line &&
          previous.stamp === anchor.stamp
        )
          continue
        if (!scoped.ok) return scoped
        if (!ownsWorkflowAnchor(scoped.data, anchor))
          return err({
            code: "bad_args",
            message: "This line is not available in this workflow’s change. Refresh the change.",
          })
      }
    }
  }
  // An answer names its item: the agent reads the item's own words beside it.
  const named = raw.some((c) => typeof c.item === "string" && c.item !== "" && !c.quote)
  const known = named
    ? new Map(
        flattenItems(
          await taskItems(ctx, found.data.task, await readGate(ctx, found.data.task)),
        ).map((item) => [item.id, item.what]),
      )
    : new Map<string, string>()
  const drafts = raw.map((c) => {
    const item = typeof c.item === "string" && c.item !== "" ? c.item.slice(0, 200) : undefined
    const kind = item !== undefined ? answerKind(c.kind) : undefined
    const quote = typeof c.quote === "string" ? c.quote.slice(0, 2000) : ""
    return {
      id: typeof c.id === "string" ? c.id : undefined,
      quote: quote === "" && item !== undefined ? (known.get(item) ?? "").slice(0, 2000) : quote,
      remark: typeof c.remark === "string" ? c.remark.slice(0, 8000) : "",
      ...(body.doc === "final" && diffAnchor(c.anchor) !== undefined
        ? {
            anchor: diffAnchor(c.anchor),
            ...(reviewAsk(c.ask) !== undefined ? { ask: reviewAsk(c.ask) } : {}),
            ...(reviewAsk(c.ask) === "replace" && typeof c.replace === "string"
              ? { replace: c.replace.slice(0, 8000) }
              : {}),
          }
        : {}),
      ...(item !== undefined ? { item } : {}),
      ...(item !== undefined && typeof c.pin === "string" && c.pin !== ""
        ? { pin: c.pin.slice(0, 300) }
        : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(kind !== undefined && typeof c.seen === "string" ? { seen: c.seen.slice(0, 64) } : {}),
    }
  })
  const saved = await putDrafts(ctx, found.data.task, body.doc, drafts)
  await answerQuestions(ctx, found.data.task, saved)
  return ok({ comments: saved })
}

/**
 * Who answers the open questions on the change now, for their threads; a worker that is gone (the
 * App restarted, the machine slept) is started again, so no question waits on nothing.
 */
async function answering(
  ctx: Ctx,
  task: Task,
  comments: readonly Comment[],
): Promise<TaskDetail["answering"]> {
  const open = comments.filter(helperOpen)
  if (open.length === 0) return null
  const run = await liveAnswerRun(ctx, task)
  if (run === null) await answerQuestions(ctx, task, comments)
  return {
    helper: run?.helper ?? null,
    waiting: open.length,
    since: Math.min(...open.map((c) => c.created)),
  }
}

/** A question on a line waits for an answer: the worker that sees it answered is started. */
async function answerQuestions(ctx: Ctx, task: Task, comments: readonly Comment[]) {
  if (!comments.some(helperOpen)) return
  await startAnswering(ctx, task).catch(() => {
    // The App reads the comment back and shows it unanswered with Ask again.
  })
}

/** The paths the change touches since the build began, as the task detail lists them. */
async function taskChangedPaths(ctx: Ctx, task: Task): Promise<string[] | null> {
  const scoped = await workflowProjection(ctx, task, { metadata: true })
  return scoped.ok ? scoped.data.files.map((file) => file.path) : null
}

/**
 * What the person did with a finding on a line: made it their change request (the App saves the
 * draft itself), or dismissed it with a reason, which becomes a project lesson so the next task's
 * reviewers do not raise it again.
 */
export async function postFinding(
  ctx: Ctx,
  id: string,
  findingId: string,
  body: { kind?: unknown; reason?: unknown },
): Promise<Result<{ findings: LineFinding[] }>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const kind = body.kind === "adopted" || body.kind === "dismissed" ? body.kind : null
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : ""
  if (kind === null || (kind === "dismissed" && reason === ""))
    return err({
      code: "bad_args",
      message: 'expected { kind: "adopted" } or { kind: "dismissed", reason }',
    })
  const files = (await taskChangedPaths(ctx, task)) ?? []
  const finding = (await lineFindings(ctx, task, files)).find((f) => f.id === findingId)
  if (finding === undefined)
    return err({ code: "bad_args", message: `no finding "${findingId}" on the change` })
  await disposeFinding(ctx, task, findingId, { kind, ...(kind === "dismissed" ? { reason } : {}) })
  if (kind === "dismissed") {
    const memory = await projectMemory(ctx, { id: task.repoId, root: task.repoRoot, commonDir: "" })
    try {
      await memory.store({
        project: task.repoId,
        title: `Not a problem: ${finding.what.slice(0, 80)}`,
        content: `${finding.by} raised on ${finding.file}:${finding.line}: ${finding.what}\nThe person reviewing it said this is not a problem: ${reason}`,
        files: [finding.file],
        task: task.slug,
        key: `finding:${findingId}`,
      })
    } finally {
      await memory.close()
    }
  }
  return ok({ findings: await lineFindings(ctx, task, files) })
}

/** Ask another reviewer from the workspace: `file` for one file, none for the whole change. */
export async function postAnotherReview(ctx: Ctx, id: string, body: { file?: unknown }) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const started = await startAnotherReview(
    ctx,
    found.data.task,
    typeof body.file === "string" && body.file !== "" ? body.file : null,
  )
  if ("error" in started) return err({ code: "bad_args", message: started.error })
  const { findings: _f, pid: _p, ...run } = started.run
  return ok({ run })
}

/** Ask again: a question that ended without an answer goes round once more. */
export async function postAskAgain(
  ctx: Ctx,
  id: string,
  commentId: string,
): Promise<Result<{ comments: Comment[] }>> {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  if (!(await askAgain(ctx, found.data.task, commentId)))
    return err({ code: "bad_args", message: `no unanswered question "${commentId}" on the change` })
  const comments = await readComments(ctx, found.data.task)
  await answerQuestions(ctx, found.data.task, comments)
  return ok({ comments })
}

/** A comment on an item of the build view: a slice, a task, a picture, a subagent or a diff line. */
export async function postBuildComment(
  ctx: Ctx,
  id: string,
  body: { kind?: unknown; id?: unknown; quote?: unknown; line?: unknown; remark?: unknown },
): Promise<Result<{ comment: Comment }>> {
  const anchor = buildAnchor(body)
  const remark = typeof body.remark === "string" ? body.remark.trim().slice(0, 8000) : ""
  if (anchor === undefined || remark === "") {
    return err({
      code: "bad_args",
      message: `expected { kind: ${BUILD_KINDS.join(" | ")}, id, quote?, line?, remark }`,
    })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  return ok({ comment: await addBuildComment(ctx, found.data.task, anchor, remark) })
}

/**
 * Save the final approval and closing record before the authorized push. Applying that decision
 * completes here or through the agent's wait, which this awaits. Workflow records remain on disk;
 * the person decides whether to commit them.
 */
async function closeBeforePush(ctx: Ctx, task: Task): Promise<Result<null>> {
  const gate = await readGate(ctx, task)
  if (gate?.target !== FINAL || gate.decision !== "approved")
    return err({ code: "bad_args", message: "The final approval is no longer recorded." })
  try {
    const settled = await settle(ctx, task, gate, { app: true })
    if (settled.ok) return ok(null)
    return err({
      code: "bad_args",
      message: `Nothing was pushed: the closing record could not be made. ${settled.error.message}`,
    })
  } catch (cause) {
    return err({
      code: "bad_args",
      message: `Nothing was pushed: the closing record could not be made. ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}

/** Push the branch and open the pull request with the drafted description. */
async function openPullRequest(ctx: Ctx, task: Task) {
  // What goes out is what the person approved: the head at their click, when the approval was
  // applied later and commits were made in between. Those stay local, as changes since the approval.
  const gate = await readGate(ctx, task)
  const approvedHead =
    gate?.target === FINAL && gate.decision === "approved" ? gate.approvedHead : undefined
  const made = await createPullRequest(ctx, task, approvedHead)
  if (!made.ok) return made
  // Comments on lines left open at the approval go to the pull request as notes, once. Reading the
  // new pull request back may have posted them already: the count is of those it now holds.
  const tried = await postPullRequestNotes(ctx, task, made.data.url)
  const posted = (await readComments(ctx, task)).filter((c) => c.prNote === made.data.url).length
  return ok({
    pr: made.data,
    notes: { posted, ...(tried.error !== undefined ? { error: tried.error } : {}) },
  })
}

/**
 * The person's click on *Push the fix*: the commits their agent made after the pull request was
 * pushed go to its branch. Nothing else pushes after the approval; the pull request is read again
 * and its summary comes back.
 */
export async function postPush(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  if (task.stage !== "shipped")
    return err({ code: "bad_args", message: "Only a shipped task's pull request takes a fix." })
  const pushed = await pushFix(ctx, task)
  if (!pushed.ok) return pushed
  return ok({
    pushed: true,
    branch: pushed.data.branch,
    pullRequest: await pullRequestLife(ctx, task),
  })
}

/** *Leave them for now*: what waits on the pull request stops asking until something new comes. */
export async function postLeavePullRequest(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const left = await leavePullRequest(ctx, found.data.task)
  return left.ok
    ? ok({ left: true, pullRequest: await pullRequestLife(ctx, found.data.task) })
    : left
}

/**
 * *Mark as merged*: the person says the shipped task's change landed, for a merge git cannot show.
 * Idempotent; the task's own machine answers, so a teammate's task (reached through the team
 * workspace, never `locate`) is not found here.
 */
export async function postMarkMerged(ctx: Ctx, id: string, body: { scope?: unknown } = {}) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const open = await refuseArchived(ctx, found.data.task, "marking it as merged")
  if (!open.ok) return open
  if (typeof body?.scope !== "string" || !/^[a-f0-9]{64}$/.test(body.scope))
    return err({
      code: "bad_args",
      message: "Refresh Review: the observed approval scope is required.",
    })
  const marked = await markMerged(ctx, found.data.task, body.scope)
  return marked.ok ? ok({ landing: marked.data }) : marked
}

/** *Approve change*: the person approves the branch head made after the approval (`{ sha }`). Idempotent. */
export async function postApproveChange(
  ctx: Ctx,
  id: string,
  body: { sha?: unknown; scope?: unknown },
) {
  if (typeof body?.sha !== "string" || body.sha === "")
    return err({ code: "bad_args", message: "expected { sha: <the commit to approve> }" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const open = await refuseArchived(ctx, found.data.task, "approving a change")
  if (!open.ok) return open
  if (typeof body.scope !== "string" || !/^[a-f0-9]{64}$/.test(body.scope))
    return err({
      code: "bad_args",
      message: "Refresh Review: the observed approval scope is required.",
    })
  const approved = await approveChange(ctx, found.data.task, body.sha, body.scope)
  return approved.ok ? ok({ landing: approved.data }) : approved
}

/** What the person is shown before *Approve change*: the most the patch of the changes since the approval holds. */
const LANDING_DIFF_BYTES = 400 * 1024

/**
 * The changes since the approval as git sees them (`from` the approved head `to` the pending head),
 * whoever made the commits: a commit outside QualityLayer's receipts is in it too. Empty when nothing
 * is pending or the task has landed.
 */
export async function getLandingDiff(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const landing = await landingView(ctx, task)
  if (landing === null) return err({ code: "no_task", message: `"${id}" is not a shipped task` })
  const from = landing.approvedHead ?? ""
  const pending = landing.rewritten === true ? landing.tip : landing.since[0]?.sha
  const head = landing.state === "landing" ? (pending ?? null) : null
  if (landing.approvedHead === null || head === null || head === landing.approvedHead)
    return ok({ from, to: from, files: [], patch: "", truncated: false })
  const diff = await diffBetween(ctx, task.repoRoot, from, head, { capBytes: LANDING_DIFF_BYTES })
  if (diff === null)
    return err({
      code: "bad_args",
      message: `Git cannot read ${from.slice(0, 8)}..${head.slice(0, 8)}.`,
    })
  return ok({ from, to: head, ...diff })
}

/** Something the author says in the review: a thread, a reply, resolving it, asking a reviewer again. */
export async function postReview(ctx: Ctx, id: string, body: Record<string, unknown>) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  if (!(await inPersonReview(ctx, task))) {
    return err({
      code: "bad_args",
      message: "The review opens once the checks have passed.",
    })
  }
  // Asking a reviewer again needs a teammate to ask; the person reviews their own change.
  if (body.t === "rereview")
    return err({ code: "bad_args", message: "There is no other reviewer to ask again." })
  if (body.t === "thread" && typeof body.anchor === "object" && body.anchor !== null) {
    const input = body.anchor as Record<string, unknown>
    if (input.kind === "diff") {
      const anchor = diffAnchor({
        file: input.id,
        side: input.side,
        line: input.line,
        stamp: input.stamp,
      })
      const previous =
        typeof body.thread === "string"
          ? (await readReview(ctx, task)).threads.find((thread) => thread.id === body.thread)
              ?.anchor
          : undefined
      const unchanged =
        anchor &&
        previous?.kind === "diff" &&
        previous.id === anchor.file &&
        previous.side === anchor.side &&
        previous.line === anchor.line &&
        previous.stamp === anchor.stamp
      if (!unchanged) {
        const scoped = await workflowProjection(ctx, task)
        if (!scoped.ok) return scoped
        if (!anchor || !ownsWorkflowAnchor(scoped.data, anchor))
          return err({
            code: "bad_args",
            message: "This line is not available in this workflow’s change. Refresh the change.",
          })
      }
    }
  }
  const said = await sayInReview(ctx, task, body as ReviewAction)
  if (!said.ok) return said
  return ok({ event: said.data })
}

function taskDisposition(ctx: Ctx, task: Task) {
  const key = `${task.repoId}~${task.slug}`
  return {
    created: task.created,
    runs: listRuns(ctx.home)
      .filter((run) => belongsToTask(run, key))
      .map(({ id, generation }) => ({ id, generation })),
  }
}

export async function putArchived(ctx: Ctx, id: string, body: { archived?: unknown }) {
  if (typeof body.archived !== "boolean") {
    return err({ code: "bad_args", message: "expected { archived: true | false }" })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const disposition = taskDisposition(ctx, found.data.task)
  await setArchived(ctx, found.data.task, body.archived)
  return ok({ archived: body.archived, disposition })
}

/**
 * How the task runs, before the Plan is approved: the person's one choice, Small change or Full
 * workflow, as `+small` / `-small`. A small change is offered only while the first look keeps its
 * bounds; the reply is the row as it reads now.
 */
export async function putProfile(ctx: Ctx, id: string, body: { profile?: unknown }) {
  if (body.profile !== "small" && body.profile !== "full")
    return err({ code: "bad_args", message: "expected { profile: small | full }" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  if (task.stage !== "plan")
    return err({
      code: "bad_args",
      message: "how the task runs is chosen before the Plan is approved",
    })
  const before = await intakeOf(ctx, task)
  if (body.profile === "small" && before?.offered !== true)
    return err({
      code: "bad_args",
      message:
        "the small-change view needs traced scope, no known risk surface, and compatible Plan size and risk records",
    })
  const applied = applyOverrides(task.overrides, [body.profile === "small" ? "+small" : "-small"])
  if (!applied.ok) return applied
  await patchReadme(ctx, task, { overrides: applied.data })
  await appendEvent(ctx, task, { event: "task_overridden", overrides: applied.data })
  return ok({ intake: await intakeOf(ctx, { ...task, overrides: applied.data }) })
}

export async function removeTask(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const disposition = taskDisposition(ctx, found.data.task)
  if (await isArchived(ctx, found.data.task)) {
    const stopped = await stopTaskRuns(ctx, `${found.data.task.repoId}~${found.data.task.slug}`)
    if (!stopped.ok) return stopped
  }
  const deleted = await deleteTask(ctx, found.data.task)
  return deleted.ok ? ok({ ...deleted.data, disposition }) : deleted
}

/** An archived task is put away until it is restored. */
async function refuseArchived(ctx: Ctx, task: Task, what: string): Promise<Result<null>> {
  return (await isArchived(ctx, task))
    ? err({ code: "bad_args", message: `This task is archived; restore it before ${what}.` })
    : ok(null)
}

export async function postGate(
  ctx: Ctx,
  id: string,
  body: {
    decision?: unknown
    remark?: unknown
    gateId?: unknown
    revision?: unknown
    without?: unknown
    /** The final approval's choice: "pull-request" (push and open it), "only" or "commands" (you push). Never a merge. */
    ship?: unknown
  },
) {
  if (body.decision !== "approved" && body.decision !== "changes") {
    return err({ code: "bad_args", message: 'expected { decision: "approved" | "changes" }' })
  }
  const ship: ShipChoice | undefined =
    body.ship === "pull-request" || body.ship === "only" || body.ship === "commands"
      ? body.ship
      : undefined
  if (body.ship !== undefined && ship === undefined) {
    return err({
      code: "bad_args",
      message: 'expected ship to be "pull-request", "only" or "commands"',
    })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  // The choice counts for the final approval that stays an approval: not for another document's
  // gate, and not for an approval an unsent answer will turn into changes.
  const gate = body.decision === "approved" && ship !== undefined ? await readGate(ctx, task) : null
  const shipping =
    gate !== null &&
    gate.target === FINAL &&
    gate.settled !== true &&
    gate.decision === "pending" &&
    !(await approvalWouldAskChanges(ctx, task))
  // Nothing about the pull request is checked before the approval is saved: the approval always
  // saves and closes the task. What stands in the way of the pull request (open threads, no gh,
  // the base branch, a checkout on another branch) is found by the one opener after it, and is
  // recorded as an opening that failed, with its reason (`openChosenPullRequest`).
  // The choice is on disk before the approval is: the agent's next step starts the moment the
  // approval is recorded, and the pull request takes seconds to open.
  if (shipping && ship !== undefined) {
    await writeShipRecord(ctx, task, {
      choice: ship,
      ...(ship === "pull-request" ? { state: "opening" as const } : {}),
    })
  }
  const done = await record(ctx, task, body.decision, {
    gateId: typeof body.gateId === "string" ? body.gateId : undefined,
    revision: typeof body.revision === "string" ? body.revision : undefined,
    remark: typeof body.remark === "string" ? body.remark : undefined,
    by: "cockpit",
    // Kept with an approval saved during a recheck, and applied with it in Review.
    ...(ship !== undefined ? { ship } : {}),
  })
  const approved = done.ok && done.data.decision === "approved" && done.data.target === "final"
  if (shipping && !approved) await clearShipRecord(ctx, task)
  if (approved) {
    const recorded = await readGate(ctx, task)
    if (recorded && !recorded.settled) {
      // The approval is saved whatever closing does: a closing step that cannot run now is taken up
      // by the agent's next move, and never reads to the person as "not saved".
      await settle(ctx, task, recorded, { app: true })
    }
    // The pull request opens now, for the approval stands whether or not GitHub accepts the push.
    // Whether one was chosen is read from the ship record under the opener's lock, not from what
    // this request saw before the approval was saved: the task may have gone back for a recheck in
    // between, and the approval then carried the choice itself.
    if (done.ok) {
      const opened = await openChosenPullRequest(ctx, task)
      if (opened !== null) return ok({ ...done.data, ...opened })
    }
  }
  return done
}

/** Why *Approve and open a pull request* cannot run in this checkout now; null when it can. */
async function pullRequestRefusal(ctx: Ctx, task: Task) {
  const holding = shipBlockers(await readReview(ctx, task))
  if (holding.length > 0)
    return err({
      code: "review_pending",
      message: `Opening a pull request waits for: ${holding.join(" · ")}`,
    })
  if (!ghInstalled(ctx)) {
    return err({
      code: "bad_args",
      message: "gh is not installed here. Approve only, or copy the git commands.",
    })
  }
  // A task on the base branch has no branch to open a pull request from, and Approve would push the base.
  const onBase = await baseWhenOn(ctx, task)
  if (onBase !== null)
    return err({ code: "bad_args", message: baseBranchRefusal(task, onBase).message })
  const wrong = wrongBranch(task, await currentBranch(ctx, task.repoRoot))
  if (wrong !== null)
    return err({ code: "bad_args", message: `${wrong}. Check ${task.branch} out first.` })
  return null
}

/**
 * The one opener of the pull request an approval chose: the ship record says `opening` (the App
 * wrote it with the click, or applying an approval saved during a recheck did). Every route comes
 * here: the Review card's click, the approval question's card, and whoever applied the approval
 * outside the App (`settle`, for the agent's `next` and `wait` and a typed approval). The same
 * checks, push, team share and notes, and the same record of its result, which is returned as the
 * click's reply carries it (null when there was nothing to open). One opening at a time under one
 * lock, and only while the record still says `opening`: a route that comes second finds the
 * result and writes nothing.
 */
export async function openChosenPullRequest(ctx: Ctx, task: Task) {
  const gate = await readGate(ctx, task)
  if (gate?.target !== FINAL || gate.decision !== "approved") return null
  const failed = async (error: string) => {
    await writeShipRecord(ctx, task, { choice: "pull-request", state: "failed", error })
    return { prError: error }
  }
  try {
    return await ctx.fs.withLock(join(task.runtimeDir, "ship-choice.lock"), async () => {
      // Read under the lock: an opening another route finished (or gave up) is not started again.
      const record = await readShipRecord(ctx, task)
      if (record?.choice !== "pull-request" || record.state !== "opening") return null
      try {
        // The approval is saved already: what would have refused the click is the reason it failed.
        const refused = await pullRequestRefusal(ctx, task)
        if (refused !== null) return refused.ok ? null : await failed(refused.error.message)
        const made = await shipPullRequest(ctx, task)
        return made.ok
          ? { pr: made.data.pr, prNotes: made.data.notes }
          : { prError: made.error.message }
      } catch (cause) {
        return await failed(cause instanceof Error ? cause.message : String(cause))
      }
    })
  } catch {
    // Another opening holds it; its result is the record's.
    return null
  }
}

/** After *Approve and open a pull request*: save the closing record, push, open the pull request and record its result. */
async function shipPullRequest(ctx: Ctx, task: Task) {
  const closed = await closeBeforePush(ctx, task)
  const made = closed.ok ? await openPullRequest(ctx, task) : closed
  if (made.ok)
    await writeShipRecord(ctx, task, {
      choice: "pull-request",
      state: "open",
      url: made.data.pr.url,
    })
  // A failed attempt never replaces the record of a pull request that is open.
  else if ((await readShipRecord(ctx, task))?.state !== "open")
    await writeShipRecord(ctx, task, {
      choice: "pull-request",
      state: "failed",
      error: made.error.message,
    })
  return made
}

/**
 * The person answers the question card: a choice, their own words, Tell me more or Not sure. It
 * goes out at once; refused unless `id` is the question that waits. A review question's answer is
 * recorded on its gate as well.
 */
export async function postQuestionAnswer(
  ctx: Ctx,
  id: string,
  body: Record<string, unknown>,
  files: import("../core/interaction-docs/attachments.ts").Incoming[] = [],
) {
  const answer = appAnswerOf(body)
  if (answer === null) {
    return err({
      code: "bad_args",
      message: "expected { id, choice | text | more: { request } | unsure: true }",
    })
  }
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const refused = await refuseArchived(ctx, found.data.task, "answering")
  if (!refused.ok) return refused
  const answered = await answerFromApp(ctx, found.data.task, answer, { files })
  // A question asked in the terminal, answered here: the waiting session outside the App is woken with it.
  if (answered.ok && "answered" in answered.data && found.data.task.answers === "terminal")
    await wakeOutsideSession(
      ctx,
      found.data.task,
      answeredHereMessage(answered.data.answered.number, answered.data.answered.choice),
    )
  // *Approve and open a pull request* in the approval question's card: the gate recorded the
  // approval with the choice `opening`, and the pull request opens now, as from the Review card.
  if (answered.ok && "answered" in answered.data) await openChosenPullRequest(ctx, found.data.task)
  return answered
}

/** A question asked on the App's home page: a taskless Home or team ask. */
export type HomeQuestion = {
  project: { id: string; name: string }
  question: Question | null
  questionWait: Heartbeat | null
  answeredQuestions: AnsweredQuestion[]
}

/** The home page's question of a project, as the card needs it. */
async function homeHost(ctx: Ctx, projectId: string): Promise<Result<HomeHost>> {
  const project = (await listProjects(ctx)).find((p) => p.id === projectId)
  if (project === undefined) return err({ code: "bad_args", message: "no such project" })
  return ok({ runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, project.id)) })
}

/** Every project's home-page question that waits, or was answered a moment ago. */
export async function homeQuestions(ctx: Ctx): Promise<HomeQuestion[]> {
  const out: HomeQuestion[] = []
  for (const project of await listProjects(ctx)) {
    const host = { runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, project.id)) }
    if (!(await ctx.fs.exists(host.runtimeDir))) continue
    const question = await openQuestion(ctx, host)
    const answered = (await answeredQuestions(ctx, host)).slice(-1)
    const last = answered[0]
    const recent =
      last !== undefined && (ctx.clock.now() - last.at < 60_000 || last.delivered === false)
    if (question === null && !recent) continue
    out.push({
      project: { id: project.id, name: project.name },
      question,
      questionWait: await readHeartbeat(ctx, host),
      answeredQuestions: answered,
    })
  }
  return out
}

/** The home page's question, answered: the same answer as on a task's card. */
export async function postHomeQuestion(
  ctx: Ctx,
  projectId: string,
  action: "answer" | "cancel" | "change",
  body: Record<string, unknown>,
  files: import("../core/interaction-docs/attachments.ts").Incoming[] = [],
) {
  const host = await homeHost(ctx, projectId)
  if (!host.ok) return host
  if (action === "cancel") {
    const cancelled = await cancelMore(ctx, host.data)
    return cancelled.ok ? ok({ question: cancelled.data }) : cancelled
  }
  if (action === "change") {
    const change = answerChangeOf(body)
    if (change === null)
      return err({ code: "bad_args", message: "expected { number, choice | choices | text }" })
    const changed = await changeAnswer(ctx, host.data, change)
    return changed.ok ? ok({ answered: changed.data }) : changed
  }
  const answer = appAnswerOf(body)
  if (answer === null)
    return err({
      code: "bad_args",
      message: "expected { id, choice | text | more: { request } | unsure: true }",
    })
  return answerFromApp(ctx, host.data, answer, { files })
}

/** Cancel on Tell me more: the card goes back to waiting for the answer. */
export async function postQuestionCancel(ctx: Ctx, id: string) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const cancelled = await cancelMore(ctx, found.data.task)
  return cancelled.ok ? ok({ question: cancelled.data }) : cancelled
}

/** Change on a receipt: a corrected answer, which the agent hears in its next reply. */
export async function postQuestionChange(ctx: Ctx, id: string, body: Record<string, unknown>) {
  const change = answerChangeOf(body)
  if (change === null)
    return err({ code: "bad_args", message: "expected { number, choice | choices | text }" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const changed = await changeAnswer(ctx, found.data.task, change)
  return changed.ok ? ok({ answered: changed.data }) : changed
}

/** A Change request: the question's number, and one choice, the whole set of picks, or words. */
function answerChangeOf(body: Record<string, unknown>): AnswerChange | null {
  const { number, choice, choices, text } = body
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) return null
  if (choices !== undefined && (!Array.isArray(choices) || !choices.every(Number.isInteger)))
    return null
  return {
    number,
    ...(typeof choice === "number" && Number.isInteger(choice) ? { choice } : {}),
    ...(choices !== undefined ? { choices: choices as number[] } : {}),
    ...(typeof text === "string" ? { text } : {}),
  }
}

/**
 * *Build in that session*: the person approves the Plan and chooses the planner waiting in their
 * terminal to build it. The route (that planner's session, this gate) is saved first and the
 * approval second, so the waiter never reads an approval without its route.
 */
export async function postBuildHere(
  ctx: Ctx,
  id: string,
  body: {
    gateId?: unknown
    revision?: unknown
    compact?: unknown
    agent?: unknown
    remark?: unknown
  },
) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const gate = await readGate(ctx, task)
  if (
    gate === null ||
    gate.target !== folderDoc("plan") ||
    gate.decision !== "pending" ||
    gate.settled === true ||
    typeof body.gateId !== "string" ||
    gate.id !== body.gateId
  )
    return err({
      code: "bad_args",
      message: "Building in that session needs the open Plan approval.",
    })
  if (!gate.id || !gate.session)
    return err({
      code: "bad_args",
      message: "The planning session names no session id, so it cannot build on your click.",
    })
  const routed = await recordRoute(ctx, task, {
    agent: typeof body.agent === "string" ? body.agent : "other",
    orchestrator: AGENT_OWN,
    workers: AGENT_OWN,
    effort: AGENT_OWN,
    goal: false,
    where: "here",
    session: keyOf(gate.session),
    gate: gate.id,
    ...(body.compact === true ? { compact: true } : {}),
  })
  if (!routed.ok) return routed
  const gateId = gate.id
  const done = await postGate(ctx, id, {
    decision: "approved",
    gateId,
    ...(typeof body.revision === "string" ? { revision: body.revision } : {}),
    ...(typeof body.remark === "string" ? { remark: body.remark } : {}),
  }).catch(async (cause: unknown) => {
    if (!(await approvedNow(ctx, task, gateId))) await dropRoute(ctx, task, gateId)
    throw cause
  })
  // The route stands only while the gate it names ended approved; a double click whose second
  // approval is refused because the first landed keeps the first click's route.
  if (!(await approvedNow(ctx, task, gateId))) {
    await dropRoute(ctx, task, gateId)
    return done
  }
  return done.ok ? ok({ ...done.data, start: routed.data }) : done
}

async function approvedNow(ctx: Ctx, task: Task, gateId: string): Promise<boolean> {
  const settled = await readGate(ctx, task)
  return settled?.id === gateId && settled.decision === "approved"
}

/**
 * `POST /api/tasks {project | cwd, request?, from?, type?, title?}`: a task in a known project that
 * waits on Home, as `task start` from a script makes it. With `from`, the ticket link's title and text
 * become the request and the task keeps the link; the same link again answers its task.
 */
export async function postTask(ctx: Ctx, body: Record<string, unknown>) {
  const cwd = typeof body.cwd === "string" ? body.cwd : undefined
  const named = typeof body.project === "string" ? body.project : undefined
  const projects = await listProjects(ctx)
  const project = projects.find((p) =>
    cwd !== undefined ? p.paths.includes(cwd) : p.id === named || p.name === named,
  )
  const path = cwd ?? project?.paths[0]
  if (project === undefined || path === undefined)
    return err({
      code: "bad_args",
      message: `Name a project QualityLayer knows: "project": "<id or name>" or "cwd": "<its checkout>". Known: ${projects.map((p) => p.name).join(", ") || "none"}.`,
    })
  const type = body.type
  if (type !== undefined && type !== "feature" && type !== "bugfix" && type !== "bug")
    return err({ code: "bad_args", message: '"type" is "feature" or "bugfix".' })
  if (
    (body.from !== undefined && typeof body.from !== "string") ||
    (body.request !== undefined && typeof body.request !== "string") ||
    (body.title !== undefined && typeof body.title !== "string")
  )
    return err({ code: "bad_args", message: '"request", "from" and "title" are strings.' })
  // A script's start: the checkout is the project's, and no agent session takes the task.
  const scoped: Ctx = { ...ctx, env: { cwd: () => path, get: (name) => ctx.env.get(name) } }
  return startScriptTask(scoped, {
    ...(typeof body.request === "string" ? { request: body.request } : {}),
    ...(typeof body.from === "string" ? { from: body.from } : {}),
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(type !== undefined ? { type: type === "feature" ? "feature" : "bugfix" } : {}),
  })
}

/**
 * The person copied the build's start after Plan approval: the agent, the models, the effort,
 * goal mode and where it runs are recorded on the task, so the build's workers run at that effort.
 */
export async function postStart(ctx: Ctx, id: string, body: unknown) {
  const found = await locate(ctx, id)
  if (!found.ok) return found
  // A planner's session is named only through Build in that session (postBuildHere).
  if (
    typeof body === "object" &&
    body !== null &&
    ["session", "gate", "compact"].some((key) => key in body)
  )
    return err({
      code: "bad_args",
      message: "A planner's session is named only by Build in that session.",
    })
  const choice = parseStart(body, ctx.clock.now())
  if (!choice.ok) return choice
  let { task } = found.data
  if (task.stage === "plan") {
    const gate = await readGate(ctx, task)
    if (gate?.settled !== true) {
      if (
        gate === null ||
        gate.target !== folderDoc("plan") ||
        gate.decision !== "approved" ||
        !(await revisionMatches(ctx, task, gate.target, gate.revision))
      )
        return err({
          code: "bad_args",
          message: "The current Plan must be approved before recording its build start.",
        })
      const settled = await settle(ctx, task, gate, { app: true })
      if (!settled.ok) return settled
      if (settled.data.decision !== "approved")
        return err({
          code: "bad_args",
          message: "The Plan must be approved before recording its build start.",
        })
    }
    const reloaded = await locate(ctx, id)
    if (!reloaded.ok) return reloaded
    task = reloaded.data.task
  }
  const recorded = await recordStart(ctx, task, choice.data)
  if (recorded.ok && recorded.data.answers !== undefined)
    await patchReadme(ctx, task, { answers: recorded.data.answers, approvals: null }, "build_start")
  return recorded.ok ? ok({ start: recorded.data }) : recorded
}

/** Where the build lands: the start card's *Lands on* row, read from git. */
export async function taskBranch(ctx: Ctx, id: string): Promise<Result<BranchState>> {
  const found = await locate(ctx, id)
  return found.ok ? ok(await branchState(ctx, found.data.task)) : found
}

/** The person's click on *Start on a new branch*: create it, switch to it, record it; the row's new state comes back. */
export async function postBranch(
  ctx: Ctx,
  id: string,
  body: { name?: unknown },
): Promise<Result<BranchState>> {
  if (body.name !== undefined && typeof body.name !== "string")
    return err({ code: "bad_args", message: "expected { name?: string }" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const made = await createBranch(ctx, task, body.name?.trim() || undefined)
  return made.ok ? ok(await branchState(ctx, task)) : made
}

export async function findAll(ctx: Ctx, query: string) {
  const results = []
  for (const project of await listProjects(ctx)) {
    const root = project.paths[0]
    if (root === undefined || !(await ctx.fs.exists(root))) continue
    for (const entry of await scan(ctx, { root, id: project.id, commonDir: "" }, { query })) {
      results.push({
        ...entry,
        project: project.id,
        projectName: project.name,
        id: `${project.id}~${entry.task}`,
      })
    }
  }
  return results
}

export function getConfig(ctx: Ctx): Promise<Config> {
  return readConfig(ctx)
}

export async function putConfig(ctx: Ctx, patch: unknown): Promise<Result<Config>> {
  const before = await readConfig(ctx)
  const refused = refuseSettingsPatch(patch, before.addedModels)
  if (refused !== null) return err({ code: "bad_args", message: refused })
  const saved = await writeConfig(ctx, patch)
  await recheckAfterChannelChange(ctx, before, saved)
  return ok(saved)
}

/** At most this many waiting tasks are read ahead when the Cockpit starts. */
const WARMED_TASKS = 5

/**
 * Reads the tasks waiting at a gate once, one after another, so the first open of one finds its
 * diff already read (a git-crypt checkout decrypts every changed file on the first read).
 */
export async function warmTasks(ctx: Ctx): Promise<void> {
  const waiting = (await listAllTasks(ctx)).filter(
    (t) => t.gate !== null && t.gate.decision === "pending" && !t.gate.settled,
  )
  for (const task of waiting.slice(0, WARMED_TASKS)) await taskDetail(ctx, task.id)
}

/** True while any task has an undecided gate: the server must not idle out. */
export async function anyOpenGate(ctx: Ctx): Promise<boolean> {
  return (await listAllTasks(ctx)).some(
    (t) => t.gate !== null && t.gate.decision === "pending" && !t.gate.settled,
  )
}

export async function postTaskPicker(
  ctx: Ctx,
  id: string,
  body: Record<string, unknown>,
  canAnswer: () => Promise<boolean>,
) {
  if (!(await canAnswer())) return err({ code: "held", message: "This browser may only watch" })
  const found = await locate(ctx, id)
  if (!found.ok) return found
  const { task } = found.data
  const current = await outsideLead(ctx, task)
  if (
    current?.agent !== "claude-code" ||
    !current.sessionId ||
    current.sessionId !== body.session ||
    typeof body.callId !== "string"
  )
    return err({
      code: "bad_args",
      message: "This is not the task's current Claude Code session",
    })
  if (
    (await isArchived(ctx, task)) ||
    boundSlug(ctx, task.repoId, keyOf(current.sessionId)) !== task.slug
  )
    return err({ code: "held", message: "This session is no longer bound to this active task" })
  const authorized = async () => {
    if (!(await canAnswer()) || (await isArchived(ctx, task))) return false
    if (
      listRuns(ctx.home).some(
        (run) =>
          run.agent === "claude-code" &&
          run.nativeSession === current.sessionId &&
          !["stopped", "failed"].includes(run.status),
      )
    )
      return false
    const latest = await outsideLead(ctx, task)
    return (
      latest?.sessionId === current.sessionId &&
      latest.agent === "claude-code" &&
      boundSlug(ctx, task.repoId, keyOf(current.sessionId as string)) === task.slug
    )
  }
  return (await decidePicker(ctx, current.sessionId, body.callId, body.answers, authorized))
    ? ok({ status: "submitted" })
    : err({ code: "held", message: "This question is no longer waiting" })
}

/** The Plan's agents' file and pictures, as the Files tab folds them; null for an earlier task. */
async function planSupport(ctx: Ctx, task: Task): Promise<TaskDetail["support"] | null> {
  const plan = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(plan))) return null
  if (!isCurrentLayout(task)) return null
  const context = await ctx.fs.lstat?.(join(task.dir, agentFileOf("plan"))).catch(() => undefined)
  const pictures = (await filesIn(ctx.fs, join(task.dir, ASSETS_DIR), false)).filter((name) =>
    /^[a-z0-9][a-z0-9-]*\.png$/.test(name),
  )
  return {
    context: context?.kind === "file" ? "written" : "missing",
    assets: pictures.map((name) => `${ASSETS_DIR}/${name}`),
  }
}

/**
 * Verify's lanes as served: the recorded ones, with the project checks lane read again from the check
 * records once Verify is over, so a lane written before a later run passed shows that run.
 */
async function servedVerifyLanes(ctx: Ctx, task: Task): Promise<LaneRow[]> {
  const lanes = (await readVerifyLanes(ctx, task.runtimeDir))?.lanes ?? []
  if (task.stage === "verify") return lanes
  const checks = await checksLaneOf(ctx, task, await readCheckRecords(ctx, task))
  return lanes.map((lane) => (lane.id === "checks" && checks.result !== "" ? checks : lane))
}
