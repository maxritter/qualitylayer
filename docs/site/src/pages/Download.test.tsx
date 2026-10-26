import { renderToReadableStream } from "react-dom/server.browser";
import { describe, expect, it, vi } from "vitest";
import { changelogOf, loadPackages, type Packages, releasedOn, sizeLabel, systemOf } from "@/lib/downloads";
import { DownloadView } from "./Download";

/**
 * The download page: a card per system with the visitor's own first and highlighted, each linking
 * to the package the release names and showing its size, and the command line for machines
 * without a screen. Above the cards, the release's version and publish date with links to its
 * changelog entry and to every release on GitHub. What the release holds comes from
 * /app/downloads.json, nothing is hard-coded.
 */

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const asset = (id: string, file: string, size: number) => ({ id, name: file, url: `https://github.com/maxritter/qualitylayer/releases/download/v12.0.0/${file}`, size });
const PACKAGES: Packages = {
  version: "12.0.0",
  published: "2026-10-12T02:10:53Z",
  packages: [
    asset("macos-arm64", "QualityLayer-12.0.0-macos-arm64.dmg", 84_300_000),
    asset("macos-x64", "QualityLayer-12.0.0-macos-x64.dmg", 88_100_000),
    asset("windows-x64", "QualityLayer-12.0.0-x64-setup.exe", 61_900_000),
    asset("linux-x64", "QualityLayer-12.0.0-linux-x64.AppImage", 97_000_000),
    asset("linux-arm64", "QualityLayer-12.0.0-linux-arm64.AppImage", 95_200_000),
  ],
};

async function html(node: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

/** The markup of the card holding this heading: from its opening tag to the next card's. */
const cardOf = (markup: string, heading: string) => {
  const cards = markup.split('<div class="ap-os"').slice(1);
  return cards.find((card) => card.includes(`<b>${heading}</b>`))!;
};

describe("which system a visitor is on", () => {
  it("picks the card from the browser: Windows, a Mac (Apple silicon unless the browser says Intel), Linux", () => {
    expect(systemOf(WINDOWS)).toBe("windows");
    expect(systemOf(MAC)).toBe("macos-arm64");
    expect(systemOf(MAC, "x86")).toBe("macos-x64");
    expect(systemOf(LINUX)).toBe("linux");
  });

  it("picks none for a phone, an Android phone's Linux included, and for what it does not know", () => {
    expect(systemOf(ANDROID)).toBeNull();
    expect(systemOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBeNull();
    expect(systemOf("curl/8.7.1")).toBeNull();
  });
});

describe("the cards", () => {
  it("highlights the Windows card for a Windows visitor, lists it first, and no other", async () => {
    const markup = await html(<DownloadView data={PACKAGES} system={systemOf(WINDOWS)} />);
    expect(markup.match(/data-current="true"/g)).toHaveLength(1);
    expect(cardOf(markup, "Windows")).toContain('data-current="true"');
    expect(markup.indexOf("<b>Windows</b>")).toBeLessThan(markup.indexOf("<b>Linux</b>"));
    expect(markup.indexOf("<b>Windows</b>")).toBeLessThan(markup.indexOf("<b>macOS</b>"));
  });

  it("links each card to the package the release names and shows its size", async () => {
    const markup = await html(<DownloadView data={PACKAGES} system={null} />);
    const windows = cardOf(markup, "Windows");
    expect(windows).toContain('href="https://github.com/maxritter/qualitylayer/releases/download/v12.0.0/QualityLayer-12.0.0-x64-setup.exe"');
    expect(windows).toContain("62 MB");
    expect(windows).toContain("x64 · no admin needed");
    expect(windows).not.toContain("ARM64");

    const linux = cardOf(markup, "Linux");
    expect(linux).toContain("QualityLayer-12.0.0-linux-x64.AppImage");
    expect(linux).toContain("97 MB");
    expect(linux).toContain("QualityLayer-12.0.0-linux-arm64.AppImage");
    expect(linux).toContain("ARM64 version");

    expect(markup).toContain("QualityLayer-12.0.0-macos-arm64.dmg");
    expect(markup).toContain("84 MB");
    expect(markup).toContain("QualityLayer-12.0.0-macos-x64.dmg");
    expect(markup).toContain("88 MB");
  });

  it("never offers a Windows ARM64 package even if an older feed still includes one", async () => {
    const stale: Packages = {
      ...PACKAGES,
      packages: [...PACKAGES.packages, asset("windows-arm64", "QualityLayer-12.0.0-arm64-setup.exe", 58_400_000)],
    };
    const markup = await html(<DownloadView data={stale} system="windows" />);
    expect(cardOf(markup, "Windows")).not.toContain("ARM64");
    expect(markup).not.toContain("QualityLayer-12.0.0-arm64-setup.exe");
    expect(markup).toContain("QualityLayer-12.0.0-linux-arm64.AppImage");
  });

  it("offers browser setup and CLI integration with the install command", async () => {
    const markup = await html(<DownloadView data={PACKAGES} system={null} />);
    expect(markup).toContain("Browser setup and CLI");
    expect(markup).toContain("curl -fsSL https://qualitylayer.dev/install.sh | bash");
  });

  it("says what Windows may show only once a Windows download has started", async () => {
    expect(await html(<DownloadView data={PACKAGES} system="windows" />)).not.toContain("SmartScreen");
    const started = await html(<DownloadView data={PACKAGES} system={null} windowsStarted />);
    expect(started).toContain("SmartScreen");
    expect(started).toContain("Run anyway");
  });

  it("still shows every card when the release list is unavailable, linking to the releases page with no size", async () => {
    const markup = await html(<DownloadView data={null} system="linux" />);
    expect(markup).toContain("<b>macOS</b>");
    expect(markup).toContain("<b>Windows</b>");
    expect(markup).toContain('href="https://github.com/maxritter/qualitylayer/releases"');
    expect(markup).not.toMatch(/\d+ MB/);
  });
});

describe("the release line", () => {
  /** The markup of the release line, from its opening tag to the cards. */
  const lineOf = (markup: string) => markup.slice(markup.indexOf('<div class="ap-rel"'), markup.indexOf('<div class="ap-dl"'));

  it("names the version the cards download, the day it was published, its changelog entry and every release on GitHub", async () => {
    const line = lineOf(await html(<DownloadView data={{ ...PACKAGES, version: "12.0.0-beta.53" }} system={null} />));
    expect(line).toContain("Latest version");
    expect(line).toContain('<b class="ap-ver">12.0.0-beta.53</b>');
    expect(line).toContain('<time dateTime="2026-10-12T02:10:53Z">October 12, 2026</time>');
    expect(line).toContain('href="/docs/changelog#1200-beta53"');
    expect(line).toContain("What&#x27;s new");
    expect(line).toContain('href="https://github.com/maxritter/qualitylayer/releases"');
    expect(line).toContain("All releases on GitHub");
  });

  it("comes before the cards, so the version is read before a download starts", async () => {
    const markup = await html(<DownloadView data={PACKAGES} system={null} />);
    expect(markup.indexOf('class="ap-rel"')).toBeGreaterThan(-1);
    expect(markup.indexOf('class="ap-rel"')).toBeLessThan(markup.indexOf('class="ap-dl"'));
  });

  it("shows the version without a date when the release list does not say when it was published", async () => {
    const line = lineOf(await html(<DownloadView data={{ ...PACKAGES, published: undefined }} system={null} />));
    expect(line).toContain('<b class="ap-ver">12.0.0</b>');
    expect(line).not.toContain("released");
    expect(line).not.toContain("<time");
  });

  it("says it is looking up the version while the release list loads, and keeps both links", async () => {
    const line = lineOf(await html(<DownloadView data={null} system={null} loading />));
    expect(line).toContain("Looking up the latest version");
    expect(line).not.toContain("could not be loaded");
    expect(line).toContain('href="https://github.com/maxritter/qualitylayer/releases"');
    expect(line).toContain('href="https://github.com/maxritter/qualitylayer/releases"');
  });

  it("says the version could not be loaded when the release list fails, and keeps both links", async () => {
    const line = lineOf(await html(<DownloadView data={null} system={null} />));
    expect(line).toContain("The latest version could not be loaded. The downloads below open GitHub instead.");
    expect(line).not.toContain("Looking up");
    expect(line).toContain('href="https://github.com/maxritter/qualitylayer/releases"');
    expect(line).toContain("All releases on GitHub");
  });

  it("writes the day in words, in UTC, and nothing for a missing or unreadable date", () => {
    expect(releasedOn("2026-10-12T02:10:53Z")).toBe("October 12, 2026");
    expect(releasedOn("2026-10-11T23:59:59Z")).toBe("October 11, 2026");
    expect(releasedOn(null)).toBeNull();
    expect(releasedOn(undefined)).toBeNull();
    expect(releasedOn("not a date")).toBeNull();
  });

  it("links to the native changelog's preserved version anchors", () => {
    expect(changelogOf("12.0.0-beta.53")).toBe("/docs/changelog#1200-beta53");
    expect(changelogOf("12.0.0")).toBe("/docs/changelog#1200");
  });
});

describe("reading the release list", () => {
  it("returns what /app/downloads.json says, and null for no release or a failed request", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(PACKAGES), { status: 200 }));
    expect(await loadPackages(fetchFn as unknown as typeof fetch)).toEqual(PACKAGES);
    expect(fetchFn).toHaveBeenCalledWith("/app/downloads.json");

    expect(await loadPackages((async () => new Response(null, { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await loadPackages((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toBeNull();
  });

  it("writes a size in megabytes, rounded", () => {
    expect(sizeLabel(84_300_000)).toBe("84 MB");
    expect(sizeLabel(61_900_000)).toBe("62 MB");
  });
});
