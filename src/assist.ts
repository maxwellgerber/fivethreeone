// Assistance suggestions for today's session.
//
// Two signals, blended:
// 1. What you did last time on this same day of the split (same main lifts).
// 2. What complements today's main lifts, per 5/3/1 Forever's push / pull /
//    single-leg-or-core rule: press and bench days lean on pulling and single-leg
//    work, squat and deadlift days lean on pushing and core, and every day gets
//    one of each category.
// History supplies the concrete weight and reps to start from.
import type { Lift } from './engine.ts';
import type { AppState, ExerciseEntry, LoggedSet, Workout } from './model.ts';

export type Category = 'push' | 'pull' | 'single';

export interface Suggestion {
  name: string;
  category: Category;
  /** Why it's suggested, for the UI ("last time on Day A", "pairs with Bench"). */
  reason: 'lastTime' | 'pairs' | 'balance';
  /** Most recent set of this exercise anywhere in history, to prefill. */
  last?: LoggedSet;
  lastDate?: string;
}

/** Exercises that pair well with each main lift (opposite pattern or supporting muscles). */
const PAIRS: Record<Lift, Array<{ name: string; category: Category }>> = {
  bench: [
    { name: 'Chin-ups', category: 'pull' },
    { name: 'Barbell row', category: 'pull' },
    { name: 'Face pulls', category: 'pull' },
    { name: 'Lunges', category: 'single' },
  ],
  press: [
    { name: 'Pull-ups', category: 'pull' },
    { name: 'Lat pulldown', category: 'pull' },
    { name: 'Dips', category: 'push' },
    { name: 'Split squat', category: 'single' },
  ],
  squat: [
    { name: 'Dips', category: 'push' },
    { name: 'Push-ups', category: 'push' },
    { name: 'Ab rollout', category: 'single' },
    { name: 'Back extension', category: 'single' },
  ],
  deadlift: [
    { name: 'Push-ups', category: 'push' },
    { name: 'Dips', category: 'push' },
    { name: 'Ab rollout', category: 'single' },
    { name: 'GHR', category: 'single' },
  ],
};

const key = (name: string) => name.trim().toLowerCase();

function liftsOf(w: Workout): string {
  return w.entries.filter((e) => e.lift).map((e) => e.lift).sort().join('+');
}

function assistanceEntries(w: Workout): ExerciseEntry[] {
  return w.entries.filter((e) => !e.lift && e.category && e.category !== 'other' && e.sets.some((s) => s.reps));
}

/** Most recent logged set per exercise name, scanning newest-first history. */
function lastSets(workouts: Workout[]): Map<string, { set: LoggedSet; date: string; category: Category; name: string }> {
  const out = new Map<string, { set: LoggedSet; date: string; category: Category; name: string }>();
  for (const w of workouts) {
    for (const e of assistanceEntries(w)) {
      const k = key(e.name);
      if (out.has(k)) continue;
      const set = [...e.sets].reverse().find((s) => s.reps && !s.skipped);
      if (set) out.set(k, { set, date: w.date, category: e.category as Category, name: e.name });
    }
  }
  return out;
}

/**
 * Suggest assistance for a session with the given main lifts. `exclude` are names
 * already in today's workout. Workouts must be sorted newest first.
 */
export function suggestAssistance(state: Pick<AppState, 'workouts' | 'assistance'>, lifts: Lift[], exclude: string[] = [], limit = 6): Suggestion[] {
  const excluded = new Set(exclude.map(key));
  const last = lastSets(state.workouts);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (name: string, category: Category, reason: Suggestion['reason']) => {
    const k = key(name);
    if (seen.has(k) || excluded.has(k)) return;
    seen.add(k);
    const l = last.get(k);
    out.push({ name: l?.name ?? name, category: l?.category ?? category, reason, last: l?.set, lastDate: l?.date });
  };

  // 1. Same day of the split, last time.
  const want = [...lifts].sort().join('+');
  const prev = want ? state.workouts.find((w) => w.finishedAt !== undefined || w.source !== 'app' ? liftsOf(w) === want && assistanceEntries(w).length > 0 : false) : undefined;
  if (prev) for (const e of assistanceEntries(prev)) add(e.name, e.category as Category, 'lastTime');

  // 2. Complements of today's lifts.
  for (const l of lifts) for (const p of PAIRS[l] ?? []) add(p.name, p.category, 'pairs');

  // 3. Fill any category still missing from the user's own list, preferring things done recently.
  const have = new Set(out.map((s) => s.category));
  for (const c of ['push', 'pull', 'single'] as Category[]) {
    if (have.has(c)) continue;
    const recent = [...last.values()].filter((x) => x.category === c && !excluded.has(key(x.name))).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (recent) add(recent.name, c, 'balance');
    else {
      const fallback = state.assistance.find((a) => a.category === c && !excluded.has(key(a.name)));
      if (fallback) add(fallback.name, c, 'balance');
    }
  }

  // Keep at least one of each category in the visible slice.
  const byCat: Record<Category, Suggestion[]> = { push: [], pull: [], single: [] };
  for (const s of out) byCat[s.category].push(s);
  const picked: Suggestion[] = [];
  for (const c of ['push', 'pull', 'single'] as Category[]) if (byCat[c][0]) picked.push(byCat[c][0]);
  for (const s of out) if (picked.length < limit && !picked.includes(s)) picked.push(s);
  return picked.sort((a, b) => out.indexOf(a) - out.indexOf(b));
}
