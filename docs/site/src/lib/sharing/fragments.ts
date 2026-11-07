// The App fetches its wireframe and artboard parsers as /fragments.js; this site serves no such file
// and bundles the same parsers, so it hands them to the shared App Reader at once.
import { provideFragments } from "@ql/ui/reader/fragments";
import * as fragments from "@ql/ui/reader/fragments-entry";

provideFragments(fragments);
