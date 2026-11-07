// What the site knows of the App's StepDocument (qualitylayer/src/ui/steps/StepDocument.tsx). The site's
// type check is not the App's: following the real file would pull the App's server and core into this
// project. `tsconfig.app.json` maps the specifier here; Vite and Vitest load the real component.
// `src/types/ql/ql-typings.test.ts` keeps these names in step with the App's source.
import type { ReactNode } from "react";

/** A comment on a passage, as the Reader draws it. The App's `Comment` has more fields, all optional. */
export type StepComment = {
  id: string;
  doc: string;
  quote: string;
  remark: string;
  created: number;
};

export type StepDocumentProps = {
  path: string;
  markdown: string;
  comments: StepComment[];
  /** The document cut into sections; null on a page with no server to cut it. */
  sections: null;
  theme: string;
  loadArtifact: (name: string) => Promise<string>;
  onQuote?: ((quote: string) => void) | undefined;
  at?: string | undefined;
  extraTools?: ReactNode | undefined;
  /** Draw the artifacts the document's `ql:artifact` markers name, where they stand (Discuss's wireframe). */
  artifacts?: { open?: ((name: string) => void) | undefined } | undefined;
  stepFile?: { step: "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review"; task?: string; load?: (name: string) => Promise<string> } | undefined;
};

export function StepDocument(props: StepDocumentProps): ReactNode;
