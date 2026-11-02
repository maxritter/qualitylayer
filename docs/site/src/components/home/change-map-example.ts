/**
 * The home page's example change map: four files of the demo project's metering Plan, in two parts, so it reads at a
 * glance beside its text. The App draws it; Intro.test.tsx keeps it a valid map.
 */
const MAP = {
  title: "Meter each request once and bill it",
  parts: [
    { id: "gateway", name: "Gateway", kind: "server" },
    { id: "billing", name: "Billing", kind: "core" },
  ],
  cards: [
    {
      id: "handler",
      path: "services/gateway/src/middleware.ts",
      name: "Handler",
      part: "gateway",
      kind: "server",
      change: "changed",
      today: "Serves the request and counts nothing.",
      after: "Passes each billable request to the meter before it answers.",
    },
    {
      id: "meter",
      path: "services/gateway/src/meter.ts",
      name: "Meter",
      part: "gateway",
      kind: "server",
      change: "new",
      after: "Counts each billable request, keyed by x-request-id so a retry counts once.",
      risk: "Every request passes through it; it must stay under two milliseconds.",
    },
    {
      id: "ledger",
      path: "services/ledger/src/write-once.ts",
      name: "Ledger",
      part: "billing",
      kind: "state",
      change: "changed",
      today: "Writes seat invoices once.",
      after: "Writes each usage window once.",
    },
    {
      id: "price",
      path: "services/billing/src/pricing.ts",
      name: "price()",
      part: "billing",
      kind: "core",
      change: "changed",
      today: "Prices a seat plan.",
      after: "Prices usage by tier; seat plans price as before.",
    },
  ],
  links: [
    { from: "handler", to: "meter", label: "Meters", change: "new" },
    { from: "meter", to: "ledger", label: "Usage", change: "new" },
    { from: "ledger", to: "price", label: "Usage windows", change: "new" },
  ],
  trace: {
    today: [
      ["handler", "A request is served and nothing is counted."],
      ["price", "Only seat plans are priced."],
    ],
    after: [
      ["handler", "A billable request arrives at the gateway."],
      ["meter", "The meter counts it once for its request id."],
      ["ledger", "The usage window is written once."],
      ["price", "The usage is priced by tier."],
    ],
  },
};

export const EXAMPLE_MAP = JSON.stringify(MAP);
