import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useLocation, useParams } from "react-router-dom";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import type { StepComment } from "@ql/ui/steps/StepDocument";
import { Button } from "@ql/ui/components/ui/button";
import { Toaster } from "@ql/ui/components/ui/sonner";
import Page from "@/components/Page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sharedArtifactSources, SHARED_ARTIFACT_NAME } from "@ql/core/artifact/sharing";
import SEO from "@/components/SEO";
import { useTheme } from "@/hooks/useTheme";
import { addRemark, answerItem, type Drafts, EMPTY, pending, removeRemark, summary } from "@/lib/sharing/drafts";
import { contractsOf, mockupName, planBlocks, slicesOf, screenPairsOf } from "@/lib/sharing/plan";
import { ArtifactStill } from "./shared/Frame";
import { watchShare } from "@/lib/sharing/poll";
import { downloadMarkdown } from "@/lib/sharing/exports";
import {
  ALL_TABS,
  type ChangeAnchor,
  docOfStep,
  type GuestAnswer,
  type LoadedShare,
  linkKeyOf,
  newThreadId,
  type Remark,
  type ShareItem,
  type SubmitResult,
  stepDocs,
  submitRemarks,
  type Tab,
  tabOfStep,
  where,
} from "@/lib/sharing/sharing";
import { Asks } from "./shared/Asks";
import { Blocks } from "./shared/Blocks";
import { SharedDocument } from "./shared/SharedDocument";
import { SharedArtifacts } from "@ql/ui/artifact/SharedArtifacts";
import { ChangeView } from "./SharedChange";
import "@/styles/shared.css";
import { flowStepOf } from "@ql/core/flow";
import { PLAN_STILL, sharedDocuments, stripSharedCode } from "@ql/core/team/publication";

const NAME_KEY = "qualitylayer-guest-name";

function storedName(): string {
  try {
    return typeof window === "undefined" ? "" : (window.localStorage.getItem(NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

const REASONS: Record<Exclude<SubmitResult, { ok: true }>["reason"], string> = {
  gone: "This plan is no longer shared, so it cannot take feedback.",
  rate_limited: "Too much feedback from this connection. Wait a few minutes and try again.",
  too_large: "A feedback message is too long. Shorten it and try again.",
  network: "It could not be sent. Check your connection and try again.",
};

/** The seven steps, named as the App names them. */
const LABELS: Record<Tab, string> = {
  discuss: "Discuss",
  research: "Research",
  plan: "Plan",
  outline: "Outline",
  implement: "Implement",
  verify: "Verify",
  review: "Review",
};

/** What a step with nothing in this link says, in one sentence. */
const notThere = (tab: Tab) => `${LABELS[tab]} has not started yet.`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Text with `code` spans drawn as code. */
const Inline = ({ text }: { text: string }) => (
  <>
    {text.split(/(`[^`]+`)/).map((part, i) => (
      // The parts never reorder, so their position is their identity.
      // biome-ignore lint/suspicious/noArrayIndexKey: static split
      <Fragment key={i}>{part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code>{part.slice(1, -1)}</code> : part}</Fragment>
    ))}
  </>
);

/** Where the next comment goes: a quoted passage (or none), a point of the change, or a reply. */
type Target = { kind: "passage"; quote: string; doc?: string; artifact?: string } | { kind: "anchor"; anchor: ChangeAnchor } | { kind: "reply"; thread: string; label: string };

/** A comment that was sent, kept on the page so the reviewer sees what the owner got. */
type SentComment = {
  key: string;
  annotation?: string;
  thread?: string;
  label: string;
  text: string;
  replies: string[];
  /** A comment on a passage keeps the document and the words it was made on, to stay under them. */
  doc?: string;
  quote?: string;
  at?: number;
};

const receiptKey = (id: string) => `qualitylayer-share-receipts:${id}`;
function savedReceipts(id: string | undefined): SentComment[] {
  if (!id) return [];
  try {
    const data: unknown = JSON.parse(localStorage.getItem(receiptKey(id)) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.slice(-200).flatMap((c) => {
      if (!c || typeof c.key !== "string" || c.key.length > 200 || typeof c.annotation !== "string" || c.annotation.length > 200 ||
        typeof c.label !== "string" || c.label.length > 2000 || typeof c.text !== "string" || c.text.length > 4000 || !Array.isArray(c.replies)) return [];
      const placed = typeof c.doc === "string" && c.doc.length <= 200 && typeof c.quote === "string" && c.quote.length <= 1000;
      return [{ key: c.key, annotation: c.annotation, label: c.label, text: c.text,
        ...(placed ? { doc: c.doc, quote: c.quote, ...(typeof c.at === "number" ? { at: c.at } : {}) } : {}),
        replies: c.replies.filter((r: unknown): r is string => typeof r === "string" && r.length <= 4000).slice(-200) }];
    });
  } catch { return []; }
}

function passageLabel(remark: Extract<Remark, {kind: "passage"}>): string {
  const artifact = SHARED_ARTIFACT_NAME.test(remark.doc) || remark.doc === PLAN_STILL;
  if (artifact && !remark.quote) return `On ${remark.section || remark.doc.split("/").at(-1)}`;
  if (!remark.quote) return "General feedback";
  const quote = remark.quote.length > 80 ? `${remark.quote.slice(0, 80)}…` : remark.quote;
  return `“${quote}”`;
}

function labelOf(remark: Exclude<Remark, {kind: "item"}>, owner: string): string {
  if (remark.kind === "thread") return where(remark.anchor);
  if (remark.kind === "reply") return "Reply";
  const recipient = remark.for === "person" ? `Note for ${owner} · ` : "";
  return recipient + passageLabel(remark);
}

type ReadyShare = Extract<LoadedShare, { status: "ready" }>;

/** The step a link opens on: where the task is, else the furthest step with something in it. */
function firstTab(share: ReadyShare, steps: Record<Tab, string[]>): Tab {
  const own = flowStepOf(share.stage ?? "") ?? undefined;
  return own ?? [...ALL_TABS].reverse().find((tab) => steps[tab].length > 0) ?? "discuss";
}

/** Download beside the Reader's Sections and Copy: the document exactly as the link carries it. */
function DownloadMarkdown({ docs, name }: { docs: Record<string, string>; name: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-muted-foreground"
      aria-label="Download Markdown"
      onClick={() => (downloadMarkdown(docs, name) ? toast.success("Markdown download started.") : toast.error("Could not download. Try again."))}
    >
      <DownloadIcon />
      Download
    </Button>
  );
}

function Sections({ share, names, items, drafts, settled, onAnswer, commentsOn, onQuote, onSelected, shownArtifacts = [] }: {
  shownArtifacts?: readonly string[];
  share: ReadyShare;
  names: string[];
  items: ShareItem[];
  drafts: Drafts;
  settled: Record<string, string>;
  onAnswer: (id: string, answer: GuestAnswer | null, note?: string) => void;
  /** The comments made on one document, to show under their passages. */
  commentsOn: (name: string) => StepComment[];
  /** Start a comment on a passage of a document. */
  onQuote: (name: string, quote: string) => void;
  /** Words were selected in the contracts, which the Reader does not draw: they quote like a passage. */
  onSelected: (doc: string | undefined) => void;
}) {
  const details = names.filter((n) => /-details\.md$/.test(n));
  const main = names.filter((n) => !details.includes(n));
  const detailText = details.map((n) => share.docs[n] ?? "").join("\n\n");
  const slices = slicesOf(detailText);
  const tasks = slices.reduce((sum, s) => sum + s.tasks, 0);
  const contracts = contractsOf(detailText);
  const screens = main.some((name) => /review\.md$/.test(name)) ? screenPairsOf(share.docs, share.stills) : [];
  // A mockup that is a question is drawn there; the plan's own fence for it would draw it twice.
  const shown = new Set([...shownArtifacts.map(mockupName), ...items.flatMap((i) => (i.media?.kind === "artifact" ? [mockupName(i.media.name)] : []))]);
  return (
    <>
      <Asks items={items} owner={share.owner} docs={share.docs} stills={share.stills} drafts={drafts} settled={settled} onAnswer={onAnswer} />
      {screens.length > 0 ? <section className="sh-sec" aria-label="Screens compared">
        <h2>Screens compared</h2>
        {screens.map((screen) => <div key={`${screen.key}:${screen.width}:${screen.theme}`}>
          <h3>{screen.key}</h3>
          <p>{screen.width} px · {screen.theme} · {screen.outcome}{screen.stale ? " · stale: the artifact or build changed after capture" : ""}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {screen.image ? <ArtifactStill still={{ title: `Artifact ${screen.key}`, image: screen.image }} /> : <p>Artifact picture unavailable.</p>}
            {screen.outcome === "captured" && screen.built ? <ArtifactStill still={{ title: `Built ${screen.key}`, image: screen.built }} /> : <p>No built picture. {screen.outcome}</p>}
          </div>
          <p><b>Independent review</b> {screen.verdict}</p>
        </div>)}
      </section> : null}
      {main.map((name) => (
        // The document a selected passage is in, so a comment is filed against it.
        <div key={name} className="sh-docs" data-doc={name}>
          <SharedDocument
            name={name}
            markdown={share.docs[name] ?? ""}
            docs={share.docs}
            comments={commentsOn(name)}
            onQuote={(quote) => onQuote(name, quote)}
            extraTools={<DownloadMarkdown docs={share.docs} name={name} />}
            shown={shown}
          />
        </div>
      ))}
      {slices.length > 0 ? (
        <section className="sh-sec" aria-label="The build">
          <h2>{`The build · ${plural(slices.length, "slice", "slices")}, ${plural(tasks, "task", "tasks")}`}</h2>
          <ol className="sh-slices">
            {slices.map((s) => (
              <li key={s.n}>
                <span className="sh-num">{s.n}</span>
                <span className="sh-slice-t">
                  <Inline text={s.title} />
                </span>
                <span className="sh-slice-r">{plural(s.tasks, "task", "tasks")}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {contracts.length > 0 ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: selecting text is how a passage of the contracts is quoted
        <details className="sh-fold" data-doc={details[0]} onMouseUp={() => onSelected(details[0])}>
          <summary>
            <span className="sh-mark todo" aria-hidden="true" />
            <b>Contracts</b>
            <span className="sh-fold-line">{`${plural(contracts.length, "interface", "interfaces")} the build must keep, with their diffs`}</span>
            <span className="sh-chev" aria-hidden="true" />
          </summary>
          <div className="sh-fold-body">
            {contracts.map((c) => (
              <section key={c.title} className="sh-contract">
                <h3>
                  <Inline text={c.title} />
                </h3>
                <Blocks blocks={planBlocks(c.body)} docs={share.docs} />
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

/** A shared task: Discuss, Plan and Build, the owner's questions, and a place to answer and comment. */
function Ready({
  share,
  initialTab,
  onSend,
}: {
  share: ReadyShare;
  initialTab?: Tab;
  onSend: (author: string, remarks: Remark[]) => Promise<SubmitResult>;
}) {
  const steps = stepDocs(share.docs);
  const [tab, setTab] = useState<Tab>(initialTab ?? firstTab(share, steps));
  const [author, setAuthor] = useState(storedName);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [settled, setSettled] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<SentComment[]>(() => savedReceipts(share.id));
  useEffect(() => {
    if (!share.id) return;
    try { localStorage.setItem(receiptKey(share.id), JSON.stringify(sent.slice(-200))); } catch { /* receipts are a convenience */ }
  }, [sent, share.id]);
  const [target, setTarget] = useState<Target>({ kind: "passage", quote: "" });
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState<"agent" | "person">("agent");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [delivered, setDelivered] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const [askedName, setAskedName] = useState(false);
  const { theme } = useTheme();
  // When each unsent comment was written, for the time the Reader shows on it.
  const [written, setWritten] = useState<Record<string, number>>({});

  const who = share.owner ?? "the owner";
  const items = share.items;
  const drafted = summary(drafts, items);
  // What was sent still counts as answered.
  const counts = { ...drafted, answered: drafted.answered + items.filter((item) => settled[item.id] !== undefined).length };
  const waiting = pending(drafts, items);
  const expires = share.expires === undefined ? null : new Date(share.expires);
  const hasChange = share.review !== undefined;
  // On the change a comment belongs to a point of it; on a document it may be a general remark.
  const needsPoint = tab === "review" && hasChange && target.kind === "passage" && !target.artifact;

  const answer = (id: string, a: GuestAnswer | null, note?: string) => {
    setDelivered(false);
    setDrafts((d) => answerItem(d, id, a, note));
  };

  const pick = (anchor: ChangeAnchor) => {
    setTarget({ kind: "anchor", anchor });
    box.current?.focus();
  };

  // A passage chosen in a document starts a comment on it, as the + and the selection do in the App.
  const quote = (doc: string, passage: string) => {
    setTarget({ kind: "passage", quote: passage.slice(0, 1000), doc });
    box.current?.focus();
  };

  const quoteSelection = (doc: string | undefined) => {
    const picked = window.getSelection()?.toString().trim() ?? "";
    if (picked !== "") setTarget({ kind: "passage", quote: picked.slice(0, 1000), doc });
  };

  // Every comment on a passage stays under it, sent or not, as the App shows a comment.
  const commentsOn = useMemo(() => {
    const byDoc = new Map<string, StepComment[]>();
    const put = (doc: string, comment: StepComment) => byDoc.set(doc, [...(byDoc.get(doc) ?? []), comment]);
    for (const c of sent) if (c.doc !== undefined && c.quote) put(c.doc, { id: c.key, doc: c.doc, quote: c.quote, remark: c.text, created: c.at ?? 0 });
    for (const r of drafts.remarks)
      if (r.kind === "passage" && r.quote !== "") put(r.doc, { id: r.id ?? `draft-${r.text}`, doc: r.doc, quote: r.quote, remark: r.text, created: written[r.id ?? ""] ?? 0 });
    return (doc: string) => byDoc.get(doc) ?? [];
  }, [sent, drafts.remarks, written]);

  const add = () => {
    const remark: Drafts["remarks"][number] =
      target.kind === "passage"
        ? { kind: "passage", id: crypto.randomUUID(), doc: target.doc ?? steps[tab][0] ?? docOfStep(tab), quote: target.quote, text, ...(target.artifact ? { section: target.artifact } : {}), ...(recipient === "person" ? { for: "person" as const } : {}) }
        : target.kind === "anchor"
          ? { kind: "thread", thread: newThreadId(), anchor: target.anchor, text }
          : { kind: "reply", thread: target.thread, text };
    if (remark.kind === "passage" && remark.id !== undefined) {
      const id = remark.id;
      setWritten((w) => ({ ...w, [id]: Date.now() }));
    }
    setDelivered(false);
    setDrafts((d) => addRemark(d, remark));
    setText("");
    setTarget({ kind: "passage", quote: "" });
  };

  const send = async () => {
    if (waiting.length === 0) return;
    // Below the page (a phone), the name field is out of sight: ask for it once, where it is, before sending as Guest.
    const field = nameBox.current;
    if (author.trim() === "" && !askedName && field !== null) {
      const { top, bottom } = field.getBoundingClientRect();
      if (top < 0 || bottom > window.innerHeight) {
        setAskedName(true);
        field.scrollIntoView({ block: "center" });
        field.focus({ preventScroll: true });
        return;
      }
    }
    setBusy(true);
    setProblem("");
    const result = await onSend(author, waiting);
    setBusy(false);
    if (result.ok === false) {
      setProblem(REASONS[result.reason]);
      return;
    }
    try {
      window.localStorage.setItem(NAME_KEY, author.trim());
    } catch {
      // the name is a convenience only
    }
    setSettled((s) => ({ ...s, ...Object.fromEntries(waiting.flatMap((r) => (r.kind === "item" ? [[r.id, r.label]] : []))) }));
    setSent((list) => {
      let next = list;
      for (const r of waiting) {
        if (r.kind === "item") continue;
        if (r.kind === "reply") next = next.map((c) => (c.thread === r.thread ? { ...c, replies: [...c.replies, r.text] } : c));
        else next = [...next, {
          key: r.kind === "passage" ? r.id ?? newThreadId() : r.thread,
          ...(r.kind === "passage" ? { annotation: r.id, ...(r.quote !== "" || SHARED_ARTIFACT_NAME.test(r.doc) || r.doc === PLAN_STILL ? { doc: r.doc, quote: r.quote, at: written[r.id ?? ""] ?? Date.now() } : {}) } : {}),
          thread: r.kind === "thread" ? r.thread : undefined, label: labelOf(r, who), text: r.text, replies: [],
        }];
      }
      return next;
    });
    setDrafts(EMPTY);
    setDelivered(true);
  };

  const gallery = useMemo(() => {
    const stills: Record<string, {title?: string; image: string}> = {...share.stills};
    const picture = share.docs[PLAN_STILL];
    const files = [...new Set([...Object.keys(sharedArtifactSources(share.docs)), ...Object.keys(stills).filter(name => SHARED_ARTIFACT_NAME.test(name))])];
    const mapped = files.length > 0 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(picture ?? "");
    if (mapped) stills[PLAN_STILL] = {title:"Plan artifact",image:picture};
    if (mapped) files.push(PLAN_STILL);
    return {stills, files, mapped};
  }, [share.docs, share.stills]);
  const artifactCount = gallery.files.length;
  const [surface, setSurface] = useState(() => artifactCount ? "artifacts" : "workflow");
  const stepsNav = useRef<HTMLElement>(null);
  const feedbackPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (surface === "workflow") stepsNav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab, surface]);
  const names = steps[tab];
  const tabItems = items.filter((item) => tabOfStep(item.step) === tab);
  const count = `${counts.total > 0 ? `${counts.answered} of ${counts.total} answered · ` : ""}${plural(counts.comments, "feedback message", "feedback messages")}`;

  return (
    <Tabs value={artifactCount ? surface : "workflow"} onValueChange={setSurface} className="sh-layout">
        <header className="sh-heading">
          <h1>{share.title}</h1>
          <p className="sh-meta">
            {`${share.owner !== undefined ? `${share.owner} shared this with you` : "Shared with you"} to read and give feedback on${
              expires !== null ? ` · the link runs out on ${expires.toLocaleDateString("en-US", { day: "numeric", month: "short" })}` : ""
            } · project source code is kept private`}
          </p>
          <div className="sh-heading-tools"><TabsList className="sh-surfaces"><TabsTrigger value="workflow">Workflow</TabsTrigger>{artifactCount ? <TabsTrigger value="artifacts">Artifacts <span className="sh-tab-count">{artifactCount}</span></TabsTrigger> : null}</TabsList><button type="button" className="sh-btn sh-feedback-jump" onClick={() => { feedbackPanel.current?.scrollIntoView({ block: "start" }); feedbackPanel.current?.focus({ preventScroll: true }); }}>Jump to feedback</button></div>
        </header>
      <article className="sh-main" data-testid="shared-doc"><TabsContent value="workflow">

          <nav ref={stepsNav} className="sh-tabs" aria-label="Steps">
            {ALL_TABS.map((id) => (
              <button key={id} type="button" aria-current={id === tab ? "page" : undefined} onClick={() => setTab(id)}>
                {LABELS[id]}
              </button>
            ))}
          </nav>
        <div className="sh-body">

          {tab === "review" && hasChange ? (
            <>
              <Sections share={share} names={names} items={tabItems} drafts={drafts} settled={settled} onAnswer={answer} commentsOn={commentsOn} onQuote={quote} onSelected={quoteSelection} shownArtifacts={gallery.files} />
              <ChangeView review={share.review as NonNullable<typeof share.review>} onPick={pick} />
            </>
          ) : names.length > 0 || tabItems.length > 0 ? (
            <>
              {tab === "plan" && !gallery.mapped && share.docs[PLAN_STILL] !== undefined ? (
                <figure className="sh-frame" data-testid="shared-plan-still">
                  <figcaption className="sh-frame-bar">Plan artifact · still image</figcaption>
                  <img src={share.docs[PLAN_STILL]} alt="Plan artifact" className="block h-auto w-full" />
                </figure>
              ) : null}
              <Sections share={share} names={names} items={tabItems} drafts={drafts} settled={settled} onAnswer={answer} commentsOn={commentsOn} onQuote={quote} onSelected={quoteSelection} shownArtifacts={gallery.files} />
            </>
          ) : (
            <p className="sh-empty">{notThere(tab)}</p>
          )}
        </div>
        </TabsContent>
        <TabsContent value="artifacts" className="sh-artboards"><SharedArtifacts docs={share.docs} theme={theme} fit stills={gallery.stills} owner={who} comments={sent.flatMap(c => c.doc ? [{id:c.key,doc:c.doc,remark:c.text,author:author || "Guest"}] : [])} onComment={(file,title) => { setTarget({kind:"passage",quote:"",doc:file,artifact:title}); box.current?.focus(); }} /></TabsContent>
      </article>

      <aside ref={feedbackPanel} tabIndex={-1} className="sh-side" aria-label="Your answers and feedback"><header className="sh-feedback-heading"><h2>Your feedback</h2></header>
        <section className="sh-card">
          <label htmlFor="sh-author">
            <b>Your name</b>
          </label>
          <input id="sh-author" ref={nameBox} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Guest" maxLength={80} autoComplete="name" />
          <span className="sh-hint">
            {askedName && author.trim() === ""
              ? "Add a name so the owner knows who wrote this, or press Send again to send as Guest."
              : "Shown next to your feedback. No account needed."}
          </span>
        </section>

        <section className="sh-card" aria-label="Feedback">
          <label htmlFor="sh-remark">
            <b>Feedback</b>
          </label>
          {target.kind === "passage" ? <>
            <div className="sh-row" role="group" aria-label="Recipient">
              <button type="button" className="sh-btn" style={{ color: "var(--ql-text)" }} aria-pressed={recipient === "agent"} onClick={() => setRecipient("agent")}>For the agent</button>
              <button type="button" className="sh-btn" style={{ color: "var(--ql-text)" }} aria-pressed={recipient === "person"} onClick={() => setRecipient("person")}>For {who}</button>
            </div>
            {recipient === "person" ? <p className="sh-hint">A note for {who} stays between people. The agent never reads it; {who} can quote it to the agent.</p> : null}
          </> : null}
          {target.kind === "passage" && (target.artifact || target.quote !== "") ? (
            <blockquote className="sh-quote">
              {target.artifact ? `On ${target.artifact}` : target.quote}
              <button type="button" onClick={() => setTarget({ kind: "passage", quote: "" })}>
                {target.artifact ? "Change target" : "Drop quote"}
              </button>
            </blockquote>
          ) : target.kind === "anchor" || target.kind === "reply" ? (
            <blockquote className="sh-quote">
              {target.kind === "reply" ? `Reply on ${target.label}` : `${where(target.anchor)}${target.anchor.quote ? `: ${target.anchor.quote}` : ""}`}
              <button type="button" onClick={() => setTarget({ kind: "passage", quote: "" })}>
                Cancel
              </button>
            </blockquote>
          ) : (
            <span className="sh-hint">
              {needsPoint ? "Choose Give feedback beside a point, a check or a picture." : "Select a passage to give feedback on it, or leave a general message."}
            </span>
          )}
          <textarea id="sh-remark" ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <div className="sh-row">
            <button type="button" className="sh-btn" disabled={text.trim() === "" || needsPoint} onClick={add}>
              Add feedback
            </button>
          </div>
          {drafts.remarks.length > 0 ? (
            <ul className="sh-drafts" aria-label="Feedback not sent yet">
              {drafts.remarks.map((r, i) => (
                // A draft is told apart by its place in the list, and only removal reorders it.
                // biome-ignore lint/suspicious/noArrayIndexKey: removal re-keys the rest
                <li key={i}>
                  <span className="sh-draft-label">{labelOf(r, who)}</span>
                  <span>{r.text}</span>
                  <button type="button" className="sh-link" onClick={() => setDrafts((d) => removeRemark(d, i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="sh-card sh-done" aria-label="Send">
          {!delivered ? <><b>When you are done</b><span>{count}</span></> : null}
          {problem !== "" ? (
            <p className="sh-problem" role="alert">
              {problem}
            </p>
          ) : null}
          {!delivered ? <div className="sh-row">
            <button type="button" className="sh-btn p" disabled={busy || waiting.length === 0} onClick={() => void send()}>
              {busy ? "Sending…" : problem ? "Try again" : `Send to ${who}`}
            </button>
          </div> : null}
          {delivered ? (
            <p className="sh-delivered" role="status">
              {`Sent to ${who}.`}
            </p>
          ) : null}
          {!delivered ? <span className="sh-hint">{`Approving is for ${who}'s team, in the App.`}</span> : null}
          {sent.length > 0 ? (
            <div className="sh-sent" aria-label="Sent">
              <h3>Already sent</h3>
              {sent.map((c) => {
                const update = c.annotation ? share.threads?.find((t) => t.remoteId.endsWith(`:${c.annotation}`)) : undefined;
                return (
                <div key={c.key} className="sh-thread">
                  <p>
                    <strong>{c.label}</strong>: {c.text}
                  </p>
                  {c.replies.map((r, i) => (
                    // Replies only ever append, so their position is their identity.
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                    <p key={i} className="sh-reply">
                      {r}
                    </p>
                  ))}
                  {update?.replies.map((r) => <p className="sh-reply" key={r.id}><strong>{r.author.name}</strong> · {r.via === "agent" ? "via agent" : "in the App"}: {r.text}</p>)}
                  {update?.state === "resolved" ? <p className="sh-hint">Resolved</p> : null}
                  {c.thread !== undefined ? (
                    <button
                      type="button"
                      className="sh-link"
                      onClick={() => {
                        setTarget({ kind: "reply", thread: c.thread as string, label: c.label });
                        box.current?.focus();
                      }}
                    >
                      Reply
                    </button>
                  ) : null}
                </div>
              ); })}
            </div>
          ) : null}
        </section>
      </aside>

      {waiting.length > 0 ? (
        <div className="sh-bar">
          <span className={problem ? "sh-problem" : undefined}>{problem || count}</span>
          <button type="button" className="sh-btn p" disabled={busy} onClick={() => void send()}>
            {busy ? "Sending…" : problem ? "Try again" : `Send to ${who}`}
          </button>
        </div>
      ) : null}
      <Toaster theme={theme} position="bottom-center" />
    </Tabs>
  );
}

/** What the page shows for each state of the link; a plain function of its state. */
export function SharedView({
  state,
  onSend,
  tab,
}: {
  state: LoadedShare | { status: "loading" };
  onSend: (author: string, remarks: Remark[]) => Promise<SubmitResult>;
  /** The step to open on; the first one with something in it when absent. */
  tab?: Tab;
}) {
  if (state.status === "loading") return <p className="sh-status">Loading the task…</p>;
  if (state.status === "gone") {
    return (
      <div className="sh-status">
        <h1>This task is no longer shared</h1>
        <p>The owner stopped sharing it, or the link ran out. Ask them for a new link.</p>
      </div>
    );
  }
  if (state.status === "no-key") {
    return (
      <div className="sh-status">
        <h1>This link is missing its key</h1>
        <p>
          The plan is encrypted, and the key is the part of the link after the “#”. Ask the owner for the whole link,
          or copy it again with everything up to the end.
        </p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="sh-status">
        <h1>The task could not be opened</h1>
        <p>{state.message}</p>
      </div>
    );
  }
  return <Ready key={state.id} share={{ ...state, title: stripSharedCode(state.title), docs: sharedDocuments(state.docs, state.stage), items: [], review: undefined }} initialTab={tab} onSend={onSend} />;
}

/** One link's page; keyed by the id and key, so another link starts from "loading" again. */
export const SharedLink = ({ id, linkKey }: { id: string; linkKey: string }) => {
  const [state, setState] = useState<LoadedShare | { status: "loading" }>({ status: "loading" });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => watchShare(id, linkKey, setState, setProblem), [id, linkKey]);

  return <>{problem !== null ? <p className="sh-hint" role="status">{problem}</p> : null}<SharedView state={state} onSend={(author, remarks) => submitRemarks(id, linkKey, author, remarks)} /></>;
};

const Shared = () => {
  const { id = "" } = useParams<{ id?: string }>();
  // The key is the link's fragment: the browser never sends it to the server.
  const key = linkKeyOf(useLocation().hash);
  return (
    <Page className="sh-page" compact>
      <SEO title="A shared task — QualityLayer" description="A task shared with you from QualityLayer. Read its steps and give feedback on them." />
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <SharedLink key={`${id}#${key}`} id={id} linkKey={key} />
    </Page>
  );
};

export default Shared;
