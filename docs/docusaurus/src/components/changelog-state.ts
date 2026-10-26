import { useEffect, useRef, useState } from 'react';
import { type ReleaseLoader, type ReleasePage } from './changelog-data';

export function useFirstPage(load: ReleaseLoader) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ page: ReleasePage | null; loading: boolean; error: boolean }>({ page: null, loading: true, error: false });
  useEffect(() => {
    let current = true;
    load(1).then(page => {
      if (current) setState({ page, loading: false, error: false });
    }).catch(() => {
      if (current) setState({ page: null, loading: false, error: true });
    });
    return () => { current = false; };
  }, [load, attempt]);
  const retry = () => { setState({ page: null, loading: true, error: false }); setAttempt(value => value + 1); };
  return { ...state, retry };
}

export function useEarlierPages(load: ReleaseLoader, first: ReleasePage | null, onLoaded: (version: string) => void) {
  const [state, setState] = useState<{ pages: ReleasePage[]; loading: boolean; error: boolean }>({ pages: [], loading: false, error: false });
  const busy = useRef(false);
  const alive = useRef(false);
  const firstRef = useRef(first);
  useEffect(() => { firstRef.current = first; }, [first]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const lastPage = state.pages.at(-1) ?? first;
  const nextPage = lastPage?.nextPage ?? null;
  async function earlier() {
    if (nextPage === null || busy.current) return;
    busy.current = true;
    setState(value => ({ ...value, loading: true, error: false }));
    try {
      const page = await load(nextPage);
      if (!alive.current || firstRef.current !== first) return;
      if (page.notes.length) onLoaded(page.notes[0].version);
      setState(value => ({ pages: [...value.pages, page], loading: false, error: false }));
    } catch {
      if (alive.current) setState(value => ({ ...value, loading: false, error: true }));
    } finally { busy.current = false; }
  }
  return { ...state, nextPage, finished: lastPage?.nextPage === null, earlier };
}
