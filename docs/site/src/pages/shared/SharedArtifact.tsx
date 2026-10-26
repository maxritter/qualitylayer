import { useEffect, useMemo, useRef, useState } from "react";
import { artifactMeta } from "@ql/core/artifact/format";
import { SharedArtifacts } from "@ql/ui/artifact/SharedArtifacts";
import { useTheme } from "@/hooks/useTheme";
import { newThreadId, type ArtifactRemark, type LoadedShare, type SubmitResult } from "@/lib/sharing/sharing";

type ArtifactShare = Extract<LoadedShare, { kind: "artifact" }>;
type Receipt = { id: string; label: string; text: string };
const receiptKey = (id: string) => `qualitylayer-artifact-receipts:${id}`;
function savedReceipts(id: string): Receipt[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(receiptKey(id)) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.slice(-200).filter((row): row is Receipt => row && typeof row.id === "string" && row.id.length <= 200 && typeof row.label === "string" && row.label.length <= 200 && typeof row.text === "string" && row.text.length <= 4000);
  } catch { return []; }
}

export function SharedArtifact({ share, onSend }: {
  share: ArtifactShare;
  onSend: (author: string, remark: ArtifactRemark) => Promise<SubmitResult>;
}) {
  const { payload } = share;
  const { theme } = useTheme();
  const [name, setName] = useState(() => { try { return localStorage.getItem("qualitylayer-guest-name") ?? ""; } catch { return ""; } });
  const [text, setText] = useState("");
  const [target, setTarget] = useState<{ page: string | null; title: string; revision: string }>({ page: null, title: "Whole artifact", revision: payload.revision });
  const [recipient, setRecipient] = useState<"agent" | "person">("agent");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState<Receipt[]>(() => savedReceipts(share.id));
  useEffect(() => { try { localStorage.setItem(receiptKey(share.id), JSON.stringify(sent.slice(-200))); } catch { /* Receipts are optional on this browser. */ } }, [share.id, sent]);
  const sending = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const targetRevision = !text && target.page === null ? payload.revision : target.revision;
  const stale = targetRevision !== payload.revision;
  const artboards = useMemo(() => payload.pages.map((page) => ({
    ...artifactMeta(page.html ?? "", page.doc), file: page.doc, title: page.title,
    html: page.html ?? "", image: page.image ?? "", needsCapture: false,
  })), [payload.pages]);
  const send = async () => {
    if (sending.current || !text.trim() || stale) return;
    sending.current = true;
    setBusy(true);
    setProblem("");
    const id = newThreadId();
    try {
      const result = await onSend(name, { id, page: target.page, revision: targetRevision, text: text.trim(), for: recipient });
      if (result.ok === false) {
        setProblem(result.reason === "gone" ? "This link no longer accepts feedback. Your words are kept." : result.reason === "rate_limited" ? "Wait a few minutes and try again. Your words are kept." : result.reason === "too_large" ? "Shorten your message and try again." : "Feedback could not be sent. Your words are kept; try again.");
        return;
      }
      setSent((old) => [...old, { id, label: target.title, text: text.trim() }]);
      setText("");
      try { localStorage.setItem("qualitylayer-guest-name", name.trim()); } catch { /* Optional name convenience. */ }
    } catch { setProblem("Feedback could not be sent. Your words are kept; try again."); }
    finally { sending.current = false; setBusy(false); }
  };
  return <div className="sh-layout">
    <header className="sh-heading"><h1>{payload.title}</h1><p className="sh-meta">{payload.owner ? `${payload.owner} shared this with you` : "Shared with you"} · View and give feedback</p></header>
    <article className="sh-main">
      <SharedArtifacts docs={{}} theme={theme} fit artboards={artboards} owner={payload.owner} onComment={(doc, title) => {
        const page = payload.pages.find((page) => page.doc === doc);
        if (!page || busy) return;
        setTarget({ page: page.id, title, revision: payload.revision }); setProblem(""); box.current?.focus();
      }} />
    </article>
    <aside className="sh-side"><section className="sh-card sh-artifact-feedback" aria-label="Artifact feedback">
      <h2>Feedback</h2>
      <p className="sh-target" role="status">{target.title}{target.page !== null || stale ? <> <button className="sh-link" type="button" disabled={busy} onClick={() => { setTarget({ page: null, title: "Whole artifact", revision: payload.revision }); setProblem(""); }}>Clear target</button></> : null}</p>
      <label className="sh-field">Your name<input value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label className="sh-field">Send to<select value={recipient} disabled={busy} onChange={(event) => setRecipient(event.target.value === "person" ? "person" : "agent")}><option value="agent">Agent</option><option value="person">{payload.owner ?? "The person who shared this"}</option></select></label>
      <label className="sh-field">Your feedback<textarea ref={box} value={text} maxLength={4000} disabled={busy} onChange={(event) => { if (!text && target.page === null) setTarget((old) => ({ ...old, revision: payload.revision })); setText(event.target.value); }} rows={5} /></label>
      {stale ? <p className="sh-problem" role="status">The shared version changed. Your draft is kept. Clear target or choose Give feedback to use the current version.</p> : null}
      {problem ? <p className="sh-problem" role="alert">{problem}</p> : null}
      <button type="button" className="sh-btn p" disabled={busy || stale || !text.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send feedback"}</button>
      {sent.length ? <div className="sh-sent" aria-label="Sent"><h3>Sent</h3>{sent.map((receipt) => {
        const thread = payload.threads.find((thread) => thread.remoteId.endsWith(`:${receipt.id}`));
        return <div className="sh-thread" key={receipt.id}><p><strong>{receipt.label}</strong>: {receipt.text}</p><p className="sh-hint">Sent</p>{thread?.replies.map((reply) => <p className="sh-reply" key={reply.id}><strong>{reply.author.name}</strong> · {reply.via === "agent" ? "via agent" : "in the App"}: {reply.text}</p>)}{thread?.state === "resolved" ? <p className="sh-hint">Resolved</p> : null}</div>;
      })}</div> : null}
    </section></aside>
  </div>;
}
