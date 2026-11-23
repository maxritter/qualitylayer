// What a pasted link names: a GitHub issue or pull request, a GitLab issue or merge request, a Jira
// issue or a Confluence page. Only https links, without a user name or password in them; anything
// else is not a ticket QualityLayer reads.

export type LinkKind =
  | "github-issue"
  | "github-pr"
  | "gitlab-issue"
  | "gitlab-mr"
  | "jira"
  | "confluence"

export type TicketLink = {
  kind: LinkKind
  /** The link as given, without its fragment. */
  url: string
  /** The site's host name, lower case (`github.com`, `acme.atlassian.net`). */
  host: string
  /** GitHub `owner/repo`, GitLab `group/…/project`; absent for Jira and Confluence. */
  repo?: string
  /** Issue or pull/merge request number, Jira key or Confluence page id. */
  ref: string
}

/** How the App and the replies name a link's kind. */
export const KIND_LABEL: Record<LinkKind, string> = {
  "github-issue": "GitHub issue",
  "github-pr": "GitHub pull request",
  "gitlab-issue": "GitLab issue",
  "gitlab-mr": "GitLab merge request",
  jira: "Jira issue",
  confluence: "Confluence page",
}

const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,30}-\d{1,9}$/

type LinkBase = { url: string; host: string }

function parseGitHubLink(base: LinkBase, parts: string[]): TicketLink | null {
  const [owner, repo, what, number] = parts
  if (!owner || !repo || !/^\d+$/.test(number ?? "")) return null
  if (what !== "issues" && what !== "pull") return null
  return {
    ...base,
    kind: what === "issues" ? "github-issue" : "github-pr",
    repo: `${owner}/${repo}`,
    ref: number as string,
  }
}

// GitLab, on gitlab.com or the person's own server: …/<group>/<project>/-/issues/<n>.
function parseGitLabLink(base: LinkBase, parts: string[]): TicketLink | null {
  const dash = parts.indexOf("-")
  if (dash < 2) return null
  const what = parts[dash + 1]
  const number = parts[dash + 2] ?? ""
  if ((what !== "issues" && what !== "merge_requests") || !/^\d+$/.test(number)) return null
  return {
    ...base,
    kind: what === "issues" ? "gitlab-issue" : "gitlab-mr",
    repo: parts.slice(0, dash).join("/"),
    ref: number,
  }
}

// Jira: …/browse/<KEY-1>, or a board with ?selectedIssue=<KEY-1>.
function parseJiraLink(base: LinkBase, parts: string[], url: URL): TicketLink | null {
  const browse = parts.indexOf("browse")
  const key = browse >= 0 ? parts[browse + 1] : (url.searchParams.get("selectedIssue") ?? undefined)
  if (key === undefined || !JIRA_KEY.test(key)) return null
  return { ...base, kind: "jira", ref: key }
}

// Confluence: …/wiki/spaces/<space>/pages/<id>/<title>, or viewpage.action?pageId=<id>.
function parseConfluenceLink(base: LinkBase, parts: string[], url: URL): TicketLink | null {
  if (parts[0] !== "wiki") return null
  const pages = parts.indexOf("pages")
  const id = pages >= 0 ? parts[pages + 1] : (url.searchParams.get("pageId") ?? undefined)
  if (id === undefined || !/^\d{1,20}$/.test(id)) return null
  return { ...base, kind: "confluence", ref: id }
}

/** The ticket a link names, or null when it is not one QualityLayer reads. */
export function parseTicketLink(text: string): TicketLink | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null
  url.hash = ""
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split("/").filter((part) => part !== "")
  const base: LinkBase = { url: url.toString(), host }
  if (host === "github.com" || host === "www.github.com") return parseGitHubLink(base, parts)
  return (
    parseGitLabLink(base, parts) ??
    parseJiraLink(base, parts, url) ??
    parseConfluenceLink(base, parts, url)
  )
}

/** The short name of the ticket: `#241`, `!12`, `INFRA-11292`, `page 98765`. */
export function shortRef(link: TicketLink): string {
  if (link.kind === "gitlab-mr") return `!${link.ref}`
  if (link.kind === "jira") return link.ref
  if (link.kind === "confluence") return `page ${link.ref}`
  return `#${link.ref}`
}
