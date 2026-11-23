import type { Project, TaskDetail } from "../api.ts"
import { setBranchApi } from "../start-branch.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { taskSections } from "./task/index.ts"
import { websiteBillingDiff } from "./website-diffs.ts"
import {
  agentDocumentsFor,
  DEMO_NAMES,
  documentsFor,
  HOMES,
  projectOfWorld,
  WEBSITE_FOLDED,
  WEBSITE_LOOKS,
  WEBSITE_SCENES,
  type WebsiteScene,
  WORLD,
  websiteLooks,
  websiteMoment,
  websiteScene,
} from "./website-gallery-data.ts"
import {
  buildArtifactOverrides,
  galleryEvidence,
  wrapGalleryProxy,
} from "./website-gallery-overrides.ts"
import { billingWalkthrough, websiteTask } from "./website-gallery-task.ts"

export {
  agentDocumentsFor,
  documentsFor,
  WEBSITE_FOLDED,
  WEBSITE_LOOKS,
  WEBSITE_SCENES,
  type WebsiteScene,
  websiteLooks,
  websiteMoment,
  websiteScene,
  websiteTask,
}

function rehomeRow<T extends { id: string; project: string; projectName: string }>(row: T): T {
  const home = projectOfWorld(HOMES[row.id] ?? row.project)
  if (home === undefined) return row
  let text = JSON.stringify(row)
  for (const old of DEMO_NAMES) text = text.replaceAll(old, home.name)
  return { ...(JSON.parse(text) as T), project: home.id, projectName: home.name }
}

function installGalleryBranch(slug: string): void {
  let branch = { branch: `feat/${slug}`, base: "main", onBase: false, suggested: `ql/${slug}` }
  setBranchApi({
    read: async () => ({ ...branch }),
    create: async (_id, name) => {
      branch = { ...branch, branch: name ?? branch.suggested }
      return { ...branch }
    },
  })
}

async function galleryWalkthrough(api: WalkthroughApi, scene: WebsiteScene, id: string) {
  if (id === DEMO_TASK_ID) return billingWalkthrough(scene === "verify" || scene === "pull-request")
  if (api.walkthrough) return api.walkthrough(id)
  throw new Error("This demo task has no recorded walkthrough")
}

async function gallerySections(
  api: WalkthroughApi,
  documents: Record<string, string>,
  task: TaskDetail,
  id: string,
  name: string,
) {
  const markdown = documents[name]
  if (id !== DEMO_TASK_ID || !markdown) return api.sections(id, name)
  const cut = taskSections(name, markdown, task.type)
  if (cut === undefined) throw new Error(`${name} does not exist yet`)
  return cut
}

export function websiteGalleryApi(
  api: WalkthroughApi,
  scene: WebsiteScene | undefined,
): WalkthroughApi {
  if (scene === undefined) return api
  const documents = documentsFor(scene)
  const task = rehomeRow(websiteTask(scene))
  installGalleryBranch(task.slug)
  const gallery: WalkthroughApi = {
    ...api,
    fileDiff: async (id, path) =>
      (id === DEMO_TASK_ID ? websiteBillingDiff(path) : undefined) ?? api.fileDiff(id, path),
    ...(scene === "verify" ? { currentTurnLayout: true as const } : {}),
    evidence: (id, name) => galleryEvidence(api, scene, id, name),
    projects: async () =>
      WORLD.map(
        ({ id, name }): Project => ({ id, name, paths: [`/workspace/${name}`], lastSeen: 0 }),
      ),
    tasks: async () =>
      (await api.tasks())
        .filter((row) => HOMES[row.id] !== null)
        .map((row) => rehomeRow(row.id === DEMO_TASK_ID ? task : row)),
    task: async (id) =>
      id === DEMO_TASK_ID ? structuredClone(task) : rehomeRow(await api.task(id)),
    walkthrough: (id) => galleryWalkthrough(api, scene, id),
    doc: async (id, name) =>
      id === DEMO_TASK_ID && documents[name]
        ? { name, markdown: documents[name], validation: { valid: true, errors: [] } }
        : api.doc(id, name),
    sections: (id, name) => gallerySections(api, documents, task, id, name),
    homeFacts: async (scope) => {
      const facts = await api.homeFacts(scope)
      return JSON.parse(JSON.stringify(facts).replaceAll("Usage-based billing", task.title))
    },
    ...buildArtifactOverrides(api, scene, task),
  }
  return wrapGalleryProxy(gallery, task)
}
