import { FLOW_STEPS } from "../../core/flow.ts"
import type { MemoryApi, MemoryStepLesson } from "../../memory-contracts.ts"
import { useQuery } from "../hooks.ts"

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`
const distinct = (lists: MemoryStepLesson[][]) =>
  new Set(lists.flatMap((list) => list.map((lesson) => lesson.id))).size

type StepLists = {
  used: MemoryStepLesson[]
  saved: MemoryStepLesson[]
  revised?: MemoryStepLesson[]
  retired?: MemoryStepLesson[]
  confirmed?: MemoryStepLesson[]
}

const keptCountOf = (lists: StepLists) =>
  [lists.revised, lists.retired, lists.confirmed].reduce((n, list) => n + (list?.length ?? 0), 0)

function LessonTitle({
  lesson,
  project,
  onOpenLesson,
}: {
  lesson: MemoryStepLesson
  project: string
  onOpenLesson: (project: string, lesson: string) => void
}) {
  if (lesson.title === null)
    return <span className="text-[color:var(--ql-text-dim)]">This lesson is no longer saved</span>
  return (
    <button
      type="button"
      className="q-link text-left"
      onClick={() => onOpenLesson(project, lesson.id)}
    >
      {lesson.title}
    </button>
  )
}

/** A lesson about the person says so after its title: it applies in every project (App Model: task-memory-record). */
function PersonalTag({ lesson }: { lesson: MemoryStepLesson }) {
  if (!lesson.personal) return null
  return <span className="shrink-0 text-[12.5px] text-[color:var(--ql-text-dim)]">Yours</span>
}

function LessonRow({
  kind,
  lesson,
  project,
  onOpenLesson,
}: {
  kind: "Used" | "Saved"
  lesson: MemoryStepLesson
  project: string
  onOpenLesson: (project: string, lesson: string) => void
}) {
  return (
    <li className="flex items-baseline gap-3 py-1">
      <span className="w-12 shrink-0 text-[color:var(--ql-text-dim)]">{kind}</span>
      <LessonTitle lesson={lesson} project={project} onOpenLesson={onOpenLesson} />
      <PersonalTag lesson={lesson} />
    </li>
  )
}

/** What Verify did to the project's lessons, by name, each with why. */
function KeptLessonRow({
  kind,
  lesson,
  project,
  onOpenLesson,
}: {
  kind: string
  lesson: MemoryStepLesson
  project: string
  onOpenLesson: (project: string, lesson: string) => void
}) {
  return (
    <li className="flex items-baseline gap-3 border-t border-[color:var(--ql-line)] py-2 first:border-t-0">
      <span className="w-[84px] shrink-0 text-[12.5px] text-[color:var(--ql-text-dim)]">
        {kind}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="flex items-baseline gap-3">
          <LessonTitle lesson={lesson} project={project} onOpenLesson={onOpenLesson} />
          <PersonalTag lesson={lesson} />
        </span>
        {/* A saved lesson carries no why; one also retired shows it on its Retired row. */}
        {kind !== "Saved" && lesson.reason ? (
          <span className="text-[12.5px] leading-[1.45] text-[color:var(--ql-text-dim)]">
            {lesson.reason}
          </span>
        ) : null}
      </span>
    </li>
  )
}

function StepMemorySection({
  step,
  project,
  onOpenLesson,
}: {
  step: StepLists & { id: string; label: string }
  project: string
  onOpenLesson: (project: string, lesson: string) => void
}) {
  // Verify's saves join what it kept of the project's lessons (App Model: task-memory-record).
  const keeps = step.id === "verify" && keptCountOf(step) > 0
  return (
    <section className="mt-5">
      <h3 className="text-[14px] font-semibold">{step.label}</h3>
      <ul className="mt-1 list-none p-0">
        {step.used.map((lesson) => (
          <LessonRow
            key={`Used-${lesson.id}`}
            kind="Used"
            lesson={lesson}
            project={project}
            onOpenLesson={onOpenLesson}
          />
        ))}
        {keeps
          ? null
          : step.saved.map((lesson) => (
              <LessonRow
                key={`Saved-${lesson.id}`}
                kind="Saved"
                lesson={lesson}
                project={project}
                onOpenLesson={onOpenLesson}
              />
            ))}
      </ul>
      {keeps ? (
        <div className="mt-3.5" data-testid="kept-at-review">
          <h4 className="text-[14px] font-semibold">Kept at Verify</h4>
          <p className="mt-1 mb-1.5 text-[13px] text-[color:var(--ql-text-dim)]">
            At Verify the agent checked this task's decisions against the lessons they touch, so the
            project's memory matches what was built.
          </p>
          <ul className="list-none p-0">
            {step.saved.map((lesson) => (
              <KeptLessonRow
                key={`Saved-${lesson.id}`}
                kind="Saved"
                lesson={lesson}
                project={project}
                onOpenLesson={onOpenLesson}
              />
            ))}
            {(step.revised ?? []).map((lesson) => (
              <KeptLessonRow
                key={`Revised-${lesson.id}`}
                kind="Revised"
                lesson={lesson}
                project={project}
                onOpenLesson={onOpenLesson}
              />
            ))}
            {(step.retired ?? []).map((lesson) => (
              <KeptLessonRow
                key={`Retired-${lesson.id}`}
                kind="Retired"
                lesson={lesson}
                project={project}
                onOpenLesson={onOpenLesson}
              />
            ))}
            {(step.confirmed ?? []).map((lesson) => (
              <KeptLessonRow
                key={`Still holds-${lesson.id}`}
                kind="Still holds"
                lesson={lesson}
                project={project}
                onOpenLesson={onOpenLesson}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The task's Memory record: the lessons each step used and saved, by title. A title opens that
 * lesson in Settings → Memory (the Markdown reader strips internal links, so this is not Markdown).
 */
export function MemoryRecord({
  api,
  project,
  task,
  version,
  onOpenLesson,
}: {
  api: MemoryApi | undefined
  project: string
  task: string
  version?: number
  onOpenLesson: (project: string, lesson: string) => void
}) {
  const activity = useQuery(
    () =>
      api?.activity
        ? api.activity(project, task)
        : Promise.reject(new Error("Memory is unavailable in this App connection.")),
    [api, project, task, version],
  )
  if (activity.error)
    return (
      <p role="alert" className="m-5">
        {activity.error.message}{" "}
        <button type="button" className="q-link" onClick={activity.reload}>
          Try again
        </button>
      </p>
    )
  if (activity.data === null) return <p className="m-5">Reading the record…</p>
  const { data } = activity
  const steps = FLOW_STEPS.flatMap((step) => {
    const lists = data.steps[step.id]
    return lists && lists.used.length + lists.saved.length + keptCountOf(lists) > 0
      ? [{ id: step.id, label: step.label, ...lists }]
      : []
  })
  const kept = (list: "revised" | "retired" | "confirmed") =>
    steps.reduce((n, step) => n + (step[list]?.length ?? 0), 0)
  const keptCounts = (
    [
      ["revised", "revised"],
      ["retired", "retired"],
      ["confirmed", "still holds"],
    ] as const
  )
    .filter(([list]) => kept(list) > 0)
    .map(([list, words]) => ` · ${kept(list)} ${words}`)
    .join("")
  return (
    <div className="mx-auto max-w-[680px] px-5 py-6" data-testid="memory-record">
      <h2 className="text-[19px] font-semibold">Memory</h2>
      {steps.length ? (
        <p className="mt-1 text-[color:var(--ql-text-dim)]">
          {plural(distinct(steps.map((step) => step.used)), "lesson")} used ·{" "}
          {distinct(steps.map((step) => step.saved))} saved{keptCounts}
        </p>
      ) : data.reads + data.saves > 0 ? (
        <p className="mt-1 text-[color:var(--ql-text-dim)]">
          {plural(data.reads, "lesson")} read · {data.saves} saved. This record predates lesson
          names.
        </p>
      ) : (
        <p className="mt-1 text-[color:var(--ql-text-dim)]">No lessons used yet.</p>
      )}
      {steps.map((step) => (
        <StepMemorySection
          key={step.id}
          step={step}
          project={project}
          onOpenLesson={onOpenLesson}
        />
      ))}
      {data.issue ? <p className="ir-doc-note mt-5">{data.issue}</p> : null}
      <p className="ir-doc-note mt-6">
        Project lessons are historical evidence. Required instructions and the approved plan remain
        authoritative.
      </p>
    </div>
  )
}
