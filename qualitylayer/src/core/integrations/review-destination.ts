export type ReviewProvider = "github" | "gitlab" | "bitbucket" | "other"
export type ReviewDestination = {
  provider: ReviewProvider
  host: string
  project: string
  web: string | null
}

/** Only browser destinations derived from network Git remotes may leave the app. */
export function reviewDestination(remote: string): ReviewDestination {
  const local: ReviewDestination = { provider: "other", host: "", project: "", web: null }
  const scp = /^(?:[\w.-]+@)?([\w.-]+):([^/\\].*)$/.exec(remote)
  let url: URL
  try {
    url = new URL(scp && !remote.includes("://") ? `ssh://${scp[1]}/${scp[2]}` : remote)
  } catch {
    return local
  }
  if (!["http:", "https:", "ssh:"].includes(url.protocol)) return local
  const host = url.hostname.toLowerCase()
  const prefix = host.split(".")[0]
  const provider =
    prefix === "github" || prefix === "gitlab" || prefix === "bitbucket" ? prefix : "other"
  const parts = url.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean)
  if (
    !host ||
    parts.length < 2 ||
    parts.some((part) => !/^[\w.~%-]+$/.test(part) || /%(?:2f|5c|2e)/i.test(part))
  )
    return local
  const ssh = url.protocol === "ssh:"
  const origin = ssh ? `https://${host}` : url.origin
  const scm = parts.indexOf("scm")
  const dataCenter = provider === "bitbucket" && host !== "bitbucket.org"
  const project = parts.slice(scm >= 0 && dataCenter ? scm + 1 : 0).join("/")
  const web =
    dataCenter && (scm >= 0 || ssh) && project.split("/").length === 2
      ? `${origin}/${[...parts.slice(0, Math.max(0, scm)), "projects", parts.at(-2), "repos", parts.at(-1), "browse"].join("/")}`
      : ssh && provider === "other"
        ? null
        : `${origin}/${parts.join("/")}`
  return { provider, host, project, web }
}
