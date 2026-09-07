import { useState } from 'react';
import { LIFT_NAMES, bumpTms, e1rm, nextPosition, planWorkout, platesPerSide, prevPosition, roundWeight, type Lift } from '../engine.ts';
import { sortWorkouts } from '../merge.ts';
import { todayISO, uid, type AppState, type ExerciseEntry, type LoggedSet, type Workout } from '../model.ts';
import { bestE1rmPerLift, isRepPr, lastSessionFor } from '../stats.ts';
import { fmtDate, fmtW } from '../format.ts';
import { topSet } from '../workoutText.ts';
import { useSheet } from '../app/sheet.tsx';
import { useStore } from '../app/store.tsx';
import { useTimer } from '../app/timer.tsx';
import { useToast } from '../app/toast.tsx';
import { Field } from '../components/Field.tsx';
import { Stepper } from '../components/Stepper.tsx';

type Category = 'push' | 'pull' | 'single' | 'other';
type TmResult = { lift: Lift; weight: number; reps: number; min: number };

function plateText(state: AppState, weight: number): string {
  const { program, settings } = state;
  if (weight <= program.barWeight) return 'bar';
  const p = platesPerSide(weight, program.barWeight, settings.plates);
  const total = p.reduce((a, b) => a + b, 0) * 2 + program.barWeight;
  if (Math.abs(total - weight) > 0.01) return '—';
  return p.map((x) => fmtW(x)).join(' · ');
}

function timerFor(state: AppState, kind?: string): number {
  const s = state.settings;
  if (kind === 'main' || kind === 'tmTest' || kind === 'joker') return s.timerMain;
  if (kind === 'supplemental') return s.timerSupp;
  return s.timerAssist;
}

function kindTag(set: LoggedSet): string {
  switch (set.kind) {
    case 'warmup': return 'warm-up';
    case 'main': return set.amrap ? 'PR set' : `${Math.round((set.pct ?? 0) * 100)}%`;
    case 'supplemental': return 'supp';
    case 'tmTest': return 'TM test';
    case 'joker': return 'joker';
    default: return '';
  }
}

function buildActive(state: AppState): Workout {
  const { program, position } = state;
  const plan = planWorkout(program, position);
  const entries: ExerciseEntry[] = plan.lifts.map((pl) => ({
    name: LIFT_NAMES[pl.lift],
    lift: pl.lift,
    sets: pl.sets.map((s) => ({ weight: s.weight, reps: null, target: s.reps, kind: s.kind, amrap: s.amrap, pct: s.pct, minReps: s.minReps, done: false })),
  }));
  return { id: uid(), date: todayISO(), position: { ...position }, title: plan.title, entries, source: 'app', startedAt: Date.now() };
}

/** Workouts other than the one in progress (for PR checks). */
function others(state: AppState): Workout[] {
  return state.workouts.filter((w) => w.id !== state.active?.id);
}

// ---- Screen -----------------------------------------------------------------

export function Today() {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const { program, position } = state;
  const plan = planWorkout(program, position);
  const active = state.active;
  const w = active ?? buildActive(state);
  const isActive = !!active;
  const doneCount = w.entries.flatMap((e) => e.sets).filter((s) => s.done).length;
  const totalCount = w.entries.filter((e) => e.lift).flatMap((e) => e.sets).length;

  return (
    <>
      <header className="screen-head">
        <div>
          <div className="eyebrow">{isActive ? `In progress · ${doneCount}/${totalCount} sets` : fmtDate(todayISO(), { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <h1>{plan.title}</h1>
          <div className="sub">{plan.subtitle}</div>
        </div>
        {!isActive && (
          <div className="pos-nav">
            <button type="button" className="btn small" aria-label="Previous session" onClick={() => commit((s) => { s.position = prevPosition(s.program, s.position); })}>‹</button>
            <button type="button" className="btn small" aria-label="Next session" onClick={() => commit((s) => { s.position = nextPosition(s.program, s.position).pos; })}>›</button>
          </div>
        )}
      </header>
      {!isActive && (
        <div className="stack" style={{ marginBottom: 14 }}>
          <button type="button" className="btn primary big" data-action="start-workout" onClick={() => commit((s) => { s.active = buildActive(s); })}>Start workout</button>
        </div>
      )}
      {w.entries.map((e, i) => (e.lift ? <LiftBlock key={i} entry={e} ei={i} active={isActive} tm={program.tms[e.lift]} /> : null))}
      <AssistanceBlock w={w} targets={plan.assistance} active={isActive} />
      {isActive && (
        <div className="stack mt">
          <button type="button" className="btn primary big" data-action="finish-workout" onClick={() => sheet.open(<FinishSheet />)}>Finish workout</button>
          <button type="button" className="btn ghost" data-action="discard-workout" onClick={() => sheet.open(<DiscardSheet />)}>Discard</button>
        </div>
      )}
    </>
  );
}

// ---- Main lifts ---------------------------------------------------------------

function LiftBlock({ entry, ei, active, tm }: { entry: ExerciseEntry; ei: number; active: boolean; tm: number }) {
  const { state } = useStore();
  const lift = entry.lift!;
  const last = lastSessionFor(others(state), lift);
  const lastTop = last ? topSet(last, lift) : null;
  return (
    <section className="lift">
      <div className="lift-head">
        <h2>{LIFT_NAMES[lift]}</h2>
        <span className="tm">TM <b>{fmtW(tm)}</b>{lastTop ? ` · last ${fmtW(lastTop.weight)}×${lastTop.reps}` : ''}</span>
      </div>
      <div className="sets">{entry.sets.map((s, si) => <SetRow key={si} ei={ei} si={si} set={s} active={active} />)}</div>
    </section>
  );
}

function SetRow({ ei, si, set, active }: { ei: number; si: number; set: LoggedSet; active: boolean }) {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const after = useAfterSet();
  const cls = ['set', set.kind ?? '', set.amrap ? 'amrap' : '', set.done ? 'done' : '', set.skipped ? 'skipped' : ''].join(' ');
  const reps = set.done && !set.skipped
    ? <><b>{set.reps}</b>{set.amrap && set.target ? <small className="muted">/{set.target}+</small> : null}</>
    : set.amrap ? <b>{set.target}+</b> : <>{set.target ?? set.reps ?? ''}</>;

  const onTap = () => {
    if (!set.done) {
      if (set.amrap) return sheet.open(<RepsSheet ei={ei} si={si} />);
      const next = commit((s) => { const t = s.active!.entries[ei].sets[si]; t.done = true; t.reps = t.target ?? t.reps; t.skipped = false; });
      after(next.active!.entries[ei], next.active!.entries[ei].sets[si]);
    } else {
      sheet.open(<EditSetSheet ei={ei} si={si} />);
    }
  };
  return (
    <button type="button" className={cls} data-action="set-tap" disabled={!active} onClick={onTap}>
      <span className="stripe" />
      <span>
        <span className="w">{fmtW(set.weight)}<small>{state.program.units}</small></span>
        <span className="plates">{plateText(state, set.weight)} &nbsp;<span className="tag">{kindTag(set)}</span></span>
      </span>
      <span className="reps">{reps}</span>
      <span className="check">✓</span>
    </button>
  );
}

/** Start the rest timer and announce rep PRs after a set is logged. */
function useAfterSet() {
  const { current } = useStore();
  const timer = useTimer();
  const toast = useToast();
  return (entry: ExerciseEntry, set: LoggedSet) => {
    const state = current();
    timer.start(timerFor(state, set.kind), `${entry.name} ${fmtW(set.weight)}×${set.reps}`);
    if (entry.lift && set.reps && set.kind !== 'warmup' && isRepPr(others(state), entry.lift, set.weight, set.reps)) toast(`Rep PR: ${fmtW(set.weight)}×${set.reps}`);
  };
}

function PrHint({ lift, weight }: { lift: Lift; weight: number }) {
  const { state } = useStore();
  const best = bestE1rmPerLift(others(state))[lift];
  if (!best) return null;
  const need = Math.max(1, Math.ceil((best.e1rm - weight) / (weight * 0.0333) + 1e-9));
  if (need > 20) return null;
  return <div className="note">{need}+ reps beats your best e1RM ({fmtW(best.weight)}×{best.reps} = {Math.round(best.e1rm)}).</div>;
}

function RepsSheet({ ei, si }: { ei: number; si: number }) {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const after = useAfterSet();
  const entry = state.active!.entries[ei];
  const set = entry.sets[si];
  const [reps, setReps] = useState(set.reps ?? set.target ?? 5);
  const confirm = () => {
    sheet.close();
    const next = commit((s) => { const t = s.active!.entries[ei].sets[si]; t.reps = reps; t.done = true; t.skipped = false; });
    after(next.active!.entries[ei], next.active!.entries[ei].sets[si]);
  };
  return (
    <>
      <h2>{set.kind === 'tmTest' ? 'TM test' : 'PR set'} · {entry.name} {fmtW(set.weight)}</h2>
      {set.kind === 'tmTest'
        ? <div className="note">Training max check: {set.minReps ?? 3}–5 strong reps means the TM is right. Fewer means lower it.</div>
        : <div className="note">Target {set.target}+. Leave a rep or two in the tank.</div>}
      {entry.lift && <PrHint lift={entry.lift} weight={set.weight} />}
      <div className="mt"><Stepper value={reps} label="reps" step={1} onChange={setReps} /></div>
      <div className="actions">
        <button type="button" className="btn" data-action="sheet-close" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn primary" data-action="reps-confirm" onClick={confirm}>Log set</button>
      </div>
    </>
  );
}

function EditSetSheet({ ei, si }: { ei: number; si: number }) {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const entry = state.active!.entries[ei];
  const set = entry.sets[si];
  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps ?? set.target ?? 5);
  const apply = (mut: (t: LoggedSet) => void) => { sheet.close(); commit((s) => mut(s.active!.entries[ei].sets[si])); };
  return (
    <>
      <h2>{entry.name} · {kindTag(set) || 'set'}</h2>
      <div className="stack">
        <Stepper value={weight} label={state.program.units} step={state.program.roundTo} onChange={setWeight} />
        <Stepper value={reps} label="reps" step={1} onChange={setReps} />
        <div className="note right">{reps > 0 && weight > 0 ? `e1RM ${Math.round(e1rm(weight, reps))}` : ''}</div>
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => apply((t) => { t.done = false; t.reps = null; t.skipped = false; })}>Mark not done</button>
        <button type="button" className="btn danger" onClick={() => apply((t) => { t.skipped = !t.skipped; t.done = t.skipped; t.reps = t.skipped ? 0 : null; })}>{set.skipped ? 'Unskip' : 'Skip set'}</button>
        <button type="button" className="btn primary full" onClick={() => apply((t) => { t.weight = weight; t.reps = reps; t.done = true; t.skipped = false; })}>Save</button>
      </div>
    </>
  );
}

// ---- Assistance ---------------------------------------------------------------

function AssistanceBlock({ w, targets, active }: { w: Workout; targets: { push: number; pull: number; single: number }; active: boolean }) {
  const { commit } = useStore();
  const sheet = useSheet();
  const entries = w.entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.lift);
  const totals = { push: 0, pull: 0, single: 0 };
  for (const { e } of entries) for (const s of e.sets) if (e.category && e.category !== 'other' && s.reps) totals[e.category] += s.reps;
  const chip = (c: 'push' | 'pull' | 'single', label: string) =>
    targets[c] > 0 ? <span className={`chip ${c}${totals[c] >= targets[c] ? ' ok' : ''}`}>{label} {totals[c]}/{targets[c]}</span> : null;
  return (
    <section className="lift">
      <div className="lift-head"><h2>Assistance</h2></div>
      <div className="assist">
        <div className="assist-target">{chip('push', 'Push')}{chip('pull', 'Pull')}{chip('single', 'Single leg / core')}</div>
        {entries.map(({ e, i }) => (
          <div className="entry" key={i}>
            <div className="row">
              <span><span className="name">{e.name}</span><span className="cat">{e.category ?? ''}</span></span>
              {active && <button type="button" className="btn ghost small" onClick={() => commit((s) => { s.active!.entries.splice(i, 1); })}>Remove</button>}
            </div>
            <div className="setline">
              {e.sets.map((s, si) => (
                <button key={si} type="button" className="setpill" disabled={!active} onClick={() => sheet.open(<AssistSetSheet ei={i} si={si} />)}>
                  {s.bodyweight ? 'BW' + (s.weight ? '+' + fmtW(s.weight) : '') : fmtW(s.weight)}×{s.reps ?? '?'}
                </button>
              ))}
              {active && <button type="button" className="setpill add" onClick={() => sheet.open(<AssistSetSheet ei={i} />)}>+ set</button>}
            </div>
          </div>
        ))}
        {active && <div className="mt"><button type="button" className="btn" data-action="assist-add" onClick={() => sheet.open(<AssistPickSheet />)}>+ Add exercise</button></div>}
      </div>
    </section>
  );
}

function AssistPickSheet() {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  const [name, setName] = useState('');
  const [cat, setCat] = useState<Category>('push');
  const add = (n: string, category: Category) => {
    const next = commit((s) => {
      s.active!.entries.push({ name: n, category, sets: [] });
      if (!s.assistance.some((a) => a.name.toLowerCase() === n.toLowerCase()) && category !== 'other') s.assistance.push({ name: n, category });
    });
    sheet.open(<AssistSetSheet ei={next.active!.entries.length - 1} />);
  };
  return (
    <>
      <h2>Add assistance</h2>
      <div className="day-chips">{state.assistance.map((a, i) => <button key={i} type="button" onClick={() => add(a.name, a.category)}>{a.name}</button>)}</div>
      <Field label="Other" hint="Name, then choose a category">
        <input type="text" placeholder="e.g. Cable row" style={{ width: 160, textAlign: 'left' }} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="row wrap">
        <span className="seg">
          {(['push', 'pull', 'single', 'other'] as Category[]).map((c) => (
            <button key={c} type="button" className={c === cat ? 'active' : ''} onClick={() => setCat(c)}>{{ push: 'Push', pull: 'Pull', single: 'Single/Core', other: 'Other' }[c]}</button>
          ))}
        </span>
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => (name.trim() ? add(name.trim(), cat) : toast('Give it a name'))}>Add</button>
      </div>
    </>
  );
}

function lastAssistSet(state: AppState, name: string): LoggedSet | null {
  for (const w of state.workouts) {
    const e = w.entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const s = e?.sets[e.sets.length - 1];
    if (s && s.reps) return s;
  }
  return null;
}

function AssistSetSheet({ ei, si }: { ei: number; si?: number }) {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const timer = useTimer();
  const entry = state.active!.entries[ei];
  const existing = si !== undefined ? entry.sets[si] : null;
  const prev = existing ?? entry.sets[entry.sets.length - 1] ?? lastAssistSet(state, entry.name);
  const [weight, setWeight] = useState(prev?.weight ?? 0);
  const [reps, setReps] = useState(prev?.reps ?? 10);
  const [bw, setBw] = useState(prev?.bodyweight ?? false);
  const save = () => {
    sheet.close();
    const set: LoggedSet = { weight, reps, kind: 'assistance', done: true, bodyweight: bw || undefined };
    commit((s) => { const e = s.active!.entries[ei]; if (si !== undefined) e.sets[si] = set; else e.sets.push(set); });
    if (si === undefined) timer.start(state.settings.timerAssist, entry.name);
  };
  return (
    <>
      <h2>{entry.name}</h2>
      <div className="stack">
        <Stepper value={weight} label={`${state.program.units}${bw ? ' added to bodyweight' : ''}`} step={state.program.roundTo} onChange={setWeight} />
        <Stepper value={reps} label="reps" step={1} onChange={setReps} />
        <label className="row"><input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} /> Bodyweight movement</label>
      </div>
      <div className="actions">
        {existing
          ? <button type="button" className="btn danger" onClick={() => { sheet.close(); commit((s) => { s.active!.entries[ei].sets.splice(si!, 1); }); }}>Delete</button>
          : <button type="button" className="btn" onClick={sheet.close}>Cancel</button>}
        <button type="button" className="btn primary" onClick={save}>{existing ? 'Save' : 'Add set'}</button>
      </div>
    </>
  );
}

// ---- Finish / discard -------------------------------------------------------------

function DiscardSheet() {
  const { commit } = useStore();
  const sheet = useSheet();
  const timer = useTimer();
  return (
    <>
      <h2>Discard this workout?</h2>
      <div className="note">Nothing from this session will be saved.</div>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Keep going</button>
        <button type="button" className="btn danger" onClick={() => { sheet.close(); timer.stop(); commit((s) => { s.active = null; }); }}>Discard</button>
      </div>
    </>
  );
}

function FinishSheet() {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const timer = useTimer();
  const toast = useToast();
  const w = state.active!;
  const [notes, setNotes] = useState(w.notes ?? '');
  const pending = w.entries.filter((e) => e.lift).flatMap((e) => e.sets).filter((s) => !s.done && s.kind !== 'warmup').length;
  const summary = w.entries.filter((e) => e.lift).map((e) => {
    const t = topSet(w, e.lift!);
    return t ? `${e.name} ${fmtW(t.weight)}×${t.reps}` : e.name;
  }).join(' · ');

  const confirm = () => {
    sheet.close();
    timer.stop();
    let cycleCompleted = false;
    const tmTestResults: TmResult[] = [];
    commit((s) => {
      const a = s.active!;
      for (const e of a.entries) {
        for (const set of e.sets) if (!set.done) { set.skipped = true; set.reps = 0; set.done = true; }
        if (e.lift) for (const set of e.sets) if (set.kind === 'tmTest' && !set.skipped) tmTestResults.push({ lift: e.lift, weight: set.weight, reps: set.reps ?? 0, min: set.minReps ?? 3 });
      }
      a.notes = notes.trim() || undefined;
      a.finishedAt = Date.now();
      a.updatedAt = a.finishedAt;
      s.workouts.unshift(a);
      sortWorkouts(s.workouts);
      s.active = null;
      const r = nextPosition(s.program, s.position);
      s.position = r.pos;
      cycleCompleted = r.cycleCompleted;
    });
    if (tmTestResults.length) sheet.open(<TmTestSheet results={tmTestResults} cycleCompleted={cycleCompleted} />);
    else if (cycleCompleted) sheet.open(<BumpSheet />);
    else toast('Saved');
  };
  return (
    <>
      <h2>Finish workout</h2>
      <div className="note">{summary}</div>
      {pending > 0 && <div className="note mt">{pending} planned set{pending > 1 ? 's' : ''} not logged — they'll be saved as skipped.</div>}
      <Field label="Notes">
        <input type="text" placeholder="How did it go?" style={{ width: 200, textAlign: 'left' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Back</button>
        <button type="button" className="btn primary" data-action="finish-confirm" onClick={confirm}>Save &amp; advance</button>
      </div>
    </>
  );
}

function BumpSheet() {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  const next = bumpTms(state.program);
  return (
    <>
      <h2>Cycle complete</h2>
      <div className="note">Add the standard increments to your training maxes?</div>
      <div className="mt">
        {(Object.keys(next) as Lift[]).map((l) => (
          <Field key={l} label={LIFT_NAMES[l]}><span><b>{fmtW(state.program.tms[l])}</b> → <b>{fmtW(next[l])}</b></span></Field>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Keep current</button>
        <button type="button" className="btn primary" onClick={() => { sheet.close(); commit((s) => { s.program.tms = bumpTms(s.program); }); toast('Training maxes updated'); }}>Bump TMs</button>
      </div>
    </>
  );
}

function TmTestSheet({ results, cycleCompleted }: { results: TmResult[]; cycleCompleted: boolean }) {
  const { state } = useStore();
  const sheet = useSheet();
  return (
    <>
      <h2>TM test</h2>
      {results.map((r) => {
        const pass = r.reps >= r.min;
        const strong = r.reps >= 5;
        const est = roundWeight(e1rm(r.weight, r.reps) * 0.9, state.program.roundTo, 'down');
        return (
          <Field key={r.lift} label={LIFT_NAMES[r.lift]} hint={`${fmtW(r.weight)}×${r.reps} — ${pass ? (strong ? 'strong, TM is good' : 'pass') : 'below target; consider lowering'}`}>
            <span className={pass ? '' : 'muted'}>90% e1RM: <b>{fmtW(est)}</b></span>
          </Field>
        );
      })}
      <div className="note mt">Adjust training maxes on the Program tab if needed.</div>
      <div className="actions">
        <button type="button" className="btn primary full" onClick={() => (cycleCompleted ? sheet.open(<BumpSheet />) : sheet.close())}>OK</button>
      </div>
    </>
  );
}
