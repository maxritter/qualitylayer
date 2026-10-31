#!/bin/bash
# Build both the Vite landing page and Docusaurus docs, combine into single output.
# Output: docs/site/dist/ (Vite) with docs/site/dist/docs/ (Docusaurus)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR"
DOCUSAURUS_DIR="$SCRIPT_DIR/../docusaurus"

echo "=== Building Vite landing page ==="
cd "$SITE_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
if [ "${VERCEL:-}" = "1" ]; then
  node "$SITE_DIR/scripts/compile-shared-api.mjs" --profile "${QUALITYLAYER_BACKEND_PROFILE:-current}"
fi
npm run build

echo "=== Verifying CSP inline-script hashes ==="
node "$SITE_DIR/scripts/verify-csp-hash.mjs"

echo "=== Building Docusaurus docs ==="
cd "$DOCUSAURUS_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
npm run build

echo "=== Combining outputs ==="
DIST="$SITE_DIR/dist"
BUILD="$DOCUSAURUS_DIR/build"

# Copy Docusaurus docs into Vite dist
cp -r "$BUILD/docs" "$DIST/docs"

# With Docusaurus `trailingSlash: false`, the docs entry page builds as `docs.html`
# at the build root (not `docs/index.html`). Copy it so `/docs` resolves via Vercel's
# cleanUrls — without this, /docs would fall through to the SPA rewrite and serve
# the marketing page instead of the docs intro.
[ -f "$BUILD/docs.html" ] && cp "$BUILD/docs.html" "$DIST/docs.html"

# Copy Docusaurus blog. Same trailingSlash story: blog list page builds as
# `blog.html` at the build root, individual posts under `blog/`. RSS/atom feeds
# land inside `blog/` too (rss.xml, atom.xml, feed.json).
[ -d "$BUILD/blog" ] && cp -r "$BUILD/blog" "$DIST/blog"
[ -f "$BUILD/blog.html" ] && cp "$BUILD/blog.html" "$DIST/blog.html"

# Merge Docusaurus assets into Vite assets (no filename conflicts — Vite uses hashes, Docusaurus uses css/js subdirs)
cp -r "$BUILD/assets/"* "$DIST/assets/"

# Copy search plugin files. With trailingSlash: false, search becomes search.html
# (a file at root) instead of search/index.html.
if [ -f "$BUILD/search.html" ]; then
  cp "$BUILD/search.html" "$DIST/search.html"
elif [ -d "$BUILD/search" ]; then
  cp -r "$BUILD/search" "$DIST/search"
fi
[ -f "$BUILD/search-index.json" ] && cp "$BUILD/search-index.json" "$DIST/search-index.json"

# Copy Docusaurus img (favicon etc.) — merge into existing img or create
if [ -d "$BUILD/img" ]; then
  mkdir -p "$DIST/img"
  cp -r "$BUILD/img/." "$DIST/img/"
fi

echo "=== Adding Web Analytics to Docusaurus pages ==="
node "$SITE_DIR/scripts/inject-docusaurus-analytics.mjs" "$DIST"

# Generate the docs/blog sitemap from final canonical HTML; preserve the marketing index.
node "$SITE_DIR/scripts/generate-docs-sitemap.mjs" "$DIST"
# Copy any other Docusaurus xml files (rss, atom, etc.) to /docs/
for f in "$BUILD"/*.xml; do
  if [ -f "$f" ] && [ "$(basename "$f")" != "sitemap.xml" ]; then
    cp "$f" "$DIST/docs/" 2>/dev/null || true
  fi
done

# IndexNow: submit /blog/ + /docs/ URLs from the merged Docusaurus sitemap.
# The Vite plugin runs at the end of `npm run build` and only sees /
# (Docusaurus hasn't been merged in yet at that point). We submit the rest
# here, after the merge. Submission is gated by the same INDEXNOW_DISABLE
# env var as the Vite plugin, and only runs when VERCEL_ENV=production.
if [ "$VERCEL_ENV" = "production" ] && [ -f "$DIST/docs/sitemap.xml" ]; then
  echo "=== IndexNow: submitting blog + docs URLs ==="
  cd "$SITE_DIR"
  node scripts/indexnow-submit.mjs "$DIST/docs/sitemap.xml" --filter /blog/ || true
  node scripts/indexnow-submit.mjs "$DIST/docs/sitemap.xml" --filter /docs/ || true
fi

echo "=== Build complete ==="
echo "Landing page: $DIST/"
echo "Documentation: $DIST/docs/"
echo ""
echo "File counts:"
echo "  docs: $(find "$DIST/docs" -name '*.html' | wc -l | tr -d ' ') pages"
