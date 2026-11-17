import { useEffect } from "react"
import { toast } from "sonner"

export const NATIVE_DOWNLOAD_ERROR =
  "The file could not be saved. Choose a writable folder and try again."

export const nativeDownloadPending = new Set<string>()

export function nativeDownloadsAvailable() {
  return (
    (window as Window & { __QUALITYLAYER_NATIVE_DOWNLOADS__?: boolean })
      .__QUALITYLAYER_NATIVE_DOWNLOADS__ === true
  )
}

export function useNativeDownloads() {
  useEffect(() => {
    const failed = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail?.status === "failed" &&
        !nativeDownloadPending.has(event.detail.url)
      )
        toast.error(NATIVE_DOWNLOAD_ERROR)
    }
    window.addEventListener("qualitylayer-download-result", failed)
    return () => window.removeEventListener("qualitylayer-download-result", failed)
  }, [])
}
