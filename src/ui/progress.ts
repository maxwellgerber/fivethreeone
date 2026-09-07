import { LIFTS, LIFT_NAMES, type Lift } from '../engine.ts';
import { bestE1rmPerLift, e1rmSeries, repPrs, weeklyTonnage } from '../stats.ts';
import { actions, ctx, fmtDate, fmtW, h, registerScreen } from './core.ts';

function chart(lift: Lift): string {
  const pts = e1rmSeries(ctx.state.workouts, lift);
  const tm = ctx.state.program.tms[lift];
  if (pts.length < 2) return `<div class="empty small">Not enough sessions yet.</div>`;
  // Last 18 months max, to keep the line readable.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);
  const recent = pts.filter((p) => p.date >= cutoff.toISOString().slice(0, 10));
  const data = recent.length >= 2 ? recent : pts;
  const W = 440, H = 200, L = 38, R = 12, T = 14, B = 26;
  const xs = data.map((p) => new Date(p.date + 'T00:00:00').getTime());
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vals = data.map((p) => p.e1rm).concat([tm]);
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  const pad = Math.max(10, (y1 - y0) * 0.12);
  y0 = Math.floor((y0 - pad) / 10) * 10;
  y1 = Math.ceil((y1 + pad) / 10) * 10;
  const X = (t: number) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const niceStep = [10, 20, 25, 50, 100].find((st) => (y1 - y0) / st <= 5) ?? 100;
  y0 = Math.floor(y0 / niceStep) * niceStep;
  y1 = Math.ceil(y1 / niceStep) * niceStep;
  const grid: number[] = [];
  for (let g = y0; g <= y1 + 1e-9; g += niceStep) grid.push(g);
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.e1rm).toFixed(1)}`).join(' ');
  const area = `${line} L${X(x1).toFixed(1)},${Y(y0)} L${X(x0).toFixed(1)},${Y(y0)} Z`;
  let bestI = 0;
  data.forEach((p, i) => { if (p.e1rm > data[bestI].e1rm) bestI = i; });
  // Up to 5 evenly spaced time labels, never closer than 70px.
  const months: string[] = [];
  const nLabels = Math.min(5, data.length);
  let lastX = -Infinity;
  for (let k = 0; k < nLabels; k++) {
    const i = Math.round((k * (data.length - 1)) / Math.max(1, nLabels - 1));
    const x = X(xs[i]);
    if (x - lastX < 70) continue;
    lastX = x;
    const anchor = k === 0 ? 'start' : k === nLabels - 1 ? 'end' : 'middle';
    months.push(`<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${fmtDate(data[i].date, { month: 'short', year: '2-digit' })}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated 1RM over time for ${LIFT_NAMES[lift]}">
    ${grid.map((g) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/><text x="${L - 6}" y="${(Y(g) + 4).toFixed(1)}" text-anchor="end">${Math.round(g)}</text>`).join('')}
    <line class="tmline" x1="${L}" x2="${W - R}" y1="${Y(tm).toFixed(1)}" y2="${Y(tm).toFixed(1)}"/>
    <text x="${W - R}" y="${(Y(tm) - 4).toFixed(1)}" text-anchor="end" fill="var(--pr)">TM ${fmtW(tm)}</text>
    <path class="area" d="${area}"/>
    <path class="line" d="${line}"/>
    ${data.map((p, i) => `<circle class="dot${i === bestI ? ' pr' : ''}" cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.e1rm).toFixed(1)}" r="${i === bestI ? 4 : 2.2}"/>`).join('')}
    ${months.join('')}
  </svg>`;
}

function tonnageBars(): string {
  const weeks = weeklyTonnage(ctx.state.workouts, 12);
  if (!weeks.length) return '';
  const max = Math.max(...weeks.map((w) => w.tonnage), 1);
  const W = 440, H = 90, bw = W / 12;
  const bars = weeks.map((w, i) => {
    const hgt = (w.tonnage / max) * (H - 24);
    return `<rect x="${(i * bw + 4).toFixed(1)}" y="${(H - 18 - hgt).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${hgt.toFixed(1)}" rx="3" fill="var(--accent)" opacity="${i === weeks.length - 1 ? 1 : 0.55}"/>
      <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${fmtDate(w.week, { month: 'numeric', day: 'numeric' })}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly tonnage">${bars.join('')}</svg>`;
}

function renderProgress(): string {
  const lift = (ctx.view.lift as Lift) ?? 'squat';
  const ws = ctx.state.workouts;
  const units = ctx.state.program.units;
  const best = bestE1rmPerLift(ws)[lift];
  const recent = bestE1rmPerLift(ws, 90)[lift];
  const prs = repPrs(ws, lift).filter((p) => [1, 3, 5, 8, 10].includes(p.reps));
  const weeks = weeklyTonnage(ws, 12);
  const thisWeek = weeks[weeks.length - 1];
  return `<header class="screen-head"><div><div class="eyebrow">Estimated 1RM · Wendler formula</div><h1>Progress</h1></div></header>
    <div class="seg" style="margin-bottom:12px">${LIFTS.map((l) => `<button type="button" class="${l === lift ? 'active' : ''}" data-action="prog-lift" data-lift="${l}">${LIFT_NAMES[l]}</button>`).join('')}</div>
    <div class="card">
      <div class="stat-row">
        <div class="stat"><div class="v">${best ? Math.round(best.e1rm) : '—'}<small>${units}</small></div><div class="l">Best e1RM${best ? ` · ${fmtW(best.weight)}×${best.reps}, ${fmtDate(best.date, { month: 'short', year: 'numeric' })}` : ''}</div></div>
        <div class="stat"><div class="v">${recent ? Math.round(recent.e1rm) : '—'}<small>${units}</small></div><div class="l">Best last 90 days</div></div>
      </div>
      ${chart(lift)}
    </div>
    <div class="card"><h3>Rep PRs</h3>
      ${prs.length ? `<table class="prs"><tr><th>Reps</th><th>Weight</th><th>When</th></tr>${prs.map((p) => `<tr><td>${p.reps}${p.reps === 1 ? ' rep' : ' reps'}</td><td class="w">${fmtW(p.weight)}</td><td class="muted">${fmtDate(p.date, { month: 'short', year: 'numeric' })}</td></tr>`).join('')}</table>` : '<div class="muted">No sets logged yet.</div>'}
    </div>
    <div class="card"><h3>Weekly tonnage</h3>
      <div class="muted small">${thisWeek ? `${Math.round(thisWeek.tonnage).toLocaleString()} ${units} across ${thisWeek.sets} sets this week` : 'Nothing in the last 12 weeks'}</div>
      ${tonnageBars()}
    </div>`;
}
registerScreen('progress', renderProgress);
actions['prog-lift'] = (el) => { ctx.view.lift = el.dataset.lift; ctx.tab = 'progress'; document.getElementById('view')!.innerHTML = renderProgress(); };
