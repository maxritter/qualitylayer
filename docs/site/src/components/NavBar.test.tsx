// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import NavBar from "./NavBar";

const viewport = vi.hoisted(() => ({ narrow: false }));
vi.mock("@/hooks/useNarrow", () => ({ useNarrow: () => viewport.narrow }));

afterEach(cleanup);

function CurrentPage() {
  const { pathname } = useLocation();
  return <output aria-label="Current page">{pathname}</output>;
}

describe("the main navigation", () => {
  it.each([false, true])("opens Pricing between Teams and Docs and closes the phone menu (narrow: %s)", async (narrow) => {
    viewport.narrow = narrow;
    render(<MemoryRouter><NavBar /><CurrentPage /></MemoryRouter>);
    if (narrow) fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const nav = await screen.findByRole("navigation", { name: narrow ? "Mobile" : "Main" });
    const links = within(nav).getAllByRole("link");
    const pricing = within(nav).getByRole("link", { name: "Pricing" });
    const teams = within(nav).getByRole("link", { name: "Teams" });
    const docs = within(nav).getByRole("link", { name: "Docs" });
    expect(pricing.getAttribute("href")).toBe("/pricing");
    expect(links.indexOf(pricing)).toBe(links.indexOf(teams) + 1);
    expect(links.indexOf(docs)).toBe(links.indexOf(pricing) + 1);
    fireEvent.click(pricing);
    await waitFor(() => expect(screen.getByLabelText("Current page").textContent).toBe("/pricing"));
    if (narrow) await waitFor(() => expect(screen.queryByRole("navigation", { name: "Mobile" })).toBeNull());
    else expect(pricing.getAttribute("aria-current")).toBe("page");
  });

  it.each([false, true])("links to the Docusaurus blog beside Docs (narrow: %s)", async (narrow) => {
    viewport.narrow = narrow;
    render(<MemoryRouter><NavBar /></MemoryRouter>);
    if (narrow) fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const nav = await screen.findByRole("navigation", { name: narrow ? "Mobile" : "Main" });
    const links = within(nav).getAllByRole("link");
    const docs = within(nav).getByRole("link", { name: "Docs" });
    const blog = within(nav).getByRole("link", { name: "Blog" });
    expect(docs.getAttribute("href")).toBe("/docs/");
    expect(blog.getAttribute("href")).toBe("/blog");
    expect(links.indexOf(blog)).toBe(links.indexOf(docs) + 1);
  });
});
