// Pure merge of two AppState snapshots (local vs. remote). Used by the sync layer.
//
// Rules:
// - Workouts are keyed by id. When both sides have one, the newer `updatedAt`
//   (falling back to `finishedAt`, then 0) wins; ties keep the local copy.
// - Deletions are tombstones (`tombstones[id] = epoch ms`). A tombstone beats a
//   workout unless the workout was updated after the tombstone was written.
// - Everything else (program, position, settings, assistance, active session,
//   onboarded) is last-writer-wins by the snapshot's `updatedAt`.
import type { AppState, Workout } from './model.ts';

export function workoutStamp(w: Workout): number {
  return w.updatedAt ?? w.finishedAt ?? 0;
}

export function sortWorkouts(ws: Workout[]): Workout[] {
  return ws.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : workoutStamp(b) - workoutStamp(a)));
}

export function mergeStates(local: AppState, remote: AppState): AppState {
  const tombstones: Record<string, number> = { ...(remote.tombstones ?? {}) };
  for (const [id, ts] of Object.entries(local.tombstones ?? {})) tombstones[id] = Math.max(ts, tombstones[id] ?? 0);

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
  return {
    version: 1,
    program: newest.program,
    position: newest.position,
    settings: newest.settings,
    assistance: newest.assistance,
    active: newest.active,
    onboarded: local.onboarded || remote.onboarded,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
    workouts,
    tombstones,
  };
}

/** Cheap structural equality for "did the merge change anything" checks. */
export function sameState(a: AppState, b: AppState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
