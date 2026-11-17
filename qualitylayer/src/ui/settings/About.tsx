// Settings › About: the version with whether an update is ready and when it was last looked for (the
// header's status), the update channel, where to find help, then what is new in that version from its
// release notes and the earlier releases. The App checks for updates every hour.

import {
  BookOpenIcon,
  FlaskConicalIcon,
  HardDriveIcon,
  LifeBuoyIcon,
  PackageCheckIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  RouteIcon,
} from "lucide-react"
import { type ComponentProps, useState } from "react"
import type { UpdateChannel } from "../../core/config-values.ts"
import { sizeWords } from "../../core/size-words.ts"
import { CHANGELOG_URL } from "../../core/update/render.ts"
import { compareVersions } from "../../core/update/versions.ts"
import type { Api, Release } from "../api.ts"
import { showFileInFolderLabel } from "../file-action-labels.ts"
import { useQuery } from "../hooks.ts"
import { Fold } from "../kit/Fold.tsx"
import { offersHostActions } from "../machines/framed.ts"
import { ReleaseNotes } from "../ReleaseNotes.tsx"
import { requestFeedback } from "../report.ts"
import { tourLocation } from "../tour/location.ts"
import { pausedTour } from "../tour/session.ts"
import { type Updates, waitingWords } from "../Updates.tsx"
import { Choice, SettingRow, SettingsGroup } from "./Rows.tsx"
import { ServerPortGroup } from "./ServerPort.tsx"

export const DOCS_URL = "https://qualitylayer.dev/docs/"
export const PRIVACY_URL = "https://qualitylayer.dev/docs/reference/files#privacy"

const pad = (n: number) => String(n).padStart(2, "0")

/** "today at 09:12", "yesterday at 09:12", "Oct 3 at 09:12"; the clock is a parameter so it can be tested. */
export function checkedWords(at: number | null, now: number = Date.now()): string {
  return at === null ? "not checked yet" : `checked ${whenWords(at, now)}`
}

/** "today at 09:12", "yesterday at 09:12", "Oct 3 at 09:12". */
export function whenWords(at: number, now: number = Date.now()): string {
  const then = new Date(at)
  const time = `${pad(then.getHours())}:${pad(then.getMinutes())}`
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const apart = Math.round((day(new Date(now)) - day(then)) / 86_400_000)
  if (apart === 0) return `today at ${time}`
  if (apart === 1) return `yesterday at ${time}`
  const date = then.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${date} at ${time}`
}

/** What the channel row says it does: Beta also offers prereleases, and a newer stable replaces a beta. */
const CHANNEL_SAYS: Record<UpdateChannel, string> = {
  stable: "Stable releases only. Choose Beta to try new features before they ship.",
  beta: "You get betas first and move to each stable release when it is newer. If something breaks, report a problem below.",
}

const ICON = "size-[15px]"

/** What the QualityLayer home holds, measured once when the page opens, and the way to see it. */
function DiskUseRow({ api }: { api: Pick<Api, "diskUse" | "revealHome"> }) {
  const measured = useQuery(() => Promise.resolve().then(() => api.diskUse?.() ?? null), [])
  const [refused, setRefused] = useState<string | null>(null)
  const size = measured.data
  let hint: React.ReactNode
  if (refused !== null) hint = refused
  else if (measured.loading) hint = "Measuring…"
  else if (size === null || measured.error !== null) hint = "The size could not be measured."
  else
    hint = (
      <>
        {size.partial ? "At least " : ""}
        {sizeWords(size.bytes)} in <span className="font-mono text-[12.5px]">{size.path}</span>.
        Logs and run records are capped.
      </>
    )
  return (
    <SettingRow
      label="Disk use"
      testId="about-disk"
      hint={hint}
      icon={<HardDriveIcon className={ICON} />}
    >
      {offersHostActions() ? (
        <button
          type="button"
          className="q-btn"
          onClick={() => {
            setRefused(null)
            Promise.resolve()
              .then(() => api.revealHome?.())
              .catch((cause: unknown) =>
                setRefused(
                  cause instanceof Error ? cause.message : "The folder could not be opened.",
                ),
              )
          }}
        >
          {showFileInFolderLabel()}
        </button>
      ) : null}
    </SettingRow>
  )
}

/** Where to read the docs and how to report a problem, with what is sent. */
function HelpGroup() {
  const paused = pausedTour()
  return (
    <SettingsGroup testId="about-help" title="Help">
      <SettingRow
        label="Documentation"
        hint="qualitylayer.dev/docs"
        icon={<BookOpenIcon className={ICON} />}
      >
        <a className="q-btn" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
          Open docs
        </a>
      </SettingRow>
      <SettingRow
        label="App tour"
        hint="Explore Chat, planned changes, artifacts and Settings."
        icon={<RouteIcon className={ICON} />}
      >
        <button
          type="button"
          className="q-btn"
          onClick={() =>
            window.location.assign(tourLocation(window.location, true, paused?.at ?? 0))
          }
        >
          {paused ? "Continue tour" : "Replay tour"}
        </button>
      </SettingRow>
      <SettingRow
        label="Something wrong?"
        icon={<LifeBuoyIcon className={ICON} />}
        hint="Preview a public GitHub issue with basic App and OS details. You review text and screenshots before sending."
      >
        <button type="button" className="q-btn" onClick={() => requestFeedback({ kind: "bug" })}>
          Report…
        </button>
      </SettingRow>
      <p className="q-sg-foot">
        <a className="q-link" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          What is sent and what stays here
        </a>
      </p>
    </SettingsGroup>
  )
}

export function About({
  api,
  updates,
  channel,
  onChannel,
  server,
}: {
  api?: Api
  updates: Updates
  /** The channel updates are offered on: the person's choice, or the one the install belongs to. */
  channel: UpdateChannel
  onChannel: (channel: UpdateChannel) => void
  /** What the Server group needs of the page: the port setting and how to save, copy and tell the App's window. */
  server?: Omit<ComponentProps<typeof ServerPortGroup>, "api">
}) {
  const { info } = updates
  const releases = useQuery<Release[]>(
    () => Promise.resolve().then(() => (api === undefined ? [] : api.releases())),
    [channel, info?.available],
  )
  const all = releases.data ?? []

  const running = info?.current ?? ""
  const localRelease = /^(\d+\.\d+\.\d+(?:-beta\.\d+)?)\.\d+$/.exec(running)?.[1]
  const ready = info !== null && info.available !== null
  const shown = ready ? (info.available as string) : running
  const notes = all.find((r) => r.version === shown)?.notes ?? (ready ? info.notes : null)
  const earlier = all.filter((release) => compareVersions(release.version, shown) < 0)

  let line: string
  let button: { label: string; onClick: () => void; busy?: boolean } | null = null
  if (info === null) {
    line = "Reading the version…"
  } else if (!info.managed) {
    line = ready
      ? `${info.available} is out. Run qualitylayer update in a terminal.`
      : "Updates come with the App. On the command line, run qualitylayer update."
  } else if (info.state === "downloading" || (ready && !info.downloaded && info.state === "idle")) {
    line = `Downloading ${info.available ?? "the new version"}…`
  } else if (info.state === "installing") {
    line = `Updating to ${info.available ?? ""}…`
  } else if (info.state === "waiting") {
    line = `${info.available} is ready · ${waitingWords(info.waitingFor).replace(/^W/, "w")}`
    button = { label: "Restart and update", onClick: updates.openSheet }
  } else if (info.state === "failed") {
    line = `The last update to ${info.available ?? "the new version"} did not finish · ${checkedWords(info.checkedAt)}`
    button = { label: "See why", onClick: updates.openSheet }
  } else if (ready) {
    line = `${info.available} is ready · ${checkedWords(info.checkedAt)}`
    button = { label: "Restart and update", onClick: updates.restart }
  } else {
    line = updates.checkStalled
      ? "The App did not answer. Open the QualityLayer App and try again."
      : localRelease
        ? `Local build of ${localRelease} · ${checkedWords(info.checkedAt)} · only newer releases are offered`
        : `Up to date · ${checkedWords(info.checkedAt)}`
    button = {
      label: updates.checking ? "Checking…" : "Check now",
      onClick: updates.check,
      busy: updates.checking,
    }
  }

  return (
    <div className="q-sgs">
      <SettingsGroup
        testId="about-version"
        title={<>QualityLayer {running}</>}
        end={<span data-testid="about-line">{line}</span>}
      >
        <SettingRow
          label="Check for updates"
          hint="QualityLayer checks every hour, downloads in the background and asks before it restarts."
          icon={<RefreshCwIcon className={ICON} />}
        >
          {button !== null ? (
            <button
              type="button"
              className={
                ready && info?.managed && info.state === "ready" ? "q-btn primary" : "q-btn"
              }
              disabled={button.busy === true}
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ) : undefined}
        </SettingRow>
        <SettingRow
          label="Update channel"
          hint={<span data-testid="about-channel-says">{CHANNEL_SAYS[channel]}</span>}
          icon={<RadioTowerIcon className={ICON} />}
        >
          <Choice
            label="Update channel"
            value={channel}
            options={[
              { id: "stable", name: "Stable", icon: <PackageCheckIcon className="size-[13px]" /> },
              { id: "beta", name: "Beta", icon: <FlaskConicalIcon className="size-[13px]" /> },
            ]}
            onChange={onChannel}
            testId="about-channel"
          />
        </SettingRow>
        {api?.diskUse !== undefined ? <DiskUseRow api={api} /> : null}
      </SettingsGroup>

      <SettingsGroup
        testId="about-new"
        title={notes !== null ? <>What&apos;s new in {shown}</> : <>Release notes</>}
        end={
          <a className="q-link" href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
            GitHub Releases
          </a>
        }
      >
        <div className="px-4 py-3.5">
          {notes !== null ? (
            <ReleaseNotes notes={notes} />
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground" role="status">
              {releases.loading
                ? "Loading release notes…"
                : releases.error !== null
                  ? "Release notes could not be loaded. You can read them on GitHub."
                  : "Read all published release notes on GitHub."}
            </p>
          )}
        </div>
      </SettingsGroup>

      {earlier.length > 0 ? (
        <Fold
          plain
          name="Earlier releases"
          line={earlier
            .slice(0, 3)
            .map((r) => r.label)
            .join(" · ")}
        >
          <div className="grid gap-5 px-4 py-3.5" data-testid="about-earlier">
            {earlier.map((release) => (
              <section key={release.version} className="grid gap-2">
                <h3 className="m-0 text-[14px] font-semibold">{release.label}</h3>
                <ReleaseNotes notes={release.notes} />
              </section>
            ))}
          </div>
        </Fold>
      ) : null}

      <HelpGroup />

      {api?.serverPort !== undefined && api.restartServer !== undefined && server !== undefined ? (
        <ServerPortGroup
          api={{ serverPort: api.serverPort, restartServer: api.restartServer }}
          {...server}
        />
      ) : null}
    </div>
  )
}
