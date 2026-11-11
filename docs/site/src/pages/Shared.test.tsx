// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Shared from "./Shared";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a retired share link", () => {
  it("says the link is retired, links home and never asks the share service", () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[`/s/${"A".repeat(22)}#${"k".repeat(43)}`]}>
          <Routes><Route path="/s/:id" element={<Shared />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(screen.getByRole("heading", { name: "This shared link has been retired" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to qualitylayer.dev" }).getAttribute("href")).toBe("/");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
