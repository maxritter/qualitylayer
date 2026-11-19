import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MemoryApi, MemoryPage, MemoryProject } from "../../../memory-contracts.ts"
import { type Query, useQuery } from "../../hooks.ts"

const lessonCount = (n: number) => `${n} ${n === 1 ? "lesson" : "lessons"}`

export function useProjectChoices(api: MemoryApi, initialProject?: string) {
  const [extras, setExtras] = useState<MemoryProject[]>([])
  const [id, select] = useState(initialProject ?? "")
  const [cursor, setCursor] = useState<string | null>()
  const page = useQuery(() => api.projects({ limit: 100 }), [api])
  const options = [...(page.data?.items ?? []), ...extras].filter((item) => item.git)
  const selected = options.find((item) => item.id === id) ?? options[0]
  const more = cursor === undefined ? page.data?.next : cursor
  const loadMore = more
    ? async () => {
        const next = await api.projects({ limit: 100, cursor: more })
        setExtras((before) => [...before, ...next.items])
        setCursor(next.next)
      }
    : undefined
  return { page, options, selected, select, loadMore }
}

export function ProjectPicker({
  page,
  options,
  selected,
  disabled,
  choose,
  loadMore,
}: {
  page: Query<MemoryPage<MemoryProject>>
  options: MemoryProject[]
  selected: MemoryProject | undefined
  disabled: boolean
  choose: (value: string) => void
  loadMore?: () => void
}) {
  return (
    <>
      <div className="grid gap-2">
        <span className="text-sm font-medium">Project</span>
        <Select
          value={selected?.id ?? null}
          disabled={disabled || !selected}
          onValueChange={(value) => {
            if (value) choose(value)
          }}
        >
          <SelectTrigger aria-label="Repository project" className="max-w-full">
            <SelectValue placeholder="Choose a project">{selected?.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((item) => (
              <SelectItem value={item.id} key={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loadMore ? (
          <Button
            type="button"
            variant="ghost"
            className="w-fit"
            disabled={disabled}
            onClick={loadMore}
          >
            Show more projects
          </Button>
        ) : null}
      </div>
      {page.loading ? <p role="status">Loading projects…</p> : null}
      {page.error ? (
        <p role="alert">
          {page.error.message}{" "}
          <button type="button" className="underline" onClick={page.reload}>
            Try again
          </button>
        </p>
      ) : null}
      {page.data && !selected && !loadMore ? <p>No Git projects are registered.</p> : null}
    </>
  )
}

export function OperationPreview({
  preview,
  name,
  isExport,
}: {
  preview: Query<{ count: number } | null>
  name: string
  isExport: boolean
}) {
  if (preview.error)
    return (
      <p role="alert">
        {preview.error.message}{" "}
        <button type="button" className="underline" onClick={preview.reload}>
          Try again
        </button>
      </p>
    )
  if (!preview.data) return <p role="status">Checking lessons…</p>
  return (
    <p>
      {lessonCount(preview.data.count)} available to {isExport ? "export to" : "read from"}{" "}
      <code>docs/memories/</code> in {name}.
      {!isExport ? " If both versions changed, both are kept for review." : ""}
    </p>
  )
}
