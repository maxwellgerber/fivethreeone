import { defaultProgram, suggestTm, LIFTS, type Lift, type Position } from './engine.ts';
import { defaultAssistance, defaultSettings, type AppState, type Workout } from './model.ts';
import { bestE1rmPerLift } from './stats.ts';

const DB_NAME = 'fivethreeone';
const STORE = 'kv';
const KEY = 'state';

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
  };
}

export async function loadState(): Promise<AppState> {
  const saved = await idbGet<AppState>(KEY);
  if (saved && saved.version === 1) {
    // Fill any fields added since the save was made.
    const fresh = freshState();
    return {
      ...fresh,
      ...saved,
      settings: { ...fresh.settings, ...saved.settings },
      program: { ...fresh.program, ...saved.program },
      workouts: saved.workouts?.length ? saved.workouts : fresh.workouts,
    };
  }
  return freshState();
}

let pending: number | null = null;
export function saveState(state: AppState): void {
  if (pending !== null) clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = null;
    void idbSet(KEY, state);
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
  let workouts: Workout[];
  if (mode === 'replace') {
    workouts = data.workouts;
  } else {
    const ids = new Set(state.workouts.map((w) => w.id));
    workouts = state.workouts.concat(data.workouts.filter((w) => !ids.has(w.id)));
  }
  workouts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    ...state,
    workouts,
    program: mode === 'replace' && data.program ? { ...state.program, ...data.program } : state.program,
    position: mode === 'replace' && data.position ? (data.position as Position) : state.position,
    settings: mode === 'replace' && data.settings ? { ...state.settings, ...data.settings } : state.settings,
    assistance: mode === 'replace' && data.assistance ? data.assistance : state.assistance,
  };
}

export type { Lift };
