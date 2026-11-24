// The routes behind the update sheet and Settings › About. The shell owns the update; these only
// read what it wrote (update.json) and leave it a request file to act on.

import { type FSWatcher, statSync, watch } from "node:fs"
import { type Config, readConfig } from "../core/config.ts"
import { effectiveChannel, releasesOnChannel } from "../core/update/channel.ts"
import type { Release } from "../core/update/notes.ts"
import { publishedReleases } from "../core/update/releases.ts"
import {
  postponeUpdate,
  readUpdate,
  requestUpdate,
  type UpdateInfo,
  type UpdateRequest,
  updatePath,
} from "../core/update/state.ts"
import { VERSION } from "../core/version.ts"
import { type Ctx, ok, type Result } from "../ctx.ts"
import type { Hub } from "./watch.ts"

const SHOWN = 30

export const getUpdate = async (ctx: Ctx): Promise<Result<UpdateInfo>> => ok(await readUpdate(ctx))

const channelOf = async (ctx: Ctx) =>
  effectiveChannel((await readConfig(ctx)).updates.channel, VERSION)

/** Published GitHub notes on the person's channel, with a local offline copy. */
export async function getReleases(ctx: Ctx): Promise<Result<{ releases: Release[] }>> {
  try {
    const releases = releasesOnChannel(await publishedReleases(ctx), await channelOf(ctx), VERSION)
    return ok({ releases: releases.slice(0, SHOWN) })
  } catch {
    return {
      ok: false,
      error: { code: "open_failed", message: "Release notes could not be loaded from GitHub." },
    }
  }
}

/**
 * After a change of the update channel, ask the shell to check again: an update it found on the
 * other channel must not stay offered. Without the shell there is nothing to ask.
 */
export async function recheckAfterChannelChange(
  ctx: Ctx,
  before: Config,
  after: Config,
): Promise<void> {
  const [was, now] = [before, after].map((config) =>
    effectiveChannel(config.updates.channel, VERSION),
  )
  if (was !== now && (await readUpdate(ctx)).managed) await requestUpdate(ctx, "check")
}

const REQUESTS: Record<string, UpdateRequest> = {
  install: "install",
  check: "check",
  cancel: "cancel",
}

/** `install`, `check` or `cancel`: leave the request for the shell. `later`: hide the line and the bar for a day. */
export async function postUpdate(ctx: Ctx, action: string): Promise<Result<{ requested: string }>> {
  if (action === "later") {
    await postponeUpdate(ctx)
    return ok({ requested: "later" })
  }
  const request = REQUESTS[action]
  if (request === undefined) {
    return { ok: false, error: { code: "bad_args", message: `unknown update action: ${action}` } }
  }
  await requestUpdate(ctx, request)
  return ok({ requested: request })
}

function updateStamp(path: string): string {
  try {
    const info = statSync(path)
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return ""
  }
}

/** Tell the page when the shell rewrites update.json, so the sidebar line and the sheet follow it live. */
export function startUpdateWatch(ctx: Ctx, hub: Hub): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  const path = updatePath(ctx)
  let lastStamp = updateStamp(path)
  try {
    watcher = watch(ctx.home, (_event, file) => {
      if (pending !== null) return
      if (file === "update.json") {
        lastStamp = updateStamp(path)
      } else if (file === null) {
        const nextStamp = updateStamp(path)
        if (nextStamp === lastStamp) return
        lastStamp = nextStamp
      } else {
        return
      }
      pending = setTimeout(() => {
        pending = null
        hub.publish({ type: "update-changed" })
      }, 150)
    })
    watcher.on("error", () => {})
  } catch {
    // an unwatchable home only costs live updates: the page reads again when it is opened
  }
  return () => {
    if (pending !== null) clearTimeout(pending)
    watcher?.close()
  }
}
