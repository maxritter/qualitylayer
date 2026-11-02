import type { Plugin } from "vite";
import path from "node:path";

const COCKPIT_SOURCE = path.resolve(import.meta.dirname, "../../qualitylayer/src/ui");

export const COCKPIT_DEDUPE = ["react", "react-dom", "cn", "lucide-react", "radix-ui", "@base-ui/react", "class-variance-authority", "clsx", "tailwind-merge", "dompurify", "css-tree", "parse5", "marked", "mermaid", "sonner", "tailwindcss", "tw-animate-css", "shadcn", "@pierre/diffs", "@tanstack/react-virtual"];

/** Both browser builds and prerendering resolve each app's shadcn imports from its own source. */
export default function cockpitDemo(): Plugin {
  return {
    name: "qualitylayer-cockpit-demo",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source === "/qualitylayer-cockpit-demo.tsx") return path.join(COCKPIT_SOURCE, "demo/main.tsx");
      if (!source.startsWith("@/")) return null;
      const base = importer?.startsWith(COCKPIT_SOURCE) ? COCKPIT_SOURCE : path.resolve(import.meta.dirname, "src");
      return this.resolve(path.join(base, source.slice(2)), importer, { skipSelf: true });
    },
  };
}
