// The demo's lasting artifacts: an App Model, a Workflow and a Website kept by one project (the App Model
// is changing in two open tasks), a second project with one lasting artifact and a draft, and a project
// with none. Everything lives in memory: Keep adds an artifact, Fold in lands pages in one and moves its
// last change; a reset brings it back.

import type { LibraryMutation } from "../../core/artifact/library-manage.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import {
  ApiError,
  type DraftOnRequest,
  type FoldRequest,
  type KeepRequest,
  type NewArtifactRequest,
} from "../api.ts"
import { draftOnArtifact, foldDraft } from "./artifacts-draft-fold.ts"
import { createArtifact, keepArtifact, manageArtifact } from "./artifacts-manage.ts"
import {
  commit,
  type DemoArtifactsOptions,
  type DemoArtifactsStore,
  seedDemoArtifacts,
  seedPersonalArtifacts,
} from "./artifacts-seed.ts"
import {
  buildDraftsOf,
  buildFoldPreview,
  buildOverview,
  findLasting,
  renderArtifactPage,
} from "./artifacts-views.ts"
import { DEMO_TASK_ID } from "./identity.ts"

export type { DemoArtifactsOptions }

export function createDemoArtifacts(options: DemoArtifactsOptions) {
  const now = options.now ?? (() => Date.now())
  const opened = now()
  const personalSeed = seedPersonalArtifacts(options.story)
  const store: DemoArtifactsStore = {
    now,
    opened,
    state: seedDemoArtifacts(opened, options.reviewing, options.story),
    kept: [],
    personal: [...personalSeed],
    folded: new Set<string>(),
    moved: new Set<string>(),
    lastSwitchShown: false,
    options,
  }

  return {
    overview: (looks: ProjectLooks) => buildOverview(store, looks),
    draftsOf: (task: string) => buildDraftsOf(store, task),
    draftOn: (task: string, project: string, request: DraftOnRequest) =>
      draftOnArtifact(store, task, project, request),
    history: (project: string, name: string) => {
      const artifact = findLasting(store, project, name)
      if (artifact === undefined)
        throw new ApiError(`${name} is not a lasting artifact of this project`, 404, "no_task")
      return { entries: structuredClone(artifact.history), truncated: false }
    },
    keep: (project: string, request: KeepRequest) => keepArtifact(store, project, request),
    manage: (project: string, name: string, request: LibraryMutation) =>
      manageArtifact(store, project, name, request),
    create: (project: string, request: NewArtifactRequest) =>
      createArtifact(store, project, request),
    foldPreview: (task: string, draft: string) =>
      structuredClone(buildFoldPreview(store, task, draft)),
    fold: (task: string, request: FoldRequest) => foldDraft(store, task, request),
    page: (file: string) => renderArtifactPage(store, file),
    showLastSwitch: () => {
      store.lastSwitchShown = true
      store.state.lasting
        .find((d) => d.name === "billing-admin")
        ?.history.unshift({
          sha: commit(14),
          at: now(),
          subject: "Show the last switch under the billing-mode button",
          task: {
            id: DEMO_TASK_ID,
            title: options.markOf(DEMO_TASK_ID)?.title ?? "Usage-based billing",
          },
        })
    },
    reset: () => {
      store.lastSwitchShown = false
      store.state = seedDemoArtifacts(now(), options.reviewing, options.story)
      store.kept.length = 0
      store.folded.clear()
      store.moved.clear()
      store.personal.splice(0, store.personal.length, ...personalSeed)
    },
  }
}

export type DemoArtifacts = ReturnType<typeof createDemoArtifacts>
