# Preserve other sessions' committed work

A slice commit uses its recorded build-start commit to retain intervening commits made by other sessions. A stale working buffer must not replace their committed bytes, including when both sessions added the same new path or another session deleted that path.

Known changes are merged only when their before/after bytes can be compared through the repository's normal filters. An absent version, failed history query or unreadable blob is not evidence that no other change exists. When the comparison cannot preserve the other commit, the slice refuses before creating its commit or updating the live index. The affected working file stays as found so its author can inspect both versions and commit the intended hunks explicitly.

The existing HEAD compare-and-swap, native hooks, filter handling, staged-edit ownership and explicit ownership claims keep their authority. This adds no workflow step, approval, model instruction or automatic claim over another session's work. Legacy calls without a recorded baseline retain their existing scope; the guard claims no historical knowledge they lack.

An ownership refusal names the affected file and says nothing was committed. Unrecorded edits retain the `git diff` and explicit `--accept-edits` move when all changes belong to this task. Mixed or named-owner edits retain the private-index-on-HEAD move and slice/fix commit registration. Shorter wording changes none of these ownership decisions.

Qualification uses isolated repositories and real Git. It preserves a failing witness from the unchanged source, then checks add/add refusal, foreign deletion, unavailable history or filtered bytes, ordinary new-file success and the existing non-overlapping merge behavior. No production repository, native profile or personal index is used as a fixture.
