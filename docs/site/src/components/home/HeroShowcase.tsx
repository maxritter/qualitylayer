import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref, type RefObject } from "react";
import { ArrowRight, Expand, Pause, Play, SquarePlay, X } from "lucide-react";
import { STEP_ICONS } from "@/lib/step-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { STEPS, WHO, WORKFLOW_STEPS } from "@/lib/steps";
import { SHOTS, frameAt, shotSrc, stillFrame, type Frame } from "@/lib/showcase";
import { ShowcasePlayer } from "@/lib/showcase-player";

/** The App demo on this site: the billing task from request to merged pull request, with a guide. */
export const LIVE_DEMO = "/app-demo/?story&guide";

/** What the hero picture shows, for screen readers; the phone picture is its question card alone. */
const SHOT_ALT = "QualityLayer’s App walking through the seven steps of the usage-based billing example, from the first question to the pull request.";

/** Above this width the showcase plays; a phone keeps the still question card. */
const WIDE = "(min-width: 641px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export type ShowcaseHandle = {
  /** Plays a step from its start; false when the showcase is not running (a phone), so the station's link applies. */
  seek: (step: number) => boolean;
};

type Parts = { a: HTMLImageElement; b: HTMLImageElement; hl: HTMLDivElement; ripple: HTMLDivElement; cursor: HTMLDivElement };

function paint(cam: HTMLDivElement, p: Parts, f: Frame, theme: Theme, cursor: boolean) {
  cam.style.setProperty("--s", f.view.s.toFixed(4));
  cam.style.setProperty("--tx", f.view.tx.toFixed(3));
  cam.style.setProperty("--ty", f.view.ty.toFixed(3));
  const from = shotSrc(f.from, theme), to = shotSrc(f.to, theme);
  if (p.a.getAttribute("src") !== from) p.a.src = from;
  if (p.b.getAttribute("src") !== to) p.b.src = to;
  p.b.style.opacity = f.fade.toFixed(3);
  const cu = p.cursor.style;
  cu.display = cursor ? "" : "none";
  cu.left = `${f.cursor.x}%`;
  cu.top = `${f.cursor.y}%`;
  cu.setProperty("--k", f.press ? ".82" : "1");
  const r = p.ripple.style;
  r.opacity = f.ripple && cursor ? (0.9 * (1 - f.ripple.k)).toFixed(3) : "0";
  if (f.ripple) {
    r.left = `${f.ripple.x}%`;
    r.top = `${f.ripple.y}%`;
    r.setProperty("--r", (0.2 + 1.05 * f.ripple.k).toFixed(3));
  }
  const h = p.hl.style;
  if (f.mark) {
    h.left = `${f.mark.x}%`;
    h.top = `${f.mark.y}%`;
    h.width = `${f.mark.w}%`;
    h.height = `${f.mark.h}%`;
  }
  h.opacity = f.markOn.toFixed(3);
  h.setProperty("--m", (1 + 0.04 * (1 - f.markOn)).toFixed(4));
}

/** The camera, the App's screens, the cursor and the highlight, drawn from the shared clock each frame. */
function Stage({ player, theme }: { player: ShowcasePlayer; theme: Theme }) {
  const cam = useRef<HTMLDivElement>(null);
  const parts = useRef<Partial<Parts>>({});
  const shown = useRef(theme);
  useEffect(() => { shown.current = theme; player.paint(); }, [theme, player]);
  useEffect(() => {
    const el = cam.current!;
    return player.attach((tick) => {
      const f = tick.still === null ? frameAt(tick.time) : stillFrame(tick.still);
      paint(el, parts.current as Parts, f, shown.current, tick.still === null);
    });
  }, [player]);
  const set = <K extends keyof Parts>(key: K) => (node: Parts[K] | null) => { if (node) parts.current[key] = node; };
  return (
    <div className="hs-cam" ref={cam} aria-hidden="true">
      <img className="hs-layer" ref={set("a")} alt="" src={shotSrc("discuss", theme)} />
      <img className="hs-layer" ref={set("b")} alt="" src={shotSrc("discuss", theme)} />
      <div className="hs-hl" ref={set("hl")} />
      <div className="hs-ripple" ref={set("ripple")} />
      <div className="hs-cursor" ref={set("cursor")}>
        <svg viewBox="0 0 22 22"><path d="M3 2.5 L3 17.5 L7.2 13.6 L10 20 L12.8 18.8 L10.1 12.5 L16 12.3 Z" /></svg>
      </div>
    </div>
  );
}

/** Under the enlarged stage: who acts in the step playing and what it does, the pull request after Review. */
function Caption({ player }: { player: ShowcasePlayer }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let shown = "";
    return player.attach((tick) => {
      const id = tick.still === null ? frameAt(tick.time).caption : stillFrame(tick.still).caption;
      const step = STEPS.find((s) => s.id === id);
      if (!step || !line.current || id === shown) return;
      shown = id;
      line.current.dataset.who = step.who;
      line.current.querySelector("b")!.textContent = WHO[step.who];
      line.current.querySelector("span")!.textContent = step.line;
    });
  }, [player]);
  return <p className="hs-caption" ref={line} data-who="you"><b>{WHO.you}</b><span>{STEPS[0].line}</span></p>;
}

function PauseButton({ player }: { player: ShowcasePlayer }) {
  const playing = useSyncExternalStore(player.subscribe, player.isPlaying, () => true);
  return (
    <button type="button" className="hs-pause" onClick={() => player.setPlaying(!playing)} aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}>
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  );
}

/** The walkthrough enlarged in a card: the same moment, the steps to jump between, and the demo to try. */
function ShowcaseCard({ player, theme, step, open, onOpenChange, opener }: { player: ShowcasePlayer; theme: Theme; step: number; open: boolean; onOpenChange: (open: boolean) => void; opener: RefObject<HTMLAnchorElement | null> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-modal="true" className="hs-card" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        <div className="hs-card-head">
          <DialogTitle>The seven steps in the App</DialogTitle>
          <Button asChild size="xl"><a href={LIVE_DEMO}><SquarePlay size={18} aria-hidden="true" />Try it yourself<ArrowRight size={16} aria-hidden="true" /></a></Button>
          <DialogClose asChild><Button type="button" variant="outline" size="xl" aria-label="Close the walkthrough"><X size={18} aria-hidden="true" />Close</Button></DialogClose>
        </div>
        <div className="hs-stage hs-stage-card">
          <div className="hs-win"><Stage player={player} theme={theme} /></div>
          <PauseButton player={player} />
        </div>
        <Caption player={player} />
        <ol className="hs-steps" aria-label="Play a step">
          {WORKFLOW_STEPS.map(({ id, name, who }, i) => {
            const Glyph = STEP_ICONS[id];
            return (
              <li key={id}>
                <button type="button" data-who={who} aria-current={step === i ? "step" : undefined} onClick={() => player.seek(i)}>
                  <Glyph size={16} strokeWidth={1.8} aria-hidden="true" />{name}
                </button>
              </li>
            );
          })}
        </ol>
        <DialogDescription className="hs-card-note">The usage-based billing example, from the first question to the pull request. In the demo you click through it yourself.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

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
      list?.style.setProperty("--hs-p", progress.toFixed(4));
      if (s !== current) { current = s; follow.current.onStep(s); }
    });
    player.start(window.matchMedia(REDUCED).matches);
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) player.viewers.add("hero"); else player.viewers.delete("hero"); }, { threshold: 0.15 });
    if (stage.current) seen.observe(stage.current);
    if (new URLSearchParams(location.search).has("capture")) (window as unknown as Record<string, unknown>).__heroShowcase = player;
    return () => { player.stop(); unfollow(); seen.disconnect(); list?.style.removeProperty("--hs-p"); };
  }, [live, line, stage, player]);
}

/**
 * The hero picture: the App on its real captures, playing the seven steps with a camera, a cursor
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
      player.seek(i);
      return true;
    },
  }), [live, player]);

  return (
    <div className="sx-pic" data-hs={live ? "" : undefined}>
      <a className="sx-live" href={LIVE_DEMO} ref={opener}
        aria-label={live ? "Watch the seven steps larger" : "Try the App in your browser: the usage-based billing example, nothing to install"}
        onClick={(event) => { if (live) { event.preventDefault(); setOpen(true); } }}>
        <div className="hs-stage" ref={stage}>
          <div className="hs-win">
            <figure className="sx-shot">
              {(["light", "dark"] as const).map((t) => (
                <picture key={t} className={`sx-shot-${t}`}>
                  <source media="(max-width: 640px)" srcSet={`/hero/your-turn-${t}.webp`} width={740} height={1996} />
                  <img src={`/product/discuss-${t}.webp`} alt={SHOT_ALT} width={2664} height={1664} decoding="async" />
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
