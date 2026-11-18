# Asking the person

Everything that needs the person is cleared before they approve: ask it, or settle it yourself and
list it under *Decisions made for you*. When a new feature runs and whether its result binds anyone
are the person's choices: ask them, never settle them. A risk is asked or settled, then accepted. A judgement only
they can make (a design, the wording) they make when they approve what shows it.

Ask in the App with `qualitylayer question ask --batch '<json>'` or
`qualitylayer question ask --batch --file <path>`; it returns at once. Batch independent choices, the
one that unblocks most first, and ask a dependent choice once its options are known. A clear request
may need no question. Keep working on what no open answer blocks.

| Field | Holds |
| --- | --- |
| batch | `id`, `title`, `"ahead"` (one line on what is still to come), `questions` |
| question | a stable `id` (`q<n>`, unique in the task), a short `"question"`, 2 to 6 `choices`, `recommended` (an index; an array with `"multi": true`), `points` (the Done means numbers it settles; `[]` until the Plan writes them), `grade` |
| grade 1 | local and reversible: one sentence in `"why"` |
| grade 2 | a trade-off inside one area: 2 to 3 `"facts"` per choice |
| grade 3 | crosses areas or a trust boundary, changes an interface or is costly to undo: each choice also carries `"evidence": [{"label": "<file:line or passage>"}]`, never invented, and, where it helps, a small Mermaid `"diagram"`. The card shows the person only the facts and the diagram, so write each fact as a consequence they can weigh; QualityLayer keeps the evidence in the step's agents file under *Evidence behind the choices* |
| a screen | at any grade, when a question is about something you drew ("as in the picture", two layouts to choose between): `"artifact": "artifacts/<name>.html"` (or `artifacts/<name>/<page>.html`, optionally `#<section id>`) on the question for one screen, or on each choice for the screen it leads to. The card draws it in place; naming an artifact only in words leaves the person to search for it. Before you ask how something should look (tabs or a dropdown, where a control sits), sketch each option as a wireframe (`qualitylayer artifact new <name> --wire`) and put it on its choice: people pick a look from a picture, not from words |

- **Say the reply's `your_turn`** exactly, once per batch, when the reply carries one. Questions in your agent: ask the returned
  `chat_questions` in the native picker, or show numbered choices and end the turn; record their
  exact words through the returned command. Never answer for the person.
- **Take each answer once**: when a tool hook names a saved App answer, run the `question poll`
  command it gives you. A later QualityLayer verb can also deliver the answer. Apply
  `answered_meanwhile` and `changed_answers` from that reply to the linked points, then
  `question reply <id> --text "<what you changed>" --answer-at <receipt.saved>`. `item_answers` keep
  earlier agreements and their history. An answer that changes an earlier one reopens what the Plan
  built on the earlier one: rewrite those passages, without asking again.
- **Not sure** takes your recommendation (*Decided with you* shows `Not known · assumed <the
  recommendation>`), and the Plan lists it under *Assumptions*.
- **Tell me more**: `qualitylayer question more <id> --file <json>` with `"found": {"text",
  "evidence"}`, `grade` one higher and only the changed `question`, `choices` and `why`. Keep the
  choice order and the recommendation.
