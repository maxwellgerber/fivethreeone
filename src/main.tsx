import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { StoreProvider } from './app/store.tsx';
import { SyncProvider } from './app/syncStatus.tsx';
import { loadState } from './store.ts';

async function boot(): Promise<void> {
  const initial = await loadState();
  createRoot(document.getElementById('root')!).render(
    <StoreProvider initial={initial}>
      <SyncProvider>
        <App />
      </SyncProvider>
    </StoreProvider>,
  );

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) {
    // Kick the session so an expired login redirects before the app is used offline-stale.
    void fetch('/whoami', { cache: 'no-store' }).then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
    try { await navigator.serviceWorker.register('./sw.js'); } catch { /* offline support unavailable */ }
  }
}
void boot();
