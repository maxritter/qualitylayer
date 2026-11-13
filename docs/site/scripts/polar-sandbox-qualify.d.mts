type Plan = "solo" | "team";
type SandboxApi = {
  call(method: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  list(path: string): Promise<Record<string, unknown>[]>;
};
export const TAG: string;
export const TAG_VERSION: string;
export const CATALOG: {
  benefits: Record<Plan, string>;
  products: { plan: Plan; interval: "month" | "year"; name: string; amount: number }[];
  machinesPerKey: number;
};
export const WEBHOOK: { url: string; events: string[] };
export function ensureCatalog(api: SandboxApi): Promise<{
  benefits: Record<Plan, string>;
  products: Record<Plan, { monthly: string; yearly: string }>;
  webhook: { id: string; secret: string };
  created: string[];
}>;
