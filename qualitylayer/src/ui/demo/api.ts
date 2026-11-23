// The website demonstration uses the real UI and this in-memory API.
// It never fetches a local Cockpit or starts an agent. Demo settings stay in this browser.

import type { Comment, interactionApi, TaskDetail } from "../api.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { setBranchApi } from "../start-branch.ts"
import type { ScreenEvidenceApi } from "../steps/verify/screens-api.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { createDemoRunAdapter, type RunDemoMoment, runMomentFrom } from "./agent-window.ts"
import { buildArtifactRoutes } from "./api-artifacts-routes.ts"
import { buildProjectFolderRoutes, DEMO_LOOKS, initFolderProjects } from "./api-config.ts"
import { savePutComments } from "./api-docs-comments.ts"
import { handleDocsRoute } from "./api-docs-threads.ts"
import { handleDemoGate } from "./api-gate.ts"
import { buildLifecycleRoutes } from "./api-lifecycle-routes.ts"
import { handleAnswerQuestion, handleChangeAnswer } from "./api-questions-gate.ts"
import { wrapDemoRuns } from "./api-runs-wrap.ts"
import { buildSettingsRoutes } from "./api-settings-routes.ts"
import { buildTaskReadRoutes } from "./api-task-routes.ts"
import {
  allocateDemoTask,
  applyReviewLimits,
  buildDemoTasks,
  chatLive,
  initDemoTasks,
} from "./api-tasks-init.ts"
import { createDemoArtifacts, type DemoArtifacts } from "./artifacts.ts"
import { createDemoAutomations } from "./automations.ts"
import { PROJECTS, QUIET_TASKS } from "./fixtures.ts"
import { FLAGSHIP_MOMENT, type FlagshipStage } from "./flagship.ts"
import type { DemoVariant } from "./items.ts"
import { createDemoMemory } from "./memory.ts"
import { demoReviewCandidate } from "./review-candidate.ts"
import { createDemoSessions } from "./sessions.ts"
import { focusMember } from "./task/batch.ts"
import { demoBranch } from "./task/branch.ts"
import { DEMO_TASK_ID, type Moment } from "./task/index.ts"
import { atReview } from "./task/moments.ts"
import { demoCancelMore } from "./task/question-more.ts"

export { DEMO_LOOKS }

type DemoApiArgs = [
  onChange?: () => void,
  stage?: FlagshipStage,
  variant?: DemoVariant,
  askedMoment?: Moment,
  initialRun?: RunDemoMoment,
  sharedRuns?: ReturnType<typeof createDemoRunAdapter>,
  tourScene?: "chat",
]

function resolveRunMoment(
  search: string,
  chatFixture: string | null,
  initialRun?: RunDemoMoment,
): RunDemoMoment | undefined {
  const fromUrl = runMomentFrom(search)
  if (fromUrl !== undefined) return fromUrl
  if (chatFixture === "empty") return undefined
  if (chatFixture === "starting") return "starting"
  if (chatFixture === "failed") return "stopped"
  return chatFixture ? "running" : initialRun
}

function findDemoTask(tasks: readonly TaskDetail[], id: string, chatRunning: boolean): TaskDetail {
  const found = tasks.find((t) => t.id === id)
  if (!found)
    throw new Error(
      "This illustrative task is no longer in the demo. Choose another task or reset the demo.",
    )
  if (found.session && !QUIET_TASKS.has(found.id)) found.session.heartbeat = Date.now()
  if (chatRunning && found.id === DEMO_TASK_ID) found.live = chatLive(Date.now())
  return found
}

function taskMarkFor(tasks: readonly TaskDetail[], id: string) {
  const found = tasks.find((t) => t.id === id)
  if (found === undefined) return undefined
  return {
    id,
    title: found.title,
    step: found.stage,
    state:
      found.action !== null
        ? ("you" as const)
        : QUIET_TASKS.has(id)
          ? ("quiet" as const)
          : ("work" as const),
  }
}

function storyAgentChange(
  storyDemo: boolean,
  artifactsDemo: DemoArtifacts,
  onChange: () => void,
  file: string,
) {
  if (!storyDemo || !file.endsWith("billing-mode.html")) return undefined
  return {
    answer:
      "Changed the page: the last switch now shows under the button, with who made it, when and why.",
    apply: () => {
      artifactsDemo.showLastSwitch()
      onChange()
    },
  }
}

/**
 * The demo's world. Usage-based billing is the demo task of `task/` in every mode: `stage` (the
 * website's `?flagship=<stage>`) picks the moment it opens at, and `?moment=<id>` (`askedMoment`) picks
 * any moment and adds the product task.
 */
export function createDemoApi(...args: DemoApiArgs) {
  const [
    onChange = () => {},
    stage = "plan",
    variant = {},
    askedMoment,
    initialRun,
    sharedRuns,
    tourScene,
  ] = args
  const moment: Moment = askedMoment ?? FLAGSHIP_MOMENT[stage]
  const search = typeof location === "undefined" ? "" : location.search
  const params = new URLSearchParams(search)
  const chatFixture = params.get("chat") ?? (tourScene === "chat" ? "running" : null)
  const chatRunning = chatFixture === "running"
  const limitsMode = params.get("review-limits")
  const storyDemo = params.has("story")

  let tasks = initDemoTasks(moment, askedMoment, variant, params, chatFixture)
  const folderFixture = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  ).get("project-folders")
  const folderProjects = initFolderProjects(folderFixture, variant)

  const demoSessions = createDemoSessions()
  const branch = demoBranch(moment, DEMO_TASK_ID, storyDemo)
  const runs =
    sharedRuns ??
    createDemoRunAdapter(
      resolveRunMoment(search, chatFixture, initialRun),
      onChange,
      DEMO_TASK_ID,
      (request) => allocateDemoTask(tasks, folderProjects, request),
    )
  setBranchApi(branch.api)

  let nextId = 1
  const get = (id: string): TaskDetail => findDemoTask(tasks, id, chatRunning)
  const artifactsDemo = createDemoArtifacts({
    markOf: (id) => taskMarkFor(tasks, id),
    projects: () => folderProjects,
    ...(atReview(moment) ? { reviewing: { task: DEMO_TASK_ID, project: "web" } } : {}),
    story: storyDemo,
  })
  const lastingNotes: Comment[] = []

  const look = createMemoryLookApi({
    seed: DEMO_LOOKS,
    renameTask: (id, title) => {
      get(id).title = title
    },
    reveal: () => {},
    onChange,
  })

  const gate: WalkthroughApi["gate"] = async (...gateArgs) => {
    const [id, requested, _remark, gateId, ship, options] = gateArgs
    return handleDemoGate({ task: get(id), requested, gateId, ship, options, limitsMode, onChange })
  }

  const taskReadRoutes = buildTaskReadRoutes({
    tasks: () => tasks,
    get,
    moment,
    chatFixture,
    chatRunning,
    params,
    onChange,
  })

  const api: WalkthroughApi & ScreenEvidenceApi & { docsRoute: typeof interactionApi.taskRoute } = {
    ...demoReviewCandidate(),
    currentTurnLayout: true,
    docsRoute: <T>(id: string, lane: string, action: string, init?: RequestInit) =>
      handleDocsRoute<T>(get(id), lane, action, init, onChange),
    memory: createDemoMemory(onChange),
    automations: createDemoAutomations(PROJECTS.map(({ id, name }) => ({ id, name }))),
    agentHistory: {
      sessions: async () => ({ total: 0, sessions: [] }),
      resume: async () => {
        throw new Error("This illustrative folder has no agent sessions to resume.")
      },
    },
    ...buildProjectFolderRoutes(folderProjects, folderFixture),
    ...taskReadRoutes,
    ...buildArtifactRoutes({
      get,
      artifactsDemo,
      lastingNotes,
      look,
      chatFixture,
      onChange,
      apiRef: () => api,
    }),
    putComments: async (id, doc, drafts) => savePutComments(get(id), doc, drafts, onChange),
    gate,
    answerQuestion: async (id, body) => handleAnswerQuestion(get(id), body, onChange),
    focusQuestion: async (id, question) => {
      focusMember(get(id), question)
      onChange()
    },
    cancelMore: async (id) => {
      const task = get(id)
      demoCancelMore(task)
      onChange()
      return { question: task.question }
    },
    homeQuestions: async () => [],
    homeQuestion: async () => ({}),
    changeAnswer: async (id, body) => handleChangeAnswer(get(id), body, onChange),
    ...buildLifecycleRoutes({
      get,
      tasks: () => tasks,
      setTasks: (next) => {
        tasks = next
      },
      onChange,
      nextId: () => nextId++,
      gate,
    }),
    ...buildSettingsRoutes({ storyDemo, onChange, runs, demoSessions }),
  }

  return {
    api,
    look,
    runs: wrapDemoRuns(runs, {
      chatFixture,
      params,
      promoteChat: taskReadRoutes.promoteChat,
      onChange,
    }),
    artifactAgentChange: (file: string) =>
      storyAgentChange(storyDemo, artifactsDemo, onChange, file),
    reset: () => {
      look.reset()
      const added = folderProjects.findIndex((item) => item.id === "empty-demo")
      if (added !== -1) folderProjects.splice(added, 1)
      artifactsDemo.reset()
      runs.reset()
      demoSessions.reset()
      branch.reset()
      tasks = buildDemoTasks(moment, askedMoment, variant)
      applyReviewLimits(tasks, limitsMode)
      onChange()
    },
  }
}
