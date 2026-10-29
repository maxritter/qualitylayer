/** Project checks and independent review above the workflow tour. */
import type { LucideIcon } from "lucide-react";
import { BadgeCheck, FileCode, FlaskConical, HeartPulse, Palette, ScanEye, ShieldCheck, Users } from "lucide-react";
import "@/styles/editorial.css";
import "@/styles/verification.css";

type Check = { icon: LucideIcon; title: string; text: string };

/** What the shipped Verify step runs today. A new check is added here, in the README image and on the Verify docs page together. */
const LAYERS: { who: "check" | "agent"; id: string; title: string; lead: string; items: Check[] }[] = [
  {
    who: "check",
    id: "deterministic",
    title: "Deterministic checks",
    lead: "Same input, same result, every time.",
    items: [
      { icon: FlaskConical, title: "Tests and types", text: "Your own commands, recorded." },
      { icon: FileCode, title: "Linters", text: "Your project's rules." },
      { icon: HeartPulse, title: "Code health", text: "Complexity and duplication." },
      { icon: BadgeCheck, title: "Recorded proof", text: "Every point needs evidence." },
    ],
  },
  {
    who: "agent",
    id: "agents",
    title: "Independent agents",
    lead: "Reviewers that read intent and run the program.",
    items: [
      { icon: ShieldCheck, title: "Security review", text: "At every trust boundary." },
      { icon: ScanEye, title: "Fresh reviewer", text: "Never wrote the code." },
      { icon: Palette, title: "Design review", text: "Checks each finished design." },
      { icon: Users, title: "Second opinion", text: "Another coding agent, optional." },
    ],
  },
];

export default function Verification() {
  return (
    <section id="verify" className="ed-section mx-wrap" aria-labelledby="vx-h">
      <div className="ed-head">
        <h2 id="vx-h">Checks and independent review</h2>
        <p>QualityLayer runs your project's checks and security scans. A separate agent reviews the change against your request.</p>
      </div>
      <div className="vx-groups">
        {LAYERS.map(({ who, id, title, lead, items }) => (
          <div key={id} className="vx-group" data-who={who} aria-labelledby={`vx-${id}-h`} role="group">
            <h3 id={`vx-${id}-h`}>{title}</h3>
            <p>{lead}</p>
            <ul className="vx-list">
              {items.map(({ icon: Glyph, title: name, text }) => (
                <li key={name} className="vx-item">
                  <i className="vx-mark" aria-hidden="true"><Glyph size={20} strokeWidth={1.75} /></i>
                  <b>{name}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="ed-outcome"><p>What is still open reaches you in Review, with its evidence.</p><div><a className="ed-link" href="/docs/steps/verify">How Verify works</a></div></div>
    </section>
  );
}
