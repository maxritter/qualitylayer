# Plan gate handoff matches the current move

The Plan handoff invites reading or feedback. Its generic wording does not assert that Approve is currently available: existing review work, unanswered questions or a saved late answer can still keep it locked. The main reply and its next move explain that work. Pending-review wording retains its specific explanation.

This is a words-only correction. Presentation adds no lock read, readiness flag, gate guard, answer receipt, acknowledgement command, timer or workflow step. The existing gate remains authoritative: it refuses approval while work is pending and accepts the person's decision after the normal answer pickup and reply. App controls and their permissions stay unchanged.

Qualification distinguishes unresolved Ask, unanimous Kept without the person's choice, the person's Keep before the planner folds it in, and the ready state after that normal fold. A scripted review input is not evidence of a real model review.

Put `late: true` and `settles: ["plan:finding:<n>"]` on each late question in a batch. When an open question names a review finding, the gate reply and `next` name that finding and question and offer `qualitylayer wait --for answer`.

An App answer is saved before the planner reads it. The tool hook names the batch and the poll command. Poll returns the answer and its receipt, which the planner uses to record the reply. An approval wait in the background also returns when the planner has work to do, including reviewing findings, folding a late answer or responding to comments.
