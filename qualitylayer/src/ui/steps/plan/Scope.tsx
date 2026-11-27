// Scope as two short columns, In scope and Out of scope, each led by its mark; one column when narrow.
// Part of what the person approves with the Plan, drawn from the document's own words.

import { CircleCheckIcon, CircleMinusIcon, type LucideIcon, SquareDashedIcon } from "lucide-react"
import { CommentBlock } from "../../step-page/DocMarkdown.tsx"
import { LeadBullets } from "../../step-page/kit/LeadBullets.tsx"
import type { StepLive } from "../../step-page/live.ts"
import { sectionId } from "../../step-page/sections.ts"
import { IconPart } from "./heads.tsx"
import type { Scope } from "./scope-model.ts"

export function ScopeColumns({
  title,
  scope,
  raw,
  live,
}: {
  title: string
  scope: Scope
  raw: string
  live: StepLive | undefined
}) {
  const column = (heading: string, Icon: LucideIcon, items: readonly string[]) => (
    <div className="dsc-col">
      <span className="dsc-sch">
        <Icon className="size-3.5" aria-hidden="true" />
        {heading}
      </span>
      {items.length > 0 ? (
        <LeadBullets collapsible items={items.map((item) => ({ key: item, text: item }))} />
      ) : (
        <p className="bd-quiet">Nothing.</p>
      )}
    </div>
  )
  return (
    <IconPart id={`${sectionId(title)}-h`} title={title} icon={SquareDashedIcon}>
      <CommentBlock raw={raw} live={live}>
        <div className="dsc-scope" data-testid="scope">
          {column("In scope", CircleCheckIcon, scope.inScope)}
          {column("Out of scope", CircleMinusIcon, scope.outOfScope)}
        </div>
      </CommentBlock>
    </IconPart>
  )
}
