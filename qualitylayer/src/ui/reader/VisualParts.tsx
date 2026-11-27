// The parts every rendered visual shares: an icon action with its tooltip, and a
// fullscreen dialog (focus trap, Escape, scroll lock and portal from shadcn's
// Dialog). The visual's frame and bar stay reader CSS: they sit inside agent
// documents and follow the reader's typography.

import { XIcon } from "lucide-react"
import { type CSSProperties, type ReactNode, type RefObject, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type ActionProps = {
  label: string
  /** The tooltip, when it says more than the label (a shortcut, for example). */
  hint?: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  children: ReactNode
}

export function VisualAction({ label, hint, onClick, pressed, disabled, children }: ActionProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              aria-pressed={pressed}
              disabled={disabled}
              onClick={onClick}
              className="text-muted-foreground hover:text-foreground aria-pressed:bg-surface-2 aria-pressed:text-foreground [&_svg]:size-3.5"
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>{hint ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type FullscreenProps = {
  open: boolean
  onClose: () => void
  /** Read by screen readers as the dialog's name. */
  title: string
  /** What the bar shows on the left: the kind and the path. */
  bar: ReactNode
  /** Extra actions before the close button. */
  actions?: ReactNode
  onKeyDown?: (event: React.KeyboardEvent) => void
  testId?: string
  returnFocus?: RefObject<HTMLElement | null>
  style?: CSSProperties
  /** Keep the dialog body bounded (`overflow-hidden`) when children manage their own scroll panes. */
  overflowHidden?: boolean
  children: ReactNode
}

const TALL_IFRAME_MIN = 1400
const EMBEDDED_DIALOG_HEIGHT = 760

export function embeddedDialogStyle(
  open: boolean,
  returnFocus: RefObject<HTMLElement | null> | undefined,
  base: CSSProperties | undefined,
  env?: { embedded: boolean; innerHeight: number },
): CSSProperties | undefined {
  if (!open) return base
  const frame =
    env ??
    (typeof window === "undefined"
      ? { embedded: false, innerHeight: 0 }
      : { embedded: window.self !== window.top, innerHeight: window.innerHeight })
  if (!frame.embedded || frame.innerHeight <= TALL_IFRAME_MIN) return base
  const triggerTop = returnFocus?.current?.getBoundingClientRect().top ?? 80
  const maxTop = Math.max(24, frame.innerHeight - EMBEDDED_DIALOG_HEIGHT - 40)
  const top = Math.max(24, Math.min(Math.round(triggerTop - 48), maxTop))
  return {
    ...base,
    top: `${top}px`,
    height: `min(${EMBEDDED_DIALOG_HEIGHT}px, 88vh)`,
    translate: "-50% 0",
  }
}

export function FullscreenDialog({
  open,
  onClose,
  title,
  bar,
  actions,
  onKeyDown,
  testId,
  returnFocus,
  style,
  overflowHidden = false,
  children,
}: FullscreenProps) {
  const popup = useRef<HTMLDivElement>(null)
  const resolvedStyle = embeddedDialogStyle(open, returnFocus, style)
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        ref={popup}
        showCloseButton={false}
        aria-describedby={undefined}
        // Focus the dialog itself, not its first button: a focused button opens its tooltip,
        // and the first Escape would close that tooltip instead of the dialog.
        initialFocus={popup}
        onKeyDown={onKeyDown}
        finalFocus={() => {
          const target = returnFocus?.current
          if (!target) return true
          target.focus({ preventScroll: true })
          return false
        }}
        style={resolvedStyle}
        data-testid={testId}
        className="flex h-[92vh] w-[min(1400px,96vw)] max-w-none flex-col gap-0 overflow-hidden border border-strong bg-surface p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="visual-bar flex-none">
          {bar}
          <span className="visual-spacer" />
          {actions}
          <VisualAction label="Close fullscreen" hint="Close (Esc)" onClick={onClose}>
            <XIcon />
          </VisualAction>
        </div>
        <div
          className={
            overflowHidden
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-auto"
          }
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
