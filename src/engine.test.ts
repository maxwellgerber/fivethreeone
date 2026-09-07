import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foreverPhases, roundWeight, e1rm, suggestTm, platesPerSide, planWorkout, planLift, defaultProgram,
  nextPosition, prevPosition, flatWeek, positionFromFlatWeek, totalWeeks, bumpTms, jokerSet, jokersAllowed, simplePhases, type Position,
} from './engine.ts';

test('roundWeight nearest and down', () => {
  assert.equal(roundWeight(172.25, 5), 170);
  assert.equal(roundWeight(172.5, 5), 175);
  assert.equal(roundWeight(174, 5, 'down'), 170);
  assert.equal(roundWeight(61.3, 2.5), 62.5);
  assert.equal(roundWeight(100, 0), 100);
});

test('e1rm uses Wendler formula', () => {
  assert.equal(e1rm(225, 1), 225);
  assert.ok(Math.abs(e1rm(225, 5) - 262.46) < 0.01);
  assert.equal(e1rm(0, 5), 0);
});

test('suggestTm rounds down to 90% of e1RM', () => {
  // 255x5 -> e1rm 297.46 -> 90% = 267.7 -> 265
  assert.equal(suggestTm(255, 5), 265);
});

test('platesPerSide', () => {
  assert.deepEqual(platesPerSide(225, 45, [45, 35, 25, 10, 5, 2.5]), [45, 45]);
  assert.deepEqual(platesPerSide(185, 45, [45, 35, 25, 10, 5, 2.5]), [45, 25]);
  assert.deepEqual(platesPerSide(45, 45, [45]), []);
});

test('week 1 leader with 5s PRO + FSL', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = foreverPhases();
  cfg.tms.squat = 270;
  const w = planWorkout(cfg, { phase: 0, cycle: 0, week: 0, day: 0 });
  const squat = w.lifts[0];
  assert.equal(squat.lift, 'squat');
  const main = squat.sets.filter((s) => s.kind === 'main');
  assert.deepEqual(main.map((s) => s.weight), [175, 205, 230]);
  assert.deepEqual(main.map((s) => s.reps), [5, 5, 5]);
  assert.ok(main.every((s) => !s.amrap));
  const sup = squat.sets.filter((s) => s.kind === 'supplemental');
  assert.equal(sup.length, 5);
  assert.ok(sup.every((s) => s.weight === 175 && s.reps === 5));
  const wu = squat.sets.filter((s) => s.kind === 'warmup');
  assert.deepEqual(wu.map((s) => s.weight), [110, 135, 160]);
  assert.equal(w.title, 'Week 1 · Day A');
});

test('anchor week 3 PR sets: 5/3/1+ and FSL', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = foreverPhases();
  cfg.tms.bench = 200;
  const pos: Position = { phase: 2, cycle: 0, week: 2, day: 0 };
  const bench = planLift(cfg, pos, 'bench');
  const main = bench.sets.filter((s) => s.kind === 'main');
  assert.deepEqual(main.map((s) => [s.weight, s.reps, s.amrap]), [
    [150, 5, false],
    [170, 3, false],
    [190, 1, true],
  ]);
  const sup = bench.sets.filter((s) => s.kind === 'supplemental');
  assert.equal(sup[0].weight, 150);
});

test('SSL and BBB supplemental percentages', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = foreverPhases();
  cfg.tms.deadlift = 400;
  cfg.phases[0].supplemental = { type: 'SSL', sets: 5, reps: 5 };
  let dl = planLift(cfg, { phase: 0, cycle: 0, week: 1, day: 1 }, 'deadlift');
  assert.equal(dl.sets.filter((s) => s.kind === 'supplemental')[0].weight, 320); // 80%
  cfg.phases[0].supplemental = { type: 'BBB', sets: 5, reps: 10, pct: 0.6 };
  dl = planLift(cfg, { phase: 0, cycle: 0, week: 2, day: 1 }, 'deadlift');
  const sup = dl.sets.filter((s) => s.kind === 'supplemental');
  assert.equal(sup.length, 5);
  assert.equal(sup[0].weight, 240);
  assert.equal(sup[0].reps, 10);
});

test('seventh week deload and TM test', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = foreverPhases();
  cfg.tms.press = 120;
  const deload = planLift(cfg, { phase: 1, cycle: 0, week: 0, day: 1 }, 'press');
  const dm = deload.sets.filter((s) => s.kind !== 'warmup');
  assert.deepEqual(dm.map((s) => [s.weight, s.reps]), [[85, 5], [95, 5], [110, 5]]);
  const tmt = planLift(cfg, { phase: 3, cycle: 0, week: 0, day: 1 }, 'press');
  const last = tmt.sets[tmt.sets.length - 1];
  assert.equal(last.kind, 'tmTest');
  assert.equal(last.weight, 120);
  assert.equal(last.amrap, true);
  assert.equal(last.minReps, 3);
  const w = planWorkout(cfg, { phase: 3, cycle: 0, week: 0, day: 1 });
  assert.equal(w.isSeventh, true);
  assert.match(w.title, /TM Test/);
});

test('position navigation walks days, weeks, cycles, phases and wraps', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = foreverPhases(); // 2 days; phases: leader x2 (6w), 7th, anchor x1 (3w), 7th = 11 weeks
  assert.equal(totalWeeks(cfg), 11);
  let pos: Position = { phase: 0, cycle: 0, week: 0, day: 0 };
  let r = nextPosition(cfg, pos);
  assert.deepEqual(r.pos, { phase: 0, cycle: 0, week: 0, day: 1 });
  r = nextPosition(cfg, r.pos);
  assert.deepEqual(r.pos, { phase: 0, cycle: 0, week: 1, day: 0 });
  assert.equal(r.cycleCompleted, false);
  // End of cycle 1 week 3 day B -> cycle 2 week 1
  r = nextPosition(cfg, { phase: 0, cycle: 0, week: 2, day: 1 });
  assert.deepEqual(r.pos, { phase: 0, cycle: 1, week: 0, day: 0 });
  assert.equal(r.cycleCompleted, true);
  // End of leader -> seventh
  r = nextPosition(cfg, { phase: 0, cycle: 1, week: 2, day: 1 });
  assert.deepEqual(r.pos, { phase: 1, cycle: 0, week: 0, day: 0 });
  // seventh -> anchor
  r = nextPosition(cfg, { phase: 1, cycle: 0, week: 0, day: 1 });
  assert.deepEqual(r.pos, { phase: 2, cycle: 0, week: 0, day: 0 });
  assert.equal(r.cycleCompleted, false);
  // final seventh -> wrap
  r = nextPosition(cfg, { phase: 3, cycle: 0, week: 0, day: 1 });
  assert.deepEqual(r.pos, { phase: 0, cycle: 0, week: 0, day: 0 });
  assert.equal(r.wrapped, true);
  // flatWeek round trip
  for (let fw = 0; fw < totalWeeks(cfg); fw++) {
    assert.equal(flatWeek(cfg, positionFromFlatWeek(cfg, fw)), fw);
  }
  // prev
  assert.deepEqual(prevPosition(cfg, { phase: 2, cycle: 0, week: 0, day: 0 }), { phase: 1, cycle: 0, week: 0, day: 1 });
  assert.deepEqual(prevPosition(cfg, { phase: 0, cycle: 0, week: 0, day: 0 }), { phase: 0, cycle: 0, week: 0, day: 0 });
});

test('bumpTms applies increments', () => {
  const cfg = defaultProgram('lb');
  const t = bumpTms(cfg);
  assert.equal(t.squat, cfg.tms.squat + 10);
  assert.equal(t.press, cfg.tms.press + 5);
});

test('simple default: single repeating cycle of PR sets + FSL', () => {
  const cfg = defaultProgram('lb');
  assert.equal(cfg.phases.length, 1);
  assert.equal(totalWeeks(cfg), 3);
  const w = planWorkout(cfg, { phase: 0, cycle: 0, week: 2, day: 0 });
  const main = w.lifts[0].sets.filter((s) => s.kind === 'main');
  assert.deepEqual(main.map((s) => s.reps), [5, 3, 1]);
  assert.equal(main[2].amrap, true);
  const r = nextPosition(cfg, { phase: 0, cycle: 0, week: 2, day: 1 });
  assert.deepEqual(r.pos, { phase: 0, cycle: 0, week: 0, day: 0 });
  assert.equal(r.cycleCompleted, true);
  assert.equal(r.wrapped, true);
});

test('kg defaults round to 2.5', () => {
  const cfg = defaultProgram('kg');
  const sq = planLift(cfg, { phase: 0, cycle: 0, week: 0, day: 0 }, 'squat');
  const main = sq.sets.filter((s) => s.kind === 'main');
  assert.ok(main.every((s) => Math.abs((s.weight / 2.5) - Math.round(s.weight / 2.5)) < 1e-9));
});

test('joker sets step 5% above the top set with the top set reps', () => {
  const cfg = defaultProgram('lb');
  cfg.tms.squat = 300;
  const w1: Position = { phase: 0, cycle: 0, week: 0, day: 0 };
  assert.deepEqual(jokerSet(cfg, w1, 'squat', 1), { kind: 'joker', pct: 0.9, weight: 270, reps: 5, amrap: false });
  assert.deepEqual(jokerSet(cfg, w1, 'squat', 2), { kind: 'joker', pct: 0.95, weight: 285, reps: 5, amrap: false });
  const w3: Position = { phase: 0, cycle: 0, week: 2, day: 0 };
  assert.equal(jokerSet(cfg, w3, 'squat', 1).pct, 1);
  assert.equal(jokerSet(cfg, w3, 'squat', 1).reps, 1);
  assert.equal(jokerSet(cfg, w3, 'squat', 1).weight, 300);
});

test('jokersAllowed follows the phase flag and PR-set scheme', () => {
  const cfg = defaultProgram('lb');
  cfg.phases = simplePhases();
  const pos: Position = { phase: 0, cycle: 0, week: 0, day: 0 };
  assert.equal(jokersAllowed(cfg, pos), false);
  cfg.phases[0].jokers = true;
  assert.equal(jokersAllowed(cfg, pos), true);
  cfg.phases[0].mainScheme = '5sPro';
  assert.equal(jokersAllowed(cfg, pos), false);
  cfg.phases = foreverPhases();
  assert.equal(jokersAllowed(cfg, { phase: 2, cycle: 0, week: 1, day: 0 }), true);
  assert.equal(jokersAllowed(cfg, { phase: 0, cycle: 0, week: 1, day: 0 }), false);
});
