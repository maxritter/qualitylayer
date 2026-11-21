// Settings › Git and editor: git and the GitHub CLI with their state, where files and folders open,
// and whether QualityLayer watches a task's pull request (App Model: settings-git).

import {
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { EDITOR_NAMES, EDITORS } from "../../core/config-values.ts"
import type { GhStatus, GitStatus, ToolsStatus } from "../../core/tools-status.ts"
import type { Api, Config } from "../api.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { CustomEditorFields } from "./CustomEditorFields.tsx"
import { Pick, SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"
import "./source.css"
import { agoText } from "./usage-model.ts"

type ToolsApi = Pick<Api, "tools" | "checkTools">

/** Where a file opens, as an icon in the list and on the button: an editor, the Finder, the Terminal. */
const OPEN_ICON = "size-3.5"
const EDITOR_ICONS: Record<(typeof EDITORS)[number], ReactNode> = {
  vscode: <FileCodeIcon className={OPEN_ICON} />,
  custom: <FileCodeIcon className={OPEN_ICON} />,
  cursor: <FileCodeIcon className={OPEN_ICON} />,
  zed: <FileCodeIcon className={OPEN_ICON} />,
  finder: <FolderOpenIcon className={OPEN_ICON} />,
  terminal: <SquareTerminalIcon className={OPEN_ICON} />,
}

type Reading =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; tools: ToolsStatus }

/** git and `gh` as the server last read them, and a way to read them afresh. */
function useTools(api: ToolsApi | undefined) {
  const [reading, setReading] = useState<Reading>({ status: "loading" })
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let live = true
    if (api?.tools === undefined) {
      setReading({ status: "failed" })
      return
    }
    api.tools().then(
      (tools) => live && setReading({ status: "ready", tools }),
      () => live && setReading({ status: "failed" }),
    )
    return () => {
      live = false
    }
  }, [api])
  const check = useCallback(async () => {
    if (api?.checkTools === undefined) return
    setChecking(true)
    try {
      setReading({ status: "ready", tools: await api.checkTools() })
    } catch {
      // The reading before stays on show.
    } finally {
      setChecking(false)
    }
  }, [api])
  return { reading, checking, check }
}

/** The GitHub mark: Simple Icons 16.35.0 (CC0 1.0), see THIRD_PARTY_NOTICES.md. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  )
}

function ToolRow({
  mark,
  name,
  version,
  state,
  icon,
  need,
  testId,
}: {
  mark: ReactNode
  name: string
  version: string | null
  /** What the tool's state says on the right. */
  state: string
  /** The state's icon: neutral when fine, amber when it needs a person, dashed when absent. */
  icon: ReactNode
  /** Something to do about it, when it is not fine. */
  need?: ReactNode
  testId: string
}) {
  return (
    <div className="q-tool" data-testid={testId}>
      <span className="q-tool-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="q-tool-what">
        <b>{name}</b>
        {version !== null ? <code>{version}</code> : null}
        {need !== undefined ? <span className="q-tool-need">{need}</span> : null}
      </span>
      <span className="q-tool-state">
        {icon}
        {state}
      </span>
    </div>
  )
}

const STATE_ICON = "size-3.5"
const FINE = <CircleCheckIcon className={STATE_ICON} aria-hidden="true" />
const ABSENT = <CircleDashedIcon className={STATE_ICON} aria-hidden="true" />
const NEEDS_YOU = <TriangleAlertIcon className={`${STATE_ICON} q-missing`} aria-hidden="true" />

function gitState(git: GitStatus) {
  return git.available
    ? { state: "Available", icon: FINE, need: undefined }
    : {
        state: "Not installed",
        icon: ABSENT,
        need: "QualityLayer needs git to work with your repositories.",
      }
}

function ghState(gh: GhStatus) {
  if (!gh.available)
    return {
      state: "Not installed",
      icon: ABSENT,
      need: "Without the GitHub CLI, pull requests are not opened or followed.",
    }
  if (!gh.signedIn)
    return {
      state: "Not signed in",
      icon: NEEDS_YOU,
      need: (
        <>
          Run <code>gh auth login</code> in a terminal.
        </>
      ),
    }
  return {
    state: gh.account === null ? "Signed in" : `Signed in as ${gh.account}`,
    icon: FINE,
    need: undefined,
  }
}

function Tools({ api }: { api: ToolsApi | undefined }) {
  const { reading, checking, check } = useTools(api)
  const tools = reading.status === "ready" ? reading.tools : null
  return (
    <SettingsGroup
      title="Tools"
      testId="git-tools"
      end={
        <>
          {checking || reading.status === "loading"
            ? "checking…"
            : `checked ${agoText(tools?.checkedAt ?? null, Date.now()) ?? "just now"}`}{" "}
          ·{" "}
          <button
            type="button"
            className="q-link"
            disabled={checking || api?.checkTools === undefined}
            onClick={() => void check()}
          >
            Check again
          </button>
        </>
      }
    >
      {reading.status === "failed" ? (
        <p role="alert" className="q-sg-foot q-sg-problem">
          The App could not read git and the GitHub CLI. Check again in a moment.
        </p>
      ) : tools === null ? (
        <p role="status" className="q-sg-foot">
          Looking for git and the GitHub CLI…
        </p>
      ) : (
        <>
          <ToolRow
            testId="tool-git"
            mark={<GitBranchIcon className="size-[15px]" />}
            name="Git"
            version={tools.git.version}
            {...gitState(tools.git)}
          />
          <ToolRow
            testId="tool-gh"
            mark={<GitHubMark />}
            name="GitHub CLI"
            version={tools.gh.version}
            {...ghState(tools.gh)}
          />
        </>
      )}
    </SettingsGroup>
  )
}

export function GitTab({
  config,
  api,
  onChange,
}: {
  config: Config
  api?: ToolsApi | undefined
  onChange: (patch: unknown) => unknown
}) {
  const [editingCustom, setEditingCustom] = useState(false)
  const permitted = useOptionalRuns()?.support?.canConfigure === true
  const custom = editingCustom || config.editor === "custom"
  return (
    <div className="q-sgs">
      <Tools api={api} />
      <SettingsGroup title="Files and pull requests" testId="git-files">
        <SettingRow
          label="Open files and folders in"
          hint="Used by Open in the Files tab, Review the code and file chips."
          icon={<ExternalLinkIcon className="size-[15px]" />}
        >
          <Pick
            label="Open files and folders in"
            value={custom ? "custom" : config.editor}
            options={EDITORS.map((id) => ({
              id,
              name: EDITOR_NAMES[id],
              icon: EDITOR_ICONS[id],
            }))}
            onChange={(editor) => {
              setEditingCustom(editor === "custom")
              if (editor !== "custom") onChange({ editor })
            }}
          />
        </SettingRow>
        {custom && (
          <CustomEditorFields initial={config.customEditor} permitted={permitted} save={onChange} />
        )}
        <SettingRow
          label="Watch pull requests"
          hint="Checked every 2 minutes. A failing check, requested changes or a conflict goes to Needs you; these and reviewers' new comments wake the agent."
          icon={<GitPullRequestIcon className="size-[15px]" />}
          testId="watch-pull-requests"
          stay
        >
          <Switch
            checked={config.pullRequests.watch}
            aria-label="Watch pull requests"
            onCheckedChange={(watch) => onChange({ pullRequests: { watch } })}
          />
        </SettingRow>
        <SettingsMore summary="Limits on waking the agent">
          <p className="q-sg-foot" data-testid="watch-limits">
            Checked while QualityLayer is open and a task's pull request is open. Each event wakes
            the agent once, never with less than 10 % of the plan left. Checks, change requests and
            conflicts wake it up to 3 times a day per pull request. People's comments wake it up to
            2 more times, once they pause for 5 minutes; bots' comments never do. A stopped session
            is resumed for it; none is kept running while it waits.
          </p>
        </SettingsMore>
      </SettingsGroup>
    </div>
  )
}
