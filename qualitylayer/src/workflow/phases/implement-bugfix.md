## A bug's build

One slice for a simple fix, more when the root-cause repair needs independently testable parts. Leave
out *Program design* and *Modules*. The cards carry **Role** labels:

- **T1 Reproduce the defect** (`**Role:** reproduce`): a test through a public entry point, in the
  test file that already covers it, failing for the reason the root cause names. It is done on an
  observed expected failure: tick it **before the fix**, without making it green; commit it then under the checked-slice timing;
  the page shows it red as expected. A reproduction that passes first time does not encode the bug, or
  the bug is gone: trace again and record it under *Investigation* in `agents/{plan_doc}`.
- **T2 Fix at the root cause** (`**Role:** fix`): touches the root-cause file the Plan names; T1's
  test passes. Its Files list every test that asserts today's behaviour of the rule the fix changes.
  Every changed line traces to the defect: no catch-all, default at the caller or swallowed error
  unless the Plan lists it as defence in depth. A failed approach is evidence: revert it, note it under
  *Tried and dropped* and try the next hypothesis.

*Proof order* puts each Done means step after the fixing slice. Run the named anti-regression checks
with the fix; Verify runs the final project checks.
