import { e1rm, LIFTS, type Lift } from './engine.ts';
import type { LoggedSet, Workout } from './model.ts';

export interface BestSet {
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function validSets(w: Workout, lift: Lift): LoggedSet[] {
  const out: LoggedSet[] = [];
  for (const e of w.entries) {
    if (e.lift !== lift) continue;
    for (const s of e.sets) if (s.reps && s.reps > 0 && s.weight > 0 && !s.skipped && (s.done ?? true)) out.push(s);
  }
  return out;
}

/** Best e1RM set per lift within the last `withinDays` days (all time if omitted). */
export function bestE1rmPerLift(workouts: Workout[], withinDays?: number): Partial<Record<Lift, BestSet>> {
  const cutoff = withinDays ? daysAgo(withinDays) : '0000-00-00';
  const out: Partial<Record<Lift, BestSet>> = {};
  for (const w of workouts) {
    if (w.date < cutoff) continue;
    for (const l of LIFTS) {
      for (const s of validSets(w, l)) {
        const v = e1rm(s.weight, s.reps!);
        if (!out[l] || v > out[l]!.e1rm) out[l] = { date: w.date, weight: s.weight, reps: s.reps!, e1rm: v };
      }
    }
  }
  return out;
}

/** Per-workout best e1RM for a lift, oldest first, for charting. */
export function e1rmSeries(workouts: Workout[], lift: Lift): BestSet[] {
  const pts: BestSet[] = [];
  for (const w of workouts) {
    let best: BestSet | null = null;
    for (const s of validSets(w, lift)) {
      const v = e1rm(s.weight, s.reps!);
      if (!best || v > best.e1rm) best = { date: w.date, weight: s.weight, reps: s.reps!, e1rm: v };
    }
    if (best) pts.push(best);
  }
  return pts.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Rep PRs: for each rep count 1..12, the heaviest weight ever done for that many reps. */
export function repPrs(workouts: Workout[], lift: Lift): Array<{ reps: number; weight: number; date: string }> {
  const best = new Map<number, { weight: number; date: string }>();
  for (const w of workouts) {
    for (const s of validSets(w, lift)) {
      const r = Math.min(s.reps!, 12);
      // A set of N reps also counts as a set of every count below N at that weight.
      for (let k = 1; k <= r; k++) {
        const cur = best.get(k);
        if (!cur || s.weight > cur.weight) best.set(k, { weight: s.weight, date: w.date });
      }
    }
  }
  return [...best.entries()].map(([reps, v]) => ({ reps, ...v })).sort((a, b) => a.reps - b.reps);
}

/** Would this set be a rep PR (heavier than any previous set at >= these reps)? */
export function isRepPr(workouts: Workout[], lift: Lift, weight: number, reps: number, excludeId?: string): boolean {
  if (reps <= 0 || weight <= 0) return false;
  for (const w of workouts) {
    if (w.id === excludeId) continue;
    for (const s of validSets(w, lift)) if (s.reps! >= reps && s.weight >= weight) return false;
  }
  return true;
}

export function weeklyTonnage(workouts: Workout[], weeks = 12): Array<{ week: string; tonnage: number; sets: number }> {
  const out = new Map<string, { tonnage: number; sets: number }>();
  const cutoff = daysAgo(weeks * 7);
  for (const w of workouts) {
    if (w.date < cutoff) continue;
    const d = new Date(w.date + 'T00:00:00');
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const cur = out.get(key) ?? { tonnage: 0, sets: 0 };
    for (const e of w.entries) for (const s of e.sets) {
      if (s.reps && s.weight > 0 && !s.skipped && (s.done ?? true)) {
        cur.tonnage += s.weight * s.reps;
        cur.sets += 1;
      }
    }
    out.set(key, cur);
  }
  return [...out.entries()].map(([week, v]) => ({ week, ...v })).sort((a, b) => (a.week < b.week ? -1 : 1));
}

export function lastSessionFor(workouts: Workout[], lift: Lift): Workout | undefined {
  return workouts.find((w) => w.entries.some((e) => e.lift === lift && e.sets.some((s) => s.reps)));
}
