# Run the fresh reviewer and collect its verdicts

Start the reviewer the reply supplies on its brief, `model` and `effort`, following the judge brief's
no-file-change rule when it applies. A `reviews` entry is
the Second opinion, running beside it in the background. A build too large for one reviewer comes as
`helpers`, one per share plus one for the diff: start each at once on exactly its own brief, wait
for all and judge on none alone; together they are one run. When `then` names a share with no part,
start only those reviewers again.

- **While it works, leave the checkout alone**: no edits and no `qualitylayer check all`. Each brief
  pins the judged commit, so a moved HEAD means the changed code is judged again.
- **When it has finished**, record a review returned under that rule and its verdicts verbatim.
  **Read the verdicts and run `then`**, which validates them and their freshness. Verdicts and evidence
  files stay as the reviewer supplied them: an edited proof file expires its verdict, and changed code or a changed Plan
  needs a new assignment. QualityLayer commits any added tests with its pass.
- **If the reviewer stopped early**, follow up with the same agent; an idle worker is no reason to
  start a new reviewer. Never invent its verdict or turn a FAIL or MISSING into a PASS.
- **An `environment:` blocker** is cleared after the round: by you (a deployment, a service), or by
  the person through `qualitylayer need "<what to set up, and why you cannot>" --for T<n>`, asked
  before another reviewer starts; never send one to find the same blocker again. Then a fresh
  reviewer judges that scenario.

With no helpers available, follow the same brief yourself, label the judge as the build session and
tell the person it was not independent.
