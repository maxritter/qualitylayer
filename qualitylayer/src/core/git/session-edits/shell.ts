import { asObject } from "./records.ts"
import { inlineShell, shellCommand, shellSegments } from "./shell-lex.ts"

export { shellPatchedPaths } from "./shell-writes.ts"

function patchEditedPaths(given: Record<string, unknown>): string[] {
  const patch = [given.input, given.patch, given.patchText, given.command].find(
    (v) => typeof v === "string",
  )
  if (typeof patch !== "string") return []
  return [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) =>
    (m[1] ?? "").trim(),
  )
}

/**
 * The files one tool call changed, as written in its input: Claude Code's Edit, MultiEdit, Write
 * and NotebookEdit name the file; Codex's apply_patch names each file in its patch, and Copilot's
 * apply_patch input is the patch text itself.
 */
export function editedPaths(tool: unknown, input: unknown): string[] {
  const given = typeof input === "string" ? { input } : asObject(input)
  if (given === null || typeof tool !== "string") return []
  if (tool === "apply_patch") return patchEditedPaths(given)
  let path: unknown
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(tool))
    path = given.file_path ?? given.notebook_path
  else if (tool === "edit" || tool === "write")
    path = given.path ?? given.filePath ?? given.file_path
  return typeof path === "string" && path !== "" ? [path] : []
}

/** The git subcommands that can leave a new commit at HEAD. */
const COMMITTING = new Set([
  "commit",
  "commit-tree",
  "cherry-pick",
  "rebase",
  "merge",
  "pull",
  "revert",
  "am",
])
/** git's own options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"])
/** The words that run the command after them: `env git commit`, `command git commit`. */
const WRAPPERS = new Set([
  "env",
  "command",
  "exec",
  "nohup",
  "time",
  "timeout",
  "builtin",
  "nice",
  "sudo",
])
/** A wrapper's options that take the next word as their value (`env -u NAME`, `nice -n 5`). */
const WRAPPER_VALUE_OPTION = /^-[uCna]$/
/** The same for `timeout` (`-k 5`, `-s KILL`). */
const TIMEOUT_VALUE_OPTION = /^-[ks]$/
/** A program's name without its folder and, as Windows writes it, `.exe`. */
const programName = (word: string) =>
  word
    .replace(/^.*[\\/]/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase()
/** `git commit`'s options that take the next word as their value: a message may say anything. */
const COMMIT_VALUE_OPTIONS = new Set([
  "-m",
  "-F",
  "-C",
  "-c",
  "-t",
  "--message",
  "--file",
  "--reuse-message",
  "--reedit-message",
  "--template",
  "--author",
  "--date",
  "--fixup",
  "--squash",
  "--cleanup",
])

/** Where a command's program stands, after its environment assignments and wrappers. */
function programIndex(words: string[]): number {
  let at = 0
  for (;;) {
    while (/^[A-Za-z_]\w*=/.test(words[at] ?? "")) at++
    const wrapper = programName(words[at] ?? "")
    if (!WRAPPERS.has(wrapper)) return at
    at++
    const valued = wrapper === "timeout" ? TIMEOUT_VALUE_OPTION : WRAPPER_VALUE_OPTION
    while ((words[at] ?? "").startsWith("-")) at += valued.test(words[at] ?? "") ? 2 : 1
    // `timeout 30 git commit`: the time limit stands before the command.
    if (wrapper === "timeout" && /^\d/.test(words[at] ?? "")) at++
  }
}

/** Whether the words after `git commit` ask for a rehearsal: `--dry-run` makes no commit. */
function rehearsed(words: string[], from: number): boolean {
  for (let i = from; i < words.length; i++) {
    const word = words[i] ?? ""
    if (word === "--") return false
    if (COMMIT_VALUE_OPTIONS.has(word)) i++
    else if (word === "--dry-run") return true
  }
  return false
}

/**
 * Whether a shell command can make a commit by hand: `git commit`, `git commit-tree`,
 * `git cherry-pick`, `git rebase`, `git merge`, `git pull`, `git revert` or `git am`, also behind
 * `git -C <dir>`, an environment assignment, `env`, `command` or another wrapper, or `sh -c '…'`.
 * A command that only names the words (`echo git commit`) does not, nor does `git commit --dry-run`.
 * Whether it did make one is read off HEAD (`settleCommits`).
 */
export function shellCommits(tool: unknown, input: unknown): boolean {
  const command = shellCommand(tool, input)
  return shellSegments(command).some((tokens) => commitsCommand(tokens.map((token) => token.text)))
}

function commitsCommand(words: string[]): boolean {
  const at = programIndex(words)
  const program = words[at] ?? ""
  if (/(?:^|\/)(?:sh|bash|dash|ksh|zsh)$/.test(program)) {
    const script = inlineShell(words, program)
    return script !== undefined && shellCommits("bash", { command: script })
  }
  if (programName(program) !== "git") return false
  for (let i = at + 1; i < words.length; i++) {
    const word = words[i] ?? ""
    if (GIT_VALUE_OPTIONS.has(word)) i++
    else if (!word.startsWith("-")) {
      return COMMITTING.has(word) && !(word === "commit" && rehearsed(words, i + 1))
    }
  }
  return false
}
