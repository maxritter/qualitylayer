// New task from a link (App Model: new-task-link): a GitHub or GitLab link in the request is read with
// the person's own gh or glab and its card shows before Start; a Jira or Confluence link shows as the
// link and its site, and the agent reads it with its own tools (QualityLayer keeps no logins). Start
// creates the task from the link (POST /api/tasks with `from`): the request holds the ticket's title
// and quoted text, or the link for the agent to read, the task keeps the link, and the planner starts.

import {
  CircleDotIcon,
  GitPullRequestIcon,
  LinkIcon,
  MessageSquareIcon,
  TicketIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { KIND_LABEL, parseTicketLink, type TicketLink } from "../core/integrations/links.ts"
import type { TicketPreview } from "../core/integrations/tickets.ts"
import { trimEndCharacters } from "../core/text-boundaries.ts"
import "./new-task-link.css"

/** The first ticket link in what the person typed, and their words without it. */
export function ticketIn(text: string): { link: TicketLink; words: string } | null {
  for (const match of text.matchAll(/https:\/\/\S+/g)) {
    const link = parseTicketLink(trimEndCharacters(match[0], ").,;"))
    if (link !== null) return { link, words: text.replace(match[0], "").trim() }
  }
  return null
}

export type TicketState =
  | { state: "none" }
  | { state: "reading"; link: TicketLink }
  | { state: "read"; link: TicketLink; ticket: TicketPreview }
  | { state: "unread"; link: TicketLink; problem: string }

async function answer<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    error?: { message?: string }
  }
  if (!response.ok || payload.ok !== true)
    throw new Error(payload.error?.message ?? "The App could not read the link.")
  return payload as T
}

/** The local API's ticket preview and the start from a link. */
export const ticketApi = {
  preview: (url: string, signal?: AbortSignal) =>
    fetch(`/api/integrations/ticket?url=${encodeURIComponent(url)}`, { signal })
      .then((response) => answer<{ ticket: TicketPreview }>(response))
      .then((body) => body.ticket),
  start: (input: { cwd: string; from: string; request: string; type: "feature" | "bugfix" }) =>
    fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then((response) => answer<{ id: string; task: string; created: boolean }>(response)),
}

export type TicketApi = typeof ticketApi

const linkOnly = (link: TicketLink) => link.kind === "jira" || link.kind === "confluence"

/** A Jira or Confluence link as the App shows it: the link and its site; nothing is read. */
const linkPreview = (link: TicketLink): TicketPreview => {
  const label = `${KIND_LABEL[link.kind]} ${link.ref}`
  return {
    kind: link.kind,
    url: link.url,
    label,
    title: label,
    bug: false,
    comments: 0,
    attachments: 0,
    linkOnly: true,
    host: link.host,
  }
}

/** Read the ticket a link in the request names, once the typing pauses. */
export function useTicket(text: string, api: TicketApi = ticketApi): TicketState {
  const found = ticketIn(text)
  const url = found?.link.url ?? null
  const [state, setState] = useState<TicketState>({ state: "none" })
  useEffect(() => {
    if (url === null) {
      setState({ state: "none" })
      return
    }
    const link = parseTicketLink(url) as TicketLink
    if (linkOnly(link)) {
      setState({ state: "read", link, ticket: linkPreview(link) })
      return
    }
    setState({ state: "reading", link })
    const abort = new AbortController()
    const timer = setTimeout(() => {
      api.preview(url, abort.signal).then(
        (ticket) => setState({ state: "read", link, ticket }),
        (cause: unknown) => {
          if (abort.signal.aborted) return
          setState({
            state: "unread",
            link,
            problem: cause instanceof Error ? cause.message : String(cause),
          })
        },
      )
    }, 350)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [url, api])
  return state
}

const ICON = "size-3.5 shrink-0"
const markOf = (link: TicketLink) =>
  link.kind === "github-pr" || link.kind === "gitlab-mr" ? (
    <GitPullRequestIcon className={ICON} aria-hidden="true" />
  ) : linkOnly(link) ? (
    <TicketIcon className={ICON} aria-hidden="true" />
  ) : (
    <CircleDotIcon className={ICON} aria-hidden="true" />
  )

/** One quiet line without a link; the ticket's card with one; what to do when it cannot be read. */
export function TicketCard({ ticket }: { ticket: TicketState }) {
  if (ticket.state === "none")
    return (
      <p className="q-nt-hint q-nt-tk-hint" data-testid="ticket-hint">
        <LinkIcon className={ICON} aria-hidden="true" />
        Paste a GitHub, GitLab, Jira or Confluence link to start from it
      </p>
    )
  const { link } = ticket
  if (ticket.state === "reading")
    return (
      <div className="q-nt-tk" data-testid="ticket-card" data-state="reading" role="status">
        <p className="q-nt-tk-head">
          {markOf(link)}
          <span className="q-nt-tk-title">Reading the {KIND_LABEL[link.kind]}…</span>
        </p>
      </div>
    )
  if (ticket.state === "unread")
    return (
      <div className="q-nt-tk off" data-testid="ticket-card" data-state="unread" role="status">
        <p className="q-nt-tk-head">
          <LinkIcon className={ICON} aria-hidden="true" />
          <span className="q-nt-tk-title">{ticket.problem}</span>
        </p>
        <p className="q-nt-tk-meta">
          Describe the work beside the link to start anyway; the task keeps the link
        </p>
      </div>
    )
  const { ticket: read } = ticket
  const ref = read.label.replace(KIND_LABEL[read.kind], "").trim()
  if (read.linkOnly)
    return (
      <div className="q-nt-tk" data-testid="ticket-card" data-state="link">
        <p className="q-nt-tk-head">
          {markOf(link)}
          <b>{ref}</b>
          <span className="q-nt-tk-title">{read.host}</span>
        </p>
        <p className="q-nt-tk-meta">
          {KIND_LABEL[read.kind]} · your agent reads it with its own tools
        </p>
      </div>
    )
  return (
    <div className="q-nt-tk" data-testid="ticket-card" data-state="read">
      <p className="q-nt-tk-head">
        {markOf(link)}
        <b>{ref}</b>
        <span className="q-nt-tk-title" title={read.title}>
          {read.title}
        </span>
      </p>
      <p className="q-nt-tk-meta">
        {read.bug ? <span className="q-nt-tk-label">bug</span> : null}
        <span>
          <MessageSquareIcon className="size-3" aria-hidden="true" />
          {read.comments}
        </span>
        <span>
          {KIND_LABEL[read.kind]} ·{" "}
          {read.kind.startsWith("github") ? "read with gh" : "read with glab"}
        </span>
      </p>
    </div>
  )
}
