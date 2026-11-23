// Tabs around a step page's diagrams, screens or acceptance steps (Workflow model: `.gal-tabs`).
// Each tab leads with an icon; one panel shows. Past three tabs the rest sit in a More tab, a menu of
// the remaining tabs. A panel mounts when first shown and stays mounted (hidden) after, so a diagram
// keeps its size and a picture is not fetched twice.
// With `named` (screens), each panel is a figure card, the diagrams' design: the screen's icon and
// name top left, a slot top right the panel fills with its own actions (a preview's age, Designed or
// Built, the square button that opens it in its card), the picture under them. One item needs no tabs.

import { MonitorIcon } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react"
import {
  type Collection,
  DiagramPicker,
  FigureBelow,
  FigureCard,
  GalleryPanels,
  type GalleryTab,
  galleryClass,
  MoreTabsMenu,
} from "./GalleryParts.tsx"

export { FigureBelow }

/**
 * One screen under its name, outside a gallery (the Plan's wireframe, a screen in the reader, an
 * acceptance step): the row a single named tab keeps, ending in the preview's age and Open in card.
 */
export function NamedScreen({
  name,
  label = "Screen",
  children,
}: {
  name: string
  label?: string
  children: ReactNode
}) {
  return (
    <GalleryTabs
      named
      label={label}
      tabs={[
        {
          id: "only",
          icon: <MonitorIcon className="size-[13px]" aria-hidden="true" />,
          label: name,
          panel: children,
        },
      ]}
    />
  )
}

/** Tabs drawn in the row before the rest move into More. */
export const GALLERY_TABS_SHOWN = 3

type GalleryProps = {
  tabs: readonly GalleryTab[]
  /** Names the tablist for screen readers ("Diagrams", "Screens", "Acceptance test"). */
  label: string
  /** The tab shown first; defaults to the first. */
  initial?: string
  /**
   * The tabs name screens: the row ends in the shown panel's actions (one preview per panel), and one
   * item keeps a row with its icon and name. Without it, panels keep their own headers.
   */
  named?: boolean
  /** Plan collections use an illustrated chooser and titled figure. Other galleries keep tabs. */
  collection?: Collection
}

export function GalleryTabs(props: GalleryProps) {
  const only = props.tabs.length === 1 ? props.tabs[0] : undefined
  if (props.tabs.length === 0) return null
  return only !== undefined ? (
    <OneItem
      only={only}
      label={props.label}
      named={props.named === true}
      collection={props.collection}
    />
  ) : (
    <ManyTabs {...props} />
  )
}

function OneItem({
  only,
  label,
  named,
  collection,
}: {
  only: GalleryTab
  label: string
  named: boolean
  collection: Collection | undefined
}) {
  return (
    <div className={galleryClass(collection)} data-testid="gallery-tabs">
      <section className="gal-p" aria-label={`${label}: ${only.label}`}>
        {named ? <FigureCard tab={only} shown collection={collection} /> : only.panel}
      </section>
    </div>
  )
}

function nextTab(key: string, from: number, count: number, vertical: boolean): number | undefined {
  if (key === "Home") return 0
  if (key === "End") return count - 1
  const steps: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: Number(vertical),
    ArrowUp: -Number(vertical),
  }
  const step = steps[key]
  return step ? (from + step + count) % count : undefined
}

function TabButton({
  tab,
  selected,
  mounted,
  focusable,
  collection,
  tabId,
  panelId,
  buttonRef,
  onChoose,
  onMove,
}: {
  tab: GalleryTab
  selected: boolean
  mounted: boolean
  focusable: boolean
  collection: Collection | undefined
  tabId: string
  panelId: string
  buttonRef: (node: HTMLButtonElement | null) => void
  onChoose: () => void
  onMove: (event: KeyboardEvent) => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={mounted ? panelId : undefined}
      tabIndex={focusable ? 0 : -1}
      onClick={onChoose}
      onKeyDown={onMove}
    >
      {collection === undefined ? (
        tab.icon
      ) : (
        <span className="gal-thumb" aria-hidden="true">
          {tab.thumbnail ?? tab.icon}
        </span>
      )}
      <span className="gal-tab-label">{tab.label}</span>
    </button>
  )
}

function useTabRefs() {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const ref = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) refs.current.set(id, node)
    else refs.current.delete(id)
  }
  const focus = (id: string) => refs.current.get(id)?.focus()
  return { ref, focus }
}

function ManyTabs({ tabs, label, initial, named = false, collection }: GalleryProps) {
  const base = useId()
  const first = tabs.find((tab) => tab.id === initial)?.id ?? tabs[0]?.id
  const [active, setActive] = useState(first)
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set(first ? [first] : []))
  const { ref, focus } = useTabRefs()
  const rowed =
    collection === undefined && tabs.length > GALLERY_TABS_SHOWN + 1
      ? tabs.slice(0, GALLERY_TABS_SHOWN)
      : tabs
  const rest = tabs.slice(rowed.length)
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]
  const inRest = rest.some((tab) => tab.id === current?.id)
  const tabId = (id: string) => `${base}-t-${id}`
  const panelId = (id: string) => `${base}-p-${id}`

  const choose = (id: string) => {
    setActive(id)
    setSeen((before) => (before.has(id) ? before : new Set(before).add(id)))
  }
  // The row in arrow order: the tabs, then More when it stands.
  const order = [...rowed.map((tab) => tab.id), ...(rest.length > 0 ? ["more"] : [])]
  const focusStop = order.includes(current?.id ?? "") ? (current?.id ?? "") : "more"
  const move = (event: KeyboardEvent, from: string) => {
    const next = nextTab(event.key, order.indexOf(from), order.length, collection === "diagrams")
    if (next === undefined) return
    event.preventDefault()
    const id = order[next] ?? ""
    focus(id)
    if (id !== "more") choose(id)
  }

  return (
    <div className={galleryClass(collection)} data-testid="gallery-tabs" data-many="true">
      <div className="gal-head">
        {collection === "diagrams" ? (
          <DiagramPicker tabs={tabs} active={current?.id} choose={choose} />
        ) : null}
        <div
          className="gal-tabs"
          role="tablist"
          aria-label={label}
          aria-orientation={collection === "diagrams" ? "vertical" : undefined}
        >
          {rowed.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              selected={tab.id === current?.id}
              mounted={seen.has(tab.id) || tab.id === current?.id}
              focusable={tab.id === focusStop}
              collection={collection}
              tabId={tabId(tab.id)}
              panelId={panelId(tab.id)}
              buttonRef={ref(tab.id)}
              onChoose={() => choose(tab.id)}
              onMove={(event) => move(event, tab.id)}
            />
          ))}
          <MoreTabsMenu
            rest={rest}
            current={current}
            inRest={inRest}
            focusStop={focusStop}
            tabId={tabId("more")}
            buttonRef={ref("more")}
            onMove={(event) => move(event, "more")}
            onChoose={choose}
          />
        </div>
      </div>
      <GalleryPanels
        tabs={tabs}
        seen={seen}
        current={current}
        inRest={inRest}
        named={named}
        collection={collection}
        tabId={tabId}
        panelId={panelId}
      />
    </div>
  )
}
