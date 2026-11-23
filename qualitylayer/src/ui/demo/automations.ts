// What Settings › Automations shows in the demo: the approved page's three automations (one of them
// failing) and its five recent deliveries, as the App Model's settings-automations page draws them.
// Adding, changing, testing and removing work in memory; nothing is sent and nothing is run.

import { PUBLIC_EVENTS } from "../../core/automations/events.ts"
import type {
  AutomationDraft,
  AutomationPatch,
  AutomationsApi,
  AutomationTest,
  AutomationView,
  DeliveryView,
} from "../api.ts"
import { AT } from "./story.ts"

/** The masked secret every demo URL shows; the whole one is only ever this made-up text. */
const MASKED = "••••••••••••a91f"
const WHOLE = "demo-signing-secret-do-not-use-0123456789abcdef"

const MAKE = (
  fields: Pick<AutomationView, "id" | "kind" | "target" | "events" | "projects"> &
    Partial<Pick<AutomationView, "last" | "failing">>,
): AutomationView => ({
  on: true,
  created: AT(600),
  last: null,
  failing: null,
  ...fields,
  ...(fields.kind === "url" ? { secret: MASKED } : {}),
})

/** The three automations of the draft: a URL, a command limited to one project, and a URL that is failing. */
function sampleRows(projectId: string): AutomationView[] {
  return [
    MAKE({
      id: "au_7k2m0001",
      kind: "url",
      target: "https://hooks.acme.test/qualitylayer",
      events: "all",
      projects: "all",
      last: { at: AT(2), result: "200", ok: true, event: "task.step_changed" },
    }),
    MAKE({
      id: "au_p41x0002",
      kind: "command",
      target: "./scripts/move-ticket.sh",
      events: ["task.created", "task.step_changed", "task.shipped"],
      projects: [projectId],
      last: { at: AT(2), result: "exit 0", ok: true, event: "task.step_changed" },
    }),
    MAKE({
      id: "au_d9wq0003",
      kind: "url",
      target: "https://n8n.acme.test/webhook/ql-tasks",
      events: ["question.asked", "approval.requested"],
      projects: "all",
      last: { at: AT(5), result: "503", ok: false, event: "approval.requested" },
      failing: "Failing since 09:12 · 503 · next try in 4 min",
    }),
  ]
}

/** The five recent deliveries of the draft, newest first. */
function sampleDeliveries(): DeliveryView[] {
  const line = (entry: DeliveryView): DeliveryView => entry
  return [
    line({
      at: AT(2),
      event: "task.step_changed",
      to: "hooks.acme.test",
      text: "200",
      ok: true,
      automation: "au_7k2m0001",
    }),
    line({
      at: AT(2),
      event: "task.step_changed",
      to: "move-ticket.sh",
      text: "exit 0",
      ok: true,
      automation: "au_p41x0002",
    }),
    line({
      at: AT(5),
      event: "approval.requested",
      to: "n8n.acme.test",
      text: "503 · try 3 of 6",
      ok: false,
      automation: "au_d9wq0003",
    }),
    line({
      at: AT(5),
      event: "approval.requested",
      to: "hooks.acme.test",
      text: "200",
      ok: true,
      automation: "au_7k2m0001",
    }),
    line({
      at: AT(30),
      event: "question.asked",
      to: "n8n.acme.test",
      text: "503 · try 6 of 6, given up",
      ok: false,
      automation: "au_d9wq0003",
    }),
  ]
}

const receiver = (kind: "url" | "command", target: string): string => {
  if (kind === "command") return target.trim().split(/\s+/)[0]?.split("/").at(-1) ?? target
  try {
    return new URL(target).host
  } catch {
    return target
  }
}

export function createDemoAutomations(
  projects: { id: string; name: string }[],
  onChange: () => void = () => {},
): AutomationsApi {
  // The command's project limit is the demo's own first project.
  let rows = sampleRows(projects[0]?.id ?? "")
  let deliveries = sampleDeliveries()
  let count = 0
  const find = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id)
    if (row === undefined) throw new Error(`No automation "${id}".`)
    return row
  }
  const clone = <T>(value: T): T => structuredClone(value)
  const tested = (kind: "url" | "command", target: string, id: string | null): AutomationTest => {
    const result = kind === "url" ? "200" : "exit 0"
    deliveries = [
      {
        at: Date.now(),
        event: "automation.test",
        to: receiver(kind, target),
        ok: true,
        text: result,
        automation: id,
      },
      ...deliveries,
    ].slice(0, 10)
    onChange()
    return { event: "automation.test", delivery: `evt_demo_${++count}`, result, delivered: true }
  }
  return {
    list: async () => ({
      automations: clone(rows),
      events: [...PUBLIC_EVENTS],
      projects: clone(projects),
    }),
    deliveries: async (automation) =>
      clone(
        deliveries.filter((line) => automation === undefined || line.automation === automation),
      ),
    add: async (draft: AutomationDraft) => {
      if (draft.target.trim() === "") throw new Error("Give the target to send to.")
      const added = MAKE({
        id: `au_demo${String(++count).padStart(4, "0")}`,
        kind: draft.kind,
        target: draft.target.trim(),
        events: draft.events,
        projects: draft.projects,
      })
      rows = [...rows, added]
      onChange()
      return clone(added)
    },
    change: async (id: string, patch: AutomationPatch) => {
      const old = find(id)
      const kind = patch.kind ?? old.kind
      const next: AutomationView = {
        ...old,
        kind,
        target: patch.target ?? old.target,
        events: patch.events ?? old.events,
        projects: patch.projects ?? old.projects,
        on: patch.on ?? old.on,
      }
      if (kind === "url") next.secret = MASKED
      else delete next.secret
      rows = rows.map((row) => (row.id === id ? next : row))
      onChange()
      return clone(next)
    },
    remove: async (id: string) => {
      find(id)
      rows = rows.filter((row) => row.id !== id)
      deliveries = deliveries.filter((line) => line.automation !== id)
      onChange()
    },
    test: async (id: string) => {
      const row = find(id)
      return tested(row.kind, row.target, id)
    },
    testDraft: async (draft) => tested(draft.kind, draft.target, null),
    secret: async (id: string) => {
      if (find(id).kind !== "url")
        throw new Error(`${id} runs a command: a command has no signing secret.`)
      return WHOLE
    },
  }
}
