import { ChangeMapBlock } from "@ql/ui/reader/ChangeMapBlock";
import "@ql/ui/reader/reader.css";
import { EXAMPLE_MAP } from "./change-map-example";

/**
 * The home page's example change map: the App's own component in its shared mode (no action reaches a checkout).
 * Loaded on its own so the rest of the home page stays light; on a phone it is the App's list.
 */
export default function ChangeMapDemo() {
  return <ChangeMapBlock source={EXAMPLE_MAP} shared />;
}
