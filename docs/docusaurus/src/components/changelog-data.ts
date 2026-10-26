export type Release = { version: string; label: string; notes: string; published: string | null };
export type ReleasePage = { notes: Release[]; nextPage?: number | null };
export type ReleaseLoader = (page: number) => Promise<ReleasePage>;

const MAX_BYTES = 2 * 1024 * 1024;
const FRESH_MS = 5 * 60_000;
const MAX_CACHED_PAGES = 4;
const cache = new Map<number, { at: number; value: ReleasePage }>();
const pending = new Map<number, Promise<ReleasePage>>();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;

/** Matches the version headings used by the pre-12.2 native changelog. */
export const releaseAnchor = (version: string) => version.toLowerCase().replace(/[^a-z0-9_ -]/g, '').replace(/ /g, '-');

function readPage(value: unknown, page: number): ReleasePage {
  if (!record(value) || !Array.isArray(value.notes) || value.notes.length > 100 || !record(value.releases)) throw new Error('Invalid release list');
  if (value.nextPage !== undefined && value.nextPage !== null && value.nextPage !== page + 1) throw new Error('Invalid next release page');
  const dates = value.releases;
  const notes = value.notes.map((row: unknown): Release => {
    if (!record(row)) throw new Error('Invalid release');
    if (typeof row.version !== 'string' || !VERSION.test(row.version)) throw new Error('Invalid release version');
    if (typeof row.label !== 'string' || typeof row.notes !== 'string') throw new Error('Invalid release text');
    const date = dates[row.version];
    return { version: row.version, label: row.label, notes: row.notes, published: typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date) && Number.isFinite(Date.parse(date)) ? date : null };
  });
  return { notes, ...(value.nextPage === undefined ? {} : { nextPage: typeof value.nextPage === 'number' ? value.nextPage : null }) };
}

async function fetchPage(page: number): Promise<ReleasePage> {
  const response = await fetch(`/app/releases.json?page=${page}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Release notes unavailable');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Release list exceeds its byte limit');
  return readPage(JSON.parse(text), page);
}

/** Bounded, on-demand cache; failed pages are retryable and no background timer runs. */
export const loadReleasePage: ReleaseLoader = (page) => {
  const cached = cache.get(page);
  if (cached && Date.now() - cached.at >= 0 && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.value);
  const known = pending.get(page);
  if (known) return known;
  const request = fetchPage(page).then(value => {
    cache.delete(page);
    cache.set(page, { at: Date.now(), value });
    if (cache.size > MAX_CACHED_PAGES) cache.delete(cache.keys().next().value as number);
    return value;
  }).finally(() => pending.delete(page));
  pending.set(page, request);
  return request;
};

export function publishedOn(value: string | null): string {
  return value === null ? 'Publication date unavailable' : `Published ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(new Date(value))} UTC`;
}
