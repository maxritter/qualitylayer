import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, Brain, Expand, ExternalLink, GitPullRequest, House, Settings, Shapes, X, type LucideIcon } from "lucide-react";
import { STEP_ICONS } from "@/lib/step-icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { OVERVIEW_VIDEO_URL } from "@/lib/videos";
import { STEPS, WHO, type Who } from "@/lib/steps";
import { scrollAndFocusSection } from "@/utils/navigateToSection";
import "@/styles/editorial.css";

type Shot = { id: string; title: string; alt: string };
/** Where the desktop crop sits in the capture, as percentages of its own box: the image's width in the frame, and how far it is moved left and up. */
type Crop = { w: string; x: string; y: string };
type Extra = { id: string; name: string; icon: LucideIcon; who: Who; line: string; text: string; shot: Shot; crop: Crop; link: { to: string; label: string } };

/** Home and Artifacts lead: they carry the product. Each desktop picture is a crop of its capture, so the interface text stays readable; Enlarge opens the whole capture. */
const EXTRAS: Extra[] = [
  { id: "cost", who: "you", name: "Home", icon: House, line: "See what needs you", text: "See waiting and running tasks, their steps and next actions.", shot: { id: "home", title: "Home", alt: "Home with two tasks that need you and two running tasks. Illustrative project data." }, crop: { w: "130.95%", x: "-20%", y: "-5.18%" }, link: { to: "/docs/app#home", label: "Read about Home" } },
  { id: "artifacts", who: "agent", name: "Artifacts", icon: Shapes, line: "Try the screen before it is built", text: "Try diagrams and clickable mockups before building. Prepare a contextual request with Ask agent.", shot: { id: "artifact", title: "Artifact", alt: "QualityLayer artifact viewer: a backend request diagram on desktop. On phones, a billing-page feedback thread shows the agent's reply. Illustrative data." }, crop: { w: "130.95%", x: "-20.18%", y: "-8.72%" }, link: { to: "/docs/artifacts", label: "Read about artifacts" } },
  { id: "memory", who: "agent", name: "Memory", icon: Brain, line: "Keep useful project lessons", text: "Reuse lessons about each project and how you work. Export project lessons to Git and restore them explicitly.", shot: { id: "memory", title: "Project memory", alt: "The Memory settings with local lessons, per-project sharing and saved lessons, the newest from the billing task: key each meter event by its request id; illustrative project data" }, crop: { w: "171.88%", x: "-21.09%", y: "-28.46%" }, link: { to: "/docs/memory", label: "Read about project memory" } },
  { id: "setup", who: "you", name: "Settings", icon: Settings, line: "Agents, plan limits and reviewers", text: "Set your workflow, permissions and instructions.", shot: { id: "setup", title: "Settings", alt: "Settings with its sections in the sidebar's place, showing Workflow: the task level, your instructions, the reviews and the reviewer models" }, crop: { w: "160.58%", x: "-19.64%", y: "-16.19%" }, link: { to: "/docs/reference/settings", label: "Read about settings" } },
];

const cropStyle = ({ w, x, y }: Crop) => ({ "--crop-w": w, "--crop-x": x, "--crop-y": y }) as CSSProperties;

const shotOf = (step: (typeof STEPS)[number]): Shot => ({ id: step.id, title: step.name, alt: step.alt });

const src = (shot: Shot, theme: "light" | "dark") => `/product/${shot.id}-${theme}.webp`;
/** The App's own phone layout, captured at 390 px, so phones get a picture they can read. */
const phoneSrc = (shot: Shot, theme: "light" | "dark") => `/product/${shot.id}-phone-${theme}.webp`;
const PHONE = "(max-width: 640px)";
const DESKTOP_HEIGHTS: Record<string, number> = { artifact: 1944, "artifacts-open": 1944, memory: 2264, "implement-start": 1664, ...Object.fromEntries(STEPS.map(({ id }) => [id, 1664])), plan: 2024 };

/** The desktop capture, or on a phone the phone capture. In the preview dialog a failure points at its full-size link. */
function Picture({ shot, theme, eager, inDialog }: { shot: Shot; theme: "light" | "dark"; eager?: boolean; inDialog?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
    <picture>
      <source media={PHONE} srcSet={phoneSrc(shot, theme)} width={shot.id === "plan" ? 680 : 836} height={shot.id === "plan" ? 282 : 1456} />
      <img src={src(shot, theme)} alt={shot.alt} width={2664} height={DESKTOP_HEIGHTS[shot.id] ?? 1496} loading={eager || inDialog ? undefined : "lazy"} decoding="async" onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
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
function Inline({ shot, theme, eager, onOpen, style }: { shot: Shot; theme: "light" | "dark"; eager?: boolean; onOpen: (shot: Shot, el: HTMLElement) => void; style?: CSSProperties }) {
  return (
    <button type="button" className="ed-frame ed-inline" style={style} aria-label={`Enlarge ${shot.title}`} onClick={(event) => onOpen(shot, event.currentTarget)}>
      <Picture shot={shot} theme={theme} eager={eager} />
      <span className="ed-enlarge"><Expand size={14} aria-hidden="true" />Enlarge</span>
    </button>
  );
}

/**
 * The three steps as the App shows them: each step's page beside what happens in it, one row a
 * step, the step track's mark and name leading each row. The pull request closes the list.
 */
function Tour({ theme, onOpen }: { theme: "light" | "dark"; onOpen: (shot: Shot, el: HTMLElement) => void }) {
  const steps = STEPS.filter((step) => step.does.length > 0);
  const pr = STEPS.find((step) => step.id === "pull-request");
  return (
    <ol className="ed-tour">
      {steps.map((step, i) => {
        const Glyph = STEP_ICONS[step.id];
        return (
          <li key={step.id} id={step.id} className="ed-step" data-who={step.who} tabIndex={-1} aria-labelledby={step.id + "-h"}>
            <div className="ed-step-copy">
              <p className="ed-step-mark"><span className="ed-step-tile" aria-hidden="true"><Glyph size={22} strokeWidth={1.7} /></span><span className="ed-step-n">Step {i + 1} of {steps.length}</span></p>
              <h3 id={step.id + "-h"}>{step.name}</h3>
              <p className="ed-text">{step.text}</p>
              <ul className="ed-does">{step.does.map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="ed-who"><span className="ed-dot" aria-hidden="true" />{step.approve ? (step.who === "you" ? "You approve" : "Agents check, then you approve") : WHO[step.who]}</p>
              <a className="ed-link" href={"/docs/steps/" + step.id}>{step.name} guide<ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            <Inline shot={shotOf(step)} theme={theme} eager={i === 0} onOpen={onOpen} />
          </li>
        );
      })}
      {pr ? (
        <li id={pr.id} className="ed-step ed-step-end" data-who={pr.who} tabIndex={-1}>
          <span className="ed-step-tile" aria-hidden="true"><GitPullRequest size={20} strokeWidth={1.7} /></span>
          <p><b>Then the {pr.name.toLowerCase()}.</b> {pr.text}</p>
          <a className="ed-link" href={"/docs/steps/" + pr.id}>{pr.name} guide<ArrowRight size={16} aria-hidden="true" /></a>
        </li>
      ) : null}
    </ol>
  );
}

/** Arrow keys step through the list (down and right forward, up and left back, wrapping); Home and End jump to its ends. */
const LIST_STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
function listTarget(key: string, i: number, count: number): number | undefined {
  if (key in LIST_STEP) return (i + LIST_STEP[key] + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

/** Also in the App: a vertical list of the local features beside one large screen (a swipeable row on phones).
    Each row names the feature and its one line; the open one adds its text and link. Arrow keys, Home and End move between rows. */
function Extras({ active, onPick, theme, onOpen }: { active: string; onPick: (id: string) => void; theme: "light" | "dark"; onOpen: (shot: Shot, el: HTMLElement) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = listTarget(event.key, i, EXTRAS.length);
    if (next === undefined) return;
    event.preventDefault();
    onPick(EXTRAS[next].id);
    tabs.current[next]?.focus();
  };
  const current = EXTRAS.find((extra) => extra.id === active) ?? EXTRAS[0];
  return (
    <div className="ax">
      <div className="ax-list" role="tablist" aria-label="Also in the App" aria-orientation="vertical">
        {EXTRAS.map((extra, i) => {
          const on = extra.id === current.id;
          return (
            <button key={extra.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={extra.id} className="ax-tab" data-who={extra.who} aria-selected={on} aria-controls="extras-panel" tabIndex={on ? 0 : -1} onClick={() => onPick(extra.id)} onKeyDown={(event) => move(event, i)}>
              <i className="ax-mark" aria-hidden="true"><extra.icon size={18} strokeWidth={1.75} /></i>
              <b>{extra.name}</b>
              <span>{extra.line}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="extras-panel" aria-labelledby={current.id} className="ax-panel">
        <div className="ax-detail">
          <p className="ed-text">{current.text}</p>
          <a className="ed-link" href={current.link.to}>{current.link.label}<ArrowRight size={16} aria-hidden="true" /></a>
        </div>
        <Inline key={current.id} shot={current.shot} theme={theme} onOpen={onOpen} style={cropStyle(current.crop)} />
      </div>
    </div>
  );
}

/** The tour, then whatever the page puts between it and Also in the App (the plan cards, the quotes and the checks), then Also in the App. */
export default function Editorial({ between }: { between?: ReactNode } = {}) {
  const { theme } = useTheme();
  const [extra, setExtra] = useState(EXTRAS[0].id);
  const [shown, setShown] = useState<{ shot: Shot; opener: HTMLElement } | null>(null);
  const open = (shot: Shot, opener: HTMLElement) => setShown({ shot, opener });

  // A link to a step or an App feature (the hero's stations and /#verify) brings it into view; a feature also opens.
  // ScrollToHash brings a new hash into view; a repeated link to the same hash changes nothing there, so it scrolls here.
  const { hash, key } = useLocation();
  const last = useRef<string | null>(null);
  // A layout effect, so the feature is open before ScrollToHash measures where to scroll.
  useLayoutEffect(() => {
    const id = hash.slice(1);
    const step = STEPS.some((s) => s.id === id);
    if (EXTRAS.some((e) => e.id === id)) setExtra(id);
    if ((step || EXTRAS.some((e) => e.id === id)) && last.current === hash) requestAnimationFrame(() => scrollAndFocusSection(id));
    last.current = hash;
  }, [hash, key]);

  return (
    <>
      <section id="tour" className="ed-section mx-wrap" aria-labelledby="ed-workflow-h">
        <div className="ed-head">
          <h2 id="ed-workflow-h">Three steps, two approvals</h2>
          <p>You plan and you verify; agents do everything between. Each step is one page in the App and one Markdown file in your repository. Add your own checks, tools and skills to any step. <a href="/docs/required-lines">Set your requirements</a>.</p>
          <ul className="ed-legend" aria-label="Colours">
            {(Object.keys(WHO) as Who[]).map((who) => <li key={who} data-who={who}><span className="ed-dot" aria-hidden="true" />{WHO[who]}</li>)}
          </ul>
        </div>
        <Tour theme={theme} onOpen={open} />
        <div className="ed-outcome" id="films"><p>Every decision, document and test run stays with the change.</p><div><a href="/docs/">Read the workflow docs</a><a href={OVERVIEW_VIDEO_URL} target="_blank" rel="noopener noreferrer">Watch the walkthrough</a></div></div>
      </section>
      {between}
      <section id="extras" className="ed-section mx-wrap" aria-labelledby="ed-context-h" data-screen-label="Also in the App">
        <div className="ed-head"><h2 id="ed-context-h">Also in the App</h2><p>See what needs you, try designs and keep project lessons.</p></div>
        <Extras active={extra} onPick={setExtra} theme={theme} onOpen={open} />
      </section>
      {shown ? <ImageDialog shot={shown.shot} theme={theme} opener={shown.opener} onClose={() => setShown(null)} /> : null}
    </>
  );
}
