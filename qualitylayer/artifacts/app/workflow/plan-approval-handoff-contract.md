# Plan gate handoff matches the current move

The Plan handoff invites reading or feedback. Its generic wording does not assert that Approve is currently available: existing review work, unanswered questions or a saved late answer can still keep it locked. The main reply and its next move explain that work. Pending-review wording retains its specific explanation.

This is a words-only correction. Presentation adds no lock read, readiness flag, gate guard, answer receipt, acknowledgement command, timer or workflow step. The existing gate remains authoritative: it refuses approval while work is pending and accepts the person's decision after the normal answer pickup and reply. App controls and their permissions stay unchanged.

Qualification distinguishes unresolved Ask, unanimous Kept without the person's choice, the person's Keep before the planner folds it in, and the ready state after that normal fold. A scripted review input is not evidence of a real model review.

Put `late: true` and `settles: ["plan:finding:<n>"]` on each late question in a batch. When an open question names a review finding, the gate reply and `next` name that finding and question and offer `qualitylayer wait --for answer`.

An App answer is saved before the planner reads it. The tool hook names the batch and the poll command. Poll returns the answer and its receipt, which the planner uses to record the reply. An approval wait in the background also returns when the planner has work to do, including reviewing findings, folding a late answer or responding to comments.

During Plan approval, the reviewer’s pending feedback arrives with the gate decision. If reopening the Plan is blocked by a previously delivered comment, the agent can find it with `qualitylayer comments list` and answer that ID with `qualitylayer comments resolve`. Listing a comment does not change its delivery or approve the Plan.

While the task is still at Plan, the person can ask for a revision after recording an approval. The recorded approval stays in history and applies to the revision the person read. If the Plan has moved, `next` and `status` offer the draft and gate commands. The next approval applies to the new revision. The build still checks the revision at its existing approval boundary.

A second opinion records the Plan it read. The planner folds its findings into the current Plan. Run another second opinion when the edits warrant one. The gate reply to the person explains that the reviewer read an earlier revision.

When the Plan needs prerequisites, the scaffold supplies the `## Prerequisites` heading and table together. The numbered finding title is part of the review shown in the Plan. A separate `Answer:` entry records what the planner did.

The native picker hook points the planner to `qualitylayer question poll` when it is still waiting for saved evidence. Poll collects saved picker results. Repeating the same ask can read a saved single answer. Show the picker only once. If the person's answer appears as a message in the chat, the agent can record those exact words with `qualitylayer question answered --id <question-id> "<answer>"`. `wait --for answer` returns saved answer events, including a request for more context, or the normal timeout or task lifecycle result. Approval decisions have their own wait. The question help lists the choice fields and the fact limits for batches.

The native approval picker identifies its tab as **Plan** and asks **Approve the Plan?**. Approve Plan says “Clears this revision for building.” Give feedback says “Say what should change first.” Show the Plan says “Print the Plan’s opening here.” The last two choices keep the gate open. The agent asks for changes or reads the Plan lead in chat, respectively. The host retains the native picker controls and its own escape choices. The gate ID still binds the saved choice.

The question’s wording travels in full to the App, native picker and numbered fallback. A saved answer retains that same wording, including costs or timing at the end. A payload refused for a size limit leaves no partial question.
