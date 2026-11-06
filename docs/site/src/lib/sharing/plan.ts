/**
 * A shared plan's Markdown, cut into what the page draws: text, diagrams and mockups; and the
 * plan's details read for the two things a reviewer looks for first, the build's slices and the
 * contracts it must keep. No DOM is needed to cut: only the text parts are made into HTML, and
 * only where a DOM exists to sanitise with.
 */

import DOMPurify from "dompurify";
import { sharedArtifactHtml } from "@ql/ui/artifact/shared-html";
import { parseFence } from "@ql/core/docs/fragments";
import { marked, type Token, type Tokens, type TokensList } from "marked";
import { screensFromReview, withScreenStills } from "@ql/core/review/screen-pairs";
import { sharedScreenStills } from "@ql/core/team/publication";

export function screenPairsOf(docs: Record<string, string>, stills: unknown) {
  return withScreenStills(screensFromReview(docs["07-review.md"] ?? ""), sharedScreenStills(stills));
}

export type PlanBlock =
  | { kind: "html"; key: string; html: string }
  | { kind: "mermaid"; key: string; source: string }
  | { kind: "wireframe"; key: string; source: string }
  | { kind: "panel"; key: string; source: string }
  /** `path` as the plan's fence names it: `artifacts/settings.html`. */
  | { kind: "artifact"; key: string; path: string };

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown tokens as safe HTML. Without a DOM to sanitise with, the text is shown as text. */
function htmlOf(tokens: Token[], links: TokensList["links"]): string {
  if (typeof window === "undefined") return `<pre>${escapeHtml(tokens.map((t) => t.raw).join("").trim())}</pre>`;
  const list = Object.assign([...tokens], { links }) as TokensList;
  return DOMPurify.sanitize(marked.parser(list), {
    FORBID_TAGS: ["style", "iframe", "form", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
}

const fenceWord = (token: Tokens.Code) => (token.lang ?? "").trim().split(/\s+/)[0];

/**
 * The plan in reading order. A ```mermaid fence is a diagram, and a ```artifact fence names a
 * mockup, in its body or after the word (the App writes the path in the body).
 */
export function planBlocks(markdown: string): PlanBlock[] {
  const tokens = marked.lexer(markdown.replace(/<!--\s*ql:artifact\s+([a-z0-9][a-z0-9-]*)\s*-->/g, (_marker, name: string) => `\n\n\`\`\`artifact\nartifacts/${name}.html\n\`\`\`\n\n`));
  const blocks: PlanBlock[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (run.some((t) => t.type !== "space")) blocks.push({ kind: "html", key: `t${blocks.length}`, html: htmlOf(run, tokens.links) });
    run = [];
  };
  for (const token of tokens) {
    if (token.type === "code" && fenceWord(token as Tokens.Code) === "mermaid") {
      flush();
      blocks.push({ kind: "mermaid", key: `m${blocks.length}`, source: (token as Tokens.Code).text });
    } else if (token.type === "code" && ["wireframe", "panel"].includes(fenceWord(token as Tokens.Code))) {
      const code = token as Tokens.Code;
      const kind = fenceWord(code) as "wireframe" | "panel";
      flush();
      if (parseFence(kind, code.text).fragment !== "") blocks.push({ kind, key: `v${blocks.length}`, source: code.text });
    } else if (token.type === "code" && fenceWord(token as Tokens.Code) === "artifact") {
      const code = token as Tokens.Code;
      const path = code.text.trim() || (code.lang ?? "").trim().split(/\s+/).slice(1).join(" ");
      flush();
      if (path !== "") blocks.push({ kind: "artifact", key: `a${blocks.length}`, path });
    } else {
      run.push(token);
    }
  }
  flush();
  return blocks;
}

/** A slice of the build, as the Plan's task cards give it. */
export type Slice = { n: number; title: string; tasks: number };

/** Lines outside code fences: a heading inside a fence is an example, not the document's. */
function* outsideFences(markdown: string): Generator<string> {
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) yield line;
  }
}

const plain = (title: string) => title.replace(/[`*]/g, "");

function headingTitle(raw: string): string | null {
  const title = raw.trim();
  if (title !== "") return /[\r\n\u2028\u2029]/.test(title) ? null : title;
  // The old reader kept one whitespace character when its title contained no words.
  for (let at = raw.length - 1; at >= 0; at--) {
    const char = raw.charAt(at);
    if (!/[\r\n\u2028\u2029]/.test(char)) return char;
  }
  return null;
}

/** The build's slices: each `## Slice N: title` with the number of `- [ ] T1 …` task lines under it. */
export function slicesOf(details: string): Slice[] {
  const slices: Slice[] = [];
  let current: Slice | null = null;
  for (const line of outsideFences(details)) {
    const slice = /^##\s+Slice\s+(\d+)\s*[:.–—-]/.exec(line);
    const title = slice === null ? null : headingTitle(line.slice(slice[0].length));
    if (slice !== null && title !== null) {
      current = { n: Number(slice[1]), title: plain(title), tasks: 0 };
      slices.push(current);
    } else if (/^##\s/.test(line)) {
      current = null;
    } else if (current !== null && /^- \[[ xX]\]\s+T\d+/.test(line)) {
      current.tasks++;
    }
  }
  return slices;
}

/** An interface the build must keep: its title (a takeaway) and its Markdown body. */
export type Contract = { title: string; body: string };

/**
 * The contracts: each H3 under "System design contracts" and "Program design". The body is cut
 * with its fences whole, so a diagram or a diff inside a contract stays one.
 */
export function contractsOf(details: string): Contract[] {
  const contracts: Contract[] = [];
  let inContracts = false;
  let current: { title: string; lines: string[] } | null = null;
  let fenced = false;
  const close = () => {
    if (current !== null) contracts.push({ title: current.title, body: current.lines.join("\n").trim() });
    current = null;
  };
  for (const line of details.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,3})\s/.exec(line);
    const title = heading === null ? null : headingTitle(line.slice(heading[0].length));
    if (heading !== null && title !== null) {
      close();
      const level = (heading[1] ?? "").length;
      if (level <= 2) inContracts = level === 2 && /contract|program design/i.test(title);
      else if (inContracts) current = { title, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return contracts;
}

/** A mockup file by its bare name, so the plan's fence and a question name it alike. */
export const mockupName = (path: string) => path.replace(/^artifacts\//, "");

/** A mockup's html from the link: the fence names `artifacts/settings.html`, an item just `settings.html`. */
export const mockupHtml = (docs: Record<string, string>, path: string): string | undefined => {
  const html = docs[`artifacts/${mockupName(path)}`];
  return html === undefined ? undefined : sharedArtifactHtml(html);
};

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

/** The policy goes first in <head>, so nothing in the mockup runs before it applies (the frame's header says the same). */
export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${meta}`);
  if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (tag) => `${tag}<head>${meta}</head>`);
  return `<head>${meta}</head>${html}`;
}

/** A mockup fence that names one of `shown` (mockups drawn under a question), taken out of the Markdown. */
export function withoutShownMockups(markdown: string, shown: ReadonlySet<string>): string {
  if (shown.size === 0) return markdown;
  return markdown.replace(/^```artifact([^\n]*)\n(?:([^\n`][^\n]*)\n)?```[ \t]*(?:\n|$)/gm, (fence, inline: string, body?: string) => {
    const path = (body ?? inline).trim();
    return path !== "" && shown.has(mockupName(path)) ? "" : fence;
  });
}
