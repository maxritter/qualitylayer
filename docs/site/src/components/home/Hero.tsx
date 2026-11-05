import { ArrowRight, Download, MonitorPlay, SquarePlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useCallback, useRef, useState, type MouseEvent, type RefObject } from "react";
import { HeroShowcase, LIVE_DEMO, type ShowcaseHandle } from "./HeroShowcase";
import { STEP_ICONS } from "@/lib/step-icons";

export { LIVE_DEMO };
import { useDownload } from "@/hooks/useDownload";
import { FILMS } from "@/lib/films";
import { OVERVIEW_VIDEO_URL } from "@/lib/videos";
import { BRAND_LINE, DEEP_DIVE, DESCRIPTION, LEDE_LEAD, LEDE_REST, SLOGAN } from "@/lib/product";
import { AgentName, HeroGrid, OsMarks } from "./HeroTouches";
import { DEEP_DIVE_MINUTES, DEEP_DIVE_VIDEO_URL } from "@/lib/deep-dive";
import { FIRST_STEP, WORKFLOW_STEPS } from "@/lib/steps";


const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The seven steps as one line of equal stations. Beside the showcase they follow it: the playing
 * step is current, the line fills as it plays, and a station plays its step. On a phone (no
 * showcase) each station opens its step in the tour below, as a router link.
 */
function Stations({ active, onPick, line }: { active: number | null; onPick: (step: number, e: MouseEvent) => void; line: RefObject<HTMLOListElement | null> }) {
  return (
    <nav className="mx-line" aria-label="The seven steps">
      <ol className="mx-stations" ref={line} data-hs={active === null ? undefined : ""}>
        {WORKFLOW_STEPS.map(({ id, name, line, who }, i) => {
          const Glyph = STEP_ICONS[id];
          return (
            <li key={id}>
              <Link className="mx-station" data-who={who} to={`#${id}`} aria-current={active === i ? "step" : undefined} onClick={(e) => onPick(i, e)}>
                <span className="mx-station-tile" aria-hidden="true"><Glyph size={28} strokeWidth={1.6} /></span>
                <span className="mx-station-text">
                  <span className="mx-station-name"><span className="mx-station-n" aria-hidden="true">{i + 1}</span>{name}</span>
                  <span className="mx-station-line">{line}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mx-line-cap">
        <p>You approve the plan and the result. Agents build and check the change.</p>
        <Link className="mx-line-link" to={`#${FIRST_STEP}`}>See each step in the App<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </nav>
  );
}

/** Opens on the brand line, the slogan and its working action (the visitor's own download and the film on YouTube), beside the App playing the seven steps. */
const Hero = () => {
  const download = useDownload();
  const showcase = useRef<ShowcaseHandle>(null);
  const line = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState<number | null>(null);
  const pick = useCallback((i: number, e: MouseEvent) => { if (showcase.current?.seek(i)) e.preventDefault(); }, []);
  return (
    <section className="sx-hero" id="top" aria-labelledby="hero-h">
      <HeroGrid />
      <div className="sx-hero-row">
        <div className="sx-hero-copy">
          <p className="mx-qbd"><span aria-hidden="true" className="w7-mark" />{BRAND_LINE}</p>
          <h1 id="hero-h" className="sx-h1">{SLOGAN.split(/\b(you)\b/).map((part, i) => part === "you" ? <span className="sx-human" key={i}>{part}</span> : part)}</h1>
          <p className="sx-lede"><span className="sr-only">{DESCRIPTION}</span><span aria-hidden="true"><span className="sx-lead">{LEDE_LEAD}<br /><AgentName />.</span><span className="sx-lede-rest">{LEDE_REST}</span></span></p>
          <div className="sx-ctas">
            <Button asChild size="xl">{download.direct ? <a href={download.href}><Download size={18} aria-hidden="true" />{download.label}</a> : <Link to={download.href}><Download size={18} aria-hidden="true" />{download.label}</Link>}</Button>
            <Button asChild variant="outline" size="xl">
              <a href={OVERVIEW_VIDEO_URL} target="_blank" rel="noopener noreferrer" aria-label={`Watch the film on YouTube, ${clock(FILMS.overview.duration)}`}>
                <svg className="mx-play" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z" /></svg>
                Watch the film <span className="mx-dur">{clock(FILMS.overview.duration)}</span>
              </a>
            </Button>
            {DEEP_DIVE_VIDEO_URL ? <Button asChild variant="outline" size="xl"><Link to={DEEP_DIVE.href} aria-label={`${DEEP_DIVE.title}, a ${DEEP_DIVE_MINUTES}-minute deep dive`}><MonitorPlay size={18} aria-hidden="true" />{DEEP_DIVE.label} <span className="mx-dur">{DEEP_DIVE_MINUTES} min</span></Link></Button> : null}
            <Button asChild variant="outline" size="xl"><a href={LIVE_DEMO} aria-label="Try the demo in your browser"><SquarePlay size={18} aria-hidden="true" />Try the demo<ArrowRight size={16} aria-hidden="true" /></a></Button>
          </div>
          <p className="sx-meta"><OsMarks />Runs on your computer · <Link to="/download">macOS, Windows and Linux</Link></p>
        </div>
        <HeroShowcase ref={showcase} line={line} onStep={setStep} />
      </div>
      <Stations active={step} onPick={pick} line={line} />
    </section>
  );
};

export default Hero;
