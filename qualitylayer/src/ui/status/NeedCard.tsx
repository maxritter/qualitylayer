// A need of the build (Answer in the App, turn 3): the one thing only the person can set. One
// compact card per need, "Only you can set this · the build goes on": what, why, how it is checked,
// at most two steps, "Don't paste the key here", a note field that refuses anything that looks like
// a key, "It's set" and "Later". Later changes nothing for the agent: the card folds to a line, the
// need stays open and the build goes on without it. Once the agent found it, a one-line receipt;
// when it did not, the same card says what it did not find.

import { CheckIcon } from "lucide-react"
import { useState } from "react"
import { looksLikeKey } from "../../core/need/key.ts"
import type { Need } from "../../core/need/need.ts"
import { withoutNeedScope } from "../live-status.ts"
import {
  formatNeedClock,
  NeedCardBanner,
  NeedCardDetails,
  NeedCardForm,
  NeedCardLater,
} from "./NeedCardParts.tsx"

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

function NeedWhoStatus({
  review,
  waiting,
  agent,
}: {
  review: boolean
  waiting: boolean
  agent: string
}) {
  if (review) return "Check unverified"
  if (waiting) {
    return (
      <>
        <span className="q-need-live" aria-hidden="true" />
        {agent} waits
      </>
    )
  }
  return (
    <>
      <span className="q-st-spin" aria-hidden="true" />
      {agent} keeps building
    </>
  )
}

function NeedCardHeader({
  need,
  agent,
  compact,
  review,
  waiting,
}: {
  need: Need
  agent: string
  compact: boolean
  review: boolean
  waiting: boolean
}) {
  return (
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
        <NeedWhoStatus review={review} waiting={waiting} agent={agent} />
      </span>
    </div>
  )
}

function NeedCardFooter({
  need,
  taskTitle,
  compact,
  waiting,
  last,
}: {
  need: Need
  taskTitle: string | null
  compact: boolean
  waiting: boolean
  last: boolean
}) {
  if (compact && waiting) return null
  return (
    <div className="q-need-foot">
      <span>Waits for it</span>
      <span className="on">
        {need.for}
        {taskTitle !== null ? ` · ${taskTitle}` : ""}
      </span>
      {compact ? null : (
        <span className="in">{last ? "Then Verify starts" : "The rest of the build goes on"}</span>
      )}
    </div>
  )
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
  if (later && need.state === "open" && need.reopened === null) {
    return (
      <NeedCardLater
        need={need}
        inline={inline}
        taskTitle={taskTitle}
        review={review}
        onExpand={() => setLater(false)}
      />
    )
  }
  const sentMessage = review
    ? `Note saved at ${formatNeedClock(need.set?.at ?? 0)}. The check remains unverified until the agent checks it.`
    : `Sent at ${formatNeedClock(need.set?.at ?? 0)}. ${agent} checks for it now.`
  return (
    <section
      className="q-need"
      data-testid="need-card"
      data-need={need.for}
      aria-label={need.what}
      id={`need-${need.for}`}
    >
      <NeedCardHeader
        need={need}
        agent={agent}
        compact={compact}
        review={review}
        waiting={waiting}
      />
      <NeedCardBanner need={need} agent={agent} waiting={waiting} review={review} last={last} />
      <div className="q-need-body">
        <NeedCardDetails
          need={need}
          inline={inline}
          compact={compact}
          waiting={waiting}
          review={review}
        />
        {sent ? (
          <p className="q-need-why text-muted-foreground" data-testid="need-sent">
            {sentMessage}
          </p>
        ) : (
          <NeedCardForm
            need={need}
            inline={inline}
            note={note}
            keyLike={keyLike}
            sending={sending}
            compact={compact}
            evidence={evidence}
            onNote={setNote}
            onSend={() => void send()}
            onLater={() => setLater(true)}
          />
        )}
      </div>
      <NeedCardFooter
        need={need}
        taskTitle={taskTitle}
        compact={compact}
        waiting={waiting}
        last={last}
      />
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
        {need.set !== null ? ` · set by you at ${formatNeedClock(need.set.at)}` : ""}
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
