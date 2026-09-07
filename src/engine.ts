// 5/3/1 Forever program engine. Pure functions, no DOM.

export type Lift = 'squat' | 'bench' | 'deadlift' | 'press';
export const LIFTS: Lift[] = ['squat', 'bench', 'deadlift', 'press'];
export const LIFT_NAMES: Record<Lift, string> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  press: 'Press',
};

export type Units = 'lb' | 'kg';

export type MainScheme = '5sPro' | 'prSets';
export type SupplementalType = 'none' | 'FSL' | 'SSL' | 'BBB';
export type PhaseKind = 'leader' | 'anchor' | 'seventh';
export type SeventhKind = 'deload' | 'tmTest';
export type SetKind = 'warmup' | 'main' | 'supplemental' | 'tmTest' | 'joker';

export interface Supplemental {
  type: SupplementalType;
  sets: number;
  reps: number;
  /** Fixed percentage of TM for BBB. Ignored for FSL/SSL (which follow the week). */
  pct?: number;
}

export interface Phase {
  kind: PhaseKind;
  /** Number of 3-week cycles in this phase (leader/anchor). Seventh weeks are 1 week. */
  cycles: number;
  mainScheme: MainScheme;
  supplemental: Supplemental;
  seventh?: SeventhKind;
  jokers?: boolean;
  /** Assistance rep targets per category (per session). */
  assistance: { push: number; pull: number; single: number };
  label?: string;
}

export interface DayTemplate {
  lifts: Lift[];
}

export interface ProgramConfig {
  units: Units;
  /** Round working weights to this increment (e.g. 5 lb / 2.5 kg). */
  roundTo: number;
  roundMode: 'nearest' | 'down';
  barWeight: number;
  tms: Record<Lift, number>;
  increments: Record<Lift, number>;
  days: DayTemplate[];
  phases: Phase[];
  warmup: boolean;
}

export interface Position {
  phase: number; // index into phases
  cycle: number; // 0-based cycle within phase
  week: number; // 0-based week within cycle (0..2), or 0 for seventh weeks
  day: number; // index into days
}

export interface PlannedSet {
  kind: SetKind;
  pct: number;
  weight: number;
  reps: number;
  amrap: boolean;
  /** For TM tests: the minimum reps that count as a pass. */
  minReps?: number;
}

export interface PlannedLift {
  lift: Lift;
  tm: number;
  sets: PlannedSet[];
}

export interface PlannedWorkout {
  position: Position;
  title: string;
  subtitle: string;
  lifts: PlannedLift[];
  assistance: { push: number; pull: number; single: number };
  isSeventh: boolean;
}

// ---- Percent tables ---------------------------------------------------------

export const WEEK_PCTS: number[][] = [
  [0.65, 0.75, 0.85],
  [0.70, 0.80, 0.90],
  [0.75, 0.85, 0.95],
];
export const PR_REPS: number[][] = [
  [5, 5, 5],
  [3, 3, 3],
  [5, 3, 1],
];
export const WARMUP: Array<[number, number]> = [
  [0.4, 5],
  [0.5, 5],
  [0.6, 3],
];
export const SEVENTH_PCTS: Array<[number, number]> = [
  [0.7, 5],
  [0.8, 5],
  [0.9, 5],
];

// ---- Math -------------------------------------------------------------------

export function roundWeight(w: number, roundTo: number, mode: 'nearest' | 'down' = 'nearest'): number {
  if (roundTo <= 0) return w;
  const q = w / roundTo;
  const r = mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return +(r * roundTo).toFixed(3);
}

/** Wendler's estimated 1RM: weight * reps * 0.0333 + weight. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * reps * 0.0333 + weight;
}

/** Suggest a training max from a rep set at the given fraction (default 90%). */
export function suggestTm(weight: number, reps: number, fraction = 0.9, roundTo = 5): number {
  return roundWeight(e1rm(weight, reps) * fraction, roundTo, 'down');
}

/** Plates per side for a target weight. Returns [] if bar alone or unreachable. */
export function platesPerSide(weight: number, bar: number, plates: number[]): number[] {
  let rem = (weight - bar) / 2;
  if (rem <= 0) return [];
  const out: number[] = [];
  const sorted = [...plates].sort((a, b) => b - a);
  for (const p of sorted) {
    while (rem >= p - 1e-9) {
      out.push(p);
      rem -= p;
    }
  }
  return out;
}

// ---- Position navigation ----------------------------------------------------

export function phaseWeeks(p: Phase): number {
  return p.kind === 'seventh' ? 1 : p.cycles * 3;
}

export function totalWeeks(cfg: ProgramConfig): number {
  return cfg.phases.reduce((n, p) => n + phaseWeeks(p), 0);
}

/** Flat week index across the whole program (0-based). */
export function flatWeek(cfg: ProgramConfig, pos: Position): number {
  let n = 0;
  for (let i = 0; i < pos.phase; i++) n += phaseWeeks(cfg.phases[i]);
  return n + pos.cycle * 3 + pos.week;
}

export function positionFromFlatWeek(cfg: ProgramConfig, fw: number, day = 0): Position {
  let rem = fw;
  for (let i = 0; i < cfg.phases.length; i++) {
    const w = phaseWeeks(cfg.phases[i]);
    if (rem < w) {
      const p = cfg.phases[i];
      if (p.kind === 'seventh') return { phase: i, cycle: 0, week: 0, day };
      return { phase: i, cycle: Math.floor(rem / 3), week: rem % 3, day };
    }
    rem -= w;
  }
  // Past the end: wrap to the start (a new macro-cycle).
  return { phase: 0, cycle: 0, week: 0, day };
}

/**
 * Advance to the next session. Returns the new position and whether the
 * program wrapped around (completed a full macro-cycle).
 */
export function nextPosition(cfg: ProgramConfig, pos: Position): { pos: Position; wrapped: boolean; cycleCompleted: boolean } {
  const nDays = Math.max(1, cfg.days.length);
  if (pos.day + 1 < nDays) {
    return { pos: { ...pos, day: pos.day + 1 }, wrapped: false, cycleCompleted: false };
  }
  const fw = flatWeek(cfg, pos) + 1;
  const total = totalWeeks(cfg);
  const wrapped = fw >= total;
  const next = positionFromFlatWeek(cfg, wrapped ? 0 : fw, 0);
  const cur = cfg.phases[pos.phase];
  // A cycle completes when we leave the 3rd week of a leader/anchor cycle.
  const cycleCompleted = cur.kind !== 'seventh' && pos.week === 2;
  return { pos: next, wrapped, cycleCompleted };
}

export function prevPosition(cfg: ProgramConfig, pos: Position): Position {
  if (pos.day > 0) return { ...pos, day: pos.day - 1 };
  const fw = flatWeek(cfg, pos) - 1;
  if (fw < 0) return pos;
  return positionFromFlatWeek(cfg, fw, Math.max(0, cfg.days.length - 1));
}

// ---- Planning ---------------------------------------------------------------

function mainSets(scheme: MainScheme, week: number, tm: number, cfg: ProgramConfig): PlannedSet[] {
  const pcts = WEEK_PCTS[week];
  return pcts.map((pct, i) => {
    const last = i === pcts.length - 1;
    const reps = scheme === '5sPro' ? 5 : PR_REPS[week][i];
    return {
      kind: 'main',
      pct,
      weight: roundWeight(tm * pct, cfg.roundTo, cfg.roundMode),
      reps,
      amrap: scheme === 'prSets' && last,
    };
  });
}

function supplementalSets(sup: Supplemental, week: number, tm: number, cfg: ProgramConfig): PlannedSet[] {
  if (sup.type === 'none' || sup.sets <= 0) return [];
  let pct: number;
  switch (sup.type) {
    case 'FSL':
      pct = WEEK_PCTS[week][0];
      break;
    case 'SSL':
      pct = WEEK_PCTS[week][1];
      break;
    case 'BBB':
      pct = sup.pct ?? 0.5;
      break;
    default:
      pct = 0.5;
  }
  const weight = roundWeight(tm * pct, cfg.roundTo, cfg.roundMode);
  return Array.from({ length: sup.sets }, () => ({
    kind: 'supplemental' as SetKind,
    pct,
    weight,
    reps: sup.reps,
    amrap: false,
  }));
}

function warmupSets(tm: number, cfg: ProgramConfig): PlannedSet[] {
  if (!cfg.warmup) return [];
  return WARMUP.map(([pct, reps]) => ({
    kind: 'warmup' as SetKind,
    pct,
    weight: Math.max(cfg.barWeight, roundWeight(tm * pct, cfg.roundTo, cfg.roundMode)),
    reps,
    amrap: false,
  }));
}

function seventhSets(kind: SeventhKind, tm: number, cfg: ProgramConfig): PlannedSet[] {
  const sets: PlannedSet[] = SEVENTH_PCTS.map(([pct, reps]) => ({
    kind: 'main' as SetKind,
    pct,
    weight: roundWeight(tm * pct, cfg.roundTo, cfg.roundMode),
    reps,
    amrap: false,
  }));
  if (kind === 'tmTest') {
    sets.push({
      kind: 'tmTest',
      pct: 1,
      weight: roundWeight(tm, cfg.roundTo, cfg.roundMode),
      reps: 5,
      amrap: true,
      minReps: 3,
    });
  }
  return sets;
}

export function planLift(cfg: ProgramConfig, pos: Position, lift: Lift): PlannedLift {
  const phase = cfg.phases[pos.phase];
  const tm = cfg.tms[lift];
  let sets: PlannedSet[] = warmupSets(tm, cfg);
  if (phase.kind === 'seventh') {
    sets = sets.concat(seventhSets(phase.seventh ?? 'deload', tm, cfg));
  } else {
    sets = sets.concat(mainSets(phase.mainScheme, pos.week, tm, cfg));
    sets = sets.concat(supplementalSets(phase.supplemental, pos.week, tm, cfg));
  }
  return { lift, tm, sets };
}

/**
 * Joker sets (5/3/1 Forever): after a strong PR set, optional heavier singles/triples/fives
 * in 5% jumps above the week's top percentage, same reps as the top set. `n` is 1-based.
 */
export const JOKER_STEP = 0.05;
export function jokerSet(cfg: ProgramConfig, pos: Position, lift: Lift, n: number): PlannedSet {
  const top = WEEK_PCTS[pos.week][WEEK_PCTS[pos.week].length - 1];
  const pct = +(top + JOKER_STEP * n).toFixed(4);
  return {
    kind: 'joker',
    pct,
    weight: roundWeight(cfg.tms[lift] * pct, cfg.roundTo, cfg.roundMode),
    reps: PR_REPS[pos.week][PR_REPS[pos.week].length - 1],
    amrap: false,
  };
}

/** Whether the phase at `pos` allows joker sets. */
export function jokersAllowed(cfg: ProgramConfig, pos: Position): boolean {
  const phase = cfg.phases[pos.phase];
  return !!phase && phase.kind !== 'seventh' && !!phase.jokers && phase.mainScheme === 'prSets';
}

export function phaseLabel(p: Phase): string {
  if (p.label) return p.label;
  if (p.kind === 'seventh') return p.seventh === 'tmTest' ? '7th Week · TM Test' : '7th Week · Deload';
  const scheme = p.mainScheme === '5sPro' ? '5s PRO' : 'PR sets';
  const sup =
    p.supplemental.type === 'none'
      ? ''
      : ` + ${p.supplemental.type} ${p.supplemental.sets}×${p.supplemental.reps}`;
  return `${p.kind === 'leader' ? 'Leader' : 'Anchor'} · ${scheme}${sup}`;
}

export function planWorkout(cfg: ProgramConfig, pos: Position): PlannedWorkout {
  const phase = cfg.phases[pos.phase];
  const day = cfg.days[pos.day] ?? { lifts: [] };
  const lifts = day.lifts.map((l) => planLift(cfg, pos, l));
  const dayName = String.fromCharCode(65 + pos.day);
  const isSeventh = phase.kind === 'seventh';
  const liftNames = day.lifts.map((l) => LIFT_NAMES[l]).join(' + ');
  const title = isSeventh ? phaseLabel(phase) : `Week ${pos.week + 1} · Day ${dayName}`;
  const subtitle = isSeventh
    ? `Day ${dayName} · ${liftNames}`
    : `${phaseLabel(phase)}${phase.cycles > 1 ? ` · cycle ${pos.cycle + 1} of ${phase.cycles}` : ''} · ${liftNames}`;
  return { position: pos, title, subtitle, lifts, assistance: phase.assistance, isSeventh };
}

/** Apply per-cycle TM increments. */
export function bumpTms(cfg: ProgramConfig): Record<Lift, number> {
  const out = { ...cfg.tms };
  for (const l of LIFTS) out[l] = +(out[l] + cfg.increments[l]).toFixed(2);
  return out;
}

// ---- Defaults ---------------------------------------------------------------

/** Plain 5/3/1: PR sets + FSL 5x5, every cycle, repeating. */
export function simplePhases(): Phase[] {
  return [
    {
      kind: 'anchor',
      cycles: 1,
      mainScheme: 'prSets',
      supplemental: { type: 'FSL', sets: 5, reps: 5 },
      assistance: { push: 50, pull: 50, single: 50 },
      label: '5/3/1 · PR sets + FSL 5×5',
    },
  ];
}

/** 5/3/1 Forever: two leaders, deload, anchor, TM test. */
export function foreverPhases(): Phase[] {
  return [
    {
      kind: 'leader',
      cycles: 2,
      mainScheme: '5sPro',
      supplemental: { type: 'FSL', sets: 5, reps: 5 },
      assistance: { push: 50, pull: 50, single: 50 },
    },
    { kind: 'seventh', cycles: 1, mainScheme: '5sPro', supplemental: { type: 'none', sets: 0, reps: 0 }, seventh: 'deload', assistance: { push: 0, pull: 0, single: 0 } },
    {
      kind: 'anchor',
      cycles: 1,
      mainScheme: 'prSets',
      supplemental: { type: 'FSL', sets: 5, reps: 5 },
      jokers: true,
      assistance: { push: 75, pull: 75, single: 75 },
    },
    { kind: 'seventh', cycles: 1, mainScheme: '5sPro', supplemental: { type: 'none', sets: 0, reps: 0 }, seventh: 'tmTest', assistance: { push: 0, pull: 0, single: 0 } },
  ];
}

export function defaultPhases(): Phase[] {
  return simplePhases();
}

export function defaultProgram(units: Units = 'lb'): ProgramConfig {
  const lb = units === 'lb';
  return {
    units,
    roundTo: lb ? 5 : 2.5,
    roundMode: 'nearest',
    barWeight: lb ? 45 : 20,
    tms: lb
      ? { squat: 265, bench: 195, deadlift: 365, press: 125 }
      : { squat: 120, bench: 90, deadlift: 165, press: 55 },
    increments: lb
      ? { squat: 10, bench: 5, deadlift: 10, press: 5 }
      : { squat: 5, bench: 2.5, deadlift: 5, press: 2.5 },
    days: [{ lifts: ['squat', 'bench'] }, { lifts: ['deadlift', 'press'] }],
    phases: defaultPhases(),
    warmup: true,
  };
}
