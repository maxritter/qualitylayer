/**
 * The home page's tour: one change followed from request to pull request, then artifacts, the team
 * and the setup. Each chapter shows one close-up of the QualityLayer App at reading size, drawn
 * from the App's artifact (qualitylayer/artifacts/app): the top bar with the seven steps and the agent,
 * the step's own track, and the one Your turn card or the agent's turn. Tasks, people and numbers
 * are an illustration.
 */

/** Who acts: you (amber), an agent (blue turning ring), or nobody because it is done. */
export type Who = "you" | "ag" | "ok";

export interface Chapter {
  id: string;
  /** The chapter's label in the step bar. */
  step: string;
  who: Who;
  /**
   * How many moments follow the first. A close-up opens on the first, which already shows what the
   * chapter's text says, then adds to it one moment per second; it never takes the claim away.
   */
  steps: number;
  title: string;
  text: string;
  bullets: string[];
  /** A heading that opens a new part of the story before this chapter. */
  act?: { id: string; title: string; text: string };
}

export const STAGES = ["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"];

export const TASK = "Usage-based billing";

/** The artifact the Artifacts chapters draw, ask about and open full size. */
export const ARTIFACT = { name: "Billing mode", purpose: "Finance switches an account between seats and usage, with both invoices side by side" };

/** The words a new task starts from, in the New task card. */
export const REQUEST = "Bill API customers for usage while keeping seat customers on the invoices they know, and keep the gateway fast.";

export const CHAPTERS: Chapter[] = [
  {
    id: "discuss",
    step: "Discuss",
    who: "you",
    steps: 5,
    act: { id: "steps", title: "From your request to a pull request", text: "On your own or with your team, a change goes through the same seven steps. You decide where a decision is needed, and your agents do the rest." },
    title: "Your agent asks one batch until the goal is clear",
    text: "Describe the change in your own words. Questions arrive together in Your turn as one batch of three to six, each with a recommendation. Answer in any order; each answer reaches your agent at once, while it keeps reading the code.",
    bullets: ["A bug is reproduced and its cause found", "Too small for a plan? You get a ready prompt", "Each answer becomes part of Done means", "Product or Engineering: pick it at Setup, change it in Settings › Workflow"],
  },
  {
    id: "research",
    step: "Research",
    who: "you",
    steps: 4,
    title: "Agents read the code before anything is designed",
    text: "Research starts while you answer. Agents read the code without your request in front of them, so they report how it works today; when it leaves real choices open, you get one more batch, and a clear task goes straight to the Plan.",
    bullets: ["Each finding is a row: a headline and its first sentence, open for the rest", "Each choice shows what the code says, side by side", "Nothing in Research needs your approval"],
  },
  {
    id: "plan",
    step: "Plan",
    who: "you",
    steps: 2,
    title: "You approve one plan before any code",
    text: "A risky Plan is read by another agent while you read it, and yours folds in what it found before Approve unlocks. Its artifacts and decisions come first with their diagrams, the contracts the build is held to take one line each, and you approve it or give feedback from its header.",
    bullets: ["Comment on any line or diagram: your agent answers within a minute", "Everything the agent decided for you is listed, so you can change it", "The review is recorded under Reviewed by; a local fallback is a self-review"],
  },
  {
    id: "outline",
    step: "Outline",
    who: "ag",
    steps: 3,
    title: "The build session cuts the Plan into slices",
    text: "After you approve, the build session writes the Outline: the slices in build order and the scenario that proves each Done means point; a small task can have it ready sooner. You do not approve it again.",
    bullets: ["Every Done means point is tied to a scenario", "Nothing runs that the Plan did not allow", "Fewer, larger tasks: the Outline follows the Plan's size"],
  },
  {
    id: "start",
    step: "Start",
    who: "you",
    steps: 2,
    title: "Choose where your agent builds",
    text: "Choose the agent, model and effort for the build. In the App opens its interactive session; In my terminal copies a natural-language request for any coding agent, app or IDE.",
    bullets: ["Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode or another agent", "Your defaults come back for the next build", "Start in the App or your terminal"],
  },
  {
    id: "implement",
    step: "Implement",
    who: "ag",
    steps: 5,
    title: "It is built in slices, on its own",
    text: "Once started, your agent works on its own until the final review. One session builds the slices in order, every task starts with a failing test, and it fixes what fails and decides when the build is ready.",
    bullets: ["Test runs the agent makes through QualityLayer are recorded", "What the agent decided on the way is listed, and you can ask why", "A login or secret waits in Your turn while other slices keep building"],
  },
  {
    id: "verify",
    step: "Verify",
    who: "ag",
    steps: 7,
    title: "An agent that did not write the code checks every point",
    text: "A security review comes first when the Plan names a trust boundary, then the project checks. An agent that did not write the code adds missing tests and checks every point of Done means against the running program, with its evidence beside it; the agent chip names what runs now.",
    bullets: ["A risky change also gets a second opinion", "If it finds gaps, your agent fixes them and one more agent rechecks", "Anything still open, or only you can confirm, goes to Review first"],
  },
  {
    id: "review",
    step: "Review",
    who: "you",
    steps: 5,
    title: "You read the finished change top to bottom, then approve it",
    text: "Review opens the code; Checks, Screens and Change details hold the complete supporting records. Unverified checks stay unverified when you approve; the pull request opens with the change description and stays open until it is merged.",
    bullets: ["Every changed file is tagged with the task that made it, and any line takes a comment", "One final approval in the header, with unverified results visible", "Your agent fixes routine review threads and failing checks; scope and design changes come back to you"],
  },
  {
    id: "draw",
    step: "Draw",
    who: "ag",
    steps: 2,
    act: { id: "artifacts", title: "See the page before it is built", text: "Ask your agent to draw a page, and it shows inside the question it belongs to. Open it full size and point at what should change. The interactive page stays on your computer." },
    title: "Ask, and your agent draws the page",
    text: "Say “mock up the billing mode page”. Your agent draws it as one page, and the Plan asks you about it with the page in view: looks right, or say what to change.",
    bullets: ["Inside a task, or for the whole project", "Every artifact is listed in Files", "Share links include a still; the interactive page stays on your computer"],
  },
  {
    id: "comment",
    step: "Comment",
    who: "you",
    steps: 3,
    title: "Open it full size and point at what to change",
    text: "Click a spot and say what should change. Your agent changes the same page and says in one line what changed, so you always see the latest.",
    bullets: ["Your comment reaches the agent like any other answer", "The page stays clickable while you comment", "Full screen hides everything else"],
  },
  {
    id: "ask",
    step: "Ask",
    who: "you",
    steps: 4,
    act: { id: "team", title: "Bring your team in while it is still a plan", text: "With a Team plan, teammates help shape the plan and review the change, each from their own App." },
    title: "Ask a teammate about any part of the plan",
    text: "Select a passage or a diagram and choose who to ask. They get a Slack message that opens the question in their App.",
    bullets: ["They answer: Looks right, Suggest a change or Reply", "You get a Slack message and a notification with their answer", "Your agent updates the plan with what they suggest"],
  },
  {
    id: "answer",
    step: "Answer",
    who: "ag",
    steps: 2,
    title: "Teammates see the questions for them first",
    text: "Questions for you shows each question with the passage in view. Answer in the App, or let your own agent draft it. Nothing is sent without your yes.",
    bullets: ["Looks right, Suggest a change, Reply or Hand to someone else", "A draft from your agent shows as not sent yet", "Open the Plan at the exact passage"],
  },
  {
    id: "space",
    step: "Team space",
    who: "you",
    steps: 2,
    title: "See your team’s work in one place",
    text: "Your questions to others, what each teammate is building and the step it is at, in one list. Remind or hand a question on from here.",
    bullets: ["A question waiting over a day turns amber", "Reminders go out at most every 4 hours", "Team activity folds into one line"],
  },
  {
    id: "together",
    step: "Review together",
    who: "you",
    steps: 2,
    title: "Review the finished change together",
    text: "Teammates read what changed and its proof. They comment on any part and approve. With access to your Git remote, they read the code too and comment on its lines.",
    bullets: ["Their comments reach you in the Comments tab", "The same link follows the task through all seven steps", "Sharing sends the plan, progress and a still of its artifact; the code stays on your own Git remote"],
  },
  {
    id: "settings",
    step: "Settings",
    who: "you",
    steps: 1,
    act: { id: "setup", title: "You stay in charge of models and cost", text: "QualityLayer works inside the coding agents you already pay for, and shows what is left of each plan and what each step costs." },
    title: "See how much of your plan is left, and what each step costs",
    text: "Settings › Usage shows the plan limits of Claude Code and Codex, with the time each window resets. You pick the agent, model and effort when you start a task or a build, so plan with Claude Code and build with Codex if you like. The cost of every step is estimated at list price.",
    bullets: ["Limits also show in the sidebar and as a warning under the message box", "A build that stops on a limit can continue when the window resets", "Turn the independent review on or off, and choose who gives a second opinion on a risky change"],
  },
  {
    id: "agents",
    step: "Your agents",
    who: "ag",
    steps: 3,
    title: "It works where your agents already work",
    text: "New task: say what you want, pick one of seven agents (Claude Code, Codex, Cursor, Grok, Antigravity, Pi or OpenCode), and start in the App or your terminal. Other agents can use the same workflow from your terminal. The App runs on macOS, Windows and Linux; servers and WSL use your browser.",
    bullets: ["Close the App and the agents keep working", "A notification tells you when something needs you", "Updates download quietly and install when you restart"],
  },
];

/** The story's parts, as the step bar groups them: a part starts at a chapter with an act heading. */
export const PARTS: { label: string; from: number; to: number }[] = (() => {
  const starts = CHAPTERS.flatMap((c, i) => (c.act ? [i] : []));
  const labels = ["Steps", "Artifacts", "Team", "Setup"];
  return starts.map((from, k) => ({ label: labels[k] ?? CHAPTERS[from].step, from, to: (starts[k + 1] ?? CHAPTERS.length) - 1 }));
})();

export const partOf = (ch: number) => PARTS.findIndex((p) => ch >= p.from && ch <= p.to);

/**
 * Discuss asks one batch of four questions, answered in any order. At each moment: which questions
 * are answered, the one in focus, whether its recommendation is picked, and the answer just sent.
 */
export const DISCUSS_BATCH = 4;
const DISCUSS_MOMENTS: { answered: number[]; focus: number; picked: boolean; sent: number | null }[] = [
  { answered: [], focus: 0, picked: false, sent: null },
  { answered: [], focus: 0, picked: true, sent: null },
  { answered: [0], focus: 2, picked: false, sent: 0 },
  { answered: [0], focus: 2, picked: true, sent: 0 },
  { answered: [0, 2], focus: 1, picked: false, sent: 2 },
  { answered: [0, 2], focus: 1, picked: true, sent: 2 },
];
export const discussAt = (step: number) => DISCUSS_MOMENTS[Math.min(step, DISCUSS_MOMENTS.length - 1)];

/** How many of the build's 5 tasks are committed at moment `step` of the Implement close-up: slice 1 is done when it opens, then slices 2 and 3 are built in order. */
export const committedTasks = (step: number) => 2 + (step >= 1 ? 1 : 0) + (step >= 2 ? 1 : 0) + (step >= 3 ? 1 : 0);

/**
 * The moment each of the Verify checklist's 9 checks passes: the security review, the 4 project
 * checks and the first Done means point are done when it opens; the second point, the third and
 * the second opinion follow. The check before them runs for the moment before.
 */
export const PASS_AT = [0, 0, 0, 0, 0, 0, 3, 5, 5];
export const CHECKS_TOTAL = PASS_AT.length;
export const checksPassed = (step: number) => PASS_AT.filter((when) => step >= when).length;

/** The checks in the order they run. */
export const VERIFY_CHECKS = ["Security review", "Project checks", "Independent review", "Second opinion"];
/**
 * Which chapter is in view. Each chapter's first line (its act heading, when it opens a part)
 * counts as read once it has risen past a line down the screen: 72 % down when the close-up is
 * pinned beside the text, 60 % when every chapter carries its own. Those are the lines where the
 * chapter entering from below shows as much text as the one leaving above (fitted on sampled scrolls
 * of the page at 1440 x 900 and 390 x 844). The chapter in view is the last one read, and the first
 * before any is, so the close-up belongs to the text on screen.
 */
export const READ_LINE = { pinned: 0.72, inline: 0.6 };
export function chapterInView(tops: number[], viewport: number, line: number): number {
  let best = 0;
  tops.forEach((top, i) => {
    if (top <= viewport * line) best = i;
  });
  return best;
}
