import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";
import { createMetricsFilter } from "../src/lib/metrics-privacy.js";
import { startDocusaurusAnalytics } from "./docusaurus-analytics.js";

function insertionPoint(html) {
  let docusaurus = false;
  let tracked = false;
  let offset;

  function visit(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (node.tagName === "meta" && attrs.name?.toLowerCase() === "generator" && /^Docusaurus\b/i.test(attrs.content ?? "")) docusaurus = true;
    if (node.tagName === "head") offset = node.sourceCodeLocation?.endTag?.startOffset;
    if (node.tagName === "script" && attrs.src) {
      const url = new URL(attrs.src, "https://qualitylayer.dev");
      if (/^\/(?:_vercel\/insights|va)\/script(?:\.debug)?\.js$/.test(url.pathname)
        || url.hostname === "va.vercel-scripts.com"
        || /^\/assets\/(?:website-|docusaurus-analytics-)/.test(url.pathname)) tracked = true;
    }
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(parse(html, { sourceCodeLocationInfo: true }));
  if (!docusaurus || tracked) return null;
  if (offset === undefined) throw new Error("Docusaurus page has no closing head tag");
  return offset;
}

/** Insert outside the hydrated root; preserve all existing HTML bytes, including inline CSP hashes. */
export async function injectDocusaurusAnalytics(dist) {
  const pages = [];

  for (const name of (await readdir(dist, { recursive: true })).sort()) {
    if (!name.endsWith(".html")) continue;
    const file = path.join(dist, name);
    const html = await readFile(file, "utf8");
    const offset = insertionPoint(html);
    if (offset !== null) pages.push({ file, html, offset, pathname: `/${name.replace(/\\/g, "/").replace(/\.html$/, "").replace(/(?:^|\/)index$/, "")}` });
  }

  const publicPaths = pages.map(({ pathname }) => pathname);
  const source = `(${startDocusaurusAnalytics.toString()})((${createMetricsFilter.toString()})(${JSON.stringify(publicPaths)}));\n`;
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const asset = `/assets/docusaurus-analytics-${hash}.js`;
  const tag = `<script defer src="${asset}"></script>`;

  // Validate every page before writing, so a changed Docusaurus template fails the build cleanly.
  if (pages.length) {
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await writeFile(path.join(dist, asset.slice(1)), source);
    for (const { file, html, offset } of pages) await writeFile(file, html.slice(0, offset) + tag + html.slice(offset));
  }
  return { injected: pages.length, asset };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { injected } = await injectDocusaurusAnalytics(path.resolve(process.argv[2] ?? "dist"));
  console.log(`Docusaurus Web Analytics: added to ${injected} HTML pages`);
}
