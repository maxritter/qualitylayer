/**
 * The hero showcase's timeline: the App walking through the seven steps on real captures, with a
 * camera, a cursor and highlights. Every frame is a pure function of time, so a station can seek to
 * its step and a capture can render any frame. Points and rectangles are percentages of the App
 * window (the capture without its 50 px frame); a camera is a centre and a zoom.
 */

export type Shot = "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review" | "review-approved" | "pull-request";
export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };
export type Camera = Point & { s: number };
type Beat =
  | [number, "cam", Camera | null, number]
  | [number, "cur", Point, number]
  | [number, "click"]
  | [number, "mark", Rect | null]
  | [number, "shot", Shot];
export type Chapter = { id: string; dur: number; beats: Beat[] };

/** Where the App's step rail shows each step, all on one line. */
const RAIL: Record<string, number> = { discuss: 22.8, research: 30.7, plan: 38.6, outline: 46.6, implement: 54.5, verify: 62.4, review: 70.4 };
const rail = (id: string): Point => ({ x: RAIL[id], y: 8.6 });
/** The middle column at a zoom that keeps its width on screen. */
const main = (y: number): Camera => ({ x: 47, y, s: 1.8 });
/** The conversation beside it, close enough to read. */
const chat = (y: number): Camera => ({ x: 87.5, y, s: 2.2 });

/** Each chapter opens zoomed out, clicks its step on the App's rail, looks at one thing and returns. */
export const CHAPTERS: Chapter[] = [
  { id: "discuss", dur: 6600, beats: [
    [150, "cur", rail("discuss"), 600], [800, "click"], [900, "shot", "discuss"],
    // The first question, answered with its recommended option.
    [1100, "cam", main(39), 1300],
    [2500, "cur", { x: 34.4, y: 40.6 }, 800], [3400, "click"], [3500, "mark", { x: 22.2, y: 35.7, w: 50, h: 7.2 }],
    // Asking in the conversation while it waits.
    [4400, "cam", chat(60), 1100], [4500, "mark", null],
    [5700, "cam", null, 900]] },
  { id: "research", dur: 6200, beats: [
    [0, "cur", rail("research"), 650], [700, "click"], [800, "shot", "research"],
    // The map of what the change touches, the gateway every request passes, then the question about it.
    [1000, "cam", { x: 47, y: 47, s: 1.9 }, 1300],
    [2500, "mark", { x: 48.9, y: 42.5, w: 15, h: 6.1 }],
    [3600, "cam", chat(63), 1100], [3700, "mark", null],
    [4300, "mark", { x: 76.5, y: 52.2, w: 22.3, h: 5.2 }],
    [5300, "cam", null, 900], [5400, "mark", null]] },
  { id: "plan", dur: 7800, beats: [
    [0, "cur", rail("plan"), 650], [700, "click"], [800, "shot", "plan"],
    // Read the decision's diagram from the request to both outcomes.
    [1000, "cam", { x: 41, y: 55.5, s: 2.4 }, 1300],
    [2500, "cam", { x: 54, y: 55.5, s: 2.4 }, 1400],
    // The call is the person's: pick the recommended path.
    [4100, "cam", { x: 47, y: 79, s: 1.8 }, 1000],
    [4400, "cur", { x: 34.4, y: 82.7 }, 800], [5300, "click"], [5400, "mark", { x: 21.4, y: 77.5, w: 50.2, h: 7.7 }],
    [6800, "cam", null, 900], [6900, "mark", null]] },
  { id: "outline", dur: 6300, beats: [
    [0, "cur", rail("outline"), 650], [700, "click"], [800, "shot", "outline"],
    // Where the change lands, risky places flagged.
    [1000, "cam", main(31), 1200],
    [2300, "cur", { x: 65.4, y: 30.9 }, 700], [3000, "mark", { x: 20.4, y: 27.2, w: 53.1, h: 7.2 }],
    // Slices, each with a scenario for its Done means.
    [3800, "cam", chat(47), 1000], [3900, "mark", null],
    [4400, "mark", { x: 76.5, y: 35.2, w: 22.4, h: 3.4 }],
    [5300, "cam", null, 900], [5400, "mark", null]] },
  { id: "implement", dur: 6300, beats: [
    [0, "cur", rail("implement"), 650], [700, "click"], [800, "shot", "implement"],
    // One slice, task by task.
    [1000, "cam", main(29), 1200],
    [2300, "cur", { x: 39.5, y: 34.6 }, 700], [3000, "mark", { x: 23.9, y: 32.3, w: 48, h: 4.4 }],
    // Its test is written first and fails first.
    [3800, "cam", chat(49), 1000], [3900, "mark", null],
    [4400, "mark", { x: 76.5, y: 36.3, w: 22.4, h: 3.3 }],
    [5300, "cam", null, 900], [5400, "mark", null]] },
  { id: "verify", dur: 6300, beats: [
    [0, "cur", rail("verify"), 650], [700, "click"], [800, "shot", "verify"],
    // What still needs a person, then who checks the rest.
    [1000, "cam", main(29), 1200],
    [2300, "mark", { x: 21.4, y: 34.4, w: 51.1, h: 4.4 }],
    [3300, "cam", main(70), 1100], [3400, "mark", null],
    [4300, "mark", { x: 20.4, y: 68.8, w: 53.1, h: 14.4 }],
    [5300, "cam", null, 900], [5400, "mark", null]] },
  { id: "review", dur: 12000, beats: [
    [0, "cur", rail("review"), 650], [700, "click"], [800, "shot", "review"],
    // The finished change and its proof.
    [1000, "cam", main(27), 1200],
    [2200, "mark", { x: 29.1, y: 27.4, w: 14.8, h: 3.6 }],
    // Approve.
    [3200, "cam", { x: 82, y: 9, s: 2.2 }, 1000], [3300, "mark", null],
    [3500, "cur", { x: 89.4, y: 3.3 }, 800], [4400, "click"], [4550, "shot", "review-approved"],
    // Then ask for a pull request.
    [4900, "cam", main(25), 1100],
    [5600, "cur", { x: 43.6, y: 27.6 }, 800], [6500, "click"], [6600, "mark", { x: 37.4, y: 25.7, w: 12.2, h: 3.6 }],
    // The pull request's threads and checks come back to you.
    [7400, "shot", "pull-request"], [7500, "mark", null],
    [7600, "cam", main(36), 1000],
    [8500, "mark", { x: 21.9, y: 27.6, w: 50, h: 27.1 }], [8700, "cur", { x: 68.2, y: 46.8 }, 800],
    [9700, "cam", null, 1000], [9800, "mark", null]] },
];

export const DURATION = CHAPTERS.reduce((sum, c) => sum + c.dur, 0);
export const STARTS = CHAPTERS.map((_, i) => CHAPTERS.slice(0, i).reduce((sum, c) => sum + c.dur, 0));

export type View = { s: number; tx: number; ty: number };
export type Frame = {
  /** The chapter playing, and how far into it. */
  step: number;
  progress: number;
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

/**
 * The translation that centres the camera, kept inside the window. `depth` scales every zoom: a
 * large stage already shows the App big enough to read, so it zooms less and stays sharp.
 */
export function view(cam: Camera | null, depth = 1): View {
  if (!cam) return { s: 1, tx: 0, ty: 0 };
  const s = 1 + (cam.s - 1) * depth;
  const clamp = (v: number) => Math.min(0, Math.max(100 - 100 * s, v));
  return { s, tx: clamp(50 - cam.x * s), ty: clamp(50 - cam.y * s) };
}

const lastOf = <T,>(c: Chapter, kind: Beat[1], fallback: T): T =>
  c.beats.reduce<T>((v, b) => (b[1] === kind && b[2] ? (b[2] as T) : v), fallback);
const previous = (i: number) => CHAPTERS[(i - 1 + CHAPTERS.length) % CHAPTERS.length];
const INHERIT_SHOT = CHAPTERS.map((_, i) => lastOf<Shot>(previous(i), "shot", previous(i).id as Shot));
const INHERIT_CURSOR = CHAPTERS.map((_, i) => lastOf<Point>(previous(i), "cur", { x: 92, y: 92 }));

/** Moves a frame on by one beat that started `since` ms ago. */
function apply(f: Frame, beat: Beat, since: number, depth: number) {
  const k = (dur: number) => ease(Math.min(1, since / dur));
  switch (beat[1]) {
    case "cam": {
      const a = f.view, b = view(beat[2], depth), e = k(beat[3]);
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
      f.from = f.to; f.to = beat[2]; f.fade = Math.min(1, since / 320);
  }
}

export function frameAt(time: number, depth = 1): Frame {
  const T = ((time % DURATION) + DURATION) % DURATION;
  let i = 0;
  while (i < CHAPTERS.length - 1 && T >= STARTS[i + 1]) i++;
  const c = CHAPTERS[i];
  const t = T - STARTS[i];
  const f: Frame = { step: i, progress: t / c.dur, view: view(null), cursor: INHERIT_CURSOR[i], press: false, ripple: null, mark: null, markOn: 0, from: INHERIT_SHOT[i], to: INHERIT_SHOT[i], fade: 1 };
  for (const beat of c.beats) {
    if (beat[0] > t) break;
    apply(f, beat, t - beat[0], depth);
  }
  return f;
}

/** A step's screen at rest: with reduced motion, and what a station picks then. */
export const stillFrame = (step: number): Frame => ({
  step, progress: 0, view: view(null), cursor: { x: 92, y: 92 }, press: false, ripple: null, mark: null, markOn: 0,
  from: CHAPTERS[step].id as Shot, to: CHAPTERS[step].id as Shot, fade: 1,
});

/** Where a station starts its step: just before the camera moves in, after the rail click. */
export function seekTime(step: number): number {
  const firstCam = CHAPTERS[step].beats.find((b) => b[1] === "cam");
  return STARTS[step] + Math.max(0, (firstCam ? firstCam[0] : 0) - 300);
}

/** Each shot's capture; all share the 50 px frame, so one crop fits them. */
export const shotSrc = (shot: Shot, theme: "light" | "dark") =>
  shot === "plan" ? `/hero/plan-desktop-${theme}.webp` : `/product/${shot}-${theme}.webp`;
export const SHOTS: Shot[] = ["discuss", "research", "plan", "outline", "implement", "verify", "review", "review-approved", "pull-request"];
