// Pure merge of two AppState snapshots (local vs. remote). Used by the sync layer.
//
// Rules:
// - Workouts are keyed by id. When both sides have one, the newer `updatedAt`
//   (falling back to `finishedAt`, then 0) wins; ties keep the local copy.
// - Deletions are tombstones (`tombstones[id] = epoch ms`). A tombstone beats a
//   workout unless the workout was updated after the tombstone was written.
//   Tombstones expire after a year so the map cannot grow without bound.
// - Everything else (program, position, settings, assistance, active session,
//   onboarded) is last-writer-wins by the snapshot's `updatedAt`.
import type { AppState, Workout } from './model.ts';

export function workoutStamp(w: Workout): number {
  return w.updatedAt ?? w.finishedAt ?? 0;
}

export function sortWorkouts(ws: Workout[]): Workout[] {
  return ws.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : workoutStamp(b) - workoutStamp(a)));
}

/** Tombstones older than this are dropped; a device offline longer than that may resurrect a deleted session. */
export const TOMBSTONE_TTL_MS = 365 * 86400e3;

export function mergeStates(local: AppState, remote: AppState, now = Date.now()): AppState {
  const tombstones: Record<string, number> = { ...(remote.tombstones ?? {}) };
  for (const [id, ts] of Object.entries(local.tombstones ?? {})) tombstones[id] = Math.max(ts, tombstones[id] ?? 0);
  for (const [id, ts] of Object.entries(tombstones)) if (now - ts > TOMBSTONE_TTL_MS) delete tombstones[id];

  const byId = new Map<string, Workout>();
  for (const w of remote.workouts) byId.set(w.id, w);
  for (const w of local.workouts) {
    const r = byId.get(w.id);
    if (!r || workoutStamp(w) >= workoutStamp(r)) byId.set(w.id, w);
  }
  const workouts: Workout[] = [];
  for (const w of byId.values()) {
    const dead = tombstones[w.id];
    if (dead !== undefined && workoutStamp(w) <= dead) continue;
    if (dead !== undefined) delete tombstones[w.id]; // resurrected by a later edit
    workouts.push(w);
  }
  sortWorkouts(workouts);

  const newest = (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;
  const updatedAt = local.updatedAt === undefined && remote.updatedAt === undefined ? undefined : Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0);
  const out: AppState = {
    version: 1,
    program: newest.program,
    position: newest.position,
    settings: newest.settings,
    assistance: newest.assistance,
    active: newest.active,
    onboarded: local.onboarded || remote.onboarded,
    workouts,
  };
  if (updatedAt !== undefined) out.updatedAt = updatedAt;
  if (Object.keys(tombstones).length || local.tombstones || remote.tombstones) out.tombstones = tombstones;
  return out;
}

/** Structural equality, independent of key order (states round-trip through JSON and merges). */
export function sameState(a: AppState, b: AppState): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { if (o[k] !== undefined) acc[k] = o[k]; return acc; }, {});
    }
    return val;
  });
}
