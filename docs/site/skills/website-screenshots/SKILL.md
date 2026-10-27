---
name: website-screenshots
description: Regenerate QualityLayer website and README screenshots from the source App after its UI changes, or when refreshing the developer example gallery.
---

# Website screenshots

Use the website's source App demo in its story world (`?story`): one billing
task in acme/platform from request to merged pull request, the same content the
live demo, the guided web demo and the presenter show. The demo's data in
`qualitylayer/src/ui/demo/` (`story-world.ts`, `seven/`, `artifacts.ts`,
`backend-artifact.ts`, `memory.ts`) supplies questions, documents, artifacts and
checks; production components supply the interface. Each scene names its story
moment and address in `docs/site/scripts/website-screenshots.mjs`. The screenshot
command uses a temporary browser profile and in-memory data.

From `docs/site/`, run `npm run screenshots`. It starts and closes its own
loopback source server, renders every scene (`npm run screenshots -- --list`) in both themes, desktop and phone, at twice the
pixel density, and writes lossless WebP assets to `public/product/`. The website
and README use these same files. `npm run screenshots -- --only plan,team`
refreshes selected scenes. Dependencies are the locked website and QualityLayer
development dependencies.

Inspect the captured pictures together: the shown project and content must
explain the section, text must be sharp when enlarged, diagrams must have
rendered, and controls must fit. Every scene shows the one billing story; keep
the pictures, their alt texts (`docs/site/src/lib/steps.ts`, `Editorial.tsx`,
the README and the docs) and the live demo telling the same story. Capture
actual UI rather than drawing an imitation. The pictures keep the App's own
colors.

The command rejects internal beta-build content, remote requests and real API
calls. A failing scene leaves its last good published image in place; fix the
fixture or selector and rerun it. Review `capture-manifest.json` alongside the
images. Run the focused site checks and a desktop/phone pass of the affected
gallery and its full-size image dialog.

This skill updates local assets. Commit, deploy and replace Claude Design
pages only within the user's current authorization. Use the existing
deploy-website and open-claude-design skills for those destinations.
