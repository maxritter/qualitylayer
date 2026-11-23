import { comparisonRows, comparisonSources } from "./comparisons-evidence.ts";

export interface ComparisonSource {
  label: string;
  url: string;
}

export interface Comparison {
  slug: string;
  name: string;
  summary: string;
  /** The at-a-glance row: what to consider it for, what it plans with and where it runs. */
  bestFor: string;
  plansWith: string;
  runsIn: string;
  lead: string;
  strengths: string;
  agents: string;
  rows: { topic: string; qualitylayer: string; other: string; source: number }[];
  chooseOther: string;
  chooseQualityLayer: string;
  sources: ComparisonSource[];
  /** When the sources were last read, as an ISO date. */
  checked: string;
  /** The sources behind the strengths and behind "Runs in"; by default the first and the last. */
  strengthsSources?: number[];
  runsInSource?: number;
  /** A coding agent or agent manager rather than a spec-driven tool; kept out of the spec-driven roundup. */
  kind?: "agent";
}

type ComparisonEntry = Omit<Comparison, "rows" | "sources">;

const COMPARISON_ENTRIES: ComparisonEntry[] = [
  {
    slug: "superpowers",
    name: "Superpowers",
    summary: "A widely used skills framework for test-driven agent work, compared with QualityLayer's visual planning and recorded review.",
    bestFor: "Test-driven skills that run inside many coding agents",
    plansWith: "A brainstormed design document, then a plan of small tasks",
    runsIn: "Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Pi and more",
    lead: "Superpowers is an open source set of skills that guides your coding agent from design to finished branch. QualityLayer adds an App where you approve a visual Plan and review the evidence. Both keep you in your own agent.",
    strengths: "Superpowers is the most-starred project on GitHub among these tools. Its skills trigger on their own, enforce red-green-refactor test-driven development and refuse completion claims without fresh verification evidence. Subagents review each task for spec compliance, then code quality.",
    agents: "Superpowers installs from the official Claude Code and Codex plugin marketplaces and supports Cursor, Gemini CLI, GitHub Copilot CLI, OpenCode, Pi and Antigravity. QualityLayer also works in Claude Code and Codex; the difference is the App around the agent.",
    chooseOther: "Choose Superpowers if you want disciplined, test-first habits as a plugin or skills in the agents you already use.",
    chooseQualityLayer: "Choose QualityLayer if you also want a visual Plan to approve, evidence recorded for each agreed outcome and one place to review the finished change before the pull request.",
    checked: "2026-10-23",
    runsInSource: 1,
  },
  {
    slug: "spec-kit",
    name: "GitHub Spec Kit",
    summary: "Customizable specifications, plans and convergence checks, compared with QualityLayer's visual planning and review.",
    bestFor: "A spec process your team customizes",
    plansWith: "Constitution, specification, technical plan and tasks",
    runsIn: "Claude Code, Codex and other coding agents",
    lead: "GitHub Spec Kit gives your coding agent structured processes and reusable artifacts. QualityLayer adds visual planning and a place to review the result.",
    strengths: "Spec Kit is an open source toolkit with project principles, specifications, technical plans and implementation tasks. Extensions, presets and workflows let teams adapt the process to their own standards.",
    agents: "Spec Kit supports both Claude Code and Codex, alongside other coding agents. QualityLayer also works in those sessions. The decision is about the process you want around the agent.",
    chooseOther: "Choose Spec Kit if you want a toolkit you can customize around your repository's own specification and review conventions. Its convergence checks deserve credit; it goes beyond generating a plan.",
    chooseQualityLayer: "Choose QualityLayer if you want the App to carry visual planning, human approval and recorded outcome checks into one review flow, including follow-up on the pull request.",
    checked: "2026-10-19",
  },
  {
    slug: "openspec",
    name: "OpenSpec",
    summary: "Flexible change proposals, evolving specs and optional verification, compared with QualityLayer's evidence and human review.",
    bestFor: "Evolving specs in an existing repository",
    plansWith: "Change proposals with spec deltas, design and tasks",
    runsIn: "Claude Code, Codex and other coding tools",
    lead: "OpenSpec organizes a change around a proposal, requirements, a design and tasks. QualityLayer puts visual planning and outcome evidence into an approval flow. Both help you agree on the work before implementation.",
    strengths: "OpenSpec is an open source option for evolving an existing codebase. Each change has its own planning artifacts, and archiving folds spec updates into the main specifications. You can revise artifacts as your understanding changes.",
    agents: "OpenSpec supports Claude Code and Codex through tool-specific commands or skills. QualityLayer works with both too. Keeping your agent is a shared capability; compare how each process checks and closes the change.",
    chooseOther: "Choose OpenSpec if maintaining evolving specifications and small change proposals in your repository is the main goal. Its flexible artifact editing fits work where requirements change during implementation.",
    chooseQualityLayer: "Choose QualityLayer if you want explicit human approvals and evidence for the running result in the App. OpenSpec also checks implementation; QualityLayer's emphasis is how that proof reaches your review and pull request.",
    checked: "2026-10-19",
  },
  {
    slug: "bmad-method",
    name: "BMAD Method",
    summary: "Agile planning paths from a quick change to whole epics, compared with QualityLayer's approved Plan and recorded evidence.",
    bestFor: "Agile planning artifacts that scale from a change to an epic",
    plansWith: "Brief, PRD, architecture, UX documents and ordered stories",
    runsIn: "Its npm installer (v6.12), or Claude Code and Codex plugins (v7 preview)",
    lead: "BMAD Method turns an idea or change request into planning artifacts and working software. QualityLayer turns a request into an approved Plan and recorded proof. Both ask you to decide before the build.",
    strengths: "BMAD is free and open source with a large community. Its planning path scales with the work: what fits one session goes straight to build, larger work gets a PRD, architecture, UX documents and ordered stories. Its review sends several reviewers over the same diff and routes the open questions back to you.",
    agents: "BMAD's stable v6.12 installs with npm; its v7 preview ships plugins for Claude Code and Codex and needs a coding tool that supports skills. QualityLayer also works in Claude Code and Codex; compare the planning depth and the review each one gives you.",
    chooseOther: "Choose BMAD Method if you want agile product artifacts such as PRDs and stories, and a planning path that grows with the size of the work.",
    chooseQualityLayer: "Choose QualityLayer if you want a visual Plan, evidence that each agreed outcome works on the running program and an App that follows the pull request.",
    checked: "2026-10-23",
    runsInSource: 1,
  },
  {
    slug: "gsd",
    name: "GSD",
    summary: "A discuss, plan, execute, verify and ship loop for many agents, compared with QualityLayer's approvals and App.",
    bestFor: "A light spec loop with user-acceptance checks, in many agents",
    plansWith: "Context, research and plan files in dependency waves",
    runsIn: "Claude Code, Codex, Cursor, Copilot, OpenCode and more",
    lead: "GSD (Get Shit Done), now developed as GSD Core, runs a Discuss, Plan, Execute, Verify and Ship loop in your coding agent. QualityLayer folds that into three steps, Plan, Implement and Verify, with an App for approvals and review.",
    strengths: "GSD keeps each plan small enough for a fresh context window and checks plans before execution. Its verifier checks requirement and decision coverage, and a user-acceptance walkthrough asks you about each deliverable. A verification report goes stale when the code changes after it.",
    agents: "GSD installs into Claude Code, Codex, Cursor, Copilot, OpenCode and other agents. QualityLayer also works in Claude Code and Codex. The original GSD repository is archived; development continues as GSD Core.",
    chooseOther: "Choose GSD if you want a light, open source loop with user-acceptance checks that runs in many agents.",
    chooseQualityLayer: "Choose QualityLayer if you want explicit approvals in an App, a visual Plan and evidence you review before approving the change.",
    checked: "2026-10-23",
    strengthsSources: [2, 3],
    runsInSource: 1,
  },
  {
    slug: "kiro",
    name: "Kiro",
    summary: "Integrated spec workflows and property-based testing, compared with QualityLayer's process around your coding agent.",
    bestFor: "Specs inside one integrated coding environment",
    plansWith: "Requirements, design and trackable tasks",
    runsIn: "Kiro's own IDE, CLI and web surfaces",
    lead: "Kiro integrates specifications into its coding environment. QualityLayer works with your existing coding agent. Compare how each plans and checks a change.",
    strengths: "Kiro turns requirements into technical designs and trackable tasks. Feature Specs support requirements-first and design-first approaches. Its IDE also supports property-based testing that connects specified behavior to executable checks.",
    agents: "Kiro documents its own spec workflow in its IDE, CLI and web surfaces. QualityLayer's workflow runs with your coding agent. Kiro has a CLI too, so describing this as a choice between an IDE and a terminal would miss the point.",
    chooseOther: "Choose Kiro if you want specifications and task execution integrated into Kiro's environment. Its property-based testing is a substantive verification capability, with availability that varies by surface.",
    chooseQualityLayer: "Choose QualityLayer if you want to keep your coding agent and review an explicit record of outcomes, unresolved checks and approval decisions in the App.",
    checked: "2026-10-19",
    strengthsSources: [1, 2],
  },
  {
    slug: "traycer",
    name: "Traycer",
    summary: "An open source desktop app that runs several coding agents with planning artifacts, compared with QualityLayer's approval flow.",
    bestFor: "Running several agents side by side with shared plans and tickets",
    plansWith: "Epic brief, user flows, tech plan and tickets",
    runsIn: "Its desktop app, driving Claude Code, Codex, Cursor and OpenCode",
    lead: "Traycer and QualityLayer are both apps around the coding agents you already have. Traycer focuses on running agents in parallel with shared artifacts; QualityLayer on an approved Plan and recorded proof.",
    strengths: "Traycer runs Claude Code, Codex, Cursor and other agents side by side, each able to work in its own worktree. Its artifacts (briefs, flows, tech plans, tickets) can be edited and commented on, with wireframes, diagrams and version history. It is free with your own agents.",
    agents: "Traycer's desktop app drives Claude Code, Codex, Cursor and OpenCode. QualityLayer also starts Claude Code, Codex, Cursor and other agents from its App; the difference is the workflow each one runs.",
    chooseOther: "Choose Traycer if running several agents in parallel, with shared tickets and artifacts, is the center of your work.",
    chooseQualityLayer: "Choose QualityLayer if you want each change to pass through an approved Plan, recorded verification and a human review, in that order.",
    checked: "2026-10-23",
    strengthsSources: [1, 4, 5],
    runsInSource: 1,
  },
  {
    slug: "compound-engineering",
    name: "Compound Engineering",
    summary: "Every's brainstorm, plan, build and review plugin that saves what it learns, compared with QualityLayer's approvals and evidence.",
    bestFor: "A skills plugin that turns each change's lessons into the next plan",
    plansWith: "Requirements, then implementation-ready plans in docs/plans",
    runsIn: "14 agent hosts, including Claude Code, Codex and Cursor",
    lead: "Compound Engineering, from Every, structures agent work as brainstorm, plan, build, review and capture what you learned. QualityLayer also plans first and saves lessons, with an App for approvals and recorded proof.",
    strengths: "Compound Engineering puts most of the effort into planning and review. Its multi-agent code review checks the diff against the plan's requirements with severity levels, and what each change teaches is written down for the next plan. A hands-off mode opens the pull request and repairs CI failures within a limit.",
    agents: "Compound Engineering runs on 14 agent hosts, including Claude Code, Codex and Cursor. QualityLayer also works in Claude Code and Codex; compare the approvals and the evidence each gives you.",
    chooseOther: "Choose Compound Engineering if you want a free plugin that runs in many hosts and gets better at your codebase with every change.",
    chooseQualityLayer: "Choose QualityLayer if you want approvals in an App, a visual Plan and evidence on the running program before you approve.",
    checked: "2026-10-23",
    runsInSource: 1,
  },
  {
    slug: "claude-code-plan-mode",
    name: "Claude Code plan mode",
    summary: "Claude Code's built-in plan mode, compared with QualityLayer's full plan, build, verify and review flow around Claude Code.",
    bestFor: "A quick plan before a change, with nothing to install",
    plansWith: "A text plan Claude writes and you can edit",
    runsIn: "Claude Code",
    lead: "Plan mode is built into Claude Code: Claude explores and proposes a plan before editing. QualityLayer runs inside Claude Code too and adds the steps after the plan, from slices to recorded verification and review.",
    strengths: "Plan mode needs no setup. Claude explores, then presents a plan you can edit before approving. Its docs recommend skipping planning for a one-sentence diff. Separate verification tools include evaluator-checked goals, hooks and review subagents.",
    agents: "Plan mode is part of Claude Code. QualityLayer starts and works inside Claude Code as well, and also with Codex and other agents.",
    chooseOther: "Choose plan mode alone for small, well-understood changes where a quick written plan is enough.",
    chooseQualityLayer: "Choose QualityLayer for medium and large changes where you want the plan, the build, verification and review carried through in one flow.",
    checked: "2026-10-23",
    runsInSource: 1,
  },
  {
    slug: "cursor-plan-mode",
    name: "Cursor plan mode",
    summary: "Cursor's plan mode and Projects, compared with QualityLayer's planning and recorded verification around your agent.",
    bestFor: "Planning inside the Cursor editor before the agent builds",
    plansWith: "A markdown plan Cursor's agent writes after asking questions",
    runsIn: "Cursor",
    lead: "Cursor's plan mode researches your codebase, asks clarifying questions and writes a plan before building. QualityLayer adds a visual Plan you approve, recorded verification and review, and also starts Cursor as one of its agents.",
    strengths: "Plan mode is built into the Cursor editor. The plan is a markdown file you can edit in chat or directly, save to the workspace, or revert to and run again. For larger work, Cursor's Projects beta has a coordinator that plans and sends agents to implement and test parts in parallel.",
    agents: "Plan mode runs with Cursor's own agent. QualityLayer can start Cursor from its App, as well as Claude Code, Codex and other agents.",
    chooseOther: "Choose Cursor's plan mode if you work in Cursor and want planning built into the editor.",
    chooseQualityLayer: "Choose QualityLayer if you want the same plan-first flow across agents, with evidence for each agreed outcome and an explicit review before the pull request.",
    checked: "2026-10-23",
    runsInSource: 1,
  },
  {
    slug: "codex-plan-mode",
    name: "Codex plan mode",
    summary: "Codex's built-in plan mode, compared with QualityLayer's plan, build, verify and review flow inside Codex.",
    bestFor: "A quick plan in the Codex CLI, with nothing to install",
    plansWith: "A proposed plan Codex writes after reading the code and asking questions",
    runsIn: "Codex",
    lead: "Codex's /plan reads the repository, asks questions and proposes work before editing. QualityLayer adds visual planning, recorded checks and human review in the same agent.",
    strengths: "Plan mode needs no setup beyond Codex itself. Codex explores the code, asks the questions it needs answered and proposes an order of work without changing tracked files. For a change you can describe in one or two sentences, that is often all the planning you need.",
    agents: "Ask Codex in plain words: ‘Using QualityLayer, plan this change.’ Another supported agent can build the resulting Plan.",
    chooseOther: "Choose plan mode alone for small, well-understood changes where a short written plan is enough and you review the diff yourself.",
    chooseQualityLayer: "Choose QualityLayer for medium and large changes where you approve a visual plan. You see evidence that each agreed outcome works before the pull request.",
    checked: "2026-10-25",
    runsInSource: 1,
  },
  {
    slug: "humanlayer",
    name: "HumanLayer",
    summary: "Collaborative agent workspaces and portable RPI skills, compared with QualityLayer's verification and approval flow.",
    bestFor: "Shared agent sessions and design discussions for a team",
    plansWith: "Research, plan and implement phases with shared design documents",
    runsIn: "Its own app, or RPI skills in Claude Code and Codex",
    lead: "HumanLayer and QualityLayer both put people into agent planning. If you want a HumanLayer alternative, compare how each handles collaboration and what you review after implementation.",
    strengths: "HumanLayer brings sessions, artifacts and worktrees into a shared workspace. Its design documents support inline team comments that feed back to agents. That makes it a strong option when coordinating people and agent sessions is your main problem.",
    agents: "HumanLayer's portable RPI skill runs in Claude Code and Codex: /rpi in Claude Code and $rpi in Codex. Its app also supports both agents. Working inside these tools is shared ground with QualityLayer.",
    chooseOther: "Choose HumanLayer if shared workspaces, inline design discussions and managing multiple agent sessions are central to your day.",
    chooseQualityLayer: "Choose QualityLayer if you want an explicit Verify step, with evidence for the approved outcomes and unresolved checks visible before you approve.",
    checked: "2026-10-19",
  },
  {
    slug: "task-master",
    name: "Task Master",
    summary: "Task Master's PRD-to-task workflow for coding agents, compared with QualityLayer's visual Plan and recorded verification.",
    bestFor: "Turning a product requirements document into dependency-ordered tasks",
    plansWith: "A PRD parsed into tasks with dependencies, priorities and a test strategy",
    runsIn: "Cursor, Windsurf, VS Code, Claude Code and other MCP clients, or its own CLI",
    lead: "Task Master turns a product requirements document into ordered tasks for your agent. QualityLayer starts with a conversation and a visual Plan, followed by tests and independent review.",
    strengths: "Task Master is open source and runs as an MCP server or a CLI. It parses a PRD into tasks, each with dependencies, a priority and a test strategy. It scores their complexity, expands the hard ones into subtasks and tells the agent which task comes next. An optional research model can pull in current information while it plans.",
    agents: "Task Master works through MCP in editors such as Cursor, Windsurf and VS Code, and in Claude Code. It can also use Claude Code or the Codex CLI as its model. QualityLayer runs inside Claude Code, Codex and Cursor as well.",
    chooseOther: "Choose Task Master if you start from a written PRD and want your agent to work through a task list in dependency order.",
    chooseQualityLayer: "Choose QualityLayer if you want to shape the plan together with the agent, approve it visually and see evidence that each outcome works before the pull request.",
    checked: "2026-10-26",
    runsInSource: 1,
    strengthsSources: [1, 2],
  },
  {
    slug: "cline",
    kind: "agent",
    name: "Cline",
    summary: "Cline's Plan and Act modes with approval for each edit, compared with QualityLayer's approved Plan, recorded verification and review.",
    bestFor: "An open source agent in your editor that asks before each edit and command",
    plansWith: "Plan mode, which reads the code and discusses an approach without changing files",
    runsIn: "VS Code, JetBrains IDEs, a CLI and a desktop app",
    lead: "Cline plans with you, then edits in Act mode. QualityLayer structures work around your coding agent, with an approved visual Plan and recorded checks before your final review.",
    strengths: "Cline asks before every file edit and terminal command unless you turn on auto-approve, and it shows each change as a diff. Plan mode cannot modify files or run commands, Act mode keeps the context from planning, and each mode can use its own model. It works with many model providers, MCP servers and project rules.",
    agents: "Cline is its own agent with its own model settings. QualityLayer runs Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot natively, and other agents that can run shell commands through a copied prompt.",
    chooseOther: "Choose Cline if you want an open source agent in your editor and like to approve each step as it happens.",
    chooseQualityLayer: "Choose QualityLayer if you would rather agree on the outcome once, up front, and then review evidence that each agreed outcome works before the pull request.",
    checked: "2026-10-26",
    strengthsSources: [1, 2],
  },
  {
    slug: "aider",
    kind: "agent",
    name: "Aider",
    summary: "Aider's terminal pair programming with ask and architect modes, compared with QualityLayer's approved Plan and recorded verification.",
    bestFor: "Pair programming in the terminal, with a git commit for each change",
    plansWith: "Ask mode to discuss a change, or architect mode, where one model proposes and another edits",
    runsIn: "Your terminal, with a watch mode for comments you write in your IDE",
    lead: "Aider edits files from your terminal chat. QualityLayer adds a visual Plan and recorded verification around your coding agent.",
    strengths: "Aider builds a map of your whole codebase and connects to almost any model, local ones included. It commits each change with a descriptive message, so ordinary git tools can show or undo it. It lints the files it edits by default. With /test or the auto test setting it also runs your tests and tries to fix what fails. Its docs suggest discussing a change in ask mode before switching to code mode.",
    agents: "Aider is its own agent and works with many cloud and local models. QualityLayer runs inside Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot.",
    chooseOther: "Choose Aider if you want a light terminal tool that edits and commits small changes while you talk them through.",
    chooseQualityLayer: "Choose QualityLayer for larger changes where you want to approve the plan first and see evidence that each agreed outcome works before the pull request.",
    checked: "2026-10-26",
    strengthsSources: [3, 2, 1],
  },
  {
    slug: "github-copilot-coding-agent",
    kind: "agent",
    name: "GitHub Copilot cloud agent",
    summary: "GitHub Copilot's cloud agent, which works on a branch in the background, compared with QualityLayer's approved Plan and recorded verification.",
    bestFor: "Handing a task to an agent that works in the background on GitHub",
    plansWith: "Research and a plan it makes in the cloud before it changes code on a branch",
    runsIn: "An ephemeral environment on GitHub, for repositories hosted on GitHub",
    lead: "GitHub Copilot cloud agent researches, builds and tests in an ephemeral GitHub environment. QualityLayer runs your agent where you work, with approval at Plan and Verify.",
    strengths: "You hand Copilot a task and keep working while it runs in the background. It creates the branch, commits its work, runs tests and linters and keeps session logs you can follow. It supports custom agents, skills, hooks and MCP servers, so a team can shape how it works in their repositories.",
    agents: "Copilot cloud agent is GitHub's own agent. QualityLayer runs Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot CLI on your computer, in a dev container or on a server.",
    chooseOther: "Choose Copilot cloud agent if your code lives on GitHub and you want to hand off well-scoped tasks that run without your own machine.",
    chooseQualityLayer: "Choose QualityLayer if you want to agree on the plan before any code exists and see evidence for each agreed outcome, with the agent you already use.",
    checked: "2026-10-26",
  },
  {
    slug: "devin",
    kind: "agent",
    name: "Devin",
    summary: "Cognition's Devin, an autonomous agent with its own cloud workspace, compared with QualityLayer's approved Plan and recorded verification.",
    bestFor: "Delegating many scoped tasks to an autonomous agent in the cloud",
    plansWith: "Ask mode, which scopes a task and writes a prompt for an Agent session",
    runsIn: "Its web app with its own shell, IDE and browser, plus Slack, Teams, an API and a CLI",
    lead: "Devin is an autonomous coding agent that works in its own cloud workspace and opens pull requests. QualityLayer takes a different route. It runs the agent you already use and stops for you at two points: the Plan before code, and Verify before the pull request.",
    strengths: "Devin works from Slack, Teams, its web app or the terminal. A team can hand it bugs and tickets where they already talk. You can follow its shell, IDE and browser and take over at any point. After it opens a pull request it can test the app end to end and send you a screen recording. Devin Review groups the diff and flags likely bugs.",
    agents: "Devin runs Cognition's own agents. QualityLayer runs Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot where your code already is.",
    chooseOther: "Choose Devin if you want to hand off a backlog of scoped tasks and review the pull requests later.",
    chooseQualityLayer: "Choose QualityLayer if you want to decide the plan before code exists and approve the change with evidence for every agreed outcome.",
    checked: "2026-10-26",
    runsInSource: 1,
    strengthsSources: [1, 3, 4],
  },
  {
    slug: "claude-squad",
    kind: "agent",
    name: "Claude Squad",
    summary: "Claude Squad's terminal manager for parallel agent sessions, compared with QualityLayer's plan, verify and review flow.",
    bestFor: "Running several terminal agents side by side in one window",
    plansWith: "No planning step of its own; each session runs the agent you choose",
    runsIn: "A terminal app on tmux that runs Claude Code, Codex, Gemini, Aider and other agents",
    lead: "Claude Squad runs parallel terminal agents in separate git workspaces. QualityLayer structures each change around an approved Plan, recorded checks and human review.",
    strengths: "Each task gets its own isolated git workspace, so parallel agents do not get in each other's way. You switch between sessions, read the diff, and commit and push a branch from one terminal window. Sessions can keep working in the background, also in auto-accept mode.",
    agents: "Claude Squad starts Claude Code by default and can run Codex, Gemini, Aider and other local agents. Claude Code and Codex are agents QualityLayer supports as well.",
    chooseOther: "Choose Claude Squad if your main need is running and switching between many agent sessions in the terminal.",
    chooseQualityLayer: "Choose QualityLayer if your main need is knowing that one change does what you agreed, with a Plan you approved and evidence you can review.",
    checked: "2026-10-26",
  },
  {
    slug: "conductor",
    kind: "agent",
    name: "Conductor",
    summary: "Conductor's parallel agent workspaces, compared with QualityLayer's approved Plan, recorded verification and review.",
    bestFor: "Running Claude Code, Codex, Cursor and OpenCode in parallel workspaces",
    plansWith: "One workspace per shippable piece of work; each agent plans in its own way",
    runsIn: "A Mac app that runs Claude Code, Codex, Cursor and OpenCode",
    lead: "Conductor runs parallel agents in separate workspaces. QualityLayer structures each change around a visual Plan you approve and evidence you review after the build.",
    strengths: "Conductor treats each workspace as one stream of work, so you can start a new feature while another agent is still busy. It has a diff viewer whose inline comments go back to the agent, an agent review action and a Checks tab for git status, CI, deployments and todos. It can open the pull request, follow its checks and merge it.",
    agents: "Conductor runs Claude Code, Codex, Cursor and OpenCode. QualityLayer supports all of them and more, including Grok, Antigravity, Pi and GitHub Copilot.",
    chooseOther: "Choose Conductor if you run many agents at once on a Mac and want one place to review and merge their branches.",
    chooseQualityLayer: "Choose QualityLayer if you want each change agreed before code and checked against those agreed outcomes before you approve it.",
    checked: "2026-10-26",
    runsInSource: 1,
    strengthsSources: [2],
  },
];

export const COMPARISONS: Comparison[] = COMPARISON_ENTRIES.map((entry) => ({
  ...entry,
  rows: comparisonRows(entry.slug),
  sources: comparisonSources(entry.slug),
}));

/** The spec-driven tools and plan modes, without coding agents and agent managers. */
export const SPEC_TOOLS = COMPARISONS.filter((c) => c.kind !== "agent");
export const AGENT_TOOLS = COMPARISONS.filter((c) => c.kind === "agent");

export const ROUNDUP_PATH = "/best-spec-driven-development-tools";
export const COMPARISON_PATHS = ["/compare", ...COMPARISONS.map(({ slug }) => `/compare/${slug}`), ROUNDUP_PATH];

export const ROUNDUP_FAQS = [
  {
    question: "Which spec-driven development tool is best?",
    answer: "Choose by the work you need to coordinate. Spec Kit offers customizable processes; OpenSpec manages evolving change proposals; HumanLayer coordinates shared agent work; Kiro integrates specs into its environment. QualityLayer emphasizes visual planning, human approval and recorded outcome evidence. This guide compares documented capabilities, not benchmark scores.",
  },
  {
    question: "Do these tools work inside Claude Code and Codex?",
    answer: "QualityLayer, HumanLayer's portable RPI skills, Spec Kit and OpenSpec all support Claude Code and Codex. Kiro documents its own agent environment, including an IDE and CLI. Agent compatibility alone does not distinguish QualityLayer; compare how a tool handles planning, verification evidence and human review.",
  },
  {
    question: "How can I verify AI generated code against a spec?",
    answer: "Define observable acceptance criteria, run the relevant project checks and exercise the behavior those criteria describe. Record what passed, failed or could not be checked. QualityLayer's Verify step carries that evidence to human approval; independence depends on task risk and settings. Spec Kit, OpenSpec and Kiro also document implementation checks.",
  },
];
