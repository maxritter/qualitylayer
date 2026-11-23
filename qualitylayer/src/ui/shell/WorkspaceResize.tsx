import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useViewportWidth } from "../hooks.ts"
import { Resizer, useStoredWidth } from "../Resizer.tsx"

function hasStoredNowWidth() {
  try {
    const value = Number(localStorage.getItem("ql-now-width"))
    return Number.isFinite(value) && value > 0
  } catch {
    return false
  }
}

function findResizableRoots() {
  return [
    ...document.querySelectorAll<HTMLElement>('[data-testid="interaction-workspace"]'),
  ].filter((root) =>
    [...(root.querySelector(".ir-now")?.children ?? [])].some(
      (child) => child.getAttribute("role") !== "separator",
    ),
  )
}

function useWorkspaceRoots() {
  const [roots, setRoots] = useState<HTMLElement[]>([])
  useEffect(() => {
    const read = () => {
      const next = findResizableRoots()
      setRoots((was) =>
        was.length === next.length && was.every((r, i) => r === next[i]) ? was : next,
      )
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return roots
}

function clearStoredNowWidth() {
  try {
    localStorage.removeItem("ql-now-width")
  } catch {}
}

export function WorkspaceResize() {
  const roots = useWorkspaceRoots()
  const size = useStoredWidth("ql-now-width", 400, 300, 500)
  const [chosen, setChosen] = useState(hasStoredNowWidth)
  useViewportWidth()
  useEffect(() => {
    for (const root of roots) {
      if (chosen) root.style.setProperty("--ir-now-width", `${size.width}px`)
      else root.style.removeProperty("--ir-now-width")
    }
  }, [roots, size.width, chosen])
  return (
    <>
      {roots.map((root, index) => {
        const now = root.querySelector<HTMLElement>(".ir-now")
        if (!now) return null
        const measured = Math.max(
          size.min,
          Math.min(size.max, now.getBoundingClientRect().width || size.width),
        )
        return createPortal(
          <Resizer
            side="right"
            width={chosen ? size.width : measured}
            min={size.min}
            max={size.max}
            label="Now column width"
            onResize={(width) => {
              setChosen(true)
              size.setWidth(width)
            }}
            onReset={() => {
              setChosen(false)
              clearStoredNowWidth()
            }}
          />,
          now,
          `now-${index}`,
        )
      })}
    </>
  )
}
