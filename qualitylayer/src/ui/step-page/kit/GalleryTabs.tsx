// Tabs around a step page's diagrams, screens or acceptance steps (Workflow model: `.gal-tabs`).
// Each tab leads with an icon; one panel shows. Past three tabs the rest sit in a More tab, a menu of
// the remaining tabs. A panel mounts when first shown and stays mounted (hidden) after, so a diagram
// keeps its size and a picture is not fetched twice.
// With `named` (screens), each panel is a figure card, the diagrams' design: the screen's icon and
// name top left, a slot top right the panel fills with its own actions (a preview's age, Designed or
// Built, the square button that opens it in its card), the picture under them. One item needs no tabs.

import { MonitorIcon, MoreHorizontalIcon } from "lucide-react"
import { createContext, type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ActionSlot } from "../../kit/action-slot.ts"

export type GalleryTab = {
  id: string
  icon: ReactNode
  label: string
  panel: ReactNode
  caption?: ReactNode
  thumbnail?: ReactNode
}

type Collection = "diagrams" | "artifacts"

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

/**
 * A named screen as a figure card, the diagrams' own design (Workflow model: Plan, Verify): its icon
 * and name top left, its actions top right (the preview's age, Designed or Built, and the square
 * button that opens it in its card), the picture under them; a caption stands under the card.
 */
function FigureCard({
  tab,
  shown,
  collection,
}: {
  tab: GalleryTab
  shown: boolean
  collection: Collection | undefined
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [below, setBelow] = useState<HTMLElement | null>(null)
  return (
    <>
      <div className="gal-fig" data-testid="figure-card">
        <div className="gal-fig-head">
          {collection === undefined ? (
            <span className="gal-solo">
              {tab.icon}
              <span className="gal-tab-label">{tab.label}</span>
            </span>
          ) : (
            <div className="gal-figure-name">
              <h3>{tab.label}</h3>
              {tab.caption}
            </div>
          )}
          <span className="gal-act" ref={setSlot} />
        </div>
        <FigureBelow.Provider value={below}>
          <ActionSlot.Provider value={{ element: slot, shown }}>{tab.panel}</ActionSlot.Provider>
        </FigureBelow.Provider>
      </div>
      <div className="gal-fig-below" ref={setBelow} />
    </>
  )
}

/** Where a figure card's panel puts its caption: under the card, as the diagrams' caption stands. */
export const FigureBelow = createContext<HTMLElement | null>(null)

/** One item needs no tabs: its panel stands alone, in its figure card when `named`. */
const galleryClass = (collection: Collection | undefined) =>
  collection === undefined ? "gal" : `gal gal-collection gal-collection-${collection}`

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

function DiagramPicker({
  tabs,
  active,
  choose,
}: {
  tabs: readonly GalleryTab[]
  active: string | undefined
  choose: (id: string) => void
}) {
  return (
    <select
      className="gal-picker"
      aria-label="Choose a diagram"
      value={active}
      onChange={(event) => choose(event.currentTarget.value)}
    >
      {tabs.map((tab) => (
        <option key={tab.id} value={tab.id}>
          {tab.label}
        </option>
      ))}
    </select>
  )
}

function ManyTabs({ tabs, label, initial, named = false, collection }: GalleryProps) {
  const base = useId()
  const first = tabs.find((tab) => tab.id === initial)?.id ?? tabs[0]?.id
  const [active, setActive] = useState(first)
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set(first ? [first] : []))
  const refs = useRef(new Map<string, HTMLButtonElement>())
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
    refs.current.get(id)?.focus()
    if (id !== "more") choose(id)
  }
  const ref = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) refs.current.set(id, node)
    else refs.current.delete(id)
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
            <button
              key={tab.id}
              ref={ref(tab.id)}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={tab.id === current?.id}
              aria-controls={
                seen.has(tab.id) || tab.id === current?.id ? panelId(tab.id) : undefined
              }
              tabIndex={tab.id === focusStop ? 0 : -1}
              onClick={() => choose(tab.id)}
              onKeyDown={(event) => move(event, tab.id)}
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
          ))}
          {rest.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                ref={ref("more")}
                type="button"
                role="tab"
                id={tabId("more")}
                aria-selected={inRest}
                tabIndex={focusStop === "more" ? 0 : -1}
                onKeyDown={(event: KeyboardEvent) => move(event, "more")}
              >
                <MoreHorizontalIcon className="size-[13px]" aria-hidden="true" />
                <span className="gal-tab-label">
                  {inRest && current ? `More · ${current.label}` : "More"}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="gal-more">
                {rest.map((tab) => (
                  <DropdownMenuItem key={tab.id} onClick={() => choose(tab.id)}>
                    {tab.icon}
                    {tab.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {tabs.map((tab) =>
        seen.has(tab.id) || tab.id === current?.id ? (
          <div
            key={tab.id}
            className="gal-p"
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tab.id === current?.id && inRest ? tabId("more") : tabId(tab.id)}
            hidden={tab.id !== current?.id}
          >
            {named ? (
              <FigureCard tab={tab} shown={tab.id === current?.id} collection={collection} />
            ) : (
              tab.panel
            )}
          </div>
        ) : null,
      )}
    </div>
  )
}
