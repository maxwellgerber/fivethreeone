import { useRef, useState, type ReactElement } from 'react';
import { LIFTS, LIFT_NAMES, foreverPhases, phaseLabel, simplePhases, positionFromFlatWeek, suggestTm, totalWeeks, type Lift, type Phase } from '../engine.ts';
import { sortWorkouts } from '../merge.ts';
import { parseNotes } from '../notesImport.ts';
import { bestE1rmPerLift } from '../stats.ts';
import { exportJson, freshState, importJson } from '../store.ts';
import { syncNow } from '../sync.ts';
import { fmtW, shareOrDownload, timeAgo } from '../format.ts';
import { useSheet } from '../app/sheet.tsx';
import { useStore } from '../app/store.tsx';
import { useSyncStatus } from '../app/syncStatus.tsx';
import { useToast } from '../app/toast.tsx';
import { Field, NumInput } from '../components/Field.tsx';

export function Program() {
  return (
    <>
      <header className="screen-head"><div><div className="eyebrow">5/3/1 Forever</div><h1>Program</h1></div></header>
      <TmCard />
      <PositionCard />
      <DaysCard />
      <PhasesCard />
      <SettingsCard />
      <DataCard />
      <div className="muted small" style={{ padding: '8px 4px 20px' }}>Percentages from Wendler's 5/3/1 Forever. e1RM = weight × reps × 0.0333 + weight.</div>
    </>
  );
}

function TmCard() {
  const { state, commit } = useStore();
  const { program, workouts } = state;
  const best = bestE1rmPerLift(workouts, 56);
  return (
    <div className="card">
      <h3>Training maxes</h3>
      <div className="tm-grid">
        {LIFTS.map((l) => {
          const b = best[l];
          const sug = b ? suggestTm(b.weight, b.reps, 0.9, program.roundTo) : null;
          return (
            <div className="tm-in" key={l}>
              <label htmlFor={`tm-${l}`}>{LIFT_NAMES[l]}</label>
              <NumInput id={`tm-${l}`} value={program.tms[l]} step={program.roundTo} onChange={(v) => commit((s) => { s.program.tms[l] = v; })} />
              <div className="from">
                {sug && b ? <>90% of {fmtW(b.weight)}×{b.reps} → <a href="#" onClick={(e) => { e.preventDefault(); commit((s) => { s.program.tms[l] = sug; }); }}>{fmtW(sug)}</a></> : 'no recent sets'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt">
        {LIFTS.map((l) => (
          <Field key={l} label={`${LIFT_NAMES[l]} increment`} hint="added after each cycle">
            <NumInput value={program.increments[l]} step={program.roundTo} onChange={(v) => commit((s) => { s.program.increments[l] = v; })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

function PositionCard() {
  const { state, commit } = useStore();
  const { program, position } = state;
  const total = totalWeeks(program);
  const opts: ReactElement[] = [];
  let currentFw = 0;
  for (let fw = 0; fw < total; fw++) {
    const p = positionFromFlatWeek(program, fw);
    const ph = program.phases[p.phase];
    const label = ph.kind === 'seventh' ? phaseLabel(ph) : program.phases.length === 1 ? `Week ${p.week + 1}` : `${ph.kind === 'leader' ? 'Leader' : 'Anchor'} · cycle ${p.cycle + 1} · week ${p.week + 1}`;
    if (p.phase === position.phase && p.cycle === position.cycle && p.week === position.week) currentFw = fw;
    opts.push(<option key={fw} value={fw}>{label}</option>);
  }
  return (
    <div className="card">
      <h3>Where you are</h3>
      <Field label="Week">
        <select style={{ width: 220 }} value={currentFw} onChange={(e) => commit((s) => { s.position = positionFromFlatWeek(s.program, +e.target.value, s.position.day); })}>{opts}</select>
      </Field>
      <Field label="Next session">
        <select style={{ width: 220 }} value={position.day} onChange={(e) => commit((s) => { s.position.day = +e.target.value; })}>
          {program.days.map((d, i) => <option key={i} value={i}>Day {String.fromCharCode(65 + i)} · {d.lifts.map((l) => LIFT_NAMES[l]).join(' + ')}</option>)}
        </select>
      </Field>
    </div>
  );
}

function DaysCard() {
  const { state, commit } = useStore();
  const { program } = state;
  return (
    <div className="card">
      <h3>Sessions per week</h3>
      {program.days.map((d, i) => (
        <Field key={i} label={`Day ${String.fromCharCode(65 + i)}`}>
          <span className="day-chips">
            {LIFTS.map((l) => (
              <button key={l} type="button" className={d.lifts.includes(l) ? 'on' : ''} onClick={() => commit((s) => {
                const day = s.program.days[i];
                day.lifts = day.lifts.includes(l) ? day.lifts.filter((x) => x !== l) : day.lifts.concat(l);
              })}>{LIFT_NAMES[l]}</button>
            ))}
            {program.days.length > 1 && (
              <button type="button" aria-label="Remove day" onClick={() => commit((s) => { s.program.days.splice(i, 1); s.position.day = Math.min(s.position.day, s.program.days.length - 1); })}>✕</button>
            )}
          </span>
        </Field>
      ))}
      <div className="mt"><button type="button" className="btn small" onClick={() => commit((s) => { s.program.days.push({ lifts: [] }); })}>+ Add day</button></div>
    </div>
  );
}

function phaseDesc(p: Phase): string {
  if (p.kind === 'seventh') return p.seventh === 'tmTest' ? '70/80/90% ×5, then TM for 3–5 reps' : '70/80/90% ×5';
  const a = p.assistance;
  return `${p.cycles} cycle${p.cycles > 1 ? 's' : ''} · assistance ${a.push}/${a.pull}/${a.single}${p.jokers ? ' · jokers' : ''}`;
}

function PhasesCard() {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const { program, position } = state;
  const reset = (phases: Phase[]) => commit((s) => { s.program.phases = phases; s.position = { phase: 0, cycle: 0, week: 0, day: 0 }; });
  const addPhase = () => {
    const next = commit((s) => { s.program.phases.push({ kind: 'leader', cycles: 1, mainScheme: '5sPro', supplemental: { type: 'FSL', sets: 5, reps: 5 }, assistance: { push: 50, pull: 50, single: 50 } }); });
    sheet.open(<PhaseSheet i={next.program.phases.length - 1} />);
  };
  return (
    <div className="card">
      <h3>Template</h3>
      {program.phases.map((p, i) => (
        <div key={i} className={`phase${i === position.phase ? ' current' : ''}`}>
          <div className="row">
            <span><span className="name">{phaseLabel(p)}</span><div className="desc">{phaseDesc(p)}</div></span>
            <button type="button" className="btn small" onClick={() => sheet.open(<PhaseSheet i={i} />)}>Edit</button>
          </div>
        </div>
      ))}
      <div className="row wrap mt">
        <button type="button" className="btn small" onClick={addPhase}>+ Add phase</button>
        <button type="button" className="btn small ghost" onClick={() => reset(simplePhases())}>Use plain 5/3/1 + FSL</button>
        <button type="button" className="btn small ghost" onClick={() => reset(foreverPhases())}>Use Forever (Leader/Anchor)</button>
      </div>
    </div>
  );
}

function PhaseSheet({ i }: { i: number }) {
  const { state, commit } = useStore();
  const sheet = useSheet();
  const p = state.program.phases[i];
  if (!p) return null;
  const edit = (mut: (p: Phase) => void) => commit((s) => mut(s.program.phases[i]));
  const isSeventh = p.kind === 'seventh';
  const num = (value: number, onChange: (v: number) => void, step = 1) => <NumInput value={value} step={step} inputMode="numeric" onChange={onChange} />;
  return (
    <>
      <h2>{phaseLabel(p)}</h2>
      <Field label="Type">
        <select value={p.kind} onChange={(e) => edit((q) => { q.kind = e.target.value as Phase['kind']; if (q.kind === 'seventh') { q.cycles = 1; q.seventh = q.seventh ?? 'deload'; } })}>
          <option value="leader">Leader</option><option value="anchor">Anchor</option><option value="seventh">7th week</option>
        </select>
      </Field>
      {isSeventh ? (
        <Field label="Protocol">
          <select value={p.seventh ?? 'deload'} onChange={(e) => edit((q) => { q.seventh = e.target.value as Phase['seventh']; })}>
            <option value="deload">Deload</option><option value="tmTest">TM test</option>
          </select>
        </Field>
      ) : (
        <>
          <Field label="Cycles" hint="3 weeks each">{num(p.cycles, (v) => edit((q) => { q.cycles = Math.max(1, Math.round(v)); }))}</Field>
          <Field label="Main sets">
            <select value={p.mainScheme} onChange={(e) => edit((q) => { q.mainScheme = e.target.value as Phase['mainScheme']; })}>
              <option value="5sPro">5s PRO</option><option value="prSets">PR sets (5+/3+/1+)</option>
            </select>
          </Field>
          <Field label="Supplemental">
            <select value={p.supplemental.type} onChange={(e) => edit((q) => { q.supplemental.type = e.target.value as Phase['supplemental']['type']; })}>
              <option value="FSL">FSL (first set last)</option><option value="SSL">SSL (second set last)</option><option value="BBB">BBB (fixed %)</option><option value="none">None</option>
            </select>
          </Field>
          <Field label="Supplemental sets × reps">
            <span className="row">{num(p.supplemental.sets, (v) => edit((q) => { q.supplemental.sets = v; }))} × {num(p.supplemental.reps, (v) => edit((q) => { q.supplemental.reps = v; }))}</span>
          </Field>
          {p.supplemental.type === 'BBB' && <Field label="BBB % of TM">{num(Math.round((p.supplemental.pct ?? 0.5) * 100), (v) => edit((q) => { q.supplemental.pct = v / 100; }), 5)}</Field>}
          <Field label="Assistance reps" hint="push / pull / single-leg & core, per session">
            <span className="row">
              {num(p.assistance.push, (v) => edit((q) => { q.assistance.push = v; }), 5)}
              {num(p.assistance.pull, (v) => edit((q) => { q.assistance.pull = v; }), 5)}
              {num(p.assistance.single, (v) => edit((q) => { q.assistance.single = v; }), 5)}
            </span>
          </Field>
          <Field label="Joker sets allowed"><input type="checkbox" checked={!!p.jokers} onChange={(e) => edit((q) => { q.jokers = e.target.checked; })} /></Field>
        </>
      )}
      <div className="actions">
        <button type="button" className="btn danger" onClick={() => { sheet.close(); commit((s) => { if (s.program.phases.length <= 1) return; s.program.phases.splice(i, 1); s.position = { phase: 0, cycle: 0, week: 0, day: 0 }; }); }}>Delete phase</button>
        <button type="button" className="btn primary" onClick={sheet.close}>Done</button>
      </div>
    </>
  );
}

function SettingsCard() {
  const { state, commit } = useStore();
  const { program, settings } = state;
  const bool = (label: string, value: boolean, set: (s: typeof state, v: boolean) => void) => (
    <Field label={label}><input type="checkbox" checked={value} onChange={(e) => commit((s) => set(s, e.target.checked))} /></Field>
  );
  return (
    <div className="card">
      <h3>Settings</h3>
      <Field label="Units">
        <select style={{ width: 100 }} value={program.units} onChange={(e) => commit((s) => {
          const u = e.target.value as 'lb' | 'kg';
          s.program.units = u;
          s.program.roundTo = u === 'lb' ? 5 : 2.5;
          s.program.barWeight = u === 'lb' ? 45 : 20;
          s.settings.plates = u === 'lb' ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
        })}><option value="lb">lb</option><option value="kg">kg</option></select>
      </Field>
      <Field label="Round to" hint="smallest jump you can load"><NumInput value={program.roundTo} step={0.5} onChange={(v) => commit((s) => { s.program.roundTo = v; })} /></Field>
      <Field label="Rounding">
        <select style={{ width: 120 }} value={program.roundMode} onChange={(e) => commit((s) => { s.program.roundMode = e.target.value as 'nearest' | 'down'; })}><option value="nearest">Nearest</option><option value="down">Down</option></select>
      </Field>
      <Field label="Bar weight"><NumInput value={program.barWeight} onChange={(v) => commit((s) => { s.program.barWeight = v; })} /></Field>
      {bool('Warm-up sets', program.warmup, (s, v) => { s.program.warmup = v; })}
      <Field label="Rest · main sets" hint="seconds"><NumInput value={settings.timerMain} step={15} onChange={(v) => commit((s) => { s.settings.timerMain = v; })} /></Field>
      <Field label="Rest · supplemental" hint="seconds"><NumInput value={settings.timerSupp} step={15} onChange={(v) => commit((s) => { s.settings.timerSupp = v; })} /></Field>
      <Field label="Rest · assistance & warm-up" hint="seconds"><NumInput value={settings.timerAssist} step={15} onChange={(v) => commit((s) => { s.settings.timerAssist = v; })} /></Field>
      {bool('Timer sound', settings.sound, (s, v) => { s.settings.sound = v; })}
      {bool('Vibrate', settings.vibrate, (s, v) => { s.settings.vibrate = v; })}
      {bool('Keep screen on during workouts', settings.keepAwake, (s, v) => { s.settings.keepAwake = v; })}
      <Field label="Plates per side" hint="comma separated">
        <input type="text" key={settings.plates.join(',')} defaultValue={settings.plates.join(', ')} style={{ width: 170 }} onBlur={(e) => {
          const v = e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0);
          if (v.length) commit((s) => { s.settings.plates = v.sort((a, b) => b - a); });
        }} />
      </Field>
    </div>
  );
}

function SyncLine() {
  const st = useSyncStatus();
  const toast = useToast();
  let text: string;
  switch (st.phase) {
    case 'disabled': text = 'Sync off · this preview is not served by the Worker, so data stays on this device.'; break;
    case 'syncing': text = 'Syncing…'; break;
    case 'offline': text = `Offline${st.dirty ? ' · changes will sync when you are back online' : ''}.`; break;
    case 'error': text = `Sync problem: ${st.error ?? 'unknown'}.`; break;
    default: text = st.dirty ? 'Changes pending…' : st.lastSyncAt ? `Synced with your account ${timeAgo(st.lastSyncAt)}.` : 'Sync ready.';
  }
  return (
    <div className="muted small" id="sync-status">
      {text}
      {st.phase !== 'disabled' && <> <a href="#" data-action="sync-now" onClick={(e) => { e.preventDefault(); void syncNow().then(() => toast('Synced')); }}>Sync now</a></>}
    </div>
  );
}

function DataCard() {
  const { state, commit, replace } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  const st = useSyncStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const n = state.workouts.length;
  const synced = st.phase !== 'disabled';

  const onFile = async () => {
    const input = fileRef.current!;
    const f = input.files?.[0];
    if (!f) return;
    const text = await f.text();
    input.value = '';
    const doImport = (mode: 'merge' | 'replace') => {
      sheet.close();
      try {
        const next = importJson(state, text, mode);
        replace(next);
        commit();
        toast(`Imported · ${next.workouts.length} sessions`);
      } catch (e) {
        toast((e as Error).message);
      }
    };
    sheet.open(
      <>
        <h2>Import backup</h2><div className="note">{f.name}</div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => doImport('merge')}>Merge sessions</button>
          <button type="button" className="btn danger" onClick={() => doImport('replace')}>Replace everything</button>
        </div>
      </>,
    );
  };

  return (
    <div className="card">
      <h3>Your data</h3>
      <div className="muted small">{n} sessions{synced ? ', synced across your devices through your account.' : ' stored on this device only.'} Export regularly — a backup is a JSON file you can re-import anywhere.</div>
      <SyncLine />
      <div className="row wrap mt">
        <button type="button" className="btn" onClick={() => sheet.open(<ExportSheet />)}>Export backup</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import backup</button>
        <button type="button" className="btn" onClick={() => sheet.open(<ImportNotesSheet />)}>Import notes</button>
      </div>
      <input type="file" ref={fileRef} accept="application/json,.json" hidden onChange={() => void onFile()} />
      <div className="mt"><button type="button" className="btn ghost danger small" onClick={() => sheet.open(<EraseSheet />)}>Erase everything</button></div>
    </div>
  );
}

function ExportSheet() {
  const { state } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  return (
    <>
      <h2>Export backup</h2><div className="note">A JSON file with your program, settings and every session.</div>
      <div className="actions">
        <button type="button" className="btn" onClick={async () => { sheet.close(); try { await navigator.clipboard.writeText(exportJson(state)); toast('Backup copied'); } catch { toast('Clipboard unavailable'); } }}>Copy to clipboard</button>
        <button type="button" className="btn primary" onClick={() => { sheet.close(); void shareOrDownload(`fivethreeone-${new Date().toISOString().slice(0, 10)}.json`, exportJson(state)); }}>Share / download</button>
      </div>
    </>
  );
}

function ImportNotesSheet() {
  const { commit } = useStore();
  const sheet = useSheet();
  const toast = useToast();
  const [text, setText] = useState('');
  const run = () => {
    const res = parseNotes(text);
    if (!res.workouts.length) return toast('No dated sessions found');
    sheet.close();
    commit((s) => {
      const keys = new Set(s.workouts.map((w) => `${w.date}|${w.raw ?? ''}`));
      const now = Date.now();
      for (const w of res.workouts) if (!keys.has(`${w.date}|${w.raw ?? ''}`)) s.workouts.push({ ...w, updatedAt: now });
      sortWorkouts(s.workouts);
    });
    toast(`Imported ${res.workouts.length} sessions${res.warnings.length ? ` · ${res.warnings.length} warnings` : ''}`);
  };
  return (
    <>
      <h2>Import notes</h2>
      <div className="note">Paste a log like <code>Sept 4</code> / <code>OHP 120x6 95x5x4</code> / <code>Deads 355x8, 225x5x3</code>. Newest first; years are inferred.</div>
      <textarea autoFocus placeholder={'Sept 4\nOHP 120x6 95x5x4\nDeads 355x8, 225x5x3'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn primary" onClick={run}>Import</button>
      </div>
    </>
  );
}

function EraseSheet() {
  const { state, replace, commit } = useStore();
  const sheet = useSheet();
  const st = useSyncStatus();
  const where = st.phase === 'disabled' ? 'on this device' : 'on every device signed in to your account';
  const erase = () => {
    sheet.close();
    const now = Date.now();
    const tombstones = { ...(state.tombstones ?? {}) };
    for (const w of state.workouts) tombstones[w.id] = now;
    const fresh = freshState();
    fresh.workouts = [];
    fresh.tombstones = tombstones;
    replace(fresh);
    commit();
  };
  return (
    <>
      <h2>Erase everything?</h2>
      <div className="note">Program, settings and all {state.workouts.length} sessions {where}. Export a backup first.</div>
      <div className="actions">
        <button type="button" className="btn" onClick={sheet.close}>Cancel</button>
        <button type="button" className="btn danger" onClick={erase}>Erase</button>
      </div>
    </>
  );
}
