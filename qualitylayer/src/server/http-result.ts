import type { HarnessError, Result } from "../ctx.ts"

// Pairs, not an object: the release obfuscator encodes strings but not bare object keys, and
// its key transform, which did, broke guarded object literals (scripts/build.ts, OBFUSCATION).
const STATUS = new Map<HarnessError["code"], number>([
  ["no_task", 404],
  ["bad_args", 400],
  ["open_failed", 502],
  ["group_required", 400],
  ["no_gate", 409],
  ["review_pending", 409],
  ["groups_changed", 409],
  ["team_email_off", 409],
  ["not_owner", 403],
  ["licence_required", 402],
  ["licence_unchecked", 402],
  ["validation_failed", 422],
  ["rate_limited", 429],
])

export function json(result: Result<unknown>): Response {
  const status = result.ok ? 200 : (STATUS.get(result.error.code) ?? 500)
  const body = result.ok
    ? { ok: true, ...(result.data as object) }
    : {
        ok: false,
        error: result.error,
        // Where to upgrade, at the top of a 402 as the backend's own refusal has it.
        ...(result.error.code === "licence_required" ? { upgrade_url: result.error.url } : {}),
      }
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
