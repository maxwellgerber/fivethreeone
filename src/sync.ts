// Sync client: keeps the local AppState in step with the copy the Worker stores
// in KV (see worker/index.ts, /api/state).
//
// - Pull on boot and whenever the app returns to the foreground.
// - Push (debounced) after every local change; the server rejects a push whose
//   base revision is stale with 409 + the current copy, which we merge and retry.
// - Sync is disabled automatically when the page is not served by the Worker
//   (local preview, single-file build) or the user is signed out.
//
// `createSyncClient` takes its I/O as dependencies so the loop is testable in
// Node; the module-level functions below are the browser instance.
import { mergeStates, sameState } from './merge.ts';
import type { AppState } from './model.ts';
import { loadSyncMeta, persistState, saveSyncMeta, type SyncMeta } from './store.ts';

export type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  dirty: boolean;
  lastSyncAt: number | null;
  rev: number;
  error?: string;
}

interface RemoteDoc {
  rev: number;
  updatedAt?: number;
  state?: AppState;
}

export interface SyncHooks {
  getState(): AppState;
  /** Replace the app's state after a merge (and re-render). */
  setState(next: AppState): void;
  onStatus(status: SyncStatus): void;
}

export interface SyncDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  persist: (state: AppState) => Promise<void>;
  loadMeta: () => Promise<SyncMeta>;
  saveMeta: (meta: SyncMeta) => Promise<void>;
  isOnline: () => boolean;
  /** Called when the server says we are signed out. */
  onUnauthorized: () => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
}

export interface SyncClient {
  init(hooks: SyncHooks): Promise<void>;
  markDirty(): void;
  syncNow(): Promise<void>;
  status(): SyncStatus;
}

const API = '/api/state';
export const PUSH_DEBOUNCE_MS = 1500;

export function createSyncClient(deps: SyncDeps): SyncClient {
  let hooks: SyncHooks | null = null;
  let meta: SyncMeta = { rev: 0, dirty: false };
  let status: SyncStatus = { phase: 'disabled', dirty: false, lastSyncAt: null, rev: 0 };
  let pushTimer: number | null = null;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  function setStatus(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch, dirty: meta.dirty, rev: meta.rev };
    hooks?.onStatus(status);
  }

  async function setMeta(patch: Partial<SyncMeta>): Promise<void> {
    meta = { ...meta, ...patch };
    await deps.saveMeta(meta);
  }

  function schedulePush(): void {
    if (pushTimer !== null) deps.clearTimeout(pushTimer);
    pushTimer = deps.setTimeout(() => {
      pushTimer = null;
      void syncNow();
    }, PUSH_DEBOUNCE_MS);
  }

  function markDirty(): void {
    if (!hooks || status.phase === 'disabled') return;
    void setMeta({ dirty: true }).then(() => {
      setStatus({});
      schedulePush();
    });
  }

  async function init(h: SyncHooks): Promise<void> {
    hooks = h;
    meta = await deps.loadMeta();
    setStatus({ phase: 'idle' });
    await syncNow();
  }

  /** Pull, merge, and push if needed. Serialised: concurrent calls coalesce. */
  function syncNow(): Promise<void> {
    if (!hooks || status.phase === 'disabled') return Promise.resolve();
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = run().finally(() => {
      inFlight = null;
      if (queued) {
        queued = false;
        void syncNow();
      }
    });
    return inFlight;
  }

  function signedOut(): void {
    setStatus({ phase: 'error', error: 'Signed out' });
    deps.onUnauthorized();
  }

  async function fetchDoc(): Promise<RemoteDoc | 'disabled' | 'unauthorized'> {
    const res = await deps.fetch(API, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) return 'unauthorized';
    const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json');
    if (!isJson) {
      // Static hosting without the Worker: no sync endpoint.
      setStatus({ phase: 'disabled' });
      return 'disabled';
    }
    if (res.status === 404) return { rev: 0 };
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    return (await res.json()) as RemoteDoc;
  }

  async function run(): Promise<void> {
    if (!hooks) return;
    if (!deps.isOnline()) {
      setStatus({ phase: 'offline' });
      return;
    }
    setStatus({ phase: 'syncing', error: undefined });
    try {
      const remote = await fetchDoc();
      if (remote === 'disabled') return;
      if (remote === 'unauthorized') return signedOut();

      let local = hooks.getState();
      if (remote.rev > meta.rev && remote.state) {
        const merged = mergeStates(local, remote.state);
        const changedLocal = !sameState(merged, local);
        const changedRemote = !sameState(merged, remote.state);
        await setMeta({ rev: remote.rev, dirty: meta.dirty || changedRemote });
        if (changedLocal) {
          local = merged;
          await deps.persist(merged);
          hooks.setState(merged);
        }
      } else if (remote.rev === 0 && meta.rev === 0) {
        // Nothing on the server yet: first device seeds it.
        await setMeta({ dirty: true });
      }

      if (meta.dirty) await push(local);
      setStatus({ phase: 'idle', lastSyncAt: deps.now() });
    } catch (e) {
      setStatus({ phase: deps.isOnline() ? 'error' : 'offline', error: (e as Error).message });
    }
  }

  async function push(state: AppState, attempt = 0): Promise<void> {
    if (!hooks) return;
    const res = await deps.fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ baseRev: meta.rev, state }),
    });
    if (res.status === 401) return signedOut();
    if (res.status === 409) {
      if (attempt >= 2) throw new Error('Could not reconcile with the server copy');
      const cur = (await res.json()) as RemoteDoc;
      const merged = cur.state ? mergeStates(hooks.getState(), cur.state) : hooks.getState();
      await setMeta({ rev: cur.rev });
      await deps.persist(merged);
      hooks.setState(merged);
      return push(merged, attempt + 1);
    }
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    const doc = (await res.json()) as RemoteDoc;
    await setMeta({ rev: doc.rev, dirty: false });
  }

  return { init, markDirty, syncNow, status: () => status };
}

// ---- Browser instance ---------------------------------------------------------

const browser: SyncClient | null = typeof window === 'undefined' ? null : createSyncClient({
  fetch: (url, init) => fetch(url, init),
  persist: persistState,
  loadMeta: loadSyncMeta,
  saveMeta: saveSyncMeta,
  isOnline: () => navigator.onLine,
  onUnauthorized: () => { location.href = '/login'; },
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  now: () => Date.now(),
});

export function syncStatus(): SyncStatus {
  return browser?.status() ?? { phase: 'disabled', dirty: false, lastSyncAt: null, rev: 0 };
}

/** Called by the store after each local save. */
export function markDirty(): void {
  browser?.markDirty();
}

export async function initSync(hooks: SyncHooks): Promise<void> {
  if (!browser) return;
  window.addEventListener('online', () => void browser.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void browser.syncNow();
  });
  await browser.init(hooks);
}

export function syncNow(): Promise<void> {
  return browser?.syncNow() ?? Promise.resolve();
}
