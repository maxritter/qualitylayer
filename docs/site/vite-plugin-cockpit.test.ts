import path from "node:path";
import { expect, it } from "vitest";
import { createServer } from "vite";
import cockpitDemo, { COCKPIT_DEDUPE } from "./vite-plugin-cockpit";

it("intercepts only the shared App dialog import without recursively replacing the production primitive", async () => {
  const root = import.meta.dirname;
  const server = await createServer({
    configFile: false,
    root,
    plugins: [cockpitDemo()],
    resolve: { dedupe: [...COCKPIT_DEDUPE] },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
  });
  try {
    const shared = path.resolve(root, "../../qualitylayer/src/ui/components/ui/dialog.tsx");
    const adapted = await server.pluginContainer.resolveId("@base-ui/react/dialog", shared);
    expect(adapted).toBeTruthy();
    const queried = await server.pluginContainer.resolveId("@base-ui/react/dialog", shared + "?v=fixture");
    expect(queried?.id).toBe(adapted?.id);
    const production = await server.pluginContainer.resolveId("@base-ui/react/dialog", adapted?.id);
    const site = await server.pluginContainer.resolveId("@base-ui/react/dialog", path.join(root, "src/fixture.tsx"));
    expect(production?.id).toBe(site?.id);
    expect(production?.id).not.toBe(adapted?.id);
    const select = await server.pluginContainer.resolveId("@base-ui/react/select", shared);
    expect(select?.id).not.toBe(adapted?.id);
  } finally {
    await server.close();
  }
});
