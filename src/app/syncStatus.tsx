// Starts the sync layer once the store exists and exposes its status to components.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initSync, syncStatus, type SyncStatus } from '../sync.ts';
import { useStore } from './store.tsx';

const SyncContext = createContext<SyncStatus>(syncStatus());

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(syncStatus());
  const { current, replace } = useStore();
  useEffect(() => {
    void initSync({ getState: current, setState: replace, onStatus: setStatus });
  }, [current, replace]);
  return <SyncContext.Provider value={status}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncStatus {
  return useContext(SyncContext);
}
