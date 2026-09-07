import type { Lift, Position, ProgramConfig, SetKind } from './engine.ts';

export type LoggedSetKind = SetKind | 'assistance' | 'other';

export interface LoggedSet {
  weight: number; // in program units; 0 for bodyweight
  reps: number | null; // null = unknown (imported "135x")
  kind?: LoggedSetKind;
  /** Planned target reps (for AMRAP/PR sets and TM tests). */
  target?: number;
  amrap?: boolean;
  /** Weight is in addition to bodyweight (dips, chins). */
  bodyweight?: boolean;
  done?: boolean;
  skipped?: boolean;
  pct?: number;
  minReps?: number;
}

export interface ExerciseEntry {
  name: string;
  lift?: Lift;
  category?: 'push' | 'pull' | 'single' | 'other';
  sets: LoggedSet[];
  note?: string;
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD (local)
  position?: Position;
  title?: string;
  entries: ExerciseEntry[];
  notes?: string;
  source?: 'app' | 'import';
  raw?: string;
  dateUncertain?: boolean;
  /** Epoch ms when the workout was finished in the app. */
  finishedAt?: number;
  startedAt?: number;
}

export interface AssistanceExercise {
  name: string;
  category: 'push' | 'pull' | 'single';
}

export interface Settings {
  timerMain: number; // seconds
  timerSupp: number;
  timerAssist: number;
  sound: boolean;
  vibrate: boolean;
  keepAwake: boolean;
  plates: number[];
}

export interface AppState {
  version: 1;
  program: ProgramConfig;
  position: Position;
  workouts: Workout[];
  active: Workout | null;
  settings: Settings;
  assistance: AssistanceExercise[];
  onboarded: boolean;
}

export function defaultSettings(units: 'lb' | 'kg'): Settings {
  return {
    timerMain: 180,
    timerSupp: 90,
    timerAssist: 60,
    sound: true,
    vibrate: true,
    keepAwake: true,
    plates: units === 'lb' ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25],
  };
}

export function defaultAssistance(): AssistanceExercise[] {
  return [
    { name: 'Dips', category: 'push' },
    { name: 'Push-ups', category: 'push' },
    { name: 'Chin-ups', category: 'pull' },
    { name: 'Pendlay row', category: 'pull' },
    { name: 'Face pulls', category: 'pull' },
    { name: 'Bulgarian split squat', category: 'single' },
    { name: 'Lunges', category: 'single' },
    { name: 'Ab rollout', category: 'single' },
    { name: 'GHR', category: 'single' },
    { name: 'Back extension', category: 'single' },
  ];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
