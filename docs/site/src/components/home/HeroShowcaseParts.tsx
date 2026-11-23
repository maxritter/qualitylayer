import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { ArrowRight, Pause, Play, SquarePlay, X } from "lucide-react";
import { STEP_ICONS } from "@/lib/step-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Theme } from "@/hooks/useTheme";
import { STEP_OF_CHAPTER, STEPS, WHO, WORKFLOW_STEPS } from "@/lib/steps";
import { CHAPTERS, frameAt, shotSrc, stillFrame, type Frame } from "@/lib/showcase";
import type { ShowcasePlayer } from "@/lib/showcase-player";

/** The App demo on this site: the billing task from request to merged pull request, with a guide. */
export const LIVE_DEMO = "/app-demo/?story&guide";

/** The first chapter of a workflow step. */
export const chapterOfStep = (step: number) =>
  Math.max(0, CHAPTERS.findIndex((c) => STEP_OF_CHAPTER[c.id] === WORKFLOW_STEPS[step]?.id));

type Parts = { a: HTMLImageElement; b: HTMLImageElement; hl: HTMLDivElement; ripple: HTMLDivElement; cursor: HTMLDivElement };

function paint(cam: HTMLDivElement, p: Parts, f: Frame, theme: Theme, cursor: boolean) {
  cam.style.setProperty("--s", f.view.s.toFixed(4));
  cam.style.setProperty("--tx", f.view.tx.toFixed(3));
  cam.style.setProperty("--ty", f.view.ty.toFixed(3));
  const from = shotSrc(f.from, theme);
  const to = shotSrc(f.to, theme);
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
export function Stage({ player, theme }: { player: ShowcasePlayer; theme: Theme }) {
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
      <img className="hs-layer" ref={set("a")} alt="" src={shotSrc("plan", theme)} />
      <img className="hs-layer" ref={set("b")} alt="" src={shotSrc("plan", theme)} />
      <div className="hs-hl" ref={set("hl")} />
      <div className="hs-ripple" ref={set("ripple")} />
      <div className="hs-cursor" ref={set("cursor")}>
        <svg viewBox="0 0 22 22"><path d="M3 2.5 L3 17.5 L7.2 13.6 L10 20 L12.8 18.8 L10.1 12.5 L16 12.3 Z" /></svg>
      </div>
    </div>
  );
}

/** Under the enlarged stage: who acts in the step playing and what it does, the pull request after Verify. */
function Caption({ player }: { player: ShowcasePlayer }) {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let shown = "";
    return player.attach((tick) => {
      const id = tick.still === null ? frameAt(tick.time).caption : stillFrame(tick.still).caption;
      const step = STEPS.find((s) => s.id === STEP_OF_CHAPTER[id]);
      if (!step || !line.current || id === shown) return;
      shown = id;
      line.current.dataset.who = step.who;
      line.current.querySelector("b")!.textContent = WHO[step.who];
      line.current.querySelector("span")!.textContent = step.line;
    });
  }, [player]);
  return <p className="hs-caption" ref={line} data-who="you"><b>{WHO.you}</b><span>{STEPS[0].line}</span></p>;
}

export function PauseButton({ player }: { player: ShowcasePlayer }) {
  const playing = useSyncExternalStore(player.subscribe, player.isPlaying, () => true);
  return (
    <button type="button" className="hs-pause" onClick={() => player.setPlaying(!playing)} aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}>
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  );
}

/** The walkthrough enlarged in a card: the same moment, the steps to jump between, and the demo to try. */
export function ShowcaseCard({ player, theme, step, open, onOpenChange, opener }: { player: ShowcasePlayer; theme: Theme; step: number; open: boolean; onOpenChange: (open: boolean) => void; opener: RefObject<HTMLAnchorElement | null> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-modal="true" className="hs-card" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        <div className="hs-card-head">
          <DialogTitle>The three steps in the App</DialogTitle>
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
                <button type="button" data-who={who} aria-current={step === i ? "step" : undefined} onClick={() => player.seek(chapterOfStep(i))}>
                  <Glyph size={16} strokeWidth={1.8} aria-hidden="true" />{name}
                </button>
              </li>
            );
          })}
        </ol>
        <DialogDescription className="hs-card-note">The fictional usage-based billing example, from the first question to the pull request. In the demo you click through it yourself. <a href="https://qualitylayer-media.max-ritter.workers.dev/hero-walkthrough-v2026111301.mp4" target="_blank" rel="noopener noreferrer">Watch as video</a>.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
