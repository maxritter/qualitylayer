// Releases are GitHub release assets: one binary per platform, a SHA256SUMS naming every file's
// hash, and SHA256SUMS.sig, its signature. Both are mandatory: a binary whose release has no valid
// signature, or whose hash differs from its signed line, is never written anywhere.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { UpdateChannel } from "../config-values.ts"
import { addressOverride } from "../licence/address-policy.ts"
import { RELEASE_REPO as REPO } from "../update/notes.ts"
import { compareVersions } from "../update/versions.ts"

export { compareVersions } from "../update/versions.ts"

import { sha256 } from "./manifest.ts"
import { RELEASE_SIGNER, verifyReleaseSignature } from "./signature.ts"

export function releaseBase(ctx: Ctx): string {
  return (
    addressOverride(ctx.env, "QUALITYLAYER_RELEASE_BASE") ?? `https://github.com/${REPO}/releases`
  )
}

/**
 * Both channels read the release list and take the highest version, never GitHub's "latest"
 * pointer: that pointer may name a bridge release that old clients follow (12.x accepted only
 * v12 tags, so v12.99.0 carried 13.0.0 to them).
 */
function releaseApi(ctx: Ctx): string {
  return (
    addressOverride(ctx.env, "QUALITYLAYER_RELEASE_API") ??
    `https://api.github.com/repos/${REPO}/releases?per_page=100`
  )
}

export function assetName(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const os =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : null
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null
  return os === null || cpu === null || (os === "windows" && cpu !== "x64")
    ? null
    : `qualitylayer-${os}-${cpu}${os === "windows" ? ".exe" : ""}`
}

type ListedRelease = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: { name?: unknown }[]
}

/** The release list; a mirror may answer one release instead. */
async function listedReleases(ctx: Ctx): Promise<Result<ListedRelease[]>> {
  try {
    const response = await ctx.http.fetch(releaseApi(ctx), {
      headers: { accept: "application/vnd.github+json", "user-agent": "qualitylayer-updater" },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      return err({ code: "bad_args", message: `the release list answered HTTP ${response.status}` })
    }
    const body = await response.json()
    return ok((Array.isArray(body) ? body : [body]) as ListedRelease[])
  } catch (cause) {
    return err({
      code: "bad_args",
      message: `cannot reach the release list: ${(cause as Error).message}`,
    })
  }
}

/** QualityLayer starts at v12; Pilot Shell releases and prereleases on Stable are excluded. */
function onChannel(release: ListedRelease, channel: UpdateChannel): boolean {
  if (release.draft === true || typeof release.tag_name !== "string") return false
  if (!/^v[1-9]\d*\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release.tag_name)) return false
  if (Number(release.tag_name.slice(1).split(".")[0]) < 12) return false
  return channel === "beta" || (release.prerelease !== true && !release.tag_name.includes("-"))
}

/** The newest QualityLayer release carrying this platform's binary; Stable never takes a prerelease. */
export async function latestVersion(
  ctx: Ctx,
  asset: string,
  channel: UpdateChannel,
): Promise<Result<string>> {
  const listed = await listedReleases(ctx)
  if (!listed.ok) return listed
  const versions = listed.data
    .filter((r) => onChannel(r, channel))
    .filter((r) => (r.assets ?? []).some((a) => a.name === asset))
    .map((r) => (r.tag_name as string).slice(1))
    .sort(compareVersions)
  const newest = versions[versions.length - 1]
  if (newest === undefined) {
    const where = channel === "stable" ? "no stable release" : "no release"
    return err({ code: "bad_args", message: `${where} carries ${asset}` })
  }
  return ok(newest)
}

/**
 * The release's notes: the body of its GitHub release, which the release workflow fills with the
 * version's CHANGELOG section. Null when the release has none or the list cannot be read: the
 * update itself never waits on its notes.
 */
export async function releaseNotes(ctx: Ctx, version: string): Promise<string | null> {
  try {
    // The list holds every release, whichever channel the version is on.
    const response = await ctx.http.fetch(releaseApi(ctx), {
      headers: { accept: "application/vnd.github+json", "user-agent": "qualitylayer-updater" },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) return null
    const releases = (await response.json()) as { tag_name?: unknown; body?: unknown }[]
    const wanted = `v${version.replace(/^v/, "")}`
    const body = releases.find((r) => r.tag_name === wanted)?.body
    return typeof body === "string" && body.trim() !== "" ? body : null
  } catch {
    return null
  }
}

async function fetchBytes(ctx: Ctx, url: string): Promise<Uint8Array> {
  const response = await ctx.http.fetch(url, {
    headers: { "user-agent": "qualitylayer-updater" },
    signal: AbortSignal.timeout(300_000),
  })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** The key a release must be signed with: the one compiled in, or a test build's own. */
const releaseSigner = (ctx: Ctx) =>
  addressOverride(ctx.env, "QUALITYLAYER_RELEASE_SIGNER") ?? RELEASE_SIGNER

/** Download one release binary and verify it against its line in the release's signed SHA256SUMS. */
export async function downloadBinary(
  ctx: Ctx,
  version: string,
  asset: string,
): Promise<Result<{ bytes: Uint8Array; sha256: string }>> {
  const base = `${releaseBase(ctx)}/download/v${version}`
  let bytes: Uint8Array
  let sums: Uint8Array
  let signature: string
  try {
    bytes = await fetchBytes(ctx, `${base}/${asset}`)
    sums = await fetchBytes(ctx, `${base}/SHA256SUMS`)
    signature = new TextDecoder().decode(await fetchBytes(ctx, `${base}/SHA256SUMS.sig`))
  } catch (cause) {
    return err({ code: "bad_args", message: `download failed: ${(cause as Error).message}` })
  }
  if (!verifyReleaseSignature(sums, signature, releaseSigner(ctx))) {
    return err({
      code: "bad_args",
      message: "the release's SHA256SUMS is not signed by QualityLayer; nothing was installed",
    })
  }
  const line = new TextDecoder()
    .decode(sums)
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((fields) => fields[1] === asset)
  const expected = line?.[0] ?? ""
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    return err({
      code: "bad_args",
      message: `SHA256SUMS holds no checksum for ${asset}; nothing was installed`,
    })
  }
  const actual = sha256(bytes)
  if (actual !== expected) {
    return err({
      code: "bad_args",
      message: `checksum mismatch for ${asset} (expected ${expected}, got ${actual}); nothing was installed`,
    })
  }
  return ok({ bytes, sha256: actual })
}
