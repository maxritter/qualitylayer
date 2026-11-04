// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import CheckoutSuccess from "./CheckoutSuccess";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps an unavailable payment check distinct from a pending payment", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Fixture connection unavailable")));
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/checkout/success?checkout_id=fixture-checkout"]}>
        <CheckoutSuccess />
      </MemoryRouter>
    </HelmetProvider>,
  );
  await screen.findByRole("heading", { name: "Check your subscription" });
  expect(screen.getByText("We couldn't check the payment. Check again or open your billing account.")).toBeTruthy();
  expect(screen.queryByText(/Polar is still confirming/)).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "Check payment status" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole("link", { name: "Open your billing account" }).getAttribute("href")).toBe("/billing");
});
