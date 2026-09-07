import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncClient, PUSH_DEBOUNCE_MS, type SyncClient, type SyncStatus } from './sync.ts';
import { defaultAssistance, defaultSettings, type AppState, type Workout } from './model.ts';
import { defaultProgram } from './engine.ts';
import type { SyncMeta } from './store.ts';

function base(over: Partial<AppState> = {}): AppState {
  return {
    version: 1, program: defaultProgram('lb'), position: { phase: 0, cycle: 0, week: 0, day: 0 },
    workouts: [], active: null, settings: defaultSettings('lb'), assistance: defaultAssistance(), onboarded: true, updatedAt: 1, tombstones: {}, ...over,
  };
}
const w = (id: string, date: string, over: Partial<Workout> = {}): Workout => ({ id, date, entries: [], ...over });

/** In-memory stand-in for the Worker's /api/state. */
function fakeServer(opts: { static?: boolean; unauthorized?: boolean } = {}) {
  const server = { rev: 0, state: null as AppState | null, puts: 0, gets: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (_url: string, init: RequestInit): Promise<Response> => {
    if (opts.static) return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    if (opts.unauthorized) return json({ error: 'unauthorized' }, 401);
    if (init.method === 'GET') {
      server.gets++;
      return server.rev === 0 ? json({ rev: 0 }, 404) : json({ rev: server.rev, updatedAt: 0, state: server.state });
    }
    server.puts++;
    const body = JSON.parse(String(init.body)) as { baseRev: number; state: AppState };
    if (body.baseRev !== server.rev) return json({ rev: server.rev, updatedAt: 0, state: server.state }, 409);
    server.rev++;
    server.state = body.state;
    return json({ rev: server.rev, updatedAt: 0 });
  };
  return { server, fetch };
}

/** One simulated device: its own state, meta, timers and client. */
function device(fetch: (u: string, i: RequestInit) => Promise<Response>, initial: AppState) {
  let state = initial;
  let meta: SyncMeta = { rev: 0, dirty: false };
  const persisted: AppState[] = [];
  const statuses: SyncStatus[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let unauthorized = 0;
  const client: SyncClient = createSyncClient({
    fetch,
    persist: async (s) => { persisted.push(s); },
    loadMeta: async () => meta,
    saveMeta: async (m) => { meta = m; },
    isOnline: () => online,
    onUnauthorized: () => { unauthorized++; },
    setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    now: () => 1000,
  });
  let online = true;
  const d = {
    client, persisted, statuses,
    get state() { return state; },
    get meta() { return meta; },
    get unauthorized() { return unauthorized; },
    setOnline(v: boolean) { online = v; },
    async init() { await client.init({ getState: () => state, setState: (s) => { state = s; }, onStatus: (s) => statuses.push(s) }); },
    /** Local edit: mutate, then tell the client (as saveState does). */
    async edit(mut: (s: AppState) => void) { state = structuredClone(state); mut(state); client.markDirty(); await tick(); },
    /** Fire the debounced push timer. */
    async flush() { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); await tick(); await tick(); },
  };
  return d;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('first device seeds an empty server; second device receives the copy', async () => {
  const { server, fetch } = fakeServer();
  const a = device(fetch, base({ workouts: [w('a', '2026-09-01')] }));
  await a.init();
  assert.equal(server.rev, 1);
  assert.equal(a.client.status().phase, 'idle');
  assert.equal(a.meta.rev, 1);
  assert.equal(a.meta.dirty, false);

  const b = device(fetch, base());
  await b.init();
  assert.deepEqual(b.state.workouts.map((x) => x.id), ['a']);
  assert.equal(b.meta.rev, 1);
  assert.equal(server.rev, 1, 'b had nothing new, so it did not push');
  assert.equal(b.persisted.length, 1);
});

test('a local edit is pushed after the debounce and clears dirty', async () => {
  const { server, fetch } = fakeServer();
  const a = device(fetch, base());
  await a.init();
  await a.edit((s) => s.workouts.push(w('x', '2026-09-02')));
  assert.equal(a.meta.dirty, true);
  assert.equal(a.client.status().dirty, true);
  await a.flush();
  assert.equal(server.rev, 2);
  assert.deepEqual(server.state!.workouts.map((x) => x.id), ['x']);
  assert.equal(a.meta.dirty, false);
  assert.equal(a.client.status().phase, 'idle');
  assert.equal(a.client.status().lastSyncAt, 1000);
});

test('stale push gets a 409, merges the server copy and retries once', async () => {
  const { server, fetch } = fakeServer();
  const a = device(fetch, base());
  // Device b races: a's push lands between b's pull and b's push.
  let raced = false;
  const b = device(async (u, i) => {
    if (i.method === 'PUT' && !raced) { raced = true; await a.flush(); }
    return fetch(u, i);
  }, base());
  await a.init();
  await b.init();
  await a.edit((s) => s.workouts.push(w('from-a', '2026-09-03')));
  await b.edit((s) => s.workouts.push(w('from-b', '2026-09-04')));
  const putsBefore = server.puts;
  await b.flush(); // pull (rev 1) -> a pushes rev 2 -> b's PUT 409 -> merge -> retry -> rev 3
  await b.client.syncNow(); // wait for the in-flight cycle (the race above spent the flush ticks)
  assert.equal(server.puts - putsBefore, 3, 'a push, b stale push, b retry');
  assert.equal(server.rev, 3);
  assert.deepEqual(server.state!.workouts.map((x) => x.id).sort(), ['from-a', 'from-b']);
  assert.deepEqual(b.state.workouts.map((x) => x.id).sort(), ['from-a', 'from-b']);
  assert.equal(b.meta.rev, 3);
  assert.equal(b.meta.dirty, false);
  await a.client.syncNow();
  assert.deepEqual(a.state.workouts.map((x) => x.id).sort(), ['from-a', 'from-b']);
});

test('a delete on one device removes the workout on the other', async () => {
  const { fetch } = fakeServer();
  const a = device(fetch, base({ workouts: [w('gone', '2026-09-01'), w('kept', '2026-09-02')] }));
  await a.init();
  const b = device(fetch, base());
  await b.init();
  await b.edit((s) => { s.workouts = s.workouts.filter((x) => x.id !== 'gone'); s.tombstones!['gone'] = Date.now(); });
  await b.flush();
  await a.client.syncNow();
  assert.deepEqual(a.state.workouts.map((x) => x.id), ['kept']);
});

test('offline: status goes offline and the change is pushed once back online', async () => {
  const { server, fetch } = fakeServer();
  const a = device(fetch, base());
  await a.init();
  a.setOnline(false);
  await a.edit((s) => s.workouts.push(w('later', '2026-09-05')));
  await a.flush();
  assert.equal(a.client.status().phase, 'offline');
  assert.equal(server.rev, 1);
  a.setOnline(true);
  await a.client.syncNow();
  assert.equal(server.rev, 2);
  assert.equal(a.client.status().phase, 'idle');
});

test('server errors surface as error status and keep the change dirty', async () => {
  let fail = true;
  const inner = fakeServer();
  const fetch = async (u: string, i: RequestInit) => (fail && i.method === 'PUT' ? new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }) : inner.fetch(u, i));
  const a = device(fetch, base());
  await a.init();
  assert.equal(a.client.status().phase, 'error');
  assert.equal(a.meta.dirty, true);
  fail = false;
  await a.client.syncNow();
  assert.equal(a.client.status().phase, 'idle');
  assert.equal(inner.server.rev, 1);
});

test('static hosting (no JSON endpoint) disables sync; 401 signs out', async () => {
  const s = device(fakeServer({ static: true }).fetch, base());
  await s.init();
  assert.equal(s.client.status().phase, 'disabled');
  await s.edit((x) => x.workouts.push(w('n', '2026-09-06')));
  assert.equal(s.meta.dirty, false, 'markDirty is a no-op while disabled');

  const u = device(fakeServer({ unauthorized: true }).fetch, base());
  await u.init();
  assert.equal(u.unauthorized, 1);
  assert.equal(u.client.status().phase, 'error');
});

test('concurrent syncNow calls coalesce into one request cycle', async () => {
  const { server, fetch } = fakeServer();
  const a = device(fetch, base());
  await a.init();
  const gets = server.gets;
  await Promise.all([a.client.syncNow(), a.client.syncNow(), a.client.syncNow()]);
  assert.ok(server.gets - gets <= 2, `expected at most one extra queued cycle, got ${server.gets - gets}`);
  assert.equal(PUSH_DEBOUNCE_MS, 1500);
});
