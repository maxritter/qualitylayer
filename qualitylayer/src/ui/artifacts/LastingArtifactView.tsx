import { InfoIcon } from "lucide-react"
import { lazy, Suspense, useCallback, useState } from "react"
import { toast } from "sonner"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { type LastingArtifact, lastingDoc, lastingDocOf } from "../../core/artifact/format.ts"

const LazyDesignArtifactView = lazy(() =>
  import("../design/DesignArtifactView.tsx").then((m) => ({ default: m.DesignArtifactView })),
)

import { useTerminalLayout } from "../agent-window/layout.tsx"
import { ArtifactAgentChip } from "../artifact/ArtifactAgentChip.tsx"
import type { ArtifactManager } from "../artifact/ArtifactManage.tsx"
import { ArtifactPage } from "../artifact/ArtifactPage.tsx"
import { useMissingRestoredFallback } from "../hooks.ts"
import type { ProjectFacts } from "../sidebar/project-model.ts"
import { ArtifactFiles } from "./ArtifactFiles.tsx"
import {
  ArchivedArtifactNotice,
  ArtifactLibraryIdentity,
  ArtifactLibraryStatus,
  useLibraryRestore,
} from "./ArtifactLibraryStatus.tsx"
import { ArtifactViewerShell, useArtifactSide } from "./ArtifactViewerShell.tsx"
import { artifactContextTarget, askArtifactAgentAt } from "./artifact-context.ts"
import { FavoriteFeedback, FavoriteMenuItem } from "./FavoriteButton.tsx"
import { favoriteKey } from "./favorites.ts"
import { LibraryActions } from "./LibraryActions.tsx"
import { originOf } from "./origin.ts"
import { StandaloneArtifactSidebar } from "./StandaloneArtifactSidebar.tsx"
import { type LastingViewerProps, useLastingArtifact } from "./useLastingArtifact.tsx"

type LibraryData = ReturnType<typeof useLastingArtifact>

async function stopShowing(
  props: LastingViewerProps,
  artifact: LastingArtifact,
  project: ProjectFacts,
) {
  const ref = `${props.route.project}:${artifact.name}`
  try {
    await props.api.stopShowingArtifact(project.id, ref)
    props.overview.reload()
    toast.success(`“${artifact.title}” no longer shows in ${project.label}. It stays here.`, {
      action: {
        label: "Undo",
        onClick: () =>
          void props.api
            .alsoShowArtifact(project.id, ref)
            .then(props.overview.reload)
            .catch((cause: unknown) =>
              toast.error(cause instanceof Error ? cause.message : String(cause)),
            ),
      },
    })
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

function LastingSidebar({
  props,
  data,
  entry,
  file,
  side,
  manager,
}: {
  props: LastingViewerProps
  data: LibraryData
  entry: LastingArtifact
  file: string
  side: ReturnType<typeof useArtifactSide>
  manager: ArtifactManager
}) {
  const openTask = (id: string) => props.go({ view: "task", id, doc: null })
  return (
    <StandaloneArtifactSidebar
      title={entry.title}
      open={side.open}
      sheet={props.compact}
      focusKey={side.focusKey}
      onClose={() => side.show(false)}
      agent={props.artifactAgent?.({ address: { ...data.where, file }, title: entry.title })}
    >
      <ArtifactFiles
        api={props.api}
        project={props.route.project}
        file={file}
        manager={manager}
        lasting={{
          artifact: entry,
          history: data.history,
          alsoIn: entry.alsoIn.map(data.factsOf),
          onStopShowing: (project) => void stopShowing(props, entry, project),
          onDraft: (task, draft) => {
            if (props.compact) side.show(false)
            props.go({ view: "task", id: task.id, doc: draft })
          },
        }}
        onOpenTask={openTask}
      />
    </StandaloneArtifactSidebar>
  )
}

export function LastingArtifactView(props: LastingViewerProps) {
  const { api, route, name, overview, go } = props
  const layout = useTerminalLayout()
  const data = useLastingArtifact(props)
  const { entry, artifact, where, facts, page, history } = data
  const goHome = useCallback(() => go({ view: "home" }), [go])
  useMissingRestoredFallback(page.data === null ? page.error : null, goHome)
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const [selectedPage, setSelectedPage] = useState<string | null>(null)
  const side = useArtifactSide(`${route.project}:${name}`, props.fullScreen)
  const restore = useLibraryRestore(props, entry, facts)
  const from = originOf(route.project, route.file)
  const back = () => {
    props.onFullScreen(false)
    go({ view: "artifacts" })
  }
  const backToTask = () => {
    if (from) {
      props.onFullScreen(false)
      window.location.hash = from.hash
    }
  }
  const openFiles = () => {
    layout?.setPanel("files")
    side.show(true)
  }
  const openAgent = () => {
    layout?.setPanel("terminal")
    side.show(true)
  }
  if (data.unavailable || !entry || !artifact)
    return (
      <ArtifactViewerShell
        props={props}
        open={false}
        show={side.show}
        toolbar={setToolbar}
        sidebar={null}
      >
        <ArtifactLibraryStatus
          props={props}
          data={data}
          state={restore}
          toolbar={toolbar}
          from={from}
          backToTask={backToTask}
          back={back}
        />
      </ArtifactViewerShell>
    )
  const shownFile = entry.pages.some((value) => value.file === selectedPage)
    ? (selectedPage as string)
    : lastingDoc(name, props.page)
  const manager: ArtifactManager = {
    api,
    where,
    file: shownFile,
    readOnly: false,
    onOpenTask: (id) => go({ view: "task", id, doc: null }),
    onChanged: () => {
      overview.reload()
      page.reload()
      history.reload()
    },
  }
  const sidebar = (
    <LastingSidebar
      props={props}
      data={data}
      entry={entry}
      file={shownFile}
      side={side}
      manager={manager}
    />
  )
  return (
    <ArtifactViewerShell
      props={props}
      open={side.open}
      show={side.show}
      toolbar={setToolbar}
      sidebar={sidebar}
    >
      {entry.kind === "design" ? (
        <Suspense
          fallback={
            <div className="p-5 text-sm text-muted-foreground">Loading design artifact…</div>
          }
        >
          <LazyDesignArtifactView
            projectId={route.project}
            artifactName={entry.name}
            title={entry.title}
            defaultFidelity={props.defaultFidelity}
            onBack={from ? backToTask : back}
            rail={{ open: side.open, onToggle: () => side.show(!side.open) }}
            onAskAgent={(prompt) =>
              askArtifactAgentAt({
                api,
                target: artifactContextTarget(window.location.href, route.project, shownFile),
                title: entry.title,
                mark: { x: 0, y: 0, quote: prompt, file: shownFile, html: "" },
                open: openAgent,
              })
            }
          />
        </Suspense>
      ) : (
        <ArtifactPage
          title={entry.title}
          artifact={artifact}
          toolbarHost={toolbar}
          html={page.data}
          error={page.data === null ? (page.error?.message ?? null) : null}
          onMark={(mark) =>
            askArtifactAgentAt({
              api,
              target: artifactContextTarget(window.location.href, route.project, shownFile),
              title: entry.title,
              mark,
              open: openAgent,
            })
          }
          agent={
            props.artifactAgent ? (
              <ArtifactAgentChip
                agent={props.artifactAgentId}
                name={props.artifactAgentName ?? "The agent"}
                running={props.artifactAgentRunning === true}
                title={entry.title}
                onOpen={openAgent}
              />
            ) : undefined
          }
          notice={
            <>
              <FavoriteFeedback />
              <ArchivedArtifactNotice entry={entry} state={restore} />
            </>
          }
          back={{ label: from?.title ?? "Artifacts", onClick: from ? backToTask : back }}
          loadPage={data.loadPage}
          onRetry={page.reload}
          onPageChange={setSelectedPage}
          initialPage={lastingDocOf(route.file)?.page !== entry.entry ? route.file : undefined}
          section={route.at}
          pageMarks={data.marks}
          manager={manager}
          onOpenBrowser={(location) =>
            void api
              .artifactOpen(where, location.file ?? shownFile, "browser", {
                viewer: true,
                section: location.section,
              })
              .catch((cause: Error) => toast.error(cause.message))
          }
          rail={{
            open: side.open,
            onToggle: () => side.show(!side.open),
            what: "artifact sidebar",
          }}
          fullScreen={props.fullScreen}
          onFullScreen={props.onFullScreen}
          menu={props.menu}
          compact={props.compact}
          moreItems={
            <>
              <FavoriteMenuItem id={favoriteKey(route.project, entry.name)} title={entry.title} />
              <DropdownMenuItem onClick={openFiles}>
                <InfoIcon aria-hidden="true" />
                Artifact information and history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          }
          actions={(tools) => (
            <LibraryActions
              api={api}
              artifact={entry}
              owner={route.project}
              projects={data.choices}
              reload={overview.reload}
              go={go}
              inViewer
            >
              {tools}
            </LibraryActions>
          )}
          header={<ArtifactLibraryIdentity title={entry.title} facts={facts} back={back} />}
        />
      )}
    </ArtifactViewerShell>
  )
}
