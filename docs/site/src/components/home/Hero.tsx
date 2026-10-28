import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Code, Download, FileCheck, ListChecks, MessageSquare, Network, Search, ShieldCheck, SquarePlay, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useDownload } from "@/hooks/useDownload";
import { FILMS } from "@/lib/films";
import { OVERVIEW_POSTERS } from "@/lib/film-posters";
import { useTheme } from "@/hooks/useTheme";
import { BRAND_LINE, DESCRIPTION, SLOGAN, WEBINAR } from "@/lib/product";
import { FIRST_STEP, WORKFLOW_STEPS } from "@/lib/steps";

const STEP_ICONS: Record<string, LucideIcon> = { discuss: MessageSquare, research: Search, plan: Network, outline: ListChecks, implement: Code, verify: ShieldCheck, review: FileCheck };

/** What the hero picture shows, for screen readers; the phone picture is its question card alone. */
const SHOT_ALT = "QualityLayer’s Plan asks what happens when a customer reaches their limit. A diagram compares billing overages with blocking requests; Claude Code waits beside it.";

/** The App demo on this site: the billing task from request to merged pull request, with a guide. */
export const LIVE_DEMO = "/app-demo/?story&guide";

/**
 * The current Plan and agent at 2x from the App demo. Phones keep the focused decision;
 * the full window opens the same demo as the hero action.
 */
function HeroShot() {
  return (
    <div className="sx-pic">
      <a className="sx-live" href={LIVE_DEMO} aria-label="Try the App in your browser: the usage-based billing example, nothing to install">
        <figure className="sx-shot">
          {(["light", "dark"] as const).map((theme) => (
            <picture key={theme} className={`sx-shot-${theme}`}>
              <source media="(max-width: 640px)" srcSet={`/hero/your-turn-${theme}.webp`} width={724} height={609} />
              <img src={`/product/plan-${theme}.webp`} alt={SHOT_ALT} width={2560} height={1392} decoding="async" />
            </picture>
          ))}
        </figure>
      </a>
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The film, opened over the page from the hero. Escape or Close puts focus back on the button that opened it. */
function FilmDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const film = FILMS.overview;
  const { theme } = useTheme();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // showModal focuses the first control, the video, whose focus ring framed the film; Close takes focus instead.
    close.current?.focus();
  }, []);
  return (
    <dialog ref={ref} className="mx-filmov" aria-label={`How QualityLayer works, ${clock(film.duration)}`} onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}>
      <div className="mx-filmbox">
        {/* The film shows its narration as captions, and chapter titles beside the App. */}
        <video src={film.src} poster={OVERVIEW_POSTERS[theme]} controls autoPlay playsInline preload="auto" />
      </div>
      <Button type="button" variant="outline" size="xl" ref={close} className="mx-filmx" onClick={() => ref.current?.close()}>Close</Button>
    </dialog>
  );
}

/**
 * The seven steps as one line of equal stations, a pulse running along it. Each station opens its
 * step in the tour below; a router link, so picking the same step again still selects it.
 */
function Stations() {
  return (
    <nav className="mx-line" aria-label="The seven steps">
      <ol className="mx-stations">
        {WORKFLOW_STEPS.map(({ id, name, line }, i) => {
          const Glyph = STEP_ICONS[id];
          return (
            <li key={id}>
              <Link className="mx-station" to={`#${id}`}>
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
        <p><strong>Seven steps for Feature and Bugfix.</strong> You approve the plan and the result. Agents build and check the change.</p>
        <Link className="mx-line-link" to={`#${FIRST_STEP}`}>See each step in the App<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </nav>
  );
}

/** Opens on the brand line, the slogan and its working action (the visitor's own download and the film), beside the App at a decision. */
const Hero = () => {
  const download = useDownload();
  const [film, setFilm] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <section className="sx-hero" id="top" aria-labelledby="hero-h">
      <div className="sx-hero-row">
        <div className="sx-hero-copy">
          <p className="mx-qbd"><span aria-hidden="true" className="w7-mark" />{BRAND_LINE}</p>
          <h1 id="hero-h" className="sx-h1">{SLOGAN.split(/\b(you)\b/).map((part, i) => part === "you" ? <span className="sx-human" key={i}>{part}</span> : part)}</h1>
          <p className="sx-lede">{DESCRIPTION}</p>
          <div className="sx-ctas">
            <Button asChild size="xl">{download.direct ? <a href={download.href}><Download size={18} aria-hidden="true" />{download.label}</a> : <Link to={download.href}><Download size={18} aria-hidden="true" />{download.label}</Link>}</Button>
            <Button ref={opener} type="button" variant="outline" size="xl" onClick={() => setFilm(true)}>
              <svg className="mx-play" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z" /></svg>
              Watch the film <span className="mx-dur">{clock(FILMS.overview.duration)}</span>
            </Button>
            <Button asChild variant="outline" size="xl"><a href={LIVE_DEMO} aria-label="Try the demo in your browser"><SquarePlay size={18} aria-hidden="true" />Try the demo<ArrowRight size={16} aria-hidden="true" /></a></Button>
            <Button asChild variant="outline" size="xl"><a href={WEBINAR.href} target="_blank" rel="noopener noreferrer" aria-label={`Join the ${WEBINAR.title} webinar`}><CalendarDays size={18} aria-hidden="true" />{WEBINAR.label}</a></Button>
          </div>
          <p className="sx-meta">Runs on your computer · <Link to="/download">macOS, Windows and Linux</Link></p>
        </div>
        <HeroShot />
      </div>
      <Stations />
      {film ? <FilmDialog onClose={() => { setFilm(false); opener.current?.focus(); }} /> : null}
    </section>
  );
};

export default Hero;
