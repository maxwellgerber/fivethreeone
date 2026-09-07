// Importer for freeform lifting notes ("Squat 225x5x5", "Deads 135 185 225x5", "5x5x175").
// Dates have no year; years are inferred by walking the (reverse-chronological)
// log and decrementing whenever a date is later than the one before it.

import type { Lift } from './engine.ts';
import type { ExerciseEntry, LoggedSet, Workout } from './model.ts';

export interface ImportWarning {
  line: number;
  text: string;
  message: string;
}

export interface ImportResult {
  workouts: Workout[];
  warnings: ImportWarning[];
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

interface Canon {
  name: string;
  lift?: Lift;
  category?: 'push' | 'pull' | 'single' | 'other';
  bodyweight?: boolean;
}

// Alias table, longest match first. Keys are lowercase, punctuation stripped.
const ALIASES: Array<[RegExp, Canon]> = [
  [/^light squats?/, { name: 'Squat (light)', category: 'other' }],
  [/^trap ?bar dead'?s?/, { name: 'Trap bar deadlift', category: 'other' }],
  [/^trap dead'?s?/, { name: 'Trap bar deadlift', category: 'other' }],
  [/^suitcase dead'?s?/, { name: 'Suitcase deadlift', category: 'single' }],
  [/^(sl ?r?dl|slrdl|rdl|sldl)\b/, { name: 'RDL', category: 'single' }],
  [/^squat'?s?z?\b/, { name: 'Squat', lift: 'squat' }],
  [/^(bench|bench press)\b/, { name: 'Bench', lift: 'bench' }],
  [/^chest press/, { name: 'Chest press (machine)', category: 'push' }],
  [/^db ohp/, { name: 'DB press', category: 'push' }],
  [/^(ohp|press|overhead press)\b/, { name: 'Press', lift: 'press' }],
  [/^(dead'?s?|deadlifts?|dl|deadlift)\b/, { name: 'Deadlift', lift: 'deadlift' }],
  [/^pendlay/, { name: 'Pendlay row', category: 'pull' }],
  [/^db (bent over )?rows?/, { name: 'DB row', category: 'pull' }],
  [/^t ?bar row/, { name: 'T-bar row', category: 'pull' }],
  [/^(bor|bent over rows?|rows?|barbell rows?)\b/, { name: 'Barbell row', category: 'pull' }],
  [/^seated row/, { name: 'Seated row', category: 'pull' }],
  [/^low row/, { name: 'Low row', category: 'pull' }],
  [/^iso lateral high row/, { name: 'High row (machine)', category: 'pull' }],
  [/^(ghr|glute ham raise|ghr machine)/, { name: 'GHR', category: 'single' }],
  [/^(back extensions?|hypers?)/, { name: 'Back extension', category: 'single' }],
  [/^assisted pull ?ups?/, { name: 'Assisted pull-up', category: 'pull', bodyweight: true }],
  [/^(chins?|chin ?ups?)\b/, { name: 'Chin-ups', category: 'pull', bodyweight: true }],
  [/^(pull ?ups?)\b/, { name: 'Pull-ups', category: 'pull', bodyweight: true }],
  [/^dips?\b/, { name: 'Dips', category: 'push', bodyweight: true }],
  [/^bulgarians?/, { name: 'Bulgarian split squat', category: 'single' }],
  [/^split squat/, { name: 'Split squat', category: 'single' }],
  [/^(db |dumbbell |barbell )?lunges?/, { name: 'Lunges', category: 'single' }],
  [/^(ab roll|an roll)/, { name: 'Ab rollout', category: 'single', bodyweight: true }],
  [/^planks?/, { name: 'Plank', category: 'single', bodyweight: true }],
  [/^(lat pull ?downs?|fixed pull ?downs?)/, { name: 'Lat pulldown', category: 'pull' }],
  [/^leg extensions?/, { name: 'Leg extension', category: 'single' }],
  [/^leg press/, { name: 'Leg press', category: 'single' }],
  [/^face pulls?/, { name: 'Face pulls', category: 'pull' }],
  [/^farmers?( carry)?/, { name: "Farmer's carry", category: 'other' }],
  [/^(shoulder )?(ity|iyt|ityt)s?/, { name: 'ITYs', category: 'pull' }],
  [/^tricep push ?downs?/, { name: 'Tricep pushdown', category: 'push' }],
  [/^(hamstring|hammy|posterior chain)/, { name: 'Hamstring curl', category: 'single' }],
  [/^cathy calf/, { name: 'Calf lowers', category: 'single' }],
  [/^glute thing/, { name: 'Glute', category: 'single' }],
  [/^rowing machine|^\d+ min rowing/, { name: 'Rowing machine', category: 'other' }],
  [/^smith|^squat \(/, { name: 'Smith machine', category: 'other' }],
];

function canonicalize(rawName: string, loose = false): Canon | null {
  const n = rawName.toLowerCase().replace(/[’']/g, "'").replace(/[.:\-–!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, canon] of ALIASES) if (re.test(n)) return canon;
  if (loose) {
    for (const [re, canon] of ALIASES) {
      const r = new RegExp(re.source.replace(/^\^/, '(?:^|\\s)'), 'i');
      if (r.test(n)) return canon;
    }
  }
  return null;
}

const KG_TO_LB = 2.20462;

interface Tok {
  kind: 'set' | 'weightOnly' | 'repsOnly' | 'bare' | 'weightCtx' | 'junk';
  weight?: number;
  reps?: number;
  sets?: number;
  bodyweight?: boolean;
  raw: string;
}

function num(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

function tokenize(rest: string): { toks: Tok[]; junk: string[] } {
  // Decimal commas: "107,5x5" -> "107.5x5" (only when not preceded by an 'x' group).
  let s = rest.replace(/(?<![x×]\s*\d*)(\d+),(\d)(?=\s*[x×])/gi, '$1.$2');
  s = s.replace(/×/g, 'x');
  // Split on whitespace and commas.
  const parts = s.split(/[\s,]+/).filter(Boolean);
  const toks: Tok[] = [];
  const junk: string[] = [];
  for (const p of parts) {
    let t = p.replace(/^\(|\)$/g, '');
    let bodyweight = false;
    let kg = false;
    let bwMarker = false; // a bare "bw" / "bw+35": sets the weight context, not a set
    if (/^bw/i.test(t) || /^\+\d/.test(t)) {
      bodyweight = true;
      t = t.replace(/^bw\+?|^\+/i, '');
      if (t === '' || /^x/i.test(t)) t = '0' + t; // "bwx10x4" -> "0x10x4", "bw" -> "0"
      if (/^\d+(\.\d+)?$/.test(t)) bwMarker = true; // "bw", "bw+35"
    }
    // Strip unit suffixes on the weight: "60lbx10x3", "170kgx5x4", "10lbsx12x1"
    t = t.replace(/^(\d+(?:\.\d+)?)(lbs?|kg)(?=x|$)/i, (_m, n: string, u: string) => {
      if (u.toLowerCase() === 'kg') kg = true;
      return n;
    });
    // Strip trailing junk like "ish", "?", "!", "-", ";))"
    t = t.replace(/^([0-9.x]+?)[^0-9.x]*$/i, '$1');
    const m = t.match(/^(\d+(?:\.\d+)?)?x?(\d+(?:\.\d+)?)?x?(\d+(?:\.\d+)?)?$/i);
    if (!m || (!m[1] && !m[2] && !m[3]) || !/\d/.test(t)) {
      junk.push(p);
      continue;
    }
    const conv = (w: number) => (kg ? Math.round(w * KG_TO_LB * 2) / 2 : w);
    const xs = t.split('x');
    if (xs.length === 3 && xs[0] !== '' && xs[1] !== '' && xs[2] !== '') {
      const a = num(xs[0]), b = num(xs[1]), c = num(xs[2]);
      if (a <= 12 && c >= 20 && !bodyweight) {
        // old style: sets x reps x weight
        toks.push({ kind: 'set', weight: conv(c), reps: b, sets: a, raw: p });
      } else {
        toks.push({ kind: 'set', weight: conv(a), reps: b, sets: c, bodyweight, raw: p });
      }
    } else if (xs.length >= 2 && xs[0] !== '' && xs[1] !== '') {
      const a = num(xs[0]), b = num(xs[1]);
      if (a <= 20 && b >= 40 && !bodyweight) {
        toks.push({ kind: 'set', weight: conv(b), reps: a, sets: 1, raw: p });
      } else {
        toks.push({ kind: 'set', weight: conv(a), reps: b, sets: 1, bodyweight, raw: p });
      }
    } else if (xs.length >= 2 && xs[0] !== '' && xs[1] === '') {
      toks.push({ kind: 'weightOnly', weight: conv(num(xs[0])), bodyweight, raw: p });
    } else if (xs.length >= 2 && xs[0] === '' && xs[1] !== '') {
      toks.push({ kind: 'repsOnly', reps: num(xs[1]), raw: p });
    } else if (xs.length === 1 && bwMarker) {
      toks.push({ kind: 'weightCtx', weight: conv(num(xs[0])), bodyweight: true, raw: p });
    } else if (xs.length === 1) {
      toks.push({ kind: 'bare', weight: conv(num(xs[0])), bodyweight, raw: p });
    } else {
      junk.push(p);
    }
  }
  return { toks, junk };
}

function toksToSets(toks: Tok[], canon: Canon | null, warn: (m: string) => void): LoggedSet[] {
  const sets: LoggedSet[] = [];
  const bwEx = !!canon?.bodyweight;
  // "Ab rollout 10x3", "Chins 5x3": a lone reps x sets token on a bodyweight movement.
  if (bwEx && toks.length === 1 && toks[0].kind === 'set' && !toks[0].bodyweight
      && (toks[0].sets ?? 1) === 1 && toks[0].weight! <= 20 && toks[0].reps! <= 5) {
    const t = toks[0];
    toks = [{ kind: 'set', weight: 0, reps: t.weight, sets: t.reps, bodyweight: true, raw: t.raw }];
  }
  let lastWeight: number | null = null;
  let lastBw = false;
  let lastWasRepsBearing = false;
  for (const t of toks) {
    if (t.kind === 'set') {
      if ((t.reps ?? 0) > 30 && (t.sets ?? 1) === 1 && /^\d\d$/.test(String(t.reps))) {
        const d = String(t.reps);
        warn(`"${t.raw}" read as ${t.weight}x${d[0]}x${d[1]}`);
        t.reps = +d[0];
        t.sets = +d[1];
      } else if ((t.reps ?? 0) > 30) warn(`suspicious rep count in "${t.raw}"`);
      for (let i = 0; i < Math.max(1, Math.min(t.sets ?? 1, 20)); i++) {
        sets.push({ weight: t.weight!, reps: t.reps!, bodyweight: t.bodyweight || bwEx || undefined });
      }
      lastWeight = t.weight!;
      lastBw = !!t.bodyweight || bwEx;
      lastWasRepsBearing = true;
    } else if (t.kind === 'weightCtx') {
      lastWeight = t.weight!;
      lastBw = true;
      lastWasRepsBearing = false;
    } else if (t.kind === 'weightOnly') {
      sets.push({ weight: t.weight!, reps: null, bodyweight: t.bodyweight || undefined });
      lastWeight = t.weight!;
      lastBw = !!t.bodyweight || bwEx;
      lastWasRepsBearing = false;
    } else if (t.kind === 'repsOnly') {
      // "x4" after a set, or "x5" after bare weights: applies to the previous set.
      const prev = sets[sets.length - 1];
      if (prev && prev.reps === null) prev.reps = t.reps!;
      else if (lastWeight !== null) sets.push({ weight: lastWeight, reps: t.reps!, bodyweight: lastBw || undefined });
      else warn(`dangling reps token "${t.raw}"`);
    } else if (t.kind === 'bare') {
      const v = t.weight!;
      if (bwEx && lastWeight === null) {
        // "Chins 5x3" handled as set; a bare "8" on a bodyweight exercise = reps
        sets.push({ weight: 0, reps: v, bodyweight: true });
        lastWeight = 0;
        lastBw = true;
        lastWasRepsBearing = true;
      } else if (lastWasRepsBearing && v <= 30 && lastWeight !== null) {
        sets.push({ weight: lastWeight, reps: v, bodyweight: lastBw || undefined });
      } else if (v >= 30 || (lastWeight === null && !bwEx)) {
        sets.push({ weight: v, reps: null, bodyweight: t.bodyweight || undefined });
        lastWeight = v;
        lastBw = !!t.bodyweight || bwEx;
        lastWasRepsBearing = false;
      } else if (lastWeight !== null) {
        sets.push({ weight: lastWeight, reps: v, bodyweight: lastBw || undefined });
      }
    }
  }
  return sets;
}

const DATE_RE = /^\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}|\?)(?:st|nd|rd|th)?\b\s*(.*)$/;

function parseDateLine(line: string): { month: number; day: number | null; note: string } | null {
  const m = line.match(DATE_RE);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  const day = m[2] === '?' ? null : parseInt(m[2], 10);
  if (day !== null && (day < 1 || day > 31)) return null;
  return { month: mon, day, note: m[3].trim() };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function parseNotes(text: string, opts: { today?: Date; startYear?: number } = {}): ImportResult {
  const today = opts.today ?? new Date();
  const lines = text.split(/\r?\n/);
  const warnings: ImportWarning[] = [];
  const workouts: Workout[] = [];
  let cur: Workout | null = null;
  let year = opts.startYear ?? today.getFullYear();
  let prev: { month: number; day: number } | null = null;
  let prevBlank = false;
  let seq = 0;

  const newWorkout = (date: string, uncertain: boolean, raw: string): Workout => {
    const w: Workout = { id: `imp-${date}-${seq++}`, date, entries: [], source: 'import', raw, dateUncertain: uncertain || undefined };
    workouts.push(w);
    return w;
  };

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/ /g, ' ').trim();
    if (line === '' || /^[—–-]+$/.test(line)) {
      prevBlank = true;
      return;
    }
    const dl = parseDateLine(line);
    if (dl && !canonicalize(line)) {
      let day = dl.day;
      let uncertain = false;
      if (day === null) {
        day = 15;
        uncertain = true;
        warnings.push({ line: lineNo, text: line, message: 'unknown day; assumed the 15th' });
      }
      if (prev) {
        const later = dl.month > prev.month || (dl.month === prev.month && day > prev.day);
        if (later) year -= 1;
      } else {
        // First date: if it is in the future relative to today, it belongs to last year.
        const cand = new Date(year, dl.month, day);
        if (cand.getTime() > today.getTime() + 86400e3) year -= 1;
      }
      if (dl.month === 1 && day === 29 && !isLeap(year)) {
        warnings.push({ line: lineNo, text: line, message: `Feb 29 in non-leap year ${year}; year inference may be off` });
      }
      prev = { month: dl.month, day };
      cur = newWorkout(iso(year, dl.month, day), uncertain, rawLine);
      if (dl.note) cur.notes = dl.note;
      prevBlank = false;
      return;
    }

    // Exercise or commentary line.
    const nameMatch = line.match(/^([A-Za-z][A-Za-z’'\-\s()!?,.]*?)(?=\s*[\(\d]|\s+bw|\s*$)/i);
    const rawName = nameMatch ? nameMatch[1].trim() : '';
    const rest = line.slice(rawName.length).trim();
    const { toks, junk } = tokenize(rest);
    // Only tokens with an "x" (or a bw marker) are unambiguous set notation.
    const hasSets = toks.some((t) => t.kind === 'set' || t.kind === 'weightOnly' || t.kind === 'repsOnly');
    let canon = canonicalize(rawName, hasSets);
    // "Deads felt like nice warmup volume..." — a sentence, not a log line.
    if (canon && !hasSets && rawName.split(/\s+/).length > 4) canon = null;

    if (!canon && !hasSets) {
      // Commentary.
      if (cur) cur.notes = cur.notes ? `${cur.notes}\n${line}` : line;
      else warnings.push({ line: lineNo, text: line, message: 'text before any date; ignored' });
      prevBlank = false;
      return;
    }
    if (!cur) {
      warnings.push({ line: lineNo, text: line, message: 'exercise before any date; ignored' });
      return;
    }
    if (!canon) {
      warnings.push({ line: lineNo, text: line, message: rawName ? `unrecognized exercise "${rawName}"; kept as-is` : 'sets with no exercise name; logged as "Unknown"' });
    }
    if (/\+bar|\?\?\)/.test(line)) {
      warnings.push({ line: lineNo, text: line, message: 'unknown bar weight; sets skipped' });
      cur.notes = cur.notes ? `${cur.notes}\n${line}` : line;
      return;
    }
    // Same lift appearing again after a blank line => probably an undated second session.
    const lift = canon?.lift;
    if (prevBlank && lift && cur.entries.some((e) => e.lift === lift)) {
      warnings.push({ line: lineNo, text: line, message: 'repeated lift after a gap; split into a second workout with the same (uncertain) date' });
      cur = newWorkout(cur.date, true, rawLine);
    }
    const sets = toksToSets(toks, canon, (m) => warnings.push({ line: lineNo, text: line, message: m }));
    const note = junk.filter((j) => !/^[.\-–—:;!?]+$/.test(j)).join(' ');
    const entry: ExerciseEntry = {
      name: canon?.name ?? (rawName || 'Unknown'),
      lift,
      category: canon?.category ?? (lift ? undefined : 'other'),
      sets,
    };
    if (note) entry.note = note;
    cur.entries.push(entry);
    cur.raw = cur.raw ? `${cur.raw}\n${rawLine}` : rawLine;
    prevBlank = false;
  });

  return { workouts, warnings };
}
