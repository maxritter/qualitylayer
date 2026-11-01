import type { ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";

/** A finished state in a `dd-card`: an icon, a heading and what happens next. */
export default function Done({ icon: Icon, title, heading, children, live = true }: { icon: LucideIcon; title: string; heading?: Ref<HTMLHeadingElement>; children: ReactNode; live?: boolean }) {
  return (
    <div className="dd-done" role={live ? "status" : undefined}>
      <Icon size={20} aria-hidden="true" />
      <h2 ref={heading} tabIndex={heading ? -1 : undefined}>{title}</h2>
      {children}
    </div>
  );
}
