import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { useCopy } from "@/hooks/useCopy";
import { type Card, changelogOf, loadPackages, type Packages, releasedOn, sizeLabel, systemOf } from "@/lib/downloads";
import { CHANGELOG_URL, INSTALL_COMMAND, RELEASES_URL, SITE_URL } from "@/lib/product";
import "@/styles/app-pages.css";

const Icon = ({ path, stroke = false }: { path: string; stroke?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} {...(stroke ? { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } : { fill: "currentColor" })} />
  </svg>
);

const APPLE =
  "M16.4 12.6c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-4ZM14 5.4c.7-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3Z";
const WINDOWS_ICON = "M3 5.1 10.4 4v7.2H3Zm8.3-1.2L21 2.5v8.7h-9.7ZM3 12.6h7.4v7.3L3 18.8Zm8.3 0H21v8.9l-9.7-1.4Z";
const LINUX_ICON =
  "M12 2c-2.2 0-3.6 1.8-3.6 4.4 0 1.4.3 2.3-.6 3.6-1 1.4-2.6 3.4-2.6 6 0 .8.2 1.5.5 2.1-.9.4-1.6.9-1.6 1.5 0 .9 1.6 1.4 3.4 1.6 1 .1 1.6-.3 2-.7.6.1 1.6.2 2.5.2s1.9-.1 2.5-.2c.4.4 1 .8 2 .7 1.8-.2 3.4-.7 3.4-1.6 0-.6-.7-1.1-1.6-1.5.3-.6.5-1.3.5-2.1 0-2.6-1.6-4.6-2.6-6-.9-1.3-.6-2.2-.6-3.6C15.6 3.8 14.2 2 12 2Zm-1.4 4.1c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1Zm2.8 0c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1ZM12 9.4c.9 0 1.9.5 1.9.9s-1 .9-1.9.9-1.9-.5-1.9-.9 1-.9 1.9-.9Z";
const TERMINAL = "M3 4h18v16H3zM7 9l3 3-3 3M12 15h5";

/** The cards in their usual order: the package each downloads, the other chip's package where a system has two. */
const CARDS: { id: Card; title: string; about: string; icon: string; main: string; other?: { id: string; label: string } }[] = [
  { id: "macos-arm64", title: "macOS", about: "Apple silicon · .dmg", icon: APPLE, main: "macos-arm64" },
  { id: "macos-x64", title: "macOS", about: "Intel · .dmg", icon: APPLE, main: "macos-x64" },
  { id: "windows", title: "Windows", about: "x64 · no admin needed", icon: WINDOWS_ICON, main: "windows-x64" },
  { id: "linux", title: "Linux", about: "x64 or ARM64 · AppImage", icon: LINUX_ICON, main: "linux-x64", other: { id: "linux-arm64", label: "ARM64" } },
];

/** The Windows packages are not code-signed yet, so SmartScreen can stop a first run; said only once a Windows download starts. */
export const WindowsNote = () => (
  <p className="ap-note" role="status">Your download has started. If Windows shows a SmartScreen notice, choose More info, then Run anyway.</p>
);

/**
 * Which version the cards download and when it was published, with its notes in the changelog and
 * every release on GitHub. While the release list loads, or when it cannot be read, the line says
 * so and the links stay.
 */
function ReleaseLine({ data, loading }: { data: Packages | null; loading: boolean }) {
  const date = data ? releasedOn(data.published) : null;
  return (
    <div className="ap-rel">
      <p className="ap-rel-v" aria-live="polite">
        {data ? (
          <>
            <span>Latest version</span>
            <b className="ap-ver">{data.version}</b>
            {date !== null && data.published ? (
              <span>
                released <time dateTime={data.published}>{date}</time>
              </span>
            ) : null}
          </>
        ) : loading ? (
          <span>Looking up the latest version…</span>
        ) : (
          <span>The latest version could not be loaded. The downloads below open GitHub instead.</span>
        )}
      </p>
      <nav className="ap-rel-links" aria-label="Release notes">
        <a href={data ? changelogOf(data.version) : CHANGELOG_URL}>What's new</a>
        <a href={RELEASES_URL}>All releases on GitHub</a>
      </nav>
    </div>
  );
}

export function DownloadView({
  data,
  system,
  loading = false,
  windowsStarted = false,
}: {
  data: Packages | null;
  system: Card | null;
  loading?: boolean;
  windowsStarted?: boolean;
}) {
  const { copy, state } = useCopy(INSTALL_COMMAND);
  const [windows, setWindows] = useState(windowsStarted);
  const started = (id: Card) => (id === "windows" ? () => setWindows(true) : undefined);
  const find = (id: string) => data?.packages.find((p) => p.id === id);
  const cards = [...CARDS].sort((a, b) => Number(b.id === system) - Number(a.id === system));
  return (
    <section className="w7-sec w7-nf" aria-labelledby="dl-h">
      <div className="w7-wrap">
        <h1 id="dl-h" className="w7-h2">Get the QualityLayer App</h1>
        <p className="w7-lead">Use the App on your computer or open it in your browser. Restart the App to install updates.</p>
        <ReleaseLine data={data} loading={loading} />
        <div className="ap-dl">
          {cards.map((card) => {
            const main = find(card.main);
            const other = card.other && find(card.other.id);
            return (
              <div className="ap-os" data-current={card.id === system ? "true" : undefined} key={card.id}>
                <a className="ap-os-main" href={main?.url ?? RELEASES_URL} onClick={main ? started(card.id) : undefined}>
                  <Icon path={card.icon} />
                  <span>
                    <b>{card.title}</b>
                    <small>{card.about}</small>
                    {main !== undefined && <small>{sizeLabel(main.size)}</small>}
                  </span>
                </a>
                {other && (
                  <a className="ap-os-other" href={other.url} onClick={started(card.id)}>
                    {`${card.other!.label} version · ${sizeLabel(other.size)}`}
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <div className="ap-cli">
          <Icon path={TERMINAL} stroke />
          <span>
            <b>Browser setup and CLI</b>
            <small>Install where your agent runs, then open the workspace with qualitylayer app. Works in WSL, dev containers and servers.</small>
            <span className="w7-cmd">
              <code>{INSTALL_COMMAND}</code>
              <Button type="button" onClick={() => void copy()} aria-label="Copy install command">
                {state === "done" ? "Copied" : state === "error" ? "Select the text" : "Copy"}
              </Button>
            </span>
          </span>
        </div>
        {windows ? <WindowsNote /> : null}
      </div>
    </section>
  );
}

const Download = () => {
  const [data, setData] = useState<Packages | null>(null);
  const [loading, setLoading] = useState(true);
  const [arch, setArch] = useState<string | undefined>(undefined);
  const system = typeof navigator === "undefined" ? null : systemOf(navigator.userAgent, arch);

  useEffect(() => {
    let live = true;
    void loadPackages().then((loaded) => {
      if (!live) return;
      setData(loaded);
      setLoading(false);
    });
    // Only Chromium says which chip a Mac has; the others keep the Apple silicon card.
    const hints = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(keys: string[]): Promise<{ architecture?: string }> } }).userAgentData;
    void hints?.getHighEntropyValues(["architecture"]).then((values) => live && setArch(values.architecture), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <SEO />
      <Page>
        <DownloadView data={data} system={system} loading={loading} />
      </Page>
    </>
  );
};

export default Download;
