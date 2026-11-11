#!/bin/bash
# Build the website: the Vite landing page and App demo plus the Docusaurus docs and blog,
# combined into one static output. It needs only the site's and the docs' own dependencies.
# Output: docs/site/dist/ (Vite) with docs/site/dist/docs/ (Docusaurus)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR"
DOCUSAURUS_DIR="$SCRIPT_DIR/../docusaurus"

echo "=== Building Vite landing page ==="
cd "$SITE_DIR"
npm ci --prefer-offline 2>/dev/null || npm install
npm run build

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

echo "=== Build complete ==="
echo "Landing page: $DIST/"
echo "Documentation: $DIST/docs/"
echo ""
echo "File counts:"
echo "  docs: $(find "$DIST/docs" -name '*.html' | wc -l | tr -d ' ') pages"
