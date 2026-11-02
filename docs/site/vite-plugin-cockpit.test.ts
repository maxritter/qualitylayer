import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { expect, it } from "vitest";
import { createServer } from "vite";
import cockpitDemo, { COCKPIT_DEDUPE } from "./vite-plugin-cockpit";

it("prerenders the actual shared App change map through its own component imports", async () => {
  const root = import.meta.dirname;
  const server = await createServer({
    configFile: false,
    root,
    plugins: [cockpitDemo()],
    resolve: { alias: { "@ql": path.resolve(root, "../../qualitylayer/src") }, dedupe: [...COCKPIT_DEDUPE] },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
  });
  try {
    const { default: ChangeMapDemo } = await server.ssrLoadModule("/src/components/home/ChangeMapDemo.tsx");
    const html = renderToStaticMarkup(createElement(ChangeMapDemo));
    expect(html).toContain("Ledger");
    expect(html).toContain('data-testid="change-map"');
  } finally {
    await server.close();
  }
}, 30000);
