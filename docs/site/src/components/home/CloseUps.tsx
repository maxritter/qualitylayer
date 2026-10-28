import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, Image, Maximize2, MessageSquare, Plus, Send } from "lucide-react";
import type { ReactNode } from "react";
import { CHAPTERS, CHECKS_TOTAL, checksPassed, committedTasks, ARTIFACT, DISCUSS_BATCH, discussAt, REQUEST, STAGES, TASK, VERIFY_CHECKS } from "@/lib/tour";

/**
 * One close-up of the QualityLayer App per chapter, at reading size. Each is a crop of the App's
 * main column as qualitylayer/artifacts/app draws it: the top bar (the task, its seven steps and the
 * agent chip), the connected seven steps, and then the question or full document. Agent activity
 * opens from its chip. A close-up plays its moments one per second; `step` is the moment.
 */

type Mark = "you" | "work" | "wait" | "done" | "check" | "open";
const Mk = ({ k }: { k: Mark }) => <span aria-hidden="true" className={`cu-mk ${k}`} />;

type Chip = { mark: Mark; name: string; words: string } | null;

/** The top bar: a task with its seven steps and the agent chip, or a page's title. */
function TopBar({ stage, title = TASK, kind = "feature", chip, approval, activity }: { stage: number; title?: string; kind?: string; chip: Chip; approval?: ReactNode; activity?: ReactNode }) {
  return (
    <>
    <div className={`cu-tb${stage >= 0 ? " task" : ""}`}>
      <b className="cu-title">{title}</b>
      {stage < 0 && kind && <span className="cu-kind">{kind}</span>}
      {chip && (
        <details className="cu-status">
          <summary aria-label={`${chip.name} status`} className={`cu-chip ${chip.mark}`}>
            <Mk k={chip.mark} /><b>{chip.name}</b><ChevronDown size={13} aria-hidden="true" />
          </summary>
          <div className="cu-status-panel">
            <p className="cu-k">{chip.name} · {chip.words}</p>
            {activity ?? <p>{chip.words}</p>}
          </div>
        </details>
      )}
    </div>
    {stage >= 0 && <div className="cu-workspace-track">
      <ol className="cu-track" aria-label="Task steps">
        {STAGES.map((label, k) => <li key={label} className={k < stage ? "done" : k === stage ? "cur" : "future"} aria-current={k === stage ? "step" : undefined}>{label}</li>)}
      </ol>
      {approval}
    </div>}
    </>
  );
}

type Gate = { label: string; state?: "cur" | "done"; pips?: [number, number] };

/** A genuine person-needed note; the workflow stays in the connected header. */
function GateTrack({ turn }: { items: Gate[]; turn?: string }) {
  return turn ? <p className="cu-step-note"><Mk k="you" />{turn}</p> : null;
}

function Frame({ top, gate, children, label }: { top: ReactNode; gate?: ReactNode; children: ReactNode; label: string }) {
  return (
    <div className="cu" data-closeup={label}>
      {top}
      {gate}
      <div className="cu-stage">{children}</div>
    </div>
  );
}

/** The one amber card that holds what waits for you. */
function YourTurn({ kind, count, title, text, children, foot }: { kind: string; count?: string; title: ReactNode; text?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <section className="cu-yt">
      <p className="cu-ytag"><Mk k="you" />Your turn<span className="cu-k">· {kind}</span><span className="cu-grow" />{count && <span className="cu-k">{count}</span>}</p>
      <h4 className="cu-yh">{title}</h4>
      {text && <p className="cu-yp">{text}</p>}
      {children && <div className="cu-yb">{children}</div>}
      {foot && <div className="cu-yf">{foot}</div>}
    </section>
  );
}

/** Activity belongs in the status panel, leaving the document in the workspace. */
function AgentActivity({ title, note, sub, children }: { title: string; note?: string; sub?: string; children?: ReactNode }) {
  return (
    <div>
      <h4 className="cu-ah">{title}{note && <span className="cu-k">{note}</span>}</h4>
      {sub && <p className="cu-as">{sub}</p>}
      {children}
    </div>
  );
}

function MeterFlow({ pin = false }: { pin?: boolean }) {
  return <div className="cu-dgm">
    {pin && <span className="cu-pin">1</span>}
    <p className="cu-dgmh"><span>How a request is counted</span><span>{pin ? "1 comment" : "flow"}</span></p>
    <div className="cu-dgr"><span className="cu-dn on">Gateway<small>one meter event per request id</small></span><span className="cu-dl"><em>once per id</em></span><span className="cu-dn">Five-minute window<small>written once to the ledger</small></span></div>
    <div className="cu-dgr"><span className="cu-dn you">At the limit<small>your call in the Plan</small></span><span className="cu-dl" /><span className="cu-dn">Keep serving<small>bill the overage, alert at 80 %</small></span></div>
  </div>;
}

/** Numbered choices with the recommendation marked, and the own-words field always in view. */
function Choices({ items, rec = 0, picked = -1, own = "Or write your own answer…" }: { items: [string, string?][]; rec?: number; picked?: number; own?: string | null }) {
  return (
    <>
      <div className="cu-chs">
        {items.map(([label, note], i) => (
          <span key={label} className={`cu-ch${i === rec ? " rec" : ""}${i === picked ? " picked" : ""}`}>
            <span className="cu-chn">{i + 1}</span>
            <span className="cu-chl">{label}{note && <small>{note}</small>}</span>
            {i === rec && <span className="cu-chr">recommended</span>}
          </span>
        ))}
      </div>
      {own !== null && <div className="cu-own"><span className="cu-field">{own}</span><span className="cu-btn pri">Send <kbd>↵</kbd></span></div>}
    </>
  );
}

const Keys = ({ keys }: { keys: [string, string][] }) => (
  <span className="cu-keys">{keys.map(([k, label]) => <span key={label}><kbd>{k}</kbd>{label}</span>)}</span>
);

/** A sent answer, with its undo. */
const Sent = ({ children }: { children: ReactNode }) => (
  <p className="cu-sent"><Check size={14} aria-hidden="true" /><span>{children}</span><span className="cu-k">Undo · 5 s</span></p>
);

/** The violet line: what the agents checked, opening on demand. */
const Checked = ({ facts, head = "Checked by agents" }: { facts: string[]; head?: string }) => (
  <p className="cu-cl"><b>{head}</b>{facts.map((f) => <span key={f}>{f}</span>)}<ChevronDown size={14} aria-hidden="true" /></p>
);

/**
 * The page the agent drew for this task: Finance's billing mode page in the person's own product,
 * drawn in its theme. Full size, its Switch to usage button works: the account moves to usage from
 * the next cycle, and the switch is audited.
 */
export function ArtifactPage({ switched = false, onSwitch, next = false, pin = false, brief = false }: { switched?: boolean; onSwitch?: () => void; next?: boolean; pin?: boolean; brief?: boolean }) {
  const rows: [string, string, string][] = [
    ["Seats", "November invoice", "$4,800 · 40 seats"],
    ["Usage", "November invoice", "$3,912 · 1.9 M requests"],
    ["Reason", "Moves to the API plan", switched ? "Usage from 1 Nov" : ""],
  ];
  return (
    <div className={`cu-dp${brief ? " brief" : ""}`}>
      <div className="cu-dph"><b>Billing mode</b><span className="cu-dpt"><span className={switched ? undefined : "on"}>Seats</span><span className={switched ? "on" : undefined}>Usage</span></span></div>
      {rows.map(([label, field, state]) => (
        <div key={label} className="cu-dpr">
          <b>{label}</b>
          <span className="dim">{field}</span>
          <span className={switched && label === "Reason" ? "amb" : undefined}>
            {state}
            {label === "Reason" && (switched ? <small> · audited just now</small> : next && <small>Last switch · 14 May, by Finance</small>)}
            {label === "Reason" && pin && <span className="cu-pin">1</span>}
          </span>
          <span>
            {label === "Reason" &&
              (onSwitch || switched ? <button type="button" onClick={onSwitch} disabled={switched} tabIndex={-1} className="cu-dpb">Switch to usage</button> : <span className="cu-dpb">Switch to usage</span>)}
          </span>
        </div>
      ))}
      {!brief && <p className="cu-dpf">Every switch is audited. It takes effect at the next billing cycle.</p>}
    </div>
  );
}

/** An artifact inside the card it belongs to. */
const ArtifactIn = ({ children }: { children: ReactNode }) => (
  <div className="cu-dz">
    <p className="cu-dzh"><Image size={13} aria-hidden="true" /><b>billing-mode</b><span className="cu-k">· the artifact for this question</span><span className="cu-grow" /><span className="cu-btn sm"><Maximize2 size={12} aria-hidden="true" />Full size</span></p>
    <div className="cu-dzf">{children}</div>
  </div>
);

const QUESTIONS: { title: string; text: string; settles: string; choices: [string, string?][] }[] = [
  { title: "What happens to the customers on seats?", text: "About 400 accounts pay for seats today. Moving them changes invoices they know.", settles: "Done means 3", choices: [["Keep them on seats until Finance moves them"], ["Move everyone at renewal", "changes invoices they know"], ["Offer both plans side by side"]] },
  { title: "Bill from the first request, or after a free allowance?", text: "The pricing page promises a free tier but names no number.", settles: "Done means 2", choices: [["A free allowance per plan"], ["From the first request", "simpler, but drops the free tier"], ["Let Finance set it per account"]] },
  { title: "What happens to an event that arrives late?", text: "A broker outage can deliver events after an invoice has gone out.", settles: "Done means 2", choices: [["Correct the next invoice"], ["Reissue the closed invoice", "confuses customers"], ["Drop it"]] },
  { title: "Bill in the customer’s own currency?", text: "Invoices are in US dollars today. Local currency needs exchange rates and tax rules.", settles: "the scope", choices: [["A later task"], ["In this task"], ["Not at all"]] },
];

/** The build's slices as the Outline cut them, built in this order. `run` and `done` are moments of the Implement close-up. */
const SLICES = [
  { title: "Meter one request end to end", doing: "", par: "", tasks: ["T1", "T2"], run: 0, done: 0 },
  { title: "Survive retries and broker outages", doing: "T3: the test fails first, then a retry counts once", par: "", tasks: ["T3", "T4"], run: 0, done: 2 },
  { title: "Let Finance switch the billing mode", doing: "T5: the test fails first, then every switch is audited", par: "", tasks: ["T5"], run: 2, done: 3 },
];

/** Each point of Done means, the proof beside it, and the moment of the Verify close-up it passes. */
const POINTS: [string, string, number][] = [
  ["Usage appears within five minutes", "window.test.ts · an event reaches the ledger within five minutes", 0],
  ["Every billable request counts exactly once", "retries.test.ts · a request retried ten times is one ledger entry", 3],
  ["Every billing-mode switch leaves an audit entry", "billing-mode.spec.ts · screenshot 2 shows the switch and its audit entry", 5],
];

/** Where each Done means point was built: the slice whose scenario proves it. */
const BUILT_IN = [1, 2, 3];

/** A few lines of the diff of one file, as the walkthrough opens it; the comment is on line 5. */
const DIFF: [string, number, string][] = [
  ["ctx", 3, "  if (!plan.billable(request.route)) return null"],
  ["add", 4, "  // A retry keeps its request id: count it once"],
  ["add", 5, "  const key = request.headers.get(\"x-request-id\")"],
  ["add", 6, "  const event = { key, account: plan.account }"],
];

/**
 * The change top to bottom, as the Review step draws it under the approval card: why, what you
 * asked for, the slices with their files and diffs, what was left alone, how it was checked and where
 * it ships. The pull request's description reads in the same order.
 */
function Walkthrough() {
  return (
    <section className="cu-card cu-wt" aria-label="The change, top to bottom">
      <p className="cu-cardh"><b>The change, top to bottom</b><span className="cu-k">3 slices · 5 tasks · 8 files</span><span className="cu-grow" /><span className="cu-k cu-wt-same">same order as the pull request</span></p>
      <div className="cu-wr">
        <span className="cu-wk">Why</span>
        <p>API customers pay by seat today, however much they use. After this change each request is counted once at the gateway and billed by use, and seat customers keep the invoices they know.</p>
      </div>
      <div className="cu-wr">
        <span className="cu-wk">What you asked for<small>3 points</small></span>
        <div className="cu-wpts">
          {POINTS.map(([title], k) => (
            <p key={title}><span className="cu-num">{k + 1}</span><span>{title}<small>built in slice {BUILT_IN[k]} · proved by scenario {k + 1}</small></span><span className="cu-k">passed</span></p>
          ))}
        </div>
      </div>
      <div className="cu-wr">
        <span className="cu-wk">Built, slice by slice<small>comment on any line</small></span>
        <div className="cu-wsl">
          {SLICES.map((slice, k) => (
            <div key={slice.title} className={`cu-ws${k === 1 ? " open" : ""}`}>
              <p className="cu-wsh">{k === 1 ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}<span className="cu-num">{k + 1}</span><span className="cu-wst">{slice.title}</span><span className="cu-k">{slice.tasks.length} {slice.tasks.length === 1 ? "task" : "tasks"} · {k === 2 ? 2 : 3} files{k === 1 ? " · 1 decision" : ""}</span></p>
              {k === 1 && (
                <div className="cu-wsb">
                  <p className="cu-wd"><Mk k="done" /><span>Decided while building · The outage buffer keeps an hour on disk</span><span className="cu-lnk">Ask why</span></p>
                  <p className="cu-wf"><span className="cu-k">T3</span><code>services/gateway/src/meter.ts</code><span className="cu-k">+10 −2</span></p>
                  <div className="cu-wdf" role="group" aria-label="Diff of services/gateway/src/meter.ts">
                    {DIFF.map(([kind, n, line]) => (
                      <div key={n}>
                        <p className={`cu-wl ${kind}`}><span>{n}</span><code>{line}</code></p>
                        {n === 5 && <p className="cu-wth"><i className="cu-av">A</i><span><b>Anna</b> <span className="cu-k">from the team</span><br />Does a retry with a new request id count twice?</span></p>}
                      </div>
                    ))}
                  </div>
                  <p className="cu-wf"><span className="cu-k">T3</span><code>tests/integration/retries.test.ts</code><span className="cu-k">new · +41</span></p>
                  <p className="cu-wf"><span className="cu-k">T4</span><code>services/gateway/src/outage-buffer.ts</code><span className="cu-k">new · +28</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="cu-wr">
        <span className="cu-wk">Deliberately not changed</span>
        <p>Seat invoices stay as they are. Invoices stay in US dollars; the customer’s own currency is a later task.</p>
      </div>
      <div className="cu-wr">
        <span className="cu-wk">How it was checked</span>
        <p className="cu-wchk"><Mk k="check" />{CHECKS_TOTAL} of {CHECKS_TOTAL} checks passed<span className="cu-k">· 3 steps to try it yourself · live admin not verified</span></p>
      </div>
      <div className="cu-wr">
        <span className="cu-wk">Ship</span>
        <p>Lands on <code>feat/usage-billing</code> · pull request to <code>main</code> · no security findings</p>
      </div>
    </section>
  );
}

/** After the approval: the pull request's checks and reviews, until it is merged. */
function PullRequest() {
  const rows: [Mark, string, string][] = [
    ["work", "CI · macOS", "running · 4 min"],
    ["check", "CI · Linux", "passed · 6 min"],
    ["check", "Shellcheck and actionlint", "passed · 12 s"],
    ["wait", "Anna and Ben were asked", "no review yet"],
  ];
  return (
    <section className="cu-card" aria-label="Pull request">
      <p className="cu-cardh"><b>Pull request #412</b><span className="cu-k">feat/usage-billing → main · checks and reviews</span></p>
      {rows.map(([mark, what, state]) => (
        <p key={what} className="cu-pr"><Mk k={mark} /><span>{what}</span><span className="cu-k">{state}</span></p>
      ))}
    </section>
  );
}

const COST: [string, string, string, string][] = [
  ["Discuss", "7 min", "$1.30", "var(--ql-text-dim)"],
  ["Research", "5 min", "$0.80", "var(--ql-text-muted)"],
  ["Plan", "12 min", "$2.60", "var(--ql-amber)"],
  ["Outline", "6 min", "$1.25", "var(--ql-amber-ink)"],
  ["Implement", "26 min", "$9.40", "var(--ql-accent)"],
  ["Verify", "21 min", "$5.60", "var(--ql-check)"],
];

/** Each reporting agent's windows: label, what is left in percent, when it resets. Below 25 % the row turns amber. */
const LIMITS: [string, [string, number, string][]][] = [
  ["Claude Code", [["5 hours", 62, "1 h 20 min"], ["This week", 71, "3 days"]]],
  ["Codex", [["5 hours", 18, "40 min"], ["This week", 64, "4 days"]]],
];

const waits = (words: string): Chip => ({ mark: "wait", name: "Claude Code", words });
const works = (words: string): Chip => ({ mark: "work", name: "Claude Code", words });

/**
 * The close-up of chapter `id` at moment `step`. `tries` and `onRetry` drive the artifact's working
 * Switch to usage button: the tour counts its presses from 2, so 3 means the account was switched.
 */
export default function CloseUp({ id, step: asked, tries = 2, onRetry }: { id: string; step: number; tries?: number; onRetry?: () => void }) {
  // A close-up has no moment past its last.
  const step = Math.min(asked, CHAPTERS.find((c) => c.id === id)?.steps ?? asked);
  const at = (n: number) => step >= n;
  const show = (n: number) => `cu-in${at(n) ? " on" : ""}`;

  switch (id) {
    case "discuss": {
      // One batch of four, answered in any order: the strip shows all of them, one is in focus.
      const { answered, focus, picked, sent } = discussAt(step);
      const q = QUESTIONS[focus];
      const left = DISCUSS_BATCH - answered.length;
      return (
        <Frame label="Discuss"
          top={<TopBar stage={0} chip={works("reading request-id.ts")} activity={<AgentActivity title="Reading the code while you answer" note="2 min" sub="Each answer reaches Claude Code at once. It writes Done means from them." />} />}
          gate={<GateTrack items={[]} turn={`Your turn · ${left} ${left === 1 ? "question" : "questions"}`} />}>
          {sent !== null && <Sent>Sent to Claude Code · {QUESTIONS[sent].choices[0][0]}</Sent>}
          <YourTurn kind={`a batch of ${DISCUSS_BATCH} from Claude Code`} title={q.title} text={<>{q.text} <span className="cu-k">Settles {q.settles}.</span></>}
            foot={<Keys keys={[["1", "pick"], ["↵", "send"], ["M", "tell me more"], ["R", "use the recommendation"]]} />}>
            <div className="cu-bq">
              <b>Scope and what Done means</b>
              <span className="cu-strip" role="group" aria-label="Questions in this batch">
                {QUESTIONS.map((x, k) => (
                  <span key={x.title} className={`${answered.includes(k) ? "done" : ""}${k === focus ? " on" : ""}`} aria-current={k === focus ? "true" : undefined}>
                    {answered.includes(k) && <Check size={12} aria-hidden="true" />}{k + 1}
                  </span>
                ))}
              </span>
              <span className="cu-bqr">question {focus + 1} of {DISCUSS_BATCH}</span>
            </div>
            <Choices items={q.choices} picked={picked ? 0 : -1} />
          </YourTurn>
        </Frame>
      );
    }

    case "plan": {
      // The complete Plan with its approval in the header from the first moment; a comment lands on its diagram, then Approve is ready.
      const commented = at(1);
      return (
        <Frame label="Plan"
          top={<TopBar stage={2} chip={waits("waits for your review")} approval={<div className="cu-approval"><span className="cu-k">Ready to approve</span><span className="cu-btn sm">Give feedback</span><span className={`cu-btn pri sm${at(2) ? " glow" : ""}`}>Approve Plan</span></div>} />}>
          <article className="cu-document compact" aria-label="Plan document">
            <h4>Count each request once and bill it</h4>
            <p>Count each request once at the gateway, keyed by its request id. Seat accounts never take the new path.</p>
            <h5>Done means</h5>
            <ol>{POINTS.map(([title]) => <li key={title}>{title}</li>)}</ol>
            <p className="row"><b>Decisions</b> At the limit, keep serving and bill the overage, with alerts at 80 % and 100 %.</p>
            <MeterFlow pin={commented} />
            <p className="row"><b>Contracts</b> Three interfaces the build is held to, each folded to one headline</p>
            <p className="row"><b>Reviewed by</b> A reviewer read this Plan first; the findings are folded in</p>
          </article>
        </Frame>
      );
    }

    case "research": {
      const asked = at(3);
      const QUESTIONS_READ: [string, number][] = [
        ["Does a request id survive a retry?", 1],
        ["What does the ledger do with a second write?", 2],
        ["How does an invoice reach Stripe today?", 3],
      ];
      return (
        <Frame label="Research"
          top={<TopBar stage={1} chip={asked ? waits("waits for your choice") : works("3 agents reading the code")} activity={<AgentActivity title="Reading the code, without your request" note={`${3 + step} min`} sub="Each agent takes one area and answers questions about how it works today. None of them sees what you asked for."><p className="cu-prog">{Math.min(3, step)} of 3 questions answered</p></AgentActivity>} />}
          gate={<GateTrack items={[]} turn={asked ? "Your turn · 1 choice" : undefined} />}>
          {asked ? (
            <>
              <Checked head="The questions" facts={["3 answered", "by agents that never see your request"]} />
              <YourTurn kind="A choice the code leaves open" count="1 of 1" title="Count a request at the gateway, or from the access logs?"
                text={<>A retry keeps its request id, so the gateway can count each request once. <span className="cu-k">From Research · request ids survive retries.</span></>}
                foot={<Keys keys={[["1 2", "pick"], ["↵", "send"], ["R", "recommended"]]} />}>
                <Choices items={[["At the gateway, keyed by request id", "usage within five minutes"], ["From the access logs every hour", "nothing added to the gateway, usage an hour late"]]} picked={at(4) ? 0 : -1} />
              </YourTurn>
            </>
          ) : (
            <section className="cu-card">
              <p className="cu-cardh"><b>The questions</b><span className="cu-k">answered by agents that never see your request</span></p>
              {QUESTIONS_READ.map(([title, when], k) => {
                const state = step >= when ? "check" : "work";
                return (
                  <div key={title} className="cu-vr">
                    <Mk k={state} />
                    <span className="cu-num">{k + 1}</span>
                    <span className="cu-slt">{title}<small>{state === "check" ? "answered" : "reading the code"}</small></span>
                    <span className={`cu-k ${state}`}>{state === "check" ? "answered" : ""}</span>
                  </div>
                );
              })}
            </section>
          )}
        </Frame>
      );
    }

    case "outline": {
      return (
        <Frame label="Outline"
          top={<TopBar stage={3} chip={at(3) ? waits("the Outline is done") : works("writing the Outline")} activity={<AgentActivity title="Cutting the Plan into slices" note={`${2 + step} min`} sub="You read the Plan meanwhile. Nothing to approve here; the build can start the moment you approve the Plan." />} />}>
          <article className="cu-document" aria-label="Outline document">
            <h4>The build, slice by slice</h4>
            <p>3 slices and 5 tasks, in build order.</p>
            <h5>Slices</h5><ol>{SLICES.map((slice) => <li key={slice.title}>{slice.title} · {slice.tasks.length} {slice.tasks.length === 1 ? "task" : "tasks"}</li>)}</ol>
            <h5>How each point is proved</h5><ol>{POINTS.map(([title], k) => <li key={title}>{title} · scenario {k + 1}</li>)}</ol>
            {at(2) && <p>Every Done means point has a scenario.</p>}
          </article>
        </Frame>
      );
    }

    case "start":
      return (
        <Frame label="Start"
          top={<TopBar stage={4} chip={waits("Plan approved")} />}
          gate={<GateTrack items={[{ label: "Start", state: "cur" }, { label: "Slices · 3" }, { label: "Checked as it builds" }, { label: "Agents check every point" }]} turn="Your turn · start the build" />}>
          <YourTurn kind="Implement" title="Start the build" text="Paste this request into your agent. From then on the build runs on its own until the final review.">
            <span className="cu-seg cu-agent-seg"><span className="on">Claude Code</span><span>Codex</span><span>Cursor</span><span>Grok</span><span>Antigravity</span><span>Pi</span><span>OpenCode</span><span>Another agent</span></span>
            <p className="cu-defs"><span><span className="cu-k">Lead</span> Opus 5.5</span><span><span className="cu-k">Subagent default</span> Sonnet 5.5</span><span><span className="cu-k">Effort</span> High</span><span className="cu-lnk">Change</span></p>
            <div className="cu-cmd"><code>Using QualityLayer, implement the approved plan for task usage-billing</code><span className={`cu-btn pri sm${step === 1 ? " press" : ""}`}>{at(2) ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{at(2) ? "Copied" : "Copy request"}</span></div>
          </YourTurn>
        </Frame>
      );

    case "implement": {
      const done = committedTasks(step);
      const slicesDone = SLICES.filter((s) => step >= s.done).length;
      const building = slicesDone < SLICES.length;
      return (
        <Frame label="Implement"
          top={<TopBar stage={4} chip={works(building ? `building slice ${slicesDone + 1}` : "recording the proof")} activity={<AgentActivity title={building ? `Building slice ${slicesDone + 1}` : "The build is finished"} note={`${10 + step * 3} min`} sub="Every task starts with a failing test. The slices are built in the Outline’s order."><p className="cu-prog">{done} of 5 tasks committed</p></AgentActivity>} />}
          gate={<GateTrack items={[{ label: "Started 14:02", state: "done" }, { label: `Slices · ${slicesDone} of 3`, state: "cur", pips: [slicesDone, 3] }, { label: "Checked as it builds" }, { label: "Agents check every point" }]} />}>
          <section className="cu-card">
            <p className="cu-cardh"><b>Slices</b><span className="cu-k">{slicesDone} of 3 done · {done} of 5 tasks committed</span></p>
            {SLICES.map((s, k) => {
              const state = step >= s.done ? "done" : step >= s.run ? "run" : "next";
              const note = state === "run" ? s.doing : s.par;
              return (
                <div key={s.title} className={`cu-slr ${state}`}>
                  <Mk k={state === "done" ? "done" : state === "run" ? "work" : "open"} />
                  <span className="cu-num">{k + 1}</span>
                  <span className="cu-slt">{s.title}{note && <small>{note}</small>}</span>
                  <span className="cu-k">{state === "done" ? "committed" : state === "run" ? "building" : "next"}</span>
                </div>
              );
            })}
          </section>
          <p className={`cu-row ${show(4)}`}><Mk k="done" /><span className="cu-k">Decided while building</span><span>The outage buffer keeps an hour on disk</span><span className="cu-grow" /><span className="cu-btn sm">Ask why</span></p>
          <div className={show(5)}><Checked facts={["5 tasks green, test first", "11 test runs recorded"]} /></div>
        </Frame>
      );
    }

    case "verify": {
      const passed = checksPassed(step);
      const done = at(7);
      const pointsPassed = POINTS.filter(([, , when]) => step >= when).length;
      return (
        <Frame label="Verify"
          top={<TopBar stage={5} chip={done ? waits("waits for your review") : works("running Independent review")} activity={<AgentActivity title="An agent that did not write the code is checking" note={`${passed} of ${CHECKS_TOTAL}`}><p className="cu-prog">412 tests passed · types, lint and build passed</p></AgentActivity>} />}
          gate={<GateTrack items={[{ label: "Security review", state: "done" }, { label: "Project checks · 4", state: "done" }, { label: `Done means · ${pointsPassed} of 3`, state: at(6) ? "done" : "cur", pips: [pointsPassed, 3] }, { label: "Second opinion", state: at(5) ? "done" : undefined }]} turn={done ? "Your turn · 2 in Review" : undefined} />}>
          <Checked head="The checks, in order" facts={VERIFY_CHECKS} />
          {done && <Checked facts={[`${CHECKS_TOTAL} of ${CHECKS_TOTAL} passed`, "412 tests", "evidence for each point"]} />}
          <section className="cu-card">
            <p className="cu-cardh"><b>Done means</b><span className="cu-k">each point against the running program</span></p>
            {POINTS.map(([title, evidence, when], k) => {
              const state = step >= when ? "check" : step >= when - 1 ? "work" : "open";
              return (
                <div key={title} className="cu-vr">
                  <Mk k={state} />
                  <span className="cu-num">{k + 1}</span>
                  <span className="cu-slt">{title}<small>{state === "check" ? evidence : state === "work" ? "checking now" : "waiting"}</small></span>
                  <span className={`cu-k ${state}`}>{state === "check" ? "passed" : state === "work" ? "checking" : ""}</span>
                </div>
              );
            })}
          </section>
          {done && <p className="cu-nextyou"><span className="cu-k">Next for you</span><span>Review · one live call only you can confirm, and one choice the agent made</span></p>}
        </Frame>
      );
    }

    case "review": {
      const approved = at(5);
      if (approved)
        return (
          <Frame label="Review"
            top={<TopBar stage={6} chip={{ mark: "done", name: "Claude Code", words: "pull request #412 is open" }} />}>
            <section className="cu-card cu-calm">
              <p className="cu-cardh"><b>Approved · pull request #412 opened</b><span className="cu-k">on feat/usage-billing</span></p>
              <p className="cu-calmp">Checks run on GitHub now. The task stays open until the pull request is merged, and you are told when a review or a failing check needs you.</p>
            </section>
            <PullRequest />
            <p className="cu-fold"><b>The change, top to bottom</b><span className="cu-k">as you approved it · 8 files</span><ChevronRight size={14} aria-hidden="true" /></p>
          </Frame>
        );
      return (
        <Frame label="Review"
          top={<TopBar stage={6} chip={waits("waits for your review")} approval={<span className="cu-btn pri">Approve and create PR</span>} />}>
          <section className="cu-card" aria-label="Review the code">
            <p className="cu-cardh"><b>Review the code</b><span className="cu-k">8 files · Unified / Split</span></p>
            <p className="cu-wf"><span className="cu-k">T3</span><code>services/gateway/src/meter.ts</code><span className="cu-k">+10 −2</span></p>
            <div className="cu-wdf" role="group" aria-label="Diff of services/gateway/src/meter.ts">
              {DIFF.map(([kind, n, line]) => (
                <div key={n}>
                  <p className={`cu-wl ${kind}`}><span>{n}</span><code>{line}</code></p>
                  {n === 5 && <p className="cu-wth"><i className="cu-av">A</i><span><b>Anna</b> <span className="cu-k">from the team</span><br />Does a retry with a new request id count twice?</span></p>}
                </div>
              ))}
            </div>
          </section>
          <details className="cu-card" open={step === 0}>
            <summary className="cu-cardh"><b>Checks</b><span className="cu-k">{CHECKS_TOTAL} passed · live admin not verified</span></summary>
            <Checked facts={VERIFY_CHECKS} />
            {POINTS.map(([title, evidence]) => <p key={title} className="cu-row"><Mk k="check" /><span>{title}<small className="cu-k"> · {evidence}</small></span></p>)}
            <p className="cu-calmp">One switch on the live admin left an audit entry: not verified. Approval leaves this result unverified.</p>
          </details>
          <details className="cu-card" open={step === 1}>
            <summary className="cu-cardh"><b>Screens</b><span className="cu-k">Billing mode · screenshot 2</span></summary>
            <ArtifactPage />
          </details>
          <details className="cu-card" open={step >= 2}>
            <summary className="cu-cardh"><b>Change details</b><span className="cu-k">3 slices · 5 tasks · 8 files</span></summary>
            <Walkthrough />
          </details>
        </Frame>
      );
    }

    case "draw": {
      // The request and the drawn page, inside the Plan's question, from the first moment.
      return (
        <Frame label="Artifacts"
          top={<TopBar stage={2} chip={waits("waits for you")} activity={<AgentActivity title="Drew the page you asked for" note="1 min" sub="It drew one clickable page in your product’s look, and the Plan asks you about it." />} />}
          gate={<GateTrack items={[]} turn={at(2) ? undefined : "Your turn · 1 artifact"} />}>
          <YourTurn kind="Artifact · shown in the Plan" title="Is this how Finance should switch an account?" text={`You asked: “Mock up the ${ARTIFACT.name.toLowerCase()} page.”`}
            foot={<Keys keys={[["1", "looks right"], ["2", "change it"], ["F", "full size"]]} />}>
            <ArtifactIn><ArtifactPage brief /></ArtifactIn>
            <Choices items={[["Looks right"], ["Change it…", "say what to change, or point at a spot full size"]]} picked={at(1) ? 0 : -1} own={null} />
          </YourTurn>
        </Frame>
      );
    }

    case "comment":
      return (
        <Frame label="Comment"
          top={<TopBar stage={2} chip={at(2) && !at(3) ? works("changing the artifact") : waits("waits for you")} />}
          gate={<div className="cu-gt"><span className="cu-g done"><Image size={13} aria-hidden="true" />billing-mode · full size</span><span className="cu-grow" /><span className={`cu-btn sm${!at(2) ? " on" : ""}`}><MessageSquare size={12} aria-hidden="true" />Comment <kbd>C</kbd></span></div>}>
          {!at(2) && <p className="cu-mode"><b>Comment</b><span>Click a spot on the artifact</span><kbd>Esc</kbd></p>}
          <div className="cu-dzf big"><ArtifactPage switched={tries >= 3} onSwitch={onRetry} pin={at(1)} next={at(3)} /></div>
          {at(1) && !at(2) && <div className="cu-compose"><p className="cu-k">You · on Switch to usage</p><span className="cu-field">Show who switched this account last.</span><span className={`cu-btn pri sm${step === 1 ? " press" : ""}`}>Comment</span></div>}
          {at(2) && (
            <section className="cu-th">
              <div className="cu-msg"><span className="cu-pin">1</span><p><b>You</b> Show who switched this account last.</p></div>
              <div className={`cu-msg ${show(3)}`}><Mk k="done" /><p><b>Claude Code</b> Changed the page: the last switch shows beside the button.</p></div>
            </section>
          )}
        </Frame>
      );

    case "ask":
      return (
        <Frame label="Ask"
          top={<TopBar stage={2} chip={waits("waits for you")} />}
          gate={<GateTrack items={[{ label: "Done means · 3", state: "done" }, { label: "Decisions · 2 of 2", state: "done" }, { label: "Team · Anna", state: "cur", pips: [at(4) ? 1 : 0, 1] }, { label: "Approve" }]} turn={at(2) && !at(4) ? undefined : "Your turn · approve"} />}>
          <section className="cu-doc">
            <p className="cu-k">03-plan.md · Your call</p>
            <p>At the limit, the gateway keeps serving and <mark>the overage is billed</mark> at the tier price, with alerts at 80 % and 100 %.</p>
          </section>
          {!at(2) && (
            <section className="cu-pop">
              <b>Ask the team about this passage</b>
              <span className="cu-people"><span className="on"><i>A</i>Anna</span><span><i>B</i>Ben</span><span><i>C</i>Chen</span></span>
              <span className="cu-field">Is an overage with no cap safe for Finance?</span>
              <p className="cu-acts"><span className="cu-k">Needed before approval</span><span className="cu-sw on" /><span className="cu-grow" /><span className={`cu-btn pri sm${step === 1 ? " press" : ""}`}><Send size={12} aria-hidden="true" />Ask Anna</span></p>
            </section>
          )}
          {at(2) && (
            <section className="cu-th">
              <p className="cu-thq">You asked <b>Anna</b> · needed before approval · Slack message sent</p>
              <div className="cu-msg"><i className="cu-av">M</i><p><b>You</b> Is an overage with no cap safe for Finance?</p></div>
              {at(3) && <div className="cu-msg"><i className="cu-av">A</i><p><b>Anna</b> <span className="cu-via">via Claude Code</span> <span className="cu-k">suggests a change</span><br />Cap it at 50 % above the plan, so a runaway client can’t run up the bill.</p></div>}
              {at(4) && <p className="cu-thf"><Mk k="done" />Claude Code updated the passage · approve when you are ready</p>}
            </section>
          )}
        </Frame>
      );

    case "answer": {
      // The question with its passage in view from the first moment; your agent's draft waits, not sent, for your yes.
      return (
        <Frame label="Questions for you"
          top={<TopBar stage={-1} title="Team" kind="Acme · your App" chip={null} />}
          gate={<GateTrack items={[]} turn="Your turn · 2 questions" />}>
          <YourTurn kind="Question from Ben Ortiz · 20 min ago" count="1 of 2" title="“Is once a minute fresh enough for the export budget?”" text={<>API rate-limit tiers · Plan · <b>opinion only</b></>}
            foot={<Keys keys={[["1", "looks right"], ["2", "suggest a change"], ["R", "reply"]]} />}>
            <p className="cu-quote">The limiter reads the plan’s limit <mark>once per minute</mark> and caches it per account.</p>
            <Choices items={[["Looks right"], ["Suggest a change"], ["Reply"]]} rec={-1} picked={at(1) ? 2 : -1} own="Or hand it to someone else…" />
            <div className={`cu-draft ${show(2)}`}>
              <p className="cu-k"><Mk k="work" />Draft by your Claude Code · not sent yet</p>
              <p>Once a minute is fine: the plan’s limit changes rarely, and a value 60 s old allows at most one extra window.</p>
              <p className="cu-acts"><span className="cu-btn pri sm">Send the draft</span><span className="cu-btn sm">Edit</span></p>
            </div>
          </YourTurn>
        </Frame>
      );
    }

    case "space":
      return (
        <Frame label="Team space"
          top={<TopBar stage={-1} title="Team" kind="Acme · 4 members" chip={null} />}
          gate={<GateTrack items={[{ label: "Questions for you · 0", state: "done" }, { label: "Your questions to others · 2", state: "cur" }, { label: "Working now · 3" }]} />}>
          <section className="cu-card">
            <p className="cu-cardh"><b>Your questions to others</b><span className="cu-k">2</span></p>
            <p className="cu-tr"><i className="cu-av">A</i><span><b>Anna</b> · a passage in Usage-based billing</span><span className="cu-k">answered · suggests a change</span></p>
            <p className="cu-tr"><i className="cu-av amb">B</i><span><b>Ben</b> · Rate-limit the export API</span><span className="cu-k you">waiting a day · {at(2) ? "reminded just now" : "reminded 2 h ago"}</span><span className="cu-acts"><span className={`cu-btn sm${step === 1 ? " press" : ""}`}>Remind</span><span className="cu-btn sm">Hand to…</span></span></p>
          </section>
          <section className="cu-card">
            <p className="cu-cardh"><b>Working now</b><span className="cu-k">3</span></p>
            {([["A", "Billing retry schedule", "Implement · slice 2 of 3", "Codex", "work"], ["B", "API rate-limit tiers", "Implement · slice 3 of 3", "Claude Code", "work"], ["C", "Webhook signing v2", "Plan · waits for review", "Claude Code", "you"]] as const).map(([av, task, where, agent, mark]) => (
              <p key={task} className="cu-tr"><i className="cu-av">{av}</i><span><b>{task}</b></span><span className="cu-tw"><Mk k={mark} />{where}</span><span className="cu-k">{agent}</span></p>
            ))}
          </section>
          <p className="cu-fold"><b>Team activity</b><span className="cu-k">today · 2 Plans approved · 1 shipped · 5 answers</span><ChevronRight size={14} aria-hidden="true" /></p>
        </Frame>
      );

    case "together": {
      const ready = at(2);
      return (
        <Frame label="Review together"
          top={<TopBar stage={6} chip={waits("waits for your review")} />}
          gate={<GateTrack items={[{ label: "What you get · 3 points", state: "done" }, { label: "Teammates · 2", state: ready ? "done" : "cur", pips: [ready ? 2 : 1, 2] }, { label: "Approve", state: ready ? "cur" : undefined }]} turn={ready ? "Your turn · approve" : "Your turn · 1 comment"} />}>
          <YourTurn kind={ready ? "then the pull request" : "Comment from Anna · Done means 3"} title={ready ? "Ready to approve" : "Does every switch leave an audit entry?"}
            foot={ready ? <><span className="cu-votes"><span><b>Ben</b> approved</span><span><b>Anna</b> commented</span></span><span className="cu-grow" /><span className="cu-split glow"><span className="cu-btn pri">Approve</span><span className="cu-btn pri"><ChevronDown size={13} aria-hidden="true" /></span></span></> : <Keys keys={[["R", "reply"], ["E", "resolve"]]} />}>
            <div className="cu-proof">
              <p className="cu-k"><Mk k="check" />Done means 3 · Every billing-mode switch leaves an audit entry · screenshot 2</p>
              <ArtifactPage switched />
            </div>
            <section className="cu-th">
              <div className="cu-msg"><i className="cu-av">A</i><p><b>Anna</b> <span className="cu-k">teammate</span><br />Can Finance see the entry without opening the logs?</p></div>
              <div className={`cu-msg ${show(1)}`}><Mk k="done" /><p><b>Claude Code</b><br />Yes, each switch writes one entry, and the page shows the latest. Screenshot 2 proves it.</p></div>
            </section>
          </YourTurn>
        </Frame>
      );
    }

    case "settings":
      return (
        <Frame label="Settings"
          top={<TopBar stage={-1} title="Settings" kind="every project on this computer" chip={null} />}
          gate={<div className="cu-gt"><span className="cu-seg"><span>Workflow</span><span>Agents</span><span className="on">Usage</span><span>Sessions</span><span>About</span></span></div>}>
          <div className="cu-two">
            <div className="cu-col">
              <section className="cu-card cu-lim">
                <p className="cu-cardh"><b>Plan limits</b><span className="cu-k">checked 1 min ago</span></p>
                {LIMITS.map(([agent, windows]) => (
                  <div key={agent} className="cu-lim-a">
                    <p className="cu-lim-h"><b>{agent}</b></p>
                    {windows.map(([label, left, resets]) => (
                      <p key={label} className={`cu-lim-w${left < 25 ? " low" : ""}`}>
                        <span>{label}</span>
                        <span className="cu-lim-track"><i style={{ width: `${left}%` }} /></span>
                        <span>{left} %</span>
                        <span className="cu-k">{resets}</span>
                      </p>
                    ))}
                  </div>
                ))}
                <p className="cu-lim-note cu-k">Pi, OpenCode, Cursor, Grok and Antigravity don't report plan limits.</p>
                <p className="cu-set"><span>Resume when a limit resets<small>A stopped build continues by itself</small></span><span className="cu-sel">On</span></p>
                <p className={`cu-lim-note ${show(1)}`}>If Codex stops at its limit, the build continues when the window resets.</p>
              </section>
            </div>
            <section className="cu-card cu-cost">
              <p className="cu-cardh"><b>{TASK}</b><span className="cu-k">estimated at list price</span></p>
              <p className="cu-amt"><b>$20.95</b><span className="cu-k">1 h 17 min</span></p>
              <span className="cu-cbar">{COST.map(([label, , cost, color]) => <i key={label} style={{ background: color, flexGrow: Number(cost.slice(1)) }} />)}</span>
              {COST.map(([label, time, cost, color]) => (
                <p key={label} className="cu-ctr"><span><i style={{ background: color }} />{label}</span><span>{time}</span><span>{cost}</span></p>
              ))}
            </section>
          </div>
        </Frame>
      );

    case "agents":
      return (
        <Frame label="New task"
          top={<TopBar stage={-1} title="Home" kind="your tasks on this computer" chip={null} />}
          gate={<div className="cu-gt"><span className="cu-g done">Your turn · 1</span><span className="cu-g done">Running · 1</span><span className="cu-g done">Shipped · 4</span><span className="cu-grow" /><span className="cu-btn sm on"><Plus size={13} aria-hidden="true" />New task</span></div>}>
          <section className="cu-card cu-new">
            <p className="cu-cardh"><b>New task</b><span className="cu-k">starts in your coding agent</span></p>
            <div className="cu-newb">
              <span className="cu-seg cu-agent-seg"><span className="on">Claude Code</span><span>Codex</span><span>Cursor</span><span>Grok</span><span>Antigravity</span><span>Pi</span><span>OpenCode</span><span>Another agent</span></span>
              <span className="cu-field">{REQUEST}</span>
              <p className="cu-defs"><span><span className="cu-k">Model</span> Opus 5.5</span><span><span className="cu-k">Effort</span> High</span><span><span className="cu-k">Starts in</span> a new session</span><span className="cu-lnk">Change</span></p>
              <div className="cu-cmd"><code>Using QualityLayer, plan {REQUEST}</code><span className={`cu-btn pri sm${step === 1 ? " press" : ""}`}>{at(2) ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{at(2) ? "Copied" : "Copy request"}</span></div>
            </div>
          </section>
          <p className="cu-runs"><span className="cu-k">The App runs on</span><span>macOS</span><span>Windows</span><span>Linux</span><span className="cu-k">and opens in your browser on a server or in WSL</span></p>
          <p className={`cu-notif ${show(3)}`}><span aria-hidden="true" className="sx-mark" /><span><small>QualityLayer · from the menu bar</small>{TASK} needs your review</span><ArrowRight size={14} aria-hidden="true" /></p>
        </Frame>
      );

    default:
      return null;
  }
}
