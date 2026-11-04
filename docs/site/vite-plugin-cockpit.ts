import type { Plugin } from "vite";
import path from "node:path";

const COCKPIT_SOURCE = path.resolve(import.meta.dirname, "../../qualitylayer/src/ui");
const GUIDE_DIALOG = "\0qualitylayer-guide-dialog";
const DIALOG_SOURCE = path.join(COCKPIT_SOURCE, "components/ui/dialog.tsx");

// Only the website guide shares interaction with its illustrative App dialogs.
const guideDialog = `
import { createElement } from "react";
import { Dialog as ProductionDialog } from "@base-ui/react/dialog";
const guided = () => typeof window !== "undefined"
  && (window.location.pathname === "/app-demo" || window.location.pathname === "/app-demo/")
  && new URLSearchParams(window.location.search).has("guide");
function Root(props) {
  return createElement(ProductionDialog.Root, guided()
    ? { ...props, modal: false, disablePointerDismissal: true }
    : props);
}
function Popup(props) {
  if (!guided()) return createElement(ProductionDialog.Popup, props);
  const { onKeyDown, ...rest } = props;
  return createElement(ProductionDialog.Popup, {
    ...rest,
    onKeyDown(event) {
      if (event.key !== "Tab") onKeyDown?.(event);
    },
  });
}
export const Dialog = { ...ProductionDialog, Root, Popup };
`;

export const COCKPIT_DEDUPE = ["react", "react-dom", "cn", "lucide-react", "radix-ui", "@base-ui/react", "class-variance-authority", "clsx", "tailwind-merge", "dompurify", "css-tree", "parse5", "marked", "mermaid", "sonner", "tailwindcss", "tw-animate-css", "shadcn", "@pierre/diffs", "@tanstack/react-virtual"];

/** Both browser builds and prerendering resolve each app's shadcn imports from its own source. */
export default function cockpitDemo(): Plugin {
  return {
    name: "qualitylayer-cockpit-demo",
    enforce: "pre",
    async resolveId(source, importer) {
      const from = importer?.split("?")[0];
      if (source === "@base-ui/react/dialog" && from !== undefined && path.normalize(from) === DIALOG_SOURCE)
        return GUIDE_DIALOG;
      if (source === "/qualitylayer-cockpit-demo.tsx") return path.join(COCKPIT_SOURCE, "demo/main.tsx");
      if (!source.startsWith("@/")) return null;
      const base = importer?.startsWith(COCKPIT_SOURCE) ? COCKPIT_SOURCE : path.resolve(import.meta.dirname, "src");
      return this.resolve(path.join(base, source.slice(2)), importer, { skipSelf: true });
    },
    load(id) {
      if (id === GUIDE_DIALOG) return guideDialog;
    },
  };
}
