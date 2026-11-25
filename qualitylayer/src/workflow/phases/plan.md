# Plan: agree what to build, then the one approval before any code

Plan is step 1 of 3. Settle the problem, Done means and approach, and get `{plan_doc}` approved once before any code. A fresh build session reads only the saved files.

**Done when** nothing is left open: every person-only choice is answered, everything else you settled and listed, `qualitylayer plan draft` reports no error, and the gate is open with its review answered.

## Understand the request

1. **Read touched code and prior decisions first** (`memory_search` or `qualitylayer memory search`, `qualitylayer find "<words>"`). Options name real files; a settled decision is not asked again. Reversals note `Reverses <task>, decision <n>: <what changes>` in the agents' file.
2. **Name and classify the task**: `qualitylayer task set title="<action and topic>"` (2 to 8 words) unless named. If this checkout does not hold the product the request is about, name its path and ask the person to start the task in the right project. Set `type=bugfix|feature`, `ui=true` when a visible surface changes, and **`profile=small`** whenever one cohesive module or focused change builds it in 1 slice with no external risk. Keep a short native task checklist (`TodoWrite` / `update_steps` / `update_plan`) current so the App shows live progress while you work.
3. **Read by size.** Read a small task yourself. Otherwise write numbered how-it-works-today questions under *Questions for helpers* in `agents/{plan_doc}` (2–4 per helper, with where to look), run `qualitylayer brief plan` to get `helpers`, run them in parallel on their `brief_file`, and save each report via `qualitylayer helper result <id> --file <path>`. Reports land in `{research_dir}` as written. Stop reading once every Done means point has a place in the code, an approach and a proof. Every finding the Plan rests on is one line under *Findings* with a `file:line` that resolves, linking its report (`{research_dir}/r1.md#2`). Save live probes under `{records_dir}/`.

## Ask only what you cannot decide

Ask (*Asking the person*) in the order that changes what gets built: problem/Done means, scope, observable behaviour (empty/loading/error states, contracts, migrations), then technical shape only where it affects contracts or users. Ask early—as soon as you finish reading touched code, before drafting the full Plan—and keep working on unblocked parts. Decide reversible/code-answered details yourself under *Decisions made for you* with reasons. Set `about: {"doc": "{plan_doc}", "section": "<heading>", "quote": "<words>"}` and link answers with `qualitylayer question link <id> --points 1,3`.

## Write the two files

Fill both templates in place and keep `{plan_doc}`'s front matter. Template hints own section formatting; write **Summary**, **Done means** and **Approach**, and optional sections only when non-empty. Keep `ql:` markers as two empty lines. Write each fact once.

Four Plan layout rules (apply from the first draft):
- *Summary*: one plain sentence on what the user gets, the outcome in 2 to 4 one-line bullets, then `**Size:**` and `**Trust boundary:**` (`**Risk:**` / `**Integrations:**` only when backed by the Plan).
- **Scope**: always use `### In scope` and `### Out of scope` subheadings (under `### In scope`, add `` - **Repository:** `/absolute/path` `` when another checkout is needed).
- **Diagrams**: give every Mermaid block its own concise `### <Title>` heading and a one-line caption below it (so the App never repeats the caption as a truncated title). For a new/changed router, agent or pipeline, diagram how requests move, branch and call tools.
- **Done means (deterministic vs. stochastic)**: follow `Runs as:` and the `A1`/`A2` table with **3 to 6 consolidated observable steps** (group related cases and refusals into one step instead of one row per edge case; never test filters; name the *Interface* artifact for screens; mark person-only/remote steps under the step). Separate deterministic code/contract checks from stochastic or live-LLM/eval checks — give probabilistic checks an explicit pass threshold and a hard spend/retry cap instead of "in every run". For a rule, parser, policy, or state transition, state both when it holds and when it refuses (converses and boundaries) in Done means and Contracts — settle obvious defaults under *Decisions made for you* and ask only genuine product trade-offs.

Additional file rules:
- `{plan_doc}` is for people: plain words, no `file:line` in lead sections, each list item opening with a **bold headline sentence**. *Approach*: Chosen, Gives, Costs, then at most five bullets of what changes.
- `agents/{plan_doc}` holds build working notes (request, findings, contracts, code to imitate, start/test, checks, rejected approaches, risks, pitfalls). Where the two differ, the Plan wins.
- With `ui: true`, update the lasting model first, draw changed surfaces as product-fidelity artifacts between `<!-- ql:artifact <name> -->` markers (`qualitylayer artifact guide`), run one fresh check, save via `qualitylayer helper result <id> --file <path>`, and answer every finding `Answer: Taken · <what changed>` or `Answer: Kept · <why>`.
- Settle human prerequisites (`met` or `granted` under *Prerequisites*, keeping `P1`), spike unproven dependencies under *Proven before the gate*, and turn late design choices into a **Your call** (`late: true` under *Engineering decisions*, folded via `question reply`).

## Draft, gate, approval

1. **Draft and open in one pass:** `qualitylayer plan draft` already validates `{plan_doc}` and starts any review, so skip a separate `validate` turn right before it (use `validate` only if checking an unfinished edit). Check once for contradictions, ambiguity, and lifecycle gaps, then run `qualitylayer plan draft` and fix any errors in one pass.
2. **Open the gate at once:** run `qualitylayer gate open plan` (or chain `qualitylayer plan draft --json && qualitylayer gate open plan --json` when no Plan review is enabled).
3. On `reviews`: `qualitylayer wait --for review`, read `{reviews_dir}/plan.md`, apply taken edits and answer every finding in one pass: `Answer: Taken · <what changed>`, `Answer: Kept · <why>`, or `Answer: Ask · <the question>` (`"late": true`, `"settles": ["plan:finding:<n>"]`). For a panel, a finding marked `Panel: all` you take, or ask the person and keep it only when they pick the keep choice (`"kind": "keep"`); a `Panel: split` one you decide, giving both views and your reason. Re-open with `gate open plan` once answers are folded in.
4. Follow the gate reply. In App approvals it carries `presentation.planHandoff`: say that once and ask nothing; the person uses **Approve and build here** or comments in the App. In agent approvals it carries `your_turn`: say it, show `qualitylayer read {plan_doc} --lead`, then send each `chat_review` entry with `qualitylayer question ask '<entry>'` and ask its `chat_questions` (on **Show the Plan**, print `--lead`; on **Give feedback**, ask what to change). While the gate is open, wait with `qualitylayer wait --for approval` (background when supported, repeat while `pending`).
5. On approval, print `message`, ask any `chat_questions` and end your turn (only run `qualitylayer build start` now if they chose to keep this conversation). From here, Plan changes go through `qualitylayer plan amend --by agent|user --note "<what changed, and why>"`.

If the person asks for a plain prompt, run `qualitylayer task handback "<reason>" --prompt "<prompt>"`.
