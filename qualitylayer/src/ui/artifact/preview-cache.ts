import type { ArtifactLayout } from "./ArtifactPageFrame.tsx"

type Page = { text: string; layout?: ArtifactLayout }
export type PreviewCache = {
  read(file: string): Page | undefined
  load(file: string, read: () => Promise<string>): Promise<string>
  layout(file: string, text: string, layout: ArtifactLayout): void
  /** The page's last known geometry, kept after its text is evicted: it reserves an embed's height. */
  shape(file: string): ArtifactLayout | undefined
  remove(file: string): void
}
const LIMIT = 8 * 1024 * 1024
/**
 * Geometry outlives a page's text, so an embed keeps its height without the page in memory. It has its
 * own budget, sized like the pages' (1536 bytes a part, at most 200 parts a page, so 300 KiB at most):
 * 1 MiB of it, or 64 pages, whichever comes first.
 */
const SHAPE_LIMIT = 1024 * 1024
const SHAPES = 64
const caches = new WeakMap<
  object,
  {
    pages: Map<string, Page>
    pending: Map<string, Promise<string>>
    shapes: Map<string, ArtifactLayout>
  }
>()
const shapeBytes = (layout: ArtifactLayout) => 256 + layout.parts.length * 1536
const bytes = (page: Page) => page.text.length * 2 + (page.layout?.parts.length ?? 0) * 1536

function evictToBudget<T>(
  map: Map<string, T>,
  maxItems: number,
  maxBytes: number,
  sizeOf: (value: T) => number,
): void {
  let size = [...map.values()].reduce((sum, value) => sum + sizeOf(value), 0)
  while (map.size > maxItems || size > maxBytes) {
    const oldest = map.entries().next().value
    if (!oldest) break
    size -= sizeOf(oldest[1])
    map.delete(oldest[0])
  }
}

function storeFor(owner: object) {
  let store = caches.get(owner)
  if (!store) {
    store = { pages: new Map(), pending: new Map(), shapes: new Map() }
    caches.set(owner, store)
  }
  return store
}

/** Warm navigation is bounded and isolated by API instance, authorized task and current person. */
export function previewCache(owner: object, identity: string): PreviewCache {
  const { pages, pending, shapes } = storeFor(owner)
  const keyOf = (file: string) => `${identity}\0${file}`
  const keep = (key: string, page: Page) => {
    pages.delete(key)
    if (bytes(page) <= LIMIT) pages.set(key, page)
    evictToBudget(pages, 8, LIMIT, bytes)
  }
  return {
    read(file) {
      const key = keyOf(file)
      const page = pages.get(key)
      if (page) {
        pages.delete(key)
        pages.set(key, page)
      }
      return page
    },
    load(file, read) {
      const key = keyOf(file)
      const active = pending.get(key)
      if (active) return active
      const fresh = read()
        .then((text) => {
          const previous = pages.get(key)
          keep(key, previous?.text === text ? previous : { text })
          return text
        })
        .catch((cause) => {
          pages.delete(key)
          shapes.delete(key)
          throw cause
        })
        .finally(() => {
          pending.delete(key)
        })
      pending.set(key, fresh)
      return fresh
    },
    layout(file, text, layout) {
      const key = keyOf(file)
      const page = pages.get(key)
      shapes.delete(key)
      shapes.set(key, layout)
      evictToBudget(shapes, SHAPES, SHAPE_LIMIT, shapeBytes)
      if (page?.text === text) keep(key, { text, layout })
    },
    shape(file) {
      return shapes.get(keyOf(file))
    },
    remove(file) {
      pages.delete(keyOf(file))
      shapes.delete(keyOf(file))
    },
  }
}
