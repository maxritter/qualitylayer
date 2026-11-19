export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly url?: string,
    readonly detail?: unknown,
  ) {
    super(message)
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    ...(!init?.method || init.method === "GET"
      ? { signal: init?.signal ?? AbortSignal.timeout(15_000) }
      : {}),
    // A form sets its own content type, with the boundary.
    headers:
      init?.body instanceof FormData
        ? { ...init.headers }
        : { "content-type": "application/json", ...init?.headers },
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    payload = { ok: false, error: { code: "http", message: text || response.statusText } }
  }
  if (!response.ok || payload.ok !== true) {
    const error = (payload.error ?? {}) as { code?: string; message?: string; url?: string }
    throw new ApiError(
      error.message ?? "The App did not accept that. Try again.",
      response.status,
      error.code ?? "http",
      error.url,
      path.includes("/interaction/docs/") || path.endsWith("/public-link") ? error : undefined,
    )
  }
  return payload as T
}
