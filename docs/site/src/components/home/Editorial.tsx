import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, BookOpen, Expand, ExternalLink, House, Shapes, SlidersHorizontal, Users, X, type LucideIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNarrow } from "@/hooks/useNarrow";
import { useTheme } from "@/hooks/useTheme";
import { FILMS } from "@/lib/films";
import { FIRST_STEP, STEPS, WHO, type Who } from "@/lib/steps";
import { scrollAndFocusSection } from "@/utils/navigateToSection";
import "@/styles/editorial.css";

type Shot = { id: string; title: string; alt: string };
type Extra = { id: string; name: string; icon: LucideIcon; line: string; text: string; shot: Shot; link: { to: string; label: string } };

const EXTRAS: Extra[] = [
  { id: "memory", name: "Memory", icon: BookOpen, line: "Keep useful project lessons", text: "Your agents reuse lessons between tasks, whichever coding agent you use. Share them per repository through Git; search or retire them in Settings.", shot: { id: "memory", title: "Project memory", alt: "The Memory settings with local lessons, per-project sharing and saved lessons, the newest from the billing task: key each meter event by its request id; illustrative project data" }, link: { to: "/docs/memory", label: "Read about project memory" } },
  { id: "artifacts", name: "Artifacts", icon: Shapes, line: "Try the screen before it is built", text: "An artifact is a mockup, diagram or clickable page your agent draws for the task, so you can try a flow before any code exists. Click a spot to say what should change; your agent edits the page and answers you. Keep the ones you reuse for later tasks.", shot: { id: "artifact", title: "Artifact", alt: "Finance's billing-mode page drawn as an artifact, with both invoices and the last switch the agent added, beside the feedback that asked for it and the agent's answer; illustrative data" }, link: { to: "/docs/artifacts", label: "Read about artifacts" } },
  { id: "team", name: "Team", icon: Users, line: "Ask the people who know", text: "Teammates answer plan questions and review the finished change from their own App.", shot: { id: "team", title: "Team", alt: "The Team space: Anna asks about a diagram in her Plan, and an agent's draft answer to Ben's question waits to be sent" }, link: { to: "/docs/team/plans", label: "Read about team collaboration" } },
  { id: "cost", name: "Home", icon: House, line: "See what needs you", text: "Your tasks that need attention and your running work, with the current step and what happens next.", shot: { id: "home", title: "Home", alt: "Home with the four tasks that need you across projects and teammates, and two agents' running work" }, link: { to: "/docs/app#home", label: "Read about Home" } },
  { id: "setup", name: "Settings", icon: SlidersHorizontal, line: "Agents, plan limits and reviewers", text: "Check your agents, see how much of each plan is left and choose who reviews your plans and changes. Pick the agent, model and effort when you start a task or build.", shot: { id: "setup", title: "Settings", alt: "Settings with its sections in the sidebar's place, showing Workflow: the task level, your instructions, the reviews and the reviewer models" }, link: { to: "/docs/reference/settings", label: "Read about settings" } },
];

const shotOf = (step: (typeof STEPS)[number]): Shot => ({ id: step.id, title: step.name, alt: step.alt });

const src = (shot: Shot, theme: "light" | "dark") => `/product/${shot.id}-${theme}.webp`;
/** The App's own phone layout, captured at 390 px, so phones get a picture they can read. */
const phoneSrc = (shot: Shot, theme: "light" | "dark") => `/product/${shot.id}-phone-${theme}.webp`;
const PHONE = "(max-width: 640px)";

/** The desktop capture, or on a phone the phone capture. In the preview dialog a failure points at its full-size link. */
function Picture({ shot, theme, eager, inDialog }: { shot: Shot; theme: "light" | "dark"; eager?: boolean; inDialog?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
    <picture>
      <source media={PHONE} srcSet={phoneSrc(shot, theme)} width={780} height={1400} />
      <img src={src(shot, theme)} alt={shot.alt} width="2240" height="1800" loading={eager || inDialog ? undefined : "lazy"} decoding="async" onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
    </picture>
    {failed ? <span className="ed-image-error">{shot.title} image unavailable. {inDialog ? "Use Full size to retry." : "Open the preview to retry."}</span> : null}
    </>
  );
}

function ImageDialog({ shot, theme, onClose, opener }: { shot: Shot; theme: "light" | "dark"; onClose: () => void; opener: HTMLElement | null }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-modal="true" className="ed-image-dialog" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); opener?.focus(); }}>
        {/* Both actions sit in the header, so on a phone neither waits below the picture. */}
        <div className="ed-dialog-header">
          <DialogTitle>{shot.title}</DialogTitle>
          <Button asChild variant="outline" size="xl"><a href={src(shot, theme)} target="_blank" rel="noopener noreferrer" aria-label="Open the full-size image"><ExternalLink size={16} aria-hidden="true" />Full size</a></Button>
          <DialogClose asChild><Button type="button" variant="outline" size="xl" aria-label="Close preview"><X size={18} aria-hidden="true" />Close</Button></DialogClose>
        </div>
        <Picture shot={shot} theme={theme} inDialog />
        <DialogDescription>{shot.id === "memory" ? "Illustrative projects in the Memory settings." : "Example task in the QualityLayer App."}</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

/** A screenshot in the flow of the text: tap or click to enlarge it. */
function Inline({ shot, theme, eager, onOpen }: { shot: Shot; theme: "light" | "dark"; eager?: boolean; onOpen: (shot: Shot, el: HTMLElement) => void }) {
  return (
    <button type="button" className="ed-frame ed-inline" aria-label={`Enlarge ${shot.title}`} onClick={(event) => onOpen(shot, event.currentTarget)}>
      <Picture shot={shot} theme={theme} eager={eager} />
      <span className="ed-enlarge"><Expand size={14} aria-hidden="true" />Enlarge</span>
    </button>
  );
}

/**
 * The seven steps and the pull request, one open at a time, Plan first. On wide screens the open step's screenshot fills
 * the pinned stage beside the list; on tablets and phones it sits inside the open step.
 */
function Tour({ active, onPick, theme, onOpen }: { active: string; onPick: (id: string) => void; theme: "light" | "dark"; onOpen: (shot: Shot, el: HTMLElement) => void }) {
  const narrow = useNarrow(1079);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const current = STEPS.find((step) => step.id === active) ?? STEPS[0];
  return (
    <div className="ed-tour">
      <ol className="ed-steps" aria-label="The seven steps and the pull request">
        {STEPS.map((step, i) => {
          const on = step.id === current.id;
          return (
            <li key={step.id} id={step.id} className={on ? "on" : undefined} data-who={step.who}>
              <div className="ed-step-row">
                <h3 className="ed-step-h">
                  <button type="button" aria-expanded={on} aria-controls={`${step.id}-more`} onClick={() => onPick(step.id)}>
                    <span className="ed-num" aria-hidden="true">{i + 1}</span>
                    <span><span className="w7-sr">Step {i + 1}: </span>{step.name}</span>
                  </button>
                </h3>
                <p className="ed-line">{step.line}</p>
              </div>
              <div id={`${step.id}-more`} className="ed-more" hidden={!on}>
                <p className="ed-text">{step.text}</p>
                <p className="ed-who"><span className="ed-dot" aria-hidden="true" />{WHO[step.who]}</p>
                {narrow && on ? <Inline shot={shotOf(step)} theme={theme} eager onOpen={onOpen} /> : null}
                <a className="ed-link" href={`/docs/steps/${step.id}`}>Read about {step.name.toLowerCase()}<ArrowRight size={16} aria-hidden="true" /></a>
              </div>
            </li>
          );
        })}
      </ol>
      {narrow ? null : (
        <div className="ed-stage">
          <div className="ed-pin">
            <button type="button" className="ed-frame" aria-label={`Enlarge ${current.name}`} onClick={(event) => onOpen(shotOf(current), event.currentTarget)}>
              {STEPS.map((step) => {
                const on = step.id === current.id;
                return <img key={step.id} className={on ? "on" : undefined} src={src(shotOf(step), theme)} alt={on ? step.alt : ""} aria-hidden={on ? undefined : true} width="2240" height="1800" loading={on ? "eager" : "lazy"} decoding="async" onError={() => setFailed(previous => new Set(previous).add(step.id))} onLoad={() => setFailed(previous => { if (!previous.has(step.id)) return previous; const next = new Set(previous); next.delete(step.id); return next; })} />;
              })}
              {failed.has(current.id) ? <span className="ed-image-error">{current.name} image unavailable. Open the preview to retry.</span> : null}
              <span className="ed-enlarge"><Expand size={14} aria-hidden="true" />Enlarge</span>
            </button>
            <p className="ed-stage-cap">Example task in the QualityLayer App.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Also in the App: five tabs, each with its text and its screen. Arrow keys, Home and End move between tabs. */
function Extras({ active, onPick, theme, onOpen }: { active: string; onPick: (id: string) => void; theme: "light" | "dark"; onOpen: (shot: Shot, el: HTMLElement) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = EXTRAS.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onPick(EXTRAS[next].id);
    tabs.current[next]?.focus();
  };
  return (
    <>
      <div className="ed-tabs" role="tablist" aria-label="Also in the App">
        {EXTRAS.map((extra, i) => {
          const on = extra.id === active;
          return (
            <button key={extra.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={extra.id} className="ed-tab" aria-selected={on} aria-controls={`${extra.id}-panel`} tabIndex={on ? 0 : -1} onClick={() => onPick(extra.id)} onKeyDown={(event) => move(event, i)}>
              <extra.icon size={18} strokeWidth={1.75} aria-hidden="true" />{extra.name}
            </button>
          );
        })}
      </div>
      {EXTRAS.map((extra) => {
        const on = extra.id === active;
        return (
          <div key={extra.id} role="tabpanel" id={`${extra.id}-panel`} aria-labelledby={extra.id} className="ed-panel" tabIndex={0} hidden={!on}>
            <div>
              <h3>{extra.line}</h3>
              <p className="ed-text">{extra.text}</p>
              <a className="ed-link" href={extra.link.to}>{extra.link.label}<ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            {on ? <Inline shot={extra.shot} theme={theme} onOpen={onOpen} /> : null}
          </div>
        );
      })}
    </>
  );
}

export default function Editorial() {
  const { theme } = useTheme();
  const [step, setStep] = useState(FIRST_STEP);
  const [extra, setExtra] = useState(EXTRAS[0].id);
  const [shown, setShown] = useState<{ shot: Shot; opener: HTMLElement } | null>(null);
  const open = (shot: Shot, opener: HTMLElement) => setShown({ shot, opener });

  // A link to a step or an App feature (the hero's stations, Teams in the header, /#review) opens it.
  // ScrollToHash brings a new hash into view; a repeated link to the same hash changes nothing there, so it scrolls here.
  const { hash, key } = useLocation();
  const last = useRef<string | null>(null);
  // A layout effect, so the step is open before ScrollToHash measures where to scroll.
  useLayoutEffect(() => {
    const id = hash.slice(1);
    const known = STEPS.some((s) => s.id === id) ? setStep : EXTRAS.some((e) => e.id === id) ? setExtra : null;
    if (known) {
      known(id);
      if (last.current === hash) requestAnimationFrame(() => scrollAndFocusSection(id));
    }
    last.current = hash;
  }, [hash, key]);

  return (
    <>
      <section id="tour" className="ed-section mx-wrap" aria-labelledby="ed-workflow-h">
        <div className="ed-head">
          <h2 id="ed-workflow-h">From prompt to pull request</h2>
          <p>Spec-driven development with a human in the loop: you approve the plan, agents build and check it, and QualityLayer follows the pull request until it merges. Engineers start from a technical plan, product people from a product brief.</p>
          <ul className="ed-legend" aria-label="Colours">
            {(Object.keys(WHO) as Who[]).map((who) => <li key={who} data-who={who}><span className="ed-dot" aria-hidden="true" />{WHO[who]}</li>)}
          </ul>
        </div>
        <Tour active={step} onPick={setStep} theme={theme} onOpen={open} />
        <div className="ed-outcome" id="films"><p>Every decision, document and test run stays with the change.</p><div><a href="/docs/">Read the workflow docs</a><a href={FILMS.overview.src} target="_blank" rel="noopener noreferrer">Watch the walkthrough</a></div></div>
      </section>
      <section id="extras" className="ed-section mx-wrap" aria-labelledby="ed-context-h">
        <div className="ed-head"><h2 id="ed-context-h">Also in the App</h2><p>Chat with Claude Code or Codex. Save a plan, build in slices, make artifacts, or ask for checks and an independent review when you need them.</p></div>
        <Extras active={extra} onPick={setExtra} theme={theme} onOpen={open} />
      </section>
      {shown ? <ImageDialog shot={shown.shot} theme={theme} opener={shown.opener} onClose={() => setShown(null)} /> : null}
    </>
  );
}
