// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type KeyboardEvent } from "react";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import cockpitDemo, { COCKPIT_DEDUPE } from "../../vite-plugin-cockpit";

let server: ViteDevServer;
let Dialog: typeof import("@base-ui/react/dialog").Dialog;
const root = path.resolve(import.meta.dirname, "../..");
const sharedDialog = path.resolve(root, "../../qualitylayer/src/ui/components/ui/dialog.tsx");

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root,
    plugins: [cockpitDemo()],
    resolve: { dedupe: [...COCKPIT_DEDUPE] },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
  });
  const resolved = await server.pluginContainer.resolveId("@base-ui/react/dialog", sharedDialog);
  if (!resolved) throw new Error("The App dialog import did not resolve");
  ({ Dialog } = await server.ssrLoadModule(resolved.id));
});
afterAll(async () => { await server?.close(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

function fixture() {
  const ref = createRef<HTMLDivElement>();
  const changed = vi.fn();
  const continued = vi.fn();
  const keyed = vi.fn((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") event.preventDefault();
  });
  render(<>
    <aside aria-label="Guided demo"><button onClick={continued}>Next in guide</button></aside>
    <Dialog.Root defaultOpen onOpenChange={changed}>
      <Dialog.Portal>
        <Dialog.Popup ref={ref} onKeyDown={keyed}>
          <Dialog.Title>Example dialog</Dialog.Title>
          <Dialog.Description>Only illustrative task data.</Dialog.Description>
          <button>First field</button>
          <Dialog.Close>Close</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </>);
  return { ref, changed, continued, keyed };
}

describe("the website guide owns interaction beside its example dialogs", () => {
  it.each(["/app-demo?guide", "/app-demo/?guide"])("%s keeps coach interaction, Popup ref and non-Tab keys", async (route) => {
    window.history.replaceState(null, "", route);
    const { ref, changed, continued, keyed } = fixture();
    const popup = await screen.findByRole("dialog", { name: "Example dialog" });
    expect(ref.current).toBe(popup);
    const coach = screen.getByRole("button", { name: "Next in guide" });
    coach.focus();
    await waitFor(() => expect(document.activeElement).toBe(coach));
    fireEvent.pointerDown(coach, { button: 0, pointerType: "mouse", isPrimary: true });
    fireEvent.click(coach);
    expect(continued).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls.filter(([open]) => open === false)).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Example dialog" })).toBe(popup);
    fireEvent.keyDown(popup, { key: "Tab" });
    expect(keyed).not.toHaveBeenCalled();
    fireEvent.keyDown(popup, { key: "F2" });
    expect(keyed.mock.calls.map(([event]) => event.key)).toEqual(["F2"]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(changed.mock.calls.some(([open]) => open === false)).toBe(true));
  });

  it.each(["/app-demo/?moment=plan-approve", "/app-demo-child/?guide", "/app-demo/child?guide", "/?guide"])(
    "%s retains the production modal and the caller's Tab guard",
    async (route) => {
      window.history.replaceState(null, "", route);
      const { ref, keyed } = fixture();
      const popup = await screen.findByRole("dialog", { name: "Example dialog" });
      expect(ref.current).toBe(popup);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Next in guide" })).toBeNull());
      expect(fireEvent.keyDown(popup, { key: "Tab" })).toBe(false);
      fireEvent.keyDown(popup, { key: "F2" });
      expect(keyed.mock.calls.map(([event]) => event.key)).toEqual(["Tab", "F2"]);
    },
  );
});
