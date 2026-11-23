import type { Comparison, ComparisonSource } from "./comparisons.ts";

type RowTuple = [topic: string, qualitylayer: string, other: string, source: number];
type SourceTuple = [label: string, url: string];

const CHECK_RESULT = "Verify records evidence for each agreed outcome. Verify then shows the finished change and its proof.";
const VISUAL_PLAN = "A visual Plan with diagrams and clickable artifacts, written once your agent has read the code that you approve before code.";

const ROWS_BY_SLUG: Record<string, RowTuple[]> = {
  superpowers: [
    ["Agree on the change", "Review architecture diagrams and clickable artifacts, then approve the Plan before code.", "Brainstorming proposes two or three approaches, writes a design document and is meant to build nothing until you approve it.", 2],
    ["Build it", "Slices are built test first, with the agreed outcomes kept beside each slice.", "A plan of two-to-five-minute tasks, each with file paths, code and verification steps, run by subagents.", 1],
    ["Check the result", "Verify records output, screenshots or files for each agreed outcome, then brings the finished change to your review.", "Code review against the plan blocks on critical issues; finishing a branch verifies tests and offers merge, pull request, keep or discard.", 1],
  ],
  "spec-kit": [
    ["Define the work", "Plan visually with diagrams and clickable artifacts; approve the Plan before implementation.", "Create a constitution, specification, technical plan and dependency-ordered tasks.", 1],
    ["Check the artifacts", "Keep the agreed outcomes with the task through Implement and Verify.", "Use clarification, requirements checklists and cross-artifact analysis as quality checks.", 2],
    ["Check the implementation", CHECK_RESULT, "Converge assesses code against spec, plan and tasks, appending remaining work. The bug-fixing extension records verification too.", 1],
    ["Adapt the process", "Use the documented Plan, Implement and Verify flow in the App and your agent.", "Customize with extensions, presets, workflows and project-local overrides.", 1],
  ],
  openspec: [
    ["Plan a change", "Review diagrams and clickable artifacts in the App, then approve the Plan.", "Create a proposal with spec deltas, design and tasks; revise artifacts as needed.", 1],
    ["Verify the code", "Record evidence from the running program for each agreed outcome, with independent review enabled by default.", "The optional verify skill reports completeness, correctness and coherence against the artifacts.", 2],
    ["Finish the change", "Review the evidence and recorded checks; approve locally, or ask QualityLayer to open and follow a pull request.", "Archive the change and sync its spec updates. Archive warns about incomplete artifacts or tasks.", 2],
  ],
  "bmad-method": [
    ["Plan the work", "A visual Plan you approve; Implement cuts it into slices.", "Choose a planning path by size: a brief, PRD, architecture, UX documents and stories in tickets.toml.", 2],
    ["Approve", "Approve the Plan before code and the result at Verify.", "Approve the build plan or ask for changes; when the build is done, marking it done is yours.", 4],
    ["Check the result", "Verify records evidence for each agreed outcome; failing or blocked checks stay visible in your review.", "Several reviewers examine the diff in parallel; findings are sorted into patch, defer and decision needed. A separate skill generates API and end-to-end tests.", 3],
  ],
  gsd: [
    ["Agree on the change", "A visual Plan you approve before code.", "Discuss captures implementation decisions; a plan checker confirms plans are complete, consistent and in scope.", 2],
    ["Check the result", "Verify records evidence for each agreed outcome on the running program.", "A verifier checks requirement coverage; a walkthrough logs issues per deliverable, then plans the fixes.", 3],
    ["Ship", "Review the evidence and recorded checks, then approve; QualityLayer can open and follow the pull request.", "Ship creates the pull request from the plan and verification status.", 3],
  ],
  kiro: [
    ["Shape the specification", "Use visual architecture and clickable artifacts, with a human-approved Plan.", "Generate requirements, design and tasks; start from requirements or a technical design.", 1],
    ["Verify behavior", "Check each agreed outcome on the running program and retain the evidence for your review.", "In the IDE, derive executable properties from specs and test generated inputs for counterexamples.", 2],
    ["Review planning", "Approve the Plan before code, then inspect outcome evidence at the final review.", "Review spec documents with comments on exact passages. Quick Spec can generate artifacts without approval steps.", 3],
  ],
  traycer: [
    ["Plan a feature", "A visual Plan you approve, then Implement cuts it into slices.", "Skills write an epic brief, core flows, a tech plan and a ticket breakdown you approve.", 2],
    ["Check the result", CHECK_RESULT, "Execution checks each batch against the plan; a review skill writes prioritized findings, and an autobuild mode iterates against a grading rubric with a separate evaluator.", 3],
    ["Follow the process", "The steps run in order, each with its approval or recorded check.", "The steps are skills you pick yourself; Traycer does not enforce them as an automatic pipeline.", 3],
  ],
  "compound-engineering": [
    ["Plan", "A visual Plan, written once your agent has read the code, that you approve before code.", "Brainstorm writes requirements; plan turns them into implementation-ready plans, and by default standard and deep plans stop for you to confirm the scope.", 2],
    ["Review", "Verify records evidence for each agreed outcome; you approve the result at Verify.", "By default, a report-only multi-agent review checks the diff against the plan's requirements, with P0 to P3 findings.", 3],
    ["Learn", "Lessons from each task are saved and offered to later tasks.", "A compound step writes learnings to docs/solutions for the next plan.", 1],
  ],
  "claude-code-plan-mode": [
    ["Plan", "A visual Plan with diagrams and clickable artifacts, written once your agent has read the code.", "Claude explores without editing source, then presents a text plan you can edit.", 1],
    ["Approve", "Approve the Plan before code and the result at Verify.", "Approve and start, approve with manual edit approval, or keep planning.", 1],
    ["Check the result", "Verify records evidence for each agreed outcome; then the same page shows the finished change and its proof.", "Verification is separate from plan mode: tests, goals, hooks, review subagents and the bundled /verify, which builds and runs your app.", 2],
  ],
  "cursor-plan-mode": [
    ["Plan", "A visual Plan with diagrams and clickable artifacts, written once your agent has read the code.", "The agent asks questions, researches the codebase and writes a plan you edit before building.", 1],
    ["Larger work", "Implement cuts the approved Plan into slices that agents build test first.", "Projects (beta): a coordinator plans and directs agents that implement and test parts in parallel.", 2],
    ["Check the result", "Verify records evidence for each agreed outcome; then the same page shows the finished change and its proof before approval.", "Bugbot, billed separately by usage, reviews pull requests for bugs, security issues and code quality.", 3],
  ],
  "codex-plan-mode": [
    ["Plan", "A visual Plan with diagrams and clickable artifacts, written once your agent has read the code, saved as Markdown in your repository.", "Codex reads the repository, asks clarifying questions and proposes a plan in the session.", 2],
    ["Approve", "Approve the Plan before code and the result at Verify; ask your agent to revise selected passages.", "You read the plan in the terminal session and tell Codex to implement it.", 1],
    ["Check the result", CHECK_RESULT, "Checking the result is up to you, your tests and any review step you add after plan mode.", 1],
  ],
  humanlayer: [
    ["Agree on the change", "Review architecture diagrams and clickable artifacts, then approve the Plan before code.", "Use structured planning phases and collaborative design documents.", 1],
    ["Work in your agent", "Use your coding agent, with the App for planning and review.", "Use portable RPI skills in Claude Code or Codex, or work in the HumanLayer app.", 2],
    ["Check the result", "Verify records evidence for each agreed outcome; independent review is enabled by default and can be turned off in Settings.", "RPI works from local documents, with fresh sessions for its phases by default.", 2],
  ],
  "task-master": [
    ["Plan", VISUAL_PLAN, "Parse a PRD into tasks, analyze their complexity and expand the complex ones into subtasks.", 2],
    ["Build it", "Implement cuts the approved Plan into slices built test first, each kept beside its agreed outcomes.", "The next command picks a pending task whose dependencies are done, and your agent implements it.", 2],
    ["Check the result", CHECK_RESULT, "Each task carries a test strategy that describes how to verify it.", 2],
  ],
  cline: [
    ["Plan", VISUAL_PLAN, "Plan mode reads the code and discusses the approach. A deep planning command investigates further and writes a plan first.", 1],
    ["Approve", "Approve the Plan before code and the finished change at Verify.", "Approve each file edit and terminal command as it happens, or turn on auto-approve.", 2],
    ["Check the result", "An agent that did not write the code checks each agreed outcome and records evidence.", "Cline watches linter and compiler errors while it edits, and tracks its changes so you can undo them.", 2],
  ],
  aider: [
    ["Plan", VISUAL_PLAN, "Ask mode discusses without editing. Architect mode has one model propose the change and an editor model apply it.", 1],
    ["Build it", "Implement cuts the approved Plan into slices built test first.", "Aider edits the files in the chat and commits each change to git.", 3],
    ["Check the result", CHECK_RESULT, "Aider lints edited files by default. Tests run when you use /test or turn on auto test, and Aider tries to fix what fails.", 2],
  ],
  "github-copilot-coding-agent": [
    ["Plan", VISUAL_PLAN, "Researches the repository and makes a plan in the cloud before it changes code.", 1],
    ["Check the result", CHECK_RESULT, "Runs your tests and linters and keeps session logs. GitHub notes that the logs do not replace your own review and testing.", 1],
    ["Pull request", "After you approve at Verify, QualityLayer opens the pull request with gh and follows it through checks.", "One repository, one branch and one pull request per task. You review the diff before a pull request is created, or ask for one in the prompt.", 1],
  ],
  devin: [
    ["Plan", VISUAL_PLAN, "Ask mode explores the code and scopes the task, then builds a prompt you send to an Agent session.", 2],
    ["Check the result", "An agent that did not write the code checks each agreed outcome and records evidence.", "After the pull request, Devin writes a short test plan for one main flow, runs it in a browser and sends a recording.", 3],
    ["Review", "Verify shows the finished change and its evidence, and you approve before the pull request.", "Devin Review organizes the diff, flags likely bugs by confidence and syncs comments to GitHub.", 4],
  ],
  "claude-squad": [
    ["Organize the work", "One task per change, on the current branch, a new branch or a new worktree.", "One session and isolated git workspace per task, managed from a single terminal window.", 1],
    ["Check the result", "An agent that did not write the code checks each agreed outcome and records evidence. You approve at Verify.", "A diff tab shows each session's changes before you commit and push.", 1],
    ["Ship it", "After your approval, QualityLayer opens the pull request with gh and follows it.", "Commit and push the branch to GitHub from the menu.", 1],
  ],
  conductor: [
    ["Organize the work", "One task per change, on the current branch, a new branch or a new worktree.", "One workspace per shippable unit, each with its own branch, working tree and app processes.", 2],
    ["Check the result", CHECK_RESULT, "Test in the terminal or the running app, ask an agent to review, and read the Checks tab before merging.", 2],
    ["Ship it", "After your approval, QualityLayer opens the pull request with gh and follows it.", "Conductor drafts the pull request, follows its GitHub checks, can merge it and then archives the workspace.", 2],
  ],
};

const SOURCES_BY_SLUG: Record<string, SourceTuple[]> = {
  superpowers: [
    ["Superpowers repository, skills and supported agents", "https://github.com/obra/superpowers"],
    ["Superpowers v7.0.1 release notes", "https://github.com/obra/superpowers/releases/tag/v7.0.1"],
  ],
  "spec-kit": [
    ["Spec Kit repository and available processes", "https://github.com/github/spec-kit"],
    ["Spec Kit commands, checklists and convergence", "https://github.github.io/spec-kit/reference/agentic-sdd.html"],
    ["Spec Kit supported coding agents", "https://github.github.io/spec-kit/reference/integrations.html"],
  ],
  openspec: [
    ["OpenSpec repository and change workflow", "https://github.com/Fission-AI/OpenSpec"],
    ["OpenSpec skills, verify and archive behavior", "https://openspec.dev/docs/skills"],
    ["OpenSpec supported tools", "https://openspec.dev/docs/supported-tools"],
  ],
  "bmad-method": [
    ["BMAD Method repository", "https://github.com/bmad-code-org/BMAD-METHOD"],
    ["BMAD: choose a planning path", "https://docs.bmad-method.org/plan/choose-a-planning-path/"],
    ["BMAD: review a change", "https://docs.bmad-method.org/build/review-a-change/"],
    ["BMAD: build your first change", "https://docs.bmad-method.org/start/build-your-first-change/"],
  ],
  gsd: [
    ["GSD Core repository and supported agents", "https://github.com/open-gsd/gsd-core"],
    ["GSD Core: the phase loop", "https://github.com/open-gsd/gsd-core/blob/main/docs/explanation/the-phase-loop.md"],
    ["GSD Core: verify and ship", "https://github.com/open-gsd/gsd-core/blob/main/docs/how-to/verify-and-ship.md"],
    ["The archived Get Shit Done repository", "https://github.com/gsd-build/get-shit-done"],
  ],
  kiro: [
    ["Kiro Feature Specs and workflow variants", "https://kiro.dev/docs/specs/feature-specs/"],
    ["Kiro correctness and property-based testing", "https://kiro.dev/docs/specs/correctness/"],
    ["Kiro specs, supported surfaces and review", "https://kiro.dev/docs/specs/"],
  ],
  traycer: [
    ["Traycer docs and supported agents", "https://docs.traycer.ai/index.md"],
    ["Traycer: plan a feature", "https://docs.traycer.ai/guides/plan-a-feature.md"],
    ["Traycer: artifact workflow", "https://docs.traycer.ai/concepts/artifact-workflow.md"],
    ["Traycer pricing", "https://docs.traycer.ai/account/pricing.md"],
    ["Traycer artifact version history", "https://docs.traycer.ai/panels/artifacts/version-history.md"],
  ],
  "compound-engineering": [
    ["Compound Engineering repository", "https://github.com/EveryInc/compound-engineering-plugin"],
    ["Compound Engineering: ce-plan", "https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-plan.md"],
    ["Compound Engineering: ce-code-review", "https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md"],
  ],
  "claude-code-plan-mode": [
    ["Claude Code permission modes (plan mode)", "https://code.claude.com/docs/en/permission-modes"],
    ["Claude Code best practices", "https://code.claude.com/docs/en/best-practices"],
  ],
  "cursor-plan-mode": [
    ["Cursor plan mode", "https://cursor.com/docs/agent/planning"],
    ["Cursor: introducing Projects", "https://cursor.com/blog/projects"],
    ["Cursor Bugbot", "https://cursor.com/docs/bugbot"],
  ],
  "codex-plan-mode": [
    ["OpenAI Codex developer commands (/plan)", "https://learn.chatgpt.com/docs/developer-commands"],
    ["OpenAI Codex plan mode instructions", "https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md"],
  ],
  humanlayer: [
    ["HumanLayer product, collaboration and agent support", "https://www.humanlayer.dev/"],
    ["HumanLayer portable skills and RPI", "https://github.com/humanlayer/skills#rpi"],
  ],
  "task-master": [
    ["Task Master repository, setup and supported editors", "https://github.com/eyaltoledano/claude-task-master"],
    ["Task Master task structure and commands", "https://tryhamster.com/docs/taskmaster/capabilities/task-structure"],
  ],
  cline: [
    ["Cline Plan and Act modes", "https://docs.cline.bot/features/plan-and-act"],
    ["Cline repository, approvals and where it runs", "https://github.com/cline/cline"],
  ],
  aider: [
    ["Aider chat modes", "https://aider.chat/docs/usage/modes.html"],
    ["Aider linting and testing", "https://aider.chat/docs/usage/lint-test.html"],
    ["Aider repository and features", "https://github.com/Aider-AI/aider"],
  ],
  "github-copilot-coding-agent": [
    ["About GitHub Copilot cloud agent", "https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent"],
  ],
  devin: [
    ["Introducing Devin", "https://docs.devin.ai/get-started/devin-intro"],
    ["Devin: your first session, Ask and Agent modes", "https://docs.devin.ai/get-started/first-run"],
    ["Devin testing and video recordings", "https://docs.devin.ai/work-with-devin/testing-and-recordings"],
    ["Devin Review", "https://docs.devin.ai/work-with-devin/devin-review"],
  ],
  "claude-squad": [
    ["Claude Squad repository", "https://github.com/smtg-ai/claude-squad"],
  ],
  conductor: [
    ["Conductor documentation", "https://docs.conductor.build"],
    ["Conductor workflow", "https://docs.conductor.build/workflow"],
  ],
};

export function comparisonRows(slug: string): Comparison["rows"] {
  return (ROWS_BY_SLUG[slug] ?? []).map(([topic, qualitylayer, other, source]) => ({
    topic,
    qualitylayer,
    other,
    source,
  }));
}

export function comparisonSources(slug: string): ComparisonSource[] {
  return (SOURCES_BY_SLUG[slug] ?? []).map(([label, url]) => ({ label, url }));
}
