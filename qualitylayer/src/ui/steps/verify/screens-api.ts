import {
  isVerificationScreens,
  type VerificationScreens,
} from "../../../core/review/screen-evidence.ts"
import { type Api, ApiError, api as liveApi } from "../../api.ts"

export type ScreenEvidenceApi = Api & {
  verificationScreens?: (id: string) => Promise<VerificationScreens>
}

const isScreensResponseOk = (payload: unknown): payload is VerificationScreens => {
  if (typeof payload !== "object" || payload === null) return false
  return "ok" in payload && payload.ok === true && isVerificationScreens(payload)
}

/** The live task API or an explicit adapter; missing adapter support is not an empty inventory. */
export async function loadVerificationScreens(
  api: ScreenEvidenceApi,
  id: string,
  signal?: AbortSignal,
): Promise<VerificationScreens | null> {
  if (api.verificationScreens) {
    const found = await api.verificationScreens(id)
    if (!isVerificationScreens(found))
      throw new Error("The screenshot response could not be read. Try again.")
    return found
  }
  if (api !== liveApi) return null
  const response = await fetch(`/api/tasks/${encodeURIComponent(id)}/screens`, { signal })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isScreensResponseOk(payload)) {
    throw new ApiError(
      "The screenshot records could not be read. Try again.",
      response.status,
      "http",
    )
  }
  return payload
}
