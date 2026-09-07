// Workout <-> notebook text ("Squat 225x5, 175x5x5"). The parser lives in notesImport.ts.
import { e1rm, type Lift } from './engine.ts';
import type { LoggedSet, Workout } from './model.ts';
import { fmtW } from './format.ts';

export function setStr(s: LoggedSet): string {
  if (s.skipped) return '—';
  const w = s.bodyweight ? (s.weight ? `BW+${fmtW(s.weight)}` : 'BW') : fmtW(s.weight);
  return `${w}×${s.reps ?? '?'}`;
}

/** Compress a list of sets into "225×5, 175×5×5" notation. */
export function compressSets(sets: LoggedSet[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i];
    let n = 1;
    while (i + n < sets.length && sets[i + n].weight === s.weight && sets[i + n].reps === s.reps && !!sets[i + n].bodyweight === !!s.bodyweight && !sets[i + n].skipped && !s.skipped) n++;
    out.push(n > 1 ? `${setStr(s)}×${n}` : setStr(s));
    i += n;
  }
  return out.join(', ');
}

export function workoutToText(w: Workout): string {
  return w.entries
    .map((e) => {
      const sets = e.sets.filter((s) => !s.skipped);
      return `${e.name} ${compressSets(sets).replace(/×/g, 'x')}${e.note ? ` (${e.note})` : ''}`.trim();
    })
    .join('\n');
}

/** Highest-e1RM set of a lift within a workout. */
export function topSet(w: Workout, lift: Lift): LoggedSet | null {
  let best: LoggedSet | null = null;
  for (const e of w.entries) if (e.lift === lift) for (const s of e.sets) {
    if (!s.reps || s.skipped) continue;
    if (!best || e1rm(s.weight, s.reps) > e1rm(best.weight, best.reps!)) best = s;
  }
  return best;
}

/** One-line summary for history lists: "Squat 315×5 · Bench 225×3". */
export function workoutSummary(w: Workout): string {
  const mains = w.entries.filter((e) => e.lift);
  if (mains.length) {
    return mains.map((e) => {
      let best: LoggedSet | null = null;
      for (const s of e.sets) if (s.reps && !s.skipped && (!best || e1rm(s.weight, s.reps) > e1rm(best.weight, best.reps!))) best = s;
      return best ? `${e.name} ${fmtW(best.weight)}×${best.reps}` : e.name;
    }).join(' · ');
  }
  return w.entries.map((e) => e.name).join(' · ') || (w.notes ?? 'Notes');
}
