import { NAMES } from "@ql/core/docs/names";
import { SEVEN_STEP_DOCS } from "@ql/core/team/publication";

/** The step files a link may hold: the three, or the seven of a link shared before them. */
const names = new Set<string>([...Object.values(NAMES), ...Object.values(SEVEN_STEP_DOCS)]);

/** Export exactly the already published text. No key, comments, or private records. */
export function markdownExport(docs: Record<string, string>, name: string): { name: string; text: string; blob: Blob } | null {
  if (!names.has(name) || typeof docs[name] !== "string") return null;
  return { name, text: docs[name], blob: new Blob([docs[name]], { type: "text/markdown;charset=utf-8" }) };
}

export function downloadMarkdown(docs: Record<string, string>, name: string): boolean {
  const file = markdownExport(docs, name);
  if (!file) return false;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(file.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    return true;
  } catch { return false; }
  finally { if (url) { const created = url; setTimeout(() => URL.revokeObjectURL(created), 1000); } }
}
