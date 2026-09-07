import { defaultProgram, suggestTm, LIFTS, type Lift, type Position } from './engine.ts';
import { defaultAssistance, defaultSettings, type AppState, type Workout } from './model.ts';
import { sortWorkouts } from './merge.ts';
import { bestE1rmPerLift } from './stats.ts';
import { markDirty } from './sync.ts';

const DB_NAME = 'fivethreeone';
const STORE = 'kv';
const KEY = 'state';
const SYNC_KEY = 'sync';

export interface SyncMeta {
  /** Server revision the local state is based on (0 = never synced). */
  rev: number;
  /** Local changes not yet pushed. */
  dirty: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable; keep in memory */
    }
  }
}

/** History bundled into the page (script#seed-history), if any. */
function seedWorkouts(): Workout[] {
  try {
    const el = document.getElementById('seed-history');
    if (!el?.textContent) return [];
    const data = JSON.parse(el.textContent) as { workouts?: Workout[] };
    return data.workouts ?? [];
  } catch {
    return [];
  }
}

export function freshState(): AppState {
  const program = defaultProgram('lb');
  const workouts = seedWorkouts().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  // Seed TMs from the best recent e1RM (last 8 weeks) when history exists.
  if (workouts.length) {
    const best = bestE1rmPerLift(workouts, 56);
    for (const l of LIFTS) {
      const b = best[l];
      if (b) program.tms[l] = suggestTm(b.weight, b.reps, 0.9, program.roundTo);
    }
  }
  return {
    version: 1,
    program,
    position: { phase: 0, cycle: 0, week: 0, day: 0 },
    workouts,
    active: null,
    settings: defaultSettings('lb'),
    assistance: defaultAssistance(),
    onboarded: false,
    updatedAt: Date.now(),
    tombstones: {},
  };
}

/** Persist without touching sync (used by the sync layer itself). */
export function persistState(state: AppState): Promise<void> {
  noteState(state);
  return idbSet(KEY, state);
}

export async function loadSyncMeta(): Promise<SyncMeta> {
  return (await idbGet<SyncMeta>(SYNC_KEY)) ?? { rev: 0, dirty: false };
}
export function saveSyncMeta(meta: SyncMeta): Promise<void> {
  return idbSet(SYNC_KEY, meta);
}

export async function loadState(): Promise<AppState> {
  const saved = await idbGet<AppState>(KEY);
  let state: AppState;
  if (saved && saved.version === 1) {
    // Fill any fields added since the save was made.
    const fresh = freshState();
    state = {
      ...fresh,
      ...saved,
      settings: { ...fresh.settings, ...saved.settings },
      program: { ...fresh.program, ...saved.program },
      workouts: saved.workouts?.length ? saved.workouts : fresh.workouts,
    };
  } else {
    state = freshState();
  }
  noteState(state);
  return state;
}

/** Fingerprint of everything outside `workouts`/`tombstones`, to stamp `updatedAt` only on real changes. */
function metaKey(s: AppState): string {
  return JSON.stringify([s.program, s.position, s.settings, s.assistance, s.active, s.onboarded]);
}
let lastMetaKey = '';

/** Remember the current non-workout fields so the next save can tell whether they changed. */
export function noteState(state: AppState): void {
  lastMetaKey = metaKey(state);
}

let pending: number | null = null;
export function saveState(state: AppState): void {
  const key = metaKey(state);
  if (key !== lastMetaKey) {
    state.updatedAt = Date.now();
    lastMetaKey = key;
  }
  if (pending !== null) clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = null;
    void idbSet(KEY, state).then(() => markDirty());
  }, 150);
}

export function exportJson(state: AppState): string {
  return JSON.stringify(
    {
      app: 'fivethreeone',
      version: 1,
      exportedAt: new Date().toISOString(),
      program: state.program,
      position: state.position,
      settings: state.settings,
      assistance: state.assistance,
      workouts: state.workouts,
    },
    null,
    1,
  );
}

export function importJson(state: AppState, text: string, mode: 'merge' | 'replace'): AppState {
  const data = JSON.parse(text) as Partial<AppState> & { workouts?: Workout[] };
  if (!Array.isArray(data.workouts)) throw new Error('No workouts found in that file.');
  const now = Date.now();
  let workouts: Workout[];
  const tombstones = { ...(state.tombstones ?? {}) };
  if (mode === 'replace') {
    const keep = new Set(data.workouts.map((w) => w.id));
    for (const w of state.workouts) if (!keep.has(w.id)) tombstones[w.id] = now;
    workouts = data.workouts.map((w) => ({ ...w, updatedAt: now }));
  } else {
    const ids = new Set(state.workouts.map((w) => w.id));
    workouts = state.workouts.concat(data.workouts.filter((w) => !ids.has(w.id)).map((w) => ({ ...w, updatedAt: now })));
  }
  for (const w of workouts) delete tombstones[w.id];
  sortWorkouts(workouts);
  return {
    ...state,
    workouts,
    tombstones,
    program: mode === 'replace' && data.program ? { ...state.program, ...data.program } : state.program,
    position: mode === 'replace' && data.position ? (data.position as Position) : state.position,
    settings: mode === 'replace' && data.settings ? { ...state.settings, ...data.settings } : state.settings,
    assistance: mode === 'replace' && data.assistance ? data.assistance : state.assistance,
  };
}

export type { Lift };
