import { useEffect, useState, type ReactElement } from 'react';
import { reacquireOnVisible, keepAwake } from './wakeLock.ts';
import { SheetProvider } from './sheet.tsx';
import { useStore } from './store.tsx';
import { TimerProvider } from './timer.tsx';
import { ToastProvider } from './toast.tsx';
import { Today } from '../screens/Today.tsx';
import { History } from '../screens/History.tsx';
import { Progress } from '../screens/Progress.tsx';
import { Program } from '../screens/Program.tsx';

export type Tab = 'today' | 'history' | 'progress' | 'program';

const ICONS: Record<Tab, ReactElement> = {
  today: <svg viewBox="0 0 24 24"><path d="M4 12h2M18 12h2M6 8v8M18 8v8M8 6v12M16 6v12M8 12h8" /></svg>,
  history: <svg viewBox="0 0 24 24"><path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" /></svg>,
  progress: <svg viewBox="0 0 24 24"><path d="M4 19L10 12l4 4 6-8M4 19h16" /></svg>,
  program: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>,
};
const LABELS: Record<Tab, string> = { today: 'Today', history: 'History', progress: 'Progress', program: 'Program' };
const TABS = Object.keys(LABELS) as Tab[];

export function App() {
  const [tab, setTabState] = useState<Tab>('today');
  const { current } = useStore();
  const setTab = (t: Tab) => { setTabState(t); window.scrollTo({ top: 0 }); };

  // Hold the screen awake while a workout is in progress (and re-take it after backgrounding).
  const activeId = useStore().state.active?.id ?? null;
  const keep = useStore().state.settings.keepAwake;
  useEffect(() => {
    void keepAwake(!!activeId && keep);
    return reacquireOnVisible(() => !!current().active && current().settings.keepAwake);
  }, [activeId, keep, current]);

  return (
    <ToastProvider>
      <TimerProvider>
        <SheetProvider>
          <div id="app">
            <main id="view">
              {tab === 'today' && <Today />}
              {tab === 'history' && <History />}
              {tab === 'progress' && <Progress />}
              {tab === 'program' && <Program />}
            </main>
          </div>
          <nav className="tabs" id="nav">
            <div className="inner">
              {TABS.map((t) => (
                <button key={t} type="button" className={t === tab ? 'active' : ''} data-tab={t} aria-label={LABELS[t]} onClick={() => setTab(t)}>
                  {ICONS[t]}{LABELS[t]}
                </button>
              ))}
            </div>
          </nav>
        </SheetProvider>
      </TimerProvider>
    </ToastProvider>
  );
}
