#!/bin/bash
# The production website assembly that Vercel runs (vercel.json buildCommand). It adds the private
# parts to the public website build: the site's full dependency set (docs/site/package.json and
# package-lock.json carry the API and operations packages too), the check that vercel.json's
# Content-Security-Policy allows the built inline scripts, the shared Edge helpers for the API,
# and the IndexNow notice after a production deploy. build-all.sh stays the public build.
set -e

SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$SITE_DIR/dist"

bash "$SITE_DIR/build-all.sh"

echo "=== Verifying CSP inline-script hashes ==="
node "$SITE_DIR/scripts/verify-csp-hash.mjs"

echo "=== Compiling the shared Edge helpers ==="
if [ "${VERCEL:-}" = "1" ]; then
  node "$SITE_DIR/scripts/compile-shared-api.mjs" --profile "${QUALITYLAYER_BACKEND_PROFILE:-current}"
fi

echo "=== IndexNow ==="
# The pages sitemap comes from the Vite build, the docs and blog sitemap from the merged
# Docusaurus output. INDEXNOW_DISABLE=1 always wins; INDEXNOW_SUBMIT=1 submits outside production.
if [ "${VERCEL_ENV:-}" = "production" ] || [ "${INDEXNOW_SUBMIT:-}" = "1" ]; then
  cd "$SITE_DIR"
  node scripts/indexnow-submit.mjs "$DIST/sitemap-pages.xml" --root "$DIST" || true
  if [ -f "$DIST/docs/sitemap.xml" ]; then
    node scripts/indexnow-submit.mjs "$DIST/docs/sitemap.xml" --filter /blog/ --root "$DIST" || true
    node scripts/indexnow-submit.mjs "$DIST/docs/sitemap.xml" --filter /docs/ --root "$DIST" || true
  fi
else
  echo "IndexNow submission skipped (not a production deploy; set INDEXNOW_SUBMIT=1 to opt in)"
fi
