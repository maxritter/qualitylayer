#!/usr/bin/env node
/**
 * IndexNow submitter for the deployed website's sitemaps. The production
 * assembly (scripts/build-deploy.sh) runs it after build-all.sh has merged
 * the Vite pages and the Docusaurus docs and blog into dist/.
 *
 * Usage:
 *   node scripts/indexnow-submit.mjs <sitemap-path> [--filter <prefix>] [--root <dist>]
 *
 * --root names the published folder; the submission stops when its
 * <key>.txt is missing, since search engines reject a key they cannot fetch.
 *
 * Examples:
 *   node scripts/indexnow-submit.mjs dist/sitemap-pages.xml --root dist
 *   node scripts/indexnow-submit.mjs dist/docs/sitemap.xml --filter /blog/
 *   node scripts/indexnow-submit.mjs dist/docs/sitemap.xml          # all
 *
 * Environment:
 *   INDEXNOW_DISABLE=1   skip submission (used for non-prod builds)
 *   INDEXNOW_KEY=<hex>   override the default key
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SITE_HOST = "qualitylayer.dev";
const SITE_URL = `https://${SITE_HOST}`;
const DEFAULT_KEY = "4cfdecbb7e7995c71fc905bcdf607b8e";
const ENDPOINT = "https://api.indexnow.org/IndexNow";

const args = process.argv.slice(2);
const sitemapPath = args[0];
const filterIdx = args.indexOf("--filter");
const filterPrefix = filterIdx >= 0 ? args[filterIdx + 1] : null;

if (!sitemapPath) {
  console.error("usage: indexnow-submit.mjs <sitemap-path> [--filter <prefix>] [--root <dist>]");
  process.exit(2);
}

if (process.env.INDEXNOW_DISABLE === "1") {
  console.log("\x1b[33m⚠\x1b[0m IndexNow skipped (INDEXNOW_DISABLE=1)");
  process.exit(0);
}

const absSitemap = resolve(sitemapPath);
if (!existsSync(absSitemap)) {
  console.log(`\x1b[33m⚠\x1b[0m IndexNow: ${absSitemap} not found, skipping`);
  process.exit(0);
}

const key = process.env.INDEXNOW_KEY ?? DEFAULT_KEY;
const rootIdx = args.indexOf("--root");
if (rootIdx >= 0 && !existsSync(resolve(args[rootIdx + 1] ?? "", `${key}.txt`))) {
  console.log(`\x1b[31m✗\x1b[0m IndexNow: key file ${key}.txt missing from output, aborting submit`);
  process.exit(0);
}
const xml = readFileSync(absSitemap, "utf8");
let urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g))
  .map((m) => m[1].trim())
  .map((u) => u.split("#")[0])
  .filter((u, i, arr) => arr.indexOf(u) === i)
  .filter((u) => u.startsWith(SITE_URL));

if (filterPrefix) {
  const prefix = `${SITE_URL}${filterPrefix}`;
  urls = urls.filter((u) => u === prefix.replace(/\/$/, "") || u.startsWith(prefix));
}

if (urls.length === 0) {
  console.log(`\x1b[33m⚠\x1b[0m IndexNow: no URLs after filter (${filterPrefix ?? "none"}), skipping`);
  process.exit(0);
}

const payload = {
  host: SITE_HOST,
  key,
  keyLocation: `${SITE_URL}/${key}.txt`,
  urlList: urls,
};

try {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (res.status === 200 || res.status === 202) {
    console.log(
      `\x1b[32m✓\x1b[0m IndexNow: submitted ${urls.length} URL(s) from ${sitemapPath} (HTTP ${res.status})`
    );
  } else {
    const body = await res.text().catch(() => "");
    console.log(`\x1b[33m⚠\x1b[0m IndexNow: HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
} catch (err) {
  console.log(`\x1b[33m⚠\x1b[0m IndexNow: network error — ${err.message}`);
}
