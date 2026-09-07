// App state for React: one AppState in context, changed through `commit(mutator)`.
// The mutator runs on a structured clone so components never see mutation, and
// every commit is persisted (debounced) and queued for sync.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../model.ts';
import { saveState } from '../store.ts';

export type Mutator = (s: AppState) => void;

interface StoreApi {
  state: AppState;
  /** Apply a change (or none: `commit()` just persists) and re-render. */
  commit: (mut?: Mutator) => AppState;
  /** Replace the whole state (imports, sync merges). */
  replace: (next: AppState) => void;
  /** Latest state without subscribing (for event handlers). */
  current: () => AppState;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ initial, children }: { initial: AppState; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const ref = useRef(state);
  ref.current = state;

  const replace = useCallback((next: AppState) => {
    ref.current = next;
    setState(next);
  }, []);

  const commit = useCallback((mut?: Mutator) => {
    const next = structuredClone(ref.current);
    if (mut) mut(next);
    saveState(next);
    ref.current = next;
    setState(next);
    return next;
  }, []);

  const current = useCallback(() => ref.current, []);
  const api = useMemo(() => ({ state, commit, replace, current }), [state, commit, replace, current]);
  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const api = useContext(StoreContext);
  if (!api) throw new Error('useStore outside StoreProvider');
  return api;
}
