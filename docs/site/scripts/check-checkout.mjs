import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "playwright/test";

const origin = new URL(process.argv[2] || "https://qualitylayer.dev");
assert(origin.protocol === "https:" || ["localhost", "127.0.0.1"].includes(origin.hostname), "Checkout verification requires HTTPS or loopback");
const output = process.argv[3] ? resolve(process.argv[3]) : null;
if (output) await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const results = [];
let page;
let currentCase;
try {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/api/billing", route => route.abort());
  for (const billing of ["yearly", "monthly"]) {
    for (const plan of ["Solo", "Team"]) {
      currentCase = `${plan.toLowerCase()}-${billing}`;
      await page.goto(new URL("/pricing", origin).href);
      await page.getByRole("button", { name: billing === "monthly" ? "Monthly" : /Yearly/, exact: billing === "monthly" }).click();
      const link = page.getByRole("link", { name: `Start ${plan}`, exact: true });
      assert.equal(new URL(await link.getAttribute("href")).origin, "https://buy.polar.sh");
      // A native link still works if the website's checkout API or iframe is blocked.
      await link.click();
      await page.waitForURL(url => url.origin === "https://polar.sh" && url.pathname.startsWith("/checkout/"));
      const name = `QualityLayer ${plan}${billing === "yearly" ? " (yearly)" : ""}`;
      await page.getByText(name, { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Email", exact: true }).waitFor();
      const payment = page.frameLocator('iframe[title="Secure payment input frame"]');
      for (const field of ["Card number", "Expiration date", "Security code"]) await payment.getByRole("textbox", { name: field, exact: true }).waitFor();
      const amount = plan === "Solo" ? (billing === "yearly" ? 288 : 29) : (billing === "yearly" ? 468 : 49);
      assert((await page.locator("body").innerText()).includes(`€${amount}`), `${name}: expected price missing`);
      await page.getByRole("button", { name: "Add discount code", exact: true }).click();
      const discount = page.locator('input[name="discount_code"]');
      await discount.fill("PILOTTHANKS15");
      await expect(discount).toHaveValue("PILOTTHANKS15");
      await page.getByRole("button", { name: "Apply", exact: true }).filter({ visible: true }).first().click();
      const discountedAmount = (amount * 0.85).toFixed(2);
      // Polar renders both responsive summaries; require the visible total.
      await page.getByText(`€${discountedAmount}`, { exact: true }).filter({ visible: true }).first().waitFor();
      await page.getByText(/discount \(first year\)/i).filter({ visible: true }).first().waitFor();
      assert((await page.locator("body").innerText()).includes("-15%"), `${name}: newsletter discount missing`);
      for (const field of ["Card number", "Expiration date", "Security code"]) await payment.getByRole("textbox", { name: field, exact: true }).waitFor();
      if (output) await page.screenshot({ path: resolve(output, `${plan.toLowerCase()}-${billing}.png`) });
      results.push({ plan, billing, amount, discountedAmount: Number(discountedAmount), promo: "PILOTTHANKS15", currency: "EUR", paymentFieldsReady: true, paymentSubmitted: false });
      console.log(`PASS ${plan} ${billing}: €${amount}, newsletter total €${discountedAmount}; Stripe payment fields ready; no payment submitted`);
    }
  }
} catch (error) {
  if (output && page) {
    const diagnostic = {
      origin: origin.origin,
      case: currentCase,
      checkedAt: new Date().toISOString(),
      paymentSubmitted: false,
      failure: error instanceof Error ? error.message : String(error),
      page: await page.evaluate(() => ({
        title: document.title,
        path: location.pathname.startsWith("/checkout/") ? "/checkout/[redacted]" : location.pathname,
        text: document.body.innerText.slice(0, 20000),
        discountValue: document.querySelector('input[name="discount_code"]')?.value ?? null,
        applyButtons: [...document.querySelectorAll("button")].filter(button => button.textContent?.trim() === "Apply").map(button => ({ disabled: button.disabled, visible: button.getClientRects().length > 0 })),
      })).catch(() => null),
    };
    await writeFile(resolve(output, `${currentCase || "checkout"}-failure.json`), JSON.stringify(diagnostic, null, 2), { mode: 0o600 }).catch(() => {});
    await page.screenshot({ path: resolve(output, `${currentCase || "checkout"}-failure.png`) }).catch(() => {});
  }
  throw error;
} finally { await browser.close(); }
if (output) await writeFile(resolve(output, "checkout-readiness.json"), JSON.stringify({ origin: origin.origin, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
