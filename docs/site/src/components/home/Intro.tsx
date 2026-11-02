/** After the hero: the agents QualityLayer works with, the models you already pay for, the skills it adds to them, what it adds, people's words, and where it runs. */
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, BadgeCheck, FileText, KeyRound, Laptop, MessageCircle, Palette, ShieldCheck, SquareTerminal, Users, Workflow } from "lucide-react";
import type { NativeAgent } from "@ql/core/agents/ids";
import { AGENT_LOGOS } from "@ql/ui/kit/marks/agent-logos";
import { CHAT_GUIDANCE, ENGINEER_QUOTE, USER_QUOTE } from "@/lib/product";
import { Component, lazy, Suspense, type ReactNode } from "react";

const ChangeMapDemo = lazy(() => import("./ChangeMapDemo"));

/** The example map loads on its own; if it cannot load (offline, a stale chunk), the frame says so and the page stays. */
class MapGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="cm-wait cm-failed">The example map could not load. Reload the page to try again.</p> : this.props.children;
  }
}

type Chip = [label: string, icon: string];

/** The eight agents the grid shows, most used first: two columns, so an even count. */
const SHOWN: [label: string, agent: NativeAgent][] = [
  ["Claude Code", "claude-code"],
  ["Codex", "codex"],
  ["Cursor", "cursor"],
  ["Antigravity", "antigravity"],
  ["Pi", "pi"],
  ["OpenCode", "opencode"],
  ["Grok", "grok"],
  ["GitHub Copilot", "copilot"],
];

/** An agent's own logo, drawn as the App's AgentMark draws it; only the drawings are imported, not the agent registry. */
const Logo = ({ agent }: { agent: NativeAgent }) => {
  const logo = AGENT_LOGOS[agent];
  return (
    <span className="mx-logo" data-agent={agent} aria-hidden="true">
      <svg viewBox={logo.viewBox} focusable="false">
        {logo.paths.map((path) => <path key={path.d} d={path.d} fill="currentColor" fillRule={path.fillRule} opacity={path.soft ? 0.32 : undefined} />)}
      </svg>
    </span>
  );
};

const AGENTS: Chip[] = [
  ["Claude Code", "ast"],
  ["Codex", "braces"],
  ["Cursor", "code"],
  ["Grok", "term"],
  ["Antigravity", "term"],
  ["Pi", "term"],
  ["OpenCode", "term"],
  ["GitHub Copilot", "term"],
];

const MODELS: Chip[] = [
  ["Opus 5.5", "cpu"],
  ["Sonnet 5.5", "cpu"],
  ["Fable 5.1", "cpu"],
  ["Haiku 5.5", "cpu"],
  ["GPT-6.1 Sol", "cpu"],
  ["Grok 4.7", "cpu"],
  ["Gemini 3.8 Flash", "cpu"],
  ...AGENTS,
];

const SETUPS: Chip[] = [
  ["Opus 5.5 builds it", "term"],
  ["Subagents when useful", "file"],
  ["Codex reads the plan", "braces"],
  ["Claude Code reads the plan", "ast"],
  ["Or one agent does every step", "term"],
];

/** Each card in the App's colours: blue for the agent's work, amber for your decision, violet for what agents checked. */
const PRINCIPLES: { who: "agent" | "you" | "check"; icon: LucideIcon; title: string; lead: string; text: string }[] = [
  { who: "agent", icon: SquareTerminal, title: "Your agent", lead: "The tools you already use", text: "Keep your existing login or API key." },
  { who: "you", icon: Workflow, title: "One plan", lead: "Approved by you before any code", text: "Comment on change maps, diagrams and clickable mockups." },
  { who: "check", icon: BadgeCheck, title: "Proof", lead: "Independent review", text: "A separate agent checks the result against your plan." },
];

/** From where you work to the files you keep: what QualityLayer connects, all inside one dashed frame, your computer. */
const CHAIN: { icon: LucideIcon | "mark"; title: string; text: string; chips: string[]; ql?: true }[] = [
  { icon: Laptop, title: "Where you work", text: "Your task on the left, your agent on the right.", chips: ["QualityLayer App", "Browser"] },
  { icon: KeyRound, title: "Your agent, your subscription", text: "On the plan or API key you already pay for.", chips: AGENTS.map(([label]) => label) },
  { icon: "mark", title: "QualityLayer", text: "Plan, answer and review beside your agent. The CLI connects any other agent.", chips: ["Visual plans", "Conversation"], ql: true },
  { icon: FileText, title: "Your repository", text: "Every step is a Markdown file you can read, diff and commit.", chips: ["Plan", "Decisions", "Test runs"] },
];

/** The other skills, each with something a person would say to their agent (Max approved the section, 2 November 2026). */
const SKILLS: { icon: LucideIcon; title: string; ask: string }[] = [
  { icon: Workflow, title: "Plan and build", ask: "Using QualityLayer, add rate limits to the export API." },
  { icon: MessageCircle, title: "Chat", ask: "Using QualityLayer, chat about the billing refactor." },
  { icon: Palette, title: "Designs", ask: "Open the settings design in my browser." },
  { icon: ShieldCheck, title: "Security", ask: "Scan this repository for leaked secrets." },
  { icon: Users, title: "Sharing", ask: "Share this task with my team." },
];

type Line = { kind: "you" | "did"; text: string } | { kind: "msg"; from: NativeAgent; label: string; verdict?: string; text: string };

/** An example exchange between two agent sessions, labelled as an example on the page. */
const EXCHANGE: { agent: NativeAgent; name: string; lines: Line[] }[] = [
  {
    agent: "claude-code",
    name: "Claude Code",
    lines: [
      { kind: "you", text: "Ask Codex to review what you just built." },
      { kind: "did", text: "Sent the rate-limit change to Codex." },
      { kind: "msg", from: "codex", label: "from Codex", verdict: "REVISE: 2 items", text: "The limit resets per process, not per account." },
      { kind: "did", text: "Fixing both items." },
    ],
  },
  {
    agent: "codex",
    name: "Codex",
    lines: [
      { kind: "msg", from: "claude-code", label: "from Claude Code", text: "Please review the rate-limit change on feat/export-limits." },
      { kind: "did", text: "Read the change and ran its tests." },
      { kind: "msg", from: "codex", label: "to Claude Code", verdict: "REVISE: 2 items", text: "The limit resets per process, not per account." },
    ],
  },
];

const Session = ({ agent, name, lines }: (typeof EXCHANGE)[number]) => (
  <div className="sk-win" data-agent={agent}>
    <div className="sk-bar"><span className="sk-logo"><Logo agent={agent} /></span><b>{name}</b><span className="sk-path">export-api</span></div>
    <ol className="sk-log">
      {lines.map((line) => line.kind === "msg" ? (
        <li key={line.label + line.text} className="sk-msg" data-from={line.from}><small>{line.label}</small>{line.verdict ? <span className="sk-verdict">{line.verdict}</span> : null}{line.text}</li>
      ) : (
        <li key={line.text} className={`sk-${line.kind}`}>{line.text}</li>
      ))}
    </ol>
  </div>
);

const Icon = ({ name }: { name: string }) => <i className={`mx-ic mx-i-${name}`} aria-hidden="true" />;

/** One drifting row. The chips are listed twice so the loop has no seam; screen readers get the sentence beside it instead. */
const Track = ({ chips, reverse }: { chips: Chip[]; reverse?: boolean }) => (
  <div className={reverse ? "mx-track rev" : "mx-track"}>
    {[...chips, ...chips].map(([label, icon], i) => (
      <span key={`${label}-${i}`} className="mx-chip">
        <Icon name={icon} />
        {label}
      </span>
    ))}
  </div>
);

export default function Intro() {
  return (
    <>
      <section id="agents" className="mx-wrap mx-sec mx-with" aria-labelledby="with-h">
        <div>
          <h2 id="with-h" className="mx-h2">Works with the agents you already use</h2>
          <p className="mx-lead">Run them in the QualityLayer App or your browser. From your own terminal or IDE, <a href="/docs/agents/other">the CLI connects any other agent.</a></p>
        </div>
        <ul className="mx-withg">
          {SHOWN.map(([label, agent]) => (
            <li key={label} className="mx-wi" data-agent={agent}><Logo agent={agent} /><b>{label}</b></li>
          ))}
        </ul>
      </section>

      {/* Right after the agents: the models those agents run, on the plan you already pay for. */}
      <section className="mx-wrap mx-sec" aria-labelledby="mod-h">
        <div className="mx-mq">
          <div className="mx-mqt">
            <h2 id="mod-h" className="mx-h2">Use the models you already pay for</h2>
            <p className="mx-lead">Choose models for building and independent review.</p>
          </div>
          <div className="mx-mqr">
            <p className="w7-sr">Models: {MODELS.filter(([, icon]) => icon === "cpu").map(([label]) => label).join(", ")}, through {AGENTS.slice(0, -1).map(([label]) => label).join(", ")} and {AGENTS[AGENTS.length - 1][0]}. {SETUPS.map(([label]) => label).join(". ")}.</p>
            <div className="mx-mqm" aria-hidden="true">
              <Track chips={MODELS} />
              <Track chips={SETUPS} reverse />
            </div>
            <p className="mx-mqn">+ any model your coding agent offers</p>
          </div>
        </div>
      </section>

      {/* Right after the agents and their models: the skills QualityLayer adds to them, led by two agents talking to each other. */}
      <section id="skills" data-screen-label="Skills" className="mx-wrap mx-sec" aria-labelledby="skills-h">
        <div className="mx-head">
          <h2 id="skills-h" className="mx-h2">Your agents can talk to each other</h2>
          <p className="mx-lead">QualityLayer adds skills to every agent you connect. Claude Code can ask Codex for a review, and the answer comes back to the same session.</p>
        </div>
        <figure className="sk-stage" aria-label="Example: Claude Code asks Codex for a review">
          <span className="sk-tag">Example</span>
          <Session {...EXCHANGE[0]} />
          <div className="sk-wire" aria-hidden="true">
            <span className="sk-hop">Review <ArrowRight size={14} strokeWidth={1.75} /></span>
            <span className="sk-hop"><ArrowLeft size={14} strokeWidth={1.75} /> Reply</span>
          </div>
          <Session {...EXCHANGE[1]} />
        </figure>
        <ul className="sk-more" aria-label="More skills, with what you say">
          {SKILLS.map(({ icon: Glyph, title, ask }) => (
            <li key={title}><span className="mx-tile" aria-hidden="true"><Glyph size={20} strokeWidth={1.75} /></span><b>{title}</b><q>{ask}</q></li>
          ))}
        </ul>
        <p className="sk-foot">Ask in plain words, in any language. <a href="/docs/agents/native">More about the skills</a></p>
      </section>

      {/* Right after the agents: what one of them draws before it builds. The App's own map component, loaded on its own. */}
      <section id="change-map" data-screen-label="Change map" className="mx-wrap mx-sec cm-split" aria-labelledby="map-h">
        <div className="mx-head">
          <h2 id="map-h" className="mx-h2">See how a change fits together</h2>
          <p className="mx-lead">Your agent maps the files a change will touch and how they connect, before any code is written.</p>
          <p className="sk-foot"><a href="/docs/steps/plan">More about the Plan</a></p>
        </div>
        <figure className="cm-frame" aria-label="Example change map from a Plan">
          <span className="sk-tag">Example</span>
          <MapGuard>
            <Suspense fallback={<div className="cm-wait" aria-hidden="true" />}>
              <ChangeMapDemo />
            </Suspense>
          </MapGuard>
        </figure>
      </section>

      <section className="mx-sec" aria-labelledby="pr-h">
        <div className="mx-wrap">
          <div className="mx-head">
            <h2 id="pr-h" className="mx-h2">Plan before you build</h2>
            <p className="mx-lead">Agree on the plan, then review the tested change.</p>
            <p className="mx-lead">{CHAT_GUIDANCE} <a href="/docs/chat">Explore Chat</a></p>
          </div>
          <div className="mx-pr3">
            {PRINCIPLES.map(({ who, icon: Glyph, title, lead, text }) => (
              <div key={title} className="mx-pr" data-who={who}>
                <span className="mx-tile" aria-hidden="true"><Glyph size={20} strokeWidth={1.75} /></span>
                <h3>{title}</h3>
                <b>{lead}</b>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Right after the plan card it describes: the user's words as they said them, attributed without a name at their wish. */}
      <section id="customer-quotes" data-screen-label="Customer quotes" className="mx-wrap mx-sec mx-quotes" aria-label="What people say about QualityLayer">
        <figure className="mx-quote">
          <blockquote><p>{`“${ENGINEER_QUOTE}”`}</p></blockquote>
          <figcaption>An engineer who uses QualityLayer</figcaption>
        </figure>
        <figure className="mx-quote">
          <blockquote><p>{`“${USER_QUOTE.text}”`}</p></blockquote>
          <figcaption>{USER_QUOTE.context}</figcaption>
        </figure>
      </section>

      <section id="local" className="mx-wrap mx-sec" aria-labelledby="local-h">
        <div className="mx-head">
          <h2 id="local-h" className="mx-h2">Runs on your computer</h2>
          <p className="mx-lead">Keep your agent, editor and model plan. Nothing to host.</p>
        </div>
        <div className="mx-local">
          <span className="mx-local-tag"><Laptop size={15} strokeWidth={1.75} aria-hidden="true" />Your computer</span>
          <ol className="mx-chain">
            {CHAIN.map(({ icon: Glyph, title, text, chips, ql }, i) => (
              <li key={title} className={ql ? "ql" : undefined}>
                <span className="mx-tile" aria-hidden="true">{Glyph === "mark" ? <span className="mx-tile-mark" /> : <Glyph size={20} strokeWidth={1.75} />}</span>
                <b>{title}</b>
                <span className="mx-chain-text">{text}</span>
                <span className="mx-chain-chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</span>
                {i < CHAIN.length - 1 ? <span className="mx-chain-arrow" aria-hidden="true"><ArrowRight size={14} strokeWidth={2} /></span> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
