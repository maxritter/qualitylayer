import { CHAPTERS, DURATION, frameAt, seekTime } from "./showcase";

/** What a stage needs to draw one frame: the time, or the step at rest when motion is reduced. */
export type Tick = { time: number; still: number | null };

/**
 * One clock for the showcase, shared by the hero picture and its enlarged card, so both show the
 * same moment. It runs while someone can see a stage and the tab is visible; stages and the
 * stations subscribe to each frame.
 */
export class ShowcasePlayer {
  readonly duration = DURATION;
  time = 1250;
  playing = true;
  reduced = false;
  /** Who can see a stage right now (the hero on screen, the card open). */
  readonly viewers = new Set<string>();
  private stillAt = 0;
  private last = 0;
  private raf = 0;
  private readonly stages = new Set<(tick: Tick) => void>();
  private readonly listeners = new Set<() => void>();
  private onStep: (step: number, progress: number) => void = () => {};

  start(reduced: boolean) {
    this.reduced = reduced;
    this.playing = !reduced;
    this.emit();
    const loop = (now: number) => {
      const dt = this.last ? Math.min(64, now - this.last) : 0;
      this.last = now;
      if (this.playing && this.viewers.size && !document.hidden) this.time += dt;
      this.paint();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.last = 0; }

  /** Draws every stage now, also when paused (a capture or a seek). */
  paint() {
    const tick: Tick = { time: this.time, still: this.reduced ? this.stillAt : null };
    for (const draw of this.stages) draw(tick);
    const f = frameAt(this.time);
    const step = tick.still ?? f.step;
    const progress = Math.min(1, (step + (tick.still === null ? f.progress : 0)) / (CHAPTERS.length - 1));
    this.onStep(step, progress);
  }

  /** Follows the playing step and how far the walkthrough is (0 to 1). */
  follow(listener: (step: number, progress: number) => void) {
    this.onStep = listener;
    return () => { this.onStep = () => {}; };
  }

  attach(draw: (tick: Tick) => void) {
    this.stages.add(draw);
    draw({ time: this.time, still: this.reduced ? this.stillAt : null });
    return () => { this.stages.delete(draw); };
  }

  seek(step: number) {
    this.time = seekTime(step);
    this.stillAt = step;
    if (!this.reduced) this.setPlaying(true);
    this.paint();
  }

  render(time: number) { this.setPlaying(false); this.time = ((time % DURATION) + DURATION) % DURATION; this.paint(); }

  setPlaying(on: boolean) { this.playing = on; this.emit(); }

  /** For React: re-render when play or pause changes. */
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isPlaying = () => this.playing;
  private emit() { for (const l of this.listeners) l(); }
}
