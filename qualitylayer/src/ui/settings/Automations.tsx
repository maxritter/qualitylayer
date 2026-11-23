// Settings › Automations: where a task's events go. Each automation sends to a URL (signed JSON,
// retried) or runs a command (the JSON on its input); the page lists them with their last delivery,
// adds, edits, tests and switches them, and shows the recent deliveries. It changes the same file
// as `qualitylayer automations` (App Model: settings-automations, settings-automations-add,
// settings-automations-command).

import { PencilIcon, PlusIcon, SendIcon, TriangleAlertIcon, WebhookIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { Api, AutomationsApi, AutomationsReply, AutomationView, DeliveryView } from "../api.ts"
import { subscribeEventCount } from "../hooks.ts"
import { AutomationForm } from "./AutomationForm.tsx"
import {
  AutomationDeliveries,
  AutomationIconAction,
  AutomationsCliGroup,
  automationFailure,
  automationKindIcon,
} from "./AutomationFormParts.tsx"
import { SettingRow, SettingsGroup } from "./Rows.tsx"
import "./automations.css"
import { agoText } from "./usage-model.ts"

const ICON = "size-[15px]"
const SMALL = "size-3.5"

type Reading =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; reply: AutomationsReply; deliveries: DeliveryView[] }

function subscribeAutomationsRefresh(load: () => Promise<void>): () => void {
  let running = false
  const again = () => {
    if (running || document.visibilityState === "hidden") return
    running = true
    void load().finally(() => {
      running = false
    })
  }
  document.addEventListener("visibilitychange", again)
  window.addEventListener("focus", again)
  const unsubscribe = subscribeEventCount("automations", again)
  return () => {
    document.removeEventListener("visibilitychange", again)
    window.removeEventListener("focus", again)
    unsubscribe()
  }
}

/** The automations and the recent deliveries as the server has them, and a way to read them again. */
function useAutomations(api: AutomationsApi | undefined) {
  const [reading, setReading] = useState<Reading>({ status: "loading" })
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const load = useCallback(async () => {
    if (api === undefined) {
      setReading({ status: "failed" })
      return
    }
    try {
      const [reply, deliveries] = await Promise.all([api.list(), api.deliveries()])
      if (live.current) setReading({ status: "ready", reply, deliveries })
    } catch {
      if (live.current) setReading((was) => (was.status === "ready" ? was : { status: "failed" }))
    }
  }, [api])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => subscribeAutomationsRefresh(load), [load])
  return { reading, load }
}

function eventsText(automation: AutomationView, all: number): string {
  const { events } = automation
  if (events === "all" || events.length >= all) return "All events"
  return `${events.length} ${events.length === 1 ? "event" : "events"}`
}

function projectsText(automation: AutomationView, reply: AutomationsReply): string | null {
  if (automation.projects === "all") return null
  return automation.projects
    .map((id) => reply.projects.find((project) => project.id === id)?.name ?? id)
    .join(", ")
}

function lastText(automation: AutomationView, now: number): string {
  if (!automation.on) return "Off"
  if (automation.last === null) return "Not sent yet"
  const ago = agoText(automation.last.at, now) ?? "just now"
  return `${automation.kind === "url" ? "Sent" : "Ran"} ${ago}`
}

function AutomationRow({
  automation,
  reply,
  onTest,
  onEdit,
  onSwitch,
}: {
  automation: AutomationView
  reply: AutomationsReply
  onTest: () => void
  onEdit: () => void
  onSwitch: (on: boolean) => void
}) {
  const now = Date.now()
  const limit = projectsText(automation, reply)
  return (
    <div className={automation.on ? "au-row" : "au-row off"}>
      <SettingRow
        testId={`automation-${automation.id}`}
        icon={automationKindIcon(automation.kind)}
        label={
          <span className="au-target" title={automation.target}>
            {automation.target}
          </span>
        }
        hint={
          automation.failing !== null && automation.on ? (
            <span className="au-fail" role="status">
              <TriangleAlertIcon className={SMALL} aria-hidden="true" />
              {automation.failing}
            </span>
          ) : (
            `${eventsText(automation, reply.events.length)}${limit === null ? "" : ` · ${limit}`} · ${lastText(automation, now)}`
          )
        }
      >
        <span className="au-acts">
          <AutomationIconAction label="Send a test event" onClick={onTest}>
            <SendIcon className={SMALL} aria-hidden="true" />
          </AutomationIconAction>
          <AutomationIconAction label="Edit" onClick={onEdit}>
            <PencilIcon className={SMALL} aria-hidden="true" />
          </AutomationIconAction>
          <Switch
            checked={automation.on}
            aria-label={`Send to ${automation.target}`}
            onCheckedChange={onSwitch}
          />
        </span>
      </SettingRow>
    </div>
  )
}

async function toggleAutomation(
  automations: AutomationsApi,
  id: string,
  patch: Parameters<AutomationsApi["change"]>[1],
  load: () => Promise<void>,
) {
  try {
    await automations.change(id, patch)
  } catch (cause) {
    toast.error(automationFailure(cause, "The change was not saved. Try again."))
  }
  await load()
}

async function runAutomationTest(
  automations: AutomationsApi,
  automation: AutomationView,
  load: () => Promise<void>,
) {
  try {
    const sent = await automations.test(automation.id)
    if (sent.delivered) toast.success(`Test event sent · ${sent.result}`)
    else toast.error(`Test event failed · ${sent.result}`)
  } catch (cause) {
    toast.error(automationFailure(cause, "The test could not be sent. Try again."))
  }
  await load()
}

export function AutomationsTab({
  api,
  onCopy,
}: {
  api?: Api | undefined
  onCopy: (text: string, note: string) => unknown
}) {
  const automations = api?.automations
  const { reading, load } = useAutomations(automations)
  const [form, setForm] = useState<{ editing: AutomationView | null } | null>(null)

  if (reading.status !== "ready" || automations === undefined) {
    return (
      <div className="q-sgs">
        <SettingsGroup title="Your automations" testId="automations-list">
          {reading.status === "loading" ? (
            <p role="status" className="q-sg-foot">
              Looking for your automations…
            </p>
          ) : (
            <p role="alert" className="q-sg-foot q-sg-problem">
              The App could not read your automations. Try again in a moment.
            </p>
          )}
        </SettingsGroup>
      </div>
    )
  }

  const { reply, deliveries } = reading
  const rows = reply.automations
  const anyFailing = rows.some((row) => row.on && row.failing !== null)
  const open = (editing: AutomationView | null) => setForm({ editing })
  const headerEnd =
    rows.length > 0 ? (
      <>
        {rows.length}
        {form === null ? (
          <Button type="button" variant="outline" size="sm" onClick={() => open(null)}>
            <PlusIcon aria-hidden="true" />
            Add
          </Button>
        ) : null}
      </>
    ) : undefined

  return (
    <div className="q-sgs">
      <SettingsGroup title="Your automations" testId="automations-list" end={headerEnd}>
        {reply.problem !== undefined ? (
          <p role="alert" className="q-sg-foot q-sg-problem">
            {reply.problem}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <SettingRow
            icon={<WebhookIcon className={ICON} />}
            label="No automation yet"
            hint="Send task events to a URL, or run a command when something happens."
          >
            <Button type="button" onClick={() => open(null)}>
              <PlusIcon aria-hidden="true" />
              Add automation
            </Button>
          </SettingRow>
        ) : (
          rows.map((row) => (
            <AutomationRow
              key={row.id}
              automation={row}
              reply={reply}
              onTest={() => void runAutomationTest(automations, row, load)}
              onEdit={() => open(row)}
              onSwitch={(on) => void toggleAutomation(automations, row.id, { on }, load)}
            />
          ))
        )}
        {rows.length > 0 ? (
          <AutomationDeliveries deliveries={deliveries} open={anyFailing} />
        ) : null}
      </SettingsGroup>
      {form !== null ? (
        <AutomationForm
          key={form.editing?.id ?? "new"}
          api={automations}
          reply={reply}
          editing={form.editing}
          onCopy={onCopy}
          onClose={(saved) => {
            setForm(null)
            if (saved) void load()
          }}
        />
      ) : null}
      <AutomationsCliGroup onCopy={onCopy} />
    </div>
  )
}
