// Updates in the page. The desktop shell checks every hour and downloads in the background; the page
// only shows what it found. "Update ready · beta.14" sits above the name until the person updates or
// chooses Later, and the sheet says what is new and what will happen. Once the release is BAR_AFTER_DAYS
// old, a bar opens above the page (the accent after OVERDUE_AFTER_DAYS), and a bug report says a newer
// version is ready. Later hides the line and the bar for a day. Nothing here pops up or notifies: the
// App installs only on Restart and update.

import { DownloadIcon } from "lucide-react"
import { type ReactNode, useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { RELEASE_REPO, type Release } from "../core/update/notes.ts"
import { releaseOf } from "../core/update/versions.ts"
import { updateWait } from "../core/update/wait.ts"
import type { Api, UpdateInfo } from "./api.ts"
import { useQuery } from "./hooks.ts"
import { useUpdatedToast, useUpdateStateTracking } from "./updates-effects.ts"
import { releasesWord, UpdateBar, UpdateSheet } from "./updates-sheet.tsx"

export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases/tag`
export const DOWNLOAD_URL = "https://qualitylayer.dev/download"

/** `12.0.0-beta.14` is `beta.14` in a line that has little room; a release keeps its number. */
export const shortVersion = (version: string): string => version.replace(/^\d+\.\d+\.\d+-/, "")

const FAILURE_REASONS: Record<string, string> = {
  signature:
    "The download could not be checked against QualityLayer's signature, so nothing was changed.",
  network: "The network stopped before the download finished, so nothing was changed.",
  download: "The download did not finish, so nothing was changed.",
  install: "The App could not be replaced, so nothing was changed.",
}

/** What the failure code says happened; only a failed restart comes after a change. */
export function failureSentence(code: string | undefined, current: string): string {
  if (code === "restart") {
    return "The update was installed, but QualityLayer could not restart. Quit and open it again to finish."
  }
  const prefix =
    (code !== undefined ? FAILURE_REASONS[code] : undefined) ??
    "Something went wrong while updating, so nothing was changed."
  return `${prefix} You still have ${current}.`
}

/** "Waiting for 2 agent commands to finish"; without a count, the commands are still running. */
export function waitingWords(count: number | undefined): string {
  if (count === undefined) return "Waiting for running agent commands to finish"
  return `Waiting for ${count} agent ${count === 1 ? "command" : "commands"} to finish`
}

/** Whether the sidebar shows the line: a version is downloaded and ready, the person has not said Later. */
export function lineShows(info: UpdateInfo | null): info is UpdateInfo & { available: string } {
  if (info === null || info.available === null || info.later) return false
  // Downloading is not ready yet; a failed or running install still has its line, so the sheet can be reopened.
  return (
    info.downloaded || ["waiting", "installing", "failed"].includes(info.state) || !info.managed
  )
}

/** A version is ready to install, or without the App to run in a terminal. Later does not matter here. */
export function offered(info: UpdateInfo | null): info is UpdateInfo & { available: string } {
  if (info === null || info.available === null) return false
  return !info.managed || (info.downloaded && (info.state === "ready" || info.state === "idle"))
}

/** What a bug report says about a newer version. */
export type ReportUpdate = {
  available: string
  /** The running release without its build number. */
  current: string
  behind: number | null
  /** The App can install it; without the App the person runs `qualitylayer update`. */
  managed: boolean
  restart: () => void
}

export type Updates = {
  info: UpdateInfo | null
  /** The sidebar line, or null. Once the update has waited, the bar takes its place. */
  line: ReactNode
  /** The bar above the page once the release is old enough; the hook always sets it, a stand-in may leave it out. */
  bar?: ReactNode
  /** What a bug report says about a ready update, or null. */
  note?: ReportUpdate | null
  /** The sheet, mounted once: it opens from the line and closes on its own. */
  sheet: ReactNode
  /** Restart and update: asks the shell to install and shows what happens. */
  restart: () => void
  /** Check now. */
  check: () => void
  /** True from Check now until the shell reports a new check time. */
  checking: boolean
  /** The shell did not report a new check time within a few seconds: it is not running. */
  checkStalled: boolean
  openSheet: () => void
}

/** The shell reads the page's request files every second; this long without an answer, it is not there. */
export const ANSWER_WAIT_MS = 10_000

export function useUpdates({
  api,
  version,
  openAbout,
  answerWaitMs = ANSWER_WAIT_MS,
  now = Date.now,
}: {
  api: Api
  version: number
  /** The toast's and the bar's What's new: Settings › About. */
  openAbout: () => void
  answerWaitMs?: number
  /** The time the bar's age is read against; a test sets it. */
  now?: () => number
}): Updates {
  const query = useQuery<UpdateInfo | null>(
    () =>
      Promise.resolve()
        .then(() => api.update())
        .catch(() => null),
    [version],
  )
  const info = query.data
  const releases = useQuery<Release[]>(
    () =>
      lineShows(info) && typeof api.releases === "function"
        ? Promise.resolve()
            .then(() => api.releases())
            .catch(() => [])
        : Promise.resolve([]),
    [info?.available ?? null, info?.managed ?? null, info?.downloaded ?? null],
  )
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState(false)
  const [askToken, setAskToken] = useState(0)
  const [checking, setChecking] = useState(false)
  const [checkStalled, setCheckStalled] = useState(false)
  const checkedAt = useRef<number | null>(null)

  useUpdateStateTracking({
    info,
    asked,
    checking,
    checkedAt,
    answerWaitMs,
    setOpen,
    setAsked,
    setChecking,
    setCheckStalled,
  })
  useUpdatedToast(info, openAbout)

  const reload = query.reload
  const act = useCallback(
    async (action: "install" | "check" | "cancel" | "later") => {
      try {
        await api.updateAction(action)
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
      }
      reload()
    },
    [api, reload],
  )

  const restart = () => {
    setAsked(true)
    setAskToken((n) => n + 1)
    setOpen(true)
    void act("install")
  }
  const check = () => {
    checkedAt.current = info?.checkedAt ?? null
    setCheckStalled(false)
    setChecking(true)
    void act("check")
  }

  const wait = lineShows(info)
    ? updateWait(info.current, info.available, releases.data ?? [], now())
    : null
  const barOn = wait !== null && wait.level !== "fresh" && offered(info)

  const line =
    lineShows(info) && !barOn ? (
      <button
        type="button"
        className="q-up q-update"
        onClick={() => setOpen(true)}
        data-testid="update-line"
      >
        <span className="q-update-dot" aria-hidden="true" />
        <b>Update ready</b>
        <span className="q-dim">{shortVersion(info.available)}</span>
        <span className="q-chev ml-auto" aria-hidden="true" />
      </button>
    ) : null

  const bar =
    barOn && wait !== null ? (
      <UpdateBar
        info={info}
        wait={wait}
        onWhatsNew={openAbout}
        onLater={() => void act("later")}
        onRestart={restart}
      />
    ) : null

  const note: ReportUpdate | null = offered(info)
    ? {
        available: info.available,
        current: releaseOf(info.current),
        behind: wait?.behind ?? null,
        managed: info.managed,
        restart,
      }
    : null

  const sheet =
    info !== null && info.available !== null ? (
      <UpdateSheet
        info={info as UpdateInfo & { available: string }}
        open={open}
        asked={asked}
        askToken={askToken}
        answerWaitMs={answerWaitMs}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setAsked(false)
        }}
        onRestart={restart}
        onLater={() => {
          setOpen(false)
          void act("later")
        }}
        onCancel={() => void act("cancel")}
        onTryAgain={restart}
      />
    ) : null

  return {
    info,
    line,
    bar,
    note,
    sheet,
    restart,
    check,
    checking,
    checkStalled,
    openSheet: () => setOpen(true),
  }
}

/** What a bug report says when a newer version is ready; the sheet shows it above the form. */
export function ReportUpdateNote({ update }: { update: ReportUpdate }) {
  const since = update.behind === null ? "" : `${releasesWord(update.behind)} since yours. `
  return (
    <div className="q-report-update" role="note" data-testid="report-update-note">
      <DownloadIcon aria-hidden="true" />
      <div>
        <b>
          {update.available} is ready. You have {update.current}.
        </b>
        <span>
          {since}
          {update.managed
            ? "Update first, then send this if it still happens. Your text is kept."
            : "Run qualitylayer update in a terminal, then send this if it still happens."}
        </span>
      </div>
      {update.managed ? (
        <button type="button" className="q-btn sm" onClick={update.restart}>
          Restart and update
        </button>
      ) : null}
    </div>
  )
}
