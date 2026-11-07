import { useCallback, useMemo, useState } from "react";
import { ALL_TABS, stepDocs, type LoadedShare, type Tab } from "@/lib/sharing/sharing";

type Share = Extract<LoadedShare, { kind: "v2" }>;
export type SharedReaderLocation = { file: string; at?: string };

/** Reading a shared document never changes the URL fragment that holds its key. */
export function useSharedNavigation(share: Share, initial: Tab) {
  const [view, setView] = useState<{ tab: Tab; reader: SharedReaderLocation | null }>({ tab: initial, reader: null });
  const steps = useMemo(() => stepDocs(share.docs), [share.docs]);
  const setTab = useCallback((tab: Tab) => setView({ tab, reader: null }), []);
  const readDocument = useCallback((file: string, at?: string) => {
    const tab = ALL_TABS.find((step) => steps[step].includes(file));
    if (tab) setView({ tab, reader: { file, ...(at ? { at } : {}) } });
  }, [steps]);
  return { tab: view.tab, reader: view.reader, setTab, readDocument };
}
