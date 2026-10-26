import React, { useEffect, useMemo, useRef } from 'react';
import { loadReleasePage, publishedOn, releaseAnchor, type Release, type ReleaseLoader } from './changelog-data';
import { useEarlierPages, useFirstPage } from './changelog-state';
import ReleaseMarkdown from './ReleaseMarkdown';
import '../css/changelog.css';

const RELEASES = 'https://github.com/maxritter/qualitylayer/releases';

function ReleaseSection({ release, latest = false }: { release: Release; latest?: boolean }) {
  return <section className={`cl-rel${latest ? ' cl-latest' : ''}`}>
    <header className="cl-version">
      <h2 id={releaseAnchor(release.version)} tabIndex={-1} aria-label={`${release.version}${latest ? ', latest release' : ''}`}>{release.version}</h2>
      <p className="cl-published"><time dateTime={release.published ?? undefined}>{publishedOn(release.published)}</time></p>
    </header>
    <ReleaseMarkdown notes={release.notes} />
  </section>;
}

function Loading() {
  return <div className="cl-state" role="status"><p>Loading release notes…</p><div className="cl-loading-lines" aria-hidden="true"><span /><span /><span /></div></div>;
}

function Unavailable({ retry }: { retry: () => void }) {
  return <div className="cl-state" role="alert"><p><strong>Release notes could not be loaded.</strong></p><p>Try again, or <a href={RELEASES}>read the published notes on GitHub</a>.</p><button type="button" onClick={retry}>Retry</button></div>;
}

function History({ notes, history }: { notes: Release[]; history: ReturnType<typeof useEarlierPages> }) {
  if (!notes.length && history.nextPage === null) return null;
  return <>
    <h2 id="earlier-releases" tabIndex={-1}>Earlier releases</h2>
    <details className="cl-history"><summary>Pilot Shell release history</summary>
      {notes.map(release => <ReleaseSection key={release.version} release={release} />)}
      {history.error ? <p className="cl-older-problem" role="alert">Earlier releases could not be loaded. The notes above are still available.</p> : null}
      {history.nextPage !== null ? <button type="button" disabled={history.loading} onClick={() => void history.earlier()}>{history.loading ? 'Loading earlier releases…' : history.error ? 'Retry earlier releases' : 'Load earlier releases'}</button> : history.finished ? <p className="cl-history-end">All published release notes are shown.</p> : <p className="cl-history-end"><a href={RELEASES}>Read the complete history on GitHub</a>.</p>}
    </details>
  </>;
}

function Releases({ notes, history }: { notes: Release[]; history: ReturnType<typeof useEarlierPages> }) {
  const current = notes.filter(row => Number(row.version.split('.')[0]) >= 12);
  const legacy = notes.filter(row => Number(row.version.split('.')[0]) < 12);
  return <>
    {current.map((release, index) => <ReleaseSection key={release.version} release={release} latest={index === 0} />)}
    {!notes.length && history.nextPage === null ? <p>No published release notes are available yet.</p> : null}
    <History notes={legacy} history={history} />
    {notes.length ? <aside className="cl-outline"><nav aria-label="On this page">{current.map(release => <a key={release.version} href={`#${releaseAnchor(release.version)}`}>{release.version}</a>)}{legacy.length || history.nextPage !== null ? <a href="#earlier-releases">Earlier releases</a> : null}</nav></aside> : null}
  </>;
}

export default function Changelog({ load = loadReleasePage }: { load?: ReleaseLoader }) {
  const focusAfter = useRef<string | null>(null);
  const anchorHandled = useRef(false);
  const first = useFirstPage(load);
  const history = useEarlierPages(load, first.page, version => { focusAfter.current = releaseAnchor(version); });
  const notes = useMemo(() => [...new Map([...(first.page?.notes ?? []), ...history.pages.flatMap(page => page.notes)].map(row => [row.version, row])).values()], [first.page, history.pages]);
  useEffect(() => {
    if (focusAfter.current) {
      document.getElementById(focusAfter.current)?.focus({ preventScroll: true });
      focusAfter.current = null;
    }
    if (anchorHandled.current || !location.hash) return;
    let id: string;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    const history = target.closest('details');
    if (history) history.open = true;
    target.scrollIntoView();
    anchorHandled.current = true;
  }, [notes]);
  const retry = () => { focusAfter.current = 'changelog'; first.retry(); };
  return <div className="cl-page">
    <h1 id="changelog" tabIndex={-1}>Changelog</h1>
    <p>Notable changes to QualityLayer and its predecessor, Pilot Shell.</p>
    {first.loading ? <Loading /> : first.error ? <Unavailable retry={retry} /> : <Releases notes={notes} history={history} />}
    <p className="cl-source"><a href={RELEASES}>Published releases on GitHub</a></p>
  </div>;
}
