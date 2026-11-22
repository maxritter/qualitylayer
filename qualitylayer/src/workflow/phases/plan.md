# Plan: agree what to build, then the one approval before any code

Plan is the first of three steps: Plan, Implement, Verify. You and the person settle the problem, what
done means and the approach, and they approve `{plan_doc}` once, before any code. A build session with
no memory of this conversation then builds from the saved files, so whatever it needs is in them. A
question costs the person's time; a misunderstanding found after approval costs both of you.

**Done when** nothing is left open: every choice only the person can make is answered, everything else
you settled and listed, `qualitylayer plan draft` reports no error, and the gate is open with its review
answered.

## Understand the request

1. **Read the code the request touches first**, and what earlier tasks decided (`memory_search` or
   `qualitylayer memory search`, `qualitylayer find "<words>"`). Options you offer name real files; a
   settled decision is not asked again. A reversal says so in the agents' file: `Reverses <task>,
   decision <n>: <what changes>`.
2. **Name the task**: `qualitylayer task set title="<action and topic>"` (2 to 8 words) unless the
   person named it. If this checkout does not hold the product the request is about, say its path and
   ask the person to start the task in the right project. Set what applies: `type=bugfix` or
   `type=feature`; `ui=true` when a page, dialog or form changes; `profile=small` when the first look
   is traced, nothing risky is touched and one slice builds it.
3. **Read by size.** A small task you read yourself. Otherwise write numbered questions under
   *Questions for helpers* in `agents/{plan_doc}`: how the code works today, never what will change,
   each with where to look (two to four questions a helper; a hands-on trial names a place of its
   own). `qualitylayer brief plan` then lists `helpers`: start each on its `brief_file`, side by
   side, and save each report with `qualitylayer helper result <id> --file <path>`. Reports land in
   `{research_dir}` as written. Stop reading once each Done means point has a place in the code, an
   approach and a proof. Every finding the Plan rests on is one line under *Findings* with a
   `file:line` that resolves, linking its report (`{research_dir}/r1.md#2`). Probe the deployed
   state a decision depends on and save the probe under `{records_dir}/`.

## Ask only what you cannot decide

Ask (*Asking the person*) in the order that changes what gets built: the problem and Done means,
scope, behaviour (empty, loading and error states; shapes, errors and exit codes; a schema and its
migration), then a technical shape only where it changes a contract or what the user sees. A question
says first what changes for the user, then names the file or contract when that helps them decide.
Ask when a question arises, not all at the end; keep working on what no open answer blocks. What the
code answers or a reversible detail settles, you decide and list under *Decisions made for you* with
its reason. "Decide for me" leaves only what is hard to reverse. Each question's `about` is `{"doc":
"{plan_doc}", "section": "<heading>", "quote": "<the words it settles>"}`; link answers to their points
with `qualitylayer question link <id> --points 1,3`.

## Write the two files

Fill both templates in place and keep `{plan_doc}`'s front matter (overwriting it loses the task).
Each template's hints own section format; write **Summary**, **Done means** and **Approach**, and any
other section only when it has something to say. Keep the Plan concise—do not pad a small task. Write
each fact once.

- `{plan_doc}` is for people: plain words, no `file:line` in lead sections, each list item opening with
  a **bold headline sentence**. *Summary*: one plain sentence on what the user gets, the outcome in 2 to
  4 one-line bullets, then `**Size:**` and `**Trust boundary:**` (plus `**Risk:**` / `**Integrations:**`
  only when backed by the Plan). *Scope*: when the build needs another Git checkout, put
  `` - **Repository:** `/absolute/path` `` under `### In scope` using the checkout's exact local root.
  *Approach*: Chosen, Gives, Costs, then at most five bullets of what changes.
- `agents/{plan_doc}` is the build's working record (request, findings, contracts, code to imitate,
  start/test, project checks, rejected approaches, guarded risks, pitfalls). It grants nothing and never
  changes scope; where the two differ, the Plan wins.
- Keep QualityLayer's `ql:` markers as two empty lines. Fold settled feedback into one current proposal,
  then reread *Summary* and *Approach* so they still match.

**Done means decides.** Follow the template's `Runs as:` and `A1`/`A2` step table: every point needs a
step that can fail while every task passes, stated as observable action and result (never a test filter),
naming its *Interface* artifact when it shows a screen, and marking person-only/remote steps under the
step.

**Show what changes.** With `ui: true`, draw each changed surface as a product-fidelity artifact between
`<!-- ql:artifact <name> -->` markers after updating its lasting model (`qualitylayer artifact guide`,
once). Each finished artifact gets one fresh check: save its report with `qualitylayer helper result
<id> --file <path>` and answer every finding `Answer: Taken · <what changed>` or `Answer: Kept · <why>`.
For a new/changed router, agent or pipeline, diagram how a request moves, branches and calls tools.

**Clear the way for the build now.** Settle every human step (secret, account, permission, deploy) as
`met` or `granted` under *Prerequisites* (leaving `P1` intact), and spike unproven dependencies under
*Proven before the gate*. A choice that appeared only once the design was drawn becomes a **Your call**
(`late: true` under *Engineering decisions*, locking Approve until answered and folded in with
`question reply`).

## Draft, gate, approval

1. `qualitylayer plan draft`, and fix every error in one pass. Reread the Plan as a reviewer would: no
   contradiction, nothing buildable two ways. Walk the change through its life once (first use, daily
   use, left alone overnight, one side updated, removed, broken): the Plan says what the person sees
   and what keeps running; settle or ask what it does not.
2. `qualitylayer gate open plan` at once. Approve stays locked while a review runs.
3. When the reply lists `reviews`: `qualitylayer wait --for review`, say who reviews, read
   `{reviews_dir}/plan.md`, change the Plan for each finding you take and answer every one in one pass:
   `Answer: Taken · <what you changed>`, `Answer: Kept · <why>`, or `Answer: Ask · <the question>` for
   what is truly the person's. Put `"late": true` and `"settles": ["plan:finding:<n>"]` on each
   question in the batch. A panel's finding marked `Panel: all` you take, or ask the person and keep
   it only when they pick the keep choice (`"kind": "keep"`); a `Panel: split` one you decide, giving
   both views and your reason. Findings that say the same get the same answer. Then `gate open plan`
   again after you have folded in the answers. While a named finding waits for its answer, follow
   the gate's move to hear it.
4. Follow the gate reply. With approvals in the App it carries `presentation.planHandoff`: say that
   once and ask nothing; the person uses **Approve and build here**, or marks what should change in the
   App, which reaches you as an ordinary message with the marked place: answer it like any message. With
   approvals in your agent it carries `your_turn`: say it, show `qualitylayer read {plan_doc} --lead`,
   then send each `chat_review` entry in order (each open Your call, then the approval) with
   `qualitylayer question ask '<entry>'` and ask the `chat_questions` it returns. On **Give feedback**,
   ask what should change. On **Show the Plan**, print `qualitylayer read {plan_doc} --lead` in chat.
   Wait for approval after responding. A pick in a picker QualityLayer did not hand you records nothing. A comment
   reopens the gate when the Plan changed. Either way, while the gate is open your move is `qualitylayer
   wait --for approval` (again while it says pending; in the background where your harness has one):
   reading a Plan takes the person minutes, and it returns when they approve or comment, in the App or
   here. Ask for the approval once; a reply that is not one gets its answer and another wait.
5. On approval the build starts clean: print the reply's `message`, ask any `chat_questions` and end
   your turn; the person compacts or opens a new conversation and says "build here". Only when they
   chose to keep this conversation, run `qualitylayer build start` now. From here the Plan changes
   only through `qualitylayer plan amend --by agent|user --note "<what changed, and why>"`.

A person who asks for a plain prompt gets `qualitylayer task handback "<reason>" --prompt "<prompt>"`.
