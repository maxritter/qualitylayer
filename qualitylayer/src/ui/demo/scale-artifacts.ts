// The Library of `?scale=large` (scale.ts): 15 projects with 32 lasting artifacts each, long
// names and purposes, a few drafts, and the artifacts the team shared. A generated artifact is the
// demo's own lasting artifact under a new name, so it opens with the pages and the history of that
// one.

import type {
  ArtifactsOverview,
  BrokenArtifact,
  LastingArtifact,
  ProjectArtifacts,
} from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import { LARGE_PROJECTS } from "./scale-tasks.ts"

const SUBJECTS = [
  "Quarterly planning workbook for the payments and platform reliability programme",
  "Checkout flow",
  "Invoice and receipt layouts for every region we bill in, with the legal footers",
  "Design system tokens and the components that use them across the web and mobile apps",
  "Onboarding",
  "API reference",
  "Admin console navigation and permission model",
  "Incident review template",
  "Billing mode switch and its audit trail",
  "Release checklist for the monthly platform train",
  "Customer data export and the archive format we hand back",
  "Status page",
  "Settings pages for notification channels, quiet hours and digests",
  "Data retention schedule by table",
  "Support macros",
  "Team directory",
]

const PURPOSES = [
  "The screens, the states between them and the copy each one carries, kept in one place so the app and the docs say the same thing.",
  "What the person sees and does at each step, with the empty, loading and error states drawn next to the happy path.",
  "The decisions the team made, who made them, and the date they were last confirmed against the running product.",
  "A short reference.",
  "Everything a new engineer needs on their first day: where things live, how to run them and who to ask when they do not.",
]

const QUALIFIERS = [
  "EMEA rollout",
  "mobile",
  "enterprise accounts",
  "draft for review",
  "after the migration",
  "second pass",
  "for the support team",
]

const MOMENTS_AGO = [3, 11, 26, 48, 120, 250, 600, 2000]

/** The artifacts of one project: the demo's own first, then generated ones up to `count`. */
function lastingOf(
  project: string,
  own: (LastingArtifact | BrokenArtifact)[],
  templates: LastingArtifact[],
  count: number,
  now: number,
): (LastingArtifact | BrokenArtifact)[] {
  const made = Array.from({ length: Math.max(0, count - own.length) }, (_, at): LastingArtifact => {
    const template = templates[at % templates.length] as LastingArtifact
    const subject = SUBJECTS[(at * 5 + project.length) % SUBJECTS.length] as string
    const pages = template.pages.slice(0, 1 + (at % 4))
    const name = `${slug(subject).slice(0, 40)}-${at + 1}`
    return {
      ...structuredClone(template),
      name,
      title: `${subject}${at >= SUBJECTS.length ? ` · ${QUALIFIERS[at % QUALIFIERS.length]}` : ""}`,
      purpose: PURPOSES[(at + project.length) % PURPOSES.length] as string,
      folder: `.qualitylayer/artifacts/${name}`,
      pages: pages.map((page) => ({ ...page, file: page.file.replace(template.name, name) })),
      entry: template.entry,
      updated: now - (MOMENTS_AGO[at % MOMENTS_AGO.length] as number) * 3_600_000,
      lastChange: null,
      changing: [],
      alsoIn: [],
    }
  })
  return [...own, ...made]
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

const EXTRA_PROJECTS = [
  { id: "legacy-admin", name: "acme/legacy-admin-console-and-reporting-tools" },
  { id: "partners", name: "acme/partner-portal" },
  { id: "tokens", name: "design-systems/tokens" },
]

type MadeTemplate = { project: string; template: LastingArtifact }

function buildLargeOverview(
  base: ArtifactsOverview,
  now: number,
  made: Map<string, MadeTemplate>,
): ArtifactsOverview {
  const templates = base.projects
    .flatMap((project) => project.lasting)
    .filter((entry): entry is LastingArtifact => !("broken" in entry))
  const ids = [...LARGE_PROJECTS, ...EXTRA_PROJECTS]
  const projects = ids.slice(0, 15).map((project): ProjectArtifacts => {
    const known = base.projects.find((item) => item.id === project.id)
    const own = known?.lasting ?? []
    const lasting = lastingOf(project.id, own, templates, 32 + (project.id.length % 5), now)
    for (const entry of lasting) {
      if ("broken" in entry || own.includes(entry)) continue
      const template =
        templates.find((t) => entry.pages[0]?.file.includes(t.name)) ??
        (templates[0] as LastingArtifact)
      made.set(entry.name, { project: project.id, template })
    }
    return {
      id: project.id,
      name: project.name,
      lasting,
      also: known?.also ?? [],
      personal: known?.personal ?? [],
      drafts: known?.drafts ?? [],
    }
  })
  return { ...base, projects }
}

export function largeArtifacts(api: Api, now: number): Partial<Api> {
  const made = new Map<string, MadeTemplate>()
  let kept: ArtifactsOverview | undefined
  const overview = async (): Promise<ArtifactsOverview> => {
    if (kept === undefined) kept = buildLargeOverview(await api.artifactsOverview(), now, made)
    return structuredClone(kept)
  }
  return {
    artifactsOverview: overview,
    lastingArtifact: async (project, name) => {
      const found = made.get(name)
      const all = await overview()
      const owner = all.projects.find((item) => item.id === project)
      const artifact = owner?.lasting.find((item) => item.name === name)
      if (found === undefined || owner === undefined || artifact === undefined)
        return api.lastingArtifact(project, name)
      return { project: { id: owner.id, name: owner.name }, artifact }
    },
    lastingHistory: async (project, name) => {
      const found = made.get(name)
      return found === undefined
        ? api.lastingHistory(project, name)
        : api.lastingHistory(found.template.name === name ? project : "web", found.template.name)
    },
    artifactPage: async (where, file) => {
      const name = /\.qualitylayer\/artifacts\/([^/]+)\//.exec(file)?.[1]
      const found = name === undefined ? undefined : made.get(name)
      return found === undefined
        ? api.artifactPage(where, file)
        : api.artifactPage(where, file.replace(name as string, found.template.name))
    },
  }
}
