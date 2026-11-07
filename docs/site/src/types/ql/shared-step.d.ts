import type { ComponentType } from "react";
import type { StepComment } from "./step-document";

/** The site passes encrypted-share data and reading callbacks, never an App API or task authority. */
export type SharedStepProps = {
  id: string;
  title: string;
  stage?: string;
  docs: Record<string, string>;
  presentation?: unknown;
  stills?: unknown;
  step: "discuss" | "research" | "plan" | "outline" | "implement" | "verify" | "review";
  theme: string;
  shareUrl: string;
  reading?: boolean;
  at?: string;
  comments?: StepComment[];
  onReadDocument: (file: string, at?: string) => void;
  onQuote?: (text: string) => void;
};
export const SharedStep: ComponentType<SharedStepProps>;

export const SharedStepIcon: ComponentType<{ step: SharedStepProps["step"]; className?: string }>;
