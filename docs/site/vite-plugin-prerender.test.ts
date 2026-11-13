import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ResolvedConfig } from "vite";
import { describe, expect, it } from "vitest";
import prerenderPlugin from "./vite-plugin-prerender";

describe("prerender checkout environment", () => {
  it.each(["production", "development"])("keeps all four real pricing links in the %s environment", async (mode) => {
    const server = await createServer({
      configFile: false, root: path.dirname(fileURLToPath(import.meta.url)), mode,
      server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }, appType: "custom",
    });
    try {
      const { PLANS } = await server.ssrLoadModule("/src/lib/pricing.ts");
      const links: string[] = PLANS.filter((plan: { id: string }) => plan.id !== "enterprise")
        .flatMap((plan: { href: { monthly: string; yearly: string } }) => [plan.href.monthly, plan.href.yearly]);
      expect(new Set(links).size).toBe(4);
      expect(new Set(links.map((link) => new URL(link).origin))).toEqual(new Set([
        mode === "production" ? "https://buy.polar.sh" : "https://sandbox-api.polar.sh",
      ]));
      for (const link of links) {
        expect(link).not.toContain("polar_cl_Ef0VFi6KwgXjjdfiMBYzmfrccLzqAbx7nvU282oiCIj");
        expect(link).not.toContain("polar_cl_HNW3RN3pBIBCty20kiDsLCzKkioXqFV9JbBso4R47Dx");
      }
    } finally {
      await server.close();
    }
  });

  it.each(["production", "development"])("uses the %s checkout in the generated HTML", async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), "ql-prerender-mode-"));
    try {
      await mkdir(path.join(root, "src"));
      await mkdir(path.join(root, "dist/.vite"), { recursive: true });
      await writeFile(path.join(root, ".env.production"), "VITE_CHECKOUT_URL=https://buy.polar.sh/production\n");
      await writeFile(path.join(root, ".env.development"), "VITE_CHECKOUT_URL=https://sandbox-api.polar.sh/development\n");
      await writeFile(path.join(root, "src/prerender.tsx"), 'export const render = () => ({ head: "", body: `<a href="${import.meta.env.VITE_CHECKOUT_URL}">Start Business</a>` });');
      await writeFile(path.join(root, "dist/index.html"), '<html><head></head><body><div id="root"></div></body></html>');
      await writeFile(path.join(root, "dist/.vite/manifest.json"), "{}");
      const plugin = prerenderPlugin();
      const resolved = plugin.configResolved as (config: ResolvedConfig) => void;
      const close = plugin.closeBundle as () => Promise<void>;
      resolved({ root, mode, build: { outDir: "dist" } } as ResolvedConfig);
      await close();
      const html = await readFile(path.join(root, "dist/pricing.html"), "utf8");
      expect(html).toContain(mode === "production" ? 'href="https://buy.polar.sh/production"' : 'href="https://sandbox-api.polar.sh/development"');
      expect(html).toContain("Start Business");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
