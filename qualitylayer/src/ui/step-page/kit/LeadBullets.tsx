// The Summary's bullet form for any list on a step page that is not numbered: a bullet may open with a
// bold lead, `**Lead.** the rest of the sentence` (Workflow model: Summary, What changes, Current
// system, Decided with you, Decisions made for you, Not doing, Known limits, Decided while outlining, Code,
// Scope). It wears the Summary's own classes, so every such list is the same size, spacing and mark. A
// bullet may end in a quiet control or tag (`trailing`, as a Change button) or hold a block under its
// words (`below`); the form stays one.

import type { ReactNode } from "react"
import { trimEndCharacters } from "../../../core/text-boundaries.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"

export type LeadBullet = {
  /** The bold opening, or "" for a plain bullet. */
  lead?: string
  text: string
  /** A stable key for a list that can reorder; the position otherwise. */
  key?: string
  testId?: string
  /** After the words, on the bullet's last line: a Change button or a quiet tag. */
  trailing?: ReactNode
  /** Under the words, inside the bullet: a block such as an answer written in lines. */
  below?: ReactNode
  /** The bullet's place taken by an editor (the Plan's Change). */
  editing?: ReactNode
}

/** A bullet's Markdown: the lead bold and ending in a full stop, then its text. */
export function leadBulletText({ lead = "", text }: Pick<LeadBullet, "lead" | "text">): string {
  const head = trimEndCharacters(lead.trim(), ":.")
  if (head === "") return text
  return `**${head}${/[!?]$/.test(head) ? "" : "."}**${text === "" ? "" : ` ${text}`}`
}

export function LeadBullets({ items, testId }: { items: readonly LeadBullet[]; testId?: string }) {
  return (
    <div className="bd-sumb" data-testid={testId}>
      <ul className="bd-bul">
        {items.map((item, index) => (
          <li
            key={item.key ?? index}
            className={item.editing !== undefined ? "editing" : undefined}
            data-testid={item.testId}
          >
            {item.editing !== undefined ? (
              item.editing
            ) : (
              <>
                <InlineMarkdown text={leadBulletText(item)} />
                {item.trailing !== undefined ? <> {item.trailing}</> : null}
                {item.below}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
