// The live demo's storyboard: one task, usage-based billing in acme/platform, from setup to the merged
// pull request, then the team, artifacts, memory and settings around it. Every chapter opens the source
// App demo at one moment of that task (`?moment=`, see qualitylayer/src/ui/demo/seven/moments.ts);
// every beat is one thing the presenter shows, run when they press the next key.
//
// A beat's `act(d)` uses the director in present.mjs: d.focus(locator) rings one element without dimming the page,
// d.click / d.type / d.hover move the drawn cursor first, d.page is the Playwright page.

const task = "#/task/seven-demo"
// `story` keeps one ordinary day's tasks and gives the billing task's session its work at each step;
// `run=plan-ready` opens that Claude Code session beside the page. `quiet` leaves the session out.
// `before`: the day before the billing task exists, so New task can create it.
const at = (moment, hash = task, { quiet = false, before = false } = {}) =>
  `?moment=${moment}&story${before ? "&before" : ""}${quiet ? "" : "&run=plan-ready"}${hash}`

const REQUEST =
  "Bill API customers for usage while keeping seat customers on the invoices they know, and keep the gateway fast."

const button = (d, name) => d.page.getByRole("button", { name, exact: true }).first()
const testid = (d, id) => d.page.getByTestId(id).first()
/**
 * Opens a menu or dialog with `trigger`, lets it show for `ms`, and closes it: Escape, and when a menu is
 * still open (a select closes only on a choice or its trigger), the trigger once more.
 */
const peek = async (d, trigger, ms = 1600) => {
  await d.click(trigger)
  await d.wait(ms)
  await d.page.keyboard.press("Escape")
  await d.wait(300)
  if ((await d.page.locator('[role="menu"], [role="listbox"]').count()) > 0) await trigger.click().catch(() => {})
}
/** A Settings card: the box under its heading. */
const card = (d, heading) =>
  d.page.getByRole("heading", { name: heading, exact: true }).first().locator("xpath=../..")
/** A folded part of a step page, opened: the <details> whose summary starts with `heading`. */
const fold = async (d, heading) => {
  const part = d.page.locator("details").filter({ has: d.page.locator("summary").filter({ hasText: heading }) }).first()
  await part.evaluate((element) => {
    element.open = true
  })
  return part
}
// On a phone (the guided web demo opened on one) the App folds its navigation into Menu, the right sidebar
// behind its header button and the task's actions into More: below 900 px wide, as App.tsx's NAV_MIN.
// The beats reach those controls through them first; the presenter's window and the check are wider.
const phone = (d) => (typeof window === "undefined" ? (d.page.viewportSize()?.width ?? 1440) : window.innerWidth) < 900
/** A control of the App's navigation (task list, search, Team, Settings sections), with Menu opened first on a phone. */
const nav = async (d, control) => {
  if (phone(d)) await d.click(d.page.getByTestId("top-bar").getByRole("button", { name: "Menu", exact: true }).first())
  return control
}
/** The right sidebar, opened first where it is folded away. */
const side = async (d) => {
  // Its button says Show or Hide; right after a page change it may not be drawn yet.
  await testid(d, "sidebar-button").waitFor({ timeout: 4000 }).catch(() => {})
  const show = d.page.getByRole("button", { name: /^Show Files and Feedback/ })
  if ((await show.count()) > 0) await d.click(show.first())
  return d.page.getByTestId("right-sidebar")
}
/** A task action from the top bar; under More on a phone, where it can have a longer name. */
const action = async (d, name, phoneName = name) => {
  if (!phone(d)) return button(d, name)
  // The sidebar covers the whole phone screen: it closes first.
  const close = d.page.getByRole("button", { name: "Close the sidebar", exact: true })
  if ((await close.count()) > 0) await d.click(close.first())
  await d.click(testid(d, "task-more"))
  return d.page.getByRole("menuitem", { name: phoneName, exact: true }).first()
}

export const CHAPTERS = [
  {
    id: "setup",
    title: "Setup",
    line: "Finds your agents and projects",
    // `story` here too: Start on this screen opens the story's Home, not the full demo's.
    url: "?screen=setup&story",
    beats: [
      {
        note: "First start: QualityLayer finds the coding agents already on this Mac. It works with the subscriptions you have.",
        act: (d) => d.focus(testid(d, "agents-step")),
      },
      {
        note: "It also finds the projects you worked on recently, from your agents' history.",
        act: (d) => d.focus(testid(d, "projects-step")),
      },
    ],
  },
  {
    id: "welcome",
    title: "Welcome",
    line: "Discuss, Plan, Build, Review",
    url: "?screen=first-run&story",
    beats: [
      {
        note: "The whole idea on one line: you answer and approve, agents do the work in between.",
        act: (d) => d.focus(d.page.getByText("For planned changes", { exact: true }).locator("xpath=..")),
      },
    ],
  },
  {
    id: "new-task",
    title: "New task",
    line: "Feature, bugfix or chat",
    url: at("discuss-q", "#/", { quiet: true, before: true }),
    beats: [
      {
        short: true,
        note: "This is Sam's QualityLayer a few weeks in: Home lists only what waits for them, across projects and teammates.",
        act: (d) => d.focus(testid(d, "needs-you")),
      },
      {
        note: "A new task: Feature or Bugfix gets planned first. Chat is for direct work without the workflow.",
        act: async (d) => {
          await d.click(testid(d, "new-task-button"))
          await d.focus(d.page.getByRole("radiogroup").first())
        },
      },
      {
        short: true,
        note: "The request, in plain words. A real one: nine services, retries, invoices, and a gateway that must stay fast.",
        act: (d) => d.type(d.page.getByPlaceholder(/For example/), REQUEST),
      },
      {
        note: "Pick the project and a fresh branch.",
        act: async (d) => {
          await d.click(testid(d, "project-picker").getByRole("combobox").first())
          await d.click(d.page.getByRole("option", { name: /acme\/platform/ }).first())
          await d.click(d.page.getByRole("radio", { name: "New branch", exact: true }))
          await d.type(testid(d, "launch-branch").getByRole("textbox"), "feat/usage-billing")
        },
      },
      {
        note: "Any agent you have: Claude Code, Codex, Cursor, OpenCode, Pi. It runs here in the App, or in your own terminal or IDE.",
        act: (d) => d.focus(d.page.getByText("Where the agent runs", { exact: true }).locator("xpath=..")),
      },
      {
        short: true,
        note: "Start planning: the agent reads the code first, then asks what only I can answer.",
        act: async (d) => {
          await d.click(d.page.getByRole("dialog").getByRole("button", { name: /^Start/ }).first())
          await d.wait(1500)
          await d.focus(d.page.locator("main").first())
        },
      },
    ],
  },
  {
    id: "discuss",
    title: "Discuss",
    line: "Agree what done means",
    url: at("discuss-q"),
    beats: [
      {
        short: true,
        note: "Step 1 of 7. Before planning, the agent asks only what the code cannot answer and only I can decide: what happens to the 400 customers who pay by seat today.",
        act: (d) => d.focus(testid(d, "focus-card")),
      },
      {
        short: true,
        note: "Each question comes with a recommendation and its trade-off. I take it three times, and answer the last one in my own words.",
        act: async (d) => {
          // The card hands over the next question after each answer, and closes after the fourth.
          const card = testid(d, "focus-card")
          for (let answered = 0; answered < 3; answered++) {
            await d.click(card.getByRole("button", { name: /^1 Recommended/ }))
            // Long enough to read the next question before it is answered.
            await d.wait(1800)
          }
          await d.type(card.getByPlaceholder("Your own answer"), "A later task. Invoices stay in US dollars until Finance has the exchange rates.")
          await d.click(card.getByRole("button", { name: "Send", exact: true }))
          await d.wait(500)
        },
      },
      {
        note: "The questions are closed. My four answers are in, and the Discuss page shows what we agreed.",
        act: (d) => d.focus(testid(d, "step-gist")),
      },
      {
        short: true,
        note: "Done means: the twelve points the change is checked against at the end, one of them only I can confirm.",
        act: (d) => d.focus(d.page.getByRole("heading", { name: "Done means", exact: true }).first().locator("xpath=..")),
      },
      {
        note: "Beside the page, the Claude Code session that asked: what it read, what it wrote, and where I can talk to it.",
        act: async (d) => {
          await side(d)
          await d.focus(testid(d, "agent-window"))
        },
      },
    ],
  },
  {
    id: "research",
    title: "Research",
    line: "How the code works today",
    url: at("research-work"),
    beats: [
      {
        note: "Step 2. Helpers that never saw the request read the code in parallel, each with one question about it. Nothing waits for me here.",
        act: (d) => d.focus(testid(d, "research-questions")),
      },
      {
        short: true,
        note: "What they found, each finding with the file and lines it rests on, and what the goal puts at risk. The Plan builds on it.",
        act: async (d) => {
          // Research as it stands once it is done (the Plan is being written), opened on its own page.
          await d.go(at("plan-work", `${task}/02-research.md`))
          await d.focus(testid(d, "step-gist"))
        },
      },
    ],
  },
  {
    id: "plan",
    title: "Plan",
    line: "Architecture you approve",
    url: at("plan-decide"),
    beats: [
      {
        short: true,
        note: "Step 3. One choice in the Plan is mine, drawn as both paths: keep serving and bill the overage, or block requests at the limit.",
        act: (d) => d.focus(testid(d, "decision-card")),
      },
      {
        short: true,
        note: "I keep customers running: A. That was the only thing the Plan needed from me.",
        act: (d) => d.click(testid(d, "decision-card").getByRole("button", { name: /^A / })),
      },
      {
        note: "The Plan itself: what changes, how big, what is risky, and the one test that proves it works.",
        act: async (d) => {
          await d.go(at("plan-approve"))
          await d.focus(testid(d, "step-gist").locator("xpath=.."))
        },
      },
      {
        short: true,
        note: "The designs sit right in the Plan, as working pages: Finance's billing-mode screen, then the invoice with usage lines.",
        act: (d) => d.focus(testid(d, "artifact-slot")),
      },
      {
        note: "How a request flows after the change. The gateway is marked risky: every request passes through it.",
        act: (d) =>
          d.focus(d.page.getByRole("heading", { name: "Today and after the change", exact: true }).first().locator("xpath=..")),
      },
      {
        note: "Each decision with its diagram, what was not chosen, and what to look at: here, a slow meter would slow every customer.",
        act: (d) => d.focus(testid(d, "plan-decision")),
      },
      {
        note: "Feedback goes on an exact passage, saved for the agent.",
        act: async (d) => {
          const text = "Say what happens to an open window when the aggregator restarts."
          if (phone(d)) {
            // A phone has no passage gutter: the Plan's own Give feedback takes the note.
            await d.click(button(d, "Give feedback"))
            await d.type(d.page.getByPlaceholder(/^Describe the change/), text)
            return d.click(button(d, "Send feedback"))
          }
          const passage = d.page.locator(".sp-comment-block").filter({ hasText: "The gateway emits one meter event" }).first()
          await d.hover(passage)
          await d.click(passage.locator(".sp-gutter-comment"))
          await d.type(d.page.getByPlaceholder("What should change here?"), text)
          await d.click((await side(d)).getByRole("button", { name: /^Send/ }).first())
        },
      },
      {
        short: true,
        note: "Billing is risky, so I ask Anna from the billing team to review the Plan. My approval waits for her.",
        act: async (d) => {
          await d.click(await action(d, "Share"))
          await d.click(d.page.getByRole("checkbox", { name: "Anna Keller" }))
          await d.click(d.page.getByRole("button", { name: /^Ask Anna/ }))
          await d.focus(testid(d, "review-sent"))
        },
      },
      {
        short: true,
        note: "Anna asks for a change: cap the overage, so a runaway client can't run up the bill. The agent folds it in and says what it changed.",
        act: async (d) => {
          await d.page.keyboard.press("Escape")
          await d.click((await side(d)).getByRole("tab", { name: /^Feedback/ }).first())
          const changed = d.page.getByText(/^Changed the Plan/).first()
          await changed.waitFor({ timeout: 15000 })
          await changed.scrollIntoViewIfNeeded()
          await d.focus(changed.locator("xpath=ancestor::section[1]"))
        },
      },
      {
        short: true,
        note: "Every step is a Markdown file in my repository. Here is the Plan as the file, with Anna's change in it.",
        act: async (d) => {
          const sidebar = await side(d)
          await d.click(sidebar.getByRole("tab", { name: /^Files/ }).first())
          await d.click(sidebar.getByText("03-plan.md", { exact: true }).first())
          await d.focus(d.page.locator("main").getByText(/capped at 50 % above the plan/).first())
        },
      },
      {
        note: "And it copies out as plain Markdown.",
        act: async (d) => {
          // The document's own Copy menu, under the reader's toolbar (the top bar has a copy icon of its own).
          const toolbar = d.page.getByRole("button", { name: /^Sections/ }).first().locator("xpath=..")
          await d.click(toolbar.getByRole("button", { name: /^Copy/ }).first())
          await d.focus(d.page.getByRole("menu").first())
        },
      },
      {
        note: "A second agent from another vendor reviewed it. Codex found nine issues; seven changed the Plan.",
        act: async (d) => {
          await d.go(at("plan-approve"))
          await d.focus(await fold(d, /^Reviewed by/))
        },
      },
      {
        short: true,
        note: "When I approve, I choose which agent builds, where it runs and on which branch.",
        act: async (d) => {
          // Without a session already open, approving asks where the build runs.
          await d.go(at("plan-approve", task, { quiet: true }))
          await d.click(button(d, "Approve Plan"))
          await d.focus(d.page.getByRole("dialog").first())
        },
      },
    ],
  },
  {
    id: "outline",
    title: "Outline",
    line: "Slices and scenarios",
    url: at("outline-writing"),
    beats: [
      {
        short: true,
        note: "Step 4. The Plan becomes eleven small slices in waves, each built test-first, with a scenario for every Done means point.",
        act: (d) => d.focus(testid(d, "step-gist").locator("xpath=..")),
      },
      {
        short: true,
        note: "Each slice opens to its tasks. This one is marked risky: retries and Kafka outages, four tasks, each starting with a failing test.",
        act: async (d) => {
          const slice = d.page.getByTestId("map-slice").filter({ hasText: "Survive retries" }).first()
          await d.click(slice.locator("summary").first())
          await d.focus(slice)
        },
      },
      {
        note: "Once the Outline holds, every Done means point has its end-to-end scenario, run after the slice that completes it.",
        act: async (d) => {
          // The Outline as the build begins: written in full, its proof map below the slices.
          await d.go(at("impl-start", `${task}/04-outline.md`))
          await d.focus(testid(d, "proof-rows"))
        },
      },
    ],
  },
  {
    id: "implement",
    title: "Implement",
    line: "The build as it runs",
    url: at("now"),
    beats: [
      {
        short: true,
        note: "Step 5. The build, slice by slice: what is done, what runs now, and which checks passed.",
        act: (d) => d.focus(d.page.locator("main").first()),
      },
      {
        note: "Each slice opens to its task cards. Every task starts with a failing test, then the code that makes it pass.",
        act: (d) => d.focus(testid(d, "task-cards")),
      },
      {
        note: "Small calls the agent made while building are written down for me, each with where and why.",
        act: async (d) => d.focus(await fold(d, /^Decided while building/)),
      },
      {
        note: "Checks run in the background. One test is red; the agent is already on it.",
        act: async (d) => d.focus(await fold(d, /^Checks/)),
      },
      {
        short: true,
        note: "Beside it, the agent's own session: the conversation, or the same session as a terminal.",
        act: async (d) => {
          const sidebar = await side(d)
          await d.click(sidebar.getByRole("tab", { name: "Conversation", exact: true }))
          await d.focus(sidebar)
        },
      },
      {
        note: "Same session, the agent's own screen: the real Claude Code terminal, running inside the App.",
        act: async (d) => {
          const sidebar = await side(d)
          await d.click(sidebar.getByRole("tab", { name: "Terminal", exact: true }))
          await d.focus(sidebar)
        },
      },
      {
        note: "What the task has cost so far, per step and per model, at the agents' list prices.",
        act: async (d) => {
          // On a phone the cost sits under More, which the trigger opens first.
          if (phone(d)) return d.click(await action(d, "Cost", "What it cost"))
          await peek(d, button(d, "Cost"), 2200)
        },
      },
      {
        note: "Prefer your own terminal or IDE? Any agent builds there, here Codex, and the App follows every slice.",
        act: async (d) => {
          await d.go(at("impl-outside", task, { quiet: true }))
          await side(d)
          await d.focus(testid(d, "outside-lead"))
        },
      },
      {
        note: "The build keeps going without the Stripe test key. The check that needs it stays unverified.",
        act: async (d) => {
          await d.go(at("impl-need"))
          await d.focus(d.page.locator("main").first())
        },
      },
    ],
  },
  {
    id: "verify",
    title: "Verify",
    line: "Proof for every point",
    url: at("verify-work"),
    beats: [
      {
        note: "Step 6. Every Done means point gets its proof from a recorded check. A fresh reviewer checks the change without the builder's context.",
        act: (d) => d.focus(d.page.locator("main").first()),
      },
      {
        note: "The project's own checks: tests, types, lint and build, with the commands that ran.",
        act: (d) => d.click(d.page.getByRole("button", { name: /^Project checks/ }).first()),
      },
      {
        short: true,
        note: "The agent fixes failed checks and rechecks what changed. Any remaining failure stays in the Review record.",
        act: async (d) => {
          await d.go(at("verify-red"))
          await d.focus(testid(d, "verify-lanes"))
        },
      },
      {
        note: "Every Done means point with its proof: four passed, one failed so far, and which check said so.",
        act: async (d) => d.focus(await fold(d, /^Acceptance criteria/)),
      },
      {
        short: true,
        note: "One fix round later: eleven of twelve points have passing evidence. The live Finance check remains unverified.",
        act: async (d) => {
          // Verify as it stands once the task reached Review: every lane done, the recheck passed.
          await d.go(at("review"))
          await d.click(button(d, "Verify"))
          await d.click(d.page.getByTestId("lane").filter({ hasText: "Fix rounds" }).first())
          await d.focus(testid(d, "verify-lanes"))
        },
      },
    ],
  },
  {
    id: "review",
    title: "Review",
    line: "You approve the change",
    url: at("review-decisions", `${task}/changes`),
    beats: [
      {
        short: true,
        note: "Step 7. The finished change is ready for code review and one final approval.",
        act: (d) => d.focus(testid(d, "step-gist")),
      },
      {
        note: "The code comes first. The files I have viewed stay marked when I return.",
        act: (d) => d.focus(d.page.locator('[aria-label="Code review"]')),
      },
      {
        short: true,
        note: "Open the code by slice, file by file. Comments stay on the lines they refer to.",
        act: async (d) => {
          await d.click(button(d, "Review the code"))
          await d.focus(testid(d, "review-workspace"))
        },
      },
      {
        note: "The summary keeps the change readable. The live Finance check remains unverified; approval does not make it pass.",
        act: async (d) => {
          await d.go(at("review-decisions", `${task}/changes`))
          await d.focus(d.page.locator(".review-final-summary"))
        },
      },
      {
        note: "Every agreed outcome has its proof here, with the checks that ran and the independent reviewers' findings.",
        act: async (d) => d.focus(await fold(d, /^Checks and outcomes/)),
      },
      {
        short: true,
        note: "The screens it built, with their recorded sizes, themes and source revisions.",
        act: async (d) => d.focus(await fold(d, /^Screenshots/)),
      },
      {
        note: "Scope, files, build decisions and the risk at merge are in Change details. The full record stays available.",
        act: async (d) => d.focus(await fold(d, /^Change details/)),
      },
      {
        note: "Something to change? Tell the agent in Feedback, or comment on a line of code.",
        act: async (d) => {
          await d.click(button(d, "Give feedback"))
          await d.focus(testid(d, "right-sidebar"))
        },
      },
      {
        short: true,
        note: "Approve saves the decision. Approve and create PR also pushes the branch and opens its pull request. Nothing merges.",
        act: async (d) => {
          await d.page.keyboard.press("Escape")
          await peek(d, button(d, "Approval options"), 2400)
        },
      },
      {
        note: "After approval: the pull request, its checks and review threads stay on the task.",
        act: async (d) => {
          await d.go(at("pr-threads"))
          await d.focus(testid(d, "pull-request-card"))
        },
      },
      {
        short: true,
        note: "Merged. The task keeps the whole story: what was asked, decided, built and proved.",
        act: async (d) => {
          await d.go(at("pr-merged"))
          await d.focus(testid(d, "pull-request-top"))
        },
      },
    ],
  },
  {
    id: "team",
    title: "Team",
    line: "Questions between people",
    url: at("plan-approve", "#/"),
    beats: [
      {
        short: true,
        note: "The team side. Anna asks me about one diagram in her Plan; her approval waits for my answer.",
        act: async (d) => {
          await d.click(await nav(d, d.page.getByRole("button", { name: /^Team/ }).first()))
          // The amber card already says it waits on me: the cursor points at the question, no ring over it.
          await d.hover(d.page.getByText(/Would retrying everyone at 10:00/).first())
        },
      },
      {
        note: "Ben wants my opinion on a passage. My own agent drafted an answer from the code; it reads right, so I send it.",
        act: async (d) => {
          const ben = d.page.getByTestId("for-you-card").filter({ hasText: "Ben Ortiz" }).first()
          await d.hover(ben.getByText(/Draft by your Claude Code/).first())
          await d.wait(1200)
          await d.click(ben.getByRole("button", { name: "Send the draft", exact: true }))
        },
      },
    ],
  },
  {
    id: "artifacts",
    title: "Artifacts",
    line: "Designs before code",
    url: at("plan-approve", "#/artifacts"),
    beats: [
      {
        short: true,
        note: "Artifacts: designs and models agents draw, kept per project in the repository. My favorites on top; the billing task is changing two of acme/platform's.",
        act: (d) => d.focus(d.page.getByText("Favorites", { exact: true }).first().locator("xpath=../..")),
      },
      {
        short: true,
        note: "The backend model, full size: how a request travels, what each store keeps, and what leaves the EU.",
        act: async (d) => {
          await d.click(d.page.getByTestId("library-row").filter({ hasText: "The services behind every API request" }).first())
          await d.focus(testid(d, "artifact-canvas"))
          // Down to the diagram, as a reader scrolls the page.
          await d.wait(1200)
          await d.page.mouse.wheel(0, 640)
          await d.wait(900)
        },
      },
      {
        note: "Share sends it to the team, who always see the newest version, or as a link to someone outside.",
        act: (d) => peek(d, testid(d, "artifact-share").getByRole("button").or(testid(d, "artifact-share")).first(), 2200),
      },
      {
        note: "Finance's account page: October's use, November priced both ways, the switch and its audit log. A working page, not a picture, and the billing task is changing it.",
        act: async (d) => {
          await d.go(at("plan-approve", "#/artifacts"))
          await d.click(d.page.getByTestId("library-row").filter({ hasText: "Billing admin" }).first())
          await d.focus(testid(d, "artifact-canvas"))
        },
      },
      {
        note: "Every state is there to review: loading, and the error when the billing service does not answer.",
        // The guided web demo cannot reach into the page's sandboxed frame: the visitor tries it.
        webNote: "Every state is there to review: loading, and the error when the billing service does not answer. Try the buttons on the page.",
        web: (d) => d.focus(testid(d, "artifact-canvas")),
        act: async (d) => {
          // The Library's canvas lies over the page's frame: a plain mouse click on the spot reaches it.
          const page = d.page.frameLocator('[data-testid="artifact-page-frame"]')
          for (const state of ["Loading", "Error", "Default"]) {
            await d.clickSpot(page.getByRole("button", { name: state, exact: true }))
            await d.wait(900)
          }
        },
      },
      {
        short: true,
        note: "Feedback goes on an exact spot of the page. This one is for the agent: show who switched the account last.",
        webNote: "Feedback goes on an exact spot of the page, for the agent or a teammate. Click a spot on the page to try it; the agent changes the page.",
        web: async (d) => {
          await d.click(testid(d, "artifact-comment-mode"))
          await d.focus(testid(d, "artifact-canvas"))
        },
        act: async (d) => {
          await d.click(testid(d, "artifact-comment-mode"))
          // Feedback mode settles its layout before the spot is measured.
          await d.page.waitForTimeout(500)
          const spot = d.page.frameLocator('[data-testid="artifact-page-frame"]').getByText(/Every switch is audited/).first()
          await d.clickSpot(spot)
          await d.type(d.page.getByPlaceholder("What should change here?"), "Show who switched this account last, right under the button.")
          await d.click(button(d, "Send"))
        },
      },
      {
        short: true,
        note: "The agent picks it up, changes the page while I watch, and says what it changed.",
        webNote: "Feedback for the agent is picked up at its next step: it changes the page and says what it changed. Your feedback and its answer are under Feedback.",
        web: async (d) => {
          await d.click(testid(d, "sidebar-button"))
          await d.click(d.page.getByRole("tab", { name: /^Feedback/ }).last())
          await d.focus(testid(d, "artifact-side"))
        },
        act: async (d) => {
          // The side panel's Feedback tab holds the thread; the page shows the change once the agent answered.
          await d.click(testid(d, "sidebar-button"))
          await d.click(d.page.getByRole("tab", { name: /^Feedback/ }).last())
          const answer = d.page.getByText(/^Changed the page/).first()
          await answer.waitFor({ timeout: 15000 })
          await d.focus(answer.locator("xpath=ancestor::*[@data-testid][1]"))
        },
      },
      {
        note: "Designs outlive the task. Ben shared the billing settings with the team; the team copy is always the newest version.",
        act: async (d) => {
          await d.go(at("plan-approve", "#/artifacts"))
          await d.focus(d.page.getByTestId("library-row").filter({ hasText: "Billing settings" }))
        },
      },
    ],
  },
  {
    id: "memory",
    title: "Memory",
    line: "Lessons agents keep",
    url: at("plan-approve", "#/settings/memory"),
    beats: [
      {
        short: true,
        note: "Memory: lessons agents keep between tasks. Each stays on this computer, in the project, or goes to the team through Git.",
        act: (d) => d.focus(testid(d, "memory-settings")),
      },
      {
        note: "The newest lesson, from the billing task: what was learned, the check that proved it, and the file it is about.",
        act: async (d) => {
          await d.click(d.page.getByText("Key each meter event by its request id", { exact: true }).first())
          await d.focus(d.page.getByRole("dialog").first())
        },
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    line: "How your agents work",
    url: at("plan-approve", "#/settings/workflow"),
    beats: [
      {
        note: "Settings, one card at a time. New tasks: the level a Plan is written at, and my own instructions every agent follows.",
        act: (d) => d.focus(card(d, "New tasks")),
      },
      {
        short: true,
        note: "Reviews: a fresh agent checks every round, and a second opinion comes from another maker's model. Here that is Codex.",
        act: async (d) => {
          await d.focus(card(d, "Reviews"))
          await d.click(testid(d, "second-opinion").getByRole("combobox").first())
          await d.wait(1600)
          // The menu closes on a choice: Codex stays.
          await d.click(d.page.getByRole("option", { name: "Codex", exact: true }).first())
        },
      },
      {
        note: "Which model reviews for each agent: Opus 5.5 by default, a cheaper one when it should cost less.",
        act: async (d) => {
          await d.focus(card(d, "Reviewer models"))
          await d.click(d.page.getByRole("combobox").filter({ hasText: "Opus 5.5" }).first())
          await d.wait(1600)
          await d.click(d.page.getByRole("option", { name: /^Opus 5\.5/ }).first())
        },
      },
      {
        note: "Every coding agent on this computer, found on its own, each with your own subscription.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Agents")))
          await d.focus(testid(d, "agent-health"))
        },
      },
      {
        short: true,
        note: "Plan limits and usage across all agents, so a long build never runs into a wall by surprise.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Usage")))
          await d.focus(testid(d, "plan-limits"))
        },
      },
      {
        note: "Sessions: what runs now in each project, and the rules every session follows.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Sessions")))
          await d.focus(testid(d, "running-now"))
        },
      },
      {
        note: "Notifications: I turn on a notice when a task needs me, with a sound.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Notifications")))
          await d.focus(testid(d, "notifications"))
          await d.click(testid(d, "notifications").getByRole("switch").first())
          await d.wait(600)
          await d.click(testid(d, "notification-sound").getByRole("switch").first())
        },
      },
      {
        note: "Git and editor: the tools the agents use, found on this computer, and how pull requests are followed.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Git and editor")))
          await d.focus(testid(d, "git-tools"))
        },
      },
      {
        note: "Appearance: light or dark, the motion, and how much each sidebar row says.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Appearance")))
          const theme = testid(d, "theme-cards")
          await d.focus(theme)
          await d.click(theme.getByText("Light", { exact: true }).first())
          await d.wait(1400)
          await d.click(theme.getByText("Dark", { exact: true }).first())
        },
      },
      {
        note: "Team: who is on it, their groups and machines, and the instructions every teammate's agent follows.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Team")))
          await d.focus(testid(d, "people-groups"))
        },
      },
      {
        note: "The licence, and exactly what leaves this computer: plain words, no surprises.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "Licence")))
          await d.focus(testid(d, "privacy-disclosure"))
        },
      },
      {
        note: "And About: the version, the update channel, and help.",
        act: async (d) => {
          await d.click(await nav(d, button(d, "About")))
          await d.focus(testid(d, "about-version"))
        },
      },
    ],
  },
  {
    id: "home",
    title: "Home",
    line: "Step away while agents work",
    url: at("pr-merged", "#/"),
    beats: [
      {
        short: true,
        note: "Back on Home: only what needs you. You can step away while the agents work.",
        act: (d) => d.focus(testid(d, "needs-you")),
      },
      {
        note: "And what runs without you: two agents building, each with its last report.",
        act: (d) => d.focus(testid(d, "in-progress")),
      },
      {
        note: "One search for everything: tasks, projects, files and actions, also with ⌘K.",
        act: async (d) => {
          await d.click(await nav(d, testid(d, "search-row")))
          await d.type(d.page.getByRole("combobox", { name: "Search or jump" }).first(), "billing")
          await d.wait(1600)
          await d.page.keyboard.press("Escape")
        },
      },
      {
        note: "The task list finds a task by name, shows each row the way I like it, and takes a new project folder.",
        act: async (d) => {
          await peek(d, await nav(d, d.page.getByRole("button", { name: "Find a task", exact: true }).first()), 1000)
          await peek(d, d.page.getByRole("button", { name: "View options", exact: true }).first())
          await peek(d, d.page.getByRole("button", { name: "Add a project", exact: true }).first())
        },
      },
      {
        note: "The bell holds what happened while I was away, each a jump to where it happened.",
        act: (d) => peek(d, d.page.getByRole("button", { name: /^Notifications/ }).first(), 2000),
      },
      {
        short: true,
        note: "And when something is off, or an idea comes up, it goes straight to the team behind QualityLayer.",
        act: async (d) => {
          // A bug or an idea, each a public issue the person previews before it is sent; no ring over the dialog.
          await d.click(await nav(d, d.page.getByRole("button", { name: "Report a bug or suggest an improvement", exact: true }).first()))
          await d.wait(1400)
          await d.click(d.page.getByRole("dialog").getByText("Suggest an improvement", { exact: true }).first())
        },
      },
    ],
  },
]
