// Settings › About › Server: the port the App and browsers use on this computer (the setting, 1024 to
// 65535, with Restart on N), and the port in use now with its address. When the server could not have
// the port it wanted it says so, and the setting stays what the person set. The page reads the server
// when it opens and never again on a timer (App Model: settings-server-port).
//
// Applying a port saves the setting and restarts the server. The App's window follows the new server
// by itself; a browser tab may reach this machine through a forwarded port, so it is given a link to
// the new port instead of being sent there.

import { useState } from "react"
import { fellBackWords, parsePort } from "../../core/server-port.ts"
import type { Api } from "../api.ts"
import { routeHash, useQuery } from "../hooks.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { machineFrame } from "../machines/framed.ts"
import { SettingsGroup, SettingsMore } from "./Rows.tsx"
import { ServerInUseRow, type ServerPortPhase, ServerPortSettingRow } from "./ServerPortRows.tsx"
import "./server-port.css"

export const REMOTE_DOCS_URL = "https://qualitylayer.dev/docs/install#port"

/** Why a save or restart did not go through, in words. */
const whyOf = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The server did not answer. If it restarted, open the QualityLayer App again."

async function runServerRestart(params: {
  api: Pick<Api, "serverPort" | "restartServer">
  port: number
  save: boolean
  onSave: (patch: unknown) => unknown
  setPhase: (phase: ServerPortPhase) => void
  setNow: (now: { port: number; wanted: number }) => void
}): Promise<void> {
  params.setPhase({ at: "restarting", to: params.port })
  try {
    if (params.save) {
      const refused = await params.onSave({ cockpit: { port: params.port } })
      if (typeof refused === "string") {
        params.setPhase({ at: "failed", why: refused })
        return
      }
    }
    const moved = await params.api.restartServer?.()
    if (moved === undefined) throw new Error("The server cannot be restarted from here.")
    params.setNow({ port: moved.port, wanted: moved.wanted })
    params.setPhase({ at: "done", to: moved.port, url: moved.url })
  } catch (cause) {
    params.setPhase({ at: "failed", why: whyOf(cause) })
  }
}

export function ServerPortGroup({
  api,
  setting,
  onSave,
  onCopy,
  inApp,
}: {
  api: Pick<Api, "serverPort" | "restartServer">
  /** The port the settings hold (`cockpit.port`). */
  setting: number
  /** Saves a settings patch; answers why it was refused, or null when it was kept. */
  onSave: (patch: unknown) => unknown
  /** Copies text, saying that it did. */
  onCopy: (text: string, note: string) => unknown
  /** The App's own window: it follows the restarted server by itself. */
  inApp: boolean
}) {
  const read = useQuery(() => Promise.resolve().then(() => api.serverPort?.() ?? null), [])
  const view = read.data
  const [draft, setDraft] = useState(String(setting))
  const [phase, setPhase] = useState<ServerPortPhase>({ at: "idle" })
  const [now, setNow] = useState<{ port: number; wanted: number } | null>(null)

  const typed = draft.trim()
  const parsed = parsePort(typed)
  const problem = typed !== "" && parsed === null
  const changed = parsed !== null && parsed !== setting
  const byEnvironment = view?.from === "environment"
  const busy = phase.at === "restarting"
  const done = phase.at === "done"

  const restart = (nextPort: number, save: boolean) =>
    void runServerRestart({ api, port: nextPort, save, onSave, setPhase, setNow })

  const port = now?.port ?? view?.port
  const wanted = now?.wanted ?? view?.wanted
  const fell = port === undefined || wanted === undefined ? null : fellBackWords(wanted, port)
  const address = port === undefined ? null : `http://127.0.0.1:${port}`
  const hasView = view !== null && view !== undefined
  const canRetry = !byEnvironment && !busy && !done && hasView

  return (
    <SettingsGroup
      testId="server-port"
      title="Server"
      end={
        busy ? (
          <>
            <WhoMark who="agent" running />
            Restarting
          </>
        ) : undefined
      }
    >
      <ServerPortSettingRow
        draft={draft}
        parsed={parsed}
        setting={setting}
        problem={problem}
        changed={changed}
        byEnvironment={byEnvironment}
        phase={phase}
        inApp={inApp}
        view={view}
        onDraft={(next) => {
          setDraft(next)
          if (phase.at === "failed") setPhase({ at: "idle" })
        }}
        onRestart={(nextPort) => void restart(nextPort, true)}
      />
      <ServerInUseRow
        loading={read.loading}
        address={address}
        fell={fell}
        byEnvironment={byEnvironment}
        setting={setting}
        canRetry={canRetry}
        onRetry={() => void restart(setting, false)}
        onCopy={onCopy}
      />
      <SettingsMore summary="Ports and remote machines">
        <p className="q-sg-foot">
          Use a whole number from 1024 to 65535.{" "}
          {machineFrame() === null ? (
            <>
              Other machines are added under{" "}
              <button
                type="button"
                className="q-link"
                onClick={() => {
                  window.location.hash = routeHash({ view: "settings", tab: "machines" })
                }}
              >
                Machines
              </button>
              .{" "}
            </>
          ) : null}
          Without the App, give each machine its own port and forward it.{" "}
          <a className="q-link" href={REMOTE_DOCS_URL} target="_blank" rel="noopener noreferrer">
            Remote and SSH
          </a>
        </p>
      </SettingsMore>
    </SettingsGroup>
  )
}
