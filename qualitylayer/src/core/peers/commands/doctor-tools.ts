import agents from "../../agents/agents.json" with { type: "json" }
import { AGENT_NAMES } from "../../agents/ids.ts"
import { windows } from "../../platform.ts"
import { windowsProcesses } from "../../windows-processes.ts"
import {
  CLAUDE_CODE_TESTED,
  CODEX_TESTED,
  claudeConfigDir,
  codexHome,
  runCmd,
  stateDir,
  toolVersion,
  versionIsNewer,
} from "../base.ts"
import { procStartChecked } from "../claude.ts"
import { codexSqliteHome } from "../codex.ts"
import { isHookPeerKind, NATIVE_KINDS, nativeRegistrations } from "../native.ts"
import type { AddCheck } from "./doctor.ts"
export function reportTools(add: AddCheck): void {
  const claudeV = toolVersion("claude")
  const codexV = toolVersion("codex")
  add(
    claudeV && versionIsNewer(claudeV, CLAUDE_CODE_TESTED) ? "warn" : "ok",
    `Claude Code ${claudeV ?? "not on PATH"} (tested against ${CLAUDE_CODE_TESTED})`,
  )
  add(
    codexV && versionIsNewer(codexV, CODEX_TESTED) ? "warn" : "ok",
    `Codex CLI ${codexV ?? "not on PATH"} (tested against ${CODEX_TESTED})`,
  )
  reportNativeTools(add)
  add(codexV ? "ok" : "fail", "codex on PATH")
  reportPlatform(add)
}

function reportNativeTools(add: AddCheck): void {
  const native = nativeRegistrations()
  for (const kind of NATIVE_KINDS) {
    // The hook agents register from their hooks; a missing one shows as no sessions.
    if (!isHookPeerKind(kind)) {
      const version = toolVersion(kind)
      const tested = agents[kind].qualifiedVersion
      add(
        version && versionIsNewer(version, tested) ? "warn" : version ? "ok" : "info",
        `${AGENT_NAMES[kind]} ${version ?? "not on PATH"} (tested against ${tested})`,
      )
    }
    const registered = native.filter((row) => row.kind === kind)
    add("ok", `${AGENT_NAMES[kind]}: ${registered.length} native peer session(s) registered`)
    for (const row of registered)
      add("ok", `${row.name}: ${row.status}; native session ${row.session}`)
  }
}

function reportPlatform(add: AddCheck): void {
  if (windows) {
    const [, error] = windowsProcesses()
    add(error === null ? "ok" : "fail", `Windows process query${error ? `: ${error}` : ""}`)
  } else
    add(
      runCmd(["lsof", "-v"])[0] !== 127 ? "ok" : "fail",
      "lsof on PATH (thread liveness needs it)",
    )
  const [, psError] = procStartChecked(process.pid)
  add(psError ? "fail" : "ok", `process-start probe${psError ? `: unavailable (${psError})` : ""}`)
  add("ok", `CLAUDE_CONFIG_DIR: ${claudeConfigDir()}`)
  add("ok", `CODEX_HOME: ${codexHome()}`)
  if (codexSqliteHome() !== codexHome()) add("ok", `codex sqlite_home: ${codexSqliteHome()}`)
  add("ok", `bridge state: ${stateDir()}`)
}
