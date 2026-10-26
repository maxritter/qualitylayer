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
}

export const COMPARISONS: Comparison[] = [
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
    rows: [
      { topic: "Agree on the change", qualitylayer: "Review architecture diagrams and clickable artifacts, then approve the Plan before code.", other: "Brainstorming proposes two or three approaches, writes a design document and is meant to build nothing until you approve it.", source: 2 },
      { topic: "Build it", qualitylayer: "Slices are built test first, with the agreed outcomes kept beside each slice.", other: "A plan of two-to-five-minute tasks, each with file paths, code and verification steps, run by subagents.", source: 1 },
      { topic: "Check the result", qualitylayer: "Verify records output, screenshots or files for each agreed outcome, then brings gaps to human Review.", other: "Code review against the plan blocks on critical issues; finishing a branch verifies tests and offers merge, pull request, keep or discard.", source: 1 },
    ],
    chooseOther: "Choose Superpowers if you want disciplined, test-first habits as a plugin or skills in the agents you already use.",
    chooseQualityLayer: "Choose QualityLayer if you also want a visual Plan to approve, evidence recorded for each agreed outcome and one place to review open checks before the pull request.",
    sources: [
      { label: "Superpowers repository, skills and supported agents", url: "https://github.com/obra/superpowers" },
      { label: "Superpowers v7.0.1 release notes", url: "https://github.com/obra/superpowers/releases/tag/v7.0.1" },
    ],
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
    lead: "GitHub Spec Kit gives your coding agent structured processes and reusable artifacts. A Spec Kit alternative is worth considering when you also want visual planning and a dedicated place to review the proof.",
    strengths: "Spec Kit is an open source toolkit with project principles, specifications, technical plans and implementation tasks. Extensions, presets and workflows let teams adapt the process to their own standards.",
    agents: "Spec Kit supports both Claude Code and Codex, alongside other coding agents. QualityLayer also works in those sessions. The decision is about the process you want around the agent.",
    rows: [
      { topic: "Define the work", qualitylayer: "Plan visually with diagrams and clickable artifacts; approve the Plan before implementation.", other: "Create a constitution, specification, technical plan and dependency-ordered tasks.", source: 1 },
      { topic: "Check the artifacts", qualitylayer: "Keep the agreed outcomes with the task through implementation and Review.", other: "Use clarification, requirements checklists and cross-artifact analysis as quality checks.", source: 2 },
      { topic: "Check the implementation", qualitylayer: "Record evidence from the running program for each outcome, then bring gaps to human Review.", other: "Converge assesses code against spec, plan and tasks, appending remaining work. The bug-fixing extension records verification too.", source: 1 },
      { topic: "Adapt the process", qualitylayer: "Use the documented planning, build, Verify and Review flow in the App and your agent.", other: "Customize with extensions, presets, workflows and project-local overrides.", source: 1 },
    ],
    chooseOther: "Choose Spec Kit if you want a toolkit you can customize around your repository's own specification and review conventions. Its convergence checks deserve credit; it goes beyond generating a plan.",
    chooseQualityLayer: "Choose QualityLayer if you want the App to carry visual planning, human approval and recorded outcome checks into one review flow, including follow-up on the pull request.",
    sources: [
      { label: "Spec Kit repository and available processes", url: "https://github.com/github/spec-kit" },
      { label: "Spec Kit commands, checklists and convergence", url: "https://github.github.io/spec-kit/reference/agentic-sdd.html" },
      { label: "Spec Kit supported coding agents", url: "https://github.github.io/spec-kit/reference/integrations.html" },
    ],
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
    rows: [
      { topic: "Plan a change", qualitylayer: "Review diagrams and clickable artifacts in the App, then approve the Plan.", other: "Create a proposal with spec deltas, design and tasks; revise artifacts as needed.", source: 1 },
      { topic: "Verify the code", qualitylayer: "Record evidence from the running program for each agreed outcome, with independent review enabled by default.", other: "The optional verify skill reports completeness, correctness and coherence against the artifacts.", source: 2 },
      { topic: "Finish the change", qualitylayer: "Review the evidence and open checks; approve locally, or ask QualityLayer to open and follow a pull request.", other: "Archive the change and sync its spec updates. Archive warns about incomplete artifacts or tasks.", source: 2 },
    ],
    chooseOther: "Choose OpenSpec if maintaining evolving specifications and small change proposals in your repository is the main goal. Its flexible artifact editing fits work where requirements change during implementation.",
    chooseQualityLayer: "Choose QualityLayer if you want explicit human approvals and evidence for the running result in the App. OpenSpec also checks implementation; QualityLayer's emphasis is how that proof reaches your review and pull request.",
    sources: [
      { label: "OpenSpec repository and change workflow", url: "https://github.com/Fission-AI/OpenSpec" },
      { label: "OpenSpec skills, verify and archive behavior", url: "https://openspec.dev/docs/skills" },
      { label: "OpenSpec supported tools", url: "https://openspec.dev/docs/supported-tools" },
    ],
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
    rows: [
      { topic: "Plan the work", qualitylayer: "Discuss, Research and a visual Plan you approve; an Outline cuts it into slices.", other: "Choose a planning path by size: a brief, PRD, architecture, UX documents and stories in tickets.toml.", source: 2 },
      { topic: "Approve", qualitylayer: "Approve the Plan before code and the result at Review.", other: "Approve the build plan or ask for changes; when the build is done, marking it done is yours.", source: 4 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome; failing or blocked checks stay visible in Review.", other: "Several reviewers examine the diff in parallel; findings are sorted into patch, defer and decision needed. A separate skill generates API and end-to-end tests.", source: 3 },
    ],
    chooseOther: "Choose BMAD Method if you want agile product artifacts such as PRDs and stories, and a planning path that grows with the size of the work.",
    chooseQualityLayer: "Choose QualityLayer if you want a visual Plan, evidence that each agreed outcome works on the running program and an App that follows the pull request.",
    sources: [
      { label: "BMAD Method repository", url: "https://github.com/bmad-code-org/BMAD-METHOD" },
      { label: "BMAD: choose a planning path", url: "https://docs.bmad-method.org/plan/choose-a-planning-path/" },
      { label: "BMAD: review a change", url: "https://docs.bmad-method.org/build/review-a-change/" },
      { label: "BMAD: build your first change", url: "https://docs.bmad-method.org/start/build-your-first-change/" },
    ],
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
    lead: "GSD (Get Shit Done), now developed as GSD Core, runs a Discuss, Plan, Execute, Verify and Ship loop in your coding agent. QualityLayer's steps are similar, with an App for approvals and review.",
    strengths: "GSD keeps each plan small enough for a fresh context window and checks plans before execution. Its verifier checks requirement and decision coverage, and a user-acceptance walkthrough asks you about each deliverable. A verification report goes stale when the code changes after it.",
    agents: "GSD installs into Claude Code, Codex, Cursor, Copilot, OpenCode and other agents. QualityLayer also works in Claude Code and Codex. The original GSD repository is archived; development continues as GSD Core.",
    rows: [
      { topic: "Agree on the change", qualitylayer: "Discuss and a visual Plan you approve before code.", other: "Discuss captures implementation decisions; a plan checker confirms plans are complete, consistent and in scope.", source: 2 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome on the running program.", other: "A verifier checks requirement coverage; a walkthrough logs issues per deliverable, then plans the fixes.", source: 3 },
      { topic: "Ship", qualitylayer: "Review the evidence and open checks, then approve; QualityLayer can open and follow the pull request.", other: "Ship creates the pull request from the plan and verification status.", source: 3 },
    ],
    chooseOther: "Choose GSD if you want a light, open source loop with user-acceptance checks that runs in many agents.",
    chooseQualityLayer: "Choose QualityLayer if you want explicit approvals in an App, a visual Plan and evidence you review before approving the change.",
    sources: [
      { label: "GSD Core repository and supported agents", url: "https://github.com/open-gsd/gsd-core" },
      { label: "GSD Core: the phase loop", url: "https://github.com/open-gsd/gsd-core/blob/main/docs/explanation/the-phase-loop.md" },
      { label: "GSD Core: verify and ship", url: "https://github.com/open-gsd/gsd-core/blob/main/docs/how-to/verify-and-ship.md" },
      { label: "The archived Get Shit Done repository", url: "https://github.com/gsd-build/get-shit-done" },
    ],
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
    lead: "Kiro integrates specifications into its coding environment. QualityLayer works with Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode. Compare the environment you want to use and the evidence you want before approval.",
    strengths: "Kiro turns requirements into technical designs and trackable tasks. Feature Specs support requirements-first and design-first approaches. Its IDE also supports property-based testing that connects specified behavior to executable checks.",
    agents: "Kiro documents its own spec workflow in its IDE, CLI and web surfaces. QualityLayer's workflow runs with your coding agent. Kiro has a CLI too, so describing this as a choice between an IDE and a terminal would miss the point.",
    rows: [
      { topic: "Shape the specification", qualitylayer: "Use visual architecture and clickable artifacts, with a human-approved Plan.", other: "Generate requirements, design and tasks; start from requirements or a technical design.", source: 1 },
      { topic: "Verify behavior", qualitylayer: "Check each agreed outcome on the running program and retain the evidence for Review.", other: "In the IDE, derive executable properties from specs and test generated inputs for counterexamples.", source: 2 },
      { topic: "Review planning", qualitylayer: "Approve the Plan before code, then inspect outcome evidence at final Review.", other: "Review spec documents with comments on exact passages. Quick Spec can generate artifacts without approval steps.", source: 3 },
    ],
    chooseOther: "Choose Kiro if you want specifications and task execution integrated into Kiro's environment. Its property-based testing is a substantive verification capability, with availability that varies by surface.",
    chooseQualityLayer: "Choose QualityLayer if you want to keep your coding agent and review an explicit record of outcomes, unresolved checks and approval decisions in the App.",
    sources: [
      { label: "Kiro Feature Specs and workflow variants", url: "https://kiro.dev/docs/specs/feature-specs/" },
      { label: "Kiro correctness and property-based testing", url: "https://kiro.dev/docs/specs/correctness/" },
      { label: "Kiro specs, supported surfaces and review", url: "https://kiro.dev/docs/specs/" },
    ],
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
    rows: [
      { topic: "Plan a feature", qualitylayer: "Discuss, Research and a visual Plan you approve, then an Outline of slices.", other: "Skills write an epic brief, core flows, a tech plan and a ticket breakdown you approve.", source: 2 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome; Review shows checks that failed or could not run.", other: "Execution checks each batch against the plan; a review skill writes prioritized findings, and an autobuild mode iterates against a grading rubric with a separate evaluator.", source: 3 },
      { topic: "Follow the process", qualitylayer: "The steps run in order, each with its approval or recorded check.", other: "The steps are skills you pick yourself; Traycer does not enforce them as an automatic pipeline.", source: 3 },
    ],
    chooseOther: "Choose Traycer if running several agents in parallel, with shared tickets and artifacts, is the center of your work.",
    chooseQualityLayer: "Choose QualityLayer if you want each change to pass through an approved Plan, recorded verification and a human Review, in that order.",
    sources: [
      { label: "Traycer docs and supported agents", url: "https://docs.traycer.ai/index.md" },
      { label: "Traycer: plan a feature", url: "https://docs.traycer.ai/guides/plan-a-feature.md" },
      { label: "Traycer: artifact workflow", url: "https://docs.traycer.ai/concepts/artifact-workflow.md" },
      { label: "Traycer pricing", url: "https://docs.traycer.ai/account/pricing.md" },
      { label: "Traycer artifact version history", url: "https://docs.traycer.ai/panels/artifacts/version-history.md" },
    ],
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
    rows: [
      { topic: "Plan", qualitylayer: "Discuss, Research and a visual Plan you approve before code.", other: "Brainstorm writes requirements; plan turns them into implementation-ready plans, and by default standard and deep plans stop for you to confirm the scope.", source: 2 },
      { topic: "Review", qualitylayer: "Verify records evidence for each agreed outcome; you approve the result at Review.", other: "By default, a report-only multi-agent review checks the diff against the plan's requirements, with P0 to P3 findings.", source: 3 },
      { topic: "Learn", qualitylayer: "Lessons from each task are saved and offered to later tasks.", other: "A compound step writes learnings to docs/solutions for the next plan.", source: 1 },
    ],
    chooseOther: "Choose Compound Engineering if you want a free plugin that runs in many hosts and gets better at your codebase with every change.",
    chooseQualityLayer: "Choose QualityLayer if you want approvals in an App, a visual Plan and evidence on the running program before you approve.",
    sources: [
      { label: "Compound Engineering repository", url: "https://github.com/EveryInc/compound-engineering-plugin" },
      { label: "Compound Engineering: ce-plan", url: "https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-plan.md" },
      { label: "Compound Engineering: ce-code-review", url: "https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md" },
    ],
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
    strengths: "Plan mode needs no setup. Claude reads files and runs commands to explore, then presents a plan you can edit in your own editor before approving. Claude Code's docs recommend skipping it when the diff fits in one sentence, and offer separate verification tools such as goals checked by an evaluator, hooks and review subagents.",
    agents: "Plan mode is part of Claude Code. QualityLayer starts and works inside Claude Code as well, and also with Codex and other agents.",
    rows: [
      { topic: "Plan", qualitylayer: "Discuss, Research and a visual Plan with diagrams and clickable artifacts.", other: "Claude explores without editing source, then presents a text plan you can edit.", source: 1 },
      { topic: "Approve", qualitylayer: "Approve the Plan before code and the result at Review.", other: "Approve and start, approve with manual edit approval, or keep planning.", source: 1 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome; Review shows open checks.", other: "Verification is separate from plan mode: tests, goals, hooks, review subagents and the bundled /verify, which builds and runs your app.", source: 2 },
    ],
    chooseOther: "Choose plan mode alone for small, well-understood changes where a quick written plan is enough.",
    chooseQualityLayer: "Choose QualityLayer for medium and large changes where you want the plan, the build, verification and review carried through in one flow.",
    sources: [
      { label: "Claude Code permission modes (plan mode)", url: "https://code.claude.com/docs/en/permission-modes" },
      { label: "Claude Code best practices", url: "https://code.claude.com/docs/en/best-practices" },
    ],
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
    rows: [
      { topic: "Plan", qualitylayer: "Discuss, Research and a visual Plan with diagrams and clickable artifacts.", other: "The agent asks questions, researches the codebase and writes a plan you edit before building.", source: 1 },
      { topic: "Larger work", qualitylayer: "An Outline cuts the approved Plan into slices that agents build test first.", other: "Projects (beta): a coordinator plans and directs agents that implement and test parts in parallel.", source: 2 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome; Review shows open checks before approval.", other: "Bugbot, billed separately by usage, reviews pull requests for bugs, security issues and code quality.", source: 3 },
    ],
    chooseOther: "Choose Cursor's plan mode if you work in Cursor and want planning built into the editor.",
    chooseQualityLayer: "Choose QualityLayer if you want the same plan-first flow across agents, with evidence for each agreed outcome and an explicit review before the pull request.",
    sources: [
      { label: "Cursor plan mode", url: "https://cursor.com/docs/agent/planning" },
      { label: "Cursor: introducing Projects", url: "https://cursor.com/blog/projects" },
      { label: "Cursor Bugbot", url: "https://cursor.com/docs/bugbot" },
    ],
    checked: "2026-10-23",
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
    rows: [
      { topic: "Agree on the change", qualitylayer: "Review architecture diagrams and clickable artifacts, then approve the Plan before code.", other: "Use structured planning phases and collaborative design documents.", source: 1 },
      { topic: "Work in your agent", qualitylayer: "Use your coding agent, with the App for planning and review.", other: "Use portable RPI skills in Claude Code or Codex, or work in the HumanLayer app.", source: 2 },
      { topic: "Check the result", qualitylayer: "Verify records evidence for each agreed outcome; independent review is enabled by default and can be turned off in Settings.", other: "RPI works from local documents, with fresh sessions for its phases by default.", source: 2 },
    ],
    chooseOther: "Choose HumanLayer if shared workspaces, inline design discussions and managing multiple agent sessions are central to your day.",
    chooseQualityLayer: "Choose QualityLayer if you want an explicit Verify and Review flow, with evidence for the approved outcomes and unresolved checks visible before you approve.",
    sources: [
      { label: "HumanLayer product, collaboration and agent support", url: "https://www.humanlayer.dev/" },
      { label: "HumanLayer portable skills and RPI", url: "https://github.com/humanlayer/skills#rpi" },
    ],
    checked: "2026-10-19",
  },
];

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
    answer: "Define observable acceptance criteria, run the relevant project checks and exercise the behavior those criteria describe. Record what passed, failed or could not be checked. QualityLayer's Verify and Review steps carry that evidence to human approval; independence depends on task risk and settings. Spec Kit, OpenSpec and Kiro also document implementation checks.",
  },
];
