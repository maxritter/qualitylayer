import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright/test";
import { verifyCheckoutCase, writeFailureDiagnostic } from "./check-checkout-runner.mjs";

const origin = new URL(process.argv[2] || "https://qualitylayer.dev");
assert(origin.protocol === "https:" || ["localhost", "127.0.0.1"].includes(origin.hostname), "Checkout verification requires HTTPS or loopback");
const output = process.argv[3] ? resolve(process.argv[3]) : null;
if (output) await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const results = [];
let page;
let currentCase;
// The newsletter code PILOTTHANKS15 ends on 20 November 2026; after that the checkout has no code to try.
const promoLive = Date.now() < Date.UTC(2026, 10, 20);

try {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/api/billing", route => route.abort());
  for (const billing of ["yearly", "monthly"]) {
    for (const [plan, label] of [["Solo", "Individual"], ["Team", "Business"]]) {
      currentCase = `${plan.toLowerCase()}-${billing}`;
      results.push(await verifyCheckoutCase(page, { origin, plan, label, billing, promoLive, output }));
    }
  }
} catch (error) {
  if (output && page) await writeFailureDiagnostic(page, { output, origin, currentCase, error });
  throw error;
} finally {
  await browser.close();
}
if (output) await writeFile(resolve(output, "checkout-readiness.json"), JSON.stringify({ origin: origin.origin, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
