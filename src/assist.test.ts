import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestAssistance } from './assist.ts';
import { defaultAssistance, type Workout } from './model.ts';

const W = (id: string, date: string, lifts: Array<'squat' | 'bench' | 'deadlift' | 'press'>, assist: Array<[string, 'push' | 'pull' | 'single', number, number, boolean?]>): Workout => ({
  id, date, source: 'import',
  entries: [
    ...lifts.map((l) => ({ name: l, lift: l, sets: [{ weight: 200, reps: 5 }] })),
    ...assist.map(([name, category, weight, reps, bodyweight]) => ({ name, category, sets: [{ weight, reps, bodyweight }] })),
  ],
});

const history: Workout[] = [
  W('c', '2026-09-03', ['deadlift', 'press'], [['Lat pulldown', 'pull', 145, 8], ['Plank', 'single', 0, 60, true]]),
  W('b', '2026-09-01', ['squat', 'bench'], [['Dips', 'push', 25, 8, true], ['Barbell row', 'pull', 135, 5], ['Ab rollout', 'single', 0, 10, true]]),
  W('a', '2026-08-20', ['squat', 'bench'], [['Push-ups', 'push', 0, 20, true]]),
];
const state = { workouts: history, assistance: defaultAssistance() };

test('last time on the same day comes first, with its last set to prefill', () => {
  const s = suggestAssistance(state, ['squat', 'bench']);
  assert.deepEqual(s.slice(0, 3).map((x) => [x.name, x.reason]), [['Dips', 'lastTime'], ['Barbell row', 'lastTime'], ['Ab rollout', 'lastTime']]);
  assert.deepEqual(s[0].last, { weight: 25, reps: 8, bodyweight: true });
  assert.equal(s[0].lastDate, '2026-09-01');
});

test('complements of the main lifts follow, and known exercises carry history', () => {
  const s = suggestAssistance(state, ['deadlift', 'press']);
  const names = s.map((x) => x.name);
  assert.deepEqual(names.slice(0, 2), ['Lat pulldown', 'Plank']);
  assert.ok(names.includes('Pull-ups') || names.includes('Dips'), names.join());
  const dips = s.find((x) => x.name === 'Dips');
  assert.equal(dips?.reason, 'pairs');
  assert.deepEqual(dips?.last, { weight: 25, reps: 8, bodyweight: true });
});

test('every category is represented and excluded names are skipped', () => {
  const s = suggestAssistance(state, ['squat', 'bench'], ['Dips', 'Barbell row']);
  assert.ok(!s.some((x) => x.name === 'Dips' || x.name === 'Barbell row'));
  for (const c of ['push', 'pull', 'single']) assert.ok(s.some((x) => x.category === c), `missing ${c}`);
  assert.ok(s.length <= 6);
});

test('no history: falls back to pairings and the default assistance list', () => {
  const s = suggestAssistance({ workouts: [], assistance: defaultAssistance() }, ['squat', 'bench']);
  assert.ok(s.length >= 3);
  assert.ok(s.every((x) => x.reason !== 'lastTime'));
  for (const c of ['push', 'pull', 'single']) assert.ok(s.some((x) => x.category === c), `missing ${c}`);
});
