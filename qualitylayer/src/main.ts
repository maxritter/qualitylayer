// Command table → handler. cli/ only parses and formats; every decision
// lives in core/. Gated commands pass the licence check first.

import "./cli/color-environment.ts"
import { isDevBuild, loadWorkflow } from "#workflow"
import { agentHostCmd } from "./cli/commands/agent-host.ts"
import { agentRunsCmd } from "./cli/commands/agent-runs.ts"
import { agentsCmd } from "./cli/commands/agents.ts"
import { appCmd } from "./cli/commands/app.ts"
import { artifactCmd, artifactSubUsage, artifactWorkflowTask } from "./cli/commands/artifact.ts"
import { automationsCmd } from "./cli/commands/automations.ts"
import { branchCmd } from "./cli/commands/branch.ts"
import { briefCmd } from "./cli/commands/brief.ts"
import { buildCmd } from "./cli/commands/build.ts"
import { chatCmd } from "./cli/commands/chat.ts"
import { checkCmd } from "./cli/commands/check.ts"
import { serveCmd } from "./cli/commands/cockpit.ts"
import { commitCmd } from "./cli/commands/commit.ts"
import { evidenceCmd } from "./cli/commands/evidence.ts"
import { feedbackCmd } from "./cli/commands/feedback.ts"
import { gateCmd } from "./cli/commands/gate.ts"
import { heavyCmd } from "./cli/commands/heavy.ts"
import { helperCmd } from "./cli/commands/helper.ts"
import { hookCmd } from "./cli/commands/hook.ts"
import { installCmd, uninstallCmd, updateCmd } from "./cli/commands/install.ts"
import { instructionsCmd } from "./cli/commands/instructions.ts"
import { licenceCmd } from "./cli/commands/licence.ts"
import { limitCmd } from "./cli/commands/limit.ts"
import { cardCmd, doctorCmd, findCmd, guideText, showCmd, tasksCmd } from "./cli/commands/lookup.ts"
import { machinesCmd } from "./cli/commands/machines.ts"
import { memoryCmd } from "./cli/commands/memory.ts"
import { memoryMcpCmd } from "./cli/commands/memory-mcp.ts"
import { nativeHelperCmd } from "./cli/commands/native-helper.ts"
import { needCmd } from "./cli/commands/need.ts"
import { nextCmd } from "./cli/commands/next.ts"
import { peersCmd } from "./cli/commands/peers.ts"
import { planCmd } from "./cli/commands/plan.ts"
import { prCmd } from "./cli/commands/pr.ts"
import { progressCmd } from "./cli/commands/progress.ts"
import { qualityCmd } from "./cli/commands/quality.ts"
import { questionCmd } from "./cli/commands/question.ts"
import { readCmd } from "./cli/commands/read.ts"
import { resetCmd } from "./cli/commands/reset.ts"
import { retentionCmd } from "./cli/commands/retention.ts"
import { reviewCmd } from "./cli/commands/review.ts"
import { settingsCmd } from "./cli/commands/settings.ts"
import { shipCmd } from "./cli/commands/ship.ts"
import { statusCmd } from "./cli/commands/status.ts"
import { statuslineCmd } from "./cli/commands/statusline.ts"
import { commentsCmd, taskCmd } from "./cli/commands/task.ts"
import { usageCmd } from "./cli/commands/usage.ts"
import { validateCmd } from "./cli/commands/validate.ts"
import { attestCmd, verdictCmd } from "./cli/commands/verdict.ts"
import { verifyCmd } from "./cli/commands/verify.ts"
import { waitCmd } from "./cli/commands/wait.ts"
import { installView } from "./cli/install-view.ts"
import { emit } from "./cli/output.ts"
import { wakeServerToSend } from "./core/automations/queue.ts"
import { FLOW_STEPS } from "./core/flow.ts"
import { verify } from "./core/licence/verify.ts"
import { recordCall } from "./core/live/record.ts"
import { checkThen, takeSetNeeds } from "./core/need/need.ts"
import { refreshCurrent } from "./core/pages/refresh.ts"
import { resolveRepo } from "./core/paths.ts"
import { hideChildWindows } from "./core/platform.ts"
import { keepAlive, resolveTask } from "./core/task/store.ts"
import { VERSION } from "./core/version.ts"
import { rememberWaitReply } from "./core/wait.ts"
import { type Ctx, err, type Result, realCtx, withoutRepositoryGit } from "./ctx.ts"
import { crashLine } from "./server/crash.ts"
import { cachingGit } from "./server/git-cache.ts"
import { withTaskMemory } from "./task-memory.ts"
import { leadInstructions } from "./workflow/notice.ts"

export { VERSION }

/** The same command with the environment naming the task, as `--task <slug>` does for any command. */
function forTask(ctx: Ctx, slug: string): Ctx {
  const inner = ctx.env
  return {
    ...ctx,
    env: { cwd: inner.cwd, get: (name) => (name === "QUALITYLAYER_TASK" ? slug : inner.get(name)) },
  }
}

const USAGE = `qualitylayer — ${FLOW_STEPS.map((step) => step.label).join(" → ")}: the planning-first harness for any coding agent

workflow (ask your agent to plan or implement using QualityLayer or QL); \`next\` reads, every change is a verb:
  qualitylayer next   (where the task is, what is open, who is waited for, and the moves open now; reads only, changes nothing)
  qualitylayer brief [plan | implement | verify]   (the step's text and payload, once per session; may start the step's helpers)
  qualitylayer task start "<request>" [--type feature|bug|chat] [--title <words>] [--terminal | --app] [--from <ticket link> | --from-plan <file | ->] [--plan [--agent <id>]]   (a task at Plan, or a Chat with --type chat; from a script with no agent session the reply is {task, id, title, step, planning} and the task waits on Home, --plan also asks the local server to start the planning agent; --from reads a GitHub or GitLab issue or pull request with your own gh or glab, its text becomes the request and the task keeps the link, and a Jira or Confluence link goes to the agent to read with its own tools; --from-plan keeps the person's own plan as given)
  qualitylayer plan draft   (validates the Plan and starts its review; every error names its fix)
  qualitylayer gate open plan | final [--via github [--asked "<the person's words>"]] · gate decide changes "<remark>"   (--via github also pushes the Plan on its own branch, or the task's branch for the final review, and opens GitHub's prefilled compare page, where the person creates the pull request; an approving review there by someone else with write access settles the gate when wait --for approval reads it, and every comment comes back as feedback)
  qualitylayer gate decide approve --asked "<their exact words>"   (only when the person asked for the approval in this chat: their words from a message since the gate opened)
  qualitylayer comments list | take | resolve <id…> | all [--answer "<one line on what changed>"] [--changed]   (the person's comments on the task's pages: take hands over the new ones, resolve answers them)
  qualitylayer wait [--for answer | approval | review | helper] [--until-decided] [--until-event] [--batch <id>] [--quiet <s>] [--seconds 1..1800] [--home]   (the one way to wait: returns when the person, a reviewer or a helper acts; a recorded decision is applied once; without --for it waits for what the task waits for)
  qualitylayer plan amend --by agent|user --note "<what changed and why>" [--for T<n>] [--because "<why it is needed>"]   (a visible change to the approved Plan; a card is the build's own and is edited, never amended)
  qualitylayer plan export --out <folder>   (writes the Plan, its agents' file and assets/ with relative links for reading outside QualityLayer; lists every asset it could not capture)
  qualitylayer build start [--task <task>]   (this session takes the approved Plan's build and gets Implement's text and the cards' template; without a task it builds the one approved Plan, or lists those that wait)
  qualitylayer progress "<line>" [--for T<n>] [--agent <id>]   (one line on what is being done; progress done --agent <id> says a helper is over)
  qualitylayer check slice <n> | task T<n> | step A<n> [-- <command>] | all [--background] | all --base   (runs the commands the Plan approved and records them; step A<n> runs a Done means step on the built tree; --base runs the project checks on the task's base commit, to show a red check was red before the task)
  qualitylayer build done [--defer "<why>"]   (the build is ready: Verify starts; refused with each missing card or Done means step and its move; --defer takes what is open to Verify)
  qualitylayer verify judge | recheck | fix | keep-red   (hand out the fresh reviewer and read its verdicts · a fresh reviewer rechecks what failed and the lines the fix changed · start a fix round · keep red checks red on the person's answer)
  qualitylayer ship   (after the final approval: the landing steps; asked again while the pull request is open, its triage)
  qualitylayer task handback "<reason>" --prompt "<prompt>" · task abandon
  qualitylayer show <topic>   (a page drawn for the person about a topic, at any stage)
  qualitylayer chat plan save --file <markdown> | --text <markdown>
  qualitylayer chat build [--file <outline-markdown> | --stop <slice>]
  qualitylayer chat check [--slice <n>] | review | promote --type feature|bugfix
  qualitylayer chat rename "<title>"   (gives the Chat a short title after the first reply)
  qualitylayer commit slice <n> [--message "<text>"] [--leave <path>]... [--take <file>]... [--take-staged <file>]...   (commits the slice's files; --take explicitly claims captured unstaged pre-build content of an approved card file; unrelated staging stays staged)
  qualitylayer commit slice <n> --commit <hash>   (records an existing checked manual commit and releases the slice; creates no new commit; a reworded commit registered again replaces that slice's earlier entry)
  qualitylayer commit fix --commit <hash>   (records a fix you committed by hand, beside the slice receipts and replacing none; creates no new commit)
  qualitylayer commit fix [--message "<text>"] [--take-staged <file>]...   (commits the files this task's sessions edited and nothing else, the way commit slice does)
  qualitylayer commit slices <n> <m> ... [--message "<text>"] [--take <file>]... [--take-staged <file>]...   (commits explicitly grouped completed and checked slices as one tree, with their checks and repository hooks; --take claims captured unstaged pre-build content of an approved card file)
  qualitylayer branch new [name]   (start the build on a new branch: creates it and switches to it, ql/<the task's name> or the name you give; only when you run it)
  qualitylayer pr watch [--wait <seconds>] [--limit <seconds>] [--again]   (after the pull request is open: wait for its checks and answer green, failing with the failed logs, conflict, no-checks, pending or gave-up after three fix attempts)
  qualitylayer verdict <assignment> <item> pass|fail|missing|user|note "<text>" [--evidence <file>] [--run <id> --mode scripted|real-session]   (an agent that checks records one result as it finishes it)
  qualitylayer verdict run <assignment> [--name <file>] [--timeout <seconds>] -- <program> [args…]   (a judge runs one project command in its own tree with its environment and keeps the output under evidence/; one program, no shell script)
  qualitylayer attest <item> "<what the person said>" [--evidence <file>]   (record what the person confirmed, outside the build log)
  qualitylayer card T<n>   (one task card and the contracts it names, read-only)
  qualitylayer helper result <helper-id> [--file <path>]   (keep a helper's report under the task, at once: a research helper's in research/; without --file it is read from standard input)
  qualitylayer question ask '<json>'   (ask the person in the App: in the Plan it waits for the answer (answered, unsure, more, cancelled or waiting); in Implement and Verify it is asked once and holds nothing)
  qualitylayer question ask --batch --file <json file, - for stdin>   (several questions at once, e.g. {"id":"b1","questions":[{"id":"q1","question":"Which?","choices":[{"label":"A"},{"label":"B"}],"points":[]}]}; choices are objects with a label, 2 to 6 each)
  qualitylayer question link <id> --points 1,3   (set the Done means points an answer settles, once Done means are written)
  qualitylayer question progress "<line>" | question show '<json>' | question show <id> (the open question as stored: recommended, why, since) | question answered "<what the person said in this chat>"
  qualitylayer need "<what. why>" --for T<n> [--kind secret|login|account|service|permission] [--check <ENV_VAR or file>] [--step "<text>"]   (the build needs something only the person can do; nothing stops)
  qualitylayer need resolved T<n> · need reopen T<n> "<why>"   (say whether you found what the person gave)
  qualitylayer limit add [--for T<n>] "<the limit>" · limit list   (a limit the build or its reviews could not remove: Implement lists it under Known limits, and one outside the task is a follow-up with its owner in agents/02-implement.md; nothing stops)
  qualitylayer instructions [list] · instructions add <step> "<line>" · instructions done|skip <step> <n> --note|--reason "<sentence>"   (step checks: a "- [ ]" line under a step heading of your instructions; the agent does it or skips it with a reason, and Verify shows which)
  qualitylayer heavy hold --reason "<why>" [--until <HH:MM>] [--holder <name>] [--lease <id>] · heavy release --lease <id> · heavy status [--json]   (optional: say that this session runs a long measurement, for people and other heavy holders; check all and next never wait on it)
  qualitylayer task set answers=app|terminal approvals=app|terminal type=feature|bugfix ui=true|false profile=small|full title=<short name>
  qualitylayer task override +security|-security|+second-opinion|-second-opinion|+second-opinion:plan|-second-opinion:plan|+second-opinion:change|-second-opinion:change|+small|-small
  qualitylayer task archive|restore <task>   (keep stage and evidence; restore before continuing)
  qualitylayer artifact guide [authoring|review]   (local artifact prompts; no task or repository needed)
  qualitylayer artifact adopt <draft> --into <lasting> --if-match <adoption_revision> --target-revision <library_revision> [--project]   (records the standalone draft revision implemented in the canonical artifact; preserves both sources)
  qualitylayer artifact new <name> [--purpose "<one line>"] [--project] [--wire] [--folder] [--on <artifact>[/<page>[,<page>…]]]   (a page you draw for the person: the task's artifacts/, or docs/artifacts/ with no task; --wire writes a wireframe, two layouts side by side when the name ends in -options; --folder starts a multi-file artifact; --on drafts on a lasting artifact of the project)
  qualitylayer artifact show <name> [--task <slug>] [--page <page>] [--changed "<what changed>"] [--open]   (mark the latest under Artifacts; --open brings its selected page to the front)
  qualitylayer artifact open <name> [--project] [--task <slug>] [--page <page>] [--query <parameters>] [--section <id-or-label>] [--browser] [--no-open]   (open the exact page in QualityLayer or the browser; report unresolved sections)
  qualitylayer artifact keep <name> [--only-here] [--title "<title>"] [--purpose "<one line>"]   (a draft becomes a lasting artifact of the project, or stays only on this computer)
  qualitylayer artifact library inspect|rename|copy|archive|restore|delete <name> [--title <title>] [--to <copy-name>] [--to-project <id>] [--if-match <revision>] [--confirm-in-use]   (guarded Library management; source files and identity are preserved)
  qualitylayer artifact list   (list also shows the project's lasting artifacts)
  qualitylayer artifact list [--task <slug>] [--lasting] [--name <name or title>] [--compact]   (a focused list with consistent scope and file fields)
  qualitylayer artifact check <name> [--task <slug>] [--page <page>]
  qualitylayer artifact tokens <name> [--project] [--page <page>] [--refresh --if-match <revision>]   (design tokens that differ from the design file; --refresh rewrites exactly those values in a task or project draft)
  qualitylayer artifact review <name> [--page <page>] [--request "<what was asked for>"] · artifact review <name> [--page <page>] --done --report <file>   (when Settings › Workflow › Reviews has Design review on: a fresh check of a finished design, for you to hand to a fresh subagent before you tell the person it is ready; --done records its report)
  qualitylayer artifact shot <name> [--page <page>] [--query <parameters>] [--width <px>] [--theme light|dark] [--section <label>] [--out <file>]   (a picture of it, to look at your own work)
  qualitylayer evidence add --run <id> --mode scripted|real-session [--step A<n>] <file>   (keep a picture or a terminal output as proof of one run of the Done means steps; the run, step and mode are recorded with it)
  qualitylayer evidence shot <key> --url <loopback-url> --run <id> --mode scripted|real-session [--step A<n>] [--width <px>] [--height <px>] [--theme light|dark] [--wait-for <selector>] [--click <selector>]... [--crop <selector>]   (record a built screen or why it could not be captured; --click opens a dialog or state first, in order; a single-file task artifact artifacts/page.html#section uses key page#section)
  qualitylayer validate <document>${isDevBuild ? "\n  qualitylayer show <phase>   (a development build prints a phase's text)" : ""}
  qualitylayer guide   (the skill's rules as text, for a goal that names QualityLayer)

app (the QualityLayer App, next to this command line):
  qualitylayer agents list|check [all|claude-code|codex|pi|opencode|cursor|grok|copilot|antigravity]   (cached status or explicit executable/version checks; no model request)
  qualitylayer agents repair <claude-code|codex|pi|opencode|cursor|grok|copilot|antigravity>   (put back QualityLayer's skills and hooks in one agent; yours stay)
  qualitylayer app [<task> | task/<id>[/<doc>]] · app pair · app ensure · app stop · app link <doc> ["<heading>"]
  qualitylayer app status   (the port the server listens on, and whether it had to take another) · app restart   (start it again, e.g. after settings set cockpit.port <port>; QUALITYLAYER_PORT=<port> sets the port for one start)
  qualitylayer serve [--port <n>]   (the App's server, as the App starts it)

agents talking to each other (Claude Code, Codex, Pi, OpenCode, GitHub Copilot, Grok, Cursor and Antigravity, any direction):
  qualitylayer peers list · peers send --to cc:<name>|codex:<name> --message "<text>" · peers help

local code health:
  qualitylayer quality setup | status | on | off   (managed Qlty installation and this project's automatic checks)
  qualitylayer quality check [paths...] [--all] [--duplication] [--fail-on-new]   (review structure findings from working source; advisory by default)
  qualitylayer quality metrics | lint [paths...] [--all]   (function metrics or the project's enabled Qlty linters)
  qualitylayer quality acknowledge <finding-id> --reason "<specific review reason>"   (retain a source-bound reviewed disposition)

lookup and repair:
  qualitylayer read <document | artifact <name>> [--page <page>] [--width <columns>] [--lead]   (documents and artifacts as terminal text; an agents' file as agents/NN-step.md)
  qualitylayer read <document | step> --structure [--json]   (the sections of one file, or of both files of a step: required or not, who writes it, its lines)
  qualitylayer settings get [<key>] · settings set <key> <value>   (read or change config.json; keys may use dotted paths, e.g. settings set models.codex.design gpt-6.1-sol or settings set secondOpinion.reviewers.claude-code.agent codex; a list takes commas)
  qualitylayer automations add --url <url> | --command "<command>" [--events <names>] [--projects <names or ids>] · automations list · automations events   (send the task's events to a URL as signed JSON, or run a command once with the event as JSON on its input; --events and --projects limit it, all by default; list shows each automation with its last delivery and a URL's secret masked; events names the ten)
  qualitylayer automations set <id> [--url <url> | --command "<command>"] [--events <names>] [--projects <names or ids>] [--on | --off] · automations remove <id> · automations test <id> · automations log [<id>] · automations secret <id>   (change, remove or switch off one, which drops what waits for it; test sends a sample event now and prints the result; log lists the tries, newest first; secret shows a URL's signing secret)
  qualitylayer usage import cursor <file.csv> --from <ISO time> --to <ISO time> [--account <local label>]   (import Cursor provider usage locally; no sign-in or upload)
  qualitylayer memory overview | projects | list [--sources changed] | search <text> | context <text> | read <id> [--around 1..3]
  qualitylayer memory store --title <text> --content <text> [--file <path>]… [--rests-on <task, decision n>] [--replaces <id>]
  qualitylayer memory confirm|retire|restore <id> [--reason <text>] | pin|unpin <id> | pause|resume | share on|off | sync|export|import | import-pilot <file>…
  qualitylayer memory mcp   (the lesson tools memory_search, memory_read, memory_save and memory_keep as an MCP server on stdin and stdout)
  qualitylayer find "<text>" · tasks [--status <s>] [--since 30d] · doctor [--repair]
  qualitylayer tasks --cost [--since <period>]   (each task of the last 30 days, or of the period, newest first, with its step and cost: {usd, active_ms, tokens}, plus token_warning while a task at work runs well above your usual task; usd is null where QualityLayer cannot price the task. It reads for at most 20 seconds: tasks not reached have cost null, the reply says complete false and how many are pending, and asking again continues)
  qualitylayer retention sweep [--json] [--now <ISO date>]   (keeps the home inside its limits: old cost months become totals, stale leftovers go; the server and the prompt hook run it by themselves)
  qualitylayer reset --first-start · reset --restore <folder>   (start the App as on its first day, keeping the licence; the moved files wait in a dated folder for the restore)

installation:
  qualitylayer install · update [--version <v>] · uninstall [--purge | --keep-data]
  qualitylayer hook prompt   (Claude Code's and Codex's prompt hook: records "approve" typed in the session that asked for it; the installer sets it)
  qualitylayer hook activity   (their PostToolUse hook: every tool call keeps the task's session alive; the installer sets it)
  qualitylayer hook approve --agent <agent>   (their PermissionRequest hook: while the Conversation view shows the session, the prompt is answered there; otherwise it prints nothing and the agent asks as usual; the installer sets it)
  qualitylayer hook live   (their other hooks: a tool call starts, an agent starts or stops, a turn or session ends, a permission prompt; for the App's live status)
  qualitylayer status --json   (the open task for the Claude Code mod: step, approval, build, quality check)
licence and privacy:
  qualitylayer licence status | activate <key> | deactivate | portal
  qualitylayer machines list | add <user@host> [--password-stdin] | add --container <name> | containers | snippet | nearby | status | pair | retry | trust | rename | remove <name> [--release] [--keep-key]   (other computers and dev containers, paired over ssh as the App's Add machine does)
  qualitylayer feedback preview "<description>" --title "<title>" [--idea]   (public text-only preview; screenshot reports use the App)
  qualitylayer feedback submit <id> --confirm <preview-digest>   (publish the exact public issue reviewed)
  qualitylayer feedback "<text>" --private [--idea] [--image <file>]…   (contact private support)

options: --json (machine-readable envelope) · --task <slug> (when several tasks are open)
`

/** The usage lines that name `command`, or the whole usage when none does. */
function usageOf(command: string): string {
  const named = new RegExp(`(?:qualitylayer|·) ${command.replace(/[^a-z-]/g, "")}\\b`)
  const lines = USAGE.split("\n").filter(
    (line) => line.startsWith("  qualitylayer ") && named.test(line),
  )
  return lines.length > 0 ? `usage:\n${lines.join("\n")}` : USAGE
}

type Handler = (ctx: Ctx, args: string[]) => Promise<Result<unknown>>

export const commands: Record<string, Handler> = {
  read: readCmd,
  settings: settingsCmd,
  automations: automationsCmd,
  usage: usageCmd,
  agents: agentsCmd,
  next: nextCmd,
  brief: briefCmd,
  build: buildCmd,
  verify: verifyCmd,
  ship: shipCmd,
  memory: memoryCmd,
  gate: gateCmd,
  plan: planCmd,
  comments: commentsCmd,
  task: taskCmd,
  artifact: artifactCmd,
  evidence: evidenceCmd,
  validate: validateCmd,
  // A topic's page at any stage; a development build also prints a phase by its name.
  show: showCmd,
  find: findCmd,
  card: cardCmd,
  check: checkCmd,
  chat: chatCmd,
  quality: qualityCmd,
  commit: commitCmd,
  branch: branchCmd,
  pr: prCmd,
  verdict: verdictCmd,
  attest: attestCmd,
  progress: progressCmd,
  helper: helperCmd,
  review: reviewCmd,
  question: questionCmd,
  wait: waitCmd,
  need: needCmd,
  limit: limitCmd,
  instructions: instructionsCmd,
  heavy: heavyCmd,
  tasks: tasksCmd,
  doctor: doctorCmd,
  status: statusCmd,
  serve: serveCmd((ctx) =>
    verify(ctx, { startup: true, onFailure: (cause) => crashLine(ctx.home, "licence", cause) }),
  ),
  app: appCmd,
  "agent-host": agentHostCmd,
  "agent-runs": agentRunsCmd,
  retention: retentionCmd,
  reset: resetCmd,
  licence: licenceCmd,
  license: licenceCmd,
  machines: machinesCmd,
  feedback: feedbackCmd,
  install: installCmd,
  update: updateCmd,
  uninstall: uninstallCmd,
}

// The workflow needs an entitlement. Looking things up, repairing, validating and
// everything about the licence itself never do. The Cockpit always starts: its
// guard refuses the API with 402, so the page can say why and where to go.
const GATED = new Set([
  "chat",
  "evidence",
  "wait",
  "next",
  "brief",
  "build",
  "ship",
  "gate",
  "plan",
  "comments",
  "task",
  "artifact",
  "show",
  "check",
  "commit",
  "branch",
  "pr",
  "verdict",
  "verify",
  "attest",
  "need",
  "limit",
  "instructions",
])
// A command that works on a task tells it that its session is alive; they keep the state they find.
// `next` only reads: it is no sign of life and writes nothing.
const KEEPS_ALIVE = new Set([
  "chat",
  "evidence",
  "wait",
  "question",
  "progress",
  "helper",
  "brief",
  "build",
  "ship",
  "comments",
  "check",
  "commit",
  "pr",
  "verdict",
  "verify",
  "attest",
  "plan",
  "artifact",
  "validate",
  "gate",
  "need",
  "limit",
  "instructions",
])
// With `--task`, these ask about, answer, wait on or read the task they name: a coordinating session
// that runs them stays its own, while a command that does the task's work joins it.
const VISITS = new Set(["question", "need", "wait", "comments", "validate"])
// The workflow commands that are a sign of life besides those: the band's own `status` never is.
const SIGNS_OF_LIFE = new Set(["review"])
// The commands that change a task's state: after each, the task's documents are brought up to
// date (core/pages/refresh.ts). `validate` and `next` are not: they read what is on disk.
const REFRESHES = new Set([
  "evidence",
  "build",
  "ship",
  "wait",
  "gate",
  "plan",
  "comments",
  "task",
  "question",
  "check",
  "commit",
  "branch",
  "verdict",
  "verify",
  "attest",
  "artifact",
  "review",
  "need",
  "limit",
])
// A release build holds no phase text; these commands read it, so it is fetched first.
// `review` is not gated, and loading the texts checks its entitlement too.
const READS_WORKFLOW = new Set([
  "brief",
  "build",
  "ship",
  "show",
  "gate",
  "plan",
  "task",
  "review",
  "verify",
  "read",
])

export async function run(argv: string[], baseCtx: Ctx): Promise<number> {
  // Its own flags and plain output, like the status line: argv goes through untouched.
  if (argv[0] === "peers") return peersCmd(argv.slice(1))
  const json = argv.includes("--json")
  let args = argv.filter((arg) => arg !== "--json")

  let ctx: Ctx = { ...baseCtx, invocationTask: undefined }
  const taskFlag = args.indexOf("--task")
  if (taskFlag !== -1) {
    const slug = args[taskFlag + 1]
    args = args.filter((_, index) => index !== taskFlag && index !== taskFlag + 1)
    if (slug !== undefined) ctx = { ...forTask(ctx, slug), invocationTask: slug }
  }

  const [command, ...rest] = args
  if (ctx.invocationTask !== undefined && command !== undefined && VISITS.has(command))
    ctx = { ...ctx, visitsTask: true }
  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE)
    return command === undefined ? 1 : 0
  }
  if (command === "--version" || command === "version") {
    console.log(VERSION)
    return 0
  }
  // The command was renamed with the designs: say so once, so an agent running on old instructions
  // corrects itself. This is an error, not an alias: nothing runs.
  if (command === "design") {
    const same = argv
      .slice(argv.indexOf("design") + 1)
      .filter((arg) => arg !== "--json")
      .join(" ")
    return emit(
      err({
        code: "bad_args",
        message: `"design" is now "artifact": run qualitylayer artifact${same === "" ? "" : ` ${same}`}`,
      }),
      json,
    )
  }
  // `install --help` must never install: help after a command prints its usage
  // and runs nothing. `next` and `find` take free text, where `-h` is a word.
  if (
    rest.includes("--help") ||
    (rest.includes("-h") && command !== "next" && command !== "find")
  ) {
    // `artifact <sub> --help` prints that subcommand's own usage; `artifact --help` the whole.
    const subUsage = command === "artifact" ? artifactSubUsage(rest[0]) : null
    console.log(subUsage === null ? usageOf(command) : `usage:\n  ${subUsage}`)
    return commands[command] === undefined && command !== "statusline" && command !== "guide"
      ? 1
      : 0
  }

  // Kept for one release for a status line set by hand: prints nothing.
  if (command === "statusline") return statuslineCmd()
  // The agents' prompt hook: plain lines for the agent, and it runs on every message.
  if (command === "hook") return hookCmd(ctx, rest)
  if (command === "native-helper") return nativeHelperCmd(ctx, rest)
  // The memory tools as an MCP server: JSON-RPC lines on stdout, so no envelope may follow them.
  if (command === "memory" && rest[0] === "mcp" && rest.length === 1) return memoryMcpCmd(ctx)
  // The skill's rules as plain text, for a goal the user started by naming QualityLayer.
  if (command === "guide") {
    console.log(guideText())
    return 0
  }

  // A person installing sees the install screen; --json and `update`'s --refresh get the envelope.
  if (command === "install" && !json && !rest.includes("--refresh")) return installView(ctx, rest)

  const handler = commands[command]
  if (handler === undefined) {
    return emit(err({ code: "bad_args", message: `unknown command "${command}"` }), json)
  }
  // A command that reads the texts loads them first: that asks qualitylayer.dev, the only one that
  // can vouch for a machine whose clock mark was lost, and checks the entitlement as it goes. A
  // development build has nothing to load, so its check below stays as strict as before.
  if (READS_WORKFLOW.has(command)) {
    const loaded = await loadWorkflow(ctx)
    if (!loaded.ok) return emit(loaded, json)
  }
  if (GATED.has(command)) {
    const entitled = await verify(ctx)
    if (!entitled.ok) return emit(entitled, json)
  }
  // Exporting a Plan only reads the task: no sign of life, no refresh of its documents.
  let workflowEffects = !(command === "plan" && rest[0] === "export")
  if (command === "artifact") {
    const task = await artifactWorkflowTask(ctx, rest)
    workflowEffects = task !== null
    if (task !== null) ctx = forTask(ctx, task.slug)
  }
  // `next` reads only: none of the effects below (a sign of life, a saved reply, a refresh) run for it.
  if (command === "next") return emit(await handler(ctx, rest), json)
  if (workflowEffects && KEEPS_ALIVE.has(command)) await keepAlive(ctx, "command")
  let result = await handler(ctx, rest)
  // A step's text comes with the lessons the project kept for it.
  if (command === "brief" || (command === "build" && rest[0] === "start") || command === "ship")
    result = await withTaskMemory(ctx, result)
  // Every workflow call is a sign of life for the live status, and a refusal is counted there.
  if (workflowEffects && (KEEPS_ALIVE.has(command) || SIGNS_OF_LIFE.has(command))) {
    await recordCall(ctx, command, rest, result)
    // A need the person set in the App reaches the agent with its next call.
    if (command !== "need" && command !== "wait") result = await withSetNeeds(ctx, result)
  }
  // This saves a prepared reply for Stop and legacy cursors, never proof of native consumption.
  // Background reads and retention must preserve the last workflow Stop reply.
  if (
    workflowEffects &&
    command !== "status" &&
    command !== "read" &&
    command !== "heavy" &&
    command !== "memory" &&
    command !== "retention"
  )
    await rememberWaitReply(ctx, result).catch(() => {})
  // A task with one document per step: what the command changed shows in its documents. A refused
  // command changed nothing, and writes nothing there: the next hand edit meets the text as it was.
  if (workflowEffects && REFRESHES.has(command) && result.ok) await refreshCurrent(ctx)
  return emit(result, json)
}

/** The needs the person set since the agent last heard, told once with what to do. */
async function withSetNeeds(ctx: Ctx, result: Result<unknown>): Promise<Result<unknown>> {
  if (!result.ok || typeof result.data !== "object" || result.data === null) return result
  try {
    const repo = await resolveRepo(ctx)
    if (!repo.ok) return result
    const task = await resolveTask(ctx, repo.data)
    if (task === null) return result
    const set = await takeSetNeeds(ctx, task)
    if (set.length === 0) return result
    const lines = set.map(
      (need) =>
        `**The person set what ${need.for} needs**${need.set?.note ? ` ("${need.set.note}")` : ""}. ${checkThen(need)}`,
    )
    const data = result.data as Record<string, unknown>
    return {
      ok: true,
      data: {
        ...data,
        needs_set: set.map((n) => ({ for: n.for, note: n.set?.note ?? "", check: n.check })),
        instructions:
          typeof data.instructions === "string"
            ? leadInstructions(data.instructions, lines.join("\n"))
            : lines.join("\n"),
      },
    }
  } catch {
    return result
  }
}

// No top-level await: the binary is compiled to bytecode, which needs a plain module.
if (import.meta.main) {
  // Before anything is made under the home: a shell with umask 002 (an ssh login on Ubuntu) would
  // make QualityLayer's folders group-writable, and QualityLayer refuses such a folder. Every
  // command, the server and the agents it starts inherit this; a stricter umask stays as it is.
  if (process.platform !== "win32") process.umask(process.umask() | 0o022)
  hideChildWindows()
  const argv = process.argv.slice(2)
  // The server serves every project and starts their agents: a GIT_DIR it was started with (from a git
  // hook, or a script building from a copy) must never route all of them to one repository.
  if (argv[0] === "serve") withoutRepositoryGit(process.env)
  const base = realCtx()
  // One command asks git the same questions about commits and refs many times over (a verdict check
  // asked 150 of them in a second run). The server keeps its own, fuller cache.
  const ctx: Ctx = argv[0] === "serve" ? base : { ...base, git: cachingGit(base, { trees: false }) }
  run(argv, ctx)
    .then(async (code) => {
      process.exitCode = code
      // Events this command queued for the person's automations are sent by the local server. The
      // server itself sends its own, and once it has stopped it must not start another.
      if (argv[0] !== "serve") await wakeServerToSend(base)
    })
    .catch((cause: unknown) => {
      // Bun's default rejection report prints source context from the protected bundle.
      process.exitCode = emit(
        err({
          code: "bad_args",
          message: cause instanceof Error ? cause.message : "Command failed",
        }),
        process.argv.includes("--json"),
      )
    })
}
