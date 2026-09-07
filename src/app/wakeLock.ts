// Screen wake lock while a workout is in progress.
type Lock = { release(): Promise<void> };
type Nav = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Lock> } };

let lock: Lock | null = null;

export async function keepAwake(on: boolean): Promise<void> {
  try {
    const nav = navigator as Nav;
    if (on && !lock && nav.wakeLock) lock = await nav.wakeLock.request('screen');
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not supported */ }
}

/** Re-acquire after the tab comes back (locks are dropped when hidden). */
export function reacquireOnVisible(shouldHold: () => boolean): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible' && shouldHold()) { lock = null; void keepAwake(true); }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
