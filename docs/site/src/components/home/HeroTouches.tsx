import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { OS_MARKS } from "@/lib/os-marks";
import { SHOWN_AGENTS } from "@/lib/shown-agents";

const REDUCED = "(prefers-reduced-motion: reduce)";
/** Effects that measure before paint on the client and do nothing while the page is prerendered. */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The hero line's last words: one agent's name after another, each letter fading in and the
 * underline sliding to the new width. Screen readers get the sentence's own words instead.
 * With reduced motion the first name stays.
 */
export function AgentName() {
  const [on, setOn] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (window.matchMedia(REDUCED).matches) return;
    const timer = window.setInterval(() => setOn((i) => (i + 1) % SHOWN_AGENTS.length), 2400);
    return () => window.clearInterval(timer);
  }, []);
  useMeasure(() => {
    const word = box.current?.children[on] as HTMLElement | undefined;
    if (box.current && word) box.current.style.width = `${word.offsetWidth}px`;
  }, [on]);
  return (
    <span className="sx-agent" ref={box} aria-hidden="true">
      {SHOWN_AGENTS.map(([label], i) => (
        <span key={label} className="sx-agent-word" data-on={i === on ? "" : undefined}>
          {Array.from(label).map((ch, n) => <span key={n} style={{ "--i": n } as CSSProperties}>{ch === " " ? "\u00a0" : ch}</span>)}
        </span>
      ))}
    </span>
  );
}

const COLS = 24, ROWS = 8;

/**
 * A soft grid behind the hero, fading out downwards. A cell lights under the pointer, and every
 * few seconds a ripple crosses the grid from a random cell. With reduced motion it stays still.
 */
export function HeroGrid() {
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia(REDUCED).matches) return;
    const cells = Array.from(grid.current?.querySelectorAll("i") ?? []);
    let timer = 0;
    const ripple = () => {
      const c0 = Math.floor(Math.random() * COLS), r0 = Math.floor(Math.random() * ROWS);
      cells.forEach((cell, n) => {
        cell.style.setProperty("--d", `${Math.round(Math.hypot((n % COLS) - c0, Math.floor(n / COLS) - r0) * 55)}ms`);
        cell.classList.remove("sx-ripple");
      });
      void grid.current?.offsetWidth;
      cells.forEach((cell) => cell.classList.add("sx-ripple"));
      timer = window.setTimeout(ripple, 7000);
    };
    timer = window.setTimeout(ripple, 1800);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="sx-grid" ref={grid} aria-hidden="true">
      <div className="sx-grid-cells">{Array.from({ length: COLS * ROWS }, (_, i) => <i key={i} />)}</div>
    </div>
  );
}

/** The three systems' marks, in the text colour. */
export function OsMarks() {
  return (
    <span className="sx-os" aria-hidden="true">
      {Object.values(OS_MARKS).map((os) => (
        <svg key={os.label} viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d={os.d} /></svg>
      ))}
    </span>
  );
}
