// The App fetches its wireframe and artboard parsers as /fragments.js; this site serves no such file
// and already bundles the same parsers (FencedVisual, plan.ts), so it hands them over at once.
import { provideFragments } from "@ql/ui/reader/fragments";
import * as fragments from "@ql/ui/reader/fragments-entry";

provideFragments(fragments);
