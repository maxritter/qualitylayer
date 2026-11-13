import type { Api, Licence } from "../api.ts"
import { DEMO_TASK_ID } from "../demo/identity.ts"

export type TourTier = "trial" | "solo" | "team" | null

const CONNECTED_TASKS = new Set([DEMO_TASK_ID, "product-brief"])

/**
 * The tour keeps its workflow tasks and the existing artifact example; the ordinary demo keeps its catalog.
 */
export function connectedTourCatalog(source: Api): Api {
  return {
    ...source,
    tasks: async () => (await source.tasks()).filter((task) => CONNECTED_TASKS.has(task.id)),
    projects: async () =>
      (await source.projects()).filter(
        (project) => project.id === "platform" || project.id === "web",
      ),
    homeFacts: (request) =>
      source.homeFacts({ ...request, project: request.project || "platform" }),
  }
}

/** Only a locally verified active Team entitlement adds the collaboration chapter. */
export function tourTier(licence: Licence | null | undefined): TourTier {
  if (licence?.state !== "active") return null
  return licence.tier === "team" || licence.tier === "solo" || licence.tier === "trial"
    ? licence.tier
    : null
}

/** Tier changes affect only the illustrative world, never the real account or task data. */
export function tourExampleApi(source: Api, tier: TourTier): Api {
  if (tier === "team") return source
  return {
    ...source,
    licence: async () => ({
      version: (await source.licence()).version,
      state: "active",
      tier: tier ?? undefined,
      name: "Sam Rivera",
      daysLeft: tier === "trial" ? 7 : null,
    }),
  }
}
