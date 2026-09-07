import { useState, type ReactElement } from 'react';
import { e1rm } from '../engine.ts';
import { sortWorkouts } from '../merge.ts';
import { todayISO, uid, type Workout } from '../model.ts';
import { parseNotes } from '../notesImport.ts';
import { fmtDate } from '../format.ts';
import { setStr, workoutSummary, workoutToText } from '../workoutText.ts';
import { useSheet } from '../app/sheet.tsx';
import { useStore } from '../app/store.tsx';
import { useToast } from '../app/toast.tsx';
import { Field } from '../components/Field.tsx';

export function History() {
  const { state } = useStore();
  const sheet = useSheet();
  const [openId, setOpenId] = useState<string | null>(null);
  const w = openId ? state.workouts.find((x) => x.id === openId) : undefined;
  const open = (id: string | null) => { setOpenId(id); window.scrollTo({ top: 0 }); };

  if (w) {
    return (
      <>
        <header className="screen-head">
          <div>
            <button type="button" className="btn ghost small" data-action="hist-back" style={{ paddingLeft: 0 }} onClick={() => open(null)}>‹ History</button>
            <h1>{fmtDate(w.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1>
          </div>
        </header>
        <Detail w={w} onDeleted={() => open(null)} />
      </>
    );
  }
  const n = state.workouts.length;
  return (
    <>
      <header className="screen-head">
        <div><div className="eyebrow">{n} session{n === 1 ? '' : 's'}</div><h1>History</h1></div>
        <button type="button" className="btn small" data-action="hist-add" onClick={() => sheet.open(<TextEditorSheet title="Add past session" date={todayISO()} text="" onSaved={open} />)}>+ Past session</button>
      </header>
      <List onOpen={open} />
    </>
  );
}

function List({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useStore();
  const ws = state.workouts;
  if (!ws.length) return <div className="empty">No sessions yet. Finish a workout on Today, or add a past session below.</div>;
  const items: ReactElement[] = [];
  let lastMonth = '';
  for (const w of ws) {
    const month = w.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      items.push(<div key={`m-${month}`} className="eyebrow month">{fmtDate(w.date, { month: 'long', year: 'numeric' })}</div>);
    }
    items.push(
      <button key={w.id} type="button" className="list-item" data-action="hist-open" data-id={w.id} onClick={() => onOpen(w.id)}>
        <span>
          <span className="d">{fmtDate(w.date, { weekday: 'short', month: 'short', day: 'numeric' })}{w.dateUncertain ? <> <span className="muted">(approx.)</span></> : null}</span>
          <span className="s">{workoutSummary(w)}</span>
        </span>
        <span className="chev">›</span>
      </button>,
    );
  }
  return <div className="card list">{items}</div>;
}

function Detail({ w, onDeleted }: { w: Workout; onDeleted: () => void }) {
  const { state } = useStore();
  const sheet = useSheet();
  const units = state.program.units;
  return (
    <>
      <div className="card">
        {w.title && <div className="eyebrow">{w.title}</div>}
        {w.entries.map((e, i) => (
          <div className="entry" key={i}>
            <div className="row">
              <span><span className="name">{e.name}</span>{e.category && <span className="cat">{e.category}</span>}</span>
              {e.lift && <span className="muted small">best e1RM {Math.round(Math.max(0, ...e.sets.filter((s) => s.reps && !s.skipped).map((s) => e1rm(s.weight, s.reps!))))} {units}</span>}
            </div>
            <div className="setline">{e.sets.map((s, si) => <span key={si} className={`setpill${s.skipped ? ' muted' : ''}`}>{setStr(s)}</span>)}</div>
            {e.note && <div className="muted small">{e.note}</div>}
          </div>
        ))}
        {w.notes && <div className="mt muted" style={{ whiteSpace: 'pre-wrap' }}>{w.notes}</div>}
      </div>
      <div className="row">
        <button type="button" className="btn" data-action="hist-edit" onClick={() => sheet.open(<TextEditorSheet title="Edit session" date={w.date} text={workoutToText(w) + (w.notes ? `\n${w.notes}` : '')} id={w.id} />)}>Edit as text</button>
        <button type="button" className="btn danger" data-action="hist-delete" onClick={() => sheet.open(<DeleteSheet id={w.id} onDeleted={onDeleted} />)}>Delete</button>
      </div>
    </>
  );
}

function DeleteSheet({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { commit } = useStore();
  const sheet = useSheet();
  const del = () => {
    sheet.close();
    onDeleted();
    commit((s) => {
      s.workouts = s.workouts.filter((w) => w.id !== id);
      (s.tombstones ??= {})[id] = Date.now();
    });
  };
  return (
    <>
      <h2>Delete this session?</h2>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn danger" data-action="hist-delete-confirm" onClick={del}>Delete</button>
      </div>
    </>
  );
}

function TextEditorSheet({ title, date: initialDate, text: initialText, id, onSaved }: { title: string; date: string; text: string; id?: string; onSaved?: (id: string) => void }) {
  const { commit } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState(initialText);
  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Pick a date');
    const d = new Date(date + 'T00:00:00');
    const header = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const res = parseNotes(`${header}\n${text}`, { today: new Date(d.getFullYear(), 11, 31) });
    const parsed = res.workouts[0];
    if (!parsed) return toast('Nothing to save');
    sheet.close();
    let savedId = id ?? '';
    commit((s) => {
      const existing = id ? s.workouts.find((w) => w.id === id) : undefined;
      const w: Workout = existing ?? { id: uid(), date, entries: [], source: 'app' };
      w.date = date;
      w.entries = parsed.entries;
      w.notes = parsed.notes;
      w.dateUncertain = undefined;
      w.updatedAt = Date.now();
      if (!existing) s.workouts.push(w);
      sortWorkouts(s.workouts);
      savedId = w.id;
    });
    onSaved?.(savedId);
    if (res.warnings.length) toast(res.warnings[0].message);
  };
  return (
    <>
      <h2>{title}</h2>
      <div className="note">One exercise per line, like your notes: <code>Squat 225x5, 175x5x5</code>, <code>Dips bw+25x8x3</code>, <code>Deads 135 185 225x5</code>.</div>
      <div className="mt">
        <Field label="Date">
          <input type="date" id="edit-date" value={date} onChange={(e) => setDate(e.target.value)} style={{ minHeight: 42, padding: '6px 10px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)' }} />
        </Field>
      </div>
      <textarea id="edit-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn primary" data-action="hist-save-text" onClick={save}>Save</button>
      </div>
    </>
  );
}
