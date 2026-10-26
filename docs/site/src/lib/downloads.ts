import { isPhone } from "@/lib/device";
import { CHANGELOG_URL } from "@/lib/product";

/** What the download page knows about the newest release and the visitor. */

/**
 * What /app/downloads.json says about the newest release: its version, when GitHub published it
 * (ISO 8601; absent from answers older than the field), and its packages with address and size in bytes.
 */
export type Packages = { version: string; published?: string | null; packages: { id: string; name: string; url: string; size: number }[] };

/** The day a release was published, as the page writes it ("October 12, 2026"); null when unknown or unreadable. */
export function releasedOn(published: string | null | undefined): string | null {
  if (!published) return null;
  const date = new Date(published);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The native changelog retains its pre-12.2 version heading anchors. */
export const changelogOf = (version: string) => `${CHANGELOG_URL}#${version.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/ /g, "-")}`;

export type Card = "macos-arm64" | "macos-x64" | "windows" | "linux";

/** The visitor's system from the browser's own words; a phone has no card, and Android's Linux is not Linux's. */
export function systemOf(userAgent: string, arch?: string): Card | null {
  if (isPhone(userAgent)) return null;
  if (/Windows/.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return arch === "x86" ? "macos-x64" : "macos-arm64";
  if (/Linux|X11/.test(userAgent)) return "linux";
  return null;
}

export const sizeLabel = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/** The release's packages, or null when there is none yet or GitHub cannot say; the page then points at the releases page. */
export async function loadPackages(fetchFn: typeof fetch = fetch): Promise<Packages | null> {
  try {
    const response = await fetchFn("/app/downloads.json");
    return response.ok ? ((await response.json()) as Packages) : null;
  } catch {
    return null;
  }
}
