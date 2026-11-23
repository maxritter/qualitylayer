import { FolderGit2Icon, GitBranchIcon, GitBranchPlusIcon } from "lucide-react"
import { useId } from "react"
import { Input } from "@/components/ui/input"
import { worktreeNameProblem, worktreePlan } from "../../core/run/worktree-plan.ts"
import { Segmented } from "../Segmented.tsx"
import {
  invalidBranchName,
  type LaunchContested,
  launchContestedLine,
} from "./AgentLaunchFields.tsx"
import "./launch-branch.css"

export type LaunchWorks = "checkout" | "branch" | "worktree"

/** What the person chose and typed; a field the person never touched is `null` and follows its default. */
export type LaunchBranchState = {
  works: LaunchWorks
  branchEdit: string | null
  nameEdit: string | null
}

export type LaunchBranchDefaults = {
  /** The new branch's name while the person has not typed one: the kind's prefix and the request's name. */
  defaultBranch: string
  /** The worktree's name while the person has not typed one. */
  defaultName: string
  /** `feat/` or `fix/`: a worktree's branch is this and its name. */
  prefix: string
  /** The project's checkout; without one a worktree has no folder yet. */
  checkout: string | null
}

export type LaunchBranchResolved = {
  works: LaunchWorks
  /** The branch to create; "" on the current branch. */
  branch: string
  /** The worktree's name; "" unless it is a worktree. */
  name: string
  /** A worktree's folder and branch, once there is a checkout and a valid name. */
  plan: { name: string; folder: string; branch: string } | null
  /** Why this cannot start, in a sentence for the person, or null. */
  problem: string | null
}

export const INITIAL_BRANCH_STATE: LaunchBranchState = {
  works: "checkout",
  branchEdit: null,
  nameEdit: null,
}

/** The branch and worktree the launch will make, from what was chosen and the defaults they follow. */
export function resolveLaunchBranch(
  state: LaunchBranchState,
  { defaultBranch, defaultName, prefix, checkout }: LaunchBranchDefaults,
): LaunchBranchResolved {
  if (state.works === "branch") {
    const branch = state.branchEdit ?? defaultBranch
    return {
      works: "branch",
      branch,
      name: "",
      plan: null,
      problem: invalidBranchName(branch) ? "Use a valid branch name." : null,
    }
  }
  if (state.works === "worktree") {
    const name = state.nameEdit ?? defaultName
    const problem = worktreeNameProblem(name)
    const plan = problem === null && checkout !== null ? worktreePlan(checkout, name, prefix) : null
    return { works: "worktree", branch: plan?.branch ?? `${prefix}${name}`, name, plan, problem }
  }
  return { works: "checkout", branch: "", name: "", plan: null, problem: null }
}

function LaunchBranchInput({
  id,
  scope,
  works,
  resolved,
  disabled,
  current,
  checkout,
  showPath,
  onChange,
}: {
  id: string
  scope: string
  works: LaunchWorks
  resolved: LaunchBranchResolved
  disabled: boolean
  current?: string | null
  checkout: string | null
  showPath: boolean
  onChange: (patch: Partial<LaunchBranchState>) => void
}) {
  if (works === "checkout") {
    return (
      <p className="q-launch-branch-line">
        <GitBranchIcon size={13} aria-hidden="true" />
        {checkout || current ? (
          <>
            <b>{current || "Current branch"}</b>
            {checkout && showPath ? <span title={checkout}>in {checkout}</span> : null}
          </>
        ) : (
          <span>Choose a project to see its current branch.</span>
        )}
      </p>
    )
  }
  const isWorktree = works === "worktree"
  return (
    <div className="q-launch-branch-fields">
      <label htmlFor={`${id}-name`}>
        {isWorktree ? "Worktree name" : "Branch name"}
        <Input
          id={`${id}-name`}
          aria-label={`${scope}: ${isWorktree ? "worktree name" : "branch name"}`}
          aria-invalid={resolved.problem !== null}
          value={isWorktree ? resolved.name : resolved.branch}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            onChange(
              isWorktree ? { nameEdit: event.target.value } : { branchEdit: event.target.value },
            )
          }
        />
      </label>
    </div>
  )
}

/**
 * Where the work happens: the current branch, a new branch, or a new worktree. A worktree is named once;
 * the name gives its folder, next to the project, and its branch. Nothing asks for a folder.
 */
export function LaunchBranch({
  scope = "Launch",
  heading = "Branch",
  icons = false,
  showPath = true,
  resolved,
  state,
  onChange,
  current,
  checkout,
  disabled = false,
  contested = null,
}: {
  scope?: string
  heading?: string
  icons?: boolean
  /** Name the checkout's folder beside the current branch; off where the project picker above already shows it. */
  showPath?: boolean
  resolved: LaunchBranchResolved
  state: LaunchBranchState
  onChange: (patch: Partial<LaunchBranchState>) => void
  /** The checkout's current branch, when it is known. */
  current?: string | null
  checkout: string | null
  disabled?: boolean
  /** Why the checkout is contested, for Start the build. */
  contested?: LaunchContested | null
}) {
  const id = useId()
  return (
    <div className="q-launch-branch" data-testid="launch-branch">
      <div className="q-launch-branch-head">
        <span>{heading}</span>
        <Segmented
          size="md"
          label={`${scope}: branch`}
          value={state.works}
          options={[
            {
              id: "checkout",
              label: "Current branch",
              disabled,
              icon: icons ? <GitBranchIcon aria-hidden="true" /> : undefined,
            },
            {
              id: "branch",
              label: "New branch",
              disabled,
              icon: icons ? <GitBranchPlusIcon aria-hidden="true" /> : undefined,
            },
            {
              id: "worktree",
              label: "New worktree",
              disabled,
              icon: icons ? <FolderGit2Icon aria-hidden="true" /> : undefined,
            },
          ]}
          onChange={(works) => onChange({ works })}
        />
      </div>
      <LaunchBranchInput
        id={id}
        scope={scope}
        works={state.works}
        resolved={resolved}
        disabled={disabled}
        current={current}
        checkout={checkout}
        showPath={showPath}
        onChange={onChange}
      />
      {state.works === "worktree" && resolved.plan ? (
        <div className="q-launch-worktree-at" data-testid="new-task-worktree-plan">
          <span>Folder</span>
          <code title={resolved.plan.folder}>{resolved.plan.folder}</code>
          <span>Branch</span>
          <code title={resolved.plan.branch}>{resolved.plan.branch}</code>
        </div>
      ) : null}
      {contested?.kind === "overlap" ? (
        <small className="q-launch-why">{launchContestedLine(contested, state.works)}</small>
      ) : null}
    </div>
  )
}
