import { renderToReadableStream } from "react-dom/server.browser";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "@/lib/banned-words";
import { CHAPTERS, chapterInView, checksPassed, committedTasks, discussAt, PARTS, READ_LINE, STAGES } from "@/lib/tour";
import CloseUp from "./CloseUps";
import Tour from "./Tour";
import { CLAIMS, missing } from "./tour-claims";

async function html(node: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

const render = () => html(<Tour />);
const shot = (id: string, step = 99) => html(<CloseUp id={id} step={step} />);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replace(/\s+/g, " ");

describe("the tour", () => {
  it("tells every chapter and draws a close-up of the App for each", async () => {
    const page = await render();
    for (const chapter of CHAPTERS) {
      expect(page).toContain(`id="${chapter.id}"`);
      expect(text(page)).toContain(chapter.title);
      expect(await shot(chapter.id)).toContain('class="cu"');
    }
  });

  it("keeps the anchors the header and other pages link to, each once", async () => {
    const page = await render();
    for (const name of ["tour", "artifacts", "team", "setup"]) expect(page.match(new RegExp(`id="${name}"`, "g"))).toHaveLength(1);
  });

  it("opens each of its four parts with a heading: the steps for you alone first, then artifacts, the team and the setup", () => {
    expect(PARTS.map((p) => p.label)).toEqual(["Steps", "Artifacts", "Team", "Setup"]);
    expect(CHAPTERS[0].act?.text).toMatch(/alone|your own/i);
    expect(CHAPTERS[PARTS[1].from].act?.id).toBe("artifacts");
    expect(CHAPTERS[PARTS[2].from].act?.id).toBe("team");
  });

  it("gives the steps for one person and the team's chapters about the same room", () => {
    const sentences = (from: number, to: number) =>
      CHAPTERS.slice(from, to + 1).reduce((n, c) => n + [c.title, c.text, ...c.bullets, ...(c.act ? [c.act.title, c.act.text] : [])].join(" ").split(/[.!?](?:\s|$)/).filter(Boolean).length, 0);
    const [steps, team] = [sentences(PARTS[0].from, PARTS[0].to), sentences(PARTS[2].from, PARTS[2].to)];
    expect(team / steps).toBeGreaterThan(0.5);
    expect(team / steps).toBeLessThan(1.33);
  });

  it("draws the App's top bar on a task: the seven steps, the current one marked, and the agent chip", async () => {
    expect(STAGES).toEqual(["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]);
    const plan = await shot("plan", 0);
    for (const stage of STAGES) expect(text(plan)).toContain(stage);
    expect(plan).toMatch(/<li class="cur" aria-current="step">Plan<\/li>/);
    expect(plan).toContain("cu-chip");
    expect(text(plan)).toContain("Claude Code");
  });

  it("asks Discuss as one batch of four: the strip of all four, one question in focus with numbered choices, the recommendation and the own-words field, answered in any order", async () => {
    expect(discussAt(0)).toEqual({ answered: [], focus: 0, picked: false, sent: null });
    expect(discussAt(99)).toMatchObject({ answered: [0, 2], focus: 1 });
    const first = text(await shot("discuss", 0));
    expect(first).toContain("What happens to the customers on seats?");
    expect(first).toContain("a batch of 4 from Claude Code");
    expect(first).toContain("1 2 3 4");
    expect(first).toContain("question 1 of 4");
    expect(first).toContain("recommended");
    expect(first).toContain("Or write your own answer");
    expect(first).toContain("Your turn · 4 questions");
    // the third question is answered before the second: any order
    const later = await shot("discuss", 4);
    expect(text(later)).toContain("Sent to Claude Code · Correct the next invoice");
    expect(text(later)).toContain("Bill from the first request, or after a free allowance?");
    expect(later).toContain('aria-current="true"');
    expect(later.match(/class="done/g)).toHaveLength(2);
    // the batch never gives way to the document: it is still the question in view at the end
    expect(text(await shot("discuss", 99))).toContain("Your turn · 2 questions");
    expect(await shot("discuss", 99)).not.toContain("Discuss document");
  });

  it("keeps everything that waits for the person in the one amber Your turn card", async () => {
    for (const [id, step] of [["discuss", 0], ["research", 3], ["start", 0], ["draw", 2], ["answer", 0], ["together", 0]] as const) {
      expect((await shot(id, step)).match(/class="cu-yt"/g), id).toHaveLength(1);
    }
    for (const [id, step] of [["research", 0], ["plan", 0], ["outline", 2], ["implement", 2], ["verify", 2]] as const) expect(await shot(id, step), id).not.toContain('class="cu-yt"');
  });

  it("opens every chapter's close-up on what the chapter says, and never takes it away", async () => {
    expect(Object.keys(CLAIMS).sort()).toEqual(CHAPTERS.map((c) => c.id).sort());
    for (const chapter of CHAPTERS) {
      const claim = CLAIMS[chapter.id];
      for (let step = 0; step <= chapter.steps; step++) {
        const seen = text(await shot(chapter.id, step));
        expect(missing(seen, claim.always), `${chapter.id} at moment ${step} lacks what its text says`).toEqual([]);
        if (step === 0) expect(missing(seen, claim.first), `${chapter.id} opens without its claim`).toEqual([]);
        if (step === chapter.steps) expect(missing(seen, claim.last), `${chapter.id} ends without its claim`).toEqual([]);
      }
      // the last moment is the last there is: nothing more appears after it
      expect(text(await shot(chapter.id, chapter.steps)), `${chapter.id} has moments past its steps`).toBe(text(await shot(chapter.id, 99)));
    }
  });

  it("names the chapter in view from where the text is: the last whose first line has risen past the read line", () => {
    const tops = [100, 874, 1648, 2422];
    const vh = 900;
    expect(chapterInView(tops, vh, READ_LINE.pinned)).toBe(0);
    expect(chapterInView([-200, 600, 1374], vh, READ_LINE.pinned)).toBe(1);
    expect(chapterInView([-974, -200, 700], vh, READ_LINE.pinned)).toBe(1);
    expect(chapterInView([-1748, -974, 600], vh, READ_LINE.pinned)).toBe(2);
    // before any chapter has been read, the first is in view
    expect(chapterInView([1200, 1974], vh, READ_LINE.pinned)).toBe(0);
    // the read line is a share of the screen's height, one for each layout
    for (const line of Object.values(READ_LINE)) expect(line).toBeGreaterThan(0.4);
    for (const line of Object.values(READ_LINE)) expect(line).toBeLessThan(0.9);
    // a chapter's close-up changes exactly when its heading passes the line, in either direction
    expect(chapterInView([-300, vh * READ_LINE.pinned], vh, READ_LINE.pinned)).toBe(1);
    expect(chapterInView([-300, vh * READ_LINE.pinned + 1], vh, READ_LINE.pinned)).toBe(0);
  });

  it("tells the seven steps in order, with Research after Discuss and the Outline after the Plan", () => {
    const steps = CHAPTERS.map((c) => c.step);
    expect(steps.indexOf("Research")).toBe(steps.indexOf("Discuss") + 1);
    expect(steps.indexOf("Outline")).toBe(steps.indexOf("Plan") + 1);
    expect(CHAPTERS.find((c) => c.id === "research")?.title).toMatch(/read the code before anything is designed/);
    expect(CHAPTERS.find((c) => c.id === "outline")?.title).toMatch(/build session cuts the Plan into slices/);
    expect(CHAPTERS.find((c) => c.id === "discuss")?.text).toMatch(/one batch/);
    expect(CHAPTERS.find((c) => c.id === "plan")?.text).toMatch(/contracts/);
    expect(CHAPTERS.find((c) => c.id === "verify")?.text).toMatch(/security review/i);
  });

  it("draws Research as agents reading the code with no request in view, then one batch of the choices the code leaves open", async () => {
    const reading = text(await shot("research", 1));
    expect(reading).toContain("The questions");
    expect(reading).toContain("answered by agents that never see your request");
    expect(reading).toContain("3 agents reading the code");
    const asked = text(await shot("research", 3));
    expect(asked).toContain("A choice the code leaves open");
    expect(asked).toContain("From Research");
    expect(asked).toContain("Your turn · 1 choice");
  });

  it("draws the Outline as the Plan cut into slices in build order, with every Done means point proved and nothing to approve", async () => {
    const early = text(await shot("outline", 0));
    expect(early).toContain("The build, slice by slice");
    expect(early).not.toContain("Approve");
    const done = text(await shot("outline", 4));
    for (const words of ["in build order", "Slices", "How each point is proved", "Every Done means point has a scenario"]) expect(done).toContain(words);
    expect(done).not.toMatch(/wave|side by side|second reader/i);
  });

  it("names Verify's checks in the order they run", async () => {
    const page = text(await shot("verify", 0));
    const verify = page.slice(page.indexOf("The checks, in order"));
    const order = ["Security review", "Project checks", "Independent review", "Second opinion"].map((name) => verify.indexOf(name));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows the complete Plan with its diagram from the first moment, a comment on the diagram, and Approve in the header", async () => {
    const opening = await shot("plan", 0);
    expect(opening).toContain("cu-dgm");
    expect(opening).toContain('aria-label="Plan document"');
    expect(opening).not.toContain('class="cu-pin"');
    const last = await shot("plan", 2);
    expect(last).toContain('class="cu-pin"');
    expect(text(last)).toContain("Approve Plan");
    expect(last).not.toContain('class="cu-yt"');
    expect(text(last)).toContain("Give feedback");
  });

  it("starts the build from one line of Build defaults and one request", async () => {
    const start = text(await shot("start"));
    expect(start).toContain("Opus 5.5");
    expect(start).toContain("Sonnet 5.5");
    expect(start).toContain("Using QualityLayer, implement the approved plan for task usage-billing");
    expect(start).not.toContain("/goal /ql implement");
  });

  it("builds on its own, test first, and counts the committed tasks", async () => {
    // slice 1 is done when it opens; slices 2 and 3 follow in order
    expect([0, 1, 2, 3, 4].map(committedTasks)).toEqual([2, 3, 4, 5, 5]);
    expect(text(await shot("implement", 0))).toContain("2 of 5 tasks committed");
    const build = text(await shot("implement", 4));
    expect(build).toContain("5 of 5 tasks committed");
    expect(build).toContain("Ask why");
    expect(text(await shot("implement", 5))).toContain("Checked by agents");
  });

  it("fills Verify in point by point, then hands what only a person can settle to Review", async () => {
    expect(checksPassed(99)).toBe(9);
    expect(text(await shot("verify", 2))).toMatch(/\d+ of 9/);
    const done = text(await shot("verify", 7));
    expect(done).toContain("9 of 9 passed");
    expect(done).toContain("Your turn · 2 in Review");
  });

  it("opens Review on the code with one header approval and complete records in three folds", async () => {
    for (const moment of [0, 1, 2, 4]) {
      const page = await shot("review", moment);
      expect(page).not.toContain('class="cu-yt"');
      expect(text(page)).not.toMatch(/Your turn|Only you can confirm|I confirm|then approve/);
      expect(text(page).match(/Approve and create PR/g)).toHaveLength(1);
      expect(page.indexOf("Approve and create PR")).toBeLessThan(page.indexOf('aria-label="Review the code"'));
      expect([...page.matchAll(/<summary[^>]*><b>([^<]+)<\/b>/g)].map((match) => match[1])).toEqual(["Checks", "Screens", "Change details"]);
      expect(page).toContain('aria-label="Diff of services/gateway/src/meter.ts"');
      expect(text(page)).toContain("Does a retry with a new request id count twice?");
      expect(text(page)).toContain("Approval leaves this result unverified");
      for (const content of ["window.test.ts", "Billing mode", "Built, slice by slice", "Decided while building"]) expect(text(page)).toContain(content);
    }
  });

  it("keeps the complete change description inside Change details, in the order of the pull request", async () => {
    const page = text(await shot("review", 0));
    const order = ["The change, top to bottom", "Why", "What you asked for", "Built, slice by slice", "Deliberately not changed", "How it was checked", "Ship"].map((part) => page.indexOf(part, page.indexOf("The change, top to bottom")));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // a slice opens to its decision, its files and a diff that takes a comment and carries a teammate's thread
    expect(page).toContain("Decided while building");
    expect(page).toContain("services/gateway/src/meter.ts");
    expect(page).toContain("from the team");
    expect(page).toContain("built in slice 2 · proved by scenario 2");
  });

  it("keeps the task open after the approval: the pull request on the page until it is merged", async () => {
    const before = text(await shot("review", 4));
    expect(before).not.toContain("stays open");
    const after = text(await shot("review", 99));
    expect(after).toContain("Approved · pull request #412 opened");
    expect(after).toContain("The task stays open until the pull request is merged");
    expect(after).toContain("CI · macOS");
    expect(after).toContain("Anna and Ben were asked");
    expect(after).not.toContain("Approve the change?");
    expect(CHAPTERS.find((c) => c.id === "review")?.text).toMatch(/stays open until it is merged/);
  });

  it("shows the artifact inside the question it belongs to, and keeps the full-size artifact clickable", async () => {
    expect(await shot("draw", 2)).toContain("cu-dz");
    expect(await shot("comment", 6)).toContain("cu-dpb");
    expect(text(await shot("comment", 6))).toContain("Changed the page: the last switch shows beside the button");
  });

  it("draws the team's chapters in the App's words", async () => {
    expect(text(await shot("ask", 0))).toContain("Ask the team about this passage");
    expect(text(await shot("ask", 5))).toContain("via Claude Code");
    expect(text(await shot("answer", 3))).toContain("Draft by your Claude Code · not sent yet");
    expect(text(await shot("space"))).toContain("Working now");
    expect(text(await shot("together", 5))).toContain("Ready to approve");
  });

  it("draws Settings with the plan limits and the cost of each step, and New task with one request", async () => {
    const settings = text(await shot("settings"));
    for (const words of ["Plan limits", "This week", "Resume when a limit resets", "$20.95", "estimated at list price", "Research", "Outline"]) expect(settings).toContain(words);
    expect(settings).not.toContain("Planning defaults");
    expect(text(await shot("agents"))).toContain("Using QualityLayer, plan");
    expect(text(await shot("agents"))).not.toContain("claude --model");
  });

  it("tells one task throughout: the usage-based billing change in its own words, with nothing left of another story", async () => {
    const all = (await Promise.all(CHAPTERS.map((c) => shot(c.id)))).map(text).join(" ") + CHAPTERS.map((c) => JSON.stringify(c)).join(" ");
    expect(all).toContain("Usage-based billing");
    expect(all).toContain("feat/usage-billing");
    expect(all).not.toMatch(/webhook deliver|failed deliver|retry-webhooks|Priya|Northwind|Dana/i);
  });

  it("never paints a planned step red", async () => {
    for (const chapter of CHAPTERS) expect(await shot(chapter.id), chapter.id).not.toContain('class="red"');
  });

  it("never uses the App's internal words, and never sends the person to the terminal to answer", async () => {
    const all = text(await render()) + CHAPTERS.map((c) => JSON.stringify(c)).join(" ") + (await Promise.all(CHAPTERS.map((c) => shot(c.id, 0)))).map(text).join(" ");
    expect(all).not.toMatch(BANNED_WORDS);
    expect(all).not.toMatch(/for the agent|quality pass|claude design|cockpit/i);
    expect(all).not.toMatch(/(answer|approve|asks?)[^.]{0,40}in the (terminal|chat)/i);
  });
});
