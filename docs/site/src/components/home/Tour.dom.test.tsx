// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CHAPTERS, READ_LINE } from "@/lib/tour";
import CloseUp from "./CloseUps";
import Tour from "./Tour";
import { CLAIMS, missing } from "./tour-claims";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps all seven named workflow steps together below the compact task header", () => {
  const { container } = render(<CloseUp id="plan" step={0} />);
  const header = container.querySelector(".cu-tb") as HTMLElement;
  const steps = screen.getByRole("list", { name: "Task steps" });
  expect(header.contains(steps)).toBe(false);
  expect(steps.textContent).toBe("DiscussResearchPlanOutlineImplementVerifyReview");
  expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe("Plan");
});

it("opens actual agent status from its chip while keeping the build document quiet", () => {
  const { container } = render(<CloseUp id="implement" step={0} />);
  expect(container.querySelector(".cu-stage .cu-at")).toBeNull();
  const summary = container.querySelector('summary[aria-label="Claude Code status"]') as HTMLElement;
  expect(summary).toBeTruthy();
  const panel = summary.closest("details") as HTMLDetailsElement;
  expect(panel.open).toBe(false);
  fireEvent.click(summary);
  expect(panel.open).toBe(true);
  expect(panel.textContent).toContain("Building slice 2");
  expect(panel.textContent).toContain("2 of 5 tasks committed");
});

it("shows the complete Plan with header approval at once, then a comment on its diagram", () => {
  const view = render(<CloseUp id="plan" step={0} />);
  const document = screen.getByRole("article", { name: "Plan document" });
  expect(document.textContent).toContain("keep serving and bill the overage");
  expect(document.textContent).toContain("Done means");
  expect(document.textContent).toContain("Contracts");
  expect(document.textContent).not.toContain("Slices");
  expect(document.textContent).toContain("the findings are folded in");
  expect(view.container.querySelector(".cu-stage .cu-yt")).toBeNull();
  expect(view.container.querySelector(".cu-workspace-track")?.textContent).toContain("Approve Plan");
  expect(view.container.querySelector(".cu-stage")?.textContent).not.toContain("Approve Plan");
  expect(view.container.querySelector(".cu-dgm .cu-pin")).toBeNull();
  view.rerender(<CloseUp id="plan" step={2} />);
  expect(view.container.querySelector(".cu-dgm .cu-pin")?.textContent).toBe("1");
});

it("keeps the full-size artifact's Switch to usage working after the agent replies to its comment", () => {
  function Preview() {
    const [tries, setTries] = useState(2);
    return <CloseUp id="comment" step={6} tries={tries} onRetry={() => setTries((n) => Math.min(3, n + 1))} />;
  }
  const { container } = render(<Preview />);
  expect(screen.getByText(/Changed the page: the last switch shows beside the button/)).toBeTruthy();
  const button = screen.getByRole("button", { name: "Switch to usage" }) as HTMLButtonElement;
  const row = button.closest(".cu-dpr") as HTMLElement;
  expect(row.textContent).toContain("Last switch · 14 May, by Finance");
  expect(container.querySelector(".cu-dpt .on")?.textContent).toBe("Seats");
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(row.textContent).toContain("Usage from 1 Nov · audited just now");
  expect(container.querySelector(".cu-dpt .on")?.textContent).toBe("Usage");
  expect(button.disabled).toBe(true);
});

/**
 * The tour on a screen with no layout engine: each chapter's text sits at a place the test sets, and
 * `scrolled` moves the page. A chapter's first line (its act heading when it opens a part, else its
 * own heading) is at ROOM x its number below the tour's top; the tour itself starts TOUR_TOP down.
 */
const ROOM = 774;
const TOUR_TOP = 1000;
const ACT = 300;
let scrolled = 0;
let wide = true;
let height = 900;

const chapterIndex = (el: Element | null) => Array.from(document.querySelectorAll("#tour .sx-ch")).indexOf(el?.closest(".sx-ch") ?? (el?.nextElementSibling ?? null));
const rect = (top: number, h = 0): DOMRect => ({ top, bottom: top + h, left: 0, right: 0, width: 0, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

function layOut() {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: wide ? 1440 : 390 });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const tour = document.getElementById("tour");
    const base = TOUR_TOP - scrolled;
    if (this === tour) return rect(base, CHAPTERS.length * ROOM + 600);
    if (this.matches(".sx-act-h h2")) return rect(base + chapterIndex(this.parentElement) * ROOM, 40);
    // an act heading sits above the chapter's own text
    const own = (el: Element) => base + chapterIndex(el) * ROOM + (el.closest(".sx-ch")?.previousElementSibling?.classList.contains("sx-act-h") ? ACT : 0);
    if (this.matches(".sx-chin, .sx-h3")) return rect(own(this), 300);
    if (this.matches(".sx-iwin")) return rect(own(this) + 90, 500);
    return rect(0);
  });
}

const scrollTo = async (y: number) => {
  scrolled = y;
  await act(async () => {
    fireEvent.scroll(window);
    vi.advanceTimersByTime(40);
  });
};
/** Scroll so that chapter `i`'s first line is `at` x the screen height down. */
const readChapterAt = (i: number, at: number) => scrollTo(TOUR_TOP + i * ROOM - height * at);
/** Let time pass one second at a time, so each moment of a close-up can render before the next. */
const later = async (ms: number) => {
  for (let t = 0; t < ms; t += 1000) await act(async () => void vi.advanceTimersByTime(1000));
};
/** The words a close-up shows, with a space between elements. */
const plain = (el: Element | null) => (el?.innerHTML ?? "").replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", " ").replace(/\s+/g, " ");
const shown = (id: string) => plain(document.querySelector(`#tour .sx-ch#${id} .cu`) ?? document.querySelector("#tour .sx-cupin .cu"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  scrolled = 0;
  wide = true;
  height = 900;
});

it("opens Discuss on its batch of questions even when the page has been open a long while", async () => {
  layOut();
  render(<Tour />);
  // the reader is still on the page's first screen: nothing in the tour plays
  await later(30_000);
  expect(shown("discuss")).toContain("question 1 of 4");
  // then scrolls to the text "Your agent asks one batch until the goal is clear"
  await readChapterAt(0, 0.45);
  expect(document.querySelector("#tour .sx-ch#discuss")?.classList.contains("on")).toBe(true);
  expect(missing(shown("discuss"), [...CLAIMS.discuss.always, ...(CLAIMS.discuss.first ?? [])])).toEqual([]);
  expect(document.querySelector("#tour .sx-cupin .cu-strip")?.children).toHaveLength(4);
  // and still sees it while the moments play and after they have
  await later(2_000);
  expect(missing(shown("discuss"), CLAIMS.discuss.always)).toEqual([]);
  await later(20_000);
  expect(missing(shown("discuss"), [...CLAIMS.discuss.always, ...(CLAIMS.discuss.last ?? [])])).toEqual([]);
});

it("shows the close-up that matches the chapter whose text is in view, for every chapter, the moment it is read", async () => {
  layOut();
  render(<Tour />);
  for (let i = 0; i < CHAPTERS.length; i++) {
    const { id } = CHAPTERS[i];
    // its first line is just above the read line: this chapter is the one in view
    await readChapterAt(i, READ_LINE.pinned - 0.03);
    expect(document.querySelector("#tour .sx-ch.on")?.id, `${id} is in view`).toBe(id);
    const claim = CLAIMS[id];
    expect(document.querySelector("#tour .sx-cupin .cu")?.getAttribute("data-closeup"), `${id}'s close-up is on the right`).toBeTruthy();
    expect(missing(shown(id), [...claim.always, ...(claim.first ?? [])]), `${id} shows what its text says as soon as it is read`).toEqual([]);
    await later((CHAPTERS[i].steps + 2) * 1000);
    expect(missing(shown(id), [...claim.always, ...(claim.last ?? [])]), `${id} still shows it when it has played`).toEqual([]);
  }
});

it("keeps the previous chapter's close-up until the next chapter's text has risen to the read line, and goes back as the reader scrolls up", async () => {
  layOut();
  render(<Tour />);
  await readChapterAt(1, READ_LINE.pinned + 0.04);
  expect(document.querySelector("#tour .sx-ch.on")?.id).toBe("discuss");
  await readChapterAt(1, READ_LINE.pinned - 0.04);
  expect(document.querySelector("#tour .sx-ch.on")?.id).toBe("research");
  expect(document.querySelector("#tour .sx-cupin .cu")?.getAttribute("data-closeup")).toBe("Research");
  await readChapterAt(1, READ_LINE.pinned + 0.04);
  expect(document.querySelector("#tour .sx-ch.on")?.id).toBe("discuss");
  expect(document.querySelector("#tour .sx-cupin .cu")?.getAttribute("data-closeup")).toBe("Discuss");
  expect(missing(shown("discuss"), CLAIMS.discuss.always)).toEqual([]);
});

it("treats an act heading as the start of the chapter it opens: the Artifacts heading brings the Draw close-up", async () => {
  layOut();
  render(<Tour />);
  const draw = CHAPTERS.findIndex((c) => c.id === "draw");
  expect(CHAPTERS[draw].act).toBeTruthy();
  // the act heading of the Artifacts part is on screen, the chapter's own text is not yet
  await readChapterAt(draw, READ_LINE.pinned - 0.03);
  expect(document.querySelector("#tour .sx-ch.on")?.id).toBe("draw");
  expect(missing(shown("draw"), CLAIMS.draw.always)).toEqual([]);
});

it("gives each chapter its own close-up on a phone, which opens on its claim and plays once it is on screen", async () => {
  wide = false;
  height = 844;
  layOut();
  render(<Tour />);
  await later(30_000);
  // nothing has been scrolled to: the close-ups stay on their first moment
  expect(shown("discuss")).toContain("question 1 of 4");
  expect(shown("discuss")).not.toContain("Sent to Claude Code");
  for (let i = 0; i < CHAPTERS.length; i++) {
    const { id } = CHAPTERS[i];
    await readChapterAt(i, READ_LINE.inline - 0.04);
    expect(document.querySelector("#tour .sx-ch.on")?.id, `${id} is in view`).toBe(id);
    const claim = CLAIMS[id];
    expect(missing(shown(id), [...claim.always, ...(claim.first ?? [])]), `${id} shows its claim on arrival`).toEqual([]);
    // the reader scrolls on until the chapter's own close-up is on screen, under an act heading when there is one
    if (CHAPTERS[i].act) await scrollTo(scrolled + ACT);
    await later((CHAPTERS[i].steps + 2) * 1000);
    expect(missing(shown(id), [...claim.always, ...(claim.last ?? [])]), `${id} keeps it`).toEqual([]);
  }
});
