import type { AppState } from '../model.ts';
import { saveState } from '../store.ts';

export type Tab = 'today' | 'history' | 'progress' | 'program';

export interface Ctx {
  state: AppState;
  tab: Tab;
  /** Screen-local view state (selected history workout, chart lift, etc). */
  view: Record<string, unknown>;
}

export const ctx: Ctx = { state: null as unknown as AppState, tab: 'today', view: {} };

export type ActionHandler = (el: HTMLElement, ev: Event) => void;
export const actions: Record<string, ActionHandler> = {};
export const changes: Record<string, ActionHandler> = {};
const screens: Record<Tab, () => string> = { today: () => '', history: () => '', progress: () => '', program: () => '' };

export function registerScreen(tab: Tab, fn: () => string): void {
  screens[tab] = fn;
}

export function h(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function fmtW(w: number, units?: string): string {
  const s = Number.isInteger(w) ? String(w) : String(+w.toFixed(1));
  return units ? `${s} ${units}` : s;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, opts);
}

export function commit(mut?: (s: AppState) => void): void {
  if (mut) mut(ctx.state);
  saveState(ctx.state);
  render();
}

export function setTab(tab: Tab): void {
  ctx.tab = tab;
  window.scrollTo({ top: 0 });
  render();
}

// ---- Sheet (bottom modal) ---------------------------------------------------

let sheetHtml: string | null = null;
export function openSheet(html: string): void {
  sheetHtml = html;
  renderSheet();
}
export function closeSheet(): void {
  sheetHtml = null;
  renderSheet();
}
function renderSheet(): void {
  let host = document.getElementById('sheet-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sheet-host';
    document.body.appendChild(host);
  }
  host.innerHTML = sheetHtml ? `<div class="scrim" data-action="sheet-scrim"><div class="sheet" role="dialog">${sheetHtml}</div></div>` : '';
  const first = host.querySelector<HTMLElement>('[autofocus]');
  if (first) first.focus();
}
actions['sheet-scrim'] = (_el, ev) => {
  if ((ev.target as HTMLElement).classList.contains('scrim')) closeSheet();
};
actions['sheet-close'] = () => closeSheet();

// ---- Toast ------------------------------------------------------------------

let toastTimer: number | null = null;
export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.hidden = true), 2200);
}

// ---- Rest timer -------------------------------------------------------------

interface TimerState { endsAt: number; total: number; label: string; fired: boolean }
let timer: TimerState | null = null;
let timerTick: number | null = null;
let audioCtx: AudioContext | null = null;

export function startTimer(seconds: number, label: string): void {
  if (seconds <= 0) return;
  timer = { endsAt: Date.now() + seconds * 1000, total: seconds, label, fired: false };
  if (!audioCtx && ctx.state.settings.sound) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { /* no audio */ }
  }
  if (audioCtx?.state === 'suspended') void audioCtx.resume();
  if (timerTick === null) timerTick = window.setInterval(renderTimer, 250);
  renderTimer();
}
export function stopTimer(): void {
  timer = null;
  if (timerTick !== null) { clearInterval(timerTick); timerTick = null; }
  renderTimer();
}
export function addTimer(seconds: number): void {
  if (!timer) return;
  timer.endsAt += seconds * 1000;
  timer.fired = false;
  renderTimer();
}
function beep(): void {
  if (ctx.state.settings.vibrate && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  if (!audioCtx || !ctx.state.settings.sound) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, now + i * 0.25);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.25 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + i * 0.25);
    o.stop(now + i * 0.25 + 0.22);
  }
}
export function renderTimer(): void {
  const host = document.getElementById('timer');
  if (!host) return;
  if (!timer) {
    host.innerHTML = '';
    return;
  }
  const rem = Math.ceil((timer.endsAt - Date.now()) / 1000);
  if (rem <= 0 && !timer.fired) {
    timer.fired = true;
    beep();
  }
  const over = rem <= 0;
  const abs = Math.abs(rem);
  const mm = Math.floor(abs / 60);
  const ss = String(abs % 60).padStart(2, '0');
  host.innerHTML = `<div class="bar${over ? ' over' : ''}">
    <div class="t">${over ? 'GO' : `${mm}:${ss}`}<small>${h(over ? `rest done · ${timer.label}` : timer.label)}</small></div>
    <button type="button" data-action="timer-add">+30</button>
    <button type="button" data-action="timer-stop" aria-label="Dismiss timer">✕</button>
  </div>`;
  if (over && abs > 60) stopTimer();
}
actions['timer-add'] = () => addTimer(30);
actions['timer-stop'] = () => stopTimer();

// ---- Wake lock --------------------------------------------------------------

let wakeLock: { release(): Promise<void> } | null = null;
export async function keepAwake(on: boolean): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ctx.state?.active && ctx.state.settings.keepAwake) {
    wakeLock = null;
    void keepAwake(true);
  }
});

// ---- Render -----------------------------------------------------------------

const ICONS: Record<Tab, string> = {
  today: '<svg viewBox="0 0 24 24"><path d="M4 12h2M18 12h2M6 8v8M18 8v8M8 6v12M16 6v12M8 12h8"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4"/></svg>',
  progress: '<svg viewBox="0 0 24 24"><path d="M4 19L10 12l4 4 6-8M4 19h16"/></svg>',
  program: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
};
const LABELS: Record<Tab, string> = { today: 'Today', history: 'History', progress: 'Progress', program: 'Program' };

export function render(): void {
  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  if (!view || !nav) return;
  view.innerHTML = screens[ctx.tab]();
  nav.innerHTML = `<div class="inner">${(Object.keys(LABELS) as Tab[])
    .map((t) => `<button type="button" class="${t === ctx.tab ? 'active' : ''}" data-action="tab" data-tab="${t}" aria-label="${LABELS[t]}">${ICONS[t]}${LABELS[t]}</button>`)
    .join('')}</div>`;
  renderTimer();
}
actions['tab'] = (el) => setTab(el.dataset.tab as Tab);

export function bindEvents(): void {
  document.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action!];
    if (fn) fn(el, ev);
  });
  document.addEventListener('change', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-change]');
    if (!el) return;
    const fn = changes[el.dataset.change!];
    if (fn) fn(el, ev);
  });
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownload(filename: string, text: string): Promise<void> {
  try {
    const file = new File([text], filename, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch { /* fall through */ }
  downloadText(filename, text);
}
