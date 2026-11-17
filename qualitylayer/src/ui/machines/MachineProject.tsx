import { CheckIcon, FolderGit2Icon } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { FoundProjects } from "../use-found-projects.ts"

export function MachineProject({
  found,
  value,
  onChange,
  machine,
}: {
  found: FoundProjects
  value: string
  onChange: (path: string) => void
  machine: string
}) {
  return (
    <div className="q-onb-st" data-testid="machine-project">
      <span className={`n ${value.trim() ? "ok" : "you"}`}>
        {value.trim() ? <CheckIcon className="size-3.5" aria-label="Selected" /> : 2}
      </span>
      <span className="t">Project</span>
      <span className="r" />
      <div className="d grid gap-2">
        <Input
          className="font-mono text-[13px]"
          aria-label={`Project folder on ${machine}`}
          placeholder={`Folder on ${machine}`}
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {found.projects.length ? (
          <div className="q-machine-repositories">
            {found.projects.slice(0, 6).map((project) => (
              <button
                key={project.path}
                type="button"
                className="q-btn sm"
                aria-pressed={value === project.path}
                title={project.path}
                onClick={() => onChange(project.path)}
              >
                <FolderGit2Icon className="size-3.5" />
                <span>{project.path.replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, "~")}</span>
              </button>
            ))}
          </div>
        ) : null}
        {found.failed ? (
          <p className="q-onb-small">Projects could not be read. Enter a folder on this machine.</p>
        ) : null}
      </div>
    </div>
  )
}
