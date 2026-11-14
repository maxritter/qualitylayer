// What the Plan draws as the Workflow model does: a core part's heading with its icon first
// (`IconPart`, the bands' Part with an icon).

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { headingSlug } from "../../../core/docs/anchor.ts"

/** A titled part of the core with its icon; the count and an aside (a control) follow the title. */
export function IconPart({
  id,
  title,
  icon: Icon,
  count,
  aside,
  children,
}: {
  id: string
  title: string
  icon: LucideIcon
  count?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="bd-part" aria-label={title} data-testid="step-part">
      <h2 id={id} tabIndex={-1} data-passage-section={headingSlug(title)} data-iconed="">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
        {count !== undefined && count !== null && count !== "" ? (
          <span className="bd-n">{count}</span>
        ) : null}
        {aside !== undefined ? <span className="dsc-aside">{aside}</span> : null}
      </h2>
      {children}
    </section>
  )
}
