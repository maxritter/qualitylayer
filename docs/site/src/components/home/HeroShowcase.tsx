import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { Expand } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { STEP_OF_CHAPTER, WORKFLOW_STEPS } from "@/lib/steps";
import { CHAPTERS, SHOTS, shotSrc } from "@/lib/showcase";
import { ShowcasePlayer } from "@/lib/showcase-player";
import { LIVE_DEMO, PauseButton, ShowcaseCard, Stage, chapterOfStep } from "./HeroShowcaseParts";

export { LIVE_DEMO };

/** The workflow step a showcase chapter belongs to (the pull request counts after the last). */
const stepOfChapter = (chapter: number) => {
  const k = WORKFLOW_STEPS.findIndex((s) => s.id === STEP_OF_CHAPTER[CHAPTERS[chapter]?.id ?? ""]);
  return k === -1 ? WORKFLOW_STEPS.length - 1 : k;
};

/** What the hero picture shows, for screen readers; the phone picture is its question card alone. */
const SHOT_ALT = "QualityLayer’s App walking through Plan, Implement and Verify for the usage-based billing example, from the first question to the pull request.";

/** Above this width the showcase plays; a phone keeps the still question card. */
const WIDE = "(min-width: 641px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export type ShowcaseHandle = {
  /** Plays a step from its start; false when the showcase is not running (a phone), so the station's link applies. */
  seek: (step: number) => boolean;
};

/** Whether the showcase plays here: wide enough for it, and only once the page runs. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return wide;
}

/** Runs the shared clock while the showcase is live: the stations follow it, and it rests off screen. */
type Clock = { live: boolean; line: RefObject<HTMLOListElement | null>; stage: RefObject<HTMLDivElement | null>; onStep: (step: number) => void; onStop: () => void };

function useClock(player: ShowcasePlayer, { live, line, stage, onStep, onStop }: Clock) {
  const follow = useRef({ onStep, onStop });
  useEffect(() => { follow.current = { onStep, onStop }; });
  useEffect(() => {
    if (!live) { follow.current.onStop(); return; }
    const list = line.current;
    let current = -1;
    const unfollow = player.follow((s, progress) => {
      // The line runs from the first station to the last: the step playing, and how far into its chapters.
      const k = stepOfChapter(s);
      const own = CHAPTERS.map((_, i) => i).filter((i) => stepOfChapter(i) === k);
      const within = (own.indexOf(s) + Math.max(0, progress * (CHAPTERS.length - 1) - s)) / Math.max(1, own.length);
      list?.style.setProperty("--hs-p", Math.min(1, (k + within) / (WORKFLOW_STEPS.length - 1)).toFixed(4));
      if (k !== current) { current = k; follow.current.onStep(k); }
    });
    player.start(window.matchMedia(REDUCED).matches);
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) player.viewers.add("hero"); else player.viewers.delete("hero"); }, { threshold: 0.15 });
    if (stage.current) seen.observe(stage.current);
    if (new URLSearchParams(location.search).has("capture")) (window as unknown as Record<string, unknown>).__heroShowcase = player;
    return () => { player.stop(); unfollow(); seen.disconnect(); list?.style.removeProperty("--hs-p"); };
  }, [live, line, stage, player]);
}

/**
 * The hero picture: the App on its real captures, playing the three steps with a camera, a cursor
 * and highlights. Clicking it opens the same walkthrough larger in a card. The stations below
 * follow it through `onStep` and the `--hs-p` progress on their list. A phone keeps the still
 * picture, which opens the App demo.
 */
export function HeroShowcase({ ref, line, onStep }: { ref?: Ref<ShowcaseHandle>; line: RefObject<HTMLOListElement | null>; onStep: (step: number | null) => void }) {
  const { theme } = useTheme();
  const [player] = useState(() => new ShowcasePlayer());
  const live = useWide();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);

  useClock(player, { live, line, stage, onStep: (s) => { onStep(s); setStep(s); }, onStop: () => onStep(null) });

  // Fetch the other screens once the page has settled, in the theme it shows.
  useEffect(() => {
    if (!live) return;
    const preload = window.setTimeout(() => SHOTS.forEach((s) => { new Image().src = shotSrc(s, theme); }), 1200);
    return () => window.clearTimeout(preload);
  }, [live, theme]);

  useEffect(() => {
    if (open) player.viewers.add("card");
    else player.viewers.delete("card");
  }, [open, player]);

  useImperativeHandle(ref, () => ({
    seek(i) {
      if (!live) return false;
      player.seek(chapterOfStep(i));
      return true;
    },
  }), [live, player]);

  return (
    <div className="sx-pic" data-hs={live ? "" : undefined}>
      <a className="sx-live" href={LIVE_DEMO} ref={opener}
        aria-label={live ? "Watch the three steps larger" : "Try the App in your browser: the usage-based billing example, nothing to install"}
        onClick={(event) => { if (live) { event.preventDefault(); setOpen(true); } }}>
        <div className="hs-stage" ref={stage}>
          <div className="hs-win">
            <figure className="sx-shot">
              {(["light", "dark"] as const).map((t) => (
                <picture key={t} className={`sx-shot-${t}`}>
                  <source media="(max-width: 640px)" srcSet={`/hero/your-turn-${t}.webp`} width={740} height={1664} />
                  <img src={`/product/plan-${t}.webp`} alt={SHOT_ALT} width={2664} height={2024} decoding="async" />
                </picture>
              ))}
            </figure>
            {live ? <Stage player={player} theme={theme} /> : null}
          </div>
          {live ? <span className="hs-enlarge" aria-hidden="true"><Expand size={14} />Watch larger</span> : null}
        </div>
      </a>
      {live ? <PauseButton player={player} /> : null}
      {live ? <ShowcaseCard player={player} theme={theme} step={step} open={open} onOpenChange={setOpen} opener={opener} /> : null}
    </div>
  );
}
