// The Summary's bullet form for any list on a step page that is not numbered: a bullet may open with a
// bold lead, `**Lead.** the rest of the sentence` (Workflow model: Summary, What changes, Current
// system, Decided with you, Decisions made for you, Not doing, Known limits, Decided while outlining, Code,
// Scope). It wears the Summary's own classes, so every such list is the same size, spacing and mark. A
// bullet may end in a quiet control or tag (`trailing`, as a Change button) or hold a block under its
// words (`below`); the form stays one.

import { type ReactNode, useState } from "react"
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

const VERBOSE_BULLET_WORDS = 18

/** A bullet's Markdown: the lead bold and ending in a full stop, then its text. */
export function leadBulletText({ lead = "", text }: Pick<LeadBullet, "lead" | "text">): string {
  const head = trimEndCharacters(lead.trim(), ":.")
  if (head === "") return text
  return `**${head}${/[!?]$/.test(head) ? "" : "."}**${text === "" ? "" : ` ${text}`}`
}

function splitVerboseBullet(markdown: string): { head: string; rest: string } | null {
  const words = markdown.replace(/[*_`]/g, "").trim().split(/\s+/).filter(Boolean).length
  if (words <= VERBOSE_BULLET_WORDS) return null
  const trimmed = markdown.trim()
  if (!trimmed.startsWith("**")) return null
  const close = trimmed.indexOf("**", 2)
  if (close <= 2) return null
  const afterBold = trimmed[close + 2] === ":" ? close + 3 : close + 2
  const sep = trimmed[afterBold]
  if (sep === undefined || !/\s/.test(sep)) return null
  const head = trimmed.slice(0, afterBold).trim()
  const rest = trimmed.slice(afterBold + 1).trim()
  return rest === "" ? null : { head, rest }
}

function CollapsibleBulletText({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false)
  const parts = splitVerboseBullet(markdown)
  if (parts === null) return <InlineMarkdown text={markdown} />
  return (
    <>
      <InlineMarkdown text={parts.head} />{" "}
      <button
        type="button"
        className="q-link text-[12px]"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? "Hide" : "Details"}
      </button>
      {open ? (
        <span className="mt-1 block text-muted-foreground">
          <InlineMarkdown text={parts.rest} />
        </span>
      ) : null}
    </>
  )
}

export function LeadBullets({
  items,
  testId,
  collapsible = false,
}: {
  items: readonly LeadBullet[]
  testId?: string
  collapsible?: boolean
}) {
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
                {collapsible ? (
                  <CollapsibleBulletText markdown={leadBulletText(item)} />
                ) : (
                  <InlineMarkdown text={leadBulletText(item)} />
                )}
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
