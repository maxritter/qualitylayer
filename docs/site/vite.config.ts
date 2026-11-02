import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import sitemapPlugin from "./vite-plugin-sitemap.ts";
import indexNowPlugin from "./vite-plugin-indexnow.ts";
import prerenderPlugin from "./vite-plugin-prerender.ts";
import cockpitDemo, { COCKPIT_DEDUPE } from "./vite-plugin-cockpit.ts";

const DOCUSAURUS_DEV_URL = "http://localhost:3000";
function docusaurusRedirect(): Plugin {
  return {
    name: "docusaurus-redirect",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/docs") || req.url?.startsWith("/blog")) {
          res.writeHead(302, { Location: `${DOCUSAURUS_DEV_URL}${req.url}` });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: { allow: [import.meta.dirname, path.resolve(import.meta.dirname, "../../qualitylayer/src"), path.resolve(import.meta.dirname, "../../qualitylayer/node_modules")] },
    // The release list is an edge function in production; in development it comes from the live site, so the cards download directly.
    proxy: {
      "/app/downloads.json": { target: "https://qualitylayer.dev", changeOrigin: true },
      ...(process.env.QUALITYLAYER_BILLING_DEV_PROXY ? {
        "/api/billing": { target: process.env.QUALITYLAYER_BILLING_DEV_PROXY },
        "/__billing-fixture__": { target: process.env.QUALITYLAYER_BILLING_DEV_PROXY },
      } : {}),
    },
  },
  plugins: [
    cockpitDemo(),
    react(),
    tailwindcss(),
    mode === "development" && docusaurusRedirect(),
    sitemapPlugin(),
    prerenderPlugin(),
    indexNowPlugin(),
  ].filter(Boolean),
  resolve: {
    // The lifecycle names its routes and optional steps from the product's own tables.
    alias: { "@ql": path.resolve(import.meta.dirname, "../../qualitylayer/src") },
    dedupe: [...COCKPIT_DEDUPE],
  },
  build: {
    manifest: true,
    target: "es2020",
    cssMinify: true,
    chunkSizeWarningLimit: 800,
    // Polar's checkout is only reachable through a lazy import on /pricing:
    // keep it out of the home page's preloads.
    modulePreload: {
      polyfill: false,
      resolveDependencies(_filename, deps) {
        return deps.filter((d) => !d.includes("polar-"));
      },
    },
    rollupOptions: {
      input: { website: path.resolve(import.meta.dirname, "index.html"), app: path.resolve(import.meta.dirname, "app-demo/index.html") },
      output: {
        // Split only feature-specific deps into their own chunks. Anything that
        // chains back through react/react-dom stays in the default vendor chunk
        // so we don't create import cycles.
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@polar-sh")) return "polar";
          return undefined;
        },
      },
    },
  },
}));
