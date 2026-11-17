import { useEffect } from "react"
import { toast } from "sonner"

export const NATIVE_DOWNLOAD_ERROR =
  "The download could not be saved to Downloads. Check folder permissions and try again."

export function useNativeDownloads() {
  useEffect(() => {
    const failed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.message === NATIVE_DOWNLOAD_ERROR)
        toast.error(NATIVE_DOWNLOAD_ERROR)
    }
    window.addEventListener("qualitylayer-download-failed", failed)
    return () => window.removeEventListener("qualitylayer-download-failed", failed)
  }, [])
}
