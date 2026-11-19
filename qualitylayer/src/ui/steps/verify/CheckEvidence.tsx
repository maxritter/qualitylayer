import type { VerifyActivity, VerifyCheck, VerifyRevision } from "../../../core/verify-activity.ts"
import { Disclosure } from "../../kit/Fold.tsx"

type CheckReceipt = NonNullable<VerifyActivity["projectChecks"]>

const OUTCOME: Record<VerifyCheck["outcome"], string> = {
  passed: "Passed",
  failed: "Failed",
  "not-run": "Not run",
  "timed-out": "Timed out",
  interrupted: "Interrupted",
}

function Revision({
  revision,
  branchFirst = false,
}: {
  revision: VerifyRevision
  branchFirst?: boolean
}) {
  const head = <code title={revision.head}>{revision.head.slice(0, 7)}</code>
  const branch = revision.branch ? <code>{revision.branch}</code> : null
  if (branchFirst && branch !== null)
    return (
      <>
        {branch} ({head})
      </>
    )
  return (
    <>
      {head}
      {branch && <> {branch}</>}
    </>
  )
}

function different(checked: VerifyRevision, checkout: VerifyRevision): boolean {
  return (
    (!checked.head.startsWith(checkout.head) && !checkout.head.startsWith(checked.head)) ||
    (checked.branch !== undefined &&
      checkout.branch !== undefined &&
      checked.branch !== checkout.branch)
  )
}

export function CheckEvidence({ receipt }: { receipt: CheckReceipt }) {
  const { commands, checked, checkout, candidate } = receipt
  return (
    <div className="vb-evidence" data-testid="verify-check-evidence">
      {checked && checkout && different(checked, checkout) ? (
        <p className="vb-revision">
          Checked <Revision revision={checked} branchFirst />. Current checkout{" "}
          <Revision revision={checkout} branchFirst />.
        </p>
      ) : null}
      <Disclosure head="Check results and checkout">
        <ul>
          {commands.map((row) => (
            <li key={row.command} data-outcome={row.outcome}>
              <code>{row.command}</code>
              <span>
                {OUTCOME[row.outcome]}
                {row.outcome === "failed" && row.exit !== null ? ` (exit ${row.exit})` : ""}
              </span>
            </li>
          ))}
        </ul>
        {checked || checkout || candidate ? (
          <dl>
            {checked ? (
              <>
                <dt>Checked revision</dt>
                <dd>
                  <Revision revision={checked} />
                </dd>
              </>
            ) : null}
            {checkout ? (
              <>
                <dt>Current checkout</dt>
                <dd>
                  <Revision revision={checkout} />
                </dd>
              </>
            ) : null}
            {candidate ? (
              <>
                <dt>Recorded candidate</dt>
                <dd>
                  <Revision revision={candidate} />
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </Disclosure>
    </div>
  )
}
