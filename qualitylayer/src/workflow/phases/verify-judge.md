# Run the fresh reviewer and collect its verdicts

Start the reviewer(s) on their exact `brief_file`, `model` and `effort` (following any no-file-change rule). Start any `reviews` (Second opinion) and split `helpers` (one per share + diff) in parallel; judge on none alone. If `then` names a missing share, restart only those reviewers.

- **While it works, leave the checkout and project checks alone.** Queue fixes and inspect evidence while waiting; apply fixes only after collecting verdicts. Report any change to the assigned code and recheck it.
- **When finished**, record returned no-write reviews/verdicts verbatim, then run `then` to validate them and follow its next move. Verdicts and evidence files stay as the reviewer supplied them (editing a proof file expires its verdict; changed code/Plan needs a new assignment). QualityLayer commits added tests with its pass.
- **If the reviewer stopped early**, follow up with that same agent; never start a duplicate reviewer for an idle worker. Never invent its verdict or turn a FAIL or MISSING into a PASS.
- **An `environment:` blocker** is cleared once after the round (fix it yourself, or open `qualitylayer need "<what to set up, and why you cannot>" --for T<n>`). Never send another reviewer into an unchanged blocker.

With no helpers available, run the brief yourself, label the judge as the build session, and tell the person it was not independent.
