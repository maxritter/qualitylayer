# Media catalogue

Pictures for decks, posts, videos and pages about QualityLayer. Pick from here first; every file is
ready to use as it is. Each section says what the pictures show and where they came from, so you can
make more that match.

| Folder | What it holds |
|---|---|
| [`illustrations/`](#illustrations) | Seven 3D scenes in one style, without any words in them |
| [`screenshots/`](#app-screenshots) | Seventeen App views, each a whole card, panel or window |
| [`diagrams/`](diagrams/README.md) | The software-factory diagrams and research charts, dark and light |
| [`marks/`](#marks) | The QualityLayer mark and Max's mark |
| [`people/`](#people) | Max's portrait |
| this folder | The film poster and the architecture picture |

## Illustrations

Generated with Imagegen (ChatGPT images through the Codex login) for the "Inside QualityLayer" webinar
deck, 29 October 2026. All seven share one style: glossy 3D objects on a near-black background, blue for
agents, amber for what a person decides, violet for automated checks. They contain no text, so they work
in any language. `prompts/` holds the full prompt for each and `style.txt` the shared style block; reuse
both to make a new scene that matches.

| Picture | File | Size | Shows |
|---|---|---|---|
| <img src="illustrations/factory-conveyor.webp" width="220" alt=""> | `factory-conveyor.webp` | 1672 × 941 | A conveyor with seven stations, from a chat bubble to an approved document, and a person at a console who receives the result. The webinar's title picture. |
| <img src="illustrations/factory-lights-off.webp" width="220" alt=""> | `factory-lights-off.webp` | 1254 × 1254 | The factory with the lights off: robot arms fill a conveyor, the review desk is empty and unread documents pile up |
| <img src="illustrations/factory-lights-on.webp" width="220" alt=""> | `factory-lights-on.webp` | 1254 × 1254 | The factory with the lights on: a person approves the blueprint, robot arms build, violet arches check, a second person approves the result |
| <img src="illustrations/plan-diagram-and-mockup.webp" width="220" alt=""> | `plan-diagram-and-mockup.webp` | 1254 × 1254 | A diagram and a screen mockup side by side, with amber comment pins and an approval check |
| <img src="illustrations/people-around-the-plan.webp" width="220" alt=""> | `people-around-the-plan.webp` | 1254 × 1254 | Three people around one plan, each linked to a passage, with question and check bubbles and an agent receiving an answer |
| <img src="illustrations/agents-vertical-slices.webp" width="220" alt=""> | `agents-vertical-slices.webp` | 1254 × 1254 | Agents building three vertical slices, each with a screen, a service and a database layer; the first is checked |
| <img src="illustrations/review-approved.webp" width="220" alt=""> | `review-approved.webp` | 1254 × 1254 | A checklist with every row ticked, a code diff, an amber approval check and a merge symbol |

The files are WebP at quality 92 and full resolution. The PNG originals stay in the deck's untracked
working folder (`.open-claude-design/design-scratch/live-session/gen/`).

## App screenshots

Real App views from the source demo with the website's example projects (billing, identity,
notifications, jobs). Every picture is one whole component or the whole window, never a crop through
the middle of one, so it can be placed on any background at any size. All are WebP at twice the
pixel density. Names, numbers and companies in them are fictional.

| Picture | File | Size | Shows |
|---|---|---|---|
| <img src="screenshots/discuss.webp" width="220" alt=""> | `discuss.webp` | 1392 × 1152 | Discuss: one question with the recommended answer first, your own answer, and the shortcuts |
| <img src="screenshots/research.webp" width="220" alt=""> | `research.webp` | 1424 × 828 | Research: how the code works today, written by helpers that never saw the request, and what the goal puts at risk |
| <img src="screenshots/plan.webp" width="220" alt=""> | `plan.webp` | 2560 × 1200 | The whole window at the Plan: a diagram, the agent answering beside it, and Approve Plan |
| <img src="screenshots/artifact.webp" width="220" alt=""> | `artifact.webp` | 1720 × 1164 | A design (artifact) beside the Plan: a queue migration console with its Default, Loading and Error states and numbered comment pins. Fades out at the bottom. |
| <img src="screenshots/library.webp" width="220" alt=""> | `library.webp` | 1840 × 892 | The Library: one project's designs, one being changed by two tasks, with a page conflict |
| <img src="screenshots/home.webp" width="220" alt=""> | `home.webp` | 2312 × 956 | Home, Needs you: each task with where it is and your next move. Fades out at the bottom. |
| <img src="screenshots/team.webp" width="220" alt=""> | `team.webp` | 2080 × 842 | Team, Questions for you: a teammate asks about a diagram in their Plan; Looks right, Draft with my agent |
| <img src="screenshots/implement-start.webp" width="220" alt=""> | `implement-start.webp` | 1300 × 1274 | Start the build: in the App or in your terminal, the agent, its options and the branch |
| <img src="screenshots/implement.webp" width="220" alt=""> | `implement.webp` | 1344 × 1162 | The slice board while the build runs: two slices done, the third with its task cards |
| <img src="screenshots/verify.webp" width="220" alt=""> | `verify.webp` | 1424 × 770 | Verify: an independent review checking the change, one point only you can confirm, the verification rounds |
| <img src="screenshots/settings-reviews.webp" width="220" alt=""> | `settings-reviews.webp` | 1520 × 596 | Settings, Reviews: independent review, second opinion and design review |
| <img src="screenshots/review.webp" width="220" alt=""> | `review.webp` | 1344 × 1444 | Review: your turn, Review the code, and a captured screen to confirm with Looks right or Change |
| <img src="screenshots/review-code.webp" width="220" alt=""> | `review-code.webp` | 2560 × 1120 | The whole window at the code review: files grouped by slice, a split diff, and why each file changed |
| <img src="screenshots/pull-request.webp" width="220" alt=""> | `pull-request.webp` | 1424 × 898 | The pull request after approval: checks on GitHub, reviewers asked, and the note that QualityLayer never merges |
| <img src="screenshots/chat.webp" width="220" alt=""> | `chat.webp` | 1800 × 1240 | The whole window in Chat with Codex: no steps or approvals, and Start the workflow |
| <img src="screenshots/memory-local.webp" width="220" alt=""> | `memory-local.webp` | 1520 × 354 | Settings, Local memory: remember useful lessons, lessons in every session |
| <img src="screenshots/memory-saved.webp" width="220" alt=""> | `memory-saved.webp` | 1520 × 646 | Saved memories: lessons with where each is kept, such as shared in Git |

Captured on 26 October 2026 from commit `145b6a6fc` with the dark theme. `team.webp` already shows
the question card's fix in `TeamSpace.tsx` (the diagram drawn once, captioned with whose Plan it is),
which was not yet committed that day. The website's own product pictures in
`docs/site/public/product/` come from `npm run screenshots` in `docs/site` and are full-window views
in both themes and on phones; use those when you need a light-theme or phone picture.

## Marks

| Picture | File | Use |
|---|---|---|
| <img src="marks/qualitylayer-mark.png" width="60" alt=""> | `qualitylayer-mark.png` | The QualityLayer mark, 448 × 408, on dark backgrounds |
| <img src="marks/max-ritter-mark.svg" width="60" alt=""> | `max-ritter-mark.svg` | Max Ritter's personal mark, light grey for dark backgrounds |

## People

| Picture | File | Size | Use |
|---|---|---|---|
| <img src="people/max-ritter.webp" width="120" alt=""> | `max-ritter.webp` | 1809 × 2000 | Max Ritter, founder of QualityLayer, on a dark grey background. Leave room above the head when you crop. |

## Kept out of this repository

This repository is public, so pictures of other people stay out of it. The webinar deck in Claude
Design (project "QualityLayer Live Session") holds the host's portrait and bird mark, both from
Manuel Vogel-Johnson's website and the webinar announcement graphic. Ask him before using them
anywhere else.
