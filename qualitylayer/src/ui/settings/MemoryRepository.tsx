import { DownloadIcon, GitBranchIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type {
  MemoryApi,
  MemoryOverview,
  MemoryRepositoryApi,
  MemoryRepositoryConflicts,
  MemoryRepositoryOperation,
} from "../../memory-contracts.ts"
import { useEventCount, useQuery } from "../hooks.ts"
import { CompareVersions } from "./memory-repository/CompareVersions.tsx"
import { RepositoryOperation } from "./memory-repository/RepositoryOperation.tsx"
import { SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"

type Conflict = NonNullable<MemoryRepositoryConflicts["next"]>
type Scene =
  | { action: MemoryRepositoryOperation; project?: string; receipt?: string }
  | { action: "compare"; conflict: Conflict }
const lessonCount = (n: number) => `${n} ${n === 1 ? "lesson" : "lessons"}`
export function MemoryRepository({
  api,
  repository,
  overview,
  changed,
}: {
  api: MemoryApi
  repository: MemoryRepositoryApi
  overview: MemoryOverview | null
  changed: () => void
}) {
  const revision = useEventCount("memory")
  const conflicts = useQuery(() => repository.conflicts(), [repository, revision])
  const [scene, setScene] = useState<Scene | null>(null)
  const [busy, setBusy] = useState(false)
  const focus = useRef<HTMLButtonElement | null>(null)
  const restore = useRef<HTMLButtonElement | null>(null)
  const close = () => setScene(null)
  const afterChange = () => {
    conflicts.reload()
    changed()
  }
  const compare = (conflict: Conflict) => setScene({ action: "compare", conflict })
  const shared = overview?.sharedProjects
  return (
    <>
      <SettingsGroup
        title="Project Git storage"
        end={shared && `${shared.shared} of ${shared.total} projects enabled`}
      >
        <SettingRow
          icon={<GitBranchIcon size={15} />}
          label="Store project lessons in Git"
          hint={
            <>
              Choose which projects can export lessons to <code>docs/memories/</code> in their
              repositories.
            </>
          }
        >
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              focus.current = event.currentTarget
              setScene({ action: "export" })
            }}
          >
            Manage projects
          </Button>
        </SettingRow>
        <p className="q-memory-note">
          Anyone with repository access can read exported project lessons. Personal lessons, private
          answers, native session details and Pilot imports stay on this computer.
        </p>
      </SettingsGroup>
      <SettingsGroup title="Restore project lessons">
        <SettingRow
          icon={<DownloadIcon size={15} />}
          label="From a repository"
          hint="Read tracked project lessons into your local memory."
        >
          <Button
            type="button"
            variant="outline"
            ref={restore}
            onClick={(event) => {
              focus.current = event.currentTarget
              setScene({ action: "restore" })
            }}
          >
            Restore from repository
          </Button>
        </SettingRow>
        {conflicts.data?.next ? (
          <SettingRow
            label={`${lessonCount(conflicts.data.total)} ${conflicts.data.total === 1 ? "needs" : "need"} a version choice`}
            hint="Both versions are available for comparison."
          >
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                focus.current = event.currentTarget
                if (conflicts.data?.next) compare(conflicts.data.next)
              }}
            >
              Compare versions
            </Button>
          </SettingRow>
        ) : null}
        {conflicts.error ? (
          <p className="q-memory-note" role="alert">
            Could not check for conflicting lessons.{" "}
            <button type="button" className="underline" onClick={conflicts.reload}>
              Try again
            </button>
          </p>
        ) : null}
        <SettingsMore summary="How Git storage works">
          <p>
            Commit the exported files yourself to add them to Git history. To remove previously
            exported files, delete them from the repository and commit that change.
          </p>
          <p>
            Missing repository files do not remove local lessons. Restore keeps a lesson's history,
            including when it was retired or replaced.
          </p>
        </SettingsMore>
      </SettingsGroup>
      <Dialog
        open={scene !== null}
        onOpenChange={(open) => {
          if (!open && !busy) close()
        }}
      >
        <DialogContent
          className="q-memory-dialog sm:max-w-[600px]"
          showCloseButton={!busy}
          finalFocus={() => (focus.current?.isConnected ? focus.current : restore.current)}
        >
          {scene?.action === "compare" ? (
            <CompareVersions
              key={scene.conflict.id}
              repository={repository}
              conflict={scene.conflict}
              busy={busy}
              setBusy={setBusy}
              back={() => setScene({ action: "restore", project: scene.conflict.project })}
              saved={(next) => {
                setScene({
                  action: "restore",
                  project: scene.conflict.project,
                  receipt: `Version saved as revision ${next}. Both histories are kept.`,
                })
                afterChange()
              }}
            />
          ) : scene ? (
            <RepositoryOperation
              key={scene.action}
              operation={scene.action}
              api={api}
              repository={repository}
              paused={overview?.enabled === false}
              initialProject={scene.project}
              receipt={scene.receipt}
              busy={busy}
              setBusy={setBusy}
              close={close}
              changed={afterChange}
              compare={compare}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
