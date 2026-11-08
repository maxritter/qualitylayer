/**
 * The hero showcase's timeline: the App walking through the seven steps and the pull request on real
 * captures, with a camera, a cursor and highlights. Every frame is a pure function of time, so a
 * station can seek to its step and a capture can render any frame. Points and rectangles are
 * percentages of the App window (the capture without its 50 px frame); a camera is a centre and a zoom.
 *
 * Every position comes from tour-geometry.json, which the screenshot script measures on the page each
 * capture shows (scripts/website-screenshots.mjs), so a refreshed capture moves the cursor and the
 * highlights with it. The camera has one close framing: the work area without the App's sidebar, the
 * step page and the conversation side by side, so its edge always falls between columns.
 */
import GEOMETRY from "./tour-geometry.json";

export type Shot = "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review" | "review-approved" | "pull-request";
export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Camera = Point & { s: number };
/** What the caption under the stage says: a workflow step, or the pull request after it. */
export type Caption = "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review" | "pull-request";
type Beat =
  | [number, "cam", Camera | null, number]
  | [number, "cur", Point, number]
  | [number, "click"]
  | [number, "mark", Rect | null]
  | [number, "shot", Shot]
  | [number, "say", Caption];
export type Chapter = { id: string; dur: number; beats: Beat[] };

type Box = [number, number, number, number];
type Measured = { rail: Record<string, Box>; targets: Record<string, Box> };
const G = GEOMETRY as unknown as { window: { width: number; height: number }; shots: Record<Shot, Measured> };

/** A measured box as a rectangle of the window, with a little air around it. */
function rect(shot: Shot, target: string, pad = 4): Rect {
  const box = G.shots[shot]?.targets[target];
  if (!box) throw new Error(`tour-geometry.json has no ${target} on ${shot}`);
  const [x, y, w, h] = box;
  const { width, height } = G.window;
  return { x: ((x - pad) / width) * 100, y: ((y - pad) / height) * 100, w: ((w + 2 * pad) / width) * 100, h: ((h + 2 * pad) / height) * 100 };
}
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** Where the cursor rests to point at a highlight: its right end, where rows keep their chevrons and counts. */
const tip = (r: Rect): Point => ({ x: r.x + r.w - Math.min(2.5, r.w / 4), y: r.y + Math.min(r.h / 2, 3.5) });
/** Where to press a step on the rail of the screen showing: its icon. */
function rail(shot: Shot, step: string): Point {
  const [x, y, w, h] = G.shots[shot].rail[step];
  return { x: ((x + w / 2) / G.window.width) * 100, y: ((y + h * 0.36) / G.window.height) * 100 };
}
/** The App's sidebar ends where the step rail begins. */
const SIDEBAR = (G.shots.discuss.rail.discuss[0] / G.window.width) * 100;
/**
 * The work area beside the sidebar: the zoom just drops the sidebar. It stays at the top, where the
 * step rail is, and moves down only as far as the lowest of `rects` needs.
 */
function work(...rects: Rect[]): Camera {
  const s = 100 / (100 - SIDEBAR), seen = 100 / s;
  const bottom = Math.max(0, ...rects.map((r) => r.y + r.h)) + 1.5;
  return { x: 100, y: bottom <= seen ? seen / 2 : Math.min(100 - seen / 2, bottom - seen / 2), s };
}
const TOP = work();
const same = (a: Camera, b: Camera) => Math.abs(a.y - b.y) < 0.01;

/**
 * The walkthrough opens on the whole App and moves into the work area, where it stays: each chapter
 * clicks its step on the rail, points at what the step shows (moving down only when that sits low)
 * and comes back up to the rail. After the pull request it shows the whole App again.
 */
function build(): Chapter[] {
  const r = rect;
  const discussChoice = r("discuss", "choice"), discussTurn = r("discuss", "turn");
  const gateway = r("research", "gateway", 3), researchTurn = r("research", "turn");
  const planChoice = r("plan", "choice", 2), choose = r("plan", "choose", 3);
  const slices = r("outline", "slices"), scenario = r("outline", "scenario");
  const task = r("implement", "task", 2), testFirst = r("implement", "testFirst", 3);
  const facts = r("verify", "facts"), review = r("verify", "review");
  const reviewFacts = r("review", "facts"), code = r("review", "code", 3), approve = r("review", "approve", 3);
  const pr = r("review-approved", "pr", 3);
  const threads = r("pull-request", "threads");
  // Each chapter's rail click lands on the screen the previous chapter ended on.
  const into = (from: Shot, step: string): Beat[] => [[0, "cur", rail(from, step), 650], [700, "click"], [800, "shot", step as Shot], [800, "say", step as Caption]];
  // The cursor moves to point at what lights up, so it never rests on the step it clicked.
  const show = (at: number, target: Rect): Beat[] => [[at - 250, "cur", tip(target), 650], [at, "mark", target]];
  // Down to what sits low, and back up to the rail before the next step; nothing when it all shows from the top.
  const down = (at: number, cam: Camera): Beat[] => (same(cam, TOP) ? [] : [[at, "cam", cam, 650]]);
  const up = (at: number, cam: Camera): Beat[] => (same(cam, TOP) ? [] : [[at, "cam", TOP, 650]]);
  const planCam = work(planChoice, choose), implementCam = work(task, testFirst), verifyCam = work(facts, review);
  return [
    { id: "discuss", dur: 6800, beats: [
      ...into("pull-request", "discuss"),
      [1000, "cam", work(discussChoice, discussTurn), 1200],
      // The first question, answered with its recommended option.
      [2300, "cur", centre(discussChoice), 750], [3100, "click"], [3200, "mark", discussChoice],
      // Asking in the conversation while it waits.
      ...show(4500, discussTurn),
      [6100, "mark", null]] },
    { id: "research", dur: 5600, beats: [
      ...into("discuss", "research"),
      // The gateway every request passes, then the question about it.
      ...show(1700, gateway),
      ...show(3100, researchTurn),
      [4900, "mark", null]] },
    { id: "plan", dur: 7000, beats: [
      ...into("research", "plan"),
      ...down(1000, planCam),
      // The recommended choice with its facts and diagram; the call is the person's.
      ...show(2100, planChoice),
      [3500, "cur", centre(choose), 800], [4400, "click"], [4500, "mark", choose],
      [5800, "mark", null], ...up(5900, planCam)] },
    { id: "outline", dur: 5600, beats: [
      ...into("plan", "outline"),
      // The slices and their task counts, then a scenario that proves a Done means point.
      ...show(1700, slices),
      ...show(3100, scenario),
      [4900, "mark", null]] },
    { id: "implement", dur: 6400, beats: [
      ...into("outline", "implement"),
      ...down(1000, implementCam),
      // One slice, task by task; its test is written first.
      ...show(2100, task),
      ...show(3500, testFirst),
      [5200, "mark", null], ...up(5300, implementCam)] },
    { id: "verify", dur: 6400, beats: [
      ...into("implement", "verify"),
      ...down(1000, verifyCam),
      // Recorded progress, then the independent reviewers at work.
      ...show(2100, facts),
      ...show(3500, review),
      [5200, "mark", null], ...up(5300, verifyCam)] },
    { id: "review", dur: 11800, beats: [
      ...into("verify", "review"),
      // The finished change and its proof, then the code to read.
      ...show(1700, reviewFacts),
      ...show(2900, code),
      // Approve.
      [4100, "mark", null],
      [4200, "cur", centre(approve), 750], [5100, "click"], [5200, "mark", approve], [5400, "shot", "review-approved"], [5500, "mark", null],
      // Then ask for a pull request.
      [5700, "cur", centre(pr), 750], [6600, "click"], [6700, "mark", pr],
      // Its review threads and failing check come back to you; the agent follows them.
      [7600, "shot", "pull-request"], [7600, "say", "pull-request"], [7700, "mark", null],
      ...show(8300, threads),
      [10300, "mark", null], [10500, "cam", null, 1100]] },
  ];
}

export const CHAPTERS: Chapter[] = build();
export const DURATION = CHAPTERS.reduce((sum, c) => sum + c.dur, 0);
export const STARTS = CHAPTERS.map((_, i) => CHAPTERS.slice(0, i).reduce((sum, c) => sum + c.dur, 0));

export type View = { s: number; tx: number; ty: number };
export type Frame = {
  /** The chapter playing, and how far into it. */
  step: number;
  progress: number;
  /** What the caption under the stage says. */
  caption: Caption;
  view: View;
  cursor: Point;
  press: boolean;
  ripple: (Point & { k: number }) | null;
  mark: Rect | null;
  markOn: number;
  /** The shot fading out, the shot fading in and how far the fade is. */
  from: Shot;
  to: Shot;
  fade: number;
};

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The translation that centres the camera, kept inside the window. */
export function view(cam: Camera | null): View {
  if (!cam) return { s: 1, tx: 0, ty: 0 };
  const s = cam.s;
  const clamp = (v: number) => Math.min(0, Math.max(100 - 100 * s, v));
  return { s, tx: clamp(50 - cam.x * s), ty: clamp(50 - cam.y * s) };
}

const lastOf = <T,>(c: Chapter, kind: Beat[1], fallback: T): T =>
  c.beats.reduce<T>((v, b) => (b[1] === kind && b[2] ? (b[2] as T) : v), fallback);
const previous = (i: number) => CHAPTERS[(i - 1 + CHAPTERS.length) % CHAPTERS.length];
const INHERIT_SHOT = CHAPTERS.map((_, i) => lastOf<Shot>(previous(i), "shot", previous(i).id as Shot));
const INHERIT_CURSOR = CHAPTERS.map((_, i) => lastOf<Point>(previous(i), "cur", { x: 92, y: 92 }));
const INHERIT_CAPTION = CHAPTERS.map((_, i) => lastOf<Caption>(previous(i), "say", previous(i).id as Caption));
/** The camera a chapter opens with: where the last camera move before it left it (the walkthrough ends on the whole App). */
const CAMERA_AFTER = CHAPTERS.reduce<(Camera | null)[]>((after, c, i) => {
  const cams = c.beats.filter((b) => b[1] === "cam");
  after.push(cams.length ? (cams.at(-1)![2] as Camera | null) : i > 0 ? after[i - 1] : null);
  return after;
}, []);
const INHERIT_VIEW = CHAPTERS.map((_, i) => view(CAMERA_AFTER[(i - 1 + CHAPTERS.length) % CHAPTERS.length]));

/** Moves a frame on by one beat that started `since` ms ago. */
function apply(f: Frame, beat: Beat, since: number) {
  const k = (dur: number) => ease(Math.min(1, since / dur));
  switch (beat[1]) {
    case "cam": {
      const a = f.view, b = view(beat[2]), e = k(beat[3]);
      f.view = { s: lerp(a.s, b.s, e), tx: lerp(a.tx, b.tx, e), ty: lerp(a.ty, b.ty, e) };
      return;
    }
    case "cur": {
      const e = k(beat[3]);
      f.cursor = { x: lerp(f.cursor.x, beat[2].x, e), y: lerp(f.cursor.y, beat[2].y, e) };
      return;
    }
    case "click":
      f.press = since < 130;
      f.ripple = since < 700 ? { ...f.cursor, k: since / 700 } : null;
      return;
    case "mark":
      if (beat[2]) { f.mark = beat[2]; f.markOn = Math.min(1, since / 350); }
      else f.markOn = Math.max(0, 1 - since / 300);
      return;
    case "shot":
      f.from = f.to; f.to = beat[2]; f.fade = Math.min(1, since / 200);
      return;
    case "say":
      f.caption = beat[2];
  }
}

export function frameAt(time: number): Frame {
  const T = ((time % DURATION) + DURATION) % DURATION;
  let i = 0;
  while (i < CHAPTERS.length - 1 && T >= STARTS[i + 1]) i++;
  const c = CHAPTERS[i];
  const t = T - STARTS[i];
  const f: Frame = { step: i, progress: t / c.dur, caption: INHERIT_CAPTION[i], view: INHERIT_VIEW[i], cursor: INHERIT_CURSOR[i], press: false, ripple: null, mark: null, markOn: 0, from: INHERIT_SHOT[i], to: INHERIT_SHOT[i], fade: 1 };
  for (const beat of c.beats) {
    if (beat[0] > t) break;
    apply(f, beat, t - beat[0]);
  }
  return f;
}

/** A step's screen at rest: with reduced motion, and what a station picks then. */
export const stillFrame = (step: number): Frame => ({
  step, progress: 0, caption: CHAPTERS[step].id as Caption, view: view(null), cursor: { x: 92, y: 92 }, press: false, ripple: null, mark: null, markOn: 0,
  from: CHAPTERS[step].id as Shot, to: CHAPTERS[step].id as Shot, fade: 1,
});

/** Where a station starts its step: as its screen comes in, after the rail click. */
export function seekTime(step: number): number {
  const shot = CHAPTERS[step].beats.find((b) => b[1] === "shot");
  return STARTS[step] + (shot ? shot[0] : 0);
}

/** Each shot's capture; all share the 50 px frame and the 1280 px App width, so one crop fits them. */
export const shotSrc = (shot: Shot, theme: "light" | "dark") => `/product/${shot}-${theme}.webp`;
export const SHOTS: Shot[] = ["discuss", "research", "plan", "outline", "implement", "verify", "review", "review-approved", "pull-request"];
