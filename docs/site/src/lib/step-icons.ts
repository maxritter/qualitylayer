import { Code, FileCheck, ListChecks, MessageSquare, Network, Search, ShieldCheck, type LucideIcon } from "lucide-react";

/** Each workflow step's icon, as the App's step rail draws it. */
export const STEP_ICONS: Record<string, LucideIcon> = { discuss: MessageSquare, research: Search, plan: Network, outline: ListChecks, implement: Code, verify: ShieldCheck, review: FileCheck };
