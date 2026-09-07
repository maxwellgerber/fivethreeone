import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes } from './notesImport.ts';

const today = new Date(2026, 8, 7);
const sets = (r: ReturnType<typeof parseNotes>, date: string, name: string) =>
  r.workouts.find((w) => w.date === date)!.entries.find((e) => e.name === name)!.sets.map((s) => `${s.weight}x${s.reps ?? '?'}${s.bodyweight ? 'bw' : ''}`);

test('weight x reps x sets, comments, supplemental', () => {
  const r = parseNotes('Sept 1\nSquat 255x5 niceee 195x5x5\nBench 185x5, 145x5x5\n', { today });
  assert.equal(r.workouts[0].date, '2026-09-01');
  assert.deepEqual(sets(r, '2026-09-01', 'Squat'), ['255x5', '195x5', '195x5', '195x5', '195x5', '195x5']);
  assert.equal(r.workouts[0].entries[0].note, 'niceee');
  assert.equal(r.workouts[0].entries[0].lift, 'squat');
});

test('old style sets x reps x weight', () => {
  const r = parseNotes('Dec 5\nSquat 5x5x175\nDeadlift 1x10x235\n', { today });
  assert.deepEqual(sets(r, '2025-12-05', 'Squat'), Array(5).fill('175x5'));
  assert.deepEqual(sets(r, '2025-12-05', 'Deadlift'), ['235x10']);
});

test('ramps with unknown reps and trailing reps', () => {
  const r = parseNotes('Feb 19\nDeads 135 185 225 275 x5\nSquat 135x, 165x, 190x5x3\n', { today });
  assert.deepEqual(sets(r, '2026-02-19', 'Deadlift'), ['135x?', '185x?', '225x?', '275x5']);
  assert.deepEqual(sets(r, '2026-02-19', 'Squat'), ['135x?', '165x?', '190x5', '190x5', '190x5']);
});

test('rep lists, reps x weight, decimal commas, kg, units', () => {
  const r = parseNotes('July 12\nSquat 185x8,8,8,8\nBench 5x80, 5x95, 4x175\nOHP 107,5x5 147,5x5x2\nLeg press 170kgx5x2\nLunges 60lbx10x3\n', { today });
  assert.deepEqual(sets(r, '2026-07-12', 'Squat'), ['185x8', '185x8', '185x8', '185x8']);
  assert.deepEqual(sets(r, '2026-07-12', 'Bench'), ['80x5', '95x5', '175x4']);
  assert.deepEqual(sets(r, '2026-07-12', 'Press'), ['107.5x5', '147.5x5', '147.5x5']);
  assert.deepEqual(sets(r, '2026-07-12', 'Leg press'), ['375x5', '375x5']);
  assert.deepEqual(sets(r, '2026-07-12', 'Lunges'), ['60x10', '60x10', '60x10']);
});

test('bodyweight notation', () => {
  const r = parseNotes('June 16\nDips bw+35 x 5,5,5\nChins 15x5,5\nPull-ups bw x10,5\nDips BWx8,8, +25x5,5\nAb rollout 10x3\n', { today });
  assert.deepEqual(sets(r, '2026-06-16', 'Dips'), ['35x5bw', '35x5bw', '35x5bw']);
  assert.deepEqual(sets(r, '2026-06-16', 'Chin-ups'), ['15x5bw', '15x5bw']);
  assert.deepEqual(sets(r, '2026-06-16', 'Pull-ups'), ['0x10bw', '0x5bw']);
  assert.deepEqual(sets(r, '2026-06-16', 'Ab rollout'), ['0x10bw', '0x10bw', '0x10bw']);
  const dips = r.workouts[0].entries.filter((e) => e.name === 'Dips')[1].sets.map((s) => `${s.weight}x${s.reps}`);
  assert.deepEqual(dips, ['0x8', '0x8', '25x5', '25x5']);
});

test('year inference walks backwards and honours leap day', () => {
  const r = parseNotes('Jan 14\nSquat 170x5x5\nDec 22\nSquat 190x5\nMar 4\nSquat 1x5x185\nFeb 29 woof\nSquat 185x5x3\nJan 31\nSquat 185x5\n', { today });
  assert.deepEqual(r.workouts.map((w) => w.date), ['2026-01-14', '2025-12-22', '2025-03-04', '2025-02-29', '2025-01-31']);
  assert.ok(r.warnings.some((w) => /Feb 29/.test(w.message)));
  const r2 = parseNotes('Oct 8\nSquat 145x5x3\nMarch 2\nSquat 185x5x5\nDec 16th\nOHP 95x5x3\nNov 5\nOHP 105x5x3\nMar 4\nOHP 95x5\nFeb 29 woof\nSquat 185x5x3\n', { today });
  assert.deepEqual(r2.workouts.map((w) => w.date), ['2025-10-08', '2025-03-02', '2024-12-16', '2024-11-05', '2024-03-04', '2024-02-29']);
  assert.ok(!r2.warnings.some((w) => /Feb 29/.test(w.message)));
});

test('commentary lines become notes, sentences starting with a lift are not sets', () => {
  const r = parseNotes('Aug 21\n45 mins boulder sess\nDeads 310x5\nDeads felt like nice warmup volume, ohp a little sticky\nCycle 3 day 1\n', { today });
  const w = r.workouts[0];
  assert.equal(w.entries.length, 1);
  assert.match(w.notes!, /boulder/);
  assert.match(w.notes!, /Cycle 3 day 1/);
  assert.match(w.notes!, /warmup volume/);
});

test('typo 135x55 and undated second session', () => {
  const r = parseNotes('Nov 14\nBench 135x55\n\nMar 2\nSquat 185x5x5\nBench 145x5x3\n\nSquat 175x5x5\nOHP 90x5x5\n', { today });
  assert.deepEqual(sets(r, '2025-11-14', 'Bench'), Array(5).fill('135x5'));
  assert.equal(r.workouts.length, 3);
  assert.equal(r.workouts[2].dateUncertain, true);
  assert.equal(r.workouts[2].date, '2025-03-02');
});
