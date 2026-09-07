import './ui/today.ts';
import './ui/history.ts';
import './ui/progress.ts';
import './ui/program.ts';
import { bindEvents, ctx, render } from './ui/core.ts';
import { loadState } from './store.ts';
import { initSync } from './sync.ts';

async function boot(): Promise<void> {
  ctx.state = await loadState();
  bindEvents();
  render();
  void initSync({
    getState: () => ctx.state,
    setState: (next) => { ctx.state = next; render(); },
    onStatus: () => { if (ctx.tab === 'program') render(); },
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) {
    // Kick the session so an expired login redirects before the app is used offline-stale.
    void fetch('/whoami', { cache: 'no-store' }).then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
    try { await navigator.serviceWorker.register('./sw.js'); } catch { /* offline support unavailable */ }
  }
}
void boot();
