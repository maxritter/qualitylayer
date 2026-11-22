// The headings the Implement page draws as the Workflow model does: an icon first, then
// the name. `IconPart` is a titled part of the core, `IconFold` a fold that leads with its icon (both
// reuse the bands' own classes and the kit's one disclosure), and `ReadRow` is the file row that ends
// each page: the whole file and Read, which opens the Reader on it.

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { headingSlug } from "../../../core/docs/anchor.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { FileRow } from "../../step-page/kit/FileRow.tsx"
import { readWholeFile } from "../../step-page/kit/read-file.ts"

/** A titled part of the core with its icon; the count follows the title. */
export function IconPart({
  id,
  title,
  icon: Icon,
  count,
  action,
  children,
}: {
  id: string
  title: string
  icon: LucideIcon
  count?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="bd-part" aria-label={title} data-testid="step-part">
      <h2 id={id} tabIndex={-1} data-passage-section={headingSlug(title)} className="ol-ph">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{title}</span>
        {count !== undefined && count !== null && count !== "" ? (
          <span className="bd-n">{count}</span>
        ) : null}
        {action !== undefined ? <span className="ib-part-action">{action}</span> : null}
      </h2>
      {children}
    </section>
  )
}

/** A fold led by its icon: the name, a count and one plain line of what is inside. */
export function IconFold({
  id,
  title,
  icon: Icon,
  count,
  takeaway,
  testId = "step-fold",
  children,
}: {
  id: string
  title: string
  icon: LucideIcon
  count?: ReactNode
  takeaway?: string | undefined
  testId?: string
  children: ReactNode
}) {
  return (
    <Disclosure
      className="bd-fold"
      data-testid={testId}
      data-fold={title}
      chevronClassName="bd-chev size-3.5"
      summaryProps={{ id, tabIndex: -1, "data-passage-section": headingSlug(title) }}
      head={
        <>
          <Icon className="size-3.5 ol-fold-icon" aria-hidden="true" />
          <b>{title}</b>
          {count !== undefined && count !== null && count !== "" ? (
            <span className="bd-n">{count}</span>
          ) : null}
          {takeaway !== undefined && takeaway !== "" ? (
            <span className="bd-fl">{takeaway}</span>
          ) : null}
        </>
      }
    >
      <div className="bd-fb">{children}</div>
    </Disclosure>
  )
}

/** The page's last row: its file and Read, which opens the Reader on the whole file. */
export function ReadRow({
  taskId,
  file,
  label,
  text,
}: {
  taskId: string
  file: string
  /** The button's words: `Read the record`. */
  label: string
  /** One quiet line about what the file holds. */
  text: string
}) {
  return (
    <FileRow file={file} text={text} label={label} onRead={() => readWholeFile(taskId, file)} />
  )
}
