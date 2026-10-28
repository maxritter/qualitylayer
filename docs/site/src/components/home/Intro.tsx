/** After the hero: the agents QualityLayer works with, what it adds, one engineer's words, and the models you already pay for. */
import type { LucideIcon } from "lucide-react";
import { ArrowRight, BadgeCheck, FileText, KeyRound, Laptop, SquareTerminal, Workflow } from "lucide-react";
import type { NativeAgent } from "@ql/core/agents/ids";
import { AGENT_LOGOS } from "@ql/ui/kit/marks/agent-logos";
import { CHAT_GUIDANCE, ENGINEER_QUOTE, USER_QUOTE } from "@/lib/product";

type Chip = [label: string, icon: string];

/** The six agents the grid shows, most used first. Grok runs the same way and is named with the others in Install and the questions. */
const SHOWN: [label: string, agent: NativeAgent][] = [
  ["Claude Code", "claude-code"],
  ["Codex", "codex"],
  ["Cursor", "cursor"],
  ["Antigravity", "antigravity"],
  ["Pi", "pi"],
  ["OpenCode", "opencode"],
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
  ["Sonnet 5.5 for subagents", "file"],
  ["Codex reads the plan", "braces"],
  ["Claude Code reads the plan", "ast"],
  ["Or one agent does every step", "term"],
];

/** Each card in the App's colours: blue for the agent's work, amber for your decision, violet for what agents checked. */
const PRINCIPLES: { who: "agent" | "you" | "check"; icon: LucideIcon; title: string; lead: string; text: string }[] = [
  { who: "agent", icon: SquareTerminal, title: "Your agent", lead: "The tools you already use", text: "Keep your existing login or API key." },
  { who: "you", icon: Workflow, title: "One plan", lead: "Approved by you before any code", text: "Comment on diagrams and clickable mockups." },
  { who: "check", icon: BadgeCheck, title: "Proof", lead: "Independent review", text: "A separate agent checks the result against your plan." },
];

/** From where you work to the files you keep: what QualityLayer connects, all inside one dashed frame, your computer. */
const CHAIN: { icon: LucideIcon | "mark"; title: string; text: string; chips: string[]; ql?: true }[] = [
  { icon: Laptop, title: "Where you work", text: "Your task on the left, your agent on the right.", chips: ["QualityLayer App", "Browser"] },
  { icon: KeyRound, title: "Your agent, your subscription", text: "On the plan or API key you already pay for.", chips: AGENTS.map(([label]) => label) },
  { icon: "mark", title: "QualityLayer", text: "Plan, answer and review beside your agent. The CLI connects any other agent.", chips: ["Visual plans", "Conversation"], ql: true },
  { icon: FileText, title: "Your repository", text: "Every step is a Markdown file you can read, diff and commit.", chips: ["Plan", "Decisions", "Test runs"] },
];

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
    </>
  );
}
