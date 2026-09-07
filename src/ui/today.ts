import { LIFT_NAMES, bumpTms, e1rm, nextPosition, planWorkout, platesPerSide, prevPosition, roundWeight, type Lift } from '../engine.ts';
import { todayISO, uid, type ExerciseEntry, type LoggedSet, type Workout } from '../model.ts';
import { bestE1rmPerLift, isRepPr, lastSessionFor } from '../stats.ts';
import { actions, changes, closeSheet, commit, ctx, fmtDate, fmtW, h, keepAwake, openSheet, registerScreen, startTimer, stopTimer, toast } from './core.ts';

function plateText(weight: number): string {
  const { program, settings } = ctx.state;
  if (weight <= program.barWeight) return 'bar';
  const p = platesPerSide(weight, program.barWeight, settings.plates);
  const total = p.reduce((a, b) => a + b, 0) * 2 + program.barWeight;
  if (Math.abs(total - weight) > 0.01) return '—';
  return p.map((x) => fmtW(x)).join(' · ');
}

function timerFor(kind?: string): number {
  const s = ctx.state.settings;
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

function setRow(ei: number, si: number, set: LoggedSet, active: boolean): string {
  const cls = ['set', set.kind ?? '', set.amrap ? 'amrap' : '', set.done ? 'done' : '', set.skipped ? 'skipped' : ''].join(' ');
  const units = ctx.state.program.units;
  const repsHtml = set.done && !set.skipped
    ? `<b>${set.reps}</b>${set.amrap && set.target ? `<small class="muted">/${set.target}+</small>` : ''}`
    : set.amrap ? `<b>${set.target}+</b>` : `${set.target ?? set.reps ?? ''}`;
  const pct = set.kind === 'main' || set.kind === 'supplemental' ? `<span class="tag">${kindTag(set)}</span>` : `<span class="tag">${kindTag(set)}</span>`;
  const plates = plateText(set.weight);
  return `<button type="button" class="${cls}" data-action="set-tap" data-e="${ei}" data-s="${si}" ${active ? '' : 'disabled'}>
    <span class="stripe"></span>
    <span><span class="w">${fmtW(set.weight)}<small>${units}</small></span><span class="plates">${h(plates)} &nbsp;${pct}</span></span>
    <span class="reps">${repsHtml}</span>
    <span class="check">✓</span>
  </button>`;
}

function liftBlock(entry: ExerciseEntry, ei: number, active: boolean, tm: number): string {
  const lift = entry.lift!;
  const last = lastSessionFor(ctx.state.workouts.filter((w) => w.id !== ctx.state.active?.id), lift);
  const lastTop = last ? topSet(last, lift) : null;
  return `<section class="lift">
    <div class="lift-head">
      <h2>${h(LIFT_NAMES[lift])}</h2>
      <span class="tm">TM <b>${fmtW(tm)}</b>${lastTop ? ` · last ${fmtW(lastTop.weight)}×${lastTop.reps}` : ''}</span>
    </div>
    <div class="sets">${entry.sets.map((s, si) => setRow(ei, si, s, active)).join('')}</div>
  </section>`;
}

function topSet(w: Workout, lift: Lift): LoggedSet | null {
  let best: LoggedSet | null = null;
  for (const e of w.entries) if (e.lift === lift) for (const s of e.sets) {
    if (!s.reps || s.skipped) continue;
    if (!best || e1rm(s.weight, s.reps) > e1rm(best.weight, best.reps!)) best = s;
  }
  return best;
}

function assistanceBlock(w: Workout, targets: { push: number; pull: number; single: number }, active: boolean): string {
  const entries = w.entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.lift);
  const totals = { push: 0, pull: 0, single: 0 };
  for (const { e } of entries) for (const s of e.sets) if (e.category && e.category !== 'other' && s.reps) totals[e.category] += s.reps;
  const chip = (c: 'push' | 'pull' | 'single', label: string) =>
    targets[c] > 0 ? `<span class="chip ${c}${totals[c] >= targets[c] ? ' ok' : ''}">${label} ${totals[c]}/${targets[c]}</span>` : '';
  return `<section class="lift"><div class="lift-head"><h2>Assistance</h2></div>
    <div class="assist">
      <div class="assist-target">${chip('push', 'Push')}${chip('pull', 'Pull')}${chip('single', 'Single leg / core')}</div>
      ${entries.map(({ e, i }) => `<div class="entry">
        <div class="row"><span><span class="name">${h(e.name)}</span><span class="cat">${h(e.category ?? '')}</span></span>
          ${active ? `<button type="button" class="btn ghost small" data-action="entry-remove" data-e="${i}">Remove</button>` : ''}</div>
        <div class="setline">${e.sets.map((s, si) => `<button type="button" class="setpill" data-action="assist-set-edit" data-e="${i}" data-s="${si}" ${active ? '' : 'disabled'}>${s.bodyweight ? 'BW' + (s.weight ? '+' + fmtW(s.weight) : '') : fmtW(s.weight)}×${s.reps ?? '?'}</button>`).join('')}
          ${active ? `<button type="button" class="setpill add" data-action="assist-set-add" data-e="${i}">+ set</button>` : ''}</div>
      </div>`).join('')}
      ${active ? `<div class="mt"><button type="button" class="btn" data-action="assist-add">+ Add exercise</button></div>` : ''}
    </div></section>`;
}

function buildActive(): Workout {
  const { program, position } = ctx.state;
  const plan = planWorkout(program, position);
  const entries: ExerciseEntry[] = plan.lifts.map((pl) => ({
    name: LIFT_NAMES[pl.lift],
    lift: pl.lift,
    sets: pl.sets.map((s) => ({ weight: s.weight, reps: null, target: s.reps, kind: s.kind, amrap: s.amrap, pct: s.pct, minReps: s.minReps, done: false })),
  }));
  return { id: uid(), date: todayISO(), position: { ...position }, title: plan.title, entries, source: 'app', startedAt: Date.now() };
}

function renderToday(): string {
  const { state } = ctx;
  const { program, position } = state;
  const plan = planWorkout(program, position);
  const active = state.active;
  const w = active ?? buildActive();
  const isActive = !!active;
  const posNav = isActive ? '' : `<div class="pos-nav">
      <button type="button" class="btn small" data-action="pos-prev" aria-label="Previous session">‹</button>
      <button type="button" class="btn small" data-action="pos-next" aria-label="Next session">›</button></div>`;
  const tmOf = (l: Lift) => program.tms[l];
  const liftsHtml = w.entries.map((e, i) => (e.lift ? liftBlock(e, i, isActive, tmOf(e.lift)) : '')).join('');
  const doneCount = w.entries.flatMap((e) => e.sets).filter((s) => s.done).length;
  const totalCount = w.entries.filter((e) => e.lift).flatMap((e) => e.sets).length;
  return `<header class="screen-head">
      <div><div class="eyebrow">${h(isActive ? `In progress · ${doneCount}/${totalCount} sets` : fmtDate(todayISO(), { weekday: 'long', month: 'short', day: 'numeric' }))}</div>
      <h1>${h(plan.title)}</h1><div class="sub">${h(plan.subtitle)}</div></div>${posNav}
    </header>
    ${isActive ? '' : `<div class="stack" style="margin-bottom:14px"><button type="button" class="btn primary big" data-action="start-workout">Start workout</button></div>`}
    ${liftsHtml}
    ${assistanceBlock(w, plan.assistance, isActive)}
    ${isActive ? `<div class="stack mt">
      <button type="button" class="btn primary big" data-action="finish-workout">Finish workout</button>
      <button type="button" class="btn ghost" data-action="discard-workout">Discard</button></div>` : ''}`;
}
registerScreen('today', renderToday);

// ---- Actions ----------------------------------------------------------------

actions['pos-prev'] = () => commit((s) => { s.position = prevPosition(s.program, s.position); });
actions['pos-next'] = () => commit((s) => { s.position = nextPosition(s.program, s.position).pos; });

actions['start-workout'] = () => {
  commit((s) => { s.active = buildActive(); });
  if (ctx.state.settings.keepAwake) void keepAwake(true);
};

actions['set-tap'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  const w = ctx.state.active;
  if (!w) return;
  const set = w.entries[ei].sets[si];
  if (!set.done) {
    if (set.amrap) return openRepsSheet(ei, si);
    commit(() => { set.done = true; set.reps = set.target ?? set.reps; set.skipped = false; });
    afterSet(w.entries[ei], set);
  } else {
    openEditSheet(ei, si);
  }
};

function afterSet(entry: ExerciseEntry, set: LoggedSet): void {
  const secs = timerFor(set.kind);
  const label = `${entry.name} ${fmtW(set.weight)}×${set.reps}`;
  startTimer(secs, label);
  if (entry.lift && set.reps && set.kind !== 'warmup') {
    const others = ctx.state.workouts.filter((w) => w.id !== ctx.state.active?.id);
    if (isRepPr(others, entry.lift, set.weight, set.reps)) toast(`Rep PR: ${fmtW(set.weight)}×${set.reps}`);
  }
}

function prHint(lift: Lift, weight: number): string {
  const others = ctx.state.workouts.filter((w) => w.id !== ctx.state.active?.id);
  const best = bestE1rmPerLift(others)[lift];
  if (!best) return '';
  const need = Math.max(1, Math.ceil((best.e1rm - weight) / (weight * 0.0333) + 1e-9));
  if (need > 20) return '';
  return `<div class="note">${need}+ reps beats your best e1RM (${fmtW(best.weight)}×${best.reps} = ${Math.round(best.e1rm)}).</div>`;
}

function stepperHtml(id: string, value: number, label: string, step: number): string {
  return `<div class="stepper" data-stepper="${id}" data-step="${step}">
    <button type="button" data-action="step" data-dir="-1" data-id="${id}" aria-label="decrease">−</button>
    <div class="val"><span id="${id}-val">${fmtW(value)}</span><small>${h(label)}</small></div>
    <button type="button" data-action="step" data-dir="1" data-id="${id}" aria-label="increase">+</button>
  </div>`;
}
const stepperValues: Record<string, number> = {};
actions['step'] = (el) => {
  const id = el.dataset.id!;
  const wrap = el.closest<HTMLElement>('[data-stepper]')!;
  const step = +wrap.dataset.step!;
  const v = Math.max(0, +((stepperValues[id] ?? 0) + step * +el.dataset.dir!).toFixed(2));
  stepperValues[id] = v;
  document.getElementById(`${id}-val`)!.textContent = fmtW(v);
  const hint = document.getElementById(`${id}-hint`);
  if (hint && wrap.dataset.lift) {
    const w = stepperValues['w'] ?? 0;
    const r = stepperValues['r'] ?? 0;
    hint.textContent = r > 0 && w > 0 ? `e1RM ${Math.round(e1rm(w, r))}` : '';
  }
};

function openRepsSheet(ei: number, si: number): void {
  const w = ctx.state.active!;
  const entry = w.entries[ei];
  const set = entry.sets[si];
  stepperValues['r'] = set.reps ?? set.target ?? 5;
  stepperValues['w'] = set.weight;
  const title = set.kind === 'tmTest' ? 'TM test' : 'PR set';
  openSheet(`<h2>${title} · ${h(entry.name)} ${fmtW(set.weight)}</h2>
    ${set.kind === 'tmTest' ? `<div class="note">Training max check: ${set.minReps ?? 3}–5 strong reps means the TM is right. Fewer means lower it.</div>` : `<div class="note">Target ${set.target}+. Leave a rep or two in the tank.</div>`}
    ${entry.lift ? prHint(entry.lift, set.weight) : ''}
    <div class="mt" data-lift="1">${stepperHtml('r', stepperValues['r'], 'reps', 1)}</div>
    <div class="actions">
      <button type="button" class="btn" data-action="sheet-close">Cancel</button>
      <button type="button" class="btn primary" data-action="reps-confirm" data-e="${ei}" data-s="${si}">Log set</button>
    </div>`);
}
actions['reps-confirm'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  const w = ctx.state.active!;
  const entry = w.entries[ei];
  const set = entry.sets[si];
  closeSheet();
  commit(() => { set.reps = stepperValues['r']; set.done = true; set.skipped = false; });
  afterSet(entry, set);
};

function openEditSheet(ei: number, si: number): void {
  const w = ctx.state.active!;
  const entry = w.entries[ei];
  const set = entry.sets[si];
  stepperValues['w'] = set.weight;
  stepperValues['r'] = set.reps ?? set.target ?? 5;
  openSheet(`<h2>${h(entry.name)} · ${kindTag(set) || 'set'}</h2>
    <div class="stack" data-lift="1">
      ${stepperHtml('w', set.weight, ctx.state.program.units, ctx.state.program.roundTo)}
      ${stepperHtml('r', stepperValues['r'], 'reps', 1)}
      <div class="note right" id="r-hint"></div>
    </div>
    <div class="actions">
      <button type="button" class="btn" data-action="set-undo" data-e="${ei}" data-s="${si}">Mark not done</button>
      <button type="button" class="btn danger" data-action="set-skip" data-e="${ei}" data-s="${si}">${set.skipped ? 'Unskip' : 'Skip set'}</button>
      <button type="button" class="btn primary full" data-action="set-save" data-e="${ei}" data-s="${si}">Save</button>
    </div>`);
}
actions['set-save'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  const set = ctx.state.active!.entries[ei].sets[si];
  closeSheet();
  commit(() => { set.weight = stepperValues['w']; set.reps = stepperValues['r']; set.done = true; set.skipped = false; });
};
actions['set-undo'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  const set = ctx.state.active!.entries[ei].sets[si];
  closeSheet();
  commit(() => { set.done = false; set.reps = null; set.skipped = false; });
};
actions['set-skip'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  const set = ctx.state.active!.entries[ei].sets[si];
  closeSheet();
  commit(() => { set.skipped = !set.skipped; set.done = set.skipped; if (set.skipped) set.reps = 0; else set.reps = null; });
};

// Set weight editing before a set is done is also handy: long-press is unreliable on iOS, so
// planned rows use tap = done and a done row opens the editor.

// ---- Assistance ---------------------------------------------------------------

actions['assist-add'] = () => {
  const list = ctx.state.assistance;
  openSheet(`<h2>Add assistance</h2>
    <div class="day-chips">${list.map((a, i) => `<button type="button" data-action="assist-pick" data-i="${i}">${h(a.name)}</button>`).join('')}</div>
    <div class="field mt"><label>Other<span class="hint">Name, then choose a category</span></label>
      <input type="text" id="assist-name" placeholder="e.g. Cable row" style="width:160px;text-align:left"></div>
    <div class="row wrap">
      <span class="seg"><button type="button" class="active" data-action="assist-cat" data-cat="push">Push</button><button type="button" data-action="assist-cat" data-cat="pull">Pull</button><button type="button" data-action="assist-cat" data-cat="single">Single/Core</button><button type="button" data-action="assist-cat" data-cat="other">Other</button></span>
    </div>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="button" class="btn primary" data-action="assist-custom">Add</button></div>`);
};
let pickedCat: 'push' | 'pull' | 'single' | 'other' = 'push';
actions['assist-cat'] = (el) => {
  pickedCat = el.dataset.cat as typeof pickedCat;
  el.parentElement!.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === el));
};
function addAssistEntry(name: string, category: 'push' | 'pull' | 'single' | 'other'): void {
  closeSheet();
  commit((s) => {
    s.active!.entries.push({ name, category, sets: [] });
    if (!s.assistance.some((a) => a.name.toLowerCase() === name.toLowerCase()) && category !== 'other') s.assistance.push({ name, category });
  });
  const idx = ctx.state.active!.entries.length - 1;
  openAssistSetSheet(idx);
}
actions['assist-pick'] = (el) => {
  const a = ctx.state.assistance[+el.dataset.i!];
  addAssistEntry(a.name, a.category);
};
actions['assist-custom'] = () => {
  const name = (document.getElementById('assist-name') as HTMLInputElement).value.trim();
  if (!name) return toast('Give it a name');
  addAssistEntry(name, pickedCat);
};
actions['entry-remove'] = (el) => commit((s) => { s.active!.entries.splice(+el.dataset.e!, 1); });

function lastAssistSet(name: string): LoggedSet | null {
  for (const w of ctx.state.workouts) {
    const e = w.entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const s = e?.sets[e.sets.length - 1];
    if (s && s.reps) return s;
  }
  return null;
}
function openAssistSetSheet(ei: number, si?: number): void {
  const entry = ctx.state.active!.entries[ei];
  const existing = si !== undefined ? entry.sets[si] : null;
  const prev = existing ?? entry.sets[entry.sets.length - 1] ?? lastAssistSet(entry.name);
  stepperValues['w'] = prev?.weight ?? 0;
  stepperValues['r'] = prev?.reps ?? 10;
  const bw = prev?.bodyweight ?? false;
  openSheet(`<h2>${h(entry.name)}</h2>
    <div class="stack">
      ${stepperHtml('w', stepperValues['w'], `${ctx.state.program.units}${bw ? ' added to bodyweight' : ''}`, ctx.state.program.roundTo)}
      ${stepperHtml('r', stepperValues['r'], 'reps', 1)}
      <label class="row"><input type="checkbox" id="assist-bw" ${bw ? 'checked' : ''}> Bodyweight movement</label>
    </div>
    <div class="actions">
      ${existing ? `<button type="button" class="btn danger" data-action="assist-set-del" data-e="${ei}" data-s="${si}">Delete</button>` : `<button type="button" class="btn" data-action="sheet-close">Cancel</button>`}
      <button type="button" class="btn primary" data-action="assist-set-save" data-e="${ei}" ${si !== undefined ? `data-s="${si}"` : ''}>${existing ? 'Save' : 'Add set'}</button>
    </div>`);
}
actions['assist-set-add'] = (el) => openAssistSetSheet(+el.dataset.e!);
actions['assist-set-edit'] = (el) => openAssistSetSheet(+el.dataset.e!, +el.dataset.s!);
actions['assist-set-save'] = (el) => {
  const ei = +el.dataset.e!;
  const si = el.dataset.s !== undefined ? +el.dataset.s : undefined;
  const bw = (document.getElementById('assist-bw') as HTMLInputElement).checked;
  const entry = ctx.state.active!.entries[ei];
  const set: LoggedSet = { weight: stepperValues['w'], reps: stepperValues['r'], kind: 'assistance', done: true, bodyweight: bw || undefined };
  closeSheet();
  commit(() => { if (si !== undefined) entry.sets[si] = set; else entry.sets.push(set); });
  if (si === undefined) startTimer(ctx.state.settings.timerAssist, `${entry.name}`);
};
actions['assist-set-del'] = (el) => {
  const ei = +el.dataset.e!, si = +el.dataset.s!;
  closeSheet();
  commit((s) => { s.active!.entries[ei].sets.splice(si, 1); });
};

// ---- Finish / discard -------------------------------------------------------------

actions['discard-workout'] = () => {
  openSheet(`<h2>Discard this workout?</h2><div class="note">Nothing from this session will be saved.</div>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Keep going</button><button type="button" class="btn danger" data-action="discard-confirm">Discard</button></div>`);
};
actions['discard-confirm'] = () => {
  closeSheet();
  stopTimer();
  void keepAwake(false);
  commit((s) => { s.active = null; });
};

actions['finish-workout'] = () => {
  const w = ctx.state.active!;
  const pending = w.entries.filter((e) => e.lift).flatMap((e) => e.sets).filter((s) => !s.done && s.kind !== 'warmup').length;
  const summary = w.entries.filter((e) => e.lift).map((e) => {
    const t = topSet(w, e.lift!);
    return t ? `${e.name} ${fmtW(t.weight)}×${t.reps}` : e.name;
  }).join(' · ');
  openSheet(`<h2>Finish workout</h2>
    <div class="note">${h(summary)}</div>
    ${pending ? `<div class="note mt">${pending} planned set${pending > 1 ? 's' : ''} not logged — they'll be saved as skipped.</div>` : ''}
    <div class="field mt"><label>Notes</label><input type="text" id="finish-notes" placeholder="How did it go?" style="width:200px;text-align:left" value="${h(w.notes ?? '')}"></div>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Back</button><button type="button" class="btn primary" data-action="finish-confirm">Save &amp; advance</button></div>`);
};
actions['finish-confirm'] = () => {
  const notes = (document.getElementById('finish-notes') as HTMLInputElement).value.trim();
  closeSheet();
  stopTimer();
  void keepAwake(false);
  let cycleCompleted = false;
  let tmTestResults: Array<{ lift: Lift; weight: number; reps: number; min: number }> = [];
  commit((s) => {
    const w = s.active!;
    for (const e of w.entries) {
      for (const set of e.sets) if (!set.done) { set.skipped = true; set.reps = 0; set.done = true; }
      if (e.lift) for (const set of e.sets) if (set.kind === 'tmTest' && !set.skipped) tmTestResults.push({ lift: e.lift, weight: set.weight, reps: set.reps ?? 0, min: set.minReps ?? 3 });
    }
    w.notes = notes || undefined;
    w.finishedAt = Date.now();
    s.workouts.unshift(w);
    s.workouts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    s.active = null;
    const r = nextPosition(s.program, s.position);
    s.position = r.pos;
    cycleCompleted = r.cycleCompleted;
  });
  if (tmTestResults.length) openTmTestSheet(tmTestResults, cycleCompleted);
  else if (cycleCompleted) openBumpSheet();
  else toast('Saved');
};

function openBumpSheet(): void {
  const { program } = ctx.state;
  const next = bumpTms(program);
  openSheet(`<h2>Cycle complete</h2>
    <div class="note">Add the standard increments to your training maxes?</div>
    <div class="mt">${(Object.keys(next) as Lift[]).map((l) => `<div class="field"><label>${LIFT_NAMES[l]}</label><span><b>${fmtW(program.tms[l])}</b> → <b>${fmtW(next[l])}</b></span></div>`).join('')}</div>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Keep current</button><button type="button" class="btn primary" data-action="bump-confirm">Bump TMs</button></div>`);
}
actions['bump-confirm'] = () => {
  closeSheet();
  commit((s) => { s.program.tms = bumpTms(s.program); });
  toast('Training maxes updated');
};

function openTmTestSheet(results: Array<{ lift: Lift; weight: number; reps: number; min: number }>, cycleCompleted: boolean): void {
  const rows = results.map((r) => {
    const pass = r.reps >= r.min;
    const strong = r.reps >= 5;
    const est = roundWeight(e1rm(r.weight, r.reps) * 0.9, ctx.state.program.roundTo, 'down');
    return `<div class="field"><label>${LIFT_NAMES[r.lift]}<span class="hint">${fmtW(r.weight)}×${r.reps} — ${pass ? (strong ? 'strong, TM is good' : 'pass') : 'below target; consider lowering'}</span></label><span class="${pass ? '' : 'muted'}">90% e1RM: <b>${fmtW(est)}</b></span></div>`;
  }).join('');
  openSheet(`<h2>TM test</h2>${rows}
    <div class="note mt">Adjust training maxes on the Program tab if needed.</div>
    <div class="actions"><button type="button" class="btn primary full" data-action="${cycleCompleted ? 'tmtest-then-bump' : 'sheet-close'}">OK</button></div>`);
}
actions['tmtest-then-bump'] = () => { closeSheet(); openBumpSheet(); };

changes['noop'] = () => {};
