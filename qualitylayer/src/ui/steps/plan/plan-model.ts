// What the Plan page reads out of its document, apart from any drawing: the Summary's bullets and the
// Size line, the Diagrams and Interface as tab items, Done means as points with their steps (a bug's
// with Before and After), the Reviews line and the Decided with you rows (the text QualityLayer wrote
// between its markers). The order of the sections is the file's: the schema writes them in the
// order the page draws them, so nothing here sorts. Pure, so a test reads it as it is.

export {
  type AcceptanceView,
  acceptanceOf,
  runKindOf,
  runKindsOf,
} from "./plan-acceptance.ts"
export {
  type DiagramItem,
  diagramsOf,
  type InterfaceItem,
  interfaceOf,
  reproductionOf,
} from "./plan-diagrams.ts"
export {
  type PlanIndicator,
  planIndicators,
  planMeta,
  sizeFact,
  sizeOf,
  summaryBullets,
} from "./plan-header.ts"
export {
  type Backing,
  backingOf,
  byYouRows,
  type ReviewView,
  reviewCount,
  reviewMeta,
  reviewOf,
  reviewTotal,
  slugOf,
  withoutCallLines,
} from "./plan-reviews.ts"
export {
  type DataRow,
  dataRowsOf,
  decideIdsOf,
  pulledViews,
  type ReasonRow,
  reasonRowsOf,
} from "./plan-technical.ts"
