# Media catalogue

Pictures for decks, posts, videos and pages about QualityLayer. Pick from here first; every file is
ready to use as it is. Each section says what the pictures show and where they came from, so you can
make more that match.

| Folder | What it holds |
|---|---|
| [`illustrations/`](#illustrations) | Eight 3D scenes in one style, without any words in them |
| [`screenshots/`](#app-screenshots) | Eleven App views, each a whole window, card or panel |
| [`diagrams/`](diagrams/README.md) | The software-factory diagrams and research charts, dark and light |
| [`marks/`](#marks) | The QualityLayer mark and Max's mark |
| [`people/`](#people) | Max's portrait |
| this folder | The verification cards and the Inside QualityLayer share pictures |

## Illustrations

Generated with Imagegen (ChatGPT images through the Codex login) for the "Inside QualityLayer" webinar
deck, 29 October 2026. All eight share one style: glossy 3D objects on a near-black background, blue for
agents, amber for what a person decides, violet for automated checks. They contain no text, so they work
in any language. `prompts/` holds the full prompt for each and `style.txt` the shared style block; reuse
both to make a new scene that matches.

| Picture | File | Size | Shows |
|---|---|---|---|
| <img src="illustrations/factory-conveyor.webp" width="220" alt=""> | `factory-conveyor.webp` | 1672 × 941 | A conveyor with seven stations, from a chat bubble to an approved document, and a person at a console who receives the result. The webinar's title picture. |
| <img src="illustrations/data-evidence.webp" width="220" alt=""> | `data-evidence.webp` | 1254 × 1254 | Glass bar columns rising beside a stack of unread pull requests with a red warning light, a benchmark board with a few cracked tiles, and a magnifying glass |
| <img src="illustrations/factory-lights-off.webp" width="220" alt=""> | `factory-lights-off.webp` | 1254 × 1254 | The factory with the lights off: robot arms fill a conveyor, the review desk is empty and unread documents pile up |
| <img src="illustrations/shift-left-blueprint.webp" width="220" alt=""> | `shift-left-blueprint.webp` | 1254 × 1254 | A person places amber comment markers on a glass blueprint at the start of a factory line, while blue robot arms wait to build; an amber arrow points back to the blueprint |
| <img src="illustrations/factory-lights-on.webp" width="220" alt=""> | `factory-lights-on.webp` | 1254 × 1254 | The factory with the lights on: a person approves the blueprint, robot arms build, violet arches check, a second person approves the result |
| <img src="illustrations/plan-diagram-and-mockup.webp" width="220" alt=""> | `plan-diagram-and-mockup.webp` | 1254 × 1254 | A diagram and a screen mockup side by side, with amber comment pins and an approval check |
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
| <img src="screenshots/plan.webp" width="220" alt=""> | `plan.webp` | 2664 × 2024 | The whole window at the Plan: its open decision with both paths drawn, beside the agent's conversation |
| <img src="screenshots/artifact.webp" width="220" alt=""> | `artifact.webp` | 1720 × 1164 | A design (artifact) beside the Plan: a queue migration console with its Default, Loading and Error states and numbered comment pins. Fades out at the bottom. |
| <img src="screenshots/library.webp" width="220" alt=""> | `library.webp` | 1840 × 892 | The Library: one project's designs, one being changed by two tasks, with a page conflict |
| <img src="screenshots/home.webp" width="220" alt=""> | `home.webp` | 2664 × 1496 | Home: Needs you, Running and Shipped lately, each task with its step and your next move |
| <img src="screenshots/implement.webp" width="220" alt=""> | `implement.webp` | 2664 × 1664 | The whole window at Implement: the slice board while the build runs, with its task cards and the session beside it |
| <img src="screenshots/verify.webp" width="220" alt=""> | `verify.webp` | 2664 × 1664 | The whole window at Verify, ready for you: what was checked, the code to review and the one Approve |
| <img src="screenshots/settings-reviews.webp" width="220" alt=""> | `settings-reviews.webp` | 1520 × 596 | Settings, Reviews: independent review, second opinion and design review |
| <img src="screenshots/pull-request.webp" width="220" alt=""> | `pull-request.webp` | 2664 × 1664 | The merged pull request: its checks, its reviewers and the time from the first question to the approval |
| <img src="screenshots/chat.webp" width="220" alt=""> | `chat.webp` | 2664 × 1664 | The whole window in Chat: no steps or approvals, and Convert to task |
| <img src="screenshots/memory-local.webp" width="220" alt=""> | `memory-local.webp` | 1520 × 354 | Settings, Local memory: remember useful lessons, lessons in every session |
| <img src="screenshots/memory-saved.webp" width="220" alt=""> | `memory-saved.webp` | 1520 × 646 | Saved memories: lessons with where each is kept, such as shared in Git |

The whole-window views (`plan`, `home`, `implement`, `verify`, `pull-request`, `chat`) are the website's dark
product pictures from the three-step App (Plan, Implement, Verify), captured on 11 November 2026 with
`npm run screenshots` in `docs/site`. The website's own pictures in `docs/site/public/product/` hold
both themes and phone views; use those when you need a light-theme or phone picture.

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
