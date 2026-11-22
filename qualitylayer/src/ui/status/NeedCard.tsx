// A need of the build (Answer in the App, turn 3): the one thing only the person can set. One
// compact card per need, "Only you can set this · the build goes on": what, why, how it is checked,
// at most two steps, "Don't paste the key here", a note field that refuses anything that looks like
// a key, "It's set" and "Later". Later changes nothing for the agent: the card folds to a line, the
// need stays open and the build goes on without it. Once the agent found it, a one-line receipt;
// when it did not, the same card says what it did not find.

import { CheckIcon, HourglassIcon, LockIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"
import { KEY_REFUSED, looksLikeKey } from "../../core/need/key.ts"
import type { Need } from "../../core/need/need.ts"
import { withoutNeedScope } from "../live-status.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

const KIND_WORD: Record<Need["kind"], string> = {
  secret: "a secret",
  login: "a login",
  account: "an account",
  service: "a paid service",
  permission: "a permission",
}

type Props = {
  need: Need
  /** The agent's name: "Codex keeps building", "Codex waits". */
  agent: string
  /** The task that waits for it, by its title in the Plan. */
  taskTitle: string | null
  /** Everything else is built: the next step after this one ("Then Verify starts"). */
  last: boolean
  /** Send "It's set" with the note; resolves false when it did not go through. */
  onSet: (note: string) => Promise<boolean>
  /** The narrow layout: the note and the button stack. */
  compact?: boolean
  /** Deferred external work is addressed in the person's review; saving a note is not check evidence. */
  review?: boolean
  evidence?: boolean
}

export function NeedCard({
  need,
  agent,
  taskTitle,
  last,
  onSet,
  compact = false,
  review = false,
  evidence = false,
}: Props) {
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  // Later: nothing is sent and nothing is closed; the card steps aside until the person sets it.
  const [later, setLater] = useState(false)
  const keyLike = looksLikeKey(note)
  // Inside a sentence an unnamed agent is "your agent"; Codex and Claude Code keep their names.
  const inline = /^(Your|The) agent$/.test(agent) ? agent.toLowerCase() : agent
  const waiting = need.waiting !== null
  const sent = need.state === "set"
  const send = async () => {
    if (keyLike || sending || (evidence && note.trim() === "")) return
    setSending(true)
    const done = await onSet(note)
    setSending(false)
    if (done) setNote("")
  }
  if (later && need.state === "open" && need.reopened === null)
    return (
      <section
        className="q-need q-need-later"
        data-testid="need-card"
        data-state="later"
        data-need={need.for}
        aria-label={need.what}
        id={`need-${need.for}`}
      >
        <i className="q-m q-m-you" aria-hidden="true" />
        <span>
          <b>{need.what}</b>
          {review
            ? " remains unverified for your review"
            : ` waits for you; ${inline} builds on without it`}
          {taskTitle !== null ? ` (${need.for} · ${taskTitle})` : ` (${need.for})`}.
          {review
            ? " Your work and its evidence remain visible."
            : " It stays in the sidebar until you set it."}
        </span>
        <button
          type="button"
          className="q-btn quiet sm"
          data-testid="need-set-now"
          onClick={() => setLater(false)}
        >
          Set it now
        </button>
      </section>
    )
  return (
    <section
      className="q-need"
      data-testid="need-card"
      data-need={need.for}
      aria-label={need.what}
      id={`need-${need.for}`}
    >
      <div className="q-need-h">
        <i className="q-m q-m-you" aria-hidden="true" />
        <span className="q-need-ht">
          <span className="q-need-lead">
            {review
              ? "Queued from the build · unverified"
              : "Only you can set this · the build goes on"}
          </span>
          <span className="t">{need.what}</span>
        </span>
        {compact ? null : (
          <span className="n">
            {need.for} · {KIND_WORD[need.kind]}
          </span>
        )}
        <span className="q-need-who">
          {review ? (
            "Check unverified"
          ) : waiting ? (
            <>
              <span className="q-need-live" aria-hidden="true" />
              {agent} waits
            </>
          ) : (
            <>
              <span className="q-st-spin" aria-hidden="true" />
              {agent} keeps building
            </>
          )}
        </span>
      </div>
      {need.reopened !== null && need.state === "open" ? (
        <div className="q-need-wait" data-testid="need-reopened">
          <TriangleAlertIcon className="q-need-i" aria-hidden="true" />
          <b>{agent} did not find it</b>
          <span>{need.reopened.why}</span>
        </div>
      ) : waiting && !review ? (
        <div className="q-need-wait" data-testid="need-waiting">
          <HourglassIcon className="q-need-i" aria-hidden="true" />
          <b>The build waits for this</b>
          <span>
            {last ? "Everything else is built. " : ""}Waiting since {clock(need.waiting ?? 0)}.
          </span>
        </div>
      ) : null}
      <div className="q-need-body">
        {need.why !== "" && !(compact && waiting) ? <p className="q-need-why">{need.why}</p> : null}
        {need.check !== null ? (
          <p className="q-need-check" data-testid="need-check">
            <span>Checked with</span> <code>{need.check}</code>
            <span>
              {review
                ? " · your note is saved; the agent must still check it"
                : ` · ${inline} checks it once you say it is set`}
            </span>
          </p>
        ) : null}
        {need.steps.length > 0 ? (
          <ol className="q-need-steps">
            {need.steps.map((step) => (
              <li key={step}>
                <InlineMarkdown text={step} />
              </li>
            ))}
          </ol>
        ) : null}
        {need.kind === "secret" ? (
          <div className="q-need-safe">
            <LockIcon className="q-need-i" aria-hidden="true" />
            Don't paste the key here. The App never takes secrets
            {compact ? "." : `; ${inline} reads it from your environment.`}
          </div>
        ) : null}
        {sent ? (
          <p className="q-need-why text-muted-foreground" data-testid="need-sent">
            {review
              ? `Note saved at ${clock(need.set?.at ?? 0)}. The check remains unverified until the agent checks it.`
              : `Sent at ${clock(need.set?.at ?? 0)}. ${agent} checks for it now.`}
          </p>
        ) : (
          <form
            className="q-need-act"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void send()
                }
              }}
              placeholder={
                evidence
                  ? "Paste relevant error lines or an evidence link"
                  : `A note for ${inline}, not the key (optional)`
              }
              aria-label={evidence ? "Evidence or link" : `A note for ${inline}, not the key`}
              aria-invalid={keyLike}
              aria-describedby={keyLike ? `need-key-${need.for}` : undefined}
              autoComplete="off"
              spellCheck={false}
              data-testid="need-note"
            />
            <button
              type="submit"
              className="q-btn primary"
              disabled={keyLike || sending || (evidence && note.trim() === "")}
              data-testid="need-done"
            >
              {evidence ? "Save evidence" : "It's set"}
              {compact ? null : <span className="q-need-kbd">⌘↵</span>}
            </button>
            {need.reopened === null ? (
              <button
                type="button"
                className="q-btn quiet"
                disabled={sending}
                data-testid="need-later"
                onClick={() => setLater(true)}
              >
                Later
              </button>
            ) : null}
          </form>
        )}
        {keyLike ? (
          <p className="q-need-key" id={`need-key-${need.for}`} role="alert" data-testid="need-key">
            {KEY_REFUSED.replace(".env.local", need.place ?? ".env.local")}.
          </p>
        ) : null}
      </div>
      {compact && waiting ? null : (
        <div className="q-need-foot">
          <span>Waits for it</span>
          <span className="on">
            {need.for}
            {taskTitle !== null ? ` · ${taskTitle}` : ""}
          </span>
          {compact ? null : (
            <span className="in">
              {last ? "Then Verify starts" : "The rest of the build goes on"}
            </span>
          )}
        </div>
      )}
    </section>
  )
}

/** A need the agent found: one line, with when the person set it and their note. */
export function NeedReceipt({ need, agent }: { need: Need; agent: string }) {
  return (
    <div className="q-need-receipt" data-testid="need-receipt">
      <CheckIcon className="q-need-i" aria-hidden="true" />
      <span>
        {withoutNeedScope(need.what)}
        {need.set !== null ? ` · set by you at ${clock(need.set.at)}` : ""}
      </span>
      <b>
        {agent} found {need.check ?? "it"}
      </b>
      {need.set !== null && need.set.note !== "" ? (
        <span className="q-dim">“{need.set.note}”</span>
      ) : null}
    </div>
  )
}
