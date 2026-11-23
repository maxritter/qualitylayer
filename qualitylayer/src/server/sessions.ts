// How a browser holds access without the key travelling in links. A local pairing capability (made by
// the CLI over the key-guarded API) is exchanged for a session cookie; the cookie holds a random
// session id, never the key, so one leaked cookie is revoked without rotating the key. The ids
// are kept as hashes in an owner-only file, so a restart keeps every paired browser.

import { createHash, randomBytes } from "node:crypto"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"

/** The session cookie's name before the server's identity is appended. */
const SESSION_COOKIE_PREFIX = "ql_key"

/**
 * The name of the session cookie of the server that holds `token`. A browser keeps cookies per host
 * name, not per port, so two Cockpits on one machine (another home, a second user, a test) would
 * overwrite each other's cookie under one shared name and sign each other's pages out (401). The
 * name carries a short hash of the server's key: the same home keeps one name across restarts and
 * port forwards, another home gets its own.
 */
export const sessionCookieName = (token: string): string =>
  `${SESSION_COOKIE_PREFIX}_${createHash("sha256").update(token).digest("hex").slice(0, 12)}`

/** "Remember this browser": the cookie's lifetime, and the longest a session is honoured. */
export const REMEMBER_SECONDS = 30 * 24 * 60 * 60
const SESSION_MS = REMEMBER_SECONDS * 1000
/** More pairings than this drop the oldest: a session per `qualitylayer app` call must not pile up. */
const MAX_SESSIONS = 50
const MAX_CODES = 4

/** The Set-Cookie value that gives a browser its session: kept 30 days when remembered, else until it closes. */
export const sessionCookie = (id: string, remember: boolean, token: string): string =>
  `${sessionCookieName(token)}=${id}; Path=/; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${REMEMBER_SECONDS}` : ""}`

type Kept = { hash: string; at: number; keyPaired?: boolean }
type Pairing = { code: string; remember: boolean; keyPaired: boolean; server: string }
export type SessionAuthority = { keyPaired: boolean; expiresAt: number }

const hashOf = (id: string) => createHash("sha256").update(id).digest("hex")
const sessionsPath = (ctx: Ctx) => join(ctx.home, "cockpit.sessions")

function isValidPairing(entry: Pairing | undefined): entry is Pairing {
  if (!entry) return false
  if (typeof entry.remember !== "boolean" || typeof entry.keyPaired !== "boolean") return false
  return /^[A-Za-z0-9_-]{43}$/.test(entry.code) && /^[a-f0-9]{64}$/.test(entry.server)
}

export class Sessions {
  private codes = new Map<string, Pairing>()
  private server: string | undefined
  private listeners = new Set<() => void>()

  constructor(
    private ctx: Ctx,
    private kept: Kept[] = [],
    pairings: Pairing[] = [],
  ) {
    for (const entry of pairings.slice(0, MAX_CODES)) {
      if (!isValidPairing(entry)) continue
      const duplicate = [...this.codes.values()].some(
        (held) =>
          held.server === entry.server &&
          held.remember === entry.remember &&
          held.keyPaired === entry.keyPaired,
      )
      if (!duplicate) this.codes.set(entry.code, entry)
    }
  }

  bindServer(token: string): void {
    this.server = hashOf(token)
    for (const [code, entry] of this.codes)
      if (entry.server !== this.server) this.codes.delete(code)
  }

  /** Reuse one local link per authority; only explicit revocation or a new server identity ends it. */
  async pair(remember: boolean, keyPaired = false): Promise<string> {
    if (!this.server) throw new Error("Pairing has no server identity")
    for (const entry of this.codes.values())
      if (entry.remember === remember && entry.keyPaired === keyPaired) {
        await this.savePairings()
        return entry.code
      }
    const code = randomBytes(32).toString("base64url")
    this.codes.set(code, { code, remember, keyPaired, server: this.server })
    await this.savePairings()
    return code
  }

  /** Opening a saved local link preserves its original authority. */
  redeem(code: string): { remember: boolean; keyPaired: boolean } | null {
    const found = this.codes.get(code)
    return found !== undefined && found.server === this.server
      ? { remember: found.remember, keyPaired: found.keyPaired }
      : null
  }

  /** A new session: its id goes into the cookie, its hash stays here. */
  async start(keyPaired = false): Promise<string> {
    const id = randomBytes(32).toString("base64url")
    this.kept = [...this.kept, { hash: hashOf(id), at: this.ctx.clock.now(), keyPaired }].slice(
      -MAX_SESSIONS,
    )
    this.changed()
    await this.save()
    return id
  }

  authority(id: string): SessionAuthority | null {
    return this.authorityHash(hashOf(id))
  }

  authorityProof(id: string): string | null {
    return this.server && this.authority(id) ? `${this.server}:${hashOf(id)}` : null
  }

  proofAuthority(proof: string): SessionAuthority | null {
    const [server, hash] = proof.split(":")
    return server === this.server && hash !== undefined && /^[a-f0-9]{64}$/.test(hash)
      ? this.authorityHash(hash)
      : null
  }

  private authorityHash(hash: string): SessionAuthority | null {
    const now = this.ctx.clock.now()
    const session = this.kept.find(
      (session) => session.hash === hash && now - session.at < SESSION_MS,
    )
    return session === undefined
      ? null
      : { keyPaired: session.keyPaired === true, expiresAt: session.at + SESSION_MS }
  }

  valid(id: string): boolean {
    return this.authority(id) !== null
  }

  /** Reusing a cookie keeps its proof; a newly key-minted code may grant it. */
  async reuse(id: string | null, keyPaired = false): Promise<string> {
    if (id === null || this.authority(id) === null) return this.start(keyPaired)
    if (keyPaired && this.authority(id)?.keyPaired !== true) {
      const hash = hashOf(id)
      this.kept = this.kept.map((session) =>
        session.hash === hash ? { ...session, keyPaired: true } : session,
      )
      this.changed()
      await this.save()
    }
    return id
  }

  /** Every cookie stops working; the key does not change. */
  async forget(): Promise<void> {
    this.kept = []
    this.codes.clear()
    this.changed()
    await this.save()
    await this.savePairings()
  }

  /** Socket owners recheck their id on mutations; expiry uses the authority's fixed deadline. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // A closed socket's listener must not prevent another session's revocation.
      }
    }
  }

  private async save(): Promise<void> {
    const path = sessionsPath(this.ctx)
    await this.ctx.fs.mkdir(this.ctx.home)
    await this.ctx.fs.writeFile(path, `${JSON.stringify(this.kept)}\n`, { mode: 0o600 })
    await chmod(path, 0o600).catch(() => {})
  }

  /** The last pairing save: the next one starts after it, whether it worked or not. */
  private saving: Promise<void> = Promise.resolve()

  /**
   * One save at a time in this server. Two callers that asked for a link at the same moment met on
   * the file lock, and on Windows the one that waited was refused (`app ensure` then exited 1).
   */
  private savePairings(): Promise<void> {
    const next = this.saving.then(() => this.writePairings())
    this.saving = next.catch(() => {})
    return next
  }

  private async writePairings(): Promise<void> {
    await this.ctx.fs.mkdir(this.ctx.home)
    await this.ctx.fs.withLock(join(this.ctx.home, "cockpit.pairings.lock"), () =>
      this.ctx.fs.atomicWrite(
        join(this.ctx.home, "cockpit.pairings"),
        `${JSON.stringify([...this.codes.values()])}\n`,
        { mode: 0o600 },
      ),
    )
  }
}

/** The sessions a server left behind, so a restart keeps every paired browser. */
export async function loadSessions(ctx: Ctx): Promise<Sessions> {
  let pairings: Pairing[] = []
  try {
    const bytes = await ctx.fs.readRegularFile?.(join(ctx.home, "cockpit.pairings"), 4096)
    const stored = bytes ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : []
    if (Array.isArray(stored)) pairings = stored
  } catch {
    // A missing pairing file grants no browser access.
  }
  try {
    const kept = JSON.parse(await ctx.fs.readFile(sessionsPath(ctx))) as Kept[]
    if (Array.isArray(kept)) return new Sessions(ctx, kept, pairings)
  } catch {
    // none yet, or unreadable: nobody is paired
  }
  return new Sessions(ctx, [], pairings)
}
