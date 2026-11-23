import { lastingDocOf } from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import type { ArtifactFeedbackAddress } from "../artifact/feedback-api.ts"
import type { DemoLocalSource } from "./artifact-feedback.ts"
import { FLAGSHIP_ARTIFACTS } from "./flagship.ts"
import { DEMO_TASK_ID } from "./task/index.ts"

const pageNameOf = (file: string) => file.split("/").at(-1) ?? file

async function projectArtifactSource(
  api: Api,
  address: ArtifactFeedbackAddress,
): Promise<DemoLocalSource> {
  const project = (await api.artifactsOverview()).projects.find((row) => row.id === address.id)
  if (!project) throw new Error("This illustrative project is unavailable.")
  const named = lastingDocOf(address.file)
  const artifact = named
    ? project.lasting.find((row) => !("broken" in row) && row.name === named.name)
    : project.personal.find((row) => row.file === address.file)
  if (
    !artifact ||
    "broken" in artifact ||
    ("deletedAt" in artifact && artifact.deletedAt !== undefined)
  )
    throw new Error("This illustrative artifact is unavailable.")
  const pages = artifact.pages?.map((page) => page.page) ?? [pageNameOf(address.file)]
  if (!pages.includes(address.file.split("/").at(-1) ?? ""))
    throw new Error("This illustrative artifact page is unavailable.")
  const recorded =
    artifact.revision ?? ("managerRevision" in artifact ? artifact.managerRevision : undefined)
  return { title: artifact.title, pages, revision: await revision(api, address, recorded) }
}

async function taskArtifactSource(
  api: Api,
  address: ArtifactFeedbackAddress,
): Promise<DemoLocalSource> {
  const artifacts = (await api.taskArtifacts(address.id)).task
  const artifact = artifacts.find(
    (row) => row.file === address.file || row.pages?.some((page) => page.file === address.file),
  )
  if (!artifact) {
    if (address.id !== DEMO_TASK_ID || !Object.hasOwn(FLAGSHIP_ARTIFACTS, address.file))
      throw new Error("This illustrative task artifact is unavailable.")
    return {
      title: "Task artifact",
      pages: [pageNameOf(address.file)],
      revision: await revision(api, address, undefined),
    }
  }
  return {
    title: artifact.title,
    pages: artifact.pages?.map((page) => page.page) ?? [pageNameOf(address.file)],
    revision: await revision(api, address, artifact.revision),
  }
}

/** Resolve registered demo identities only, so one page names its whole artifact. */
export async function demoArtifactSource(
  api: Api,
  address: ArtifactFeedbackAddress,
): Promise<DemoLocalSource> {
  if (address.scope === "project") return projectArtifactSource(api, address)
  return taskArtifactSource(api, address)
}

async function revision(
  api: Api,
  address: ArtifactFeedbackAddress,
  recorded: unknown,
): Promise<string> {
  if (typeof recorded === "string" && /^[a-f0-9]{64}$/.test(recorded)) return recorded
  const html = await api.artifactPage(address, address.file)
  if (html.length > 2 * 1024 * 1024)
    throw new Error("This illustrative page exceeds the demo limit.")
  const bytes = new TextEncoder().encode(html)
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new Error("This illustrative page exceeds the demo limit.")
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
