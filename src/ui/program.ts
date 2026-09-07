import { LIFTS, LIFT_NAMES, foreverPhases, phaseLabel, simplePhases, positionFromFlatWeek, suggestTm, totalWeeks, type Lift, type Phase, type Position } from '../engine.ts';
import { parseNotes } from '../notesImport.ts';
import { bestE1rmPerLift } from '../stats.ts';
import { sortWorkouts } from '../merge.ts';
import { exportJson, freshState, importJson } from '../store.ts';
import { syncNow, syncStatus } from '../sync.ts';
import { actions, changes, closeSheet, commit, ctx, fmtDate, fmtW, h, openSheet, registerScreen, shareOrDownload, toast } from './core.ts';

function numField(label: string, key: string, value: number, step = 1, hint = ''): string {
  return `<div class="field"><label>${h(label)}${hint ? `<span class="hint">${h(hint)}</span>` : ''}</label>
    <input type="number" inputmode="decimal" step="${step}" value="${value}" data-change="num" data-key="${h(key)}"></div>`;
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let o = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
}
changes['num'] = (el) => {
  const v = parseFloat((el as HTMLInputElement).value);
  if (Number.isNaN(v)) return;
  commit((s) => setPath(s, el.dataset.key!, v));
};
changes['bool'] = (el) => commit((s) => setPath(s, el.dataset.key!, (el as HTMLInputElement).checked));
changes['str'] = (el) => commit((s) => setPath(s, el.dataset.key!, (el as HTMLInputElement).value));

function tmCard(): string {
  const { program, workouts } = ctx.state;
  const best = bestE1rmPerLift(workouts, 56);
  return `<div class="card"><h3>Training maxes</h3>
    <div class="tm-grid">${LIFTS.map((l) => {
      const b = best[l];
      const sug = b ? suggestTm(b.weight, b.reps, 0.9, program.roundTo) : null;
      return `<div class="tm-in"><label for="tm-${l}">${LIFT_NAMES[l]}</label>
        <input id="tm-${l}" type="number" inputmode="decimal" step="${program.roundTo}" value="${program.tms[l]}" data-change="num" data-key="program.tms.${l}">
        <div class="from">${sug ? `90% of ${fmtW(b!.weight)}×${b!.reps} → <a href="#" data-action="tm-use" data-lift="${l}" data-v="${sug}">${fmtW(sug)}</a>` : 'no recent sets'}</div></div>`;
    }).join('')}</div>
    <div class="mt">${LIFTS.map((l) => numField(`${LIFT_NAMES[l]} increment`, `program.increments.${l}`, program.increments[l], program.roundTo, 'added after each cycle')).join('')}</div>
  </div>`;
}
actions['tm-use'] = (el, ev) => { ev.preventDefault(); commit((s) => { s.program.tms[el.dataset.lift as Lift] = +el.dataset.v!; }); };

function positionCard(): string {
  const { program, position } = ctx.state;
  const total = totalWeeks(program);
  const opts: string[] = [];
  for (let fw = 0; fw < total; fw++) {
    const p = positionFromFlatWeek(program, fw);
    const ph = program.phases[p.phase];
    const label = ph.kind === 'seventh' ? phaseLabel(ph) : program.phases.length === 1 ? `Week ${p.week + 1}` : `${ph.kind === 'leader' ? 'Leader' : 'Anchor'} · cycle ${p.cycle + 1} · week ${p.week + 1}`;
    const cur = p.phase === position.phase && p.cycle === position.cycle && p.week === position.week;
    opts.push(`<option value="${fw}" ${cur ? 'selected' : ''}>${label}</option>`);
  }
  return `<div class="card"><h3>Where you are</h3>
    <div class="field"><label>Week</label><select data-change="pos-week" style="width:220px">${opts.join('')}</select></div>
    <div class="field"><label>Next session</label><select data-change="pos-day" style="width:220px">${program.days.map((d, i) => `<option value="${i}" ${i === position.day ? 'selected' : ''}>Day ${String.fromCharCode(65 + i)} · ${d.lifts.map((l) => LIFT_NAMES[l]).join(' + ')}</option>`).join('')}</select></div>
  </div>`;
}
changes['pos-week'] = (el) => commit((s) => { s.position = positionFromFlatWeek(s.program, +(el as HTMLSelectElement).value, s.position.day); });
changes['pos-day'] = (el) => commit((s) => { s.position.day = +(el as HTMLSelectElement).value; });

function daysCard(): string {
  const { program } = ctx.state;
  return `<div class="card"><h3>Sessions per week</h3>
    ${program.days.map((d, i) => `<div class="field"><label>Day ${String.fromCharCode(65 + i)}</label>
      <span class="day-chips">${LIFTS.map((l) => `<button type="button" class="${d.lifts.includes(l) ? 'on' : ''}" data-action="day-toggle" data-day="${i}" data-lift="${l}">${LIFT_NAMES[l]}</button>`).join('')}
      ${program.days.length > 1 ? `<button type="button" data-action="day-remove" data-day="${i}" aria-label="Remove day">✕</button>` : ''}</span></div>`).join('')}
    <div class="mt"><button type="button" class="btn small" data-action="day-add">+ Add day</button></div>
  </div>`;
}
actions['day-toggle'] = (el) => commit((s) => {
  const d = s.program.days[+el.dataset.day!];
  const l = el.dataset.lift as Lift;
  d.lifts = d.lifts.includes(l) ? d.lifts.filter((x) => x !== l) : d.lifts.concat(l);
});
actions['day-add'] = () => commit((s) => { s.program.days.push({ lifts: [] }); });
actions['day-remove'] = (el) => commit((s) => { s.program.days.splice(+el.dataset.day!, 1); s.position.day = Math.min(s.position.day, s.program.days.length - 1); });

function phaseDesc(p: Phase): string {
  if (p.kind === 'seventh') return p.seventh === 'tmTest' ? '70/80/90% ×5, then TM for 3–5 reps' : '70/80/90% ×5';
  const a = p.assistance;
  return `${p.cycles} cycle${p.cycles > 1 ? 's' : ''} · assistance ${a.push}/${a.pull}/${a.single}${p.jokers ? ' · jokers' : ''}`;
}
function phasesCard(): string {
  const { program, position } = ctx.state;
  return `<div class="card"><h3>Template</h3>
    ${program.phases.map((p, i) => `<div class="phase${i === position.phase ? ' current' : ''}">
      <div class="row"><span><span class="name">${h(phaseLabel(p))}</span><div class="desc">${h(phaseDesc(p))}</div></span>
        <button type="button" class="btn small" data-action="phase-edit" data-i="${i}">Edit</button></div></div>`).join('')}
    <div class="row wrap mt"><button type="button" class="btn small" data-action="phase-add">+ Add phase</button>
      <button type="button" class="btn small ghost" data-action="phase-simple">Use plain 5/3/1 + FSL</button>
      <button type="button" class="btn small ghost" data-action="phase-forever">Use Forever (Leader/Anchor)</button></div>
  </div>`;
}
actions['phase-simple'] = () => commit((s) => { s.program.phases = simplePhases(); s.position = { phase: 0, cycle: 0, week: 0, day: 0 }; });
actions['phase-forever'] = () => commit((s) => { s.program.phases = foreverPhases(); s.position = { phase: 0, cycle: 0, week: 0, day: 0 }; });
actions['phase-add'] = () => {
  commit((s) => { s.program.phases.push({ kind: 'leader', cycles: 1, mainScheme: '5sPro', supplemental: { type: 'FSL', sets: 5, reps: 5 }, assistance: { push: 50, pull: 50, single: 50 } }); });
  openPhaseSheet(ctx.state.program.phases.length - 1);
};
actions['phase-edit'] = (el) => openPhaseSheet(+el.dataset.i!);

function openPhaseSheet(i: number): void {
  const p = ctx.state.program.phases[i];
  const sel = (key: string, opts: Array<[string, string]>, val: string) =>
    `<select data-change="phase-str" data-i="${i}" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const num = (key: string, val: number, step = 1) => `<input type="number" inputmode="numeric" step="${step}" value="${val}" data-change="phase-num" data-i="${i}" data-key="${key}">`;
  const isSeventh = p.kind === 'seventh';
  openSheet(`<h2>${h(phaseLabel(p))}</h2>
    <div class="field"><label>Type</label>${sel('kind', [['leader', 'Leader'], ['anchor', 'Anchor'], ['seventh', '7th week']], p.kind)}</div>
    ${isSeventh ? `<div class="field"><label>Protocol</label>${sel('seventh', [['deload', 'Deload'], ['tmTest', 'TM test']], p.seventh ?? 'deload')}</div>` : `
    <div class="field"><label>Cycles<span class="hint">3 weeks each</span></label>${num('cycles', p.cycles)}</div>
    <div class="field"><label>Main sets</label>${sel('mainScheme', [['5sPro', '5s PRO'], ['prSets', 'PR sets (5+/3+/1+)']], p.mainScheme)}</div>
    <div class="field"><label>Supplemental</label>${sel('supplemental.type', [['FSL', 'FSL (first set last)'], ['SSL', 'SSL (second set last)'], ['BBB', 'BBB (fixed %)'], ['none', 'None']], p.supplemental.type)}</div>
    <div class="field"><label>Supplemental sets × reps</label><span class="row">${num('supplemental.sets', p.supplemental.sets)} × ${num('supplemental.reps', p.supplemental.reps)}</span></div>
    ${p.supplemental.type === 'BBB' ? `<div class="field"><label>BBB % of TM</label>${num('supplemental.pct', Math.round((p.supplemental.pct ?? 0.5) * 100), 5)}</div>` : ''}
    <div class="field"><label>Assistance reps<span class="hint">push / pull / single-leg &amp; core, per session</span></label><span class="row">${num('assistance.push', p.assistance.push, 5)} ${num('assistance.pull', p.assistance.pull, 5)} ${num('assistance.single', p.assistance.single, 5)}</span></div>
    <div class="field"><label>Joker sets allowed</label><input type="checkbox" ${p.jokers ? 'checked' : ''} data-change="phase-bool" data-i="${i}" data-key="jokers"></div>`}
    <div class="actions">
      <button type="button" class="btn danger" data-action="phase-delete" data-i="${i}">Delete phase</button>
      <button type="button" class="btn primary" data-action="sheet-close">Done</button>
    </div>`);
}
changes['phase-str'] = (el) => {
  const i = +el.dataset.i!;
  commit((s) => {
    const p = s.program.phases[i];
    setPath(p, el.dataset.key!, (el as HTMLSelectElement).value);
    if (p.kind === 'seventh') { p.cycles = 1; p.seventh = p.seventh ?? 'deload'; }
  });
  openPhaseSheet(i);
};
changes['phase-num'] = (el) => {
  const i = +el.dataset.i!;
  let v = parseFloat((el as HTMLInputElement).value);
  if (Number.isNaN(v)) return;
  if (el.dataset.key === 'supplemental.pct') v = v / 100;
  if (el.dataset.key === 'cycles') v = Math.max(1, Math.round(v));
  commit((s) => setPath(s.program.phases[i], el.dataset.key!, v));
};
changes['phase-bool'] = (el) => commit((s) => setPath(s.program.phases[+el.dataset.i!], el.dataset.key!, (el as HTMLInputElement).checked));
actions['phase-delete'] = (el) => {
  closeSheet();
  commit((s) => {
    if (s.program.phases.length <= 1) return;
    s.program.phases.splice(+el.dataset.i!, 1);
    s.position = { phase: 0, cycle: 0, week: 0, day: 0 } as Position;
  });
};

function settingsCard(): string {
  const { program, settings } = ctx.state;
  return `<div class="card"><h3>Settings</h3>
    <div class="field"><label>Units</label><select data-change="units" style="width:100px"><option value="lb" ${program.units === 'lb' ? 'selected' : ''}>lb</option><option value="kg" ${program.units === 'kg' ? 'selected' : ''}>kg</option></select></div>
    ${numField('Round to', 'program.roundTo', program.roundTo, 0.5, 'smallest jump you can load')}
    <div class="field"><label>Rounding</label><select data-change="str" data-key="program.roundMode" style="width:120px"><option value="nearest" ${program.roundMode === 'nearest' ? 'selected' : ''}>Nearest</option><option value="down" ${program.roundMode === 'down' ? 'selected' : ''}>Down</option></select></div>
    ${numField('Bar weight', 'program.barWeight', program.barWeight, 1)}
    <div class="field"><label>Warm-up sets<span class="hint">40/50/60% × 5/5/3</span></label><input type="checkbox" ${program.warmup ? 'checked' : ''} data-change="bool" data-key="program.warmup"></div>
    ${numField('Rest · main sets', 'settings.timerMain', settings.timerMain, 15, 'seconds')}
    ${numField('Rest · supplemental', 'settings.timerSupp', settings.timerSupp, 15, 'seconds')}
    ${numField('Rest · assistance & warm-up', 'settings.timerAssist', settings.timerAssist, 15, 'seconds')}
    <div class="field"><label>Timer sound</label><input type="checkbox" ${settings.sound ? 'checked' : ''} data-change="bool" data-key="settings.sound"></div>
    <div class="field"><label>Vibrate</label><input type="checkbox" ${settings.vibrate ? 'checked' : ''} data-change="bool" data-key="settings.vibrate"></div>
    <div class="field"><label>Keep screen on during workouts</label><input type="checkbox" ${settings.keepAwake ? 'checked' : ''} data-change="bool" data-key="settings.keepAwake"></div>
    <div class="field"><label>Plates per side<span class="hint">comma separated</span></label><input type="text" value="${settings.plates.join(', ')}" data-change="plates" style="width:170px"></div>
  </div>`;
}
changes['units'] = (el) => commit((s) => {
  const u = (el as HTMLSelectElement).value as 'lb' | 'kg';
  s.program.units = u;
  s.program.roundTo = u === 'lb' ? 5 : 2.5;
  s.program.barWeight = u === 'lb' ? 45 : 20;
  s.settings.plates = u === 'lb' ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
});
changes['plates'] = (el) => commit((s) => {
  const v = (el as HTMLInputElement).value.split(/[,\s]+/).map(Number).filter((n) => n > 0);
  if (v.length) s.settings.plates = v.sort((a, b) => b - a);
});

function syncLine(): string {
  const st = syncStatus();
  const ago = (t: number) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : fmtDate(new Date(t).toISOString().slice(0, 10));
  };
  let text: string;
  switch (st.phase) {
    case 'disabled': text = 'Sync off · this preview is not served by the Worker, so data stays on this device.'; break;
    case 'syncing': text = 'Syncing…'; break;
    case 'offline': text = `Offline${st.dirty ? ' · changes will sync when you are back online' : ''}.`; break;
    case 'error': text = `Sync problem: ${st.error ?? 'unknown'}.`; break;
    default: text = st.dirty ? 'Changes pending…' : st.lastSyncAt ? `Synced with your account ${ago(st.lastSyncAt)}.` : 'Sync ready.';
  }
  const btn = st.phase === 'disabled' ? '' : ` <a href="#" data-action="sync-now">Sync now</a>`;
  return `<div class="muted small" id="sync-status">${h(text)}${btn}</div>`;
}
actions['sync-now'] = (el, ev) => { ev.preventDefault(); void syncNow().then(() => { const st = syncStatus(); if (st.phase === 'idle') toast('Synced'); }); };

function dataCard(): string {
  const n = ctx.state.workouts.length;
  const synced = syncStatus().phase !== 'disabled';
  return `<div class="card"><h3>Your data</h3>
    <div class="muted small">${n} sessions${synced ? ', synced across your devices through your account.' : ' stored on this device only.'} Export regularly — a backup is a JSON file you can re-import anywhere.</div>
    ${syncLine()}
    <div class="row wrap mt">
      <button type="button" class="btn" data-action="export-json">Export backup</button>
      <button type="button" class="btn" data-action="import-json">Import backup</button>
      <button type="button" class="btn" data-action="import-notes">Import notes</button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <div class="mt"><button type="button" class="btn ghost danger small" data-action="reset-all">Erase everything</button></div>
  </div>`;
}
actions['export-json'] = () => {
  openSheet(`<h2>Export backup</h2><div class="note">A JSON file with your program, settings and every session.</div>
    <div class="actions"><button type="button" class="btn" data-action="export-copy">Copy to clipboard</button><button type="button" class="btn primary" data-action="export-file">Share / download</button></div>`);
};
actions['export-file'] = () => { closeSheet(); void shareOrDownload(`fivethreeone-${new Date().toISOString().slice(0, 10)}.json`, exportJson(ctx.state)); };
actions['export-copy'] = async () => {
  closeSheet();
  try { await navigator.clipboard.writeText(exportJson(ctx.state)); toast('Backup copied'); } catch { toast('Clipboard unavailable'); }
};
actions['import-json'] = () => {
  const input = document.getElementById('import-file') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const text = await f.text();
    openSheet(`<h2>Import backup</h2><div class="note">${h(f.name)}</div>
      <div class="actions"><button type="button" class="btn" data-action="import-do" data-mode="merge">Merge sessions</button><button type="button" class="btn danger" data-action="import-do" data-mode="replace">Replace everything</button></div>`);
    (window as unknown as { __importText: string }).__importText = text;
    input.value = '';
  };
  input.click();
};
actions['import-do'] = (el) => {
  const text = (window as unknown as { __importText: string }).__importText;
  closeSheet();
  try {
    const next = importJson(ctx.state, text, el.dataset.mode as 'merge' | 'replace');
    ctx.state = next;
    commit();
    toast(`Imported · ${ctx.state.workouts.length} sessions`);
  } catch (e) {
    toast((e as Error).message);
  }
};
actions['import-notes'] = () => {
  openSheet(`<h2>Import notes</h2>
    <div class="note">Paste a log like <code>Sept 4</code> / <code>OHP 120x6 95x5x4</code> / <code>Deads 355x8, 225x5x3</code>. Newest first; years are inferred.</div>
    <textarea id="notes-text" autofocus placeholder="Sept 4&#10;OHP 120x6 95x5x4&#10;Deads 355x8, 225x5x3"></textarea>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="button" class="btn primary" data-action="import-notes-do">Import</button></div>`);
};
actions['import-notes-do'] = () => {
  const text = (document.getElementById('notes-text') as HTMLTextAreaElement).value;
  const res = parseNotes(text);
  if (!res.workouts.length) return toast('No dated sessions found');
  closeSheet();
  commit((s) => {
    const keys = new Set(s.workouts.map((w) => `${w.date}|${w.raw ?? ''}`));
    const now = Date.now();
    for (const w of res.workouts) if (!keys.has(`${w.date}|${w.raw ?? ''}`)) s.workouts.push({ ...w, updatedAt: now });
    sortWorkouts(s.workouts);
  });
  toast(`Imported ${res.workouts.length} sessions${res.warnings.length ? ` · ${res.warnings.length} warnings` : ''}`);
};
actions['reset-all'] = () => {
  const where = syncStatus().phase === 'disabled' ? 'on this device' : 'on every device signed in to your account';
  openSheet(`<h2>Erase everything?</h2><div class="note">Program, settings and all ${ctx.state.workouts.length} sessions ${where}. Export a backup first.</div>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="button" class="btn danger" data-action="reset-confirm">Erase</button></div>`);
};
actions['reset-confirm'] = () => {
  closeSheet();
  const now = Date.now();
  const tombstones = { ...(ctx.state.tombstones ?? {}) };
  for (const w of ctx.state.workouts) tombstones[w.id] = now;
  ctx.state = freshState();
  ctx.state.workouts = [];
  ctx.state.tombstones = tombstones;
  commit();
};

function renderProgram(): string {
  return `<header class="screen-head"><div><div class="eyebrow">5/3/1 Forever</div><h1>Program</h1></div></header>
    ${tmCard()}${positionCard()}${daysCard()}${phasesCard()}${settingsCard()}${dataCard()}
    <div class="muted small" style="padding:8px 4px 20px">Percentages from Wendler's 5/3/1 Forever. e1RM = weight × reps × 0.0333 + weight.</div>`;
}
registerScreen('program', renderProgram);
