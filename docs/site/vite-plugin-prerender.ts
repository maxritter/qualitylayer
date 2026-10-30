import { createServer, type Plugin } from "vite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_PAGES } from "./src/lib/seo.ts";
import { COMPARISON_PATHS } from "./src/lib/comparisons.ts";
import { LEGAL_PATHS } from "./src/lib/legal.ts";
import { DEEP_DIVE_PATH } from "./src/lib/deep-dive.ts";

/** Replace the fallback head and body with the same components the browser uses. */
export function renderedHtml(template: string, head: string, body: string) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<meta\s+(?:name="(?:title|description|keywords|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/g, "")
    .replace(/<link\s+rel="canonical"[^>]*>/g, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, "")
    .replace("</head>", () => `${head}\n</head>`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}

export default function prerenderPlugin(): Plugin {
  let root: string;
  let outDir: string;
  return {
    name: "prerender-marketing-pages",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build.outDir);
    },
    async closeBundle() {
      const template = await readFile(path.join(outDir, "index.html"), "utf8");
      const manifest = JSON.parse(await readFile(path.join(outDir, ".vite/manifest.json"), "utf8")) as Record<string, { css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean }>;
      const entries: Record<string, string> = {
        "/": "src/components/home/Sections.tsx",
        "/pricing": "src/pages/Pricing.tsx",
        "/download": "src/pages/Download.tsx",
        "/404": "src/pages/NotFound.tsx",
        [DEEP_DIVE_PATH]: "src/pages/DeepDive.tsx",
        ...Object.fromEntries(COMPARISON_PATHS.map((route) => [route, "src/pages/Compare.tsx"])),
        ...Object.fromEntries(LEGAL_PATHS.map((route) => [route, "src/pages/Legal.tsx"])),
      };
      function styles(entry: string | undefined, seen = new Set<string>()): string[] {
        if (!entry || seen.has(entry)) return [];
        seen.add(entry);
        const chunk = manifest[entry];
        return [...(chunk?.css ?? []), ...[...(chunk?.imports ?? []), ...(chunk?.isEntry ? [] : chunk?.dynamicImports ?? [])].flatMap((dependency) => styles(dependency, seen))];
      }
      const server = await createServer({
        configFile: false,
        root,
        resolve: { alias: { "@": path.join(root, "src"), "@ql": path.resolve(root, "../../qualitylayer/src") }, dedupe: ["react", "react-dom"] },
        server: { middlewareMode: true, watch: null },
        optimizeDeps: { noDiscovery: true },
        appType: "custom",
      });
      try {
        const { render } = await server.ssrLoadModule("/src/prerender.tsx");
        for (const route of [...Object.keys(PUBLIC_PAGES), "/404", "/billing", "/checkout/success", "/shared", "/open"]) {
          const { head, body } = await render(route);
          const css = [...new Set(styles(entries[route]))].filter((file) => !template.includes(`href="/${file}"`))
            .map((file) => `<link rel="stylesheet" href="/${file}">`).join("\n");
          const file = path.join(outDir, route === "/" ? "index.html" : `${route.slice(1)}.html`);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, renderedHtml(template, `${head}\n${css}`, body));
        }
      } finally {
        await server.close();
      }
    },
  };
}
