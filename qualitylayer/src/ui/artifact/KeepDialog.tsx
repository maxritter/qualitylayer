// Save to library: a task's draft becomes a reusable artifact every task of a project can see and draft
// on. Name and what it shows, the pages of a folder draft to take, the project it goes to (the task's,
// or another one) and any others that list it too, where it lives (in the repository, so it goes into
// pull requests; or only on this computer, out of git) and an optional Claude Design link. The task's
// draft stays as it is. A draft that already builds on a Library artifact says what Save does to it: the
// base is changed only through Review, and Review cannot write into another project, so Save always
// makes a separate artifact. Saved into the task's own project, a new draft is then recorded as a draft
// on what it became, so the Files row says so. Cancel changes nothing.

import { PinIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Artifact } from "../../core/artifact/format.ts"
import type { KeepResult, Project, ProjectArtifacts, TaskDetail } from "../api.ts"
import {
  type KeepApi,
  KeepBaseNotice,
  KeepLinkField,
  KeepPagesField,
  KeepProjectField,
  KeepWhereField,
  runKeepSubmit,
} from "./KeepDialogFields.tsx"
import { type DraftLine, linkProblem, slugOf } from "./task-lasting.ts"
import "./task-lasting.css"

export function KeepDialog({
  api,
  task,
  draft,
  base = null,
  projects = [],
  onClose,
  onKept,
}: {
  api: KeepApi
  task: Pick<TaskDetail, "id" | "project" | "projectName">
  draft: Artifact | null
  base?: DraftLine | null
  projects?: ProjectArtifacts[]
  onClose: () => void
  onKept: (result: KeepResult, notShown: string[], projectName: string) => void
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {draft !== null ? (
        <KeepForm
          key={draft.file}
          api={api}
          task={task}
          draft={draft}
          base={base}
          projects={projects}
          onClose={onClose}
          onKept={onKept}
        />
      ) : null}
    </Dialog>
  )
}

function isKeepBlocked(args: {
  busy: boolean
  slug: string
  title: string
  linkNote: string | null
  taken: boolean
  noPages: boolean
}): boolean {
  const { busy, slug, title, linkNote, taken, noPages } = args
  if (busy || slug === "" || title.trim() === "") return true
  return linkNote !== null || taken || noPages
}

function useKeepOthers(api: KeepApi, asking: boolean) {
  const [others, setOthers] = useState<Project[] | null>(null)
  useEffect(() => {
    if (!asking || others !== null || api.projects === undefined) return
    let live = true
    api
      .projects()
      .then((all) => live && setOthers(all))
      .catch(() => live && setOthers([]))
    return () => {
      live = false
    }
  }, [asking, others, api])
  return others
}

function KeepNamePurposeFields({
  titleId,
  purposeId,
  takenId,
  title,
  purpose,
  taken,
  destinationName,
  slug,
  onTitle,
  onPurpose,
}: {
  titleId: string
  purposeId: string
  takenId: string
  title: string
  purpose: string
  taken: boolean
  destinationName: string
  slug: string
  onTitle: (next: string) => void
  onPurpose: (next: string) => void
}) {
  return (
    <>
      <label className="kd-field" htmlFor={titleId}>
        Name
        <input
          id={titleId}
          className="kd-input"
          value={title}
          maxLength={120}
          autoComplete="off"
          aria-invalid={taken}
          aria-describedby={taken ? takenId : undefined}
          onChange={(event) => onTitle(event.target.value)}
        />
        {taken ? (
          <span id={takenId} className="kd-bad" role="alert">
            {destinationName}'s Library already has an artifact named {slug}. Choose another name.
          </span>
        ) : null}
      </label>
      <label className="kd-field" htmlFor={purposeId}>
        What it shows
        <input
          id={purposeId}
          className="kd-input"
          value={purpose}
          maxLength={600}
          autoComplete="off"
          onChange={(event) => onPurpose(event.target.value)}
        />
      </label>
    </>
  )
}

function KeepFormActions({
  problem,
  busy,
  blocked,
  failed,
  onClose,
}: {
  problem: string | null
  busy: boolean
  blocked: boolean
  failed: boolean
  onClose: () => void
}) {
  const label = busy ? "Saving…" : failed ? "Try again" : "Save to library"
  return (
    <>
      {problem !== null ? (
        <p className="kd-bad" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="kd-actions">
        <button type="button" className="q-btn quiet" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="q-btn primary" disabled={blocked}>
          {label}
        </button>
      </div>
    </>
  )
}

function useKeepDerived(args: {
  task: Pick<TaskDetail, "id" | "project" | "projectName">
  draft: Artifact
  base: DraftLine | null
  projects: ProjectArtifacts[]
  title: string
  where: "repository" | "mac"
  link: string
  linking: boolean
  destination: string
  pages: readonly string[]
  busy: boolean
}) {
  const { task, draft, base, projects, title, where, link, linking, destination, pages, busy } =
    args
  const slug = slugOf(title)
  const linkNote = where === "repository" ? linkProblem(link) : null
  const nameOf = (id: string) =>
    id === task.project ? task.projectName : (projects.find((p) => p.id === id)?.name ?? id)
  const destinationName = nameOf(destination)
  const existing = projects.find((p) => p.id === destination)?.lasting ?? []
  const taken = where === "repository" && slug !== "" && existing.some((each) => each.name === slug)
  const folder = (draft.pages?.length ?? 0) > 1
  const noPages = folder && pages.length === 0
  const blocked = isKeepBlocked({ busy, slug, title, linkNote, taken, noPages })
  const savedIn =
    where === "repository" ? `.qualitylayer/artifacts/${slug || "name"}/` : "docs/artifacts/"
  const crossBase = base !== null && base.owner !== null && base.owner !== task.project
  const linkShown = where === "repository" && (linking || link !== "")
  return {
    slug,
    linkNote,
    nameOf,
    destinationName,
    taken,
    folder,
    noPages,
    blocked,
    savedIn,
    crossBase,
    linkShown,
  }
}

function toggleOrderedPage(
  allPages: Artifact["pages"],
  was: string[],
  page: string,
  checked: boolean,
): string[] {
  if (!checked) return was.filter((p) => p !== page)
  return (allPages ?? []).map((p) => p.page).filter((p) => p === page || was.includes(p))
}

function toggleStringMember(was: string[], id: string, checked: boolean): string[] {
  return checked ? [...was, id] : was.filter((each) => each !== id)
}

function KeepForm({
  api,
  task,
  draft,
  base,
  projects,
  onClose,
  onKept,
}: {
  api: KeepApi
  task: Pick<TaskDetail, "id" | "project" | "projectName">
  draft: Artifact
  base: DraftLine | null
  projects: ProjectArtifacts[]
  onClose: () => void
  onKept: (result: KeepResult, notShown: string[], projectName: string) => void
}) {
  const [title, setTitle] = useState(draft.title)
  const [purpose, setPurpose] = useState(draft.purpose)
  const [where, setWhere] = useState<"repository" | "mac">("repository")
  const [link, setLink] = useState("")
  const [linking, setLinking] = useState(false)
  const [destination, setDestination] = useState(task.project)
  const [pages, setPages] = useState<string[]>(() => (draft.pages ?? []).map((p) => p.page))
  const [asking, setAsking] = useState(false)
  const [also, setAlso] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const linkField = useRef<HTMLInputElement>(null)
  const ids = {
    title: useId(),
    purpose: useId(),
    link: useId(),
    linkNote: useId(),
    taken: useId(),
    consequence: useId(),
  }
  const others = useKeepOthers(api, asking)
  const state = useKeepDerived({
    task,
    draft,
    base,
    projects,
    title,
    where,
    link,
    linking,
    destination,
    pages,
    busy,
  })

  useEffect(() => {
    if (state.linkShown) linkField.current?.focus()
  }, [state.linkShown])

  const submit = async () => {
    if (state.blocked) return
    setBusy(true)
    setProblem(null)
    try {
      const { result, notShown } = await runKeepSubmit({
        api,
        task,
        draft,
        destination,
        slug: state.slug,
        title,
        purpose,
        where,
        link,
        folder: state.folder,
        pages,
        also,
        others,
      })
      onKept(result, notShown, state.destinationName)
      onClose()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The artifact could not be saved.")
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <DialogContent className="kd sm:max-w-[560px]" data-testid="keep-dialog">
      <DialogHeader>
        <DialogTitle className="kd-title">
          <PinIcon aria-hidden="true" size={16} />
          Save to library
        </DialogTitle>
        <DialogDescription>
          Every task in the project can draft on it. Your draft stays as it is.
        </DialogDescription>
      </DialogHeader>
      <form
        className="kd-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {base !== null ? (
          <KeepBaseNotice
            base={base}
            crossBase={state.crossBase}
            ownerName={state.nameOf(base.owner ?? "")}
          />
        ) : null}
        <KeepNamePurposeFields
          titleId={ids.title}
          purposeId={ids.purpose}
          takenId={ids.taken}
          title={title}
          purpose={purpose}
          taken={state.taken}
          destinationName={state.destinationName}
          slug={state.slug}
          onTitle={setTitle}
          onPurpose={setPurpose}
        />
        {state.folder ? (
          <KeepPagesField
            draftPages={draft.pages ?? []}
            pages={pages}
            noPages={state.noPages}
            onTogglePage={(page, checked) =>
              setPages((was) => toggleOrderedPage(draft.pages, was, page, checked))
            }
          />
        ) : null}
        <KeepProjectField
          projects={projects}
          destination={destination}
          destinationName={state.destinationName}
          nameOf={state.nameOf}
          onDestination={(next) => {
            setDestination(next)
            setAlso((was) => was.filter((id) => id !== next))
          }}
          canAlsoShow={api.projects !== undefined && api.alsoShowArtifact !== undefined}
          where={where}
          asking={asking}
          onToggleAsking={() => setAsking((on) => !on)}
          others={others}
          also={also}
          onToggleAlso={(id, checked) => setAlso((was) => toggleStringMember(was, id, checked))}
        />
        <KeepWhereField
          where={where}
          onWhere={setWhere}
          savedIn={state.savedIn}
          consequenceId={ids.consequence}
        />
        <KeepLinkField
          linkShown={state.linkShown}
          linkId={ids.link}
          linkNoteId={ids.linkNote}
          link={link}
          linkNote={state.linkNote}
          linkField={linkField}
          where={where}
          onLink={setLink}
          onStartLink={() => setLinking(true)}
        />
        <KeepFormActions
          problem={problem}
          busy={busy}
          blocked={state.blocked}
          failed={failed}
          onClose={onClose}
        />
      </form>
    </DialogContent>
  )
}
