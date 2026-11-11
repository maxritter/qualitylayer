/**
 * The pages a seller in Germany links from every page: the imprint (§ 5 DDG), the privacy policy
 * (Art. 13 GDPR) and the terms. Max approved their wording and these facts on 19 October 2026.
 */
export const LEGAL_PATHS = ["/imprint", "/privacy", "/terms"] as const;

/** When the privacy policy and the terms last changed; both pages show it. */
export const LEGAL_UPDATED = { iso: "2026-11-10", label: "10 November 2026" } as const;

export const SELLER = {
  name: "Maximilian Ritter",
  street: "An der kalten Quelle 11",
  city: "86825 Bad Wörishofen",
  country: "Germany",
  vatId: "DE349034459",
} as const;

/** How long team data and backups are kept once a subscription ends. */
export const RETENTION_DAYS = 30;
