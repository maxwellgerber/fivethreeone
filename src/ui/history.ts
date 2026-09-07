import { e1rm } from '../engine.ts';
import { todayISO, uid, type LoggedSet, type Workout } from '../model.ts';
import { parseNotes } from '../notesImport.ts';
import { actions, closeSheet, commit, ctx, fmtDate, fmtW, h, openSheet, registerScreen, toast } from './core.ts';

function setStr(s: LoggedSet): string {
  if (s.skipped) return '—';
  const w = s.bodyweight ? (s.weight ? `BW+${fmtW(s.weight)}` : 'BW') : fmtW(s.weight);
  return `${w}×${s.reps ?? '?'}`;
}

/** Compress a list of sets into "225×5, 175×5×5" notation. */
export function compressSets(sets: LoggedSet[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i];
    let n = 1;
    while (i + n < sets.length && sets[i + n].weight === s.weight && sets[i + n].reps === s.reps && !!sets[i + n].bodyweight === !!s.bodyweight && !sets[i + n].skipped && !s.skipped) n++;
    out.push(n > 1 ? `${setStr(s)}×${n}` : setStr(s));
    i += n;
  }
  return out.join(', ');
}

export function workoutToText(w: Workout): string {
  return w.entries
    .map((e) => {
      const sets = e.sets.filter((s) => !s.skipped);
      return `${e.name} ${compressSets(sets).replace(/×/g, 'x')}${e.note ? ` (${e.note})` : ''}`.trim();
    })
    .join('\n');
}

function summary(w: Workout): string {
  const mains = w.entries.filter((e) => e.lift);
  if (mains.length) {
    return mains.map((e) => {
      let best: LoggedSet | null = null;
      for (const s of e.sets) if (s.reps && !s.skipped && (!best || e1rm(s.weight, s.reps) > e1rm(best.weight, best.reps!))) best = s;
      return best ? `${e.name} ${fmtW(best.weight)}×${best.reps}` : e.name;
    }).join(' · ');
  }
  return w.entries.map((e) => e.name).join(' · ') || (w.notes ?? 'Notes');
}

function renderList(): string {
  const ws = ctx.state.workouts;
  if (!ws.length) return `<div class="empty">No sessions yet. Finish a workout on Today, or add a past session below.</div>`;
  let lastMonth = '';
  const items: string[] = [];
  for (const w of ws) {
    const month = w.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      items.push(`<div class="eyebrow month">${fmtDate(w.date, { month: 'long', year: 'numeric' })}</div>`);
    }
    items.push(`<button type="button" class="list-item" data-action="hist-open" data-id="${h(w.id)}">
      <span><span class="d">${fmtDate(w.date, { weekday: 'short', month: 'short', day: 'numeric' })}${w.dateUncertain ? ' <span class="muted">(approx.)</span>' : ''}</span><span class="s">${h(summary(w))}</span></span>
      <span class="chev">›</span></button>`);
  }
  return `<div class="card list">${items.join('')}</div>`;
}

function renderDetail(w: Workout): string {
  const units = ctx.state.program.units;
  return `<div class="card">
    ${w.title ? `<div class="eyebrow">${h(w.title)}</div>` : ''}
    ${w.entries.map((e) => `<div class="entry">
      <div class="row"><span><span class="name">${h(e.name)}</span>${e.category ? `<span class="cat">${h(e.category)}</span>` : ''}</span>
        ${e.lift ? `<span class="muted small">best e1RM ${Math.round(Math.max(0, ...e.sets.filter((s) => s.reps && !s.skipped).map((s) => e1rm(s.weight, s.reps!))))} ${units}</span>` : ''}</div>
      <div class="setline">${e.sets.map((s) => `<span class="setpill${s.skipped ? ' muted' : ''}">${setStr(s)}</span>`).join('')}</div>
      ${e.note ? `<div class="muted small">${h(e.note)}</div>` : ''}
    </div>`).join('')}
    ${w.notes ? `<div class="mt muted" style="white-space:pre-wrap">${h(w.notes)}</div>` : ''}
  </div>
  <div class="row">
    <button type="button" class="btn" data-action="hist-edit" data-id="${h(w.id)}">Edit as text</button>
    <button type="button" class="btn danger" data-action="hist-delete" data-id="${h(w.id)}">Delete</button>
  </div>`;
}

function renderHistory(): string {
  const id = ctx.view.histId as string | undefined;
  const w = id ? ctx.state.workouts.find((x) => x.id === id) : undefined;
  if (w) {
    return `<header class="screen-head"><div>
        <button type="button" class="btn ghost small" data-action="hist-back" style="padding-left:0">‹ History</button>
        <h1>${h(fmtDate(w.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</h1>
      </div></header>${renderDetail(w)}`;
  }
  const n = ctx.state.workouts.length;
  return `<header class="screen-head"><div><div class="eyebrow">${n} session${n === 1 ? '' : 's'}</div><h1>History</h1></div>
      <button type="button" class="btn small" data-action="hist-add">+ Past session</button></header>
    ${renderList()}`;
}
registerScreen('history', renderHistory);

actions['hist-open'] = (el) => { ctx.view.histId = el.dataset.id; window.scrollTo({ top: 0 }); commit(); };
actions['hist-back'] = () => { delete ctx.view.histId; commit(); };
actions['hist-delete'] = (el) => {
  const id = el.dataset.id!;
  openSheet(`<h2>Delete this session?</h2><div class="actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="button" class="btn danger" data-action="hist-delete-confirm" data-id="${h(id)}">Delete</button></div>`);
};
actions['hist-delete-confirm'] = (el) => {
  closeSheet();
  delete ctx.view.histId;
  commit((s) => { s.workouts = s.workouts.filter((w) => w.id !== el.dataset.id); });
};

function textEditorSheet(title: string, date: string, text: string, id?: string): void {
  openSheet(`<h2>${title}</h2>
    <div class="note">One exercise per line, like your notes: <code>Squat 225x5, 175x5x5</code>, <code>Dips bw+25x8x3</code>, <code>Deads 135 185 225x5</code>.</div>
    <div class="field mt"><label>Date</label><input type="date" id="edit-date" value="${h(date)}" style="min-height:42px;padding:6px 10px;border-radius:9px;border:1px solid var(--line);background:var(--surface-2)"></div>
    <textarea id="edit-text" autofocus>${h(text)}</textarea>
    <div class="actions"><button type="button" class="btn" data-action="sheet-close">Cancel</button><button type="button" class="btn primary" data-action="hist-save-text" ${id ? `data-id="${h(id)}"` : ''}>Save</button></div>`);
}
actions['hist-edit'] = (el) => {
  const w = ctx.state.workouts.find((x) => x.id === el.dataset.id)!;
  textEditorSheet('Edit session', w.date, workoutToText(w) + (w.notes ? `\n${w.notes}` : ''), w.id);
};
actions['hist-add'] = () => textEditorSheet('Add past session', todayISO(), '');
actions['hist-save-text'] = (el) => {
  const date = (document.getElementById('edit-date') as HTMLInputElement).value;
  const text = (document.getElementById('edit-text') as HTMLTextAreaElement).value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Pick a date');
  const d = new Date(date + 'T00:00:00');
  const header = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const res = parseNotes(`${header}\n${text}`, { today: new Date(d.getFullYear(), 11, 31) });
  const parsed = res.workouts[0];
  if (!parsed) return toast('Nothing to save');
  const id = el.dataset.id;
  closeSheet();
  commit((s) => {
    const existing = id ? s.workouts.find((w) => w.id === id) : undefined;
    const w: Workout = existing ?? { id: uid(), date, entries: [], source: 'app' };
    w.date = date;
    w.entries = parsed.entries;
    w.notes = parsed.notes;
    w.dateUncertain = undefined;
    if (!existing) s.workouts.push(w);
    s.workouts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    ctx.view.histId = w.id;
  });
  if (res.warnings.length) toast(res.warnings[0].message);
};
