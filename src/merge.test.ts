import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates } from './merge.ts';
import { defaultAssistance, defaultSettings, type AppState, type Workout } from './model.ts';
import { defaultProgram } from './engine.ts';

function base(over: Partial<AppState> = {}): AppState {
  return {
    version: 1,
    program: defaultProgram('lb'),
    position: { phase: 0, cycle: 0, week: 0, day: 0 },
    workouts: [],
    active: null,
    settings: defaultSettings('lb'),
    assistance: defaultAssistance(),
    onboarded: true,
    ...over,
  };
}
function w(id: string, date: string, over: Partial<Workout> = {}): Workout {
  return { id, date, entries: [{ name: 'Squat', lift: 'squat', sets: [{ weight: 225, reps: 5 }] }], ...over };
}

test('union of workouts by id, sorted newest first', () => {
  const m = mergeStates(base({ workouts: [w('a', '2026-09-01')] }), base({ workouts: [w('b', '2026-09-03'), w('a', '2026-09-01')] }));
  assert.deepEqual(m.workouts.map((x) => x.id), ['b', 'a']);
});

test('newer updatedAt wins for the same workout id; ties keep local', () => {
  const local = base({ workouts: [w('a', '2026-09-01', { updatedAt: 200, notes: 'local' })] });
  const remote = base({ workouts: [w('a', '2026-09-01', { updatedAt: 100, notes: 'remote' })] });
  assert.equal(mergeStates(local, remote).workouts[0].notes, 'local');
  assert.equal(mergeStates(remote, local).workouts[0].notes, 'local');
  const tieL = base({ workouts: [w('a', '2026-09-01', { updatedAt: 100, notes: 'L' })] });
  const tieR = base({ workouts: [w('a', '2026-09-01', { updatedAt: 100, notes: 'R' })] });
  assert.equal(mergeStates(tieL, tieR).workouts[0].notes, 'L');
});

test('finishedAt is used as a stamp when updatedAt is absent', () => {
  const local = base({ workouts: [w('a', '2026-09-01', { finishedAt: 50, notes: 'old' })] });
  const remote = base({ workouts: [w('a', '2026-09-01', { updatedAt: 60, notes: 'edited' })] });
  assert.equal(mergeStates(local, remote).workouts[0].notes, 'edited');
});

test('tombstones remove workouts on the other side and are kept', () => {
  const local = base({ tombstones: { a: 500 } });
  const remote = base({ workouts: [w('a', '2026-09-01', { updatedAt: 100 }), w('b', '2026-09-02')] });
  const m = mergeStates(local, remote);
  assert.deepEqual(m.workouts.map((x) => x.id), ['b']);
  assert.deepEqual(m.tombstones, { a: 500 });
});

test('an edit after the tombstone resurrects the workout and clears the tombstone', () => {
  const local = base({ tombstones: { a: 500 } });
  const remote = base({ workouts: [w('a', '2026-09-01', { updatedAt: 600 })] });
  const m = mergeStates(local, remote);
  assert.deepEqual(m.workouts.map((x) => x.id), ['a']);
  assert.deepEqual(m.tombstones, {});
});

test('program, position, settings and active follow the newer snapshot', () => {
  const local = base({ updatedAt: 10 });
  local.program.tms.squat = 300;
  local.position = { phase: 0, cycle: 0, week: 1, day: 1 };
  const remote = base({ updatedAt: 20, active: w('act', '2026-09-05') });
  remote.program.tms.squat = 315;
  remote.settings.timerMain = 120;
  const m = mergeStates(local, remote);
  assert.equal(m.program.tms.squat, 315);
  assert.equal(m.settings.timerMain, 120);
  assert.equal(m.position.week, 0);
  assert.equal(m.active?.id, 'act');
  assert.equal(m.updatedAt, 20);
  const m2 = mergeStates(remote, local);
  assert.equal(m2.program.tms.squat, 315);
});

test('merge is idempotent and commutative on workouts', () => {
  const a = base({ updatedAt: 1, workouts: [w('x', '2026-09-01', { updatedAt: 5 }), w('y', '2026-08-01')], tombstones: { z: 9 } });
  const b = base({ updatedAt: 2, workouts: [w('x', '2026-09-01', { updatedAt: 7 }), w('z', '2026-07-01')] });
  const ab = mergeStates(a, b);
  const ba = mergeStates(b, a);
  assert.deepEqual(ab.workouts, ba.workouts);
  assert.deepEqual(mergeStates(ab, b).workouts, ab.workouts);
  assert.deepEqual(ab.workouts.map((x) => [x.id, x.updatedAt]), [['x', 7], ['y', undefined]]);
});
