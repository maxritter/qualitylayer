# Asking the person

Clear everything needing the person before approval: ask it, or settle reversible/code-answered choices under *Decisions made for you*. Always ask when a new feature runs and whether its result binds anyone. Risks are asked or settled, then accepted; visual/wording judgements happen when approving what shows them.

Ask in the App with `qualitylayer question ask --batch --file <path>` (or `--batch '<json>'`). Batch independent choices, highest-unblock first, and keep working on unblocked tasks. Example: `qualitylayer question ask --batch '{"id":"b1","title":"Scope","ahead":"Then draft the Plan","questions":[{"id":"q1","question":"...","choices":[{"label":"..."},{"label":"..."}],"recommended":0,"points":[],"grade":1,"why":"..."}]}'`.

| Field | Holds |
| --- | --- |
| batch | `id`, `title`, `"ahead"` (one line on what remains), `questions` |
| question | stable `id` (`q<n>`), short `"question"`, 2–6 `choices`, `recommended` (index, or array with `"multi": true`), `points` (Done means numbers, or `[]` before written), `grade` |
| grade 1 | local/reversible: one-sentence `"why"` |
| grade 2 | single-area trade-off: 2–3 `"facts"` per choice |
| grade 3 | cross-area, trust boundary, interface or costly: on each choice (not the question), add grounded `"evidence": [{"label": "<file:line or passage>"}]` (saved to *Evidence behind the choices* in agents' file) and a small Mermaid `"diagram"` where helpful; write `"facts"` on each choice as weighable consequences |
| screen | any grade involving visual layout: set `"artifact": "artifacts/<name>.html"` (or `<page>.html#<section>`) on the question or each choice so the card renders it inline; sketch layout options first as wireframes (`qualitylayer artifact new <name> --wire`) |

- **Mode & `your_turn`:** say `your_turn` verbatim once per batch when returned. In agent mode, ask `chat_questions` in the native picker (or numbered choices and end turn), recording exact words via the returned command; never answer for the person.
- **Take each answer once:** on a hook notice, run its `qualitylayer question poll` command; apply `answered_meanwhile` and `changed_answers` to linked points, then `question reply <id> --text "<what changed>" --answer-at <receipt.saved>`. Rewrite downstream Plan passages affected by changed answers without re-asking.
- **Not sure** takes your recommendation (`Not known · assumed <recommendation>` in *Decided with you*, listed under *Assumptions*).
- **Tell me more:** `qualitylayer question more <id> --file <json>` with `"found": {"text", "evidence"}`, `grade + 1`, keeping choice order and recommendation.
