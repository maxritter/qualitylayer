import { CodeXml, GitPullRequest, Network, ShieldCheck, type LucideIcon } from "lucide-react";

/** Each workflow step's icon, as the App's step track draws it; the pull request follows Verify. */
export const STEP_ICONS: Record<string, LucideIcon> = { plan: Network, implement: CodeXml, verify: ShieldCheck, "pull-request": GitPullRequest };
